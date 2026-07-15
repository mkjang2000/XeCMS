import type { DocumentId } from "../document/types.js";
import { ContentHierarchyDomainError } from "./errors.js";
import {
  createContentHierarchySnapshot,
  hierarchyDescendants,
  hierarchyPath,
  hierarchyPositionMap,
  requirePosition,
} from "./model.js";
import type {
  ContentHierarchyCommandResult,
  ContentHierarchyEvent,
  ContentHierarchyPosition,
  ContentHierarchySnapshot,
  HierarchyCommandMetadata,
} from "./types.js";

export interface AddHierarchyNodeInput extends HierarchyCommandMetadata {
  readonly documentId: DocumentId;
  readonly parentId: DocumentId | null;
  readonly position: number;
}

export interface MoveHierarchyNodeInput extends HierarchyCommandMetadata {
  readonly documentId: DocumentId;
  readonly newParentId: DocumentId | null;
  readonly position: number;
}

export interface ReorderHierarchyChildrenInput extends HierarchyCommandMetadata {
  readonly parentId: DocumentId | null;
  readonly orderedDocumentIds: readonly DocumentId[];
}

export interface RemoveHierarchyNodeInput extends HierarchyCommandMetadata {
  readonly documentId: DocumentId;
  readonly promoteChildren?: boolean;
}

export function addHierarchyNode(
  snapshot: ContentHierarchySnapshot,
  input: AddHierarchyNodeInput,
): ContentHierarchyCommandResult {
  assertCommand(snapshot, input);
  if (hierarchyPositionMap(snapshot).has(input.documentId)) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_NODE_ALREADY_EXISTS",
      `Hierarchy node '${input.documentId}' already exists.`,
      { documentId: input.documentId },
    );
  }
  const parent = input.parentId === null ? null : requireParent(snapshot, input.parentId);
  const siblings = siblingsOf(snapshot.positions, input.parentId);
  assertInsertPosition(input.position, siblings.length);
  const nextPositions = snapshot.positions.map((position) =>
    position.parentId === input.parentId && position.sortKey >= input.position
      ? { ...position, sortKey: position.sortKey + 1 }
      : position);
  const created: ContentHierarchyPosition = {
    documentId: input.documentId,
    parentId: input.parentId,
    sortKey: input.position,
    depth: parent === null ? 0 : parent.depth + 1,
  };
  assertDepth(created.depth, input.maxDepth, input.documentId);
  const state = nextState(snapshot, [...nextPositions, created], input.maxDepth);
  return {
    state,
    event: event(
      snapshot,
      state,
      input,
      "tree.node.created",
      input.documentId,
      null,
      positionPayload(created, hierarchyPath(state, input.documentId)),
      [input.documentId],
    ),
  };
}

export function moveHierarchyNode(
  snapshot: ContentHierarchySnapshot,
  input: MoveHierarchyNodeInput,
): ContentHierarchyCommandResult {
  assertCommand(snapshot, input);
  const current = requirePosition(snapshot, input.documentId);
  if (input.newParentId === input.documentId) {
    throw new ContentHierarchyDomainError("HIERARCHY_SELF_PARENT", "A node cannot be its own parent.", {
      documentId: input.documentId,
    });
  }
  const newParent = input.newParentId === null ? null : requireParent(snapshot, input.newParentId);
  const descendants = hierarchyDescendants(snapshot, input.documentId);
  if (input.newParentId !== null && descendants.some(({ documentId }) => documentId === input.newParentId)) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_CYCLE",
      `Node '${input.documentId}' cannot be moved below one of its descendants.`,
      { documentId: input.documentId, newParentId: input.newParentId },
    );
  }

  const destinationSiblings = siblingsOf(snapshot.positions, input.newParentId)
    .filter(({ documentId }) => documentId !== input.documentId);
  assertInsertPosition(input.position, destinationSiblings.length);
  const subtree = [current, ...descendants];
  const subtreeIds = new Set(subtree.map(({ documentId }) => documentId));
  const newDepth = newParent === null ? 0 : newParent.depth + 1;
  const depthDelta = newDepth - current.depth;
  const deepest = Math.max(...subtree.map(({ depth }) => depth + depthDelta));
  assertDepth(deepest, input.maxDepth, input.documentId);

  const unaffected = snapshot.positions.filter(({ documentId }) => !subtreeIds.has(documentId));
  const withoutOldGap = normalizeSiblings(unaffected, current.parentId);
  const shiftedDestination = withoutOldGap.map((position) =>
    position.parentId === input.newParentId && position.sortKey >= input.position
      ? { ...position, sortKey: position.sortKey + 1 }
      : position);
  const moved = subtree.map((position) => position.documentId === input.documentId
    ? { ...position, parentId: input.newParentId, sortKey: input.position, depth: newDepth }
    : { ...position, depth: position.depth + depthDelta });
  const state = nextState(snapshot, [...shiftedDestination, ...moved], input.maxDepth);
  return {
    state,
    event: event(
      snapshot,
      state,
      input,
      "tree.node.moved",
      input.documentId,
      positionPayload(current, hierarchyPath(snapshot, input.documentId)),
      positionPayload(requirePosition(state, input.documentId), hierarchyPath(state, input.documentId)),
      moved.map(({ documentId }) => documentId),
    ),
  };
}

