import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PostgresDatabase,
  qualifiedName,
  quoteIdentifier,
} from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_M2_DATABASE_URL"] ??
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

const COLLECTIONS = {
  settings: "col_m2_settings",
  authors: "col_m2_authors",
  categories: "col_m2_categories",
  posts: "col_m2_posts",
  comments: "col_m2_comments",
} as const;

const FULL_SCHEMA = {
  format: "xecms.schema",
  formatVersion: 1,
  collections: [
    {
      id: COLLECTIONS.settings,
      name: "siteSettings",
      label: "Site settings",
      kind: "singleton",
      fields: [
        {
          id: "fld_m2_settings_name",
          name: "name",
          label: "Name",
          type: "text",
          required: true,
          minLength: 1,
          maxLength: 80,
        },
        {
          id: "fld_m2_settings_description",
          name: "description",
          type: "textarea",
          minLength: 2,
          maxLength: 500,
        },
        { id: "fld_m2_settings_launch_date", name: "launchDate", type: "date" },
        { id: "fld_m2_settings_content_updated_at", name: "contentUpdatedAt", type: "datetime" },
        {
          id: "fld_m2_settings_theme",
          name: "theme",
          type: "enum",
          required: true,
          options: [
            { label: "Light", value: "light" },
            { label: "Dark", value: "dark" },
          ],
        },
        {
          id: "fld_m2_settings_channels",
          name: "channels",
          type: "select",
          multiple: true,
          options: [
            { label: "Web", value: "web" },
            { label: "App", value: "app" },
          ],
        },
        { id: "fld_m2_settings_score", name: "score", type: "number", minimum: 0 },
        { id: "fld_m2_settings_enabled", name: "enabled", type: "boolean" },
        { id: "fld_m2_settings_metadata", name: "metadata", type: "json" },
        {
          id: "fld_m2_settings_preferences",
          name: "preferences",
          type: "object",
          fields: [
            {
              id: "fld_m2_settings_preferences_locale",
              name: "locale",
              type: "text",
              required: true,
            },
            {
              id: "fld_m2_settings_preferences_compact",
              name: "compact",
              type: "boolean",
            },
          ],
        },
        {
          id: "fld_m2_settings_cards",
          name: "cards",
          type: "array",
          minItems: 1,
          maxItems: 3,
          fields: [
            {
              id: "fld_m2_settings_card_heading",
              name: "heading",
              type: "text",
              required: true,
            },
            { id: "fld_m2_settings_card_body", name: "body", type: "textarea" },
          ],
        },
        {
          id: "fld_m2_settings_seo",
          name: "seo",
          type: "component",
          componentId: "cmp_m2_seo",
        },
        {
          id: "fld_m2_settings_body",
          name: "body",
          type: "rich-text",
          editor: "xecms.basic",
        },
        {
          id: "fld_m2_settings_blocks",
          name: "blocks",
          type: "blocks",
          allowedComponentIds: ["cmp_m2_callout"],
        },
        {
          id: "fld_m2_settings_logo",
          name: "logo",
          type: "upload",
          acceptedMimeTypes: ["image/png"],
        },
        {
          id: "fld_m2_settings_jpeg_logo",
          name: "jpegOnlyLogo",
          type: "upload",
          acceptedMimeTypes: ["image/jpeg"],
        },
      ],
    },
    {
      id: COLLECTIONS.authors,
      name: "authors",
      fields: [
        {
          id: "fld_m2_author_name",
          name: "name",
          type: "text",
          required: true,
        },
      ],
    },
    {
      id: COLLECTIONS.categories,
      name: "categories",
      hierarchy: {
        enabled: true,
        maxDepth: 2,
        ordering: "manual",
        permissionInheritance: true,
      },
      fields: [
        {
          id: "fld_m2_category_title",
          name: "title",
          type: "text",
          required: true,
        },
      ],
    },
    {
      id: COLLECTIONS.posts,
      name: "posts",
      fields: [
        {
          id: "fld_m2_post_title",
          name: "title",
          type: "text",
          required: true,
        },
        {
          id: "fld_m2_post_author",
          name: "author",
          type: "relation",
          relationId: "rel_m2_post_author",
          targetCollectionId: COLLECTIONS.authors,
          cardinality: "one",
          required: true,
          onDelete: "restrict",
        },
        {
          id: "fld_m2_post_category",
          name: "category",
          type: "relation",
          relationId: "rel_m2_post_category",
          targetCollectionId: COLLECTIONS.categories,
          cardinality: "one",
          onDelete: "nullify",
        },
        {
          id: "fld_m2_post_related",
          name: "related",
          type: "relation",
          relationId: "rel_m2_post_related",
          targetCollectionId: COLLECTIONS.posts,
          cardinality: "many",
          onDelete: "nullify",
        },
        {
          id: "fld_m2_post_cover",
          name: "cover",
          type: "upload",
          acceptedMimeTypes: ["image/png"],
        },
      ],
    },
    {
      id: COLLECTIONS.comments,
      name: "comments",
      fields: [
        {
          id: "fld_m2_comment_message",
          name: "message",
          type: "textarea",
          required: true,
        },
        {
          id: "fld_m2_comment_post",
          name: "post",
          type: "relation",
          relationId: "rel_m2_comment_post",
          targetCollectionId: COLLECTIONS.posts,
          cardinality: "one",
          required: true,
          onDelete: "cascade",
        },
      ],
    },
  ],
  components: [
    {
      id: "cmp_m2_seo",
      name: "seoMetadata",
      fields: [
        {
          id: "fld_m2_seo_title",
          name: "title",
          type: "text",
          required: true,
        },
        { id: "fld_m2_seo_description", name: "description", type: "textarea" },
      ],
    },
    {
      id: "cmp_m2_callout",
      name: "callout",
      fields: [
        {
          id: "fld_m2_callout_tone",
          name: "tone",
          type: "enum",
          required: true,
          options: [
            { label: "Info", value: "info" },
            { label: "Warning", value: "warning" },
          ],
        },
        {
          id: "fld_m2_callout_body",
          name: "body",
          type: "textarea",
          required: true,
        },
      ],
    },
  ],
} as const;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

