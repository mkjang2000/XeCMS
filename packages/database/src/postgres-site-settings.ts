import {
  ApplicationError,
  SYSTEM_AUTHORIZATION_REALM_ID,
  type WorkspaceSettings,
  type WorkspaceSettingsStore,
} from "@xecms/application";
import type { Pool, QueryResultRow } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export class PostgresWorkspaceSettingsStore implements WorkspaceSettingsStore {
  private readonly schema: string;
  public constructor(private readonly pool: Pool, schema: string) { this.schema = validateDatabaseSchema(schema); }
  public async get(workspaceId: string): Promise<WorkspaceSettings | null> {
    const result = await this.pool.query<Row>(
      `SELECT id, name, default_timezone, admin_locale, revision, updated_at, updated_by
         FROM ${this.q("_xecms_workspaces")} WHERE id = $1`, [workspaceId],
    );
    return result.rows[0] === undefined ? null : map(result.rows[0]);
  }
  public async update(input: {
    readonly workspaceId: string; readonly expectedRevision: number; readonly displayName: string;
    readonly defaultTimezone: string; readonly adminLocale: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string;
  }): Promise<WorkspaceSettings> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row>(
        `UPDATE ${this.q("_xecms_workspaces")}
            SET name = $3, default_timezone = $4, admin_locale = $5, revision = revision + 1,
                updated_at = $6, updated_by = $7
          WHERE id = $1 AND revision = $2
          RETURNING id, name, default_timezone, admin_locale, revision, updated_at, updated_by`,
        [input.workspaceId, input.expectedRevision, input.displayName, input.defaultTimezone,
          input.adminLocale, input.now, input.actorIdentityId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        const current = await client.query<{ revision: string | number }>(
          `SELECT revision FROM ${this.q("_xecms_workspaces")} WHERE id = $1`,
          [input.workspaceId],
        );
        if (current.rows[0] === undefined) {
          throw new ApplicationError("WORKSPACE_NOT_FOUND", 404, "The Workspace does not exist.");
        }
        throw new ApplicationError(
          "WORKSPACE_REVISION_CONFLICT",
          409,
          "The Workspace changed after it was read.",
          { details: { expectedRevision: input.expectedRevision, actualRevision: Number(current.rows[0].revision) } },
        );
      }
      const metadata = { workspaceId: input.workspaceId, revision: Number(row.revision) };
      const audit = await client.query<{ id: string | number }>(
        `INSERT INTO ${this.q("_xecms_audit_log")}(event_type, identity_id, occurred_at, metadata)
         VALUES ('workspace.settings.updated', $1, $2, $3::jsonb) RETURNING id`,
        [input.actorIdentityId, input.now, JSON.stringify(metadata)],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_outbox_events")}
           (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id, aggregate_version,
            actor_subject_id, actor_identity_id, occurred_at, payload, created_at)
         VALUES ($1, $2, $3, 'workspace.settings.updated', 'workspace', $2, $4, $5, $6, $7, $8::jsonb, $7)`,
        [`outbox_workspace_${audit.rows[0]!.id}`, input.workspaceId, SYSTEM_AUTHORIZATION_REALM_ID,
          Number(row.revision), input.actorSubjectId, input.actorIdentityId, input.now, JSON.stringify(metadata)],
      );
      await client.query("COMMIT");
      return map(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private q(name: string): string { return qualifiedName(this.schema, name); }
}

interface Row extends QueryResultRow {
  readonly id: string; readonly name: string; readonly default_timezone: string;
  readonly admin_locale: string; readonly revision: string | number;
  readonly updated_at: Date | string; readonly updated_by: string;
}
function map(row: Row): WorkspaceSettings {
  return { id: row.id, displayName: row.name, defaultTimezone: row.default_timezone,
    adminLocale: row.admin_locale, revision: Number(row.revision),
    updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by };
}
