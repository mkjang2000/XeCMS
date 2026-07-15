import { describe, expect, it } from "vitest";
import {
  asCollectionId,
  asDocumentId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
} from "../document/index.js";
import {
  addHierarchyNode,
  buildContentHierarchyClosure,
  createContentHierarchySnapshot,
  hierarchyAncestors,
  hierarchyChildren,
  hierarchyDescendants,
  hierarchyRoots,
  hierarchySubtree,
  moveHierarchyNode,
  removeHierarchyNode,
  reorderHierarchyChildren,
  type ContentHierarchySnapshot,
} from "./index.js";

const workspaceId = asWorkspaceId("wrk_default");
const collectionId = asCollectionId("col_pages");
const actorId = asSubjectId("subject_owner");
const now = asUtcInstant("2026-07-15T00:00:00.000Z");
const rootA = asDocumentId("doc_root_a");
const rootB = asDocumentId("doc_root_b");
const childA = asDocumentId("doc_child_a");
const childB = asDocumentId("doc_child_b");
const grandchild = asDocumentId("doc_grandchild");

function snapshot(): ContentHierarchySnapshot {
  return createContentHierarchySnapshot({
    workspaceId,
    collectionId,
    version: 5,
    positions: [
      { documentId: rootA, parentId: null, sortKey: 0, depth: 0 },
      { documentId: rootB, parentId: null, sortKey: 1, depth: 0 },
      { documentId: childA, parentId: rootA, sortKey: 0, depth: 1 },
      { documentId: childB, parentId: rootA, sortKey: 1, depth: 1 },
      { documentId: grandchild, parentId: childA, sortKey: 0, depth: 2 },
    ],
  });
}

const metadata = { actorId, now, expectedVersion: 5, maxDepth: 4 } as const;

