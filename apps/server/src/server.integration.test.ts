import { randomUUID } from "node:crypto";
import {
  contentTableName,
  migrateCore,
  PostgresDatabase,
  qualifiedName,
  quoteIdentifier,
} from "@xecms/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { loadServerConfig } from "./config.js";
import {
  bootstrapTestOwner,
  TEST_OWNER_PASSWORD,
  TEST_OWNER_USERNAME,
} from "./integration-test-support.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("XeCMS M1 PostgreSQL vertical slice", () => {
  const schemaName = `xecms_test_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
  let server: XeCmsServer;
  let cookie = "";
  let csrfToken = "";
  let collectionId = "";
  let activeRevisionId = "";

  beforeAll(async () => {
    server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "test",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
      }),
    });
  });

  afterAll(async () => {
    if (server !== undefined) {
      await server.app.close();
    }
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    await database.close();
  });

  it("bootstraps exactly once with a strong password and creates a reload-safe session", async () => {
    const status = await server.app.inject({ method: "GET", url: "/api/bootstrap/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ required: true, templateRequired: true });

    const weak = await server.app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: { username: "admin", password: "admin" },
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.json().code).toBe("PASSWORD_TOO_SHORT");

    const bootstrap = await server.app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: { username: "admin", password: "Strong-Owner-Password-2026!" },
    });
    expect(bootstrap.statusCode).toBe(201);
    const setCookie = bootstrap.headers["set-cookie"];
    expect(setCookie).toBeTypeOf("string");
    cookie = String(setCookie).split(";", 1)[0] ?? "";
    csrfToken = bootstrap.json().csrfToken as string;
    expect(cookie).toContain("xecms_session=");
    expect(String(setCookie)).toContain("HttpOnly");
    expect(csrfToken.length).toBeGreaterThan(32);

    const duplicate = await server.app.inject({
      method: "POST",
      url: "/api/admin/bootstrap",
      payload: { username: "another", password: "Another-Strong-Password-2026!" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("BOOTSTRAP_ALREADY_COMPLETED");

    const session = await server.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.username).toBe("admin");
    expect(session.json().csrfToken).toBe(csrfToken);
  });

  it("enforces Origin and CSRF on public and authenticated mutations", async () => {
    const crossOriginLogin = await server.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://attacker.example" },
      payload: { username: "admin", password: "Strong-Owner-Password-2026!" },
    });
    expect(crossOriginLogin.statusCode).toBe(403);
    expect(crossOriginLogin.json().code).toBe("ORIGIN_NOT_ALLOWED");

    const missingCsrf = await server.app.inject({
      method: "POST",
      url: "/api/schema/ids",
      headers: { cookie },
      payload: { kind: "collection", count: 1 },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json().code).toBe("CSRF_TOKEN_REQUIRED");

    const wrongCsrf = await server.app.inject({
      method: "POST",
      url: "/api/schema/ids",
      headers: { cookie, "x-csrf-token": "wrong" },
      payload: { kind: "collection", count: 1 },
    });
    expect(wrongCsrf.statusCode).toBe(403);
    expect(wrongCsrf.json().code).toBe("CSRF_TOKEN_INVALID");
  });

  it("issues registry IDs, persists an optimistic draft, previews, and applies physical DDL", async () => {
    const collectionIds = await mutate("POST", "/api/schema/ids", {
      kind: "collection",
      count: 1,
    });
    const fieldIds = await mutate("POST", "/api/schema/ids", { kind: "field", count: 4 });
    collectionId = collectionIds.json().ids[0] as string;
    const [titleId, viewsId, featuredId, publishedAtId] = fieldIds.json().ids as string[];
    const manifest = {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: collectionId,
          name: "posts",
          label: "Posts",
          fields: [
            { id: titleId, name: "title", label: "Title", type: "text", required: true },
            { id: viewsId, name: "views", type: "number", required: false },
            { id: featuredId, name: "featured", type: "boolean", required: false },
            { id: publishedAtId, name: "publishedAt", type: "datetime", required: false },
          ],
        },
      ],
    };
    const draft = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: null,
      expectedDraftVersion: null,
      schema: manifest,
    });
    expect(draft.statusCode).toBe(200);
    const draftVersion = draft.json().draftVersion as string;

    const lostUpdate = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: null,
      expectedDraftVersion: "drf_stale",
      schema: manifest,
    });
    expect(lostUpdate.statusCode).toBe(409);
    expect(lostUpdate.json().code).toBe("SCHEMA_DRAFT_CONFLICT");

    const stalePreview = await mutate("POST", "/api/schema/preview", {
      expectedDraftVersion: "drf_stale",
    });
    expect(stalePreview.statusCode).toBe(409);
    expect(stalePreview.json().code).toBe("SCHEMA_DRAFT_CONFLICT");

    const preview = await mutate("POST", "/api/schema/preview", { expectedDraftVersion: draftVersion });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().operations[0].kind).toBe("create-table");
    expect(preview.json().operations[0]).not.toHaveProperty("statements");
    expect(preview.json().planId).toMatch(/^plan_/);

    const stalePlan = await mutate("POST", "/api/schema/apply", {
      planId: "plan_stale",
      expectedRevisionId: null,
      expectedDraftVersion: draftVersion,
      approveDestructive: false,
    });
    expect(stalePlan.statusCode).toBe(409);
    expect(stalePlan.json().code).toBe("SCHEMA_PLAN_STALE");

    const applied = await mutate("POST", "/api/schema/apply", {
      planId: preview.json().planId,
      expectedRevisionId: null,
      expectedDraftVersion: draftVersion,
      approveDestructive: false,
    });
    expect(applied.statusCode).toBe(200);
    activeRevisionId = applied.json().revisionId as string;

    const columns = await database.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2`,
      [schemaName, contentTableName(collectionId)],
    );
    expect(columns.rows.map(({ data_type }) => data_type)).toEqual(
      expect.arrayContaining(["text", "double precision", "boolean", "timestamp with time zone"]),
    );
  });

  it("keeps applied collection storage visible while a pending edit is overlaid", async () => {
    const active = await server.app.inject({
      method: "GET",
      url: "/api/schema",
      headers: { cookie },
    });
    const newField = await mutate("POST", "/api/schema/ids", { kind: "field", count: 1 });
    const pendingManifest = structuredClone(active.json().schema);
    pendingManifest.collections[0].name = "articles";
    pendingManifest.collections[0].fields.push({
      id: newField.json().ids[0],
      name: "summary",
      type: "text",
    });
    const draft = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: activeRevisionId,
      expectedDraftVersion: null,
      schema: pendingManifest,
    });
    expect(draft.statusCode).toBe(200);

    const collections = await server.app.inject({
      method: "GET",
      url: "/api/collections",
      headers: { cookie },
    });
    expect(collections.statusCode).toBe(200);
    expect(collections.json().items[0]).toMatchObject({
      id: collectionId,
      name: "posts",
      status: "applied",
      hasPendingChanges: true,
    });

    // Restore the active definition as a new draft version for the document tests.
    await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: activeRevisionId,
      expectedDraftVersion: draft.json().draftVersion,
      schema: active.json().schema,
    });
  });

  it("requires explicit approval for a destructive field removal without changing active schema", async () => {
    const current = await server.app.inject({ method: "GET", url: "/api/schema", headers: { cookie } });
    const existingDraft = await server.app.inject({
      method: "GET",
      url: "/api/schema/draft",
      headers: { cookie },
    });
    const destructiveManifest = structuredClone(current.json().schema);
    destructiveManifest.collections[0].fields = destructiveManifest.collections[0].fields.filter(
      ({ name }: { name: string }) => name !== "views",
    );
    const saved = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: current.json().revisionId,
      expectedDraftVersion: existingDraft.json().draftVersion,
      schema: destructiveManifest,
    });
    const preview = await mutate("POST", "/api/schema/preview", {
      expectedDraftVersion: saved.json().draftVersion,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().requiresDestructiveApproval).toBe(true);

    const rejected = await mutate("POST", "/api/schema/apply", {
      planId: preview.json().planId,
      expectedRevisionId: current.json().revisionId,
      expectedDraftVersion: saved.json().draftVersion,
      approveDestructive: false,
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe("DESTRUCTIVE_MIGRATION_APPROVAL_REQUIRED");

    const unchanged = await server.app.inject({ method: "GET", url: "/api/schema", headers: { cookie } });
    expect(unchanged.json().revisionId).toBe(current.json().revisionId);
    const restored = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: current.json().revisionId,
      expectedDraftVersion: saved.json().draftVersion,
      schema: current.json().schema,
    });
    expect(restored.statusCode).toBe(200);
  });

  it("runs document CRUD through the domain service and typed projection", async () => {
    const invalid = await mutate("POST", `/api/collections/${collectionId}/documents`, {
      data: { title: "First", publishedAt: "2026-07-15T12:30" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe("DOCUMENT_VALIDATION_FAILED");

    const created = await mutate("POST", `/api/collections/${collectionId}/documents`, {
      data: {
        title: "First post",
        views: 7.5,
        featured: true,
        publishedAt: "2026-07-15T12:30:00+09:00",
      },
    });
    expect(created.statusCode).toBe(201);
    const document = created.json();
    expect(document.version).toBe(1);
    expect(document.data.publishedAt).toBe("2026-07-15T03:30:00.000Z");

    const listed = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/documents`,
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(listed.json().items[0].data).toMatchObject({ title: "First post", featured: true });
    expect(listed.json().items[0].data.publishedAt).toBe(document.data.publishedAt);

    const activeSchema = await server.app.inject({
      method: "GET",
      url: "/api/schema",
      headers: { cookie },
    });
    const fields = activeSchema.json().schema.collections[0].fields as {
      readonly id: string;
      readonly name: string;
    }[];
    const titleFieldId = fields.find(({ name }) => name === "title")!.id;
    const viewsFieldId = fields.find(({ name }) => name === "views")!.id;
    const second = await mutate("POST", `/api/collections/${collectionId}/documents`, {
      data: { title: "Another article", views: 10, featured: false },
    });
    expect(second.statusCode).toBe(201);

    const firstQuery = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/documents/query`,
      headers: { cookie },
      payload: {
        limit: 1,
        fields: [titleFieldId],
        sort: [
          { field: { kind: "data", fieldId: viewsFieldId }, direction: "desc" },
        ],
      },
    });
    expect(firstQuery.statusCode, firstQuery.body).toBe(200);
    expect(firstQuery.json()).toMatchObject({
      hasNextPage: true,
      items: [{ id: second.json().id, data: { title: "Another article" } }],
    });
    expect(firstQuery.json().items[0].data).not.toHaveProperty("views");
    expect(firstQuery.json().nextCursor).toBeTypeOf("string");

    const secondQuery = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/documents/query`,
      headers: { cookie },
      payload: {
        limit: 1,
        cursor: firstQuery.json().nextCursor,
        fields: [titleFieldId],
        sort: [
          { field: { kind: "data", fieldId: viewsFieldId }, direction: "desc" },
        ],
      },
    });
    expect(secondQuery.statusCode, secondQuery.body).toBe(200);
    expect(secondQuery.json()).toMatchObject({
      hasNextPage: false,
      items: [{ id: document.id, data: { title: "First post" } }],
    });

    const filtered = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/documents/query`,
      headers: { cookie },
      payload: {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: titleFieldId },
          operator: "contains",
          value: "post",
        },
      },
    });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().items.map(({ id }: { readonly id: string }) => id)).toEqual([document.id]);

    const included = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/documents/query`,
      headers: { cookie },
      payload: {
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: titleFieldId },
          operator: "in",
          value: ["First post", "Missing"],
        },
      },
    });
    expect(included.statusCode, included.body).toBe(200);
    expect(included.json().items.map(({ id }: { readonly id: string }) => id)).toEqual([document.id]);

    const invalidQuery = await server.app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/documents/query`,
      headers: { cookie },
      payload: { fields: ["fld_missing"] },
    });
    expect(invalidQuery.statusCode).toBe(422);
    expect(invalidQuery.json().code).toBe("DOCUMENT_QUERY_FIELD_UNKNOWN");

    const deletedSecond = await mutate(
      "DELETE",
      `/api/collections/${collectionId}/documents/${second.json().id}`,
      { expectedVersion: 1 },
    );
    expect(deletedSecond.statusCode).toBe(204);
    const purgedSecond = await mutate(
      "DELETE",
      `/api/collections/${collectionId}/documents/${second.json().id}/purge`,
      { expectedVersion: 2 },
    );
    expect(purgedSecond.statusCode).toBe(204);

    const updated = await mutate(
      "PATCH",
      `/api/collections/${collectionId}/documents/${document.id}`,
      { data: { title: "Edited", views: 8, featured: false }, expectedVersion: 1 },
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ version: 2, data: { title: "Edited", views: 8, featured: false } });

    const stale = await mutate(
      "PATCH",
      `/api/collections/${collectionId}/documents/${document.id}`,
      { data: { title: "Stale" }, expectedVersion: 1 },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("DOCUMENT_VERSION_CONFLICT");

    const deleted = await mutate(
      "DELETE",
      `/api/collections/${collectionId}/documents/${document.id}`,
      { expectedVersion: 2 },
    );
    expect(deleted.statusCode).toBe(204);

    const afterDelete = await server.app.inject({
      method: "GET",
      url: `/api/collections/${collectionId}/documents`,
      headers: { cookie },
    });
    expect(afterDelete.json().total).toBe(0);
  });

  it("rolls failed DDL back and never records it as applied", async () => {
    const current = await server.app.inject({ method: "GET", url: "/api/schema", headers: { cookie } });
    const existingDraft = await server.app.inject({
      method: "GET",
      url: "/api/schema/draft",
      headers: { cookie },
    });
    const field = await mutate("POST", "/api/schema/ids", { kind: "field", count: 1 });
    const manifest = structuredClone(current.json().schema);
    manifest.collections[0].fields.push({
      id: field.json().ids[0],
      name: "requiredAfterData",
      type: "text",
      required: true,
    });
    const saved = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: current.json().revisionId,
      expectedDraftVersion: existingDraft.json().draftVersion,
      schema: manifest,
    });
    const preview = await mutate("POST", "/api/schema/preview", {
      expectedDraftVersion: saved.json().draftVersion,
    });
    const failed = await mutate("POST", "/api/schema/apply", {
      planId: preview.json().planId,
      expectedRevisionId: current.json().revisionId,
      expectedDraftVersion: saved.json().draftVersion,
      approveDestructive: false,
    });
    expect(failed.statusCode).toBe(422);
    expect(failed.json().code).toBe("DATABASE_CONSTRAINT_FAILED");

    const activeAfterFailure = await server.app.inject({
      method: "GET",
      url: "/api/schema",
      headers: { cookie },
    });
    expect(activeAfterFailure.json().revisionId).toBe(current.json().revisionId);
    const runs = await database.pool.query<{ status: string }>(
      `SELECT status FROM ${qualifiedName(schemaName, "_xecms_migration_runs")}
       ORDER BY started_at DESC LIMIT 1`,
    );
    expect(runs.rows[0]?.status).toBe("failed");
  });

  async function mutate(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<LightMyRequestResponse> {
    return server.app.inject({
      method,
      url,
      headers: { cookie, "x-csrf-token": csrfToken },
      payload,
    });
  }
});

