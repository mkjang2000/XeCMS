import type { PolicySnapshot, ResourceId, RoleBinding, Scope } from "./types.js";

export function isBindingActive(binding: RoleBinding, now: string): boolean {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`Invalid evaluation timestamp '${now}'.`);
  }
  const validFrom = binding.validFrom === undefined ? null : Date.parse(binding.validFrom);
  const validUntil = binding.validUntil === undefined ? null : Date.parse(binding.validUntil);
  return (validFrom === null || timestamp >= validFrom) && (validUntil === null || timestamp < validUntil);
}

export function scopeAppliesToResource(
  policy: PolicySnapshot,
  scope: Scope,
  resourceId: ResourceId,
): boolean {
  if (scope.resourceId === resourceId) {
    return scope.propagation !== "children";
  }
  const descendant = isStrictDescendant(policy, resourceId, scope.resourceId);
  return descendant && scope.propagation !== "self";
}

export function scopeContainsScope(
  policy: PolicySnapshot,
  container: Scope,
  candidate: Scope,
): boolean {
  if (container.resourceId === candidate.resourceId) {
    switch (container.propagation) {
      case "self":
        return candidate.propagation === "self";
      case "children":
        return candidate.propagation === "children";
      case "self-and-children":
        return true;
    }
  }

  if (!isStrictDescendant(policy, candidate.resourceId, container.resourceId)) {
    return false;
  }
  return container.propagation === "children" || container.propagation === "self-and-children";
}

/** Returns true when the two scope sets share at least one resource. */
export function scopesOverlap(
  policy: PolicySnapshot,
  left: Scope,
  right: Scope,
): boolean {
  return scopeContainsScope(policy, left, right) || scopeContainsScope(policy, right, left);
}

export function isStrictDescendant(
  policy: PolicySnapshot,
  candidateId: ResourceId,
  ancestorId: ResourceId,
): boolean {
  let current = policy.resources.get(candidateId);
  while (current?.parentId !== undefined) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = policy.resources.get(current.parentId);
  }
  return false;
}
