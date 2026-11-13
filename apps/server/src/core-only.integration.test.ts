import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresDatabase, quoteIdentifier } from "@xecms/database";
import { ApplicationError } from "@xecms/application";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";
import { buildServer, DEFAULT_PLUGIN_MODULES, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const databaseUrl = process.env["XECMS_TEST_DATABASE_URL"] ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("core-only server", () => {
  it("boots, authenticates and stays ready without a builder or example Plugin", async () => {
    const schema = `xecms_core_only_${randomUUID().replaceAll("-", "")}`;
    const storage = await mkdtemp(join(tmpdir(), "xecms-core-only-"));
    const database = new PostgresDatabase({ connectionString: databaseUrl, schema });
    let server: XeCmsServer | undefined;
    try {
      expect(DEFAULT_PLUGIN_MODULES).toEqual([]);
      server = await buildServer({ database, logger: false, config: loadServerConfig({
        NODE_ENV: "test", DATABASE_URL: databaseUrl, XECMS_DB_SCHEMA: schema,
        XECMS_SESSION_SECRET: "core-only-test-session-secret-0123456789",
        XECMS_ADMIN_DIST: "/unused", XECMS_MEDIA_STORAGE_ROOT: storage, XECMS_WORKER_ENABLED: "false",
      }) });
      expect((await server.app.inject("/api/ready")).statusCode).toBe(200);
      expect((await server.app.inject("/api/admin-apps")).statusCode).toBe(404);
      expect((await server.app.inject("/apps/example")).statusCode).toBe(404);
      const owner = await server.app.inject({ method: "POST", url: "/api/bootstrap",
        payload: { username: "owner", password: "Core-Only-Owner-2026!" } });
      expect(owner.statusCode, owner.body).toBe(201);
      const cookie = String(owner.headers["set-cookie"]).split(";", 1)[0]!;
      expect((await server.app.inject({ url: "/api/extensions", headers: { cookie } })).json()).toEqual({ items: [] });
      expect((await server.app.inject({ url: "/api/plugins/catalog", headers: { cookie } })).json()).toEqual({ items: [] });
      expect((await server.app.inject({ url: "/api/auth/session", headers: { cookie } })).json().user.username).toBe("owner");
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await database.close();
      await rm(storage, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps the engine error contract when a selected extension mounts a separate Admin SPA", async () => {
    const schema = `xecms_extension_error_${randomUUID().replaceAll("-", "")}`;
    const storage = await mkdtemp(join(tmpdir(), "xecms-extension-error-"));
    await writeFile(join(storage, "index.html"), "<h1>Probe</h1>");
    const database = new PostgresDatabase({ connectionString: databaseUrl, schema });
    let server: XeCmsServer | undefined;
    const audience = { type: "content-realm", realmId: "realm-probe", realmKey: "probe", name: "Probe" };
    try {
      server = await buildServer({ database, logger: false, config: loadServerConfig({
        NODE_ENV: "test", DATABASE_URL: databaseUrl, XECMS_DB_SCHEMA: schema,
        XECMS_SESSION_SECRET: "extension-error-test-session-secret-0123456789",
        XECMS_ADMIN_DIST: "/unused", XECMS_MEDIA_STORAGE_ROOT: join(storage, "media"), XECMS_WORKER_ENABLED: "false",
      }), extensions: [{ id: "probe", name: "Probe", register({ app }) {
        app.get("/api/probe", () => {
          throw new ApplicationError("EXTENSION_ACCESS_DENIED", 403, "Access denied.", { details: { audience } });
        });
      }, admin: { distDirectory: storage, assetPrefix: "/extensions/probe/", spaRoutes: ["/probe"], href: "/probe", label: "Probe" } }] });
      const response = await server.app.inject("/api/probe");
      expect(response.statusCode).toBe(403);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json()).toMatchObject({ code: "EXTENSION_ACCESS_DENIED", details: { audience }, requestId: expect.any(String) });
      const anonymous = await server.app.inject("/api/extensions");
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.headers["content-type"]).toContain("application/problem+json");
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await database.close();
      await rm(storage, { recursive: true, force: true });
    }
  }, 30_000);
});
