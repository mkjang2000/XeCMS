import { randomUUID } from "node:crypto";
import { PostgresDatabase, quoteIdentifier } from "@xecms/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("initial setup template", () => {
  const schemaName = `xecms_setup_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
  let server: XeCmsServer;
  let cookie = "";
  let csrfToken = "";

  beforeAll(async () => {
    server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "test",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "setup-template-integration-secret-2026",
        XECMS_ADMIN_DIST: "/not-used",
        XECMS_WORKER_ENABLED: "false",
      }),
    });
  });

  afterAll(async () => {
    await server?.app.close();
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    await database.close();
  });

  it("resumes after owner creation and applies a customized starter exactly once", async () => {
    expect((await server.app.inject({ method: "GET", url: "/api/bootstrap/status" })).json())
      .toEqual({ required: true, templateRequired: true });

    const bootstrap = await server.app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: { username: "setup-owner", password: "Strong-Setup-Password-2026!" },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(201);
    cookie = String(bootstrap.headers["set-cookie"]).split(";", 1)[0] ?? "";
    csrfToken = bootstrap.json().csrfToken as string;
    expect((await server.app.inject({ method: "GET", url: "/api/bootstrap/status" })).json())
      .toEqual({ required: false, templateRequired: true });

    const missingCsrf = await server.app.inject({
      method: "POST",
      url: "/api/setup/template",
      headers: { cookie },
      payload: { starter: "minimal", enabledModuleIds: [], collectionLabels: {} },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const applied = await server.app.inject({
      method: "POST",
      url: "/api/setup/template",
      headers: { cookie, "x-csrf-token": csrfToken },
      payload: {
        starter: "blog",
        enabledModuleIds: ["pages"],
        collectionLabels: { col_blog_posts: "Articles", col_blog_pages: "Information" },
      },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().schema.collections.map((collection: { id: string; label: string }) => [collection.id, collection.label]))
      .toEqual([["col_blog_posts", "Articles"], ["col_blog_pages", "Information"]]);
    expect(applied.json().schema.collections[0].fields.some((field: { id: string }) => field.id === "fld_blog_post_category"))
      .toBe(false);
    expect((await server.app.inject({ method: "GET", url: "/api/bootstrap/status" })).json())
      .toEqual({ required: false, templateRequired: false });

    const session = await server.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    expect(session.json().schema.revisionId).toBe(applied.json().revisionId);

    const duplicate = await server.app.inject({
      method: "POST",
      url: "/api/setup/template",
      headers: { cookie, "x-csrf-token": csrfToken },
      payload: { starter: "minimal", enabledModuleIds: [], collectionLabels: {} },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("SETUP_ALREADY_COMPLETED");
  });
});

describe.runIf(RUN)("community setup template", () => {
  const schemaName = `xecms_setup_community_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
  let server: XeCmsServer;

  beforeAll(async () => {
    server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "test",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "community-setup-template-integration-secret-2026",
        XECMS_ADMIN_DIST: "/not-used",
        XECMS_WORKER_ENABLED: "false",
      }),
    });
  });

  afterAll(async () => {
    await server?.app.close();
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    await database.close();
  });

  it("provisions the content realm required by the community starter", async () => {
    const bootstrap = await server.app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: { username: "community-owner", password: "Strong-Community-Password-2026!" },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(201);
    const cookie = String(bootstrap.headers["set-cookie"]).split(";", 1)[0] ?? "";
    const csrfToken = bootstrap.json().csrfToken as string;

    const applied = await server.app.inject({
      method: "POST",
      url: "/api/setup/template",
      headers: { cookie, "x-csrf-token": csrfToken },
      payload: {
        starter: "community",
        enabledModuleIds: ["posts"],
        collectionLabels: {},
      },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().schema.collections.map((collection: { id: string }) => collection.id))
      .toEqual(["col_community_members", "col_community_posts"]);

    const realms = await server.app.inject({
      method: "GET",
      url: "/api/identity-realms",
      headers: { cookie },
    });
    expect(realms.statusCode, realms.body).toBe(200);
    expect(realms.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ realmKey: "community", status: "active" }),
    ]));
  });
});