describe.runIf(RUN)("development bootstrap boundary", () => {
  it("does not create an owner automatically in development", async () => {
    const schemaName = `xecms_test_seed_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
    const server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "development",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
      }),
    });
    try {
      const status = await server.app.inject({ method: "GET", url: "/api/bootstrap/status" });
      expect(status.json()).toEqual({ required: true, templateRequired: true });
      const login = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "admin" },
      });
      expect(login.statusCode).toBe(401);

      await bootstrapTestOwner(server);
      const authenticated = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: TEST_OWNER_USERNAME,
          password: TEST_OWNER_PASSWORD,
        },
      });
      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json().user.username).toBe(TEST_OWNER_USERNAME);
    } finally {
      await server.app.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await database.close();
    }
  });
});

describe.runIf(RUN)("XeCMS M2-A document lifecycle", () => {
  const schemaName = `xecms_test_m2_lifecycle_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
  let server: XeCmsServer;
  let cookie = "";
  let csrfToken = "";
  let ownerId = "";
  let collectionId = "";

  beforeAll(async () => {
    server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "test",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "fedcba9876543210fedcba9876543210",
        XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
      }),
    });

    const bootstrap = await server.app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: {
        username: "m2-owner",
        password: "Strong-M2-Owner-Password-2026!",
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    cookie = String(bootstrap.headers["set-cookie"]).split(";", 1)[0] ?? "";
    csrfToken = bootstrap.json().csrfToken as string;
    ownerId = bootstrap.json().user.id as string;

    const collectionIds = await mutate("POST", "/api/schema/ids", {
      kind: "collection",
      count: 1,
    });
    const fieldIds = await mutate("POST", "/api/schema/ids", {
      kind: "field",
      count: 1,
    });
    collectionId = collectionIds.json().ids[0] as string;
    const titleFieldId = fieldIds.json().ids[0] as string;
    const draft = await mutate("PUT", "/api/schema/draft", {
      baseRevisionId: null,
      expectedDraftVersion: null,
      schema: {
        format: "xecms.schema",
        formatVersion: 1,
        collections: [
          {
            id: collectionId,
            name: "lifecyclePosts",
            label: "Lifecycle Posts",
            fields: [
              {
                id: titleFieldId,
                name: "title",
                label: "Title",
                type: "text",
                required: true,
              },
            ],
          },
        ],
      },
    });
    expect(draft.statusCode).toBe(200);
    const preview = await mutate("POST", "/api/schema/preview", {
      expectedDraftVersion: draft.json().draftVersion,
    });
    expect(preview.statusCode).toBe(200);
    const applied = await mutate("POST", "/api/schema/apply", {
      planId: preview.json().planId,
      expectedRevisionId: null,
      expectedDraftVersion: draft.json().draftVersion,
      approveDestructive: false,
    });
    expect(applied.statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) {
      await server.app.close();
    }
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    await database.close();
  });

  it("keeps public data pinned while draft, history, restore, trash, and purge advance versions", async () => {
    const base = `/api/collections/${collectionId}/documents`;
    const publicBase = `/api/content/${collectionId}/documents`;
    const created = await mutate("POST", base, { data: { title: "Published original" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      version: 1,
      displayState: "draft",
      publication: null,
      data: { title: "Published original" },
    });
    const documentId = created.json().id as string;
    const documentBase = `${base}/${documentId}`;

    const unpublished = await server.app.inject({ method: "GET", url: `${publicBase}/${documentId}` });
    expect(unpublished.statusCode).toBe(404);

    const published = await mutate("POST", `${documentBase}/publish`, { expectedVersion: 1 });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      id: documentId,
      version: 2,
      displayState: "published",
      draftRevisionId: null,
      data: { title: "Published original" },
    });
    const originalPublishedRevisionId = published.json().publication.revisionId as string;

    const publicOriginal = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicOriginal.statusCode).toBe(200);
    expect(publicOriginal.json()).toMatchObject({
      id: documentId,
      revisionId: originalPublishedRevisionId,
      data: { title: "Published original" },
    });
    const originalPublishedUpdatedAt = publicOriginal.json().updatedAt as string;
    const publicListAfterPublish = await server.app.inject({ method: "GET", url: publicBase });
    expect(publicListAfterPublish.statusCode).toBe(200);
    expect(publicListAfterPublish.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: documentId,
          revisionId: originalPublishedRevisionId,
          updatedAt: originalPublishedUpdatedAt,
          data: { title: "Published original" },
        }),
      ]),
    );

    const firstEdit = await mutate("PATCH", documentBase, {
      data: { title: "Draft version two" },
      expectedVersion: 2,
    });
    expect(firstEdit.statusCode).toBe(200);
    expect(firstEdit.json()).toMatchObject({
      id: documentId,
      version: 3,
      displayState: "published-with-draft",
      publication: { revisionId: originalPublishedRevisionId },
      data: { title: "Draft version two" },
    });
    const secondRevisionId = firstEdit.json().draftRevisionId as string;

    const secondEdit = await mutate("PATCH", documentBase, {
      data: { title: "Draft version three" },
      expectedVersion: 3,
    });
    expect(secondEdit.statusCode).toBe(200);
    expect(secondEdit.json()).toMatchObject({
      id: documentId,
      version: 4,
      displayState: "published-with-draft",
      data: { title: "Draft version three" },
    });

    const publicWhileEditing = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicWhileEditing.statusCode).toBe(200);
    expect(publicWhileEditing.json()).toMatchObject({
      revisionId: originalPublishedRevisionId,
      updatedAt: originalPublishedUpdatedAt,
      data: { title: "Published original" },
    });
    const publicListWhileEditing = await server.app.inject({ method: "GET", url: publicBase });
    expect(publicListWhileEditing.statusCode).toBe(200);
    expect(publicListWhileEditing.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: documentId,
          revisionId: originalPublishedRevisionId,
          updatedAt: originalPublishedUpdatedAt,
          data: { title: "Published original" },
        }),
      ]),
    );

    const historyBeforeRestore = await adminGet(`${documentBase}/revisions`);
    expect(historyBeforeRestore.statusCode).toBe(200);
    expect(historyBeforeRestore.json().documentVersion).toBe(4);
    expect(historyBeforeRestore.json().items.map((item: { sequence: number }) => item.sequence)).toEqual([
      3,
      2,
      1,
    ]);
    expect(historyBeforeRestore.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: originalPublishedRevisionId, sequence: 1, isPublished: true }),
        expect.objectContaining({ id: secondRevisionId, sequence: 2, isPublished: false }),
      ]),
    );

    await expectVersionConflict(
      await mutate("POST", `${documentBase}/revisions/${secondRevisionId}/restore`, {
        expectedVersion: 3,
      }),
    );
    const restoredRevision = await mutate(
      "POST",
      `${documentBase}/revisions/${secondRevisionId}/restore`,
      { expectedVersion: 4 },
    );
    expect(restoredRevision.statusCode).toBe(200);
    expect(restoredRevision.json()).toMatchObject({
      id: documentId,
      version: 5,
      displayState: "published-with-draft",
      publication: { revisionId: originalPublishedRevisionId },
      data: { title: "Draft version two" },
    });
    const restoredRevisionId = restoredRevision.json().draftRevisionId as string;
    expect(restoredRevisionId).not.toBe(secondRevisionId);

    const publicAfterRestore = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicAfterRestore.statusCode).toBe(200);
    expect(publicAfterRestore.json()).toMatchObject({
      revisionId: originalPublishedRevisionId,
      data: { title: "Published original" },
    });

    const historyAfterRestore = await adminGet(`${documentBase}/revisions`);
    expect(historyAfterRestore.json().items).toHaveLength(4);
    expect(historyAfterRestore.json().items[0]).toMatchObject({
      id: restoredRevisionId,
      sequence: 4,
      origin: { kind: "restore", restoredFromRevisionId: secondRevisionId },
      isCurrentDraft: true,
      isPublished: false,
    });
    const oldRevision = await adminGet(`${documentBase}/revisions/${secondRevisionId}`);
    expect(oldRevision.statusCode).toBe(200);
    expect(oldRevision.json()).toMatchObject({
      id: secondRevisionId,
      sequence: 2,
      data: { title: "Draft version two" },
    });

    await expectVersionConflict(
      await mutate("POST", `${documentBase}/publish`, { expectedVersion: 4 }),
    );
    const publishedRestore = await mutate("POST", `${documentBase}/publish`, {
      expectedVersion: 5,
    });
    expect(publishedRestore.statusCode).toBe(200);
    expect(publishedRestore.json()).toMatchObject({
      id: documentId,
      version: 6,
      displayState: "published",
      publication: { revisionId: restoredRevisionId },
    });
    const publicRestored = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicRestored.statusCode).toBe(200);
    expect(publicRestored.json()).toMatchObject({
      id: documentId,
      revisionId: restoredRevisionId,
      data: { title: "Draft version two" },
    });

    await expectVersionConflict(
      await mutate("POST", `${documentBase}/unpublish`, { expectedVersion: 5 }),
    );
    const unpublish = await mutate("POST", `${documentBase}/unpublish`, {
      expectedVersion: 6,
    });
    expect(unpublish.statusCode).toBe(200);
    expect(unpublish.json()).toMatchObject({
      version: 7,
      displayState: "draft",
      publication: null,
      draftRevisionId: restoredRevisionId,
    });
    const publicAfterUnpublish = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicAfterUnpublish.statusCode).toBe(404);

    const republished = await mutate("POST", `${documentBase}/publish`, { expectedVersion: 7 });
    expect(republished.statusCode).toBe(200);
    expect(republished.json()).toMatchObject({ version: 8, displayState: "published" });

    const activePurge = await mutate("DELETE", `${documentBase}/purge`, {
      expectedVersion: 8,
    });
    expect(activePurge.statusCode).toBe(409);
    expect(activePurge.json().code).toBe("DOCUMENT_NOT_DELETED");

    await expectVersionConflict(
      await mutate("DELETE", documentBase, { expectedVersion: 7 }),
    );
    const softDelete = await mutate("DELETE", documentBase, { expectedVersion: 8 });
    expect(softDelete.statusCode).toBe(204);

    const activeAfterDelete = await adminGet(`${base}?state=active`);
    expect(activeAfterDelete.statusCode).toBe(200);
    expect(activeAfterDelete.json().items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: documentId })]),
    );
    const publicAfterDelete = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicAfterDelete.statusCode).toBe(404);
    const publicListAfterDelete = await server.app.inject({ method: "GET", url: publicBase });
    expect(publicListAfterDelete.statusCode).toBe(200);
    expect(publicListAfterDelete.json().items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: documentId })]),
    );
    const trash = await adminGet(`${base}?state=deleted`);
    expect(trash.statusCode).toBe(200);
    expect(trash.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: documentId,
          version: 9,
          displayState: "deleted",
          publication: expect.objectContaining({ revisionId: restoredRevisionId }),
          data: { title: "Draft version two" },
        }),
      ]),
    );

    await expectVersionConflict(
      await mutate("POST", `${documentBase}/restore`, { expectedVersion: 8 }),
    );
    const restoredDeleted = await mutate("POST", `${documentBase}/restore`, {
      expectedVersion: 9,
    });
    expect(restoredDeleted.statusCode).toBe(200);
    expect(restoredDeleted.json()).toMatchObject({
      id: documentId,
      version: 10,
      displayState: "published",
      deletion: null,
      publication: { revisionId: restoredRevisionId },
    });
    const publicAfterDeletedRestore = await server.app.inject({
      method: "GET",
      url: `${publicBase}/${documentId}`,
    });
    expect(publicAfterDeletedRestore.statusCode).toBe(200);
    expect(publicAfterDeletedRestore.json().data.title).toBe("Draft version two");

    const deleteForPurge = await mutate("DELETE", documentBase, { expectedVersion: 10 });
    expect(deleteForPurge.statusCode).toBe(204);

    await database.pool.query(
      `UPDATE ${qualifiedName(schemaName, "_xecms_identities")} SET is_owner = false WHERE id = $1`,
      [ownerId],
    );
    try {
      // The M3 policy is the authority source. Mutating the legacy capability
      // hint must neither revoke nor grant an already-authenticated subject.
      const policyAuthorizedPurge = await mutate("DELETE", `${documentBase}/purge`, {
        expectedVersion: 11,
      });
      expect(policyAuthorizedPurge.statusCode).toBe(204);
    } finally {
      await database.pool.query(
        `UPDATE ${qualifiedName(schemaName, "_xecms_identities")} SET is_owner = true WHERE id = $1`,
        [ownerId],
      );
    }

    const afterPurge = await adminGet(documentBase);
    expect(afterPurge.statusCode).toBe(404);
    const trashAfterPurge = await adminGet(`${base}?state=deleted`);
    expect(trashAfterPurge.json().items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: documentId })]),
    );
    const revisionsAfterPurge = await adminGet(`${documentBase}/revisions`);
    expect(revisionsAfterPurge.statusCode).toBe(404);

    const persistedAfterPurge = await database.pool.query<{
      event_type: string;
      aggregate_version: string | number;
      payload: { readonly documentId?: string };
    }>(
      `SELECT event_type, aggregate_version, payload
       FROM ${qualifiedName(schemaName, "_xecms_document_events")}
       WHERE document_id = $1 ORDER BY id ASC`,
      [documentId],
    );
    expect(
      persistedAfterPurge.rows.map(({ event_type, aggregate_version }) => [
        event_type,
        Number(aggregate_version),
      ]),
    ).toEqual([
      ["document.created", 1],
      ["document.published", 2],
      ["document.draft-created", 3],
      ["document.draft-created", 4],
      ["document.revision-restored", 5],
      ["document.published", 6],
      ["document.unpublished", 7],
      ["document.published", 8],
      ["document.deleted", 9],
      ["document.restored", 10],
      ["document.deleted", 11],
      ["document.purged", 11],
    ]);
    expect(persistedAfterPurge.rows.every(({ payload }) => payload.documentId === documentId)).toBe(true);
    const persistedPayloads = JSON.stringify(persistedAfterPurge.rows.map(({ payload }) => payload));
    expect(persistedPayloads).not.toContain('"data"');
    expect(persistedPayloads).not.toContain("Published original");
    expect(persistedPayloads).not.toContain("Draft version two");
    expect(persistedPayloads).not.toContain("Draft version three");

    const aggregateRows = await database.pool.query<{ documents: string; revisions: string }>(
      `SELECT
         (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_documents")} WHERE id = $1) AS documents,
         (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_document_revisions")} WHERE document_id = $1) AS revisions`,
      [documentId],
    );
    expect(aggregateRows.rows[0]).toEqual({ documents: "0", revisions: "0" });
  });

  it("allows exactly one of two concurrent writes for the same aggregate version", async () => {
    const base = `/api/collections/${collectionId}/documents`;
    const created = await mutate("POST", base, { data: { title: "Concurrency base" } });
    expect(created.statusCode).toBe(201);
    const documentId = created.json().id as string;
    const documentBase = `${base}/${documentId}`;

    const results = await Promise.all([
      mutate("PATCH", documentBase, {
        data: { title: "Concurrent writer A" },
        expectedVersion: 1,
      }),
      mutate("PATCH", documentBase, {
        data: { title: "Concurrent writer B" },
        expectedVersion: 1,
      }),
    ]);
    expect(results.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    const rejected = results.find(({ statusCode }) => statusCode === 409);
    expect(rejected?.json().code).toBe("DOCUMENT_VERSION_CONFLICT");

    const current = await adminGet(documentBase);
    expect(current.statusCode).toBe(200);
    expect(current.json().version).toBe(2);
    expect(["Concurrent writer A", "Concurrent writer B"]).toContain(current.json().data.title);

    const revisions = await database.pool.query<{ sequence: number }>(
      `SELECT sequence FROM ${qualifiedName(schemaName, "_xecms_document_revisions")}
       WHERE document_id = $1 ORDER BY sequence ASC`,
      [documentId],
    );
    expect(revisions.rows.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  async function adminGet(url: string): Promise<LightMyRequestResponse> {
    return server.app.inject({ method: "GET", url, headers: { cookie } });
  }

  async function mutate(
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<LightMyRequestResponse> {
    return server.app.inject({
      method,
      url,
      headers: { cookie, "x-csrf-token": csrfToken },
      payload,
    });
  }

  async function expectVersionConflict(response: LightMyRequestResponse): Promise<void> {
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("DOCUMENT_VERSION_CONFLICT");
  }
});

describe.runIf(RUN)("XeCMS 0003 document lifecycle event upgrade", () => {
  it("upgrades a populated pre-0003 schema without data loss and remains idempotent", async () => {
    const schemaName = `xecms_test_upgrade_0003_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
    const server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "test",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "0003upgrade0003upgrade0003upgrade",
        XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
      }),
    });

    try {
      const bootstrap = await server.app.inject({
        method: "POST",
        url: "/api/bootstrap",
        payload: {
          username: "upgrade-owner",
          password: "Strong-Upgrade-Password-2026!",
        },
      });
      expect(bootstrap.statusCode).toBe(201);
      const cookie = String(bootstrap.headers["set-cookie"]).split(";", 1)[0] ?? "";
      const csrfToken = bootstrap.json().csrfToken as string;
      const mutate = (
        method: "POST" | "PUT" | "PATCH" | "DELETE",
        url: string,
        payload: Readonly<Record<string, unknown>>,
      ): Promise<LightMyRequestResponse> =>
        server.app.inject({
          method,
          url,
          headers: { cookie, "x-csrf-token": csrfToken },
          payload,
        });

      const collectionIds = await mutate("POST", "/api/schema/ids", {
        kind: "collection",
        count: 1,
      });
      const fieldIds = await mutate("POST", "/api/schema/ids", { kind: "field", count: 1 });
      const collectionId = collectionIds.json().ids[0] as string;
      const fieldId = fieldIds.json().ids[0] as string;
      const schemaDraft = await mutate("PUT", "/api/schema/draft", {
        baseRevisionId: null,
        expectedDraftVersion: null,
        schema: {
          format: "xecms.schema",
          formatVersion: 1,
          collections: [
            {
              id: collectionId,
              name: "upgradePosts",
              fields: [{ id: fieldId, name: "title", type: "text", required: true }],
            },
          ],
        },
      });
      const preview = await mutate("POST", "/api/schema/preview", {
        expectedDraftVersion: schemaDraft.json().draftVersion,
      });
      const applied = await mutate("POST", "/api/schema/apply", {
        planId: preview.json().planId,
        expectedRevisionId: null,
        expectedDraftVersion: schemaDraft.json().draftVersion,
        approveDestructive: false,
      });
      expect(applied.statusCode).toBe(200);

      const base = `/api/collections/${collectionId}/documents`;
      const created = await mutate("POST", base, { data: { title: "Preserved before 0003" } });
      expect(created.statusCode).toBe(201);
      const documentId = created.json().id as string;

      await database.pool.query(`
        DROP TABLE ${qualifiedName(schemaName, "_xecms_document_events")};
        DELETE FROM ${qualifiedName(schemaName, "_xecms_core_migrations")}
          WHERE id IN (
            '0003_document_lifecycle_events',
            '0014_m4b_event_worker',
            '0015_m4c1_users_credentials',
            '0016_m4c2_sites_settings',
            '0017_m4c3_audit_retention',
            '0018_m4c4_plugin_platform',
            '0019_owner_delegation_reconciliation'
          )
      `);
      await database.pool.query(
        `DELETE FROM ${qualifiedName(schemaName, "_xecms_outbox_events")}
          WHERE aggregate_type = 'document' AND aggregate_id = $1`,
        [documentId],
      );
      const preUpgradeMarkers = await database.pool.query<{ id: string }>(
        `SELECT id FROM ${qualifiedName(schemaName, "_xecms_core_migrations")} ORDER BY id`,
      );
      expect(preUpgradeMarkers.rows.map(({ id }) => id)).toEqual([
        "0001_m1_core",
        "0002_schema_draft_version",
        "0004_m3_authorization",
        "0005_m3_authorization_contract",
        "0006_m3_authorization_storage_finalization",
        "0007_m3_authorization_audit_retention",
        "0008_m2_schema_registry",
        "0009_m2_relations",
        "0010_m2_media",
        "0011_m2_content_hierarchy",
        "0012_m3_authorization_resource_quarantine",
        "0013_m4_identity_realms",
        "0020_caa2_admin_app_store",
        "0021_m4_realm_control_plane_access",
        "0022_m4_realm_owner_model",
        "0023_m4_authorization_control_plane_audit",
        "0024_m4_realm_full_access_lifecycle",
        "0025_m4_realm_collection_entitlements",
        "0026_m4_realm_management_delegations",
      ]);

      await migrateCore(database.pool, schemaName);

      const preserved = await server.app.inject({
        method: "GET",
        url: `${base}/${documentId}`,
        headers: { cookie },
      });
      expect(preserved.statusCode).toBe(200);
      expect(preserved.json()).toMatchObject({
        id: documentId,
        version: 1,
        data: { title: "Preserved before 0003" },
      });

      const updated = await mutate("PATCH", `${base}/${documentId}`, {
        expectedVersion: 1,
        data: { title: "Updated after 0003" },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({ version: 2, data: { title: "Updated after 0003" } });
      const published = await mutate("POST", `${base}/${documentId}/publish`, {
        expectedVersion: 2,
      });
      expect(published.statusCode).toBe(200);
      expect(published.json()).toMatchObject({ version: 3, displayState: "published" });

      const publicDocument = await server.app.inject({
        method: "GET",
        url: `/api/content/${collectionId}/documents/${documentId}`,
      });
      expect(publicDocument.statusCode).toBe(200);
      expect(publicDocument.json().data).toEqual({ title: "Updated after 0003" });

      const eventsBeforeRerun = await database.pool.query<{
        event_type: string;
        aggregate_version: string | number;
      }>(
        `SELECT event_type, aggregate_version
         FROM ${qualifiedName(schemaName, "_xecms_document_events")}
         WHERE document_id = $1 ORDER BY id`,
        [documentId],
      );
      expect(
        eventsBeforeRerun.rows.map(({ event_type, aggregate_version }) => [
          event_type,
          Number(aggregate_version),
        ]),
      ).toEqual([
        ["document.draft-created", 2],
        ["document.published", 3],
      ]);

      await migrateCore(database.pool, schemaName);

      const idempotentState = await database.pool.query<{
        marker_count: string;
        event_count: string;
        document_count: string;
        revision_count: string;
      }>(
        `SELECT
          (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_core_migrations")}
             WHERE id = '0003_document_lifecycle_events') AS marker_count,
          (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_document_events")}
             WHERE document_id = $1) AS event_count,
          (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_documents")}
             WHERE id = $1) AS document_count,
          (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_document_revisions")}
             WHERE document_id = $1) AS revision_count`,
        [documentId],
      );
      expect(idempotentState.rows[0]).toEqual({
        marker_count: "1",
        event_count: "2",
        document_count: "1",
        revision_count: "2",
      });
    } finally {
      await server.app.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await database.close();
    }
  }, 120_000);
});

describe.runIf(RUN)("XeCMS M3 authorization HTTP vertical slice", () => {
  it("persists subjects, nested groups, same-level roles, scoped bindings, simulation provenance, and audit", async () => {
    const schemaName = `xecms_test_m3_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
    const server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "development",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "m3-authorization-secret-0123456789abcdef",
        XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
      }),
    });
    try {
      await bootstrapTestOwner(server);
      const login = await server.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: TEST_OWNER_USERNAME,
          password: TEST_OWNER_PASSWORD,
        },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers["set-cookie"]).split(";", 1)[0] ?? "";
      const csrfToken = login.json().csrfToken as string;
      const mutate = (
        method: "POST" | "PUT" | "PATCH" | "DELETE",
        url: string,
        payload: Readonly<Record<string, unknown>>,
      ): Promise<LightMyRequestResponse> => server.app.inject({
        method,
        url,
        headers: { cookie, "x-csrf-token": csrfToken },
        payload,
      });
      const getPolicy = () => server.app.inject({
        method: "GET",
        url: "/api/authorization/policy",
        headers: { cookie },
      });

      const initial = await getPolicy();
      expect(initial.statusCode).toBe(200);
      expect(initial.json().revision).toBe(1);
      const contentAdministrator = initial.json().roles.find(
        ({ name }: { readonly name: string }) => name === "Content Administrator",
      );
      const securityAdministrator = initial.json().roles.find(
        ({ name }: { readonly name: string }) => name === "Security Administrator",
      );
      expect(contentAdministrator.levelId).toBe(securityAdministrator.levelId);

      const accessProfile = await server.app.inject({
        method: "POST",
        url: "/api/access/evaluate-batch",
        headers: { cookie },
        payload: {
          checks: [
            {
              id: "content.open",
              type: "permission",
              action: "content.read",
              resourceId: "resource:content",
            },
            {
              id: "content.title.write",
              type: "field",
              action: "content.update",
              resourceId: "resource:content",
              field: "title",
              access: "write",
            },
            {
              id: "owner.transfer",
              type: "permission",
              action: "identity.owner.transfer",
              resourceId: "resource:workspace",
            },
          ],
        },
      });
      expect(accessProfile.statusCode, accessProfile.body).toBe(200);
      expect(accessProfile.headers["cache-control"]).toBe("private, no-store");
      expect(accessProfile.json()).toMatchObject({
        policyRevision: 1,
        items: [
          {
            id: "content.open",
            type: "permission",
            supported: true,
            decision: { allowed: true, policyRevision: 1 },
          },
          {
            id: "content.title.write",
            type: "field",
            supported: true,
            decision: { allowed: true, policyRevision: 1 },
          },
          {
            id: "owner.transfer",
            type: "permission",
            supported: false,
            decision: {
              allowed: false,
              reasonCode: "HIERARCHY_CONTEXT_REQUIRED",
              policyRevision: 1,
            },
          },
        ],
      });

      const proxyAttempt = await server.app.inject({
        method: "POST",
        url: "/api/access/evaluate-batch",
        headers: { cookie },
        payload: {
          checks: [{
            id: "proxy",
            type: "permission",
            subjectId: "subject:other",
            action: "content.read",
            resourceId: "resource:content",
          }],
        },
      });
      expect(proxyAttempt.statusCode).toBe(400);
      expect(proxyAttempt.json()).toMatchObject({ code: "ACCESS_BATCH_INVALID" });

      let policy = (await mutate("POST", "/api/authorization/subjects", {
        expectedPolicyRevision: 1,
        type: "user",
        name: "M3 Writer",
      })).json();
      const writer = policy.subjects.find(({ name }: { readonly name: string }) => name === "M3 Writer");
      expect(policy.revision).toBe(2);

      policy = (await mutate("POST", "/api/authorization/subjects", {
        expectedPolicyRevision: policy.revision,
        type: "group",
        name: "Editorial Group",
      })).json();
      const group = policy.subjects.find(
        ({ name }: { readonly name: string }) => name === "Editorial Group",
      );

      policy = (await mutate("POST", "/api/authorization/group-memberships", {
        expectedPolicyRevision: policy.revision,
        memberSubjectId: writer.id,
        groupSubjectId: group.id,
      })).json();
      const editorLevel = policy.levels.find(
        ({ name }: { readonly name: string }) => name === "Editors",
      );

      policy = (await mutate("POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "Scoped Article Writer",
        description: "M3 integration role",
        levelId: editorLevel.id,
        permissions: ["content.list", "content.read", "content.update"],
        delegatablePermissions: [],
        fieldAccess: [{
          resourceId: "resource:content",
          readableFields: ["title"],
          writableFields: ["title"],
        }],
      })).json();
      const writerRole = policy.roles.find(
        ({ name }: { readonly name: string }) => name === "Scoped Article Writer",
      );

      policy = (await mutate("POST", "/api/authorization/bindings", {
        expectedPolicyRevision: policy.revision,
        subjectId: group.id,
        roleId: writerRole.id,
        resourceId: "resource:content",
        propagation: "self-and-children",
        constraints: { ownerSubjectId: writer.id, statuses: ["draft"] },
      })).json();
      expect(policy.revision).toBe(6);

      const missingContext = await mutate("POST", "/api/authorization/simulate", {
        subjectId: writer.id,
        action: "content.read",
        resourceId: "resource:content",
      });
      expect(missingContext.statusCode).toBe(200);
      expect(missingContext.json()).toMatchObject({
        allowed: false,
        reasonCode: "CONSTRAINT_NOT_SATISFIED",
        policyRevision: 6,
      });

      const allowed = await mutate("POST", "/api/authorization/simulate", {
        subjectId: writer.id,
        action: "content.read",
        resourceId: "resource:content",
        context: { ownerSubjectId: writer.id, status: "draft" },
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({ allowed: true, policyRevision: 6 });
      expect(allowed.json().matchedGrants[0]).toMatchObject({
        sourceRoleId: writerRole.id,
        sourceResourceId: "resource:content",
      });
      expect(allowed.json().matchedGrants[0].membershipPath).toEqual(
        expect.arrayContaining([writer.id, group.id]),
      );

      const stale = await mutate("POST", "/api/authorization/subjects", {
        expectedPolicyRevision: 1,
        type: "service-account",
        name: "Stale agent",
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        code: "POLICY_REVISION_CONFLICT",
        details: { expectedRevision: 1, actualRevision: 6 },
      });

      const audit = await server.app.inject({
        method: "GET",
        url: "/api/authorization/audit",
        headers: { cookie },
      });
      expect(audit.statusCode).toBe(200);
      expect(audit.json().items).toHaveLength(6);
      expect(audit.json().items[0]).toMatchObject({
        policyRevision: 6,
        action: "binding.create",
        targetType: "binding",
        decision: { allowed: true },
      });

      const normalized = await database.pool.query<{ revision: string; audit_count: string }>(
        `SELECT state.current_revision::text AS revision,
                (SELECT count(*)::text FROM ${qualifiedName(schemaName, "_xecms_auth_audit_log")}
                 WHERE realm_id = state.realm_id) AS audit_count
         FROM ${qualifiedName(schemaName, "_xecms_auth_policy_state")} state
         WHERE realm_id = 'rlm_system'`,
      );
      expect(normalized.rows[0]).toEqual({ revision: "6", audit_count: "6" });
    } finally {
      await server.app.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await database.close();
    }
  }, 60_000);
});
