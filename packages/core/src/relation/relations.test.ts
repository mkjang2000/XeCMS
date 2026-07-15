import { describe, expect, it } from "vitest";
import {
  asCollectionId,
  asDocumentId,
  createDocumentReference,
  extractDocumentRelations,
  planRelationTargetDeletion,
  type IncomingDocumentRelation,
  type RelationFieldContract,
} from "../index.js";

const posts = asCollectionId("col_posts");
const authors = asCollectionId("col_authors");
const post = asDocumentId("doc_post");
const alice = asDocumentId("doc_alice");
const bob = asDocumentId("doc_bob");

function contract(overrides: Partial<RelationFieldContract> = {}): RelationFieldContract {
  return {
    relationId: "rel_post_authors",
    fieldName: "authors",
    sourceCollectionId: posts,
    targetCollectionId: authors,
    cardinality: "many",
    required: false,
    onDelete: "restrict",
    ...overrides,
  };
}

describe("stable document relations", () => {
  it("normalizes one/many fields into ordered stable DocumentId edges", () => {
    const edges = extractDocumentRelations({
      collectionId: posts,
      documentId: post,
      data: {
        authors: [alice, bob],
      },
      fields: [contract()],
    });

    expect(edges.map(({ targetDocumentId, ordinal }) => [targetDocumentId, ordinal])).toEqual([
      [alice, 0],
      [bob, 1],
    ]);
    expect(edges.every((edge) => !("revisionId" in edge))).toBe(true);
    expect(Object.isFrozen(edges)).toBe(true);
  });

  it("rejects cardinality, cross-collection, duplicate, and payload-limit violations", () => {
    const author = createDocumentReference({ collectionId: authors, documentId: alice });
    const category = createDocumentReference({
      collectionId: asCollectionId("col_categories"),
      documentId: asDocumentId("doc_category"),
    });
    expect(() => extractDocumentRelations({
      collectionId: posts,
      documentId: post,
      data: { authors: author },
      fields: [contract()],
    })).toThrowError(expect.objectContaining({ code: "RELATION_CARDINALITY_MISMATCH" }));
    expect(() => extractDocumentRelations({
      collectionId: posts,
      documentId: post,
      data: { authors: [category] },
      fields: [contract()],
    })).toThrowError(expect.objectContaining({ code: "RELATION_TARGET_COLLECTION_MISMATCH" }));
    expect(() => extractDocumentRelations({
      collectionId: posts,
      documentId: post,
      data: { authors: [author, author] },
      fields: [contract()],
    })).toThrowError(expect.objectContaining({ code: "RELATION_DUPLICATE_TARGET" }));
    expect(() => extractDocumentRelations({
      collectionId: posts,
      documentId: post,
      data: { authors: [author, createDocumentReference({ collectionId: authors, documentId: bob })] },
      fields: [contract()],
      maxReferences: 1,
    })).toThrowError(expect.objectContaining({ code: "RELATION_REFERENCE_LIMIT_EXCEEDED" }));
  });

  it("plans restrict, nullify, and deduplicated cascade effects", () => {
    const reference = createDocumentReference({ collectionId: authors, documentId: alice });
    const incoming = ([
      ["restrict", "doc_restrict", { author: reference }],
      ["nullify", "doc_nullify", { author: reference }],
      ["cascade", "doc_cascade", { author: reference }],
      ["cascade", "doc_cascade", { author: reference }],
    ] as const).map(([onDelete, sourceId, sourceData], ordinal) => ({
      edge: {
        relationId: `rel_${onDelete}_${ordinal}`,
        fieldName: "author",
        sourceCollectionId: posts,
        sourceDocumentId: asDocumentId(sourceId),
        targetCollectionId: authors,
        targetDocumentId: alice,
        ordinal: 0,
        onDelete,
      },
      sourceData,
    })) satisfies IncomingDocumentRelation[];

    const plan = planRelationTargetDeletion(alice, incoming);
    expect(plan.allowed).toBe(false);
    expect(plan.restrictedBy).toHaveLength(1);
    expect(plan.nullifications).toEqual([
      expect.objectContaining({ sourceDocumentId: "doc_nullify", fieldName: "author", nextValue: null }),
    ]);
    expect(plan.cascades).toEqual([{ collectionId: posts, documentId: "doc_cascade" }]);
  });
});
