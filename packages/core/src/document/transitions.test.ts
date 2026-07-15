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
  getDisplayState,
  publishDocument,
  restoreDeletedDocument,
  restoreRevision,
  softDeleteDocument,
  unarchiveDocument,
  unpublishDocument,
  DocumentDomainError,
  type DocumentAggregate,
  type DocumentDisplayState,
  type DocumentCommandResult,
  type JsonObject,
} from "./index.js";

const actorId = asSubjectId("subject_transition_tester");
const schemaRevisionId = asSchemaRevisionId("schema_rev_1");

interface Fixture {
  readonly state: DocumentAggregate<JsonObject>;
  readonly step: number;
}

function instant(step: number) {
  return asUtcInstant(new Date(Date.UTC(2026, 6, 14, 0, step)).toISOString());
}

function draftFixture(): Fixture {
  return {
    state: createDocument<JsonObject>({
      documentId: asDocumentId("doc_transition"),
      workspaceId: asWorkspaceId("workspace_main"),
      collectionId: asCollectionId("col_posts"),
      revisionId: asRevisionId("rev_1"),
      schemaRevisionId,
      data: { title: "Revision 1" },
      actorId,
      now: instant(0),
    }).state,
    step: 1,
  };
}

function publish(fixture: Fixture): Fixture {
  return advance(
    fixture,
    publishDocument(fixture.state, metadata(fixture)),
  );
}

function edit(fixture: Fixture): Fixture {
  return advance(
    fixture,
    createDraft(fixture.state, {
      ...metadata(fixture),
      revisionId: asRevisionId(`rev_${fixture.step + 1}`),
      schemaRevisionId,
      data: { title: `Revision ${fixture.step + 1}` },
    }),
  );
}

function archive(fixture: Fixture): Fixture {
  return advance(fixture, archiveDocument(fixture.state, metadata(fixture)));
}

function remove(fixture: Fixture): Fixture {
  return advance(
    fixture,
    softDeleteDocument(fixture.state, { ...metadata(fixture), reason: "matrix deletion" }),
  );
}

function metadata(fixture: Fixture) {
  return {
    actorId,
    now: instant(fixture.step),
    expectedVersion: fixture.state.aggregateVersion,
  } as const;
}

function advance(fixture: Fixture, result: DocumentCommandResult<JsonObject>): Fixture {
  return { state: result.state, step: fixture.step + 1 };
}

const activeFactories = {
  draft: draftFixture,
  published: () => publish(draftFixture()),
  "published-with-draft": () => edit(publish(draftFixture())),
} as const;

type ActiveState = keyof typeof activeFactories;