describe("content hierarchy forest model", () => {
  it("queries roots, children, breadcrumb ancestors, descendants and subtree deterministically", () => {
    const state = snapshot();
    expect(hierarchyRoots(state).map(({ documentId }) => documentId)).toEqual([rootA, rootB]);
    expect(hierarchyChildren(state, rootA).map(({ documentId }) => documentId)).toEqual([childA, childB]);
    expect(hierarchyAncestors(state, grandchild).map(({ documentId }) => documentId)).toEqual([rootA, childA]);
    expect(hierarchyDescendants(state, rootA).map(({ documentId }) => documentId)).toEqual([
      childA,
      grandchild,
      childB,
    ]);
    expect(hierarchySubtree(state, childA).map(({ documentId }) => documentId)).toEqual([
      childA,
      grandchild,
    ]);
  });

  it("builds self and transitive closure rows", () => {
    const closure = buildContentHierarchyClosure(snapshot());
    expect(closure).toContainEqual({ ancestorId: rootA, descendantId: rootA, distance: 0 });
    expect(closure).toContainEqual({ ancestorId: rootA, descendantId: grandchild, distance: 2 });
    expect(closure).toContainEqual({ ancestorId: childA, descendantId: grandchild, distance: 1 });
    expect(closure).not.toContainEqual(expect.objectContaining({ ancestorId: rootB, descendantId: childA }));
  });

  it("adds a node at an explicit sibling position and shifts following siblings", () => {
    const created = addHierarchyNode(snapshot(), {
      ...metadata,
      documentId: asDocumentId("doc_inserted"),
      parentId: rootA,
      position: 1,
    });
    expect(created.state.version).toBe(6);
    expect(hierarchyChildren(created.state, rootA).map(({ documentId, sortKey, depth }) => ({ documentId, sortKey, depth })))
      .toEqual([
        { documentId: childA, sortKey: 0, depth: 1 },
        { documentId: "doc_inserted", sortKey: 1, depth: 1 },
        { documentId: childB, sortKey: 2, depth: 1 },
      ]);
    expect(created.event).toMatchObject({ type: "tree.node.created", structureVersion: 6 });
  });

  it("moves a subtree, closes both sibling gaps and recalculates every descendant depth", () => {
    const moved = moveHierarchyNode(snapshot(), {
      ...metadata,
      documentId: childA,
      newParentId: rootB,
      position: 0,
    });
    expect(hierarchyChildren(moved.state, rootA).map(({ documentId, sortKey }) => ({ documentId, sortKey })))
      .toEqual([{ documentId: childB, sortKey: 0 }]);
    expect(hierarchyChildren(moved.state, rootB).map(({ documentId }) => documentId)).toEqual([childA]);
    expect(hierarchySubtree(moved.state, childA).map(({ documentId, depth }) => ({ documentId, depth })))
      .toEqual([
        { documentId: childA, depth: 1 },
        { documentId: grandchild, depth: 2 },
      ]);
  });

  it("reorders exactly one sibling set", () => {
    const reordered = reorderHierarchyChildren(snapshot(), {
      ...metadata,
      parentId: rootA,
      orderedDocumentIds: [childB, childA],
    });
    expect(hierarchyChildren(reordered.state, rootA).map(({ documentId, sortKey }) => ({ documentId, sortKey })))
      .toEqual([
        { documentId: childB, sortKey: 0 },
        { documentId: childA, sortKey: 1 },
      ]);
    expect(reordered.event.type).toBe("tree.node.reordered");
  });

  it("promotes children when removing a structural node", () => {
    const removed = removeHierarchyNode(snapshot(), {
      ...metadata,
      documentId: childA,
      promoteChildren: true,
    });
    expect(hierarchyChildren(removed.state, rootA).map(({ documentId, depth }) => ({ documentId, depth })))
      .toEqual([
        { documentId: grandchild, depth: 1 },
        { documentId: childB, depth: 1 },
      ]);
  });

  it.each([
    {
      name: "self parent",
      input: { documentId: childA, newParentId: childA, position: 0 },
      code: "HIERARCHY_SELF_PARENT",
    },
    {
      name: "descendant parent cycle",
      input: { documentId: rootA, newParentId: grandchild, position: 0 },
      code: "HIERARCHY_CYCLE",
    },
    {
      name: "max depth",
      input: { documentId: childA, newParentId: childB, position: 0 },
      code: "HIERARCHY_MAX_DEPTH_EXCEEDED",
      maxDepth: 2,
    },
  ])("rejects $name without changing its immutable input", ({ input, code, maxDepth }) => {
    const state = snapshot();
    const before = structuredClone(state);
    expect(() => moveHierarchyNode(state, {
      ...metadata,
      ...input,
      ...(maxDepth === undefined ? {} : { maxDepth }),
    })).toThrowError(expect.objectContaining({ code }));
    expect(state).toEqual(before);
  });

  it("rejects stale versions, incomplete reorder sets and child removal without promotion", () => {
    expect(() => moveHierarchyNode(snapshot(), {
      ...metadata,
      expectedVersion: 4,
      documentId: childB,
      newParentId: rootB,
      position: 0,
    })).toThrowError(expect.objectContaining({ code: "HIERARCHY_VERSION_CONFLICT" }));
    expect(() => reorderHierarchyChildren(snapshot(), {
      ...metadata,
      parentId: rootA,
      orderedDocumentIds: [childA],
    })).toThrowError(expect.objectContaining({ code: "HIERARCHY_REORDER_SET_INVALID" }));
    expect(() => removeHierarchyNode(snapshot(), {
      ...metadata,
      documentId: childA,
    })).toThrowError(expect.objectContaining({ code: "HIERARCHY_NODE_HAS_CHILDREN" }));
  });

  it("rejects malformed persisted forests", () => {
    expect(() => createContentHierarchySnapshot({
      workspaceId,
      collectionId,
      version: 0,
      positions: [
        { documentId: rootA, parentId: null, sortKey: 1, depth: 0 },
      ],
    })).toThrowError(expect.objectContaining({ code: "HIERARCHY_INVARIANT_VIOLATION" }));
  });
});

