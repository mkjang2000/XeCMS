import { describe, expect, it } from "vitest";

import {
  archiveDocument,
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  assertDocumentInvariants,
  createDocument,
  createDraft,
  publishDocument,
  type DocumentAggregate,
  type JsonObject,
} from "./index.js";

const actorId = asSubjectId("subject_invariant_tester");
const time1 = asUtcInstant("2026-07-14T00:00:00Z");
const time2 = asUtcInstant("2026-07-14T01:00:00Z");

function oneRevision(): DocumentAggregate<JsonObject> {
  return createDocument<JsonObject>({
    documentId: asDocumentId("doc_invariants"),
    workspaceId: asWorkspaceId("workspace_main"),
    collectionId: asCollectionId("col_posts"),
    revisionId: asRevisionId("rev_1"),
    schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
    data: { title: "First" },
    actorId,
    now: time1,
  }).state;
}

function twoRevisions(): DocumentAggregate<JsonObject> {
  return createDraft(oneRevision(), {
    revisionId: asRevisionId("rev_2"),
    schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
    data: { title: "Second" },
    actorId,
    now: time2,
    expectedVersion: 1,
  }).state;
}

describe("document invariants", () => {
  it("requires revisions to be ordered, contiguous, and linearly parented", () => {
    const valid = twoRevisions();
    const reversed: DocumentAggregate<JsonObject> = {
      ...valid,
      revisions: [valid.revisions[1]!, valid.revisions[0]!],
    };
    expect(() => assertDocumentInvariants(reversed)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }),
    );

    const brokenParent: DocumentAggregate<JsonObject> = {
      ...valid,
      revisions: [valid.revisions[0]!, { ...valid.revisions[1]!, parentRevisionId: null }],
    };
    expect(() => assertDocumentInvariants(brokenParent)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }),
    );

    const reusedCreateOrigin: DocumentAggregate<JsonObject> = {
      ...valid,
      revisions: [valid.revisions[0]!, { ...valid.revisions[1]!, origin: { kind: "create" } }],
    };
    expect(() => assertDocumentInvariants(reusedCreateOrigin)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }),
    );
  });

  it("requires working pointers to be distinct and the draft to be latest", () => {
    const published = publishDocument(oneRevision(), {
      actorId,
      now: time2,
      expectedVersion: 1,
    }).state;
    const edited = createDraft(published, {
      revisionId: asRevisionId("rev_2"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
      data: { title: "Second" },
      actorId,
      now: asUtcInstant("2026-07-14T02:00:00Z"),
      expectedVersion: 2,
    }).state;
    const duplicatePointer: DocumentAggregate<JsonObject> = {
      ...edited,
      identity: { ...edited.identity, currentDraftRevisionId: asRevisionId("rev_1") },
    };

    expect(() => assertDocumentInvariants(duplicatePointer)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }),
    );
  });

  it("requires aggregate and revision chronology", () => {
    const valid = twoRevisions();
    const regressed: DocumentAggregate<JsonObject> = {
      ...valid,
      identity: { ...valid.identity, updatedAt: time1 },
    };
    expect(() => assertDocumentInvariants(regressed)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }),
    );

    const lowVersion: DocumentAggregate<JsonObject> = { ...valid, aggregateVersion: 1 };
    expect(() => assertDocumentInvariants(lowVersion)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }),
    );
  });

  it("validates an incoming aggregate before applying a command", () => {
    const valid = twoRevisions();
    const corrupt: DocumentAggregate<JsonObject> = {
      ...valid,
      identity: { ...valid.identity, currentDraftRevisionId: asRevisionId("rev_missing") },
    };

    expect(() =>
      archiveDocument(corrupt, {
        actorId,
        now: asUtcInstant("2026-07-14T03:00:00Z"),
        expectedVersion: valid.aggregateVersion,
      }),
    ).toThrowError(expect.objectContaining({ code: "DOCUMENT_INVARIANT_VIOLATION" }));
  });
});
