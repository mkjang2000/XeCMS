import { deepFreeze } from "../document/json.js";
import { MediaDomainError, type MediaErrorCode } from "./errors.js";
import { asMediaId, MEDIA_REFERENCE_TAG, type MediaAsset, type MediaReference } from "./types.js";

const mediaReferenceKeys = new Set(["$xecmsRef", "mediaId"]);
const mimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export function createMediaReference(mediaId: MediaAsset["id"]): MediaReference {
  return deepFreeze({ $xecmsRef: MEDIA_REFERENCE_TAG, mediaId });
}

export function decodeMediaReference(input: unknown): MediaReference {
  assertMediaReference(input);
  return createMediaReference(asMediaId(input.mediaId));
}

export function assertMediaReference(input: unknown): asserts input is MediaReference {
  if (!isPlainObject(input)) mediaError("MEDIA_REFERENCE_INVALID", [], "A media reference must be an object.");
  if (input["$xecmsRef"] !== MEDIA_REFERENCE_TAG) {
    mediaError("MEDIA_REFERENCE_INVALID", ["$xecmsRef"], `Expected '${MEDIA_REFERENCE_TAG}'.`);
  }
  for (const key of Object.keys(input)) {
    if (!mediaReferenceKeys.has(key)) {
      mediaError("MEDIA_REFERENCE_INVALID", [key], `Unknown media reference property '${key}'.`);
    }
  }
  if (typeof input["mediaId"] !== "string" || input["mediaId"].trim().length === 0 ||
    input["mediaId"] !== input["mediaId"].trim()) {
    mediaError("MEDIA_REFERENCE_INVALID", ["mediaId"], "MediaId must be a non-empty string.");
  }
}

export function assertMediaAsset(asset: MediaAsset): void {
  asMediaId(asset.id);
  assertSafeOriginalFileName(asset.originalFileName);
  assertMimeType(asset.mimeType);
  if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
    mediaError("MEDIA_SIZE_INVALID", ["size"], "Media size must be a non-negative safe integer.");
  }
  if (!sha256Pattern.test(asset.sha256)) {
    mediaError("MEDIA_CHECKSUM_INVALID", ["sha256"], "Media checksum must be lowercase SHA-256 hex.");
  }
  if (asset.storageKey.trim().length === 0) {
    mediaError("MEDIA_STORAGE_KEY_INVALID", ["storageKey"], "Media storage key cannot be empty.");
  }
}

export function assertSafeOriginalFileName(fileName: string): void {
  if (typeof fileName !== "string" || fileName.length === 0 || fileName.length > 255 ||
    fileName !== fileName.trim() || fileName === "." || fileName === ".." ||
    /[\\/\u0000-\u001f\u007f]/.test(fileName)) {
    mediaError(
      "MEDIA_FILE_NAME_INVALID",
      ["originalFileName"],
      "Media file name must be a safe base name of at most 255 characters.",
    );
  }
}

export function assertMimeType(mimeType: string): void {
  if (typeof mimeType !== "string" || mimeType.length > 127 || !mimePattern.test(mimeType)) {
    mediaError(
      "MEDIA_MIME_TYPE_INVALID",
      ["mimeType"],
      "MIME type must be a lowercase type/subtype without parameters.",
    );
  }
}

export function decodeMediaFieldReferences(input: {
  readonly fieldName: string;
  readonly value: unknown;
  readonly multiple: boolean;
  readonly required: boolean;
  readonly maxReferences?: number;
}): readonly MediaReference[] {
  const maxReferences = input.maxReferences ?? 100;
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 1) {
    throw new TypeError("maxReferences must be a positive safe integer.");
  }
  if (input.value === undefined || input.value === null) {
    if (input.required) {
      mediaError("MEDIA_REQUIRED", [input.fieldName], `Media field '${input.fieldName}' is required.`);
    }
    return [];
  }
  const values = input.multiple
    ? requireMediaArray(input.value, input.fieldName)
    : requireSingleMedia(input.value, input.fieldName);
  if (values.length > maxReferences) {
    mediaError(
      "MEDIA_REFERENCE_LIMIT_EXCEEDED",
      [input.fieldName],
      `Media field '${input.fieldName}' exceeds the ${maxReferences} reference limit.`,
    );
  }
  const seen = new Set<string>();
  const references = values.map((value, index) => {
    let reference: MediaReference;
    try {
      reference = typeof value === "string"
        ? createMediaReference(asMediaId(value))
        : decodeMediaReference(value);
    } catch (error) {
      if (error instanceof MediaDomainError) {
        throw new MediaDomainError(error.code, error.message, {
          path: [input.fieldName, ...(input.multiple ? [index] : []), ...error.details.path],
        });
      }
      throw error;
    }
    if (seen.has(reference.mediaId)) {
      mediaError(
        "MEDIA_DUPLICATE_REFERENCE",
        [input.fieldName, ...(input.multiple ? [index] : [])],
        `Media field '${input.fieldName}' contains duplicate '${reference.mediaId}'.`,
      );
    }
    seen.add(reference.mediaId);
    return reference;
  });
  return Object.freeze(references);
}

function requireMediaArray(value: unknown, fieldName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    mediaError("MEDIA_CARDINALITY_MISMATCH", [fieldName], `Media field '${fieldName}' must be an array.`);
  }
  return value;
}

function requireSingleMedia(value: unknown, fieldName: string): readonly unknown[] {
  if (Array.isArray(value)) {
    mediaError("MEDIA_CARDINALITY_MISMATCH", [fieldName], `Media field '${fieldName}' accepts one item.`);
  }
  return [value];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function mediaError(code: MediaErrorCode, path: readonly (string | number)[], message: string): never {
  throw new MediaDomainError(code, message, { path });
}
