import { randomUUID } from "node:crypto";

import { minimalBackofficeManifest } from "@xecms/admin-apps";
import { PostgresDatabase, qualifiedName, quoteIdentifier } from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./config.js";
import {
  bootstrapTestOwner,
  TEST_OWNER_PASSWORD,
  TEST_OWNER_USERNAME,
} from "./integration-test-support.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const ORIGIN = "http://127.0.0.1:3198";

interface Session { readonly cookie: string; readonly csrfToken: string }

describe.runIf(RUN)("CAA-2B/2C/2D Admin App HTTP workflow, dependencies and Resource", () => {
  it("creates, validates, previews, applies, exports, revises, rolls back and archives", async () => {
    const schema = `xecms_caa2b_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 5 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "caa2b-integration-session-secret-0123456789",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/not-used-in-http-test",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      await bootstrapTestOwner(server);
      const owner = await login(server);
      await applySchema(server, owner);

      const invalid = await mutate(server, owner, "POST", "/api/admin-apps/validate", {
        manifest: { ...minimalBackofficeManifest, unknown: true },
      });
      expect(invalid.statusCode, invalid.body).toBe(422);
      expect(invalid.json().code).toBe("ADMIN_APP_MANIFEST_INVALID");

      const missingDependency = await mutate(server, owner, "POST", "/api/admin-apps/validate", {
        manifest: {
          ...minimalBackofficeManifest,
          id: "missing-dependency",
          key: "missing-dependency",
          pages: minimalBackofficeManifest.pages.map((page) => page.id === "order-list"
            ? { ...page, collectionId: "col_missing" }
            : page),
        },
      });
      expect(missingDependency.statusCode, missingDependency.body).toBe(200);
      expect(missingDependency.json().resolution.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "COLLECTION_MISSING" }),
      ]));

      const createdResponse = await mutate(server, owner, "POST", "/api/admin-apps", {
        manifest: minimalBackofficeManifest,
      });
      expect(createdResponse.statusCode, createdResponse.body).toBe(201);
      const created = createdResponse.json();
      expect(created.app).toMatchObject({ key: "backoffice", routeVersion: 1, activeRevisionId: null });
      expect(created.draft).toMatchObject({ draftVersion: 1, baseRevisionId: null });
      const appId = created.app.id as string;

      const previewResponse = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/preview`, {
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
      });
      expect(previewResponse.statusCode, previewResponse.body).toBe(200);
      const preview = previewResponse.json();
      expect(preview).toMatchObject({ diff: null, blockers: [] });
      expect(preview.dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "schema-revision" }),
        expect.objectContaining({ kind: "authorization-policy", id: "rlm_system" }),
        expect.objectContaining({ kind: "realm", id: "rlm_system" }),
        expect.objectContaining({ kind: "collection", id: "col_orders" }),
        expect.objectContaining({ kind: "component", id: "cmp_workspace_identity" }),
        expect.objectContaining({ kind: "permission", metadata: expect.objectContaining({ action: "content.create" }) }),
        expect.objectContaining({ kind: "resource", id: "resource:collection:col_orders" }),
        expect.objectContaining({ kind: "action", id: "core.action.create" }),
      ]));

      const stalePlan = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/apply`, {
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
        planId: "admin_app_plan_stale",
      });
      expect(stalePlan.statusCode, stalePlan.body).toBe(409);
      expect(stalePlan.json().code).toBe("ADMIN_APP_PLAN_STALE");

      const firstApply = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/apply`, {
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
        planId: preview.planId,
      });
      expect(firstApply.statusCode, firstApply.body).toBe(200);
      const first = firstApply.json();
      expect(first.app).toMatchObject({ routeVersion: 2, activeRevisionId: first.revision.id });
      expect(first.revision).toMatchObject({ sequence: 1, parentRevisionId: null });
      const appResource = await database.pool.query<{
        realm_id: string; resource_type: string; parent_id: string; protected: boolean;
      }>(
        `SELECT realm_id, resource_type, parent_id, protected
           FROM ${qualifiedName(schema, "_xecms_auth_resources")} WHERE id = $1`,
        [`resource:admin-app:${appId}`],
      );
      expect(appResource.rows[0]).toEqual({
        realm_id: "rlm_system",
        resource_type: "admin-app",
        parent_id: "resource:workspace",
        protected: true,
      });
      const healthy = await get(server, owner, `/api/admin-apps/${appId}/health`);
      expect(healthy.statusCode, healthy.body).toBe(200);
      expect(healthy.json()).toMatchObject({
        activeRevisionId: first.revision.id,
        state: "healthy",
        blockers: [],
      });
      const anonymousRuntime = await server.app.inject({
        method: "GET",
        url: "/api/admin-apps/runtime/backoffice",
      });
      expect(anonymousRuntime.statusCode).toBe(401);
      expect(anonymousRuntime.body).not.toContain("col_orders");
      const runtime = await get(server, owner, "/api/admin-apps/runtime/backoffice");
      expect(runtime.statusCode, runtime.body).toBe(200);
      expect(runtime.json()).toMatchObject({
        app: { id: appId, key: "backoffice", status: "active" },
        revisionId: first.revision.id,
        manifest: { id: "backoffice", startPageId: "overview" },
        schema: {
          collections: expect.arrayContaining([expect.objectContaining({ id: "col_orders" })]),
        },
        user: { displayName: TEST_OWNER_USERNAME, realmId: "rlm_system" },
        access: { appAllowed: true },
        dependencyHealth: { healthy: true },
      });
      expect(runtime.json().access.pages).toMatchObject({
        "order-list": true,
        "order-create": true,
        "order-detail": true,
      });
      const refreshedAccess = await mutate(
        server,
        owner,
        "POST",
        "/api/admin-apps/runtime/backoffice/access",
        {},
      );
      expect(refreshedAccess.statusCode, refreshedAccess.body).toBe(200);
      expect(refreshedAccess.json().access.policyRevision).toBe(
        runtime.json().access.policyRevision,
      );

      const exported = await get(server, owner, `/api/admin-apps/${appId}/export`);
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.json()).toMatchObject({
        format: "xecms.admin-app-export",
        formatVersion: 1,
        revisionId: first.revision.id,
        hash: first.revision.manifestHash,
      });

      const imported = await mutate(server, owner, "PUT", "/api/admin-apps/import", {
        appId,
        expectedRouteVersion: 2,
        expectedDraftVersion: null,
        expectedBaseRevisionId: first.revision.id,
        manifest: exported.json().manifest,
      });
      expect(imported.statusCode, imported.body).toBe(200);
      expect(imported.json().draft).toMatchObject({
        baseRevisionId: first.revision.id,
        manifestHash: exported.json().hash,
      });
      const discardedImport = await mutate(
        server,
        owner,
        "DELETE",
        `/api/admin-apps/${appId}/draft`,
        { expectedDraftVersion: imported.json().draft.draftVersion },
      );
      expect(discardedImport.statusCode, discardedImport.body).toBe(204);

      const draftResponse = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/draft`, {
        expectedRouteVersion: 2,
      });
      expect(draftResponse.statusCode, draftResponse.body).toBe(201);
      const draft = draftResponse.json();
      const revisedManifest = {
        ...minimalBackofficeManifest,
        key: "operations",
        name: "Operations",
      };
      const savedResponse = await mutate(server, owner, "PUT", `/api/admin-apps/${appId}/draft`, {
        expectedDraftVersion: draft.draftVersion,
        expectedBaseRevisionId: first.revision.id,
        manifest: revisedManifest,
      });
      expect(savedResponse.statusCode, savedResponse.body).toBe(200);
      const saved = savedResponse.json();
      expect(saved).toMatchObject({ desiredKey: "operations", draftVersion: 2 });

      const secondPreview = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/preview`, {
        expectedActiveRevisionId: first.revision.id,
        expectedRouteVersion: 2,
        expectedDraftVersion: saved.draftVersion,
      });
      expect(secondPreview.statusCode, secondPreview.body).toBe(200);
      expect(secondPreview.json().diff).toMatchObject({ changed: true });
      const secondApply = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/apply`, {
        expectedActiveRevisionId: first.revision.id,
        expectedRouteVersion: 2,
        expectedDraftVersion: saved.draftVersion,
        planId: secondPreview.json().planId,
      });
      expect(secondApply.statusCode, secondApply.body).toBe(200);
      const second = secondApply.json();
      expect(second.app).toMatchObject({ key: "operations", routeVersion: 3 });
      expect(second.revision).toMatchObject({ sequence: 2, parentRevisionId: first.revision.id });

      const history = await get(server, owner, `/api/admin-apps/${appId}/revisions`);
      expect(history.statusCode, history.body).toBe(200);
      expect(history.json().items.map((item: { id: string }) => item.id)).toEqual([
        second.revision.id,
        first.revision.id,
      ]);

      const rollback = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/rollback`, {
        targetRevisionId: first.revision.id,
        expectedActiveRevisionId: second.revision.id,
        expectedRouteVersion: 3,
      });
      expect(rollback.statusCode, rollback.body).toBe(200);
      expect(rollback.json().app).toMatchObject({ key: "backoffice", routeVersion: 4 });

      const wrongPassword = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/archive`, {
        expectedRouteVersion: 4,
        currentPassword: "wrong-password",
      });
      expect(wrongPassword.statusCode).toBe(401);
      const archived = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/archive`, {
        expectedRouteVersion: 4,
        currentPassword: TEST_OWNER_PASSWORD,
      });
      expect(archived.statusCode, archived.body).toBe(200);
      expect(archived.json()).toMatchObject({ status: "archived", routeVersion: 5 });
      // Archive retains the protected Resource and its Bindings for a later
      // reactivation; the Runtime status gate (CAA-3) prevents App access.
      expect((await database.pool.query(
        `SELECT 1 FROM ${qualifiedName(schema, "_xecms_auth_resources")} WHERE id = $1`,
        [`resource:admin-app:${appId}`],
      )).rowCount).toBe(1);
      expect((await get(server, owner, "/api/admin-apps")).json().items).toEqual([]);
      const archivedRuntime = await get(server, owner, "/api/admin-apps/runtime/backoffice");
      expect(archivedRuntime.statusCode).toBe(404);
      expect(archivedRuntime.body).not.toContain("col_orders");
      expect((await get(server, owner, "/api/admin-apps?includeArchived=true")).json().items)
        .toEqual([expect.objectContaining({ id: appId, status: "archived" })]);

      const deleteApplied = await mutate(server, owner, "DELETE", `/api/admin-apps/${appId}`, {
        expectedRouteVersion: 5,
        currentPassword: TEST_OWNER_PASSWORD,
      });
      expect(deleteApplied.statusCode, deleteApplied.body).toBe(409);
      expect(deleteApplied.json().code).toBe("ADMIN_APP_DELETE_REQUIRES_ARCHIVE");

      const disposable = await mutate(server, owner, "POST", "/api/admin-apps", {
        manifest: { ...minimalBackofficeManifest, id: "disposable", key: "disposable", name: "Disposable" },
      });
      const deleted = await mutate(server, owner, "DELETE", `/api/admin-apps/${disposable.json().app.id}`, {
        expectedRouteVersion: 1,
        currentPassword: TEST_OWNER_PASSWORD,
      });
      expect(deleted.statusCode, deleted.body).toBe(204);
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  }, 45_000);
});

async function login(server: XeCmsServer): Promise<Session> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { username: TEST_OWNER_USERNAME, password: TEST_OWNER_PASSWORD },
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
      collections: [
        {
          id: "col_orders",
          name: "orders",
          label: "Orders",
          fields: [
            { id: "fld_order_number", name: "orderNumber", label: "Order number", type: "text", required: true },
            { id: "fld_customer_name", name: "customerName", label: "Customer", type: "text", required: true },
          ],
        },
        {
          id: "col_workspace_settings",
          name: "workspaceSettings",
          label: "Workspace settings",
          fields: [
            {
              id: "fld_workspace_name",
              name: "workspaceName",
              label: "Workspace name",
              type: "component",
              componentId: "cmp_workspace_identity",
            },
          ],
        },
      ],
      components: [{
        id: "cmp_workspace_identity",
        name: "workspaceIdentity",
        label: "Workspace identity",
        fields: [{ id: "fld_workspace_title", name: "title", label: "Title", type: "text", required: true }],
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
