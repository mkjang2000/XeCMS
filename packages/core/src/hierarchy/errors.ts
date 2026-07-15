export type ContentHierarchyErrorCode =
  | "HIERARCHY_VERSION_CONFLICT"
  | "HIERARCHY_NODE_ALREADY_EXISTS"
  | "HIERARCHY_NODE_NOT_FOUND"
  | "HIERARCHY_PARENT_NOT_FOUND"
  | "HIERARCHY_CROSS_COLLECTION_PARENT"
  | "HIERARCHY_SELF_PARENT"
  | "HIERARCHY_CYCLE"
  | "HIERARCHY_MAX_DEPTH_EXCEEDED"
  | "HIERARCHY_POSITION_INVALID"
  | "HIERARCHY_REORDER_SET_INVALID"
  | "HIERARCHY_NODE_HAS_CHILDREN"
  | "HIERARCHY_INVARIANT_VIOLATION";

export class ContentHierarchyDomainError extends Error {
  public constructor(
    public readonly code: ContentHierarchyErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ContentHierarchyDomainError";
  }
}

