export type DocumentErrorCode =
  | "DOCUMENT_VERSION_CONFLICT"
  | "DOCUMENT_DELETED"
  | "DOCUMENT_ARCHIVED"
  | "DOCUMENT_ALREADY_ARCHIVED"
  | "DOCUMENT_NOT_ARCHIVED"
  | "DOCUMENT_ALREADY_DELETED"
  | "DOCUMENT_NOT_DELETED"
  | "DOCUMENT_DRAFT_NOT_FOUND"
  | "DOCUMENT_PUBLICATION_NOT_FOUND"
  | "DOCUMENT_REVISION_NOT_FOUND"
  | "DOCUMENT_REVISION_ID_CONFLICT"
  | "DOCUMENT_RELATION_INVALID"
  | "DOCUMENT_RELATION_REVISION_FORBIDDEN"
  | "DOCUMENT_TIMESTAMP_REGRESSION"
  | "DOCUMENT_INVARIANT_VIOLATION"
  | "DOCUMENT_DATA_NOT_JSON";

export class DocumentDomainError extends Error {
  public constructor(
    public readonly code: DocumentErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "DocumentDomainError";
  }
}