export function reorderHierarchyChildren(
  snapshot: ContentHierarchySnapshot,
  input: ReorderHierarchyChildrenInput,
): ContentHierarchyCommandResult {
  assertCommand(snapshot, input);
  if (input.parentId !== null) requireParent(snapshot, input.parentId);
  const children = siblingsOf(snapshot.positions, input.parentId);
  const actual = new Set(children.map(({ documentId }) => documentId));
  const requested = new Set(input.orderedDocumentIds);
  if (
    requested.size !== input.orderedDocumentIds.length ||
    requested.size !== actual.size ||
    [...requested].some((documentId) => !actual.has(documentId))
  ) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_REORDER_SET_INVALID",
      "Reorder must contain every direct child exactly once and no other document.",
      {
        parentId: input.parentId,
        expectedDocumentIds: [...actual],
        receivedDocumentIds: [...input.orderedDocumentIds],
      },
    );
  }
  const sortById = new Map(input.orderedDocumentIds.map((documentId, index) => [documentId, index]));
  const positions = snapshot.positions.map((position) => position.parentId === input.parentId
    ? { ...position, sortKey: sortById.get(position.documentId)! }
    : position);
  const state = nextState(snapshot, positions, input.maxDepth);
  return {
    state,
    event: event(
      snapshot,
      state,
      input,
      "tree.node.reordered",
      input.parentId,
      { orderedDocumentIds: children.map(({ documentId }) => documentId) },
      { orderedDocumentIds: [...input.orderedDocumentIds] },
      [...input.orderedDocumentIds],
    ),
  };
}

export function removeHierarchyNode(
  snapshot: ContentHierarchySnapshot,
  input: RemoveHierarchyNodeInput,
): ContentHierarchyCommandResult {
  assertCommand(snapshot, input);
  const current = requirePosition(snapshot, input.documentId);
  const directChildren = siblingsOf(snapshot.positions, input.documentId);
  if (directChildren.length > 0 && input.promoteChildren !== true) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_NODE_HAS_CHILDREN",
      `Hierarchy node '${input.documentId}' has children.`,
      { documentId: input.documentId, childCount: directChildren.length },
    );
  }
  const descendants = hierarchyDescendants(snapshot, input.documentId);
  const childSubtrees = directChildren.map((child) => new Set([
    child.documentId,
    ...hierarchyDescendants(snapshot, child.documentId).map(({ documentId }) => documentId),
  ]));
  let positions = snapshot.positions.filter(({ documentId }) => documentId !== input.documentId);
  positions = normalizeSiblings(positions, current.parentId);
  if (input.promoteChildren === true) {
    const childIds = new Set(directChildren.map(({ documentId }) => documentId));
    positions = positions.map((position) => {
      if (childIds.has(position.documentId)) {
        return { ...position, parentId: current.parentId, depth: current.depth };
      }
      if (childSubtrees.some((ids) => ids.has(position.documentId))) {
        return { ...position, depth: position.depth - 1 };
      }
      return position;
    });
    const promotedIds = new Set(directChildren.map(({ documentId }) => documentId));
    const existingAtParent = positions
      .filter((position) => position.parentId === current.parentId && !promotedIds.has(position.documentId))
      .sort((left, right) => left.sortKey - right.sortKey);
    const before = existingAtParent.filter(({ sortKey }) => sortKey < current.sortKey);
    const after = existingAtParent.filter(({ sortKey }) => sortKey >= current.sortKey);
    const order = [...before, ...directChildren, ...after].map(({ documentId }) => documentId);
    const sortById = new Map(order.map((documentId, index) => [documentId, index]));
    positions = positions.map((position) => position.parentId === current.parentId
      ? { ...position, sortKey: sortById.get(position.documentId)! }
      : position);
  }
  const state = nextState(snapshot, positions, input.maxDepth);
  return {
    state,
    event: event(
      snapshot,
      state,
      input,
      "tree.node.removed",
      input.documentId,
      positionPayload(current, hierarchyPath(snapshot, input.documentId)),
      null,
      [input.documentId, ...descendants.map(({ documentId }) => documentId)],
    ),
  };
}

