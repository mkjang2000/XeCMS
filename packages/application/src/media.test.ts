import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  BasicMediaTypeInspector,
  MediaApplicationService,
  MediaReferenceApplicationService,
  type DocumentMediaReferenceEdge,
  type DocumentMediaReferenceReplaceResult,
  type DocumentMediaReferenceStore,
  type MediaRecord,
  type MediaRecordStatus,
  type MediaStorage,
  type MediaStore,
} from "./index.js";

class MemoryMediaStore implements MediaStore {
  public readonly records = new Map<string, MediaRecord>();
  public failCompletion = false;
  public failDeletion = false;

  public async reserveMedia(record: MediaRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error("duplicate");
    this.records.set(record.id, record);
  }

  public async completeMedia(input: {
    readonly id: string;
    readonly size: number;
    readonly sha256: string;
  }): Promise<MediaRecord> {
    if (this.failCompletion) throw new Error("database unavailable");
    const current = this.records.get(input.id)!;
    const next: MediaRecord = {
      ...current,
      status: "ready",
      size: input.size,
      sha256: input.sha256,
    };
    this.records.set(input.id, next);
    return next;
  }

  public async failMedia(input: { readonly id: string; readonly reason: string }): Promise<void> {
    const current = this.records.get(input.id)!;
    this.records.set(input.id, {
      ...current,
      status: "failed",
      size: null,
      sha256: null,
      failureReason: input.reason,
    });
  }

  public async getMedia(id: string): Promise<MediaRecord | null> {
    return this.records.get(id) ?? null;
  }

  public async listAllMedia(workspaceId: string): Promise<readonly MediaRecord[]> {
    return [...this.records.values()].filter((record) => record.workspaceId === workspaceId);
  }

  public async deleteMediaRecord(input: {
    readonly id: string;
    readonly expectedStatus: MediaRecordStatus;
  }): Promise<void> {
    if (this.records.get(input.id)?.status !== input.expectedStatus) throw new Error("state conflict");
    if (this.failDeletion) {
      throw new ApplicationError("MEDIA_IN_USE", 409, "referenced");
    }
    this.records.delete(input.id);
  }
}

class MemoryDocumentMediaReferenceStore implements DocumentMediaReferenceStore {
  public lastInput: Parameters<DocumentMediaReferenceStore["validateAndReplaceDocumentMedia"]>[0] | null = null;
  public result: DocumentMediaReferenceReplaceResult = { status: "committed" };

  public async validateAndReplaceDocumentMedia(
    input: Parameters<DocumentMediaReferenceStore["validateAndReplaceDocumentMedia"]>[0],
  ): Promise<DocumentMediaReferenceReplaceResult> {
    this.lastInput = input;
    return this.result;
  }

  public async listMediaUsages(): Promise<readonly DocumentMediaReferenceEdge[]> {
    return [];
  }
}

class MemoryMediaStorage implements MediaStorage {
  public readonly objects = new Map<string, Uint8Array>();
  public failWrite = false;

  public async write(input: {
    readonly storageKey: string;
    readonly stream: AsyncIterable<Uint8Array>;
    readonly maxBytes: number;
  }) {
    if (this.failWrite) throw new ApplicationError("MEDIA_STORAGE_FAILED", 500, "failed");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of input.stream) {
      size += chunk.byteLength;
      if (size > input.maxBytes) throw new ApplicationError("MEDIA_SIZE_LIMIT_EXCEEDED", 413, "large");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    this.objects.set(input.storageKey, bytes);
    return { size, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  public async open(storageKey: string): Promise<AsyncIterable<Uint8Array>> {
    const bytes = this.objects.get(storageKey)!;
    return (async function* () { yield bytes; })();
  }

  public async exists(storageKey: string): Promise<boolean> {
    return this.objects.has(storageKey);
  }

  public async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }

  public async listKeys(): Promise<readonly string[]> {
    return [...this.objects.keys()];
  }
}

function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
}

function stream(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes.subarray(0, 4);
    yield bytes.subarray(4);
  })();
}

function fixture() {
  const store = new MemoryMediaStore();
  const storage = new MemoryMediaStorage();
  let id = 0;
  const service = new MediaApplicationService(
    store,
    storage,
    new BasicMediaTypeInspector(),
    {
      now: () => "2026-07-15T12:00:00Z",
      newMediaId: () => `media_${++id}`,
      storageKeyFor: (mediaId) => `objects/${mediaId}`,
    },
    { maxUploadBytes: 64, allowedMimeTypes: ["image/*"] },
  );
  return { store, storage, service };
}

