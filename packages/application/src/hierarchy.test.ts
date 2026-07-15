import {
  addHierarchyNode,
  asCollectionId as asCoreCollectionId,
  asDocumentId,
  asWorkspaceId,
  createContentHierarchySnapshot,
  hierarchyAncestors,
  hierarchyChildren,
  hierarchyDescendants,
  hierarchyRoots,
  hierarchySubtree,
  moveHierarchyNode,
  removeHierarchyNode,
  reorderHierarchyChildren,
  type AddHierarchyNodeInput,
  type ContentHierarchyCommandResult,
  type ContentHierarchySnapshot,
  type DocumentId,
  type MoveHierarchyNodeInput,
  type RemoveHierarchyNodeInput,
  type ReorderHierarchyChildrenInput,
} from "@xecms/core";
import { asCollectionId, asFieldId, type CollectionDefinition, type SchemaIrV1 } from "@xecms/schema";
import { describe, expect, it } from "vitest";
import {
  ContentHierarchyApplicationService,
  contentHierarchyResourceProjection,
  type ContentHierarchyQueryResult,
  type ContentHierarchyStore,
  type ContentHierarchyStoreContext,
} from "./hierarchy.js";
import { ApplicationError, type ActorContext } from "./errors.js";
import type { SchemaRevisionRecord, SchemaStore } from "./schema.js";

const collection: CollectionDefinition = {
  id: asCollectionId("col_pages"),
  name: "pages",
  fields: [{ id: asFieldId("fld_title"), name: "title", type: "text" }],
  hierarchy: {
    enabled: true,
    maxDepth: 2,
    ordering: "manual",
    permissionInheritance: true,
  },
};
const actor: ActorContext = {
  subjectId: "subject_owner",
  workspaceId: "wrk_default",
  capabilities: ["document:read", "document:update"],
};

