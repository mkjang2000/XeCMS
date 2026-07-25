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
        overview: true,
        "order-list": true,
        "order-create": true,
        "order-detail": true,
      });
      expect(runtime.json().access.pageUnmasked).toMatchObject({
        overview: true,
        "order-list": true,
      });
      expect(runtime.json().access.actions).toMatchObject({
        "overview:core.action.create": true,
        "order-list:core.action.update": true,
        "order-list:core.action.archive": true,
        "order-list:core.action.export": true,
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

  it("masks Schema-sensitive Document fields on the Admin App runtime tree", async () => {
    const schema = `xecms_caa2m_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 5 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "caa2m-integration-session-secret-0123456789",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/not-used-in-http-test",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      await bootstrapTestOwner(server);
      const owner = await login(server);
      await applyMaskingSchema(server, owner);

      const created = await mutate(server, owner, "POST", "/api/collections/col_people/documents", {
        data: { fullName: "Alice Kim", email: "alice@example.com" },
        hierarchy: { parentId: null, position: 0, expectedVersion: 0 },
      });
      expect(created.statusCode, created.body).toBe(201);

      const manifest = {
        ...minimalBackofficeManifest,
        id: "people-app",
        key: "people",
        name: "People",
        navigation: [{ id: "people-nav", label: "People", pageId: "people-list" }],
        startPageId: "people-list",
        pages: [{
          id: "people-list",
          type: "collection-list",
          collectionId: "col_people",
          title: "People",
          columns: [
            { id: "name-col", field: { kind: "data", fieldId: "fld_full_name" }, label: "Name" },
            { id: "email-col", field: { kind: "data", fieldId: "fld_email" }, label: "Email" },
          ],
          defaultSort: [{ field: { kind: "system", field: "updatedAt" }, direction: "desc" }],
        }],
      };
      const appResponse = await mutate(server, owner, "POST", "/api/admin-apps", { manifest });
      expect(appResponse.statusCode, appResponse.body).toBe(201);
      const appId = appResponse.json().app.id as string;
      const preview = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/preview`, {
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
      });
      const applied = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/apply`, {
        planId: preview.json().planId,
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
      });
      expect(applied.statusCode, applied.body).toBe(200);

      const tree = await get(server, owner, "/api/admin-apps/runtime/people/collections/col_people/tree");
      expect(tree.statusCode, tree.body).toBe(200);
      const node = tree.json().items[0];
      // The sensitive email is masked at the response boundary; the plain field is untouched.
      expect(node.document.data.fullName).toBe("Alice Kim");
      expect(node.document.data.email).toBe("a****@e******.com");
      // The original must never appear anywhere in the response body.
      expect(tree.body).not.toContain("alice@example.com");
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  }, 45_000);

  it("stores and serves a V2 Composed Page manifest end-to-end", async () => {
    const schema = `xecms_caa2v2_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 5 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "caa2v2-integration-session-secret-0123456789",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/not-used-in-http-test",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      await bootstrapTestOwner(server);
      const owner = await login(server);
      await applyMaskingSchema(server, owner);

      const manifest = composedManifest();
      // A structurally invalid V2 manifest (overlapping components) is rejected.
      const badComponents = composedManifest();
      const badPage = (badComponents["pages"] as { components: { placement: unknown }[] }[])[0]!;
      badPage.components[1]!.placement = { x: 0, y: 0, width: 16, height: 5 };
      const invalid = await mutate(server, owner, "POST", "/api/admin-apps", { manifest: badComponents });
      expect(invalid.statusCode, invalid.body).toBe(422);

      const created = await mutate(server, owner, "POST", "/api/admin-apps", { manifest });
      expect(created.statusCode, created.body).toBe(201);
      const appId = created.json().app.id as string;
      expect(created.json().draft.manifest.formatVersion).toBe(2);

      const preview = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/preview`, {
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
      });
      expect(preview.statusCode, preview.body).toBe(200);
      const applied = await mutate(server, owner, "POST", `/api/admin-apps/${appId}/apply`, {
        planId: preview.json().planId,
        expectedActiveRevisionId: null,
        expectedRouteVersion: 1,
        expectedDraftVersion: 1,
      });
      expect(applied.statusCode, applied.body).toBe(200);

      const runtime = await get(server, owner, "/api/admin-apps/runtime/opsv2");
      expect(runtime.statusCode, runtime.body).toBe(200);
      expect(runtime.json().manifest.formatVersion).toBe(2);
      expect(runtime.json().manifest.pages[0].type).toBe("composed-page");
      expect(runtime.json().manifest.pages[0].screenNo).toBe("PPL-001");
      expect(runtime.json().access.pages["pg_people"]).toBe(true);

      // CPB-4: create documents, then run the Composed Page Data Source query.
      const people = [
        { fullName: "Alice Kim", email: "alice@example.com", age: 30 },
        { fullName: "Bob Lee", email: "bob@example.com", age: 40 },
      ];
      for (let index = 0; index < people.length; index += 1) {
        const created = await mutate(server, owner, "POST", "/api/collections/col_people/documents", {
          data: people[index], hierarchy: { parentId: null, position: index, expectedVersion: index },
        });
        expect(created.statusCode, created.body).toBe(201);
      }

      const queryUrl = "/api/admin-apps/runtime/opsv2/pages/pg_people/data-sources/query_people/query";
      const filtered = await mutate(server, owner, "POST", queryUrl, { parameters: { param_name: "Alice" } });
      expect(filtered.statusCode, filtered.body).toBe(200);
      const rows = filtered.json().items as { id: string; data: Record<string, unknown> }[];
      // The parameter filtered to Alice only, and the sensitive email is masked.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data["fullName"]).toBe("Alice Kim");
      expect(rows[0]!.data["email"]).toBe("a****@e******.com");
      expect(filtered.body).not.toContain("alice@example.com");

      // An empty parameter matches all (contains "" ), still masked.
      const all = await mutate(server, owner, "POST", queryUrl, { parameters: { param_name: "" } });
      expect((all.json().items as unknown[]).length).toBe(2);
      expect(all.body).not.toContain("bob@example.com");

      // Unknown data source fails closed.
      const missing = await mutate(server, owner, "POST",
        "/api/admin-apps/runtime/opsv2/pages/pg_people/data-sources/nope/query", { parameters: {} });
      expect(missing.statusCode).toBe(404);

      // CPB-5: detail read for a selected document id, masked like the list.
      const aliceId = rows[0]!.id as string;
      const detailUrl = "/api/admin-apps/runtime/opsv2/pages/pg_people/components/cmp_detail/document";
      const detail = await mutate(server, owner, "POST", detailUrl, { documentId: aliceId, collectionId: "col_people" });
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json().data["fullName"]).toBe("Alice Kim");
      expect(detail.json().data["email"]).toBe("a****@e******.com");
      expect(detail.body).not.toContain("alice@example.com");

      // A non-detail component or unknown page/component fails closed (404).
      const badComponent = await mutate(server, owner, "POST",
        "/api/admin-apps/runtime/opsv2/pages/pg_people/components/cmp_search/document",
        { documentId: aliceId, collectionId: "col_people" });
      expect(badComponent.statusCode).toBe(404);

      // CPB-6 adaptive: the "age" variant filters by number; only its parameter is sent.
      const byAge = await mutate(server, owner, "POST", queryUrl, { parameters: { param_age: 40 } });
      const ageRows = byAge.json().items as { data: Record<string, unknown> }[];
      expect(ageRows).toHaveLength(1);
      expect(ageRows[0]!.data["fullName"]).toBe("Bob Lee");

      // Leak prevention: sending the previous variant's value alongside is fine —
      // but sending ONLY param_age must not carry any name filter. And an
      // undeclared parameter is ignored (no runtime-assembled query path).
      const leak = await mutate(server, owner, "POST", queryUrl, {
        parameters: { param_age: 40, param_name: "", fld_email: "x", injected: "y" },
      });
      const leakRows = leak.json().items as { data: Record<string, unknown> }[];
      // Empty param_name → name condition dropped; only age=40 applies → Bob only.
      expect(leakRows.map((r) => r.data["fullName"])).toEqual(["Bob Lee"]);

      // Both parameters empty → both conditions dropped → no filter → all rows.
      const noFilter = await mutate(server, owner, "POST", queryUrl, { parameters: { param_name: "", param_age: "" } });
      expect((noFilter.json().items as unknown[]).length).toBe(2);

      // CPB-7: the Composed Page's delete Action is gated by the server access
      // profile. The owner holds content.delete on col_people, so the gate is
      // open — this is the boolean the runtime uses to enable the button.
      expect(runtime.json().access.actions["pg_people:core.action.delete"]).toBe(true);

      // The Manifest cannot forge authorization: the delete effect is only a UI
      // trigger, and the real mutation goes through the content API, which
      // re-checks content.delete. Fail-closed proof: a delete with the wrong
      // version is rejected at the content boundary (runtime cannot bypass it).
      const bobId = (all.json().items as { id: string; data: Record<string, unknown> }[])
        .find((row) => row.data["fullName"] === "Bob Lee")!.id;
      const staleDelete = await mutate(server, owner, "DELETE",
        `/api/collections/col_people/documents/${bobId}`, { expectedVersion: 999 });
      expect(staleDelete.statusCode, staleDelete.body).not.toBe(204);
      // The document still exists after the rejected delete.
      const stillThere = await mutate(server, owner, "POST", queryUrl, { parameters: { param_age: 40 } });
      expect((stillThere.json().items as unknown[]).length).toBe(1);

      // The effect chain's real path: read the current version, then delete it.
      const fresh = await get(server, owner, `/api/collections/col_people/documents/${bobId}`);
      expect(fresh.statusCode, fresh.body).toBe(200);
      const deleted = await mutate(server, owner, "DELETE",
        `/api/collections/col_people/documents/${bobId}`, { expectedVersion: fresh.json().version });
      expect(deleted.statusCode, deleted.body).toBe(204);
      // The list Data Source re-run (the fx_refresh effect) now returns one fewer row.
      const afterDelete = await mutate(server, owner, "POST", queryUrl, { parameters: { param_name: "" } });
      expect((afterDelete.json().items as unknown[]).length).toBe(1);

      // CPB-7 슬라이스 2: create/update Actions are gated the same way. The owner
      // holds content.create/content.update on col_people, so both gates are open.
      expect(runtime.json().access.actions["pg_people:core.action.create"]).toBe(true);
      expect(runtime.json().access.actions["pg_people:core.action.update"]).toBe(true);

      // The create Action's real path: the form data goes through the content
      // API, which enforces content.create (and required fields).
      const createdByAction = await mutate(server, owner, "POST", "/api/collections/col_people/documents", {
        data: { fullName: "Cara Park", email: "cara@example.com" },
      });
      expect(createdByAction.statusCode, createdByAction.body).toBe(201);
      const caraId = createdByAction.json().id as string;
      // The list now includes the created document (masked email like the rest).
      const afterCreate = await mutate(server, owner, "POST", queryUrl, { parameters: { param_name: "Cara" } });
      const caraRows = afterCreate.json().items as { data: Record<string, unknown> }[];
      expect(caraRows).toHaveLength(1);
      expect(caraRows[0]!.data["fullName"]).toBe("Cara Park");
      expect(afterCreate.body).not.toContain("cara@example.com");

      // The update Action's real path: re-read version, then patch. A stale
      // version fails closed at the content boundary (runtime cannot bypass it).
      const caraFresh = await get(server, owner, `/api/collections/col_people/documents/${caraId}`);
      const staleUpdate = await mutate(server, owner, "PATCH", `/api/collections/col_people/documents/${caraId}`, {
        data: { fullName: "Cara Kim", email: "cara@example.com" }, expectedVersion: 999,
      });
      expect(staleUpdate.statusCode, staleUpdate.body).not.toBe(200);
      const updated = await mutate(server, owner, "PATCH", `/api/collections/col_people/documents/${caraId}`, {
        data: { fullName: "Cara Kim", email: "cara@example.com" }, expectedVersion: caraFresh.json().version,
      });
      expect(updated.statusCode, updated.body).toBe(200);
      const afterUpdate = await mutate(server, owner, "POST", queryUrl, { parameters: { param_name: "Cara" } });
      expect((afterUpdate.json().items as { data: Record<string, unknown> }[])[0]!.data["fullName"]).toBe("Cara Kim");
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  }, 45_000);
});

function composedManifest(): Record<string, unknown> {
  return {
    format: "xecms.admin-app",
    formatVersion: 2,
    id: "opsv2",
    name: "Operations V2",
    key: "opsv2",
    audience: { type: "system" },
    presentation: { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" },
    navigation: [{ id: "nav_people", label: "People", pageId: "pg_people" }],
    pages: [{
      id: "pg_people",
      type: "composed-page",
      screenNo: "PPL-001",
      title: "People",
      menuLabel: "People",
      layout: { columns: 48, rowHeight: 8 },
      state: [
        { id: "state_name", valueType: "string", initialValue: "" },
        { id: "state_selected", valueType: "document-id", initialValue: null },
      ],
      dataSources: [{
        id: "query_people",
        type: "document-query",
        collectionId: "col_people",
        trigger: "manual",
        fields: ["fld_full_name", "fld_email", "fld_age"],
        parameters: [
          { id: "param_name", valueType: "string" },
          { id: "param_age", valueType: "number" },
        ],
        // Adaptive filter: name (text) OR age (number). Only the active variant's
        // parameter is filled at runtime; the other condition is dropped.
        filter: {
          type: "group",
          operator: "or",
          filters: [
            {
              type: "condition",
              field: { kind: "data", fieldId: "fld_full_name" },
              operator: "contains",
              value: { type: "parameter", parameterId: "param_name" },
            },
            {
              type: "condition",
              field: { kind: "data", fieldId: "fld_age" },
              operator: "eq",
              value: { type: "parameter", parameterId: "param_age" },
            },
          ],
        },
        limit: 20,
      }],
      components: [
        {
          id: "cmp_name",
          kind: "core.input.text",
          placement: { x: 0, y: 0, width: 16, height: 5 },
          props: { label: "이름" },
        },
        {
          id: "cmp_search",
          kind: "core.button",
          placement: { x: 17, y: 0, width: 5, height: 5 },
          props: { label: "조회" },
        },
        {
          id: "cmp_delete",
          kind: "core.button",
          placement: { x: 23, y: 0, width: 5, height: 5 },
          props: { label: "삭제" },
          // CPB-7: an onClick chain that deletes the selected document, then
          // re-runs the list query. The delete Action is gated by the server
          // access profile and re-checked by the content API.
          events: [{
            id: "evt_delete",
            event: "onClick",
            effects: [
              {
                id: "fx_delete",
                kind: "action.execute",
                args: { actionId: "core.action.delete", collectionId: "col_people", documentStateId: "state_selected" },
              },
              { id: "fx_refresh", kind: "data-source.execute", args: { dataSourceId: "query_people" } },
            ],
          }],
        },
        {
          id: "cmp_detail",
          kind: "core.output.detail",
          placement: { x: 0, y: 7, width: 20, height: 20 },
          props: {
            collectionId: "col_people",
            fields: [
              { fieldId: "fld_full_name", protection: { mode: "normal" } },
              { fieldId: "fld_email", protection: { mode: "mask-when-required", maskPolicyId: "core.mask.email" } },
            ],
          },
        },
        {
          id: "cmp_form",
          kind: "core.form",
          placement: { x: 21, y: 7, width: 20, height: 20 },
          props: {
            collectionId: "col_people",
            label: "사람 입력",
            fields: [
              { fieldId: "fld_full_name", inputKind: "text" },
              { fieldId: "fld_email", inputKind: "text" },
            ],
          },
        },
        {
          id: "cmp_create",
          kind: "core.button",
          placement: { x: 29, y: 0, width: 5, height: 5 },
          props: { label: "생성" },
          events: [{
            id: "evt_create",
            event: "onClick",
            effects: [
              { id: "fx_create", kind: "action.execute", args: { actionId: "core.action.create", collectionId: "col_people", formComponentId: "cmp_form" } },
              { id: "fx_refresh2", kind: "data-source.execute", args: { dataSourceId: "query_people" } },
            ],
          }],
        },
        {
          id: "cmp_update",
          kind: "core.button",
          placement: { x: 35, y: 0, width: 5, height: 5 },
          props: { label: "수정" },
          events: [{
            id: "evt_update",
            event: "onClick",
            effects: [
              { id: "fx_update", kind: "action.execute", args: { actionId: "core.action.update", collectionId: "col_people", formComponentId: "cmp_form", documentStateId: "state_selected" } },
            ],
          }],
        },
      ],
      connections: [
        {
          id: "conn_name_state",
          from: { nodeType: "component", nodeId: "cmp_name", portId: "value" },
          to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        },
        {
          id: "conn_selected_detail",
          from: { nodeType: "state", nodeId: "state_selected", portId: "value" },
          to: { nodeType: "component", nodeId: "cmp_detail", portId: "documentId" },
        },
      ],
    }],
    startPageId: "pg_people",
  };
}

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

async function applyMaskingSchema(server: XeCmsServer, session: Session): Promise<void> {
  const imported = await mutate(server, session, "PUT", "/api/schema/manifest", {
    baseRevisionId: null,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [{
        id: "col_people",
        name: "people",
        label: "People",
        hierarchy: { enabled: true },
        fields: [
          { id: "fld_full_name", name: "fullName", label: "Name", type: "text", required: true },
          { id: "fld_age", name: "age", label: "Age", type: "number", required: false },
          {
            id: "fld_email",
            name: "email",
            label: "Email",
            type: "text",
            required: true,
            sensitivity: { classification: "sensitive", defaultMaskPolicyId: "core.mask.email" },
          },
        ],
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