function assertCommand(snapshot: ContentHierarchySnapshot, input: HierarchyCommandMetadata): void {
  if (input.expectedVersion !== snapshot.version) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_VERSION_CONFLICT",
      `Expected hierarchy version ${input.expectedVersion}, received ${snapshot.version}.`,
      { expectedVersion: input.expectedVersion, actualVersion: snapshot.version },
    );
  }
  if (input.maxDepth !== undefined && (!Number.isSafeInteger(input.maxDepth) || input.maxDepth < 0)) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_MAX_DEPTH_EXCEEDED",
      "maxDepth must be a non-negative safe integer.",
      { maxDepth: input.maxDepth },
    );
  }
}

function requireParent(snapshot: ContentHierarchySnapshot, documentId: DocumentId): ContentHierarchyPosition {
  try {
    return requirePosition(snapshot, documentId);
  } catch (error: unknown) {
    if (error instanceof ContentHierarchyDomainError && error.code === "HIERARCHY_NODE_NOT_FOUND") {
      throw new ContentHierarchyDomainError(
        "HIERARCHY_PARENT_NOT_FOUND",
        `Hierarchy parent '${documentId}' does not exist.`,
        { parentId: documentId },
      );
    }
    throw error;
  }
}

function siblingsOf(
  positions: readonly ContentHierarchyPosition[],
  parentId: DocumentId | null,
): ContentHierarchyPosition[] {
  return positions
    .filter((position) => position.parentId === parentId)
    .sort((left, right) => left.sortKey - right.sortKey);
}

function normalizeSiblings(
  positions: readonly ContentHierarchyPosition[],
  parentId: DocumentId | null,
): ContentHierarchyPosition[] {
  const nextSort = new Map(siblingsOf(positions, parentId).map(({ documentId }, index) => [documentId, index]));
  return positions.map((position) => position.parentId === parentId
    ? { ...position, sortKey: nextSort.get(position.documentId)! }
    : position);
}

function assertInsertPosition(position: number, siblingCount: number): void {
  if (!Number.isSafeInteger(position) || position < 0 || position > siblingCount) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_POSITION_INVALID",
      `Position must be an integer between 0 and ${siblingCount}.`,
      { position, minimum: 0, maximum: siblingCount },
    );
  }
}

function assertDepth(depth: number, maxDepth: number | undefined, documentId: DocumentId): void {
  if (maxDepth !== undefined && depth > maxDepth) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_MAX_DEPTH_EXCEEDED",
      `Moving '${documentId}' would create depth ${depth}, beyond maxDepth ${maxDepth}.`,
      { documentId, resultingDepth: depth, maxDepth },
    );
  }
}

function nextState(
  snapshot: ContentHierarchySnapshot,
  positions: readonly ContentHierarchyPosition[],
  maxDepth: number | undefined,
): ContentHierarchySnapshot {
  const state = createContentHierarchySnapshot({ ...snapshot, version: snapshot.version + 1, positions });
  if (maxDepth !== undefined) {
    const tooDeep = state.positions.find(({ depth }) => depth > maxDepth);
    if (tooDeep !== undefined) assertDepth(tooDeep.depth, maxDepth, tooDeep.documentId);
  }
  return state;
}

function event(
  beforeState: ContentHierarchySnapshot,
  afterState: ContentHierarchySnapshot,
  metadata: HierarchyCommandMetadata,
  type: ContentHierarchyEvent["type"],
  documentId: DocumentId | null,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
  affectedDocumentIds: readonly DocumentId[],
): ContentHierarchyEvent {
  return Object.freeze({
    type,
    workspaceId: beforeState.workspaceId,
    collectionId: beforeState.collectionId,
    documentId,
    structureVersion: afterState.version,
    actorId: metadata.actorId,
    occurredAt: metadata.now,
    before: before === null ? null : Object.freeze({ ...before }),
    after: after === null ? null : Object.freeze({ ...after }),
    affectedDocumentIds: Object.freeze([...affectedDocumentIds]),
  });
}

function positionPayload(
  position: ContentHierarchyPosition,
  path: readonly DocumentId[],
): Readonly<Record<string, unknown>> {
  return {
    parentId: position.parentId,
    sortKey: position.sortKey,
    depth: position.depth,
    path: [...path],
  };
}