describe("ContentHierarchyApplicationService", () => {
  it("runs hierarchy queries and exposes M3 resource move impact when inheritance is enabled", async () => {
    const store = new MemoryHierarchyStore();
    const service = application(store, collection);
    await service.addNode(actor, "pages", {
      documentId: "doc_root_a",
      parentId: null,
      position: 0,
      expectedVersion: 0,
    });
    await service.addNode(actor, "pages", {
      documentId: "doc_root_b",
      parentId: null,
      position: 1,
      expectedVersion: 1,
    });
    await service.addNode(actor, "pages", {
      documentId: "doc_child",
      parentId: "doc_root_a",
      position: 0,
      expectedVersion: 2,
    });
    await service.addNode(actor, "pages", {
      documentId: "doc_grandchild",
      parentId: "doc_child",
      position: 0,
      expectedVersion: 3,
    });

    expect((await service.listRoots(actor, "col_pages")).items.map(({ documentId }) => documentId))
      .toEqual(["doc_root_a", "doc_root_b"]);
    expect((await service.listChildren(actor, "pages", "doc_root_a")).items.map(({ documentId }) => documentId))
      .toEqual(["doc_child"]);
    expect((await service.listAncestors(actor, "pages", "doc_grandchild")).items.map(({ documentId }) => documentId))
      .toEqual(["doc_root_a", "doc_child"]);
    expect((await service.getSubtree(actor, "pages", "doc_child")).items.map(({ documentId }) => documentId))
      .toEqual(["doc_child", "doc_grandchild"]);

    const moveRequest = {
      documentId: "doc_child",
      newParentId: "doc_root_b",
      position: 0,
      expectedVersion: 4,
    } as const;
    const preview = await service.previewMove(actor, "pages", moveRequest);
    expect(preview.state.version).toBe(5);
    expect((await service.listChildren(actor, "pages", "doc_root_a")).items.map(({ documentId }) => documentId))
      .toEqual(["doc_child"]);
    expect((await service.listAll(actor, "pages")).version).toBe(4);
    const moved = await service.moveNode(actor, "pages", moveRequest);
    expect(moved.permissionImpact).toEqual({
      documentId: "doc_child",
      documentResourceId: "resource:document:doc_child",
      beforeParentResourceId: "resource:document:doc_root_a",
      afterParentResourceId: "resource:document:doc_root_b",
      beforeDocumentPath: ["doc_root_a", "doc_child"],
      afterDocumentPath: ["doc_root_b", "doc_child"],
      beforeResourcePath: [
        "resource:collection:col_pages",
        "resource:document:doc_root_a",
        "resource:document:doc_child",
      ],
      afterResourcePath: [
        "resource:collection:col_pages",
        "resource:document:doc_root_b",
        "resource:document:doc_child",
      ],
      affectedDocumentIds: ["doc_child", "doc_grandchild"],
      affectedResourceIds: ["resource:document:doc_child", "resource:document:doc_grandchild"],
    });
    expect(contentHierarchyResourceProjection("col_pages", moved.state.positions.find(
      ({ documentId }) => documentId === "doc_child",
    )!)).toEqual({
      resourceId: "resource:document:doc_child",
      parentResourceId: "resource:document:doc_root_b",
      resourceType: "document",
      documentId: "doc_child",
      collectionId: "col_pages",
    });
  });

  it("uses non-system Actor Realm resources for hierarchy checks, projections, and move impact", async () => {
    const store = new MemoryHierarchyStore();
    const service = application(store, collection);
    const checkedResources: string[] = [];
    const realmActor: ActorContext = {
      ...actor,
      realmId: "rlm_community",
      subjectId: "subject_community_owner",
      capabilities: [],
      authorization: {
        require: async ({ resourceId }) => { checkedResources.push(resourceId); },
        filterReadableData: async ({ data }) => data,
        assertWritableData: async () => undefined,
      },
    };
    await service.addNode(realmActor, "pages", {
      documentId: "doc_root_a",
      parentId: null,
      position: 0,
      expectedVersion: 0,
    });
    await service.addNode(realmActor, "pages", {
      documentId: "doc_root_b",
      parentId: null,
      position: 1,
      expectedVersion: 1,
    });
    await service.addNode(realmActor, "pages", {
      documentId: "doc_child",
      parentId: "doc_root_a",
      position: 0,
      expectedVersion: 2,
    });
    const moved = await service.moveNode(realmActor, "pages", {
      documentId: "doc_child",
      newParentId: "doc_root_b",
      position: 0,
      expectedVersion: 3,
    });

    expect(checkedResources).toContain(
      "authorization:rlm_community:resource:collection:col_pages",
    );
    expect(checkedResources).toContain(
      "authorization:rlm_community:resource:document:doc_child",
    );
    expect(checkedResources.every((resourceId) =>
      resourceId.startsWith("authorization:rlm_community:resource:"))).toBe(true);
    expect(moved.permissionImpact).toMatchObject({
      documentResourceId: "authorization:rlm_community:resource:document:doc_child",
      beforeParentResourceId: "authorization:rlm_community:resource:document:doc_root_a",
      afterParentResourceId: "authorization:rlm_community:resource:document:doc_root_b",
      beforeResourcePath: [
        "authorization:rlm_community:resource:collection:col_pages",
        "authorization:rlm_community:resource:document:doc_root_a",
        "authorization:rlm_community:resource:document:doc_child",
      ],
    });
    expect(contentHierarchyResourceProjection(
      "col_pages",
      moved.state.positions.find(({ documentId }) => documentId === "doc_child")!,
      realmActor.realmId,
    )).toMatchObject({
      resourceId: "authorization:rlm_community:resource:document:doc_child",
      parentResourceId: "authorization:rlm_community:resource:document:doc_root_b",
    });
  });

  it("maps cycle, max-depth and stale-version domain failures to stable application errors", async () => {
    const store = new MemoryHierarchyStore();
    const service = application(store, collection);
    await service.addNode(actor, "pages", { documentId: "doc_root", parentId: null, position: 0, expectedVersion: 0 });
    await service.addNode(actor, "pages", { documentId: "doc_child", parentId: "doc_root", position: 0, expectedVersion: 1 });
    await service.addNode(actor, "pages", { documentId: "doc_leaf", parentId: "doc_child", position: 0, expectedVersion: 2 });
    await service.addNode(actor, "pages", { documentId: "doc_other", parentId: null, position: 1, expectedVersion: 3 });

    await expect(service.moveNode(actor, "pages", {
      documentId: "doc_root",
      newParentId: "doc_leaf",
      position: 0,
      expectedVersion: 4,
    })).rejects.toMatchObject({ code: "HIERARCHY_CYCLE", status: 422 });
    await expect(service.moveNode(actor, "pages", {
      documentId: "doc_other",
      newParentId: "doc_leaf",
      position: 0,
      expectedVersion: 4,
    })).rejects.toMatchObject({ code: "HIERARCHY_MAX_DEPTH_EXCEEDED", status: 422 });
    await expect(service.moveNode(actor, "pages", {
      documentId: "doc_leaf",
      newParentId: null,
      position: 2,
      expectedVersion: 3,
    })).rejects.toMatchObject({ code: "HIERARCHY_VERSION_CONFLICT", status: 409 });
  });

  it("requires update scope for every affected descendant before previewing or committing a subtree move", async () => {
    const store = new MemoryHierarchyStore();
    const service = application(store, collection);
    await service.addNode(actor, "pages", {
      documentId: "doc_root_a",
      parentId: null,
      position: 0,
      expectedVersion: 0,
    });
    await service.addNode(actor, "pages", {
      documentId: "doc_root_b",
      parentId: null,
      position: 1,
      expectedVersion: 1,
    });
    await service.addNode(actor, "pages", {
      documentId: "doc_child",
      parentId: "doc_root_a",
      position: 0,
      expectedVersion: 2,
    });
    await service.addNode(actor, "pages", {
      documentId: "doc_secret_descendant",
      parentId: "doc_child",
      position: 0,
      expectedVersion: 3,
    });
    const checkedResources: string[] = [];
    const restrictedActor: ActorContext = {
      subjectId: "subject_restricted_mover",
      workspaceId: "wrk_default",
      capabilities: [],
      authorization: {
        require: async ({ resourceId }) => {
          checkedResources.push(resourceId);
          if (resourceId === "resource:document:doc_secret_descendant") {
            throw new ApplicationError("AUTHORIZATION_DENIED", 403, "Authorization denied.");
          }
        },
        filterReadableData: async ({ data }) => data,
        assertWritableData: async () => undefined,
      },
    };
    const request = {
      documentId: "doc_child",
      newParentId: "doc_root_b",
      position: 0,
      expectedVersion: 4,
    } as const;

    await expect(service.previewMove(restrictedActor, "pages", request)).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
      status: 403,
    });
    expect(checkedResources).toContain("resource:document:doc_secret_descendant");
    expect((await service.listAll(actor, "pages")).version).toBe(4);
    expect((await service.listChildren(actor, "pages", "doc_root_a")).items.map(({ documentId }) => documentId))
      .toEqual(["doc_child"]);

    checkedResources.length = 0;
    await expect(service.moveNode(restrictedActor, "pages", request)).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
      status: 403,
    });
    expect(checkedResources).toContain("resource:document:doc_secret_descendant");
    expect((await service.listAll(actor, "pages")).version).toBe(4);
  });

  it("denies and sanitizes move previews when a discovered ancestor path is unreadable", async () => {
    const store = new MemoryHierarchyStore();
    const service = application(store, collection);
    await service.addNode(actor, "pages", { documentId: "doc_root_a", parentId: null, position: 0, expectedVersion: 0 });
    await service.addNode(actor, "pages", { documentId: "doc_root_b", parentId: null, position: 1, expectedVersion: 1 });
    await service.addNode(actor, "pages", { documentId: "doc_child", parentId: "doc_root_a", position: 0, expectedVersion: 2 });
    const restrictedActor: ActorContext = {
      subjectId: "subject_path_restricted",
      workspaceId: "wrk_default",
      capabilities: [],
      authorization: {
        require: async ({ action, resourceId }) => {
          if (action === "content.read" && resourceId === "resource:document:doc_root_a") {
            throw new ApplicationError(
              "AUTHORIZATION_DENIED",
              403,
              "Denied resource:document:doc_root_a",
              { details: { resourceId } },
            );
          }
        },
        filterReadableData: async ({ data }) => data,
        assertWritableData: async () => undefined,
      },
    };
    let denial: unknown;
    try {
      await service.previewMove(restrictedActor, "pages", {
        documentId: "doc_child",
        newParentId: "doc_root_b",
        position: 0,
        expectedVersion: 3,
      });
    } catch (error: unknown) {
      denial = error;
    }
    expect(denial).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      status: 403,
      options: {},
    });
    expect(String((denial as Error).message)).not.toContain("doc_root_a");
    expect((await service.listAll(actor, "pages")).version).toBe(3);
  });

  it("requires an enabled collection and the existing content capabilities", async () => {
    const { hierarchy: _hierarchy, ...disabled } = collection;
    await expect(application(new MemoryHierarchyStore(), disabled).listRoots(actor, "pages"))
      .rejects.toMatchObject({ code: "HIERARCHY_NOT_ENABLED", status: 409 });
    await expect(application(new MemoryHierarchyStore(), collection).listRoots({
      ...actor,
      capabilities: [],
    }, "pages")).rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
  });
});