describe.runIf(RUN).sequential("XeCMS M2 content core PostgreSQL integration", () => {
  const schemaName = `xecms_test_m2_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
  let server: XeCmsServer;
  let mediaRoot = "";
  let cookie = "";
  let csrfToken = "";
  let activeRevisionId = "";
  let canonicalSchema: unknown;
  let mediaId = "";
  let settingsId = "";
  let authorId = "";
  let categoryRootAId = "";
  let categoryRootBId = "";
  let categoryChildId = "";
  let categoryGrandchildId = "";
  let postTargetId = "";
  let postSourceId = "";
  let commentId = "";

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), "xecms-m2-media-"));
    server = await buildServer({
      database,
      logger: false,
      config: loadServerConfig({
        NODE_ENV: "test",
        DATABASE_URL,
        XECMS_DB_SCHEMA: schemaName,
        XECMS_SESSION_SECRET: "m2-integration-secret-0123456789abcdef",
        XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
        XECMS_MEDIA_STORAGE_ROOT: mediaRoot,
        XECMS_MEDIA_MAX_UPLOAD_BYTES: "1048576",
        XECMS_MEDIA_ALLOWED_MIME_TYPES: "image/png",
      }),
    });
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) await server.app.close();
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    await database.close();
    if (mediaRoot.length > 0) await rm(mediaRoot, { recursive: true, force: true });
  });

  it("bootstraps, imports a complete manifest, previews/applies it, and emits deterministic artifacts", async () => {
    const bootstrap = await server.app.inject({
      method: "POST",
      url: "/api/bootstrap",
      payload: {
        username: "m2-owner",
        password: "Strong-M2-Integration-Password-2026!",
      },
    });
    expect(bootstrap.statusCode).toBe(201);
    cookie = String(bootstrap.headers["set-cookie"]).split(";", 1)[0] ?? "";
    csrfToken = bootstrap.json().csrfToken as string;

    const imported = await mutate("PUT", "/api/schema/manifest", {
      baseRevisionId: null,
      expectedDraftVersion: null,
      schema: FULL_SCHEMA,
    });
    expect(imported.statusCode, responseDiagnostic(imported)).toBe(200);
    canonicalSchema = imported.json().schema;
    expect(canonicalSchema).toMatchObject({
      format: "xecms.schema",
      formatVersion: 1,
      collections: expect.arrayContaining([
        expect.objectContaining({ id: COLLECTIONS.settings, kind: "singleton" }),
        expect.objectContaining({
          id: COLLECTIONS.categories,
          hierarchy: expect.objectContaining({ enabled: true, maxDepth: 2 }),
        }),
      ]),
      components: expect.arrayContaining([
        expect.objectContaining({ id: "cmp_m2_seo" }),
        expect.objectContaining({ id: "cmp_m2_callout" }),
      ]),
    });

    const preview = await mutate("POST", "/api/schema/preview", {
      expectedDraftVersion: imported.json().draftVersion,
    });
    expect(preview.statusCode, responseDiagnostic(preview)).toBe(200);
    expect(preview.json().requiresDestructiveApproval).toBe(false);
    expect(preview.json().operations).toHaveLength(FULL_SCHEMA.collections.length);

    const applied = await mutate("POST", "/api/schema/apply", {
      planId: preview.json().planId,
      expectedRevisionId: null,
      expectedDraftVersion: imported.json().draftVersion,
      approveDestructive: false,
    });
    expect(applied.statusCode, responseDiagnostic(applied)).toBe(200);
    activeRevisionId = applied.json().revisionId as string;

    const [manifestA, manifestB, typesA, typesB] = await Promise.all([
      read("/api/schema/manifest"),
      read("/api/schema/manifest"),
      read("/api/schema/types"),
      read("/api/schema/types"),
    ]);
    expect(manifestA.statusCode, responseDiagnostic(manifestA)).toBe(200);
    expect(manifestB.statusCode, responseDiagnostic(manifestB)).toBe(200);
    expect(manifestA.body).toBe(manifestB.body);
    expect(manifestA.json().schema).toEqual(canonicalSchema);
    expect(JSON.parse(manifestA.json().serialized)).toEqual(canonicalSchema);
    expect(manifestA.json().hash).toBe(sha256(manifestA.json().serialized));
    expect(typesA.statusCode, responseDiagnostic(typesA)).toBe(200);
    expect(typesB.statusCode, responseDiagnostic(typesB)).toBe(200);
    expect(typesA.body).toBe(typesB.body);
    expect(typesA.json().hash).toBe(sha256(typesA.json().source));
    expect(typesA.json().source).toContain("export interface SiteSettingsDocument");
    expect(typesA.json().source).toContain("export interface SeoMetadataComponent");
    expect(typesA.json().source).toContain("export type XeCmsSingletonName = \"siteSettings\"");

    const active = await read("/api/schema");
    expect(active.json().revisionId).toBe(activeRevisionId);
  }, 120_000);

  it("streams PNG media, validates every broad field, enforces singleton uniqueness and media references", async () => {
    const uploaded = await server.app.inject({
      method: "POST",
      url: "/api/media",
      headers: {
        cookie,
        "x-csrf-token": csrfToken,
        "content-type": "image/png",
        "x-file-name": encodeURIComponent("logo 한글.png"),
      },
      payload: PNG_BYTES,
    });
    expect(uploaded.statusCode, responseDiagnostic(uploaded)).toBe(201);
    mediaId = uploaded.json().id as string;
    expect(uploaded.json()).toMatchObject({
      fileName: "logo 한글.png",
      mimeType: "image/png",
      size: PNG_BYTES.length,
      checksum: sha256(PNG_BYTES),
      status: "available",
    });

    const listed = await read("/api/media");
    expect(listed.statusCode, responseDiagnostic(listed)).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({ id: mediaId, status: "available" }),
    ]);
    const consistency = await mutate("POST", "/api/media/consistency", {});
    expect(consistency.statusCode, responseDiagnostic(consistency)).toBe(200);
    expect(consistency.json()).toEqual({
      missing: [],
      orphanStorageKeys: [],
      incomplete: [],
      healthyCount: 1,
    });

    const data = validSettings(mediaId);
    const normalizedData = {
      ...data,
      contentUpdatedAt: "2026-07-15T00:30:00.000Z",
    };
    const created = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.settings}/documents`,
      { data },
    );
    expect(created.statusCode, responseDiagnostic(created)).toBe(201);
    settingsId = created.json().id as string;
    expect(created.json()).toMatchObject({
      version: 1,
      data: normalizedData,
    });

    const duplicate = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.settings}/documents`,
      { data: { ...data, name: "Another singleton" } },
    );
    expect(duplicate.statusCode, responseDiagnostic(duplicate)).toBe(409);
    expect(duplicate.json().code).toBe("SINGLETON_ALREADY_EXISTS");

    const rejectedByFieldMime = await mutate(
      "PATCH",
      `/api/collections/${COLLECTIONS.settings}/documents/${settingsId}`,
      { data: { ...data, jpegOnlyLogo: mediaId }, expectedVersion: 1 },
    );
    expect(rejectedByFieldMime.statusCode, responseDiagnostic(rejectedByFieldMime)).toBe(422);
    expect(rejectedByFieldMime.json()).toMatchObject({
      code: "MEDIA_REFERENCE_INVALID",
      details: {
        issues: [{
          mediaId,
          reason: "mime-not-accepted",
          actualMimeType: "image/png",
          acceptedMimeTypes: ["image/jpeg"],
        }],
      },
    });

    const invalidCases: readonly [string, unknown][] = [
      ["description", 42],
      ["launchDate", "2026-07-15T00:00:00.000Z"],
      ["theme", "purple"],
      ["channels", ["web", "fax"]],
      ["preferences", []],
      ["cards", { heading: "not-an-array" }],
      ["seo", { title: 123 }],
      [
        "body",
        {
          format: "xecms.rich-text",
          formatVersion: 2,
          // Blocks without an id are rejected by the v2 contract.
          content: [{ type: "paragraph" }],
        },
      ],
    ];
    for (const [field, value] of invalidCases) {
      const invalid = await mutate(
        "PATCH",
        `/api/collections/${COLLECTIONS.settings}/documents/${settingsId}`,
        { data: { ...data, [field]: value }, expectedVersion: 1 },
      );
      expect(invalid.statusCode, `${field}: ${responseDiagnostic(invalid)}`).toBe(422);
      expect(invalid.json().code).toBe("DOCUMENT_VALIDATION_FAILED");
    }

    const malformedJson = await server.app.inject({
      method: "PATCH",
      url: `/api/collections/${COLLECTIONS.settings}/documents/${settingsId}`,
      headers: {
        cookie,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      payload: '{"data":{"metadata":{"notJson":NaN}},"expectedVersion":1}',
    });
    expect(malformedJson.statusCode, responseDiagnostic(malformedJson)).toBe(400);

    const afterFailures = await read(
      `/api/collections/${COLLECTIONS.settings}/documents/${settingsId}`,
    );
    expect(afterFailures.json()).toMatchObject({ version: 1, data: normalizedData });

    const inUse = await mutate("DELETE", `/api/media/${mediaId}`, {});
    expect(inUse.statusCode, responseDiagnostic(inUse)).toBe(409);
    expect(inUse.json().code).toBe("MEDIA_IN_USE");

    const removedReference = await mutate(
      "PATCH",
      `/api/collections/${COLLECTIONS.settings}/documents/${settingsId}`,
      { data: withoutKey(data, "logo"), expectedVersion: 1 },
    );
    expect(removedReference.statusCode, responseDiagnostic(removedReference)).toBe(200);
    expect(removedReference.json()).toMatchObject({ version: 2 });
    expect(removedReference.json().data.logo).toBe(mediaId);

    const deleted = await mutate("DELETE", `/api/media/${mediaId}`, {});
    expect(deleted.statusCode, responseDiagnostic(deleted)).toBe(409);
    expect(deleted.json().code).toBe("MEDIA_IN_USE");
    const afterDelete = await read("/api/media");
    expect(afterDelete.json().items).toContainEqual(expect.objectContaining({ id: mediaId }));
  }, 120_000);

  it("creates, queries, reorders and moves a hierarchy while rejecting stale, cyclic, deep and cross-collection moves", async () => {
    const author = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.authors}/documents`,
      { data: { name: "Ada" } },
    );
    expect(author.statusCode, responseDiagnostic(author)).toBe(201);
    authorId = author.json().id as string;

    const rootA = await createCategory("Root A", null, 0, 0);
    expect(rootA.statusCode, responseDiagnostic(rootA)).toBe(201);
    categoryRootAId = rootA.json().id as string;
    const rootB = await createCategory("Root B", null, 1, 1);
    expect(rootB.statusCode, responseDiagnostic(rootB)).toBe(201);
    categoryRootBId = rootB.json().id as string;
    const child = await createCategory("Child", categoryRootAId, 0, 2);
    expect(child.statusCode, responseDiagnostic(child)).toBe(201);
    categoryChildId = child.json().id as string;
    const grandchild = await createCategory("Grandchild", categoryChildId, 0, 3);
    expect(grandchild.statusCode, responseDiagnostic(grandchild)).toBe(201);
    categoryGrandchildId = grandchild.json().id as string;

    const initial = await read(`/api/collections/${COLLECTIONS.categories}/tree`);
    expect(initial.statusCode, responseDiagnostic(initial)).toBe(200);
    expect(initial.json().version).toBe(4);
    expect(initial.json().items).toEqual([
      expect.objectContaining({
        document: expect.objectContaining({ id: categoryRootAId }),
        parentId: null,
        position: 0,
        depth: 0,
        path: [categoryRootAId],
        hasChildren: true,
      }),
      expect.objectContaining({
        document: expect.objectContaining({ id: categoryChildId }),
        parentId: categoryRootAId,
        position: 0,
        depth: 1,
        path: [categoryRootAId, categoryChildId],
        hasChildren: true,
      }),
      expect.objectContaining({
        document: expect.objectContaining({ id: categoryGrandchildId }),
        parentId: categoryChildId,
        position: 0,
        depth: 2,
        path: [categoryRootAId, categoryChildId, categoryGrandchildId],
        hasChildren: false,
      }),
      expect.objectContaining({
        document: expect.objectContaining({ id: categoryRootBId }),
        parentId: null,
        position: 1,
        depth: 0,
      }),
    ]);

    const children = await read(
      `/api/collections/${COLLECTIONS.categories}/tree?parentId=${categoryRootAId}`,
    );
    expect(children.json().items.map(treeDocumentId)).toEqual([categoryChildId]);
    const ancestors = await read(
      `/api/collections/${COLLECTIONS.categories}/documents/${categoryGrandchildId}/ancestors`,
    );
    expect(ancestors.json().items.map(treeDocumentId)).toEqual([
      categoryRootAId,
      categoryChildId,
    ]);

    const reordered = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.categories}/tree/reorder`,
      {
        parentId: null,
        orderedDocumentIds: [categoryRootBId, categoryRootAId],
        expectedVersion: 4,
      },
    );
    expect(reordered.statusCode, responseDiagnostic(reordered)).toBe(200);
    expect(reordered.json().version).toBe(5);

    const moved = await moveCategory(categoryChildId, categoryRootBId, 0, 5);
    expect(moved.statusCode, responseDiagnostic(moved)).toBe(200);
    expect(moved.json()).toMatchObject({
      version: 6,
      previousParentId: categoryRootAId,
      previousPosition: 0,
      node: {
        parentId: categoryRootBId,
        position: 0,
        depth: 1,
        path: [categoryRootBId, categoryChildId],
      },
    });
    expect(moved.json().affectedDocumentIds).toEqual(
      expect.arrayContaining([categoryChildId, categoryGrandchildId]),
    );

    const stale = await moveCategory(categoryRootAId, null, 0, 5);
    expect(stale.statusCode, responseDiagnostic(stale)).toBe(409);
    expect(stale.json().code).toBe("HIERARCHY_VERSION_CONFLICT");

    const cycle = await moveCategory(categoryRootBId, categoryGrandchildId, 0, 6);
    expect(cycle.statusCode, responseDiagnostic(cycle)).toBe(422);
    expect(cycle.json().code).toBe("HIERARCHY_CYCLE");

    const tooDeep = await moveCategory(categoryRootAId, categoryGrandchildId, 0, 6);
    expect(tooDeep.statusCode, responseDiagnostic(tooDeep)).toBe(422);
    expect(tooDeep.json().code).toBe("HIERARCHY_MAX_DEPTH_EXCEEDED");

    const crossCollection = await moveCategory(categoryRootAId, authorId, 0, 6);
    expect(crossCollection.statusCode, responseDiagnostic(crossCollection)).toBe(422);
    expect(crossCollection.json().code).toBe("HIERARCHY_CROSS_COLLECTION_PARENT");

    const unchanged = await read(`/api/collections/${COLLECTIONS.categories}/tree`);
    expect(unchanged.json().version).toBe(6);
    expect(
      unchanged.json().items.filter((node: unknown) => treeDepth(node) === 0).map(treeDocumentId),
    ).toEqual([categoryRootBId, categoryRootAId]);
  }, 120_000);

  it("rolls back the complete purge graph and handles a published-only nullify source", async () => {
    const target = await createPost({ title: "Atomic purge target", author: authorId });
    expect(target.statusCode, responseDiagnostic(target)).toBe(201);
    const targetId = target.json().id as string;

    const source = await createPost({
      title: "Published-only nullify source",
      author: authorId,
      related: [targetId],
    });
    expect(source.statusCode, responseDiagnostic(source)).toBe(201);
    const sourceId = source.json().id as string;
    const published = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.posts}/documents/${sourceId}/publish`,
      { expectedVersion: 1 },
    );
    expect(published.statusCode, responseDiagnostic(published)).toBe(200);
    expect(published.json()).toMatchObject({
      version: 2,
      displayState: "published",
      draftRevisionId: null,
      data: { related: [targetId] },
    });

    const cascade = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.comments}/documents`,
      { data: { message: "Atomic cascade source", post: targetId } },
    );
    expect(cascade.statusCode, responseDiagnostic(cascade)).toBe(201);
    const cascadeId = cascade.json().id as string;

    const deleted = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.posts}/documents/${targetId}`,
      { expectedVersion: 1 },
    );
    expect(deleted.statusCode, responseDiagnostic(deleted)).toBe(204);

    const failFunction = qualifiedName(schemaName, "_xecms_test_fail_hard_purge");
    const failTrigger = quoteIdentifier("_xecms_test_fail_hard_purge");
    await database.pool.query(`
      CREATE FUNCTION ${failFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected hard purge failure';
      END
      $$;
      CREATE TRIGGER ${failTrigger}
      BEFORE DELETE ON ${qualifiedName(schemaName, "_xecms_documents")}
      FOR EACH ROW EXECUTE FUNCTION ${failFunction}()
    `);
    try {
      const failed = await mutate(
        "DELETE",
        `/api/collections/${COLLECTIONS.posts}/documents/${targetId}/purge`,
        { expectedVersion: 2 },
      );
      expect(failed.statusCode, responseDiagnostic(failed)).toBe(500);

      const sourceAfterFailure = await read(
        `/api/collections/${COLLECTIONS.posts}/documents/${sourceId}`,
      );
      expect(sourceAfterFailure.json()).toMatchObject({
        version: 2,
        displayState: "published",
        draftRevisionId: null,
        data: { related: [targetId] },
      });
      const cascadeAfterFailure = await read(
        `/api/collections/${COLLECTIONS.comments}/documents/${cascadeId}`,
      );
      expect(cascadeAfterFailure.json()).toMatchObject({ version: 1 });
      const targetAfterFailure = await read(
        `/api/collections/${COLLECTIONS.posts}/documents/${targetId}`,
      );
      expect(targetAfterFailure.json()).toMatchObject({ version: 2, displayState: "deleted" });

      const durableCounts = await database.pool.query<{
        document_id: string;
        revision_count: string;
        event_count: string;
      }>(
        `SELECT d.id AS document_id,
                count(DISTINCT r.id)::text AS revision_count,
                count(DISTINCT e.id)::text AS event_count
         FROM ${qualifiedName(schemaName, "_xecms_documents")} d
         LEFT JOIN ${qualifiedName(schemaName, "_xecms_document_revisions")} r
           ON r.document_id = d.id
         LEFT JOIN ${qualifiedName(schemaName, "_xecms_document_events")} e
           ON e.document_id = d.id
         WHERE d.id = ANY($1::text[])
         GROUP BY d.id
         ORDER BY d.id`,
        [[cascadeId, sourceId, targetId]],
      );
      expect(durableCounts.rows).toEqual([
        { document_id: cascadeId, revision_count: "1", event_count: "1" },
        { document_id: sourceId, revision_count: "1", event_count: "2" },
        { document_id: targetId, revision_count: "1", event_count: "2" },
      ].sort((left, right) => left.document_id.localeCompare(right.document_id)));
    } finally {
      await database.pool.query(
        `DROP TRIGGER IF EXISTS ${failTrigger}
           ON ${qualifiedName(schemaName, "_xecms_documents")};
         DROP FUNCTION IF EXISTS ${failFunction}()`,
      );
    }

    const purged = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.posts}/documents/${targetId}/purge`,
      { expectedVersion: 2 },
    );
    expect(purged.statusCode, responseDiagnostic(purged)).toBe(204);

    const sourceAfterPurge = await read(
      `/api/collections/${COLLECTIONS.posts}/documents/${sourceId}`,
    );
    expect(sourceAfterPurge.json()).toMatchObject({
      version: 3,
      displayState: "published-with-draft",
      data: { related: [] },
    });
    expect(sourceAfterPurge.json().draftRevisionId).toEqual(expect.any(String));
    expect((await read(
      `/api/collections/${COLLECTIONS.comments}/documents/${cascadeId}`,
    )).statusCode).toBe(404);
    expect((await read(
      `/api/collections/${COLLECTIONS.posts}/documents/${targetId}`,
    )).statusCode).toBe(404);
  }, 120_000);

  it("keeps stable one/many relations across revisions and executes restrict, nullify and cascade purge policies", async () => {
    const invalidOne = await createPost({
      title: "Wrong one target",
      author: categoryRootAId,
    });
    expect(invalidOne.statusCode, responseDiagnostic(invalidOne)).toBe(422);
    expect(invalidOne.json()).toMatchObject({ code: "RELATION_TARGET_INVALID" });
    expect(invalidOne.json().details.issues[0]).toMatchObject({
      documentId: categoryRootAId,
      expectedCollectionId: COLLECTIONS.authors,
      actualCollectionId: COLLECTIONS.categories,
      reason: "collection-mismatch",
    });

    const invalidMany = await createPost({
      title: "Missing many target",
      author: authorId,
      related: ["doc_missing_relation_target"],
    });
    expect(invalidMany.statusCode, responseDiagnostic(invalidMany)).toBe(422);
    expect(invalidMany.json().code).toBe("RELATION_TARGET_INVALID");
    expect(invalidMany.json().details.issues[0]).toMatchObject({
      documentId: "doc_missing_relation_target",
      expectedCollectionId: COLLECTIONS.posts,
      reason: "not-found",
    });

    const invalidUpload = await createPost({
      title: "Missing upload target",
      author: authorId,
      cover: "media_missing_upload_target",
    });
    expect(invalidUpload.statusCode, responseDiagnostic(invalidUpload)).toBe(422);
    expect(invalidUpload.json().code).toBe("MEDIA_REFERENCE_INVALID");

    const target = await createPost({ title: "Target", author: authorId });
    expect(target.statusCode, responseDiagnostic(target)).toBe(201);
    postTargetId = target.json().id as string;
    const source = await createPost({
      title: "Source",
      author: authorId,
      category: categoryRootAId,
      related: [postTargetId],
    });
    expect(source.statusCode, responseDiagnostic(source)).toBe(201);
    postSourceId = source.json().id as string;
    const comment = await mutate(
      "POST",
      `/api/collections/${COLLECTIONS.comments}/documents`,
      { data: { message: "Cascade me", post: postTargetId } },
    );
    expect(comment.statusCode, responseDiagnostic(comment)).toBe(201);
    commentId = comment.json().id as string;

    const authorUpdated = await mutate(
      "PATCH",
      `/api/collections/${COLLECTIONS.authors}/documents/${authorId}`,
      { data: { name: "Ada Lovelace" }, expectedVersion: 1 },
    );
    expect(authorUpdated.statusCode, responseDiagnostic(authorUpdated)).toBe(200);
    expect(authorUpdated.json().version).toBe(2);

    const sourceUpdated = await mutate(
      "PATCH",
      `/api/collections/${COLLECTIONS.posts}/documents/${postSourceId}`,
      {
        data: {
          title: "Source edited",
          author: authorId,
          category: categoryRootAId,
          related: [postTargetId],
        },
        expectedVersion: 1,
      },
    );
    expect(sourceUpdated.statusCode, responseDiagnostic(sourceUpdated)).toBe(200);
    expect(sourceUpdated.json()).toMatchObject({
      version: 2,
      data: {
        author: authorId,
        related: [postTargetId],
      },
    });
    const revisions = await read(
      `/api/collections/${COLLECTIONS.posts}/documents/${postSourceId}/revisions`,
    );
    expect(revisions.json().items).toHaveLength(2);
    for (const revision of revisions.json().items as readonly { id: string }[]) {
      const detail = await read(
        `/api/collections/${COLLECTIONS.posts}/documents/${postSourceId}/revisions/${revision.id}`,
      );
      expect(detail.json().data).toMatchObject({
        author: authorId,
        related: [postTargetId],
      });
    }
    const relationRows = await database.pool.query<{
      field_name: string;
      target_document_id: string;
    }>(
      `SELECT field_name, target_document_id
       FROM ${qualifiedName(schemaName, "_xecms_document_relations")}
       WHERE source_document_id = $1
       ORDER BY field_name, ordinal`,
      [postSourceId],
    );
    expect(relationRows.rows).toEqual([
      { field_name: "author", target_document_id: authorId },
      { field_name: "category", target_document_id: categoryRootAId },
      { field_name: "related", target_document_id: postTargetId },
    ]);

    const categoryDeleted = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.categories}/documents/${categoryRootAId}`,
      { expectedVersion: 1 },
    );
    expect(categoryDeleted.statusCode, responseDiagnostic(categoryDeleted)).toBe(204);
    const categoryPurged = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.categories}/documents/${categoryRootAId}/purge`,
      { expectedVersion: 2 },
    );
    expect(categoryPurged.statusCode, responseDiagnostic(categoryPurged)).toBe(204);
    const sourceAfterNullify = await read(
      `/api/collections/${COLLECTIONS.posts}/documents/${postSourceId}`,
    );
    expect(sourceAfterNullify.json().version).toBe(3);
    expect(sourceAfterNullify.json().data).not.toHaveProperty("category");
    expect(sourceAfterNullify.json().data.related).toEqual([postTargetId]);

    const targetDeleted = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.posts}/documents/${postTargetId}`,
      { expectedVersion: 1 },
    );
    expect(targetDeleted.statusCode, responseDiagnostic(targetDeleted)).toBe(204);
    const targetPurged = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.posts}/documents/${postTargetId}/purge`,
      { expectedVersion: 2 },
    );
    expect(targetPurged.statusCode, responseDiagnostic(targetPurged)).toBe(204);
    const sourceAfterCascade = await read(
      `/api/collections/${COLLECTIONS.posts}/documents/${postSourceId}`,
    );
    expect(sourceAfterCascade.json().version).toBe(4);
    expect(sourceAfterCascade.json().data.related).toEqual([]);
    const commentAfterCascade = await read(
      `/api/collections/${COLLECTIONS.comments}/documents/${commentId}`,
    );
    expect(commentAfterCascade.statusCode).toBe(404);
    const targetAfterPurge = await read(
      `/api/collections/${COLLECTIONS.posts}/documents/${postTargetId}`,
    );
    expect(targetAfterPurge.statusCode).toBe(404);

    const authorDeleted = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.authors}/documents/${authorId}`,
      { expectedVersion: 2 },
    );
    expect(authorDeleted.statusCode, responseDiagnostic(authorDeleted)).toBe(204);
    const restricted = await mutate(
      "DELETE",
      `/api/collections/${COLLECTIONS.authors}/documents/${authorId}/purge`,
      { expectedVersion: 3 },
    );
    expect(restricted.statusCode, responseDiagnostic(restricted)).toBe(409);
    expect(restricted.json().code).toBe("RELATION_DELETE_RESTRICTED");

    const deletedAuthors = await read(
      `/api/collections/${COLLECTIONS.authors}/documents?state=deleted`,
    );
    expect(deletedAuthors.json().items).toEqual([
      expect.objectContaining({ id: authorId, version: 3 }),
    ]);
  }, 120_000);

  async function read(url: string): Promise<LightMyRequestResponse> {
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

  async function createCategory(
    title: string,
    parentId: string | null,
    position: number,
    expectedVersion: number,
  ): Promise<LightMyRequestResponse> {
    return mutate("POST", `/api/collections/${COLLECTIONS.categories}/documents`, {
      data: { title },
      hierarchy: { parentId, position, expectedVersion },
    });
  }

  async function moveCategory(
    documentId: string,
    newParentId: string | null,
    position: number,
    expectedVersion: number,
  ): Promise<LightMyRequestResponse> {
    const policy = await read("/api/authorization/policy");
    if (policy.statusCode !== 200) return policy;
    return mutate(
      "POST",
      `/api/collections/${COLLECTIONS.categories}/documents/${documentId}/move`,
      {
        newParentId,
        position,
        expectedVersion,
        expectedPolicyRevision: policy.json().revision,
      },
    );
  }

  async function createPost(data: Readonly<Record<string, unknown>>): Promise<LightMyRequestResponse> {
    return mutate("POST", `/api/collections/${COLLECTIONS.posts}/documents`, { data });
  }
});

