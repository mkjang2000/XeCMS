import { DocumentDomainError } from "./errors.js";
import { assertJsonObject } from "./json.js";
import { assertDocumentReferencesInData } from "./references.js";
import { isUtcInstant } from "./types.js";
import type {
  DocumentAggregate,
  DocumentRevision,
  JsonObject,
  RevisionId,
  UtcInstant,
} from "./types.js";

/**
 * Validates both persistence-facing integrity and the document state machine's
 * assumptions. Every command checks its input and output with this function.
 */
export function assertDocumentInvariants<TData extends JsonObject>(aggregate: DocumentAggregate<TData>): void {
  const { identity, revisions } = aggregate;
  if (!Array.isArray(revisions) || revisions.length === 0) {
    fail("A document must contain at least one revision.");
  }
  if (aggregate.aggregateVersion < 1 || !Number.isInteger(aggregate.aggregateVersion)) {
    fail("aggregateVersion must be a positive integer.");
  }
  if (aggregate.aggregateVersion < revisions.length) {
    fail("aggregateVersion cannot be lower than the number of revisions.");
  }

  assertId(identity.id, "document ID");
  assertId(identity.workspaceId, "workspace ID");
  assertId(identity.collectionId, "collection ID");
  assertId(identity.createdBy, "document creator");
  assertId(identity.updatedBy, "document updater");
  assertInstant(identity.createdAt, "document creation timestamp");
  assertInstant(identity.updatedAt, "document update timestamp");
  assertChronological(identity.createdAt, identity.updatedAt, "Document update precedes creation.");

  const byId = new Map<RevisionId, DocumentRevision<TData>>();
  let previous: DocumentRevision<TData> | undefined;
  revisions.forEach((revision, index) => {
    assertId(revision.id, "revision ID");
    assertId(revision.documentId, "revision document ID");
    assertId(revision.schemaRevisionId, "schema revision ID");
    assertId(revision.createdBy, "revision creator");
    assertInstant(revision.createdAt, "revision creation timestamp");
    assertJsonObject(revision.data);
    assertDocumentReferencesInData(revision.data);

    if (byId.has(revision.id)) {
      fail(`Duplicate revision ID '${revision.id}'.`);
    }
    if (revision.sequence !== index + 1) {
      fail(`Revision '${revision.id}' must have sequence '${index + 1}', received '${revision.sequence}'.`);
    }
    if (revision.documentId !== identity.id) {
      fail(`Revision '${revision.id}' belongs to another document.`);
    }

    if (index === 0) {
      if (revision.parentRevisionId !== null || revision.origin.kind !== "create") {
        fail("The first revision must be a parentless create revision.");
      }
      if (revision.createdAt !== identity.createdAt || revision.createdBy !== identity.createdBy) {
        fail("Document creation metadata must match the first revision.");
      }
    } else {
      if (previous === undefined || revision.parentRevisionId !== previous.id) {
        fail(`Revision '${revision.id}' must point to the immediately preceding revision.`);
      }
      if (revision.origin.kind === "create") {
        fail(`Only the first revision may have the 'create' origin.`);
      }
      assertChronological(previous.createdAt, revision.createdAt, `Revision '${revision.id}' predates its parent.`);
    }

    byId.set(revision.id, revision);
    previous = revision;
  });

  for (const revision of revisions) {
    if (revision.origin.kind === "restore") {
      validateEarlierReference(
        byId,
        revision.id,
        revision.sequence,
        revision.origin.restoredFromRevisionId,
        "restore source",
      );
    }
    assertChronological(revision.createdAt, identity.updatedAt, `Revision '${revision.id}' is newer than the document.`);
  }

  const draft = validatePointer(byId, identity.currentDraftRevisionId, "current draft");
  const published = validatePointer(byId, identity.publication?.revisionId ?? null, "publication");
  if (draft === null && published === null) {
    fail("A document must have a draft or a publication.");
  }
  if (draft !== null && published !== null && draft.id === published.id) {
    fail("The current draft and publication cannot point to the same revision.");
  }

  const latest = revisions[revisions.length - 1];
  if (latest === undefined) {
    fail("A document must contain a latest revision.");
  }
  if (draft !== null && draft.id !== latest.id) {
    fail("The current draft must point to the latest revision.");
  }
  if (draft === null && published?.id !== latest.id) {
    fail("A document without a draft must publish the latest revision.");
  }

  if (identity.publication !== null && published !== null) {
    assertId(identity.publication.publishedBy, "publisher");
    assertInstant(identity.publication.publishedAt, "publication timestamp");
    assertChronological(published.createdAt, identity.publication.publishedAt, "Publication predates its revision.");
    assertChronological(identity.publication.publishedAt, identity.updatedAt, "Publication is newer than the document.");
  }

  if (identity.lifecycle.kind === "archived") {
    assertId(identity.lifecycle.archivedBy, "archiver");
    assertInstant(identity.lifecycle.archivedAt, "archive timestamp");
    assertChronological(identity.createdAt, identity.lifecycle.archivedAt, "Archive predates document creation.");
    assertChronological(identity.lifecycle.archivedAt, identity.updatedAt, "Archive is newer than the document.");
  }

  if (identity.deletion !== null) {
    assertId(identity.deletion.deletedBy, "deleter");
    assertInstant(identity.deletion.deletedAt, "deletion timestamp");
    assertChronological(identity.createdAt, identity.deletion.deletedAt, "Deletion predates document creation.");
    assertChronological(identity.deletion.deletedAt, identity.updatedAt, "Deletion is newer than the document.");
    if (
      identity.deletion.reason !== undefined &&
      (identity.deletion.reason.trim().length === 0 || identity.deletion.reason !== identity.deletion.reason.trim())
    ) {
      fail("A deletion reason must be normalized and non-empty when present.");
    }
  }
}

function validatePointer<TRevision>(
  byId: ReadonlyMap<RevisionId, TRevision>,
  revisionId: RevisionId | null,
  label: string,
): TRevision | null {
  if (revisionId === null) {
    return null;
  }
  const revision = byId.get(revisionId);
  if (revision === undefined) {
    fail(`The ${label} points to missing revision '${revisionId}'.`);
  }
  return revision;
}

function validateEarlierReference<TRevision extends { readonly sequence: number }>(
  byId: ReadonlyMap<RevisionId, TRevision>,
  revisionId: RevisionId,
  sequence: number,
  referencedId: RevisionId,
  label: string,
): void {
  const referenced = byId.get(referencedId);
  if (referenced === undefined || referenced.sequence >= sequence) {
    fail(`Revision '${revisionId}' has an invalid ${label} '${referencedId}'.`);
  }
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail(`The ${label} must be a non-empty string without surrounding whitespace.`);
  }
}

function assertInstant(value: UtcInstant, label: string): void {
  if (!isUtcInstant(value)) {
    fail(`The ${label} is not a valid RFC 3339 timestamp.`);
  }
}

function assertChronological(earlier: UtcInstant, later: UtcInstant, message: string): void {
  if (Date.parse(earlier) > Date.parse(later)) {
    fail(message);
  }
}

function fail(message: string): never {
  throw new DocumentDomainError("DOCUMENT_INVARIANT_VIOLATION", message);
}
