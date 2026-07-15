import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  createDocument,
  createDocumentReference,
  decodeDocumentReference,
  isDocumentReference,
  type JsonObject,
} from "./index.js";

const collectionId = asCollectionId("col_authors");
const documentId = asDocumentId("doc_author_1");

describe("document relation references", () => {
  it("creates and decodes the canonical immutable DocumentId reference", () => {
    const reference = createDocumentReference({ collectionId, documentId });
    const decoded = decodeDocumentReference({
      $xecmsRef: "document",
      collectionId: "col_authors",
      documentId: "doc_author_1",
    });

    expect(reference).toEqual(decoded);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(isDocumentReference(decoded)).toBe(true);
    expect(isDocumentReference({ documentId })).toBe(false);
  });

  it("rejects RevisionId references at the type boundary", () => {
    if (false) {
      // The brands make accidental RevisionId assignment a compile-time error.
      createDocumentReference({
        collectionId,
        // @ts-expect-error RevisionId cannot be used where DocumentId is required.
        documentId: asRevisionId("rev_1"),
      });
    }
  });

  it("rejects explicit revision references at runtime with a structured path", () => {
    expect(() =>
      createDocument<JsonObject>({
        documentId: asDocumentId("doc_post"),
        workspaceId: asWorkspaceId("workspace_main"),
        collectionId: asCollectionId("col_posts"),
        revisionId: asRevisionId("rev_post_1"),
        schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
        data: {
          title: "Invalid relation",
          authors: [
            {
              $xecmsRef: "revision",
              collectionId: "col_authors",
              documentId: "doc_author_1",
              revisionId: "rev_author_1",
            },
          ],
        },
        actorId: asSubjectId("subject_author"),
        now: asUtcInstant("2026-07-14T00:00:00Z"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DOCUMENT_RELATION_REVISION_FORBIDDEN",
        details: expect.objectContaining({ path: ["authors", 0] }),
      }),
    );
  });

  it("rejects revisionId smuggling and malformed canonical references", () => {
    expect(() =>
      decodeDocumentReference({
        $xecmsRef: "document",
        collectionId: "col_authors",
        documentId: "doc_author_1",
        revisionId: "rev_author_1",
      }),
    ).toThrowError(expect.objectContaining({ code: "DOCUMENT_RELATION_REVISION_FORBIDDEN" }));

    expect(() =>
      decodeDocumentReference({
        $xecmsRef: "document",
        collectionId: "col_authors",
        documentId: " doc_author_1 ",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "DOCUMENT_RELATION_INVALID",
        details: { path: ["documentId"] },
      }),
    );

    expect(() =>
      decodeDocumentReference({
        $xecmsRef: "document",
        collectionId: "col_authors",
        documentId: "doc_author_1",
        revision: "unexpected",
      }),
    ).toThrowError(expect.objectContaining({ code: "DOCUMENT_RELATION_INVALID" }));
  });

  it("accepts canonical references nested anywhere in document JSON", () => {
    const author = createDocumentReference({ collectionId, documentId });
    const result = createDocument<JsonObject>({
      documentId: asDocumentId("doc_post"),
      workspaceId: asWorkspaceId("workspace_main"),
      collectionId: asCollectionId("col_posts"),
      revisionId: asRevisionId("rev_post_1"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
      data: { title: "Valid relation", authors: [author] },
      actorId: asSubjectId("subject_author"),
      now: asUtcInstant("2026-07-14T00:00:00Z"),
    });

    expect(result.state.revisions[0]?.data["authors"]).toEqual([author]);
  });
});
