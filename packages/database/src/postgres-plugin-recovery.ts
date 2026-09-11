import { ApplicationError, SYSTEM_AUTHORIZATION_REALM_ID, type PluginDesiredState } from "@xecms/application";
import { pluginManifestDigest, validatePluginGraph, type XeCmsPluginManifestV1, type XeCmsPluginModule } from "@xecms/plugin-sdk";
import type { Pool, PoolClient } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

const RECOVERY_ACTOR = "cli:offline-recovery";

export interface PluginMigrationState {
  readonly id: string;
  readonly checksum: string;
  readonly sequence: number;
}
export interface PluginInspection {
  readonly pluginId: string;
  readonly packageName: string;
  readonly version: string;
  readonly desiredState: PluginDesiredState;
  readonly revision: number;
  readonly restartRequired: boolean;
  readonly storedDigest: string;
  readonly manifestIntegrity: boolean;
  readonly migrationIntegrity: boolean;
  readonly migrations: readonly PluginMigrationState[];
  readonly enabledDependents: readonly string[];
}
export interface PluginSyncEntry {
  readonly pluginId: string;
  readonly revision: number;
  readonly storedDigest: string;
  readonly currentDigest: string;
  readonly status: "in-sync" | "drifted" | "blocked" | "missing-package";
  readonly reason?: string;
}
export interface PluginSyncReport {
  readonly entries: readonly PluginSyncEntry[];
  readonly updated: readonly string[];
}
export interface PluginDisableReport {
  readonly pluginId: string;
  readonly revision: number;
  readonly changed: boolean;
  readonly restartRequired: boolean;
  readonly enabledDependents: readonly string[];
}

/** Database-only recovery: never imports or executes installed Plugin code. */
export class PostgresPluginRecoveryStore {
  private readonly schema: string;

  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public inspect(workspaceId: string): Promise<readonly PluginInspection[]> {
    return this.transaction(false, async client => {
      const records = await this.records(client, workspaceId, false);
      const inspections: PluginInspection[] = [];
      for (const row of records) {
        const migrations = await this.migrations(client, workspaceId, row.plugin_id);
        inspections.push({
          pluginId: row.plugin_id, packageName: row.package_name, version: row.version,
          desiredState: row.desired_state, revision: Number(row.revision),
          restartRequired: row.restart_required, storedDigest: row.manifest_digest,
          manifestIntegrity: pluginManifestDigest(row.manifest) === row.manifest_digest,
          migrationIntegrity: matchesMigrations(migrations, row.manifest), migrations,
          enabledDependents: enabledDependents(records, row.plugin_id),
        });
      }
      return inspections;
    });
  }

  public sync(workspaceId: string, modules: readonly XeCmsPluginModule[], apply: boolean): Promise<PluginSyncReport> {
    validatePluginGraph(modules);
    const byId = new Map(modules.map(module => [module.manifest.id, module]));
    return this.transaction(apply, async client => {
      // Lifecycle/config changes lock these same rows. Lock in stable order and
      // re-read history in this snapshot, including when the digest matches.
      const records = await this.records(client, workspaceId, apply);
      const entries: PluginSyncEntry[] = [];
      const updated: string[] = [];
      for (const row of records) {
        const module = byId.get(row.plugin_id);
        const base = { pluginId: row.plugin_id, revision: Number(row.revision), storedDigest: row.manifest_digest };
        if (!module) {
          entries.push({ ...base, currentDigest: "", status: "missing-package", reason: "Plugin package is not present in this build; use offline disable to recover." });
          continue;
        }
        const currentDigest = pluginManifestDigest(module.manifest);
        const migrations = await this.migrations(client, workspaceId, row.plugin_id);
        if (!matchesMigrations(migrations, module.manifest)) {
          entries.push({ ...base, currentDigest, status: "blocked", reason: "Migration history differs from the manifest; offline disable, restore the matching package/history, then use a lifecycle plan." });
          continue;
        }
        const inSync = currentDigest === row.manifest_digest &&
          pluginManifestDigest(row.manifest) === currentDigest &&
          row.package_name === module.manifest.packageName && row.version === module.manifest.version;
        entries.push({ ...base, currentDigest, status: inSync ? "in-sync" : "drifted" });
        if (!apply || inSync) continue;
        const now = new Date().toISOString();
        await client.query(
          `UPDATE ${this.q("_xecms_plugins")} SET manifest=$3::jsonb,manifest_digest=$4,package_name=$5,version=$6,
           revision=revision+1,restart_required=true,updated_at=$7,updated_by=$8 WHERE workspace_id=$1 AND plugin_id=$2`,
          [workspaceId, row.plugin_id, JSON.stringify(module.manifest), currentDigest, module.manifest.packageName, module.manifest.version, now, RECOVERY_ACTOR],
        );
        await this.audit(client, workspaceId, row, "plugin.manifest.synced", now, {
          previousDigest: row.manifest_digest, currentDigest,
          previousVersion: row.version, currentVersion: module.manifest.version,
        });
        updated.push(row.plugin_id);
      }
      return { entries, updated };
    });
  }

