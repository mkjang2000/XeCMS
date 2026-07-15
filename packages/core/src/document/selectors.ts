import type {
  DocumentAggregate,
  DocumentDisplayState,
  DocumentRevision,
  JsonObject,
  RevisionId,
} from "./types.js";

export function getDisplayState(aggregate: DocumentAggregate): DocumentDisplayState {
  if (aggregate.identity.deletion !== null) {
    return "deleted";
  }
  if (aggregate.identity.lifecycle.kind === "archived") {
    return "archived";
  }
  if (aggregate.identity.publication !== null && aggregate.identity.currentDraftRevisionId !== null) {
    return "published-with-draft";
  }
  if (aggregate.identity.publication !== null) {
    return "published";
  }
  return "draft";
}

/** Query layers use this predicate to exclude soft-deleted documents by default. */
export function isDocumentDeleted(aggregate: DocumentAggregate): boolean {
  return aggregate.identity.deletion !== null;
}

export function getWorkingRevision<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
): DocumentRevision<TData> {
  const revisionId =
    aggregate.identity.currentDraftRevisionId ?? aggregate.identity.publication?.revisionId ?? null;
  return requireRevision(aggregate, revisionId);
}

export function getPublicRevision<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
): DocumentRevision<TData> | null {
  if (
    aggregate.identity.deletion !== null ||
    aggregate.identity.lifecycle.kind !== "active" ||
    aggregate.identity.publication === null
  ) {
    return null;
  }
  return requireRevision(aggregate, aggregate.identity.publication.revisionId);
}

export function findRevision<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  revisionId: RevisionId,
): DocumentRevision<TData> | undefined {
  return aggregate.revisions.find(({ id }) => id === revisionId);
}

function requireRevision<TData extends JsonObject>(
  aggregate: DocumentAggregate<TData>,
  revisionId: RevisionId | null,
): DocumentRevision<TData> {
  const revision = revisionId === null ? undefined : findRevision(aggregate, revisionId);
  if (revision === undefined) {
    throw new TypeError(`Document '${aggregate.identity.id}' has an invalid revision pointer.`);
  }
  return revision;
}
