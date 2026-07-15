import type {
  JsonObject,
  SubjectId,
  UtcInstant,
  WorkspaceId,
} from "../document/types.js";

declare const mediaIdBrand: unique symbol;
export type MediaId = string & { readonly [mediaIdBrand]: "MediaId" };

export const MEDIA_REFERENCE_TAG = "media" as const;

/** Canonical upload-field value. It remains stable when metadata or files move. */
export interface MediaReference extends JsonObject {
  readonly $xecmsRef: typeof MEDIA_REFERENCE_TAG;
  readonly mediaId: MediaId;
}

export interface MediaAsset {
  readonly id: MediaId;
  readonly workspaceId: WorkspaceId;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly createdAt: UtcInstant;
  readonly createdBy: SubjectId;
}

export function asMediaId(value: string): MediaId {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError("MediaId must be a non-empty string without surrounding whitespace.");
  }
  return value as MediaId;
}
