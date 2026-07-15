export type RelationErrorCode =
  | "RELATION_SOURCE_COLLECTION_MISMATCH"
  | "RELATION_TARGET_COLLECTION_MISMATCH"
  | "RELATION_CARDINALITY_MISMATCH"
  | "RELATION_REFERENCE_LIMIT_EXCEEDED"
  | "RELATION_DUPLICATE_TARGET"
  | "RELATION_REQUIRED";

export class RelationDomainError extends Error {
  public constructor(
    public readonly code: RelationErrorCode,
    message: string,
    public readonly details: { readonly path: readonly (string | number)[] },
  ) {
    super(message);
    this.name = "RelationDomainError";
  }
}