describe("MediaApplicationService", () => {
  it("streams a verified upload into stable metadata and a MediaId reference", async () => {
    const { store, storage, service } = fixture();
    const result = await service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "photo.png",
      declaredMimeType: "image/png",
      stream: stream(pngBytes()),
    });

    expect(result.media).toMatchObject({
      id: "media_1",
      status: "ready",
      mimeType: "image/png",
      size: 11,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.reference).toEqual({ $xecmsRef: "media", mediaId: "media_1" });
    expect(storage.objects.has("objects/media_1")).toBe(true);
    expect(store.records.get("media_1")?.status).toBe("ready");
  });

  it("rejects MIME spoofing before reservation and cleans up finalization failure", async () => {
    const { store, storage, service } = fixture();
    await expect(service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "../escape.png",
      declaredMimeType: "image/png",
      stream: stream(pngBytes()),
    })).rejects.toMatchObject({ code: "MEDIA_FILE_NAME_INVALID", status: 422 });
    await expect(service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "fake.jpg",
      declaredMimeType: "image/jpeg",
      stream: stream(pngBytes()),
    })).rejects.toMatchObject({ code: "MEDIA_MIME_MISMATCH", status: 415 });
    expect(store.records.size).toBe(0);

    store.failCompletion = true;
    await expect(service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "photo.png",
      declaredMimeType: "image/png",
      stream: stream(pngBytes()),
    })).rejects.toThrow("database unavailable");
    expect(storage.objects.size).toBe(0);
    expect(store.records.get("media_1")).toMatchObject({
      status: "failed",
      failureReason: "metadata-finalization-failed",
    });
  });

  it("reports missing, orphan, and incomplete objects", async () => {
    const { store, storage, service } = fixture();
    await service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "photo.png",
      declaredMimeType: "image/png",
      stream: stream(pngBytes()),
    });
    storage.objects.delete("objects/media_1");
    storage.objects.set("objects/orphan", Uint8Array.of(1));
    store.records.set("media_pending", {
      id: "media_pending",
      workspaceId: "wrk_default",
      originalFileName: "pending.png",
      mimeType: "image/png",
      storageKey: "objects/media_pending",
      status: "pending",
      size: null,
      sha256: null,
      createdAt: "2026-07-15T12:00:00Z",
      createdBy: "subject_owner",
    });

    const report = await service.checkConsistency("wrk_default");
    expect(report.missing.map(({ id }) => id)).toEqual(["media_1"]);
    expect(report.orphanStorageKeys).toEqual(["objects/orphan"]);
    expect(report.incomplete.map(({ id }) => id)).toEqual(["media_pending"]);
    expect(report.healthyCount).toBe(0);
  });

  it("validates upload-field references against ready metadata and workspace isolation", async () => {
    const { store, service } = fixture();
    await service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "photo.png",
      declaredMimeType: "image/png",
      stream: stream(pngBytes()),
    });
    await expect(service.validateUploadField({
      workspaceId: "wrk_default",
      fieldName: "gallery",
      value: ["media_1"],
      multiple: true,
      required: true,
    })).resolves.toEqual([{ $xecmsRef: "media", mediaId: "media_1" }]);
    await expect(service.validateUploadField({
      workspaceId: "wrk_other",
      fieldName: "cover",
      value: "media_1",
      multiple: false,
      required: true,
    })).rejects.toMatchObject({
      code: "MEDIA_REFERENCE_INVALID",
      options: { details: { issues: [{ reason: "workspace-mismatch" }] } },
    });
    expect(store.records.get("media_1")?.status).toBe("ready");
  });

  it("lists ready media by default and retains bytes when references veto deletion", async () => {
    const { store, storage, service } = fixture();
    await service.upload({
      workspaceId: "wrk_default",
      actorId: "subject_owner",
      originalFileName: "photo.png",
      declaredMimeType: "image/png",
      stream: stream(pngBytes()),
    });
    store.records.set("media_pending", {
      id: "media_pending",
      workspaceId: "wrk_default",
      originalFileName: "pending.png",
      mimeType: "image/png",
      storageKey: "objects/media_pending",
      status: "pending",
      size: null,
      sha256: null,
      createdAt: "2026-07-15T12:00:00Z",
      createdBy: "subject_owner",
    });

    expect((await service.list("wrk_default")).map(({ id }) => id)).toEqual(["media_1"]);
    expect((await service.list("wrk_default", { includeIncomplete: true })).map(({ id }) => id))
      .toEqual(["media_1", "media_pending"]);

    store.failDeletion = true;
    await expect(service.delete("media_1")).rejects.toMatchObject({ code: "MEDIA_IN_USE" });
    expect(storage.objects.has("objects/media_1")).toBe(true);
    expect(store.records.has("media_1")).toBe(true);
  });
});

describe("MediaReferenceApplicationService", () => {
  it("projects canonical stable Media IDs for one and many upload fields", async () => {
    const store = new MemoryDocumentMediaReferenceStore();
    const service = new MediaReferenceApplicationService(store);
    const edges = await service.synchronizeDocument({
      workspaceId: "wrk_default",
      sourceDocumentId: "doc_post",
      expectedDocumentVersion: 3,
      data: { cover: "media_cover", gallery: ["media_one", "media_two"] },
      fields: [
        {
          fieldName: "cover",
          multiple: false,
          required: true,
          acceptedMimeTypes: ["image/png", "image/webp"],
        },
        { fieldName: "gallery", multiple: true, required: false },
      ],
    });

    expect(edges).toEqual([
      {
        sourceDocumentId: "doc_post",
        fieldName: "cover",
        mediaId: "media_cover",
        ordinal: 0,
        acceptedMimeTypes: ["image/png", "image/webp"],
      },
      { sourceDocumentId: "doc_post", fieldName: "gallery", mediaId: "media_one", ordinal: 0 },
      { sourceDocumentId: "doc_post", fieldName: "gallery", mediaId: "media_two", ordinal: 1 },
    ]);
    expect(store.lastInput).toEqual(expect.objectContaining({ edges }));
  });

  it("surfaces unavailable media returned by the transactional projection store", async () => {
    const store = new MemoryDocumentMediaReferenceStore();
    store.result = {
      status: "invalid-media",
      issues: [{ mediaId: "media_missing", reason: "not-found" }],
    };
    const service = new MediaReferenceApplicationService(store);

    await expect(service.synchronizeDocument({
      workspaceId: "wrk_default",
      sourceDocumentId: "doc_post",
      expectedDocumentVersion: 3,
      data: { cover: "media_missing" },
      fields: [{ fieldName: "cover", multiple: false, required: true }],
    })).rejects.toMatchObject({
      code: "MEDIA_REFERENCE_INVALID",
      options: { details: { issues: [{ mediaId: "media_missing", reason: "not-found" }] } },
    });
  });
});
