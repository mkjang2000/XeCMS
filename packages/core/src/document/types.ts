declare const idBrand: unique symbol;

type Brand<TValue, TName extends string> = TValue & { readonly [idBrand]: TName };

export type DocumentId = Brand<string, "DocumentId">;
export type RevisionId = Brand<string, "RevisionId">;
export type CollectionId = Brand<string, "CollectionId">;
export type SchemaRevisionId = Brand<string, "SchemaRevisionId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type SubjectId = Brand<string, "SubjectId">;
export type UtcInstant = Brand<string, "UtcInstant">;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const DOCUMENT_REFERENCE_TAG = "document" as const;
export const REVISION_REFERENCE_TAG = "revision" as const;

/**
 * Canonical value stored by a relation field.
 *
 * Relations deliberately point to a stable document identity. A RevisionId is
 * not part of this shape, so published/draft pointer changes never invalidate
 * a relation.
 */
export interface DocumentReference extends JsonObject {
  readonly $xecmsRef: typeof DOCUMENT_REFERENCE_TAG;
  readonly collectionId: CollectionId;
  readonly documentId: DocumentId;
}

export interface Publication {
  readonly revisionId: RevisionId;
  readonly publishedAt: UtcInstant;
  readonly publishedBy: SubjectId;
}

export type DocumentLifecycle =
  | { readonly kind: "active" }
  | {
      readonly kind: "archived";
      readonly archivedAt: UtcInstant;
      readonly archivedBy: SubjectId;
    };

export interface DocumentDeletion {
  readonly deletedAt: UtcInstant;
  readonly deletedBy: SubjectId;
  readonly reason?: string;
}

export interface DocumentIdentity {
  readonly id: DocumentId;
  readonly workspaceId: WorkspaceId;
  readonly collectionId: CollectionId;
  readonly currentDraftRevisionId: RevisionId | null;
  readonly publication: Publication | null;
  readonly lifecycle: DocumentLifecycle;
  readonly deletion: DocumentDeletion | null;
  readonly createdAt: UtcInstant;
  readonly createdBy: SubjectId;
  readonly updatedAt: UtcInstant;
  readonly updatedBy: SubjectId;
}

export type RevisionOrigin =
  | { readonly kind: "create" }
  | { readonly kind: "edit" }
  | { readonly kind: "restore"; readonly restoredFromRevisionId: RevisionId };

export interface DocumentRevision<TData extends JsonObject = JsonObject> {
  readonly id: RevisionId;
  readonly documentId: DocumentId;
  readonly sequence: number;
  readonly schemaRevisionId: SchemaRevisionId;
  readonly data: TData;
  readonly parentRevisionId: RevisionId | null;
  readonly origin: RevisionOrigin;
  readonly createdAt: UtcInstant;
  readonly createdBy: SubjectId;
}

export interface DocumentAggregate<TData extends JsonObject = JsonObject> {
  readonly identity: DocumentIdentity;
  readonly revisions: readonly DocumentRevision<TData>[];
  readonly aggregateVersion: number;
}

export type DocumentDisplayState =
  | "draft"
  | "published"
  | "published-with-draft"
  | "archived"
  | "deleted";

export type DocumentEvent<TData extends JsonObject = JsonObject> =
  DocumentEventMetadata &
    (
      | {
          readonly type: "document.created";
          readonly documentId: DocumentId;
          readonly revision: DocumentRevision<TData>;
        }
      | {
          readonly type: "document.draft-created";
          readonly documentId: DocumentId;
          readonly revision: DocumentRevision<TData>;
        }
      | {
          readonly type: "document.revision-restored";
          readonly documentId: DocumentId;
          readonly revision: DocumentRevision<TData>;
          readonly sourceRevisionId: RevisionId;
        }
      | {
          readonly type: "document.published";
          readonly documentId: DocumentId;
          readonly publication: Publication;
        }
      | {
          readonly type: "document.unpublished";
          readonly documentId: DocumentId;
          readonly previousPublication: Publication;
        }
      | {
          readonly type: "document.archived";
          readonly documentId: DocumentId;
          readonly lifecycle: Extract<DocumentLifecycle, { readonly kind: "archived" }>;
        }
      | {
          readonly type: "document.unarchived";
          readonly documentId: DocumentId;
          readonly previousLifecycle: Extract<DocumentLifecycle, { readonly kind: "archived" }>;
        }
      | {
          readonly type: "document.deleted";
          readonly documentId: DocumentId;
          readonly deletion: DocumentDeletion;
        }
      | {
          readonly type: "document.restored";
          readonly documentId: DocumentId;
          readonly previousDeletion: DocumentDeletion;
        }
    );

/** Metadata present on every domain event, regardless of transition type. */
export interface DocumentEventMetadata {
  readonly actorId: SubjectId;
  readonly occurredAt: UtcInstant;
  readonly aggregateVersion: number;
  readonly reason?: string;
}

export interface DocumentCommandResult<TData extends JsonObject = JsonObject> {
  readonly state: DocumentAggregate<TData>;
  readonly events: readonly DocumentEvent<TData>[];
}

function asBrand<T>(value: string, label: string): T {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} must be non-empty and cannot contain surrounding whitespace.`);
  }
  return value as T;
}

export const asDocumentId = (value: string): DocumentId => asBrand<DocumentId>(value, "DocumentId");
export const asRevisionId = (value: string): RevisionId => asBrand<RevisionId>(value, "RevisionId");
export const asCollectionId = (value: string): CollectionId => asBrand<CollectionId>(value, "CollectionId");
export const asSchemaRevisionId = (value: string): SchemaRevisionId =>
  asBrand<SchemaRevisionId>(value, "SchemaRevisionId");
export const asWorkspaceId = (value: string): WorkspaceId => asBrand<WorkspaceId>(value, "WorkspaceId");
export const asSubjectId = (value: string): SubjectId => asBrand<SubjectId>(value, "SubjectId");
const rfc3339InstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isUtcInstant(value: unknown): value is UtcInstant {
  return typeof value === "string" && rfc3339InstantPattern.test(value) && Number.isFinite(Date.parse(value));
}

export const asUtcInstant = (value: string): UtcInstant => {
  if (!isUtcInstant(value)) {
    throw new TypeError(`UtcInstant must be an RFC 3339 timestamp with a timezone: '${value}'.`);
  }
  return value as UtcInstant;
};
