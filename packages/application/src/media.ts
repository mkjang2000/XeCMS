import {
  asMediaId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  assertMediaAsset,
  assertMimeType,
  assertSafeOriginalFileName,
  createMediaReference,
  decodeMediaFieldReferences,
  MediaDomainError,
  type MediaAsset,
  type MediaReference,
  type JsonObject,
} from "@xecms/core";
import type { CollectionDefinition, UploadFieldDefinition } from "@xecms/schema";
import { ApplicationError } from "./errors.js";

export type MediaRecordStatus = "pending" | "ready" | "failed";

export interface MediaRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly status: MediaRecordStatus;
  readonly size: number | null;
  readonly sha256: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly failureReason?: string;
}

export interface MediaStore {
  reserveMedia(record: MediaRecord): Promise<void>;
  completeMedia(input: {
    readonly id: string;
    readonly expectedStatus: "pending";
    readonly size: number;
    readonly sha256: string;
  }): Promise<MediaRecord>;
  failMedia(input: {
    readonly id: string;
    readonly expectedStatus: "pending";
    readonly reason: string;
  }): Promise<void>;
  getMedia(id: string): Promise<MediaRecord | null>;
  listAllMedia(workspaceId: string): Promise<readonly MediaRecord[]>;
  deleteMediaRecord(input: { readonly id: string; readonly expectedStatus: MediaRecordStatus }): Promise<void>;
}

export interface MediaStorageWriteResult {
  readonly size: number;
  readonly sha256: string;
}

export interface MediaStorage {
  /** Writes atomically; failed/oversized writes must leave no final object. */
  write(input: {
    readonly storageKey: string;
    readonly stream: AsyncIterable<Uint8Array>;
    readonly maxBytes: number;
  }): Promise<MediaStorageWriteResult>;
  open(storageKey: string): Promise<AsyncIterable<Uint8Array>>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
  listKeys(): Promise<readonly string[]>;
}

export interface MediaTypeInspector {
  /** Returns a canonical MIME type detected from bytes, or null when unsupported. */
  inspect(input: {
    readonly originalFileName: string;
    readonly declaredMimeType: string;
    readonly initialBytes: Uint8Array;
  }): Promise<string | null> | string | null;
}

export interface MediaRuntime {
  readonly now: () => string;
  readonly newMediaId: () => string;
  /** Must return an opaque, server-controlled relative storage key. */
  readonly storageKeyFor: (mediaId: string) => string;
}

export interface MediaConsistencyReport {
  readonly missing: readonly MediaRecord[];
  readonly orphanStorageKeys: readonly string[];
  readonly incomplete: readonly MediaRecord[];
  readonly healthyCount: number;
}

export interface UploadFieldContract {
  readonly fieldName: string;
  readonly multiple: boolean;
  readonly required: boolean;
  readonly acceptedMimeTypes?: readonly string[];
}

export interface DocumentMediaReferenceEdge {
  readonly sourceDocumentId: string;
  readonly fieldName: string;
  readonly mediaId: string;
  readonly ordinal: number;
  /** Field-level allow-list checked against ready metadata in the document transaction. */
  readonly acceptedMimeTypes?: readonly string[];
}

export interface DocumentMediaReferenceIssue {
  readonly mediaId: string;
  readonly reason: "not-found" | "not-ready" | "workspace-mismatch" | "mime-not-accepted";
  readonly actualMimeType?: string;
  readonly acceptedMimeTypes?: readonly string[];
}

export type DocumentMediaReferenceReplaceResult =
  | { readonly status: "committed" }
  | {
      readonly status: "invalid-media";
      readonly issues: readonly DocumentMediaReferenceIssue[];
    };

export interface DocumentMediaReferenceStore {
  /** Validates ready/workspace metadata and replaces edges in one transaction. */
  validateAndReplaceDocumentMedia(input: {
    readonly workspaceId: string;
    readonly sourceDocumentId: string;
    readonly expectedDocumentVersion: number;
    readonly edges: readonly DocumentMediaReferenceEdge[];
  }): Promise<DocumentMediaReferenceReplaceResult>;
  listMediaUsages(mediaId: string): Promise<readonly DocumentMediaReferenceEdge[]>;
}

export class MediaReferenceApplicationService {
  public constructor(
    private readonly references: DocumentMediaReferenceStore,
    private readonly maxReferencesPerDocument = 100,
  ) {
    if (!Number.isSafeInteger(maxReferencesPerDocument) || maxReferencesPerDocument < 1) {
      throw new TypeError("maxReferencesPerDocument must be a positive safe integer.");
    }
  }

