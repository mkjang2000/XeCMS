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
  createDocument,
  createDraft,
  getDisplayState,
  getPublicRevision,
  isDocumentDeleted,
  publishDocument,
  restoreRevision,
  type JsonObject,
} from "./index.js";

const authorId = asSubjectId("subject_author");
const time1 = asUtcInstant("2026-07-14T00:00:00Z");
const time2 = asUtcInstant("2026-07-14T01:00:00Z");
const time3 = asUtcInstant("2026-07-14T02:00:00Z");

function newDocument(data: JsonObject = { title: "First" }) {
  return createDocument<JsonObject>({
    documentId: asDocumentId("doc_post"),
    workspaceId: asWorkspaceId("workspace_main"),
    collectionId: asCollectionId("col_posts"),
    revisionId: asRevisionId("rev_1"),
    schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
    data,
    actorId: authorId,
    now: time1,
  }).state;
}

describe("document aggregate", () => {
  it("creates identity and the initial draft atomically", () => {
    const document = newDocument();

    expect(document.identity.currentDraftRevisionId).toBe("rev_1");
    expect(document.identity.publication).toBeNull();
    expect(document.identity.updatedAt).toBe(time1);
    expect(document.revisions).toHaveLength(1);
    expect(getDisplayState(document)).toBe("draft");
    expect(isDocumentDeleted(document)).toBe(false);
  });

  it("keeps a published revision stable while a new draft is edited", () => {
    const created = newDocument();
    const published = publishDocument(created, {
      actorId: authorId,
      now: time2,
      expectedVersion: 1,
    }).state;
    const edited = createDraft(published, {
      revisionId: asRevisionId("rev_2"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
      data: { title: "Second" },
      actorId: authorId,
      now: time3,
      expectedVersion: 2,
    }).state;

    expect(published.revisions[0]).toBe(created.revisions[0]);
    expect(edited.identity.publication?.revisionId).toBe("rev_1");
    expect(edited.identity.currentDraftRevisionId).toBe("rev_2");
    expect(getPublicRevision(edited)?.data).toEqual({ title: "First" });
    expect(getDisplayState(edited)).toBe("published-with-draft");
  });

  it("restores history into a new immutable draft and emits a dedicated event", () => {
    const published = publishDocument(newDocument(), {
      actorId: authorId,
      now: time2,
      expectedVersion: 1,
    }).state;
    const edited = createDraft(published, {
      revisionId: asRevisionId("rev_2"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
      data: { title: "Second" },
      actorId: authorId,
      now: time3,
      expectedVersion: 2,
    }).state;
    const result = restoreRevision(edited, {
      sourceRevisionId: asRevisionId("rev_1"),
      newRevisionId: asRevisionId("rev_3"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
      actorId: authorId,
      now: asUtcInstant("2026-07-14T03:00:00Z"),
      expectedVersion: 3,
      reason: "  revert accidental edit  ",
    });

    expect(result.state.identity.publication?.revisionId).toBe("rev_1");
    expect(result.state.identity.currentDraftRevisionId).toBe("rev_3");
    expect(result.state.revisions[2]?.origin).toEqual({
      kind: "restore",
      restoredFromRevisionId: "rev_1",
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "document.revision-restored",
        sourceRevisionId: "rev_1",
        actorId: authorId,
        aggregateVersion: 4,
        reason: "revert accidental edit",
      }),
    ]);
  });

  it("keeps the source immutable while restoring schema-validated data", () => {
    const source = newDocument({ title: "Legacy" });
    const result = restoreRevision(source, {
      sourceRevisionId: asRevisionId("rev_1"),
      newRevisionId: asRevisionId("rev_2"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_2"),
      restoredData: { title: "Legacy", summary: "Defaulted by the active schema" },
      actorId: authorId,
      now: time2,
      expectedVersion: 1,
    });

    expect(result.state.revisions[0]?.data).toEqual({ title: "Legacy" });
    expect(result.state.revisions[1]?.data).toEqual({
      title: "Legacy",
      summary: "Defaulted by the active schema",
    });
    expect(result.state.revisions[1]?.schemaRevisionId).toBe("schema_rev_2");
  });

  it("clones and deeply freezes revision data, aggregate state, and events", () => {
    const input = { title: "First", nested: { tags: ["stable"] } };
    const result = createDocument<JsonObject>({
      documentId: asDocumentId("doc_immutable"),
      workspaceId: asWorkspaceId("workspace_main"),
      collectionId: asCollectionId("col_posts"),
      revisionId: asRevisionId("rev_immutable_1"),
      schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
      data: input,
      actorId: authorId,
      now: time1,
      reason: "initial import",
    });

    input.title = "mutated input";
    input.nested.tags.push("mutated input");

    expect(result.state.revisions[0]?.data).toEqual({ title: "First", nested: { tags: ["stable"] } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.identity)).toBe(true);
    expect(Object.isFrozen(result.state.revisions)).toBe(true);
    expect(Object.isFrozen(result.state.revisions[0])).toBe(true);
    expect(Object.isFrozen(result.state.revisions[0]?.data)).toBe(true);
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(Object.isFrozen(result.events[0])).toBe(true);

    expect(() => {
      (result.state.revisions[0]?.data as { title: string }).title = "tampered";
    }).toThrow(TypeError);
  });

  it("rejects stale commands and timestamps older than the current aggregate", () => {
    const created = newDocument();
    const archived = archiveDocument(created, {
      actorId: authorId,
      now: time2,
      expectedVersion: 1,
    }).state;

    expect(() =>
      archiveDocument(created, {
        actorId: authorId,
        now: time2,
        expectedVersion: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "DOCUMENT_VERSION_CONFLICT" }));

    expect(() =>
      createDraft(archived, {
        revisionId: asRevisionId("rev_2"),
        schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
        data: { title: "Blocked" },
        actorId: authorId,
        now: time1,
        expectedVersion: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: "DOCUMENT_ARCHIVED" }));

    expect(() =>
      archiveDocument(
        // Unarchive is covered by the transition matrix; use a copied active
        // aggregate here to isolate timestamp validation.
        { ...created, aggregateVersion: 2, identity: { ...created.identity, updatedAt: time2 } },
        { actorId: authorId, now: time1, expectedVersion: 2 },
      ),
    ).toThrowError(expect.objectContaining({ code: "DOCUMENT_TIMESTAMP_REGRESSION" }));
  });
});
