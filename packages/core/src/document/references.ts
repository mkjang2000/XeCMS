import { DocumentDomainError } from "./errors.js";
import { MediaDomainError } from "../media/errors.js";
import { assertMediaReference } from "../media/media.js";
import { cloneJsonObject, deepFreeze } from "./json.js";
import {
  DOCUMENT_REFERENCE_TAG,
  REVISION_REFERENCE_TAG,
  type CollectionId,
  type DocumentId,
  type DocumentReference,
  type JsonObject,
} from "./types.js";

const referenceKeys = new Set(["$xecmsRef", "collectionId", "documentId"]);

export interface CreateDocumentReferenceInput {
  readonly collectionId: CollectionId;
  readonly documentId: DocumentId;
}

/** Builds the only relation reference shape accepted by the document domain. */
export function createDocumentReference(input: CreateDocumentReferenceInput): DocumentReference {
  const reference: DocumentReference = {
    $xecmsRef: DOCUMENT_REFERENCE_TAG,
    collectionId: input.collectionId,
    documentId: input.documentId,
  };
  assertDocumentReference(reference);
  return deepFreeze(reference);
}

/** Decodes an untrusted relation payload and returns an immutable reference. */
export function decodeDocumentReference(input: unknown): DocumentReference {
  assertDocumentReference(input);
  return createDocumentReference(input);
}

export function isDocumentReference(input: unknown): input is DocumentReference {
  try {
    assertDocumentReference(input);
    return true;
  } catch {
    return false;
  }
}

export function assertDocumentReference(input: unknown): asserts input is DocumentReference {
  if (!isPlainObject(input)) {
    invalidReference([], "A relation value must be an object.");
  }

  const tag = input["$xecmsRef"];
  if (tag === REVISION_REFERENCE_TAG || "revisionId" in input) {
    throw new DocumentDomainError(
      "DOCUMENT_RELATION_REVISION_FORBIDDEN",
      "Relations must reference a DocumentId, never a RevisionId.",
      { path: [], tag },
    );
  }
  if (tag !== DOCUMENT_REFERENCE_TAG) {
    invalidReference(["$xecmsRef"], `Expected '${DOCUMENT_REFERENCE_TAG}'.`);
  }
  for (const key of Object.keys(input)) {
    if (!referenceKeys.has(key)) {
      invalidReference([key], `Unknown document reference property '${key}'.`);
    }
  }
  assertNonEmptyId(input["collectionId"], ["collectionId"], "CollectionId");
  assertNonEmptyId(input["documentId"], ["documentId"], "DocumentId");
}

/**
 * Validates all explicit XeCMS references nested in arbitrary document JSON.
 * Ordinary JSON objects are left alone; `$xecmsRef` is a reserved property.
 */
export function assertDocumentReferencesInData(data: JsonObject): void {
  visit(data, []);
}

export function cloneDocumentData<TData extends JsonObject>(data: TData): TData {
  const clone = cloneJsonObject(data);
  assertDocumentReferencesInData(clone);
  return clone;
}

function visit(value: unknown, path: readonly (string | number)[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, [...path, index]));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (value["$xecmsRef"] === "media") {
    try {
      assertMediaReference(value);
    } catch (error) {
      if (error instanceof MediaDomainError) {
        throw new MediaDomainError(error.code, error.message, {
          path: [...path, ...error.details.path],
        });
      }
      throw error;
    }
    return;
  }
  if ("$xecmsRef" in value || "revisionId" in value && value["$xecmsRef"] === REVISION_REFERENCE_TAG) {
    try {
      assertDocumentReference(value);
    } catch (error) {
      if (error instanceof DocumentDomainError) {
        const childPath = error.details?.["path"];
        throw new DocumentDomainError(error.code, error.message, {
          ...error.details,
          path: [...path, ...(Array.isArray(childPath) ? childPath : [])],
        });
      }
      throw error;
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(child, [...path, key]);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertNonEmptyId(
  value: unknown,
  path: readonly (string | number)[],
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    invalidReference(path, `${label} must be a non-empty string without surrounding whitespace.`);
  }
}

function invalidReference(path: readonly (string | number)[], message: string): never {
  throw new DocumentDomainError("DOCUMENT_RELATION_INVALID", message, { path });
}
