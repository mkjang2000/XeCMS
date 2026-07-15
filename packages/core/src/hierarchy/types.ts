import type {
  CollectionId,
  DocumentId,
  SubjectId,
  UtcInstant,
  WorkspaceId,
} from "../document/types.js";

export interface ContentHierarchyPosition {
  readonly documentId: DocumentId;
  readonly parentId: DocumentId | null;
  /** Zero-based order among siblings. */
  readonly sortKey: number;
  /** Root nodes have depth 0. */
  readonly depth: number;
}

export interface ContentHierarchySnapshot {
  readonly workspaceId: WorkspaceId;
  readonly collectionId: CollectionId;
  readonly version: number;
  readonly positions: readonly ContentHierarchyPosition[];
}

export interface ContentHierarchyClosureEntry {
  readonly ancestorId: DocumentId;
  readonly descendantId: DocumentId;
  /** Self rows have distance 0. */
  readonly distance: number;
}

export type ContentHierarchyEventType =
  | "tree.node.created"
  | "tree.node.moved"
  | "tree.node.reordered"
  | "tree.node.removed";

export interface ContentHierarchyEvent {
  readonly type: ContentHierarchyEventType;
  readonly workspaceId: WorkspaceId;
  readonly collectionId: CollectionId;
  readonly documentId: DocumentId | null;
  readonly structureVersion: number;
  readonly actorId: SubjectId;
  readonly occurredAt: UtcInstant;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly affectedDocumentIds: readonly DocumentId[];
}

export interface ContentHierarchyCommandResult {
  readonly state: ContentHierarchySnapshot;
  readonly event: ContentHierarchyEvent;
}

export interface HierarchyCommandMetadata {
  readonly actorId: SubjectId;
  readonly now: UtcInstant;
  readonly expectedVersion: number;
  readonly maxDepth?: number;
}