class MemoryHierarchyStore implements ContentHierarchyStore {
  private state: ContentHierarchySnapshot = createContentHierarchySnapshot({
    workspaceId: asWorkspaceId("wrk_default"),
    collectionId: asCoreCollectionId("col_pages"),
    version: 0,
    positions: [],
  });

  async listRoots(_context: ContentHierarchyStoreContext): Promise<ContentHierarchyQueryResult> {
    return this.result(hierarchyRoots(this.state));
  }

  async listChildren(_context: ContentHierarchyStoreContext, parentId: DocumentId): Promise<ContentHierarchyQueryResult> {
    return this.result(hierarchyChildren(this.state, parentId));
  }

  async listAncestors(_context: ContentHierarchyStoreContext, documentId: DocumentId): Promise<ContentHierarchyQueryResult> {
    return this.result(hierarchyAncestors(this.state, documentId));
  }

  async listDescendants(_context: ContentHierarchyStoreContext, documentId: DocumentId): Promise<ContentHierarchyQueryResult> {
    return this.result(hierarchyDescendants(this.state, documentId));
  }

  async getSubtree(_context: ContentHierarchyStoreContext, documentId: DocumentId): Promise<ContentHierarchyQueryResult> {
    return this.result(hierarchySubtree(this.state, documentId));
  }

