import { DocumentDomainError } from "./errors.js";
import { assertDocumentInvariants } from "./invariants.js";
import { deepFreeze } from "./json.js";
import { cloneDocumentData } from "./references.js";
import { findRevision, getWorkingRevision } from "./selectors.js";
import { isUtcInstant } from "./types.js";
import type {
  CollectionId,
  DocumentAggregate,
  DocumentCommandResult,
  DocumentEventMetadata,
  DocumentId,
  DocumentRevision,
  JsonObject,
  RevisionId,
  SchemaRevisionId,
  SubjectId,
  UtcInstant,
  WorkspaceId,
} from "./types.js";

export interface DocumentCommandMetadata {
  readonly actorId: SubjectId;
  readonly now: UtcInstant;
  readonly reason?: string;
}

export interface VersionedDocumentCommandMetadata extends DocumentCommandMetadata {
  readonly expectedVersion: number;
}

export interface CreateDocumentInput<TData extends JsonObject> extends DocumentCommandMetadata {
  readonly documentId: DocumentId;
  readonly workspaceId: WorkspaceId;
  readonly collectionId: CollectionId;
  readonly revisionId: RevisionId;
  readonly schemaRevisionId: SchemaRevisionId;
  readonly data: TData;
}

export interface CreateDraftInput<TData extends JsonObject> extends VersionedDocumentCommandMetadata {
  readonly revisionId: RevisionId;
  readonly schemaRevisionId: SchemaRevisionId;
  readonly data: TData;
}

export interface RestoreRevisionInput<TData extends JsonObject = JsonObject>
  extends VersionedDocumentCommandMetadata {
  readonly sourceRevisionId: RevisionId;
  readonly newRevisionId: RevisionId;
  readonly schemaRevisionId: SchemaRevisionId;
  /**
   * A schema-validated representation of the restored data. Application
   * services use this when an older revision is restored against a newer
   * active schema. The source revision itself always remains immutable.
   */
  readonly restoredData?: TData;
}

export type PublishDocumentInput = VersionedDocumentCommandMetadata;
export type UnpublishDocumentInput = VersionedDocumentCommandMetadata;
export type ArchiveDocumentInput = VersionedDocumentCommandMetadata;
export type UnarchiveDocumentInput = VersionedDocumentCommandMetadata;
export type SoftDeleteDocumentInput = VersionedDocumentCommandMetadata;
export type RestoreDeletedDocumentInput = VersionedDocumentCommandMetadata;