  public async synchronizeDocument(input: {
    readonly workspaceId: string;
    readonly sourceDocumentId: string;
    readonly expectedDocumentVersion: number;
    readonly data: JsonObject;
    readonly fields: readonly UploadFieldContract[];
  }): Promise<readonly DocumentMediaReferenceEdge[]> {
    if (!Number.isSafeInteger(input.expectedDocumentVersion) || input.expectedDocumentVersion < 0) {
      throw new ApplicationError("DOCUMENT_VERSION_INVALID", 422, "Document version is invalid.");
    }
    const edges: DocumentMediaReferenceEdge[] = [];
    for (const field of input.fields) {
      const values = decodeMediaReferencesAsInput({
        fieldName: field.fieldName,
        value: input.data[field.fieldName],
        multiple: field.multiple,
        required: field.required,
        maxReferences: this.maxReferencesPerDocument,
      });
      values.forEach((reference, ordinal) => edges.push({
        sourceDocumentId: input.sourceDocumentId,
        fieldName: field.fieldName,
        mediaId: reference.mediaId,
        ordinal,
        ...(field.acceptedMimeTypes === undefined
          ? {}
          : { acceptedMimeTypes: field.acceptedMimeTypes }),
      }));
    }
    if (edges.length > this.maxReferencesPerDocument) {
      throw new ApplicationError(
        "MEDIA_REFERENCE_LIMIT_EXCEEDED",
        422,
        `Document exceeds the ${this.maxReferencesPerDocument} media reference limit.`,
      );
    }
    const result = await this.references.validateAndReplaceDocumentMedia({
      workspaceId: input.workspaceId,
      sourceDocumentId: input.sourceDocumentId,
      expectedDocumentVersion: input.expectedDocumentVersion,
      edges,
    });
    if (result.status === "invalid-media") {
      throw new ApplicationError(
        "MEDIA_REFERENCE_INVALID",
        422,
        "One or more document media references are unavailable.",
        { details: { issues: result.issues } },
      );
    }
    return edges;
  }
}

export function uploadContractsForCollection(
  collection: CollectionDefinition,
): readonly UploadFieldContract[] {
  return collection.fields
    .filter((field): field is UploadFieldDefinition => field.type === "upload")
    .map((field) => ({
      fieldName: field.name,
      multiple: field.multiple === true,
      required: field.required === true,
      ...(field.acceptedMimeTypes === undefined
        ? {}
        : { acceptedMimeTypes: Object.freeze([...field.acceptedMimeTypes]) }),
    }));
}

export class MediaApplicationService {
  public constructor(
    private readonly store: MediaStore,
    private readonly storage: MediaStorage,
    private readonly inspector: MediaTypeInspector,
    private readonly runtime: MediaRuntime,
    private readonly policy: {
      readonly maxUploadBytes: number;
      readonly allowedMimeTypes: readonly string[];
      readonly inspectionBytes?: number;
    },
  ) {
    if (!Number.isSafeInteger(policy.maxUploadBytes) || policy.maxUploadBytes < 1) {
      throw new TypeError("maxUploadBytes must be a positive safe integer.");
    }
    if (policy.allowedMimeTypes.length === 0) {
      throw new TypeError("At least one allowed MIME type is required.");
    }
    policy.allowedMimeTypes.forEach(validateMimePattern);
  }

