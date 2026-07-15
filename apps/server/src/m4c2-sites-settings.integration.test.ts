import { randomUUID } from "node:crypto";

import { PostgresDatabase, quoteIdentifier } from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import { loadServerConfig, type ServerConfig } from "./config.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const ORIGIN = "http://127.0.0.1:3198";

interface Session { readonly cookie: string; readonly csrfToken: string }
interface Site {
  readonly siteId: string; readonly revision: number; readonly isDefault: boolean;
  readonly status: "active" | "archived"; readonly collectionIds: readonly string[];
}

describe.runIf(RUN)("M4-C2 Sites and settings HTTP acceptance", () => {
  it("enforces diagnostics masking, CAS, reauth, Site scope, archive locks and Schema mode", async () => {
    const schema = `xecms_m4c2_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 5 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "m4c2-integration-session-secret-0123456789",
      XECMS_DEV_SEED: "true",
      XECMS_DEV_ADMIN_USERNAME: "admin",
      XECMS_DEV_ADMIN_PASSWORD: "admin",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/not-used-in-http-test",
      XECMS_SCHEMA_MODE: "editable",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      const owner = await login(server);

      const diagnostics = await get(server, owner, "/api/system/diagnostics");
      expect(diagnostics.statusCode, diagnostics.body).toBe(200);
      expect(diagnostics.json()).toMatchObject({
        environment: "development", schemaMode: "editable", storageAdapter: "local",
      });
      expect(diagnostics.body).not.toContain(DATABASE_URL);
      expect(diagnostics.body).not.toContain(config.sessionSecret);
      expect(diagnostics.body).not.toContain(config.adminDist);
      expect(diagnostics.body).not.toContain(ORIGIN);

      const workspace = await get(server, owner, "/api/workspace/settings");
      expect(workspace.statusCode, workspace.body).toBe(200);
      const invalidPassword = await mutate(server, owner, "PATCH", "/api/workspace/settings", {
        expectedRevision: workspace.json().revision,
        displayName: "C2 Workspace",
        defaultTimezone: "Asia/Seoul",
        adminLocale: "ko-KR",
        currentPassword: "wrong-password",
      });
      expect(invalidPassword.statusCode).toBe(401);
      const updatedWorkspace = await mutate(server, owner, "PATCH", "/api/workspace/settings", {
        expectedRevision: workspace.json().revision,
        displayName: "C2 Workspace",
        defaultTimezone: "Asia/Seoul",
        adminLocale: "ko-KR",
        currentPassword: "admin",
      });
      expect(updatedWorkspace.statusCode, updatedWorkspace.body).toBe(200);
      expect(updatedWorkspace.json()).toMatchObject({ displayName: "C2 Workspace", revision: 2 });
      const staleWorkspace = await mutate(server, owner, "PATCH", "/api/workspace/settings", {
        expectedRevision: 1,
        displayName: "Stale Workspace",
        defaultTimezone: "UTC",
        adminLocale: "en-US",
        currentPassword: "admin",
      });
      expect(staleWorkspace.statusCode).toBe(409);
      expect(staleWorkspace.json().code).toBe("WORKSPACE_REVISION_CONFLICT");

      const primaryResponse = await mutate(server, owner, "POST", "/api/sites", {
        key: "primary-site", name: "Primary", canonicalUrl: "https://primary.example.com",
      });
      expect(primaryResponse.statusCode, primaryResponse.body).toBe(201);
      const primary = primaryResponse.json<Site>();
      expect(primary).toMatchObject({ isDefault: true, status: "active", revision: 1 });
      const secondaryResponse = await mutate(server, owner, "POST", "/api/sites", {
        key: "secondary-site", name: "Secondary",
      });
      expect(secondaryResponse.statusCode, secondaryResponse.body).toBe(201);
      let secondary = secondaryResponse.json<Site>();
      expect(secondary).toMatchObject({ isDefault: false, status: "active", revision: 1 });

      await applySchema(server, owner);
      const policy = await get(server, owner, "/api/authorization/policy");
      expect(policy.statusCode, policy.body).toBe(200);
      const bound = await mutate(
        server,
        owner,
        "PUT",
        `/api/sites/${secondary.siteId}/collections/col_c2_articles`,
        {
          expectedSiteRevision: secondary.revision,
          expectedPolicyRevision: policy.json().revision,
          currentPassword: "admin",
        },
      );
      expect(bound.statusCode, bound.body).toBe(200);
      secondary = bound.json<Site>();
      expect(secondary.collectionIds).toEqual(["col_c2_articles"]);

      await server.close();
      server = await buildServer({ database, config, logger: false });
      const restartedOwner = await login(server);
      const restartedPolicy = await get(server, restartedOwner, "/api/authorization/policy");
      expect(restartedPolicy.json().resources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "resource:collection:col_c2_articles",
          parentId: `resource:site:${secondary.siteId}`,
        }),
      ]));

      const wrongArchivePassword = await mutate(
        server,
        restartedOwner,
        "POST",
        `/api/sites/${secondary.siteId}/archive`,
        { expectedRevision: secondary.revision, currentPassword: "wrong-password" },
      );
      expect(wrongArchivePassword.statusCode).toBe(401);
      const archived = await mutate(
        server,
        restartedOwner,
        "POST",
        `/api/sites/${secondary.siteId}/archive`,
        { expectedRevision: secondary.revision, currentPassword: "admin" },
      );
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json()).toMatchObject({ status: "archived", isDefault: false });
      const writeLocked = await mutate(
        server,
        restartedOwner,
        "POST",
        "/api/collections/col_c2_articles/documents",
        { data: { title: "Must remain unwritten" } },
      );
      expect(writeLocked.statusCode, writeLocked.body).toBe(423);
      expect(writeLocked.json().code).toBe("SITE_ARCHIVED");

      const defaultArchiveWithoutReplacement = await mutate(
        server,
        restartedOwner,
        "POST",
        `/api/sites/${primary.siteId}/archive`,
        { expectedRevision: primary.revision, currentPassword: "admin" },
      );
      expect(defaultArchiveWithoutReplacement.statusCode).toBe(409);
      expect(defaultArchiveWithoutReplacement.json().code).toBe("SITE_DEFAULT_REPLACEMENT_REQUIRED");

      (config as { schemaMode: ServerConfig["schemaMode"] }).schemaMode = "locked";
      const locked = await mutate(server, restartedOwner, "POST", "/api/schema/ids", {
        kind: "collection", count: 1,
      });
      expect(locked.statusCode, locked.body).toBe(423);
      expect(locked.json().code).toBe("SCHEMA_MUTATION_LOCKED");
      const lockedDiagnostics = await get(server, restartedOwner, "/api/system/diagnostics");
      expect(lockedDiagnostics.json().schemaMode).toBe("locked");
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  }, 30_000);
});

async function login(server: XeCmsServer): Promise<Session> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { username: "admin", password: "admin" },
  });
  expect(response.statusCode, response.body).toBe(200);
  return {
    cookie: String(response.headers["set-cookie"]).split(";", 1)[0]!,
    csrfToken: response.json().csrfToken as string,
  };
}

async function applySchema(server: XeCmsServer, session: Session): Promise<void> {
  const imported = await mutate(server, session, "PUT", "/api/schema/manifest", {
    baseRevisionId: null,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [{
        id: "col_c2_articles",
        name: "articles",
        label: "Articles",
        fields: [{ id: "fld_c2_title", name: "title", label: "Title", type: "text", required: true }],
      }],
    },
  });
  expect(imported.statusCode, imported.body).toBe(200);
  const draftVersion = imported.json().draftVersion as string;
  const preview = await mutate(server, session, "POST", "/api/schema/preview", { expectedDraftVersion: draftVersion });
  expect(preview.statusCode, preview.body).toBe(200);
  const applied = await mutate(server, session, "POST", "/api/schema/apply", {
    planId: preview.json().planId,
    expectedRevisionId: null,
    expectedDraftVersion: draftVersion,
    approveDestructive: false,
  });
  expect(applied.statusCode, applied.body).toBe(200);
}

function get(server: XeCmsServer, session: Session, url: string): Promise<LightMyRequestResponse> {
  return server.app.inject({ method: "GET", url, headers: { cookie: session.cookie, origin: ORIGIN } });
}

function mutate(
  server: XeCmsServer,
  session: Session,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<LightMyRequestResponse> {
  return server.app.inject({
    method,
    url,
    headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken, origin: ORIGIN },
    payload,
  });
}