export function createDocument<TData extends JsonObject>(
  input: CreateDocumentInput<TData>,
): DocumentCommandResult<TData> {
  assertInitialCommandMetadata(input);
  const revision: DocumentRevision<TData> = {
    id: input.revisionId,
    documentId: input.documentId,
    sequence: 1,
    schemaRevisionId: input.schemaRevisionId,
    data: cloneDocumentData(input.data),
    parentRevisionId: null,
    origin: { kind: "create" },
    createdAt: input.now,
    createdBy: input.actorId,
  };
  const state: DocumentAggregate<TData> = {
    identity: {
      id: input.documentId,
      workspaceId: input.workspaceId,
      collectionId: input.collectionId,
      currentDraftRevisionId: revision.id,
      publication: null,
      lifecycle: { kind: "active" },
      deletion: null,
      createdAt: input.now,
      createdBy: input.actorId,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    revisions: [revision],
    aggregateVersion: 1,
  };
  return finalize(state, [
    {
      type: "document.created",
      documentId: input.documentId,
      revision,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function createDraft<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: CreateDraftInput<TData>,
): DocumentCommandResult<TData> {
  assertMutable(aggregate, input);
  assertUnusedRevisionId(aggregate, input.revisionId);
  const parent = getWorkingRevision(aggregate);
  const revision: DocumentRevision<TData> = {
    id: input.revisionId,
    documentId: aggregate.identity.id,
    sequence: nextSequence(aggregate),
    schemaRevisionId: input.schemaRevisionId,
    data: cloneDocumentData(input.data),
    parentRevisionId: parent.id,
    origin: { kind: "edit" },
    createdAt: input.now,
    createdBy: input.actorId,
  };
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      currentDraftRevisionId: revision.id,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    revisions: [...aggregate.revisions, revision],
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.draft-created",
      documentId: aggregate.identity.id,
      revision,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function publishDocument<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: PublishDocumentInput,
): DocumentCommandResult<TData> {
  assertMutable(aggregate, input);
  const draftId = aggregate.identity.currentDraftRevisionId;
  if (draftId === null) {
    throw new DocumentDomainError("DOCUMENT_DRAFT_NOT_FOUND", "A current draft is required to publish.");
  }
  const publication = {
    revisionId: draftId,
    publishedAt: input.now,
    publishedBy: input.actorId,
  } as const;
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      currentDraftRevisionId: null,
      publication,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.published",
      documentId: aggregate.identity.id,
      publication,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function unpublishDocument<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: UnpublishDocumentInput,
): DocumentCommandResult<TData> {
  assertMutable(aggregate, input);
  const publication = aggregate.identity.publication;
  if (publication === null) {
    throw new DocumentDomainError(
      "DOCUMENT_PUBLICATION_NOT_FOUND",
      "A current publication is required to unpublish.",
    );
  }
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      currentDraftRevisionId: aggregate.identity.currentDraftRevisionId ?? publication.revisionId,
      publication: null,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.unpublished",
      documentId: aggregate.identity.id,
      previousPublication: publication,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function restoreRevision<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: RestoreRevisionInput<TData>,
): DocumentCommandResult<TData> {
  assertMutable(aggregate, input);
  assertUnusedRevisionId(aggregate, input.newRevisionId);
  const source = findRevision(aggregate, input.sourceRevisionId);
  if (source === undefined) {
    throw new DocumentDomainError(
      "DOCUMENT_REVISION_NOT_FOUND",
      `Revision '${input.sourceRevisionId}' does not belong to this document.`,
    );
  }
  const parent = getWorkingRevision(aggregate);
  const revision: DocumentRevision<TData> = {
    id: input.newRevisionId,
    documentId: aggregate.identity.id,
    sequence: nextSequence(aggregate),
    schemaRevisionId: input.schemaRevisionId,
    data: cloneDocumentData(input.restoredData ?? source.data),
    parentRevisionId: parent.id,
    origin: { kind: "restore", restoredFromRevisionId: source.id },
    createdAt: input.now,
    createdBy: input.actorId,
  };
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      currentDraftRevisionId: revision.id,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    revisions: [...aggregate.revisions, revision],
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.revision-restored",
      documentId: aggregate.identity.id,
      revision,
      sourceRevisionId: source.id,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function archiveDocument<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: ArchiveDocumentInput,
): DocumentCommandResult<TData> {
  assertVersion(aggregate, input.expectedVersion);
  assertNotDeleted(aggregate);
  if (aggregate.identity.lifecycle.kind === "archived") {
    throw new DocumentDomainError("DOCUMENT_ALREADY_ARCHIVED", "The document is already archived.");
  }
  assertCommandTime(aggregate, input.now);
  const lifecycle = { kind: "archived", archivedAt: input.now, archivedBy: input.actorId } as const;
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      lifecycle,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.archived",
      documentId: aggregate.identity.id,
      lifecycle,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function unarchiveDocument<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: UnarchiveDocumentInput,
): DocumentCommandResult<TData> {
  assertVersion(aggregate, input.expectedVersion);
  assertNotDeleted(aggregate);
  if (aggregate.identity.lifecycle.kind !== "archived") {
    throw new DocumentDomainError("DOCUMENT_NOT_ARCHIVED", "The document is not archived.");
  }
  assertCommandTime(aggregate, input.now);
  const previousLifecycle = aggregate.identity.lifecycle;
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      lifecycle: { kind: "active" },
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.unarchived",
      documentId: aggregate.identity.id,
      previousLifecycle,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function softDeleteDocument<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: SoftDeleteDocumentInput,
): DocumentCommandResult<TData> {
  assertVersion(aggregate, input.expectedVersion);
  if (aggregate.identity.deletion !== null) {
    throw new DocumentDomainError("DOCUMENT_ALREADY_DELETED", "The document is already deleted.");
  }
  assertCommandTime(aggregate, input.now);
  const reason = normalizeReason(input.reason);
  const deletion = {
    deletedAt: input.now,
    deletedBy: input.actorId,
    ...(reason === undefined ? {} : { reason }),
  };
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      deletion,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.deleted",
      documentId: aggregate.identity.id,
      deletion,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

export function restoreDeletedDocument<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: RestoreDeletedDocumentInput,
): DocumentCommandResult<TData> {
  assertVersion(aggregate, input.expectedVersion);
  if (aggregate.identity.deletion === null) {
    throw new DocumentDomainError("DOCUMENT_NOT_DELETED", "The document is not deleted.");
  }
  assertCommandTime(aggregate, input.now);
  const previousDeletion = aggregate.identity.deletion;
  const state: DocumentAggregate<TData> = {
    ...aggregate,
    identity: {
      ...aggregate.identity,
      deletion: null,
      updatedAt: input.now,
      updatedBy: input.actorId,
    },
    aggregateVersion: aggregate.aggregateVersion + 1,
  };
  return finalize(state, [
    {
      type: "document.restored",
      documentId: aggregate.identity.id,
      previousDeletion,
      ...eventMetadata(input, state.aggregateVersion),
    },
  ]);
}

function assertMutable<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  input: VersionedDocumentCommandMetadata,
): void {
  assertVersion(aggregate, input.expectedVersion);
  assertNotDeleted(aggregate);
  if (aggregate.identity.lifecycle.kind === "archived") {
    throw new DocumentDomainError("DOCUMENT_ARCHIVED", "Archived documents cannot be edited or published.");
  }
  assertCommandTime(aggregate, input.now);
}

function assertNotDeleted<TData extends JsonObject>(aggregate: DocumentAggregate<TData>): void {
  if (aggregate.identity.deletion !== null) {
    throw new DocumentDomainError("DOCUMENT_DELETED", "Deleted documents cannot be changed before restore.");
  }
}

function assertVersion<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  expectedVersion: number,
): void {
  assertDocumentInvariants(aggregate);
  if (aggregate.aggregateVersion !== expectedVersion) {
    throw new DocumentDomainError("DOCUMENT_VERSION_CONFLICT", "The document was modified concurrently.", {
      expectedVersion,
      actualVersion: aggregate.aggregateVersion,
    });
  }
}

function assertUnusedRevisionId<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  revisionId: RevisionId,
): void {
  if (findRevision(aggregate, revisionId) !== undefined) {
    throw new DocumentDomainError(
      "DOCUMENT_REVISION_ID_CONFLICT",
      `Revision ID '${revisionId}' is already used by this document.`,
    );
  }
}

function nextSequence<TData extends JsonObject>(aggregate: DocumentAggregate<TData>): number {
  return aggregate.revisions.length + 1;
}

function finalize<TData extends JsonObject>(
  state: DocumentAggregate<TData>,
  events: DocumentCommandResult<TData>["events"],
): DocumentCommandResult<TData> {
  assertDocumentInvariants(state);
  return deepFreeze({ state, events: [...events] });
}

function assertInitialCommandMetadata(input: DocumentCommandMetadata): void {
  assertValidInstant(input.now);
}

function assertCommandTime<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  now: UtcInstant,
): void {
  assertValidInstant(now);
  if (Date.parse(now) < Date.parse(aggregate.identity.updatedAt)) {
    throw new DocumentDomainError(
      "DOCUMENT_TIMESTAMP_REGRESSION",
      "A document command cannot occur before the previous mutation.",
      { previousUpdatedAt: aggregate.identity.updatedAt, occurredAt: now },
    );
  }
}

function assertValidInstant(value: UtcInstant): void {
  if (!isUtcInstant(value)) {
    throw new DocumentDomainError("DOCUMENT_INVARIANT_VIOLATION", `Invalid command timestamp '${value}'.`);
  }
}

function eventMetadata(
  input: DocumentCommandMetadata,
  aggregateVersion: number,
): DocumentEventMetadata {
  const reason = normalizeReason(input.reason);
  return {
    actorId: input.actorId,
    occurredAt: input.now,
    aggregateVersion,
    ...(reason === undefined ? {} : { reason }),
  };
}

function normalizeReason(reason: string | undefined): string | undefined {
  const normalized = reason?.trim();
  return normalized === "" ? undefined : normalized;
}
