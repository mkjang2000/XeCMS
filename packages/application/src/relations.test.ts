import { describe, expect, it } from "vitest";
import {
  asCollectionId,
  asDocumentId,
  createDocumentReference,
  type IncomingDocumentRelation,
} from "@xecms/core";
import {
  RelationApplicationService,
  type RelationReplaceResult,
  type RelationStore,
} from "./relations.js";

class MemoryRelationStore implements RelationStore {
  public result: RelationReplaceResult = { status: "committed" };
  public edges: readonly import("@xecms/core").DocumentRelationEdge[] = [];
  public incoming: readonly IncomingDocumentRelation[] = [];

  public async validateAndReplaceDocumentRelations(input: {
    readonly edges: readonly import("@xecms/core").DocumentRelationEdge[];
  }): Promise<RelationReplaceResult> {
    if (this.result.status === "committed") this.edges = input.edges;
    return this.result;
  }

  public async listIncomingDocumentRelations(): Promise<readonly IncomingDocumentRelation[]> {
    return this.incoming;
  }
}

describe("RelationApplicationService", () => {
  it("persists normalized stable edges and rejects invalid target identities", async () => {
    const store = new MemoryRelationStore();
    const service = new RelationApplicationService(store);
    const relation = {
      relationId: "rel_author",
      fieldName: "author",
      sourceCollectionId: asCollectionId("col_posts"),
      targetCollectionId: asCollectionId("col_authors"),
      cardinality: "one" as const,
      required: true,
      onDelete: "restrict" as const,
    };
    const data = { author: "doc_author" };

    await expect(service.synchronizeDocument({
      collectionId: "col_posts",
      documentId: "doc_post",
      expectedDocumentVersion: 2,
      data,
      relations: [relation],
    })).resolves.toEqual([
      expect.objectContaining({ targetDocumentId: "doc_author", ordinal: 0 }),
    ]);
    expect(store.edges[0]).not.toHaveProperty("revisionId");

    store.result = {
      status: "invalid-targets",
      issues: [{
        documentId: "doc_author",
        expectedCollectionId: "col_authors",
        actualCollectionId: "col_users",
        reason: "collection-mismatch",
      }],
    };
    await expect(service.synchronizeDocument({
      collectionId: "col_posts",
      documentId: "doc_post",
      expectedDocumentVersion: 3,
      data,
      relations: [relation],
    })).rejects.toMatchObject({
      code: "RELATION_TARGET_INVALID",
      options: { details: { issues: [{ reason: "collection-mismatch" }] } },
    });
  });

  it("returns deletion effects and fails closed for restrict edges", async () => {
    const store = new MemoryRelationStore();
    const target = asDocumentId("doc_author");
    store.incoming = [{
      edge: {
        relationId: "rel_author",
        fieldName: "author",
        sourceCollectionId: asCollectionId("col_posts"),
        sourceDocumentId: asDocumentId("doc_post"),
        targetCollectionId: asCollectionId("col_authors"),
        targetDocumentId: target,
        ordinal: 0,
        onDelete: "restrict",
      },
      sourceData: {
        author: createDocumentReference({
          collectionId: asCollectionId("col_authors"),
          documentId: target,
        }),
      },
    }];
    const service = new RelationApplicationService(store);

    expect(await service.planTargetDeletion({
      targetCollectionId: "col_authors",
      targetDocumentId: target,
    })).toMatchObject({ allowed: false, restrictedBy: [{ sourceDocumentId: "doc_post" }] });
    await expect(service.requireTargetDeletionAllowed({
      targetCollectionId: "col_authors",
      targetDocumentId: target,
    })).rejects.toMatchObject({ code: "RELATION_DELETE_RESTRICTED", status: 409 });
  });
});
