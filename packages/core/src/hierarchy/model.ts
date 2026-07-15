import { ContentHierarchyDomainError } from "./errors.js";
import type {
  ContentHierarchyClosureEntry,
  ContentHierarchyPosition,
  ContentHierarchySnapshot,
} from "./types.js";
import type { DocumentId } from "../document/types.js";

export function createContentHierarchySnapshot(
  input: ContentHierarchySnapshot,
): ContentHierarchySnapshot {
  const snapshot: ContentHierarchySnapshot = {
    workspaceId: input.workspaceId,
    collectionId: input.collectionId,
    version: input.version,
    positions: input.positions.map(freezePosition),
  };
  assertContentHierarchyInvariants(snapshot);
  return Object.freeze({ ...snapshot, positions: Object.freeze(snapshot.positions) });
}

export function assertContentHierarchyInvariants(
  snapshot: ContentHierarchySnapshot,
  maxDepth?: number,
): void {
  assertNonEmpty(snapshot.workspaceId, "workspaceId");
  assertNonEmpty(snapshot.collectionId, "collectionId");
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) {
    invariant("Hierarchy version must be a non-negative safe integer.");
  }
  if (maxDepth !== undefined && (!Number.isSafeInteger(maxDepth) || maxDepth < 0)) {
    invariant("maxDepth must be a non-negative safe integer.");
  }

  const byId = new Map<DocumentId, ContentHierarchyPosition>();
  for (const position of snapshot.positions) {
    assertNonEmpty(position.documentId, "documentId");
    if (byId.has(position.documentId)) {
      invariant(`Duplicate hierarchy node '${position.documentId}'.`);
    }
    if (!Number.isSafeInteger(position.sortKey) || position.sortKey < 0) {
      invariant(`Node '${position.documentId}' has an invalid sortKey.`);
    }
    if (!Number.isSafeInteger(position.depth) || position.depth < 0) {
      invariant(`Node '${position.documentId}' has an invalid depth.`);
    }
    if (position.parentId === position.documentId) {
      invariant(`Node '${position.documentId}' cannot parent itself.`);
    }
    byId.set(position.documentId, position);
  }

  const siblings = new Map<DocumentId | null, ContentHierarchyPosition[]>();
  for (const position of snapshot.positions) {
    const key = position.parentId;
    const group = siblings.get(key) ?? [];
    group.push(position);
    siblings.set(key, group);

    if (position.parentId === null) {
      if (position.depth !== 0) {
        invariant(`Root node '${position.documentId}' must have depth 0.`);
      }
    } else {
      const parent = byId.get(position.parentId);
      if (parent === undefined) {
        invariant(`Parent '${position.parentId}' of '${position.documentId}' does not exist.`);
      }
      if (position.depth !== parent.depth + 1) {
        invariant(`Node '${position.documentId}' has a depth inconsistent with its parent.`);
      }
    }
    if (maxDepth !== undefined && position.depth > maxDepth) {
      invariant(`Node '${position.documentId}' exceeds maxDepth ${maxDepth}.`);
    }
  }

  for (const group of siblings.values()) {
    group.sort(comparePosition);
    group.forEach((position, index) => {
      if (position.sortKey !== index) {
        invariant(`Sibling sort keys must be contiguous from zero; expected ${index} for '${position.documentId}'.`);
      }
    });
  }

  for (const position of snapshot.positions) {
    const visited = new Set<DocumentId>([position.documentId]);
    let current = position;
    while (current.parentId !== null) {
      if (visited.has(current.parentId)) {
        invariant(`Node '${position.documentId}' participates in a parent cycle.`);
      }
      visited.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (parent === undefined) break;
      current = parent;
    }
  }
}