  public disable(workspaceId: string, pluginId: string, expectedRevision?: number): Promise<PluginDisableReport> {
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw new ApplicationError("PLUGIN_REVISION_INVALID", 422, "Expected revision must be a positive safe integer.");
    }
    return this.transaction(true, async client => {
      const result = await client.query<RecoveryRow>(
        `SELECT * FROM ${this.q("_xecms_plugins")} WHERE workspace_id=$1 AND plugin_id=$2 FOR UPDATE`, [workspaceId, pluginId],
      );
      const row = result.rows[0];
      if (!row) throw new ApplicationError("PLUGIN_NOT_INSTALLED", 404, "Plugin is not installed.");
      const revision = Number(row.revision);
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new ApplicationError("PLUGIN_REVISION_CONFLICT", 409, "Plugin changed after inspection; inspect again before disabling.", {
          details: { expectedRevision, actualRevision: revision },
        });
      }
      const dependents = enabledDependents(await this.records(client, workspaceId, false), pluginId);
      if (row.desired_state === "disabled") {
        return { pluginId, revision, changed: false, restartRequired: row.restart_required, enabledDependents: dependents };
      }
      const now = new Date().toISOString();
      await client.query(
        `UPDATE ${this.q("_xecms_plugins")} SET desired_state='disabled',revision=revision+1,restart_required=true,
         updated_at=$3,updated_by=$4 WHERE workspace_id=$1 AND plugin_id=$2`, [workspaceId, pluginId, now, RECOVERY_ACTOR],
      );
      await this.audit(client, workspaceId, row, "plugin.disabled", now, { previousState: row.desired_state, enabledDependents: dependents });
      return { pluginId, revision: revision + 1, changed: true, restartRequired: true, enabledDependents: dependents };
    });
  }

  private async records(client: PoolClient, workspaceId: string, lock: boolean) {
    const result = await client.query<RecoveryRow>(
      `SELECT * FROM ${this.q("_xecms_plugins")} WHERE workspace_id=$1 ORDER BY plugin_id${lock ? " FOR UPDATE" : ""}`, [workspaceId],
    );
    return result.rows;
  }

  private async migrations(client: PoolClient, workspaceId: string, pluginId: string): Promise<readonly PluginMigrationState[]> {
    const result = await client.query<{ migration_id: string; checksum: string; sequence: number }>(
      `SELECT migration_id,checksum,sequence FROM ${this.q("_xecms_plugin_migrations")} WHERE workspace_id=$1 AND plugin_id=$2 ORDER BY sequence`, [workspaceId, pluginId],
    );
    return result.rows.map(row => ({ id: row.migration_id, checksum: row.checksum, sequence: Number(row.sequence) }));
  }

  private async audit(client: PoolClient, workspaceId: string, row: RecoveryRow, eventType: string, now: string, metadata: Record<string, unknown>) {
    // A DB credential is the authority for offline recovery. Do not impersonate
    // an application identity or copy potentially secret Plugin config to logs.
    const revision = Number(row.revision) + 1;
    const actor = await client.query<{ session_user: string; current_user: string }>("SELECT session_user, current_user");
    const payload = {
      workspaceId, pluginId: row.plugin_id, revision, previousRevision: Number(row.revision), source: RECOVERY_ACTOR,
      databaseSessionUser: actor.rows[0]!.session_user, databaseCurrentUser: actor.rows[0]!.current_user,
      previousVersion: row.version, currentVersion: row.version, ...metadata,
    };
    const audit = await client.query<{ id: string }>(
      `INSERT INTO ${this.q("_xecms_audit_log")}(event_type,occurred_at,metadata) VALUES($1,$2,$3::jsonb) RETURNING id`, [eventType, now, JSON.stringify(payload)],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}(id,workspace_id,realm_id,topic,aggregate_type,aggregate_id,aggregate_version,occurred_at,payload,created_at)
       VALUES($1,$2,$3,$4,'plugin',$5,$6,$7,$8::jsonb,$7)`,
      [`outbox_plugin_${audit.rows[0]!.id}`, workspaceId, SYSTEM_AUTHORIZATION_REALM_ID, eventType, row.plugin_id, revision, now, JSON.stringify(payload)],
    );
  }

  private async transaction<T>(write: boolean, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ${write ? "" : " READ ONLY"}`);
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error !== null && "code" in error && ["40001", "40P01", "55P03"].includes(String(error.code))) {
        throw new ApplicationError("PLUGIN_REVISION_CONFLICT", 409, "Plugin lifecycle changed or is busy; inspect and retry recovery.", { details: { databaseCode: error.code } });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private q(name: string) { return qualifiedName(this.schema, name); }
}

interface RecoveryRow {
  plugin_id: string; package_name: string; version: string; manifest: XeCmsPluginManifestV1;
  manifest_digest: string; desired_state: PluginDesiredState; revision: string | number; restart_required: boolean;
}

function matchesMigrations(actual: readonly PluginMigrationState[], manifest: XeCmsPluginManifestV1): boolean {
  const expected = (manifest.migrations ?? []).map((entry, index) => ({ id: entry.id, checksum: entry.checksum, sequence: index + 1 }));
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function enabledDependents(records: readonly RecoveryRow[], pluginId: string): readonly string[] {
  return records.filter(row => row.plugin_id !== pluginId && row.desired_state === "enabled" &&
    Object.hasOwn(row.manifest.dependencies ?? {}, pluginId)).map(row => row.plugin_id);
}