describe("document transition matrix", () => {
  describe("unpublish", () => {
    it.each(["published", "published-with-draft"] satisfies readonly ActiveState[])(
      "converts %s to its correct draft pointer",
      (name) => {
        const fixture = activeFactories[name]();
        const previousPublication = fixture.state.identity.publication;
        const previousDraft = fixture.state.identity.currentDraftRevisionId;
        const result = unpublishDocument(fixture.state, metadata(fixture));

        expect(result.state.identity.publication).toBeNull();
        expect(result.state.identity.currentDraftRevisionId).toBe(
          previousDraft ?? previousPublication?.revisionId,
        );
        expect(getDisplayState(result.state)).toBe("draft");
        expect(result.events[0]).toEqual(
          expect.objectContaining({ type: "document.unpublished", previousPublication }),
        );
      },
    );

    it.each([
      ["draft", () => draftFixture(), "DOCUMENT_PUBLICATION_NOT_FOUND"],
      ["archived", () => archive(publish(draftFixture())), "DOCUMENT_ARCHIVED"],
      ["deleted", () => remove(publish(draftFixture())), "DOCUMENT_DELETED"],
    ] as const)("rejects %s", (_name, factory, code) => {
      const fixture = factory();
      expect(() => unpublishDocument(fixture.state, metadata(fixture))).toThrowError(
        expect.objectContaining({ code }),
      );
    });
  });

  describe("archive and unarchive", () => {
    it.each(Object.keys(activeFactories) as ActiveState[])("archives and restores %s", (name) => {
      const source = activeFactories[name]();
      const archived = archiveDocument(source.state, metadata(source)).state;
      expect(getDisplayState(archived)).toBe("archived");
      expect(archived.identity.currentDraftRevisionId).toBe(source.state.identity.currentDraftRevisionId);
      expect(archived.identity.publication).toEqual(source.state.identity.publication);

      const restored = unarchiveDocument(archived, {
        actorId,
        now: instant(source.step + 1),
        expectedVersion: archived.aggregateVersion,
      });
      expect(getDisplayState(restored.state)).toBe(name);
      expect(restored.events[0]).toEqual(
        expect.objectContaining({ type: "document.unarchived", previousLifecycle: archived.identity.lifecycle }),
      );
    });

    it("rejects repeated archive, active unarchive, and deleted unarchive", () => {
      const archived = archive(draftFixture());
      expect(() => archiveDocument(archived.state, metadata(archived))).toThrowError(
        expect.objectContaining({ code: "DOCUMENT_ALREADY_ARCHIVED" }),
      );
      const draft = draftFixture();
      expect(() => unarchiveDocument(draft.state, metadata(draft))).toThrowError(
        expect.objectContaining({ code: "DOCUMENT_NOT_ARCHIVED" }),
      );
      const deletedArchived = remove(archived);
      expect(() => unarchiveDocument(deletedArchived.state, metadata(deletedArchived))).toThrowError(
        expect.objectContaining({ code: "DOCUMENT_DELETED" }),
      );
    });
  });

  describe("soft delete and restore", () => {
    it.each(Object.keys(activeFactories) as ActiveState[])("round-trips active %s", (name) => {
      const source = activeFactories[name]();
      const deleted = softDeleteDocument(source.state, {
        ...metadata(source),
        reason: "  content retention test  ",
      });
      expect(getDisplayState(deleted.state)).toBe("deleted");
      expect(deleted.state.identity.deletion?.reason).toBe("content retention test");
      expect(deleted.state.identity.currentDraftRevisionId).toBe(source.state.identity.currentDraftRevisionId);
      expect(deleted.state.identity.publication).toEqual(source.state.identity.publication);

      const restored = restoreDeletedDocument(deleted.state, {
        actorId,
        now: instant(source.step + 1),
        expectedVersion: deleted.state.aggregateVersion,
      });
      expect(getDisplayState(restored.state)).toBe(name);
      expect(restored.events[0]).toEqual(
        expect.objectContaining({ type: "document.restored", previousDeletion: deleted.state.identity.deletion }),
      );
    });

    it.each(Object.keys(activeFactories) as ActiveState[])("round-trips archived %s", (name) => {
      const source = archive(activeFactories[name]());
      const deleted = remove(source);
      const restored = restoreDeletedDocument(deleted.state, metadata(deleted));

      expect(getDisplayState(restored.state)).toBe("archived");
      expect(restored.state.identity.lifecycle.kind).toBe("archived");
    });

    it("rejects repeated delete and restore of a non-deleted document", () => {
      const deleted = remove(draftFixture());
      expect(() => softDeleteDocument(deleted.state, metadata(deleted))).toThrowError(
        expect.objectContaining({ code: "DOCUMENT_ALREADY_DELETED" }),
      );
      const draft = draftFixture();
      expect(() => restoreDeletedDocument(draft.state, metadata(draft))).toThrowError(
        expect.objectContaining({ code: "DOCUMENT_NOT_DELETED" }),
      );
    });
  });

  describe("revision restore", () => {
    it.each(Object.keys(activeFactories) as ActiveState[])("creates a new latest draft from %s", (name) => {
      const fixture = activeFactories[name]();
      const publishedRevision = fixture.state.identity.publication?.revisionId ?? null;
      const result = restoreRevision(fixture.state, {
        ...metadata(fixture),
        sourceRevisionId: asRevisionId("rev_1"),
        newRevisionId: asRevisionId("rev_restored"),
        schemaRevisionId,
      });

      expect(result.state.revisions).toHaveLength(fixture.state.revisions.length + 1);
      expect(result.state.identity.currentDraftRevisionId).toBe("rev_restored");
      expect(result.state.identity.publication?.revisionId ?? null).toBe(publishedRevision);
      expect(result.state.revisions.at(-1)?.data).toEqual(fixture.state.revisions[0]?.data);
      expect(result.state.revisions.at(-1)?.origin).toEqual({
        kind: "restore",
        restoredFromRevisionId: "rev_1",
      });
    });

    it.each([
      ["archived", () => archive(draftFixture()), "DOCUMENT_ARCHIVED"],
      ["deleted", () => remove(draftFixture()), "DOCUMENT_DELETED"],
    ] as const)("rejects %s documents", (_name, factory, code) => {
      const fixture = factory();
      expect(() =>
        restoreRevision(fixture.state, {
          ...metadata(fixture),
          sourceRevisionId: asRevisionId("rev_1"),
          newRevisionId: asRevisionId("rev_restored"),
          schemaRevisionId,
        }),
      ).toThrowError(expect.objectContaining({ code }));
    });

    it("rejects missing source and reused destination IDs", () => {
      const fixture = draftFixture();
      expect(() =>
        restoreRevision(fixture.state, {
          ...metadata(fixture),
          sourceRevisionId: asRevisionId("rev_missing"),
          newRevisionId: asRevisionId("rev_2"),
          schemaRevisionId,
        }),
      ).toThrowError(expect.objectContaining({ code: "DOCUMENT_REVISION_NOT_FOUND" }));
      expect(() =>
        restoreRevision(fixture.state, {
          ...metadata(fixture),
          sourceRevisionId: asRevisionId("rev_1"),
          newRevisionId: asRevisionId("rev_1"),
          schemaRevisionId,
        }),
      ).toThrowError(expect.objectContaining({ code: "DOCUMENT_REVISION_ID_CONFLICT" }));
    });
  });
});