function validSettings(mediaId: string): Readonly<Record<string, unknown>> {
  return {
    name: "XeCMS",
    description: "A complete M2 settings document",
    launchDate: "2026-07-15",
    contentUpdatedAt: "2026-07-15T09:30:00+09:00",
    theme: "dark",
    channels: ["web", "app"],
    score: 42.5,
    enabled: true,
    metadata: {
      nested: { count: 2, active: true },
      labels: ["m2", null, 7],
    },
    preferences: { locale: "ko-KR", compact: false },
    cards: [
      { heading: "First", body: "First card" },
      { heading: "Second", body: "Second card" },
    ],
    seo: { title: "XeCMS", description: "Ultimate CMS" },
    body: {
      format: "xecms.rich-text",
      formatVersion: 2,
      content: [
        {
          id: "blk-m2-hello",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "Hello M2", styles: { bold: true } }],
          children: [],
        },
      ],
    },
    blocks: [
      {
        componentId: "cmp_m2_callout",
        data: { tone: "info", body: "Portable component block" },
      },
    ],
    logo: mediaId,
  };
}

function withoutKey(
  source: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const output = { ...source };
  delete output[key];
  return output;
}

function treeDocumentId(node: unknown): string {
  return (node as { readonly document: { readonly id: string } }).document.id;
}

function treeDepth(node: unknown): number {
  return (node as { readonly depth: number }).depth;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function responseDiagnostic(response: LightMyRequestResponse): string {
  return `${response.statusCode} ${response.body}`;
}