export function buildContentHierarchyClosure(
  snapshot: ContentHierarchySnapshot,
): readonly ContentHierarchyClosureEntry[] {
  assertContentHierarchyInvariants(snapshot);
  const byId = hierarchyPositionMap(snapshot);
  const entries: ContentHierarchyClosureEntry[] = [];
  for (const position of snapshot.positions) {
    entries.push(Object.freeze({
      ancestorId: position.documentId,
      descendantId: position.documentId,
      distance: 0,
    }));
    let distance = 1;
    let parentId = position.parentId;
    while (parentId !== null) {
      entries.push(Object.freeze({
        ancestorId: parentId,
        descendantId: position.documentId,
        distance,
      }));
      parentId = byId.get(parentId)?.parentId ?? null;
      distance += 1;
    }
  }
  return Object.freeze(entries.sort((left, right) =>
    String(left.ancestorId).localeCompare(String(right.ancestorId), "en-US") ||
    String(left.descendantId).localeCompare(String(right.descendantId), "en-US")));
}

export function hierarchyPositionMap(
  snapshot: ContentHierarchySnapshot,
): ReadonlyMap<DocumentId, ContentHierarchyPosition> {
  return new Map(snapshot.positions.map((position) => [position.documentId, position]));
}

export function hierarchyRoots(
  snapshot: ContentHierarchySnapshot,
): readonly ContentHierarchyPosition[] {
  return childrenOf(snapshot, null);
}

export function hierarchyChildren(
  snapshot: ContentHierarchySnapshot,
  parentId: DocumentId,
): readonly ContentHierarchyPosition[] {
  requirePosition(snapshot, parentId);
  return childrenOf(snapshot, parentId);
}

export function hierarchyAncestors(
  snapshot: ContentHierarchySnapshot,
  documentId: DocumentId,
): readonly ContentHierarchyPosition[] {
  const byId = hierarchyPositionMap(snapshot);
  let current = requirePosition(snapshot, documentId);
  const result: ContentHierarchyPosition[] = [];
  while (current.parentId !== null) {
    current = byId.get(current.parentId)!;
    result.push(current);
  }
  return Object.freeze(result.reverse());
}

/** Root-to-node identity path, suitable for breadcrumbs and scope impact previews. */
export function hierarchyPath(
  snapshot: ContentHierarchySnapshot,
  documentId: DocumentId,
): readonly DocumentId[] {
  return Object.freeze([
    ...hierarchyAncestors(snapshot, documentId).map((position) => position.documentId),
    documentId,
  ]);
}

export function hierarchyDescendants(
  snapshot: ContentHierarchySnapshot,
  documentId: DocumentId,
): readonly ContentHierarchyPosition[] {
  requirePosition(snapshot, documentId);
  const result: ContentHierarchyPosition[] = [];
  const visit = (parentId: DocumentId): void => {
    for (const child of childrenOf(snapshot, parentId)) {
      result.push(child);
      visit(child.documentId);
    }
  };
  visit(documentId);
  return Object.freeze(result);
}

export function hierarchySubtree(
  snapshot: ContentHierarchySnapshot,
  documentId: DocumentId,
): readonly ContentHierarchyPosition[] {
  return Object.freeze([requirePosition(snapshot, documentId), ...hierarchyDescendants(snapshot, documentId)]);
}

export function requirePosition(
  snapshot: ContentHierarchySnapshot,
  documentId: DocumentId,
): ContentHierarchyPosition {
  const found = snapshot.positions.find((position) => position.documentId === documentId);
  if (found === undefined) {
    throw new ContentHierarchyDomainError(
      "HIERARCHY_NODE_NOT_FOUND",
      `Hierarchy node '${documentId}' does not exist.`,
      { documentId },
    );
  }
  return found;
}

export function comparePosition(
  left: ContentHierarchyPosition,
  right: ContentHierarchyPosition,
): number {
  return left.sortKey - right.sortKey ||
    String(left.documentId).localeCompare(String(right.documentId), "en-US");
}

export function freezePosition(position: ContentHierarchyPosition): ContentHierarchyPosition {
  return Object.freeze({ ...position });
}

function childrenOf(
  snapshot: ContentHierarchySnapshot,
  parentId: DocumentId | null,
): readonly ContentHierarchyPosition[] {
  return Object.freeze(snapshot.positions.filter((position) => position.parentId === parentId).sort(comparePosition));
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) invariant(`${label} cannot be empty.`);
}

function invariant(message: string): never {
  throw new ContentHierarchyDomainError("HIERARCHY_INVARIANT_VIOLATION", message);
}