type ModelAction =
  | "publish"
  | "unpublish"
  | "archive"
  | "unarchive"
  | "delete"
  | "restore-delete"
  | "restore-revision";

interface StateModel {
  readonly deleted: boolean;
  readonly archived: boolean;
  readonly draft: boolean;
  readonly published: boolean;
}

const actions: readonly ModelAction[] = [
  "publish",
  "unpublish",
  "archive",
  "unarchive",
  "delete",
  "restore-delete",
  "restore-revision",
];

describe("deterministic model-based transition exploration", () => {
  it("matches the reference state machine for every action sequence through depth four", () => {
    const sequences = enumerateSequences(actions, 4);

    sequences.forEach((sequence, sequenceIndex) => {
      let aggregate = draftFixture().state;
      let model: StateModel = { deleted: false, archived: false, draft: true, published: false };

      sequence.forEach((action, actionIndex) => {
        const expectation = applyModel(model, action);
        const previous = aggregate;
        const now = instant(sequenceIndex * 10 + actionIndex + 1);
        let result: DocumentCommandResult<JsonObject> | undefined;
        let error: unknown;

        try {
          result = executeAction(aggregate, action, now, sequenceIndex, actionIndex);
        } catch (caught) {
          error = caught;
        }

        if (expectation.ok) {
          expect(error, `${sequence.join(" → ")} failed at ${action}`).toBeUndefined();
          expect(result).toBeDefined();
          if (result === undefined) {
            throw new TypeError("Expected a successful domain command result.");
          }
          aggregate = result.state;
          model = expectation.state;
          expect(aggregate.aggregateVersion).toBe(previous.aggregateVersion + 1);
          expect(result.events).toHaveLength(1);
          expect(result.events[0]).toEqual(
            expect.objectContaining({
              actorId,
              occurredAt: now,
              aggregateVersion: aggregate.aggregateVersion,
            }),
          );
          expect(Object.isFrozen(aggregate)).toBe(true);
          expect(() => assertDocumentInvariants(aggregate)).not.toThrow();
          expect(getDisplayState(aggregate)).toBe(displayState(model));
        } else {
          expect(result).toBeUndefined();
          expect(error).toBeInstanceOf(DocumentDomainError);
          expect((error as DocumentDomainError).code).toBe(expectation.code);
          expect(aggregate).toBe(previous);
        }
      });
    });
  });
});

