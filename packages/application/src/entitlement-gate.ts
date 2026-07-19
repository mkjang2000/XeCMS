import type { PolicySnapshot } from "@xecms/authorization";

import { realmCollectionResourcePrefix, realmDocumentResourcePrefix } from "./authorization.js";
import type { CollectionAction, RealmCollectionEntitlement } from "./realm-collection-entitlements.js";

/**
 * The collection-entitlement gate. Pure functions that narrow an already-computed
 * realm-policy decision down to the CMS ceiling. The gate never grants — it only
 * removes access — and fails closed: a content resource whose collection cannot be
 * resolved is denied, not skipped.
 */

/** Maps a canonical content permission to the entitlement's action space. */
const GATE_ACTION: Readonly<Record<string, CollectionAction>> = {
  "content.list": "list",
  "content.read": "read",
  "content.create": "create",
  "content.update": "update",
  "content.delete": "delete",
  "content.publish": "publish",
  "content.unpublish": "unpublish",
  "content.purge": "purge",
  "content.restore": "restore",
  "content.revision.read": "revision.read",
  "content.revision.restore": "revision.restore",
};

/** The entitlement action a permission maps to, or undefined if it is not gated. */
export function gateActionFor(action: string): CollectionAction | undefined {
  return GATE_ACTION[action];
}

export type EntitlementResourceResolution =
  | { readonly kind: "collection"; readonly collectionId: string }
  /** A content resource whose collection could not be resolved — must be denied. */
  | { readonly kind: "unresolved-content" }
  /** Not a content resource (schema/authorization/audit/root) — gate does not apply. */
  | { readonly kind: "skip" };

const MAX_PARENT_DEPTH = 64;

/**
 * Resolves the collection an access resource belongs to.
 * - collection resource → its collectionId.
 * - document resource → walk `parentId` up to the enclosing collection resource
 *   (hierarchy documents nest document→document→collection).
 * - document resource whose chain breaks / exceeds depth / is not found →
 *   `unresolved-content` (fail-closed).
 * - anything else → `skip`.
 */
export function resolveEntitlementCollectionId(
  snapshot: PolicySnapshot,
  realmId: string,
  resourceId: string,
): EntitlementResourceResolution {
  const collectionPrefix = realmCollectionResourcePrefix(realmId);
  if (resourceId.startsWith(collectionPrefix)) {
    return { kind: "collection", collectionId: resourceId.slice(collectionPrefix.length) };
  }
  const documentPrefix = realmDocumentResourcePrefix(realmId);
  if (!resourceId.startsWith(documentPrefix)) {
    return { kind: "skip" };
  }
  // Walk the parent chain of a document resource to its enclosing collection.
  let current = snapshot.resources.get(resourceId as never);
  let depth = 0;
  while (current !== undefined && depth < MAX_PARENT_DEPTH) {
    const parentId = current.parentId as string | undefined;
    if (parentId === undefined) break;
    if (parentId.startsWith(collectionPrefix)) {
      return { kind: "collection", collectionId: parentId.slice(collectionPrefix.length) };
    }
    current = snapshot.resources.get(parentId as never);
    depth += 1;
  }
  // A document resource we could not tie to a collection: fail closed.
  return { kind: "unresolved-content" };
}

export type GateVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny" };

/**
 * Applies the action + condition ceiling. Only narrows: an already-denied
 * decision is not the gate's concern (caller keeps it). Returns `deny` when the
 * ceiling does not permit the action/condition.
 */
export function applyActionGate(input: {
  readonly entitlement: RealmCollectionEntitlement | undefined;
  readonly gateAction: CollectionAction;
  readonly actorSubjectId: string;
  readonly ownerSubjectId?: string;
  readonly status?: string;
}): GateVerdict {
  const ent = input.entitlement;
  // Absent ceiling for this (realm, collection) = no access (fail-closed).
  if (ent === undefined) return { kind: "deny" };
  if (!ent.actions.includes(input.gateAction)) return { kind: "deny" };
  const constraint = ent.constraint;
  if (constraint !== undefined) {
    // ownerOnly: the acting Subject must own the target document (missing owner fails closed).
    if (constraint.ownerOnly === true && input.ownerSubjectId !== input.actorSubjectId) {
      return { kind: "deny" };
    }
    // statuses: the target status must be in the allowed set (missing status fails closed).
    if (constraint.statuses !== undefined) {
      if (input.status === undefined || !constraint.statuses.includes(input.status)) {
        return { kind: "deny" };
      }
    }
  }
  return { kind: "allow" };
}

/** A field passes the read ceiling if readableFields is undefined (all) or includes it. */
export function entitlementAllowsReadField(
  entitlement: RealmCollectionEntitlement,
  field: string,
): boolean {
  return entitlement.readableFields === undefined || entitlement.readableFields.includes(field);
}

/** A field passes the write ceiling if writableFields is undefined (all) or includes it. */
export function entitlementAllowsWriteField(
  entitlement: RealmCollectionEntitlement,
  field: string,
): boolean {
  return entitlement.writableFields === undefined || entitlement.writableFields.includes(field);
}
