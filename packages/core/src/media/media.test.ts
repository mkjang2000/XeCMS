import { describe, expect, it } from "vitest";
import {
  asMediaId,
  assertMediaAsset,
  assertSafeOriginalFileName,
  createMediaReference,
  decodeMediaFieldReferences,
  decodeMediaReference,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  createDocument,
} from "../index.js";

describe("media domain", () => {
  it("uses a stable MediaId-only upload reference", () => {
    const reference = createMediaReference(asMediaId("media_1"));
    expect(decodeMediaReference({ $xecmsRef: "media", mediaId: "media_1" })).toEqual(reference);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(reference).not.toHaveProperty("storageKey");
    expect(() => createDocument({
      documentId: asDocumentId("doc_with_media"),
      workspaceId: asWorkspaceId("wrk_default"),
      collectionId: asCollectionId("col_posts"),
      revisionId: asRevisionId("rev_with_media"),
      schemaRevisionId: asSchemaRevisionId("schema_with_media"),
      data: { cover: reference },
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T12:00:00Z"),
    })).not.toThrow();
  });

  it("validates immutable ready metadata", () => {
    expect(() => assertMediaAsset({
      id: asMediaId("media_1"),
      workspaceId: asWorkspaceId("wrk_default"),
      originalFileName: "photo.png",
      mimeType: "image/png",
      size: 8,
      sha256: "a".repeat(64),
      storageKey: "objects/media_1",
      createdAt: asUtcInstant("2026-07-15T12:00:00Z"),
      createdBy: asSubjectId("subject_owner"),
    })).not.toThrow();
    expect(() => assertSafeOriginalFileName("../../secret.txt")).toThrowError(
      expect.objectContaining({ code: "MEDIA_FILE_NAME_INVALID" }),
    );
    expect(() => assertSafeOriginalFileName("folder\\secret.txt")).toThrowError(
      expect.objectContaining({ code: "MEDIA_FILE_NAME_INVALID" }),
    );
  });

  it("enforces upload field one/many cardinality and duplicate limits", () => {
    const first = createMediaReference(asMediaId("media_1"));
    const second = createMediaReference(asMediaId("media_2"));
    expect(decodeMediaFieldReferences({
      fieldName: "gallery",
      value: ["media_1", "media_2"],
      multiple: true,
      required: true,
    })).toEqual([first, second]);
    expect(() => decodeMediaFieldReferences({
      fieldName: "cover",
      value: [first],
      multiple: false,
      required: false,
    })).toThrowError(expect.objectContaining({ code: "MEDIA_CARDINALITY_MISMATCH" }));
    expect(() => decodeMediaFieldReferences({
      fieldName: "gallery",
      value: [first, first],
      multiple: true,
      required: false,
    })).toThrowError(expect.objectContaining({ code: "MEDIA_DUPLICATE_REFERENCE" }));
  });
});
