export type MediaErrorCode =
  | "MEDIA_REFERENCE_INVALID"
  | "MEDIA_SIZE_INVALID"
  | "MEDIA_CHECKSUM_INVALID"
  | "MEDIA_STORAGE_KEY_INVALID"
  | "MEDIA_FILE_NAME_INVALID"
  | "MEDIA_MIME_TYPE_INVALID"
  | "MEDIA_REQUIRED"
  | "MEDIA_CARDINALITY_MISMATCH"
  | "MEDIA_REFERENCE_LIMIT_EXCEEDED"
  | "MEDIA_DUPLICATE_REFERENCE";

export class MediaDomainError extends Error {
  public constructor(
    public readonly code: MediaErrorCode,
    message: string,
    public readonly details: { readonly path: readonly (string | number)[] },
  ) {
    super(message);
    this.name = "MediaDomainError";
  }
}