  async listAll(_context: ContentHierarchyStoreContext): Promise<ContentHierarchyQueryResult> {
    return this.result(this.state.positions);
  }

  async previewMove(_context: ContentHierarchyStoreContext, input: MoveHierarchyNodeInput) {
    return moveHierarchyNode(this.state, input);
  }

  async addNode(_context: ContentHierarchyStoreContext, input: AddHierarchyNodeInput) {
    return this.mutate(addHierarchyNode(this.state, input));
  }

  async moveNode(_context: ContentHierarchyStoreContext, input: MoveHierarchyNodeInput) {
    return this.mutate(moveHierarchyNode(this.state, input));
  }

  async reorderChildren(_context: ContentHierarchyStoreContext, input: ReorderHierarchyChildrenInput) {
    return this.mutate(reorderHierarchyChildren(this.state, input));
  }

  async removeNode(_context: ContentHierarchyStoreContext, input: RemoveHierarchyNodeInput) {
    return this.mutate(removeHierarchyNode(this.state, input));
  }

  private result(items: ContentHierarchyQueryResult["items"]): ContentHierarchyQueryResult {
    return { version: this.state.version, items };
  }

  private mutate(result: ContentHierarchyCommandResult): ContentHierarchyCommandResult {
    this.state = result.state;
    return result;
  }
}

function application(store: ContentHierarchyStore, hierarchyCollection: CollectionDefinition) {
  const schema: SchemaIrV1 = {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [hierarchyCollection],
  };
  const revision: SchemaRevisionRecord = {
    revisionId: "sch_active",
    parentRevisionId: null,
    schema,
    createdAt: "2026-07-15T00:00:00.000Z",
    createdBy: "subject_owner",
    hash: "test",
  };
  const schemas: SchemaStore = {
    issueSchemaIds: async () => [],
    getActiveSchema: async () => revision,
    getSchemaDraft: async () => null,
    saveSchemaDraft: async () => { throw new Error("not used"); },
    applySchemaDraft: async () => { throw new Error("not used"); },
  };
  return new ContentHierarchyApplicationService(schemas, store, {
    now: () => "2026-07-15T00:00:00.000Z",
  });
}
