import type { CollectionId, DocumentId, JsonObject } from "../document/types.js";

export type RelationCardinality = "one" | "many";
export type RelationDeletePolicy = "restrict" | "nullify" | "cascade";

export interface RelationFieldContract {
  readonly relationId: string;
  readonly fieldName: string;
  readonly sourceCollectionId: CollectionId;
  readonly targetCollectionId: CollectionId;
  readonly cardinality: RelationCardinality;
  readonly required: boolean;
  readonly onDelete: RelationDeletePolicy;
}

/** A normalized edge always points to a stable DocumentId, never a RevisionId. */
export interface DocumentRelationEdge {
  readonly relationId: string;
  readonly fieldName: string;
  readonly sourceCollectionId: CollectionId;
  readonly sourceDocumentId: DocumentId;
  readonly targetCollectionId: CollectionId;
  readonly targetDocumentId: DocumentId;
  readonly ordinal: number;
  readonly onDelete: RelationDeletePolicy;
}

export interface IncomingDocumentRelation {
  readonly edge: DocumentRelationEdge;
  readonly sourceData: JsonObject;
}

export interface RelationNullification {
  readonly sourceCollectionId: CollectionId;
  readonly sourceDocumentId: DocumentId;
  readonly relationId: string;
  readonly fieldName: string;
  /** Canonical content payload uses stable DocumentId strings. */
  readonly nextValue: string | readonly string[] | null;
}

export interface RelationCascadeTarget {
  readonly collectionId: CollectionId;
  readonly documentId: DocumentId;
}

export interface RelationDeletePlan {
  readonly allowed: boolean;
  readonly restrictedBy: readonly DocumentRelationEdge[];
  readonly nullifications: readonly RelationNullification[];
  readonly cascades: readonly RelationCascadeTarget[];
}