type ModelResult =
  | { readonly ok: true; readonly state: StateModel }
  | { readonly ok: false; readonly code: string };

function applyModel(model: StateModel, action: ModelAction): ModelResult {
  switch (action) {
    case "publish":
      if (model.deleted) return denied("DOCUMENT_DELETED");
      if (model.archived) return denied("DOCUMENT_ARCHIVED");
      if (!model.draft) return denied("DOCUMENT_DRAFT_NOT_FOUND");
      return allowed({ ...model, draft: false, published: true });
    case "unpublish":
      if (model.deleted) return denied("DOCUMENT_DELETED");
      if (model.archived) return denied("DOCUMENT_ARCHIVED");
      if (!model.published) return denied("DOCUMENT_PUBLICATION_NOT_FOUND");
      return allowed({ ...model, draft: true, published: false });
    case "archive":
      if (model.deleted) return denied("DOCUMENT_DELETED");
      if (model.archived) return denied("DOCUMENT_ALREADY_ARCHIVED");
      return allowed({ ...model, archived: true });
    case "unarchive":
      if (model.deleted) return denied("DOCUMENT_DELETED");
      if (!model.archived) return denied("DOCUMENT_NOT_ARCHIVED");
      return allowed({ ...model, archived: false });
    case "delete":
      if (model.deleted) return denied("DOCUMENT_ALREADY_DELETED");
      return allowed({ ...model, deleted: true });
    case "restore-delete":
      if (!model.deleted) return denied("DOCUMENT_NOT_DELETED");
      return allowed({ ...model, deleted: false });
    case "restore-revision":
      if (model.deleted) return denied("DOCUMENT_DELETED");
      if (model.archived) return denied("DOCUMENT_ARCHIVED");
      return allowed({ ...model, draft: true });
  }
}

function executeAction(
  aggregate: DocumentAggregate<JsonObject>,
  action: ModelAction,
  now: ReturnType<typeof instant>,
  sequenceIndex: number,
  actionIndex: number,
): DocumentCommandResult<JsonObject> {
  const input = { actorId, now, expectedVersion: aggregate.aggregateVersion } as const;
  switch (action) {
    case "publish":
      return publishDocument(aggregate, input);
    case "unpublish":
      return unpublishDocument(aggregate, input);
    case "archive":
      return archiveDocument(aggregate, input);
    case "unarchive":
      return unarchiveDocument(aggregate, input);
    case "delete":
      return softDeleteDocument(aggregate, input);
    case "restore-delete":
      return restoreDeletedDocument(aggregate, input);
    case "restore-revision":
      return restoreRevision(aggregate, {
        ...input,
        sourceRevisionId: asRevisionId("rev_1"),
        newRevisionId: asRevisionId(`rev_restore_${sequenceIndex}_${actionIndex}`),
        schemaRevisionId,
      });
  }
}

function displayState(model: StateModel): DocumentDisplayState {
  if (model.deleted) return "deleted";
  if (model.archived) return "archived";
  if (model.published && model.draft) return "published-with-draft";
  if (model.published) return "published";
  return "draft";
}

function allowed(state: StateModel): ModelResult {
  return { ok: true, state };
}

function denied(code: string): ModelResult {
  return { ok: false, code };
}

function enumerateSequences<T>(values: readonly T[], depth: number): T[][] {
  if (depth === 0) return [[]];
  const shorter = enumerateSequences(values, depth - 1);
  return shorter.flatMap((prefix) => values.map((value) => [...prefix, value]));
}
