import { randomUUID } from "node:crypto";
import examplePlugin from "@xecms/example-plugin";
import { PluginCatalog, PluginService } from "@xecms/application";
import { definePlugin, pluginManifestDigest, type XeCmsPluginModule } from "@xecms/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { PostgresPluginRecoveryStore } from "./postgres-plugin-recovery.js";
import { PostgresPluginStore } from "./postgres-plugins.js";
import { PostgresDatabase } from "./postgres.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"] ?? "";
const workspaceId = "wrk_default";
const now = "2026-09-11T00:00:00.000Z";

describe.runIf(RUN)("offline Plugin recovery transactions", () => {
  let database: PostgresDatabase;
  let recovery: PostgresPluginRecoveryStore;
  let schema: string;
  const q = (name: string) => qualifiedName(schema, name);

  beforeEach(async () => {
    if (!DATABASE_URL) throw new Error("XECMS_TEST_DATABASE_URL is required for PostgreSQL tests.");
    schema = `xecms_recovery_${randomUUID().replaceAll("-", "")}`;
    database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 5 });
    await database.migrate();
    recovery = new PostgresPluginRecoveryStore(database.pool, schema);
    await seed(examplePlugin);
  });
  afterEach(async () => {
    if (!database) return;
    try { await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`); }
    finally { await database.close(); }
  });

  async function seed(module: XeCmsPluginModule) {
    const manifest = module.manifest;
    await database.pool.query(
      `INSERT INTO ${q("_xecms_plugins")}(workspace_id,plugin_id,package_name,version,manifest,manifest_digest,desired_state,config,revision,restart_required,installed_at,installed_by,updated_at,updated_by)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,'enabled','{"secret":"preserve-me"}',1,false,$7,'fixture',$7,'fixture')`,
      [workspaceId, manifest.id, manifest.packageName, manifest.version, JSON.stringify(manifest), pluginManifestDigest(manifest), now],
    );
    for (const [index, migration] of (manifest.migrations ?? []).entries()) {
      await database.pool.query(
        `INSERT INTO ${q("_xecms_plugin_migrations")}(workspace_id,plugin_id,migration_id,checksum,sequence,applied_at,applied_by) VALUES($1,$2,$3,$4,$5,$6,'fixture')`,
        [workspaceId, manifest.id, migration.id, migration.checksum, index + 1, now],
      );
    }
  }
  function service(modules: readonly XeCmsPluginModule[] = [examplePlugin]) {
    return new PluginService(new PostgresPluginStore(database.pool, schema), new PluginCatalog(modules), {
      now: () => now, newPlanId: () => `plan_${randomUUID()}`, loadedPluginIds: new Set(),
    });
  }
  async function persisted() {
    return (await database.pool.query(`SELECT * FROM ${q("_xecms_plugins")} ORDER BY plugin_id`)).rows;
  }
  async function audits() {
    return (await database.pool.query(`SELECT event_type,identity_id,metadata FROM ${q("_xecms_audit_log")} WHERE metadata->>'source'='cli:offline-recovery' ORDER BY id`)).rows;
  }

  it("inspects and disables missing packages without loading code, preserving config, data and migration history", async () => {
    await database.pool.query(`CREATE TABLE ${q("_xecms_plugin_example_greeter_messages")}(id text PRIMARY KEY, message text)`);
    await database.pool.query(`INSERT INTO ${q("_xecms_plugin_example_greeter_messages")} VALUES('preserved','Keep data')`);
    const history = (await database.pool.query(`SELECT * FROM ${q("_xecms_plugin_migrations")}`)).rows;
    await expect(service([]).assertStartupState(workspaceId)).rejects.toMatchObject({ code: "PLUGIN_ENABLED_PACKAGE_MISSING" });
    expect((await recovery.sync(workspaceId, [], false)).entries).toMatchObject([{ status: "missing-package" }]);
    const inspection = await recovery.inspect(workspaceId);
    expect(inspection).toMatchObject([{ pluginId: examplePlugin.manifest.id, revision: 1, manifestIntegrity: true, migrationIntegrity: true }]);
    expect(JSON.stringify(inspection)).not.toContain("preserve-me");
    expect(await recovery.disable(workspaceId, examplePlugin.manifest.id, 1)).toMatchObject({ changed: true, revision: 2, restartRequired: true });
    expect(await service([]).assertStartupState(workspaceId)).toEqual([]);
    expect((await persisted())[0]).toMatchObject({ desired_state: "disabled", config: { secret: "preserve-me" }, revision: "2", updated_by: "cli:offline-recovery" });
    expect((await database.pool.query(`SELECT * FROM ${q("_xecms_plugin_migrations")}`)).rows).toEqual(history);
    expect((await database.pool.query(`SELECT message FROM ${q("_xecms_plugin_example_greeter_messages")}`)).rows).toEqual([{ message: "Keep data" }]);
    expect(await recovery.disable(workspaceId, examplePlugin.manifest.id)).toMatchObject({ changed: false, revision: 2 });
    expect(await audits()).toEqual([expect.objectContaining({ event_type: "plugin.disabled", identity_id: null, metadata: expect.objectContaining({ previousRevision: 1, revision: 2, previousState: "enabled" }) })]);
    expect((await database.pool.query(`SELECT topic,aggregate_version,actor_identity_id FROM ${q("_xecms_outbox_events")} WHERE topic='plugin.disabled'`)).rows).toEqual([{ topic: "plugin.disabled", aggregate_version: "2", actor_identity_id: null }]);
  });

  it.each(["checksum", "sequence"] as const)("blocks equal-digest migration %s drift and permits offline disable", async field => {
    await database.pool.query(`UPDATE ${q("_xecms_plugin_migrations")} SET ${field}=${field === "checksum" ? "'drifted'" : "3"}`);
    const before = await persisted();
    expect((await recovery.sync(workspaceId, [examplePlugin], true))).toMatchObject({ entries: [{ status: "blocked" }], updated: [] });
    expect(await persisted()).toEqual(before);
    expect(await audits()).toEqual([]);
    expect(await recovery.inspect(workspaceId)).toMatchObject([{ manifestIntegrity: true, migrationIntegrity: false }]);
    await expect(service().assertStartupState(workspaceId)).rejects.toMatchObject({ code: "PLUGIN_MIGRATION_CHECKSUM_DRIFT" });
    await recovery.disable(workspaceId, examplePlugin.manifest.id);
    expect(await service().assertStartupState(workspaceId)).toEqual([]);
  });

  it("syncs envelope metadata atomically, invalidates lifecycle previews and is idempotent", async () => {
    const plan = await service().preview({ workspaceId, pluginId: examplePlugin.manifest.id, action: "disable", expectedPluginRevision: 1, actorIdentityId: "fixture" });
    await database.pool.query(`UPDATE ${q("_xecms_plugins")} SET manifest_digest='stale',version='0.0.0',package_name='old-package'`);
    const before = await persisted();
    expect((await recovery.sync(workspaceId, [examplePlugin], false)).entries).toMatchObject([{ status: "drifted", revision: 1 }]);
    expect(await persisted()).toEqual(before);
    expect((await recovery.sync(workspaceId, [examplePlugin], true)).updated).toEqual([examplePlugin.manifest.id]);
    expect((await persisted())[0]).toMatchObject({ revision: "2", manifest_digest: pluginManifestDigest(examplePlugin.manifest), version: examplePlugin.manifest.version, package_name: examplePlugin.manifest.packageName, restart_required: true });
    await expect(service().apply({ workspaceId, pluginId: examplePlugin.manifest.id, planId: plan.id, expectedPluginRevision: 1, actorIdentityId: "fixture", actorSubjectId: "fixture" })).rejects.toMatchObject({ code: "PLUGIN_REVISION_CONFLICT" });
    await expect(recovery.disable(workspaceId, examplePlugin.manifest.id, 1)).rejects.toMatchObject({ code: "PLUGIN_REVISION_CONFLICT" });
    expect((await recovery.sync(workspaceId, [examplePlugin], true)).updated).toEqual([]);
    expect(await audits()).toHaveLength(1);
    const actor = (await database.pool.query("SELECT session_user, current_user")).rows[0]!;
    expect((await audits())[0]).toMatchObject({ event_type: "plugin.manifest.synced", metadata: { databaseSessionUser: actor.session_user, databaseCurrentUser: actor.current_user, previousVersion: "0.0.0", currentVersion: examplePlugin.manifest.version, previousDigest: "stale", currentDigest: pluginManifestDigest(examplePlugin.manifest) } });
  });

  it.each(["_xecms_audit_log", "_xecms_outbox_events"])("rolls back every sync update and audit when writing %s fails", async table => {
    const other = definePlugin({ manifest: { manifestVersion: 1, id: "zzz-recovery", packageName: "@test/zzz-recovery", version: "1.0.0", displayName: "Recovery", compatibility: examplePlugin.manifest.compatibility } });
    await seed(other);
    await database.pool.query(`UPDATE ${q("_xecms_plugins")} SET manifest_digest='stale'`);
    await database.pool.query(`CREATE FUNCTION ${q("reject_recovery")}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${table === "_xecms_audit_log" ? "NEW.metadata->>'pluginId'" : "NEW.aggregate_id"}='zzz-recovery' THEN RAISE EXCEPTION 'recovery audit unavailable'; END IF; RETURN NEW; END $$`);
    await database.pool.query(`CREATE TRIGGER reject_recovery BEFORE INSERT ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION ${q("reject_recovery")}()`);
    const before = await persisted();
    await expect(recovery.sync(workspaceId, [examplePlugin, other], true)).rejects.toThrow("recovery audit unavailable");
    expect(await persisted()).toEqual(before);
    expect(await audits()).toEqual([]);
    expect((await database.pool.query(`SELECT * FROM ${q("_xecms_outbox_events")} WHERE aggregate_type='plugin'`)).rows).toEqual([]);
  });

  it("rolls back offline disable when its outbox write fails", async () => {
    await database.pool.query(`CREATE FUNCTION ${q("reject_disable")}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END $$`);
    await database.pool.query(`CREATE TRIGGER reject_disable BEFORE INSERT ON ${q("_xecms_outbox_events")} FOR EACH ROW EXECUTE FUNCTION ${q("reject_disable")}()`);
    const before = await persisted();
    await expect(recovery.disable(workspaceId, examplePlugin.manifest.id)).rejects.toThrow("outbox unavailable");
    expect(await persisted()).toEqual(before);
    expect(await audits()).toEqual([]);
  });

  it("allows one concurrent guarded disable and rejects the stale competitor", async () => {
    const results = await Promise.allSettled([
      recovery.disable(workspaceId, examplePlugin.manifest.id, 1),
      recovery.disable(workspaceId, examplePlugin.manifest.id, 1),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "PLUGIN_REVISION_CONFLICT" } });
    expect((await persisted())[0]).toMatchObject({ desired_state: "disabled", revision: "2" });
    expect(await audits()).toHaveLength(1);
  });

  it("rejects a sync racing with a locked lifecycle update and preserves the committed update", async () => {
    await database.pool.query(`UPDATE ${q("_xecms_plugins")} SET manifest_digest='stale'`);
    const client = await database.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE ${q("_xecms_plugins")} SET revision=revision+1,config='{"changed":"by-lifecycle"}' WHERE plugin_id=$1`, [examplePlugin.manifest.id]);
      pending = recovery.sync(workspaceId, [examplePlugin], true).catch(error => error);
      await expect.poll(async () => Number((await database.pool.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1", [`%${schema}%_xecms_plugins%FOR UPDATE%`],
      )).rows[0]!.count), { timeout: 3000 }).toBeGreaterThan(0);
      await client.query("COMMIT");
      expect(await pending).toMatchObject({ code: "PLUGIN_REVISION_CONFLICT" });
      expect((await persisted())[0]).toMatchObject({ revision: "2", config: { changed: "by-lifecycle" }, manifest_digest: "stale" });
      expect(await audits()).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pending;
    }
  });
});
