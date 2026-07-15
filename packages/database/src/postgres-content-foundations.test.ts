import { randomUUID } from "node:crypto";
import {
  type MediaRecord,
} from "@xecms/application";
import {
  asCollectionId,
  asDocumentId,
  type DocumentRelationEdge,
} from "@xecms/core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quoteIdentifier } from "./identifiers.js";
import { migrateCore } from "./migrate.js";
import { PostgresMediaStore } from "./postgres-media.js";
import { PostgresRelationStore } from "./postgres-relations.js";

describe("M2 storage adapter validation", () => {
  it("rejects unsafe schemas without issuing queries", () => {
    expect(() => new PostgresRelationStore({} as Pool, "public; drop schema public")).toThrow();
    expect(() => new PostgresMediaStore({} as Pool, "../unsafe")).toThrow();
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("M2 relation/media PostgreSQL foundations", () => {
  const schema = `xecms_m2_foundation_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  const relations = new PostgresRelationStore(pool, schema);
  const media = new PostgresMediaStore(pool, schema);

  beforeAll(async () => {
    await migrateCore(pool, schema);
    const q = (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
    await pool.query(
      `INSERT INTO ${q("_xecms_schema_revisions")}
         (revision_id, parent_revision_id, schema_json, diff_json, hash, created_at, created_by)
       VALUES ('schema_relation', NULL, '{"format":"xecms.schema","formatVersion":1,"collections":[]}',
               '[]', 'test', now(), 'subject_owner')`,
    );
    await pool.query(
      `INSERT INTO ${q("_xecms_documents")}
         (id, workspace_id, collection_id, current_draft_revision_id, publication, lifecycle,
          deletion, created_at, created_by, updated_at, updated_by, aggregate_version)
       VALUES
         ('doc_source', 'wrk_default', 'col_posts', NULL, NULL, '{"kind":"active"}', NULL,
          now(), 'subject_owner', now(), 'subject_owner', 1),
         ('doc_target', 'wrk_default', 'col_authors', NULL, NULL, '{"kind":"active"}', NULL,
          now(), 'subject_owner', now(), 'subject_owner', 1)`,
    );
    await pool.query(
      `INSERT INTO ${q("_xecms_document_revisions")}
         (id, document_id, sequence, schema_revision_id, data, parent_revision_id, origin, created_at, created_by)
       VALUES
         ('rev_source', 'doc_source', 1, 'schema_relation',
          '{"author":"doc_target"}',
          NULL, '{"kind":"create"}', now(), 'subject_owner'),
         ('rev_target', 'doc_target', 1, 'schema_relation', '{}',
          NULL, '{"kind":"create"}', now(), 'subject_owner')`,
    );
    await pool.query(
      `UPDATE ${q("_xecms_documents")} SET current_draft_revision_id =
         CASE id WHEN 'doc_source' THEN 'rev_source' ELSE 'rev_target' END
       WHERE id IN ('doc_source', 'doc_target')`,
    );
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("validates target collection/existence and round-trips stable edges", async () => {
    const edge: DocumentRelationEdge = {
      relationId: "rel_author",
      fieldName: "author",
      sourceCollectionId: asCollectionId("col_posts"),
      sourceDocumentId: asDocumentId("doc_source"),
      targetCollectionId: asCollectionId("col_authors"),
      targetDocumentId: asDocumentId("doc_target"),
      ordinal: 0,
      onDelete: "restrict",
    };
    await expect(relations.validateAndReplaceDocumentRelations({
      sourceCollectionId: "col_posts",
      sourceDocumentId: "doc_source",
      expectedDocumentVersion: 1,
      edges: [edge],
    })).resolves.toEqual({ status: "committed" });
    const incoming = await relations.listIncomingDocumentRelations({
      targetCollectionId: "col_authors",
      targetDocumentId: "doc_target",
    });
    expect(incoming).toEqual([
      expect.objectContaining({ edge: expect.objectContaining({ targetDocumentId: "doc_target" }) }),
    ]);

    const q = (name: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
    await pool.query(
      `UPDATE ${q("_xecms_documents")}
       SET current_draft_revision_id = NULL,
           publication = '{"revisionId":"rev_source","publishedAt":"2026-07-15T00:00:00.000Z","publishedBy":"subject_owner"}'::jsonb
       WHERE id = 'doc_source'`,
    );
    await expect(relations.listIncomingDocumentRelations({
      targetCollectionId: "col_authors",
      targetDocumentId: "doc_target",
    })).resolves.toEqual([
      expect.objectContaining({
        edge: expect.objectContaining({ sourceDocumentId: "doc_source" }),
        sourceData: { author: "doc_target" },
      }),
    ]);

    const invalid = await relations.validateAndReplaceDocumentRelations({
      sourceCollectionId: "col_posts",
      sourceDocumentId: "doc_source",
      expectedDocumentVersion: 1,
      edges: [{ ...edge, targetDocumentId: asDocumentId("doc_missing") }],
    });
    expect(invalid).toEqual({
      status: "invalid-targets",
      issues: [{
        documentId: "doc_missing",
        expectedCollectionId: "col_authors",
        reason: "not-found",
      }],
    });
  });

  it("round-trips pending/ready/failed media metadata with state CAS", async () => {
    const pending: MediaRecord = {
      id: "media_pg",
      workspaceId: "wrk_default",
      originalFileName: "photo.png",
      mimeType: "image/png",
      storageKey: "objects/media_pg",
      status: "pending",
      size: null,
      sha256: null,
      createdAt: "2026-07-15T12:00:00Z",
      createdBy: "subject_owner",
    };
    await media.reserveMedia(pending);
    const ready = await media.completeMedia({
      id: pending.id,
      expectedStatus: "pending",
      size: 8,
      sha256: "a".repeat(64),
    });
    expect(ready).toMatchObject({ status: "ready", size: 8, sha256: "a".repeat(64) });
    expect(await media.getMedia(pending.id)).toEqual(ready);
    await expect(media.failMedia({
      id: pending.id,
      expectedStatus: "pending",
      reason: "late failure",
    })).rejects.toMatchObject({ code: "MEDIA_STATE_CONFLICT" });

    await expect(media.validateAndReplaceDocumentMedia({
      workspaceId: "wrk_default",
      sourceDocumentId: "doc_source",
      expectedDocumentVersion: 1,
      edges: [{
        sourceDocumentId: "doc_source",
        fieldName: "cover",
        mediaId: pending.id,
        ordinal: 0,
        acceptedMimeTypes: ["image/jpeg"],
      }],
    })).resolves.toEqual({
      status: "invalid-media",
      issues: [{
        mediaId: pending.id,
        reason: "mime-not-accepted",
        actualMimeType: "image/png",
        acceptedMimeTypes: ["image/jpeg"],
      }],
    });

    await expect(media.validateAndReplaceDocumentMedia({
      workspaceId: "wrk_default",
      sourceDocumentId: "doc_source",
      expectedDocumentVersion: 1,
      edges: [{
        sourceDocumentId: "doc_source",
        fieldName: "cover",
        mediaId: pending.id,
        ordinal: 0,
        acceptedMimeTypes: ["image/*"],
      }],
    })).resolves.toEqual({ status: "committed" });
    await expect(media.listMediaUsages(pending.id)).resolves.toEqual([{
      sourceDocumentId: "doc_source",
      fieldName: "cover",
      mediaId: pending.id,
      ordinal: 0,
    }]);
    await expect(media.deleteMediaRecord({
      id: pending.id,
      expectedStatus: "ready",
    })).rejects.toMatchObject({ code: "MEDIA_IN_USE", status: 409 });
    expect(await media.getMedia(pending.id)).toEqual(ready);
  });
});
