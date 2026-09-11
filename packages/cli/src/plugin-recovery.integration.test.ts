import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresDatabase, qualifiedName, quoteIdentifier } from "@xecms/database";
import { definePlugin, pluginManifestDigest } from "@xecms/plugin-sdk";
import { buildServer, loadServerConfig, type XeCmsServer } from "@xecms/server";
import { describe, expect, it, vi } from "vitest";
import type { LoadedProject } from "./config.js";
import { runPluginCommand } from "./plugin-commands.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"] ?? "";

describe.runIf(RUN)("CLI Plugin startup recovery", () => {
  it.each([
    ["missing-package", "PLUGIN_ENABLED_PACKAGE_MISSING"],
    ["manifest-drift", "PLUGIN_MANIFEST_DRIFT"],
    ["migration-drift", "PLUGIN_MIGRATION_CHECKSUM_DRIFT"],
    ["health-degraded", "PLUGIN_STARTUP_HEALTH_FAILED"],
    ["health-throws", undefined],
  ])("restores core readiness after %s without executing disabled Plugin code", async (failure, code) => {
    if (!DATABASE_URL) throw new Error("XECMS_TEST_DATABASE_URL is required for PostgreSQL tests.");
    const schema = `xecms_cli_recovery_${randomUUID().replaceAll("-", "")}`;
    const root = await mkdtemp(join(tmpdir(), "xecms-cli-recovery-"));
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 4 });
    const q = (name: string) => qualifiedName(schema, name);
    const health = vi.fn(async () => {
      if (failure === "health-throws") throw new Error("health transport unavailable");
      return { status: "degraded" as const, detail: "health transport unavailable" };
    });
    const module = definePlugin({
      manifest: {
        manifestVersion: 1, id: "recovery-probe", packageName: "@test/recovery-probe", version: "1.0.0", displayName: "Recovery Probe",
        compatibility: { core: ">=0.5.0 <0.6.0", admin: ">=0.5.0 <0.6.0", sdk: "1.x" },
        serverEntry: "server", migrations: [{ id: "0001_probe", checksum: "probe-v1" }],
      },
      server: { health, migrations: [{ id: "0001_probe", checksum: "probe-v1", up: async () => undefined }] },
    });
    const modules = failure === "missing-package" ? [] : [module];
    const config = loadServerConfig({ NODE_ENV: "development", DATABASE_URL, XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "plugin-recovery-integration-secret-0123456789", XECMS_ADMIN_DIST: "/unused",
      XECMS_MEDIA_STORAGE_ROOT: join(root, "media"), XECMS_WORKER_ENABLED: "false" });
    const project: LoadedProject = { root, databaseUrl: DATABASE_URL, config: { projectName: "recovery", starter: "minimal", databaseSchema: schema, schemaFile: "schema.json", typesFile: "types.ts", mediaStorageRoot: "media", adminDist: "admin" } };
    let server: XeCmsServer | undefined;
    try {
      await database.migrate();
      await database.pool.query(
        `INSERT INTO ${q("_xecms_plugins")}(workspace_id,plugin_id,package_name,version,manifest,manifest_digest,desired_state,config,revision,restart_required,installed_at,installed_by,updated_at,updated_by)
         VALUES('wrk_default',$1,$2,$3,$4::jsonb,$5,'enabled','{}',1,false,now(),'fixture',now(),'fixture')`,
        [module.manifest.id, module.manifest.packageName, module.manifest.version, JSON.stringify(module.manifest), failure === "manifest-drift" ? "stale" : pluginManifestDigest(module.manifest)],
      );
      await database.pool.query(
        `INSERT INTO ${q("_xecms_plugin_migrations")}(workspace_id,plugin_id,migration_id,checksum,sequence,applied_at,applied_by) VALUES('wrk_default',$1,'0001_probe',$2,1,now(),'fixture')`,
        [module.manifest.id, failure === "migration-drift" ? "drifted" : "probe-v1"],
      );
      const start = buildServer({ database, config, plugins: modules, logger: false });
      if (code) await expect(start).rejects.toMatchObject({ code });
      else await expect(start).rejects.toThrow("health transport unavailable");
      const callsBeforeRecovery = health.mock.calls.length;
      const io = { log: vi.fn(), error: vi.fn() };
      const inspection = await runPluginCommand(project, ["inspect", "--json"], io);
      expect(inspection).toBe(failure === "manifest-drift" || failure === "migration-drift" ? 1 : 0);
      expect(await runPluginCommand(project, ["disable", module.manifest.id, "--offline", "--expected-revision", "1"], io)).toBe(0);
      server = await buildServer({ database, config, plugins: modules, logger: false });
      expect((await server.app.inject({ method: "GET", url: "/api/live" })).statusCode).toBe(200);
      const ready = await server.app.inject({ method: "GET", url: "/api/ready" });
      expect(ready.statusCode, ready.body).toBe(200);
      expect(health).toHaveBeenCalledTimes(callsBeforeRecovery);
      expect((await database.pool.query(`SELECT desired_state,revision,restart_required FROM ${q("_xecms_plugins")}`)).rows).toEqual([{ desired_state: "disabled", revision: "2", restart_required: false }]);
      expect((await database.pool.query(`SELECT checksum FROM ${q("_xecms_plugin_migrations")}`)).rows).toEqual([{ checksum: failure === "migration-drift" ? "drifted" : "probe-v1" }]);
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
