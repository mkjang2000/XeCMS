import { instant } from "./shared.js";
import {
  type DocumentRecord,
  type PersistedDocumentEvent,
  type PublishedDocumentRecord,
} from "@xecms/application";
import {
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  type DocumentAggregate,
  type DocumentDeletion,
  type DocumentLifecycle,
  type JsonObject,
  type Publication,
  type RevisionOrigin,
} from "@xecms/core";
import { type CollectionDefinition } from "@xecms/schema";

export interface DocumentIdentityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly collection_id: string;
  readonly current_draft_revision_id: string | null;
  readonly publication: Publication | null;
  readonly lifecycle: DocumentLifecycle;
  readonly deletion: DocumentDeletion | null;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly updated_at: Date | string;
  readonly updated_by: string;
  readonly aggregate_version: string | number;
}

export interface DocumentRevisionRow {
  readonly id: string;
  readonly document_id: string;
  readonly sequence: number;
  readonly schema_revision_id: string;
  readonly data: JsonObject;
  readonly parent_revision_id: string | null;
  readonly origin: RevisionOrigin;
  readonly created_at: Date | string;
  readonly created_by: string;
}

export interface PublishedDocumentRow {
  readonly id: string;
  readonly collection_id: string;
  readonly data: JsonObject;
  readonly revision_id: string;
  readonly schema_revision_id: string;
  readonly published_at: string;
  readonly published_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly owner_subject_id: string;
}

export function hydrateAggregate(
  identity: DocumentIdentityRow,
  revisions: readonly DocumentRevisionRow[],
): DocumentAggregate {
  return {
    identity: {
      id: asDocumentId(identity.id),
      workspaceId: asWorkspaceId(identity.workspace_id),
      collectionId: asCollectionId(identity.collection_id),
      currentDraftRevisionId:
        identity.current_draft_revision_id === null
          ? null
          : asRevisionId(identity.current_draft_revision_id),
      publication: identity.publication,
      lifecycle: identity.lifecycle,
      deletion: identity.deletion,
      createdAt: asUtcInstant(instant(identity.created_at)),
      createdBy: asSubjectId(identity.created_by),
      updatedAt: asUtcInstant(instant(identity.updated_at)),
      updatedBy: asSubjectId(identity.updated_by),
    },
    revisions: revisions.map((revision) => ({
      id: asRevisionId(revision.id),
      documentId: asDocumentId(revision.document_id),
      sequence: revision.sequence,
      schemaRevisionId: asSchemaRevisionId(revision.schema_revision_id),
      data: revision.data,
      parentRevisionId:
        revision.parent_revision_id === null ? null : asRevisionId(revision.parent_revision_id),
      origin: revision.origin,
      createdAt: asUtcInstant(instant(revision.created_at)),
      createdBy: asSubjectId(revision.created_by),
    })),
    aggregateVersion: Number(identity.aggregate_version),
  };
}

export function projectionToRecord(
  collection: CollectionDefinition,
  row: Record<string, unknown>,
): DocumentRecord {
  const data: Record<string, unknown> = {};
  for (const field of collection.fields) {
    const value = row[field.name];
    if (value !== null && value !== undefined) {
      data[field.name] = field.type === "datetime" && value instanceof Date ? value.toISOString() : value;
    }
  }
  const draftRevisionId = row["current_draft_revision_id"] === null
    ? null
    : String(row["current_draft_revision_id"]);
  const publication = (row["publication"] ?? null) as Publication | null;
  const lifecycle = row["lifecycle"] as DocumentLifecycle;
  const deletion = (row["deletion"] ?? null) as DocumentDeletion | null;
  return {
    id: String(row["id"]),
    collectionId: collection.id,
    data,
    version: Number(row["aggregate_version"]),
    createdAt: instant(row["created_at"] as Date | string),
    updatedAt: instant(row["updated_at"] as Date | string),
    ownerSubjectId: String(row["owner_subject_id"]),
    displayState: deletion !== null
      ? "deleted"
      : lifecycle.kind === "archived"
        ? "archived"
        : publication !== null && draftRevisionId !== null
          ? "published-with-draft"
          : publication !== null
            ? "published"
            : "draft",
    draftRevisionId,
    publication,
    deletion,
  };
}

export function publishedRowToRecord(row: PublishedDocumentRow): PublishedDocumentRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    data: row.data,
    revisionId: row.revision_id,
    schemaRevisionId: row.schema_revision_id,
    publishedAt: instant(row.published_at),
    publishedBy: row.published_by,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    ownerSubjectId: row.owner_subject_id,
  };
}

export function documentEventAuditPayload(
  event: PersistedDocumentEvent,
): object {
  if (!("revision" in event)) {
    return event;
  }
  return {
    ...event,
    revision: {
      id: event.revision.id,
      documentId: event.revision.documentId,
      sequence: event.revision.sequence,
      schemaRevisionId: event.revision.schemaRevisionId,
      parentRevisionId: event.revision.parentRevisionId,
      origin: event.revision.origin,
      createdAt: event.revision.createdAt,
      createdBy: event.revision.createdBy,
    },
  };
}