  public async upload(input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly originalFileName: string;
    readonly declaredMimeType: string;
    readonly stream: AsyncIterable<Uint8Array>;
  }): Promise<{ readonly media: MediaRecord; readonly reference: MediaReference }> {
    try {
      assertSafeOriginalFileName(input.originalFileName);
      assertMimeType(input.declaredMimeType);
    } catch (error: unknown) {
      if (error instanceof MediaDomainError) {
        throw new ApplicationError(error.code, 422, error.message, { details: error.details });
      }
      throw error;
    }
    if (!mimeAllowed(input.declaredMimeType, this.policy.allowedMimeTypes)) {
      throw new ApplicationError(
        "MEDIA_MIME_NOT_ALLOWED",
        415,
        `MIME type '${input.declaredMimeType}' is not allowed.`,
      );
    }
    const inspection = await peekStream(input.stream, this.policy.inspectionBytes ?? 8_192);
    const detectedMimeType = await this.inspector.inspect({
      originalFileName: input.originalFileName,
      declaredMimeType: input.declaredMimeType,
      initialBytes: inspection.initialBytes,
    });
    if (detectedMimeType === null) {
      throw new ApplicationError(
        "MEDIA_TYPE_UNDETECTABLE",
        415,
        "The uploaded file type could not be verified from its content.",
      );
    }
    assertMimeType(detectedMimeType);
    if (detectedMimeType !== input.declaredMimeType ||
      !mimeAllowed(detectedMimeType, this.policy.allowedMimeTypes)) {
      throw new ApplicationError(
        "MEDIA_MIME_MISMATCH",
        415,
        `Declared MIME '${input.declaredMimeType}' does not match detected MIME '${detectedMimeType}'.`,
      );
    }

    const id = this.runtime.newMediaId();
    const now = this.runtime.now();
    // Brand validation is kept at the boundary even though persistence records use strings.
    asMediaId(id);
    asWorkspaceId(input.workspaceId);
    asSubjectId(input.actorId);
    asUtcInstant(now);
    const storageKey = this.runtime.storageKeyFor(id);
    const pending: MediaRecord = {
      id,
      workspaceId: input.workspaceId,
      originalFileName: input.originalFileName,
      mimeType: detectedMimeType,
      storageKey,
      status: "pending",
      size: null,
      sha256: null,
      createdAt: now,
      createdBy: input.actorId,
    };
    await this.store.reserveMedia(pending);

    let written: MediaStorageWriteResult;
    try {
      written = await this.storage.write({
        storageKey,
        stream: inspection.stream,
        maxBytes: this.policy.maxUploadBytes,
      });
    } catch (error) {
      await this.markFailedBestEffort(id, safeFailureReason(error));
      throw error;
    }
    if (written.size < 1) {
      await this.storage.delete(storageKey);
      await this.markFailedBestEffort(id, "MEDIA_EMPTY");
      throw new ApplicationError("MEDIA_EMPTY", 422, "Empty media files are not accepted.");
    }

    try {
      const media = await this.store.completeMedia({
        id,
        expectedStatus: "pending",
        size: written.size,
        sha256: written.sha256,
      });
      assertMediaAsset(toMediaAsset(media));
      return { media, reference: createMediaReference(asMediaId(media.id)) };
    } catch (error) {
      try {
        await this.storage.delete(storageKey);
      } finally {
        await this.markFailedBestEffort(id, "metadata-finalization-failed");
      }
      throw error;
    }
  }

  public async open(id: string): Promise<{
    readonly media: MediaRecord;
    readonly stream: AsyncIterable<Uint8Array>;
  }> {
    const media = await this.requireReady(id);
    if (!(await this.storage.exists(media.storageKey))) {
      throw new ApplicationError("MEDIA_FILE_MISSING", 503, `Media file '${id}' is missing from storage.`);
    }
    return { media, stream: await this.storage.open(media.storageKey) };
  }

  public async list(
    workspaceId: string,
    input: { readonly includeIncomplete?: boolean } = {},
  ): Promise<readonly MediaRecord[]> {
    const records = await this.store.listAllMedia(workspaceId);
    return input.includeIncomplete === true
      ? records
      : records.filter(({ status }) => status === "ready");
  }

  public async validateUploadField(input: {
    readonly workspaceId: string;
    readonly fieldName: string;
    readonly value: unknown;
    readonly multiple: boolean;
    readonly required: boolean;
    readonly maxReferences?: number;
  }): Promise<readonly MediaReference[]> {
    const references = decodeMediaReferencesAsInput({
      fieldName: input.fieldName,
      value: input.value,
      multiple: input.multiple,
      required: input.required,
      ...(input.maxReferences === undefined ? {} : { maxReferences: input.maxReferences }),
    });
    const invalid: { readonly mediaId: string; readonly reason: "not-found" | "not-ready" | "workspace-mismatch" }[] = [];
    for (const reference of references) {
      const media = await this.store.getMedia(reference.mediaId);
      if (media === null) invalid.push({ mediaId: reference.mediaId, reason: "not-found" });
      else if (media.workspaceId !== input.workspaceId) {
        invalid.push({ mediaId: reference.mediaId, reason: "workspace-mismatch" });
      } else if (media.status !== "ready") {
        invalid.push({ mediaId: reference.mediaId, reason: "not-ready" });
      }
    }
    if (invalid.length > 0) {
      throw new ApplicationError(
        "MEDIA_REFERENCE_INVALID",
        422,
        "One or more upload field references are unavailable.",
        { details: { issues: invalid } },
      );
    }
    return references;
  }

  public async delete(id: string): Promise<void> {
    const media = await this.requireReady(id);
    // Delete metadata first so database reference constraints can veto removal
    // before any bytes disappear. A storage failure afterwards is a detectable
    // orphan, whereas deleting bytes first could create a broken live reference.
    await this.store.deleteMediaRecord({ id, expectedStatus: "ready" });
    await this.storage.delete(media.storageKey);
  }

  public async checkConsistency(workspaceId: string): Promise<MediaConsistencyReport> {
    const records = await this.store.listAllMedia(workspaceId);
    const storageKeys = await this.storage.listKeys();
    const knownKeys = new Set(records.map(({ storageKey }) => storageKey));
    const presentKeys = new Set(storageKeys);
    const ready = records.filter(({ status }) => status === "ready");
    const missing = ready.filter(({ storageKey }) => !presentKeys.has(storageKey));
    const incomplete = records.filter(({ status }) => status !== "ready");
    return {
      missing,
      orphanStorageKeys: storageKeys.filter((key) => !knownKeys.has(key)),
      incomplete,
      healthyCount: ready.length - missing.length,
    };
  }

  private async requireReady(id: string): Promise<MediaRecord> {
    const media = await this.store.getMedia(id);
    if (media === null || media.status !== "ready") {
      throw new ApplicationError("MEDIA_NOT_FOUND", 404, `Ready media '${id}' was not found.`);
    }
    return media;
  }

  private async markFailedBestEffort(id: string, reason: string): Promise<void> {
    try {
      await this.store.failMedia({ id, expectedStatus: "pending", reason });
    } catch {
      // The consistency checker intentionally exposes records that could not be marked.
    }
  }
}

function decodeMediaReferencesAsInput(
  input: Parameters<typeof decodeMediaFieldReferences>[0],
): readonly MediaReference[] {
  try {
    return decodeMediaFieldReferences(input);
  } catch (error: unknown) {
    if (error instanceof MediaDomainError) {
      throw new ApplicationError(error.code, 422, error.message, { details: error.details });
    }
    throw error;
  }
}

/** Minimal signature inspector for the official MVP MIME set. */
export class BasicMediaTypeInspector implements MediaTypeInspector {
  public inspect(input: { readonly initialBytes: Uint8Array }): string | null {
    const bytes = input.initialBytes;
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
    if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
    return null;
  }
}

function toMediaAsset(media: MediaRecord): MediaAsset {
  if (media.status !== "ready" || media.size === null || media.sha256 === null) {
    throw new ApplicationError("MEDIA_NOT_READY", 500, "Media metadata was not finalized.");
  }
  return {
    id: asMediaId(media.id),
    workspaceId: asWorkspaceId(media.workspaceId),
    originalFileName: media.originalFileName,
    mimeType: media.mimeType,
    size: media.size,
    sha256: media.sha256,
    storageKey: media.storageKey,
    createdAt: asUtcInstant(media.createdAt),
    createdBy: asSubjectId(media.createdBy),
  };
}

function validateMimePattern(pattern: string): void {
  if (pattern.endsWith("/*")) {
    assertMimeType(`${pattern.slice(0, -1)}placeholder`);
    return;
  }
  assertMimeType(pattern);
}

function mimeAllowed(mimeType: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern === mimeType || pattern.endsWith("/*") && mimeType.startsWith(pattern.slice(0, -1)));
}

async function peekStream(
  source: AsyncIterable<Uint8Array>,
  limit: number,
): Promise<{ readonly initialBytes: Uint8Array; readonly stream: AsyncIterable<Uint8Array> }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1_024) {
    throw new TypeError("inspectionBytes must be between 1 and 65536.");
  }
  const iterator = source[Symbol.asyncIterator]();
  const buffered: Uint8Array[] = [];
  let bufferedBytes = 0;
  while (bufferedBytes < limit) {
    const next = await iterator.next();
    if (next.done === true) break;
    if (!(next.value instanceof Uint8Array)) {
      throw new ApplicationError("MEDIA_STREAM_INVALID", 422, "Media stream chunks must be Uint8Array values.");
    }
    buffered.push(next.value);
    bufferedBytes += next.value.byteLength;
  }
  const initialBytes = concatenate(buffered, Math.min(bufferedBytes, limit));
  return {
    initialBytes,
    stream: {
      async *[Symbol.asyncIterator]() {
        yield* buffered;
        while (true) {
          const next = await iterator.next();
          if (next.done === true) break;
          if (!(next.value instanceof Uint8Array)) {
            throw new ApplicationError("MEDIA_STREAM_INVALID", 422, "Media stream chunks must be Uint8Array values.");
          }
          yield next.value;
        }
      },
    },
  };
}

function concatenate(chunks: readonly Uint8Array[], limit: number): Uint8Array {
  const output = new Uint8Array(limit);
  let offset = 0;
  for (const chunk of chunks) {
    const length = Math.min(chunk.byteLength, limit - offset);
    output.set(chunk.subarray(0, length), offset);
    offset += length;
    if (offset === limit) break;
  }
  return output;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function safeFailureReason(error: unknown): string {
  if (error instanceof ApplicationError) return error.code;
  return "storage-write-failed";
}
