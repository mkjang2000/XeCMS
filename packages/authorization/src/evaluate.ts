import { isBindingActive, scopeAppliesToResource, scopeContainsScope } from "./scope.js";
import type {
  AccessDecision,
  AccessEvaluationContext,
  PermissionGrant,
  PermissionKey,
  PolicySnapshot,
  ResourceId,
  RoleBinding,
  Scope,
  SubjectId,
} from "./types.js";

const EMPTY_MEMBERSHIP_PATH: readonly SubjectId[] = Object.freeze([]);

export interface EvaluateAccessRequest {
  readonly actorSubjectId: SubjectId;
  readonly action: PermissionKey;
  readonly resourceId: ResourceId;
  readonly now: string;
  readonly context?: AccessEvaluationContext;
}

export interface EffectiveRoleBinding {
  readonly binding: RoleBinding;
  /** Empty for a direct binding, otherwise [actor, ...nested groups, binding group]. */
  readonly membershipPath: readonly SubjectId[];
}

export function evaluateAccess(
  policy: PolicySnapshot,
  request: EvaluateAccessRequest,
): AccessDecision {
  const scope: Scope = { resourceId: request.resourceId, propagation: "self" };
  const permission = policy.permissions.get(request.action);
  if (permission === undefined) {
    return deny(request.action, "UNKNOWN_PERMISSION", scope);
  }
  // Management permissions must never be evaluated without their target rank,
  // affected permissions, and complete target scope.
  if (permission.hierarchyGuard !== "none") {
    return deny(request.action, "HIERARCHY_CONTEXT_REQUIRED", scope);
  }
  const actor = policy.subjects.get(request.actorSubjectId);
  if (actor === undefined) {
    return deny(request.action, "UNKNOWN_SUBJECT", scope);
  }
  if (actor.disabled === true) {
    return deny(request.action, "SUBJECT_DISABLED", scope);
  }
  const resource = policy.resources.get(request.resourceId);
  if (resource === undefined) {
    return deny(request.action, "UNKNOWN_RESOURCE", scope);
  }
  if (actor.realmId !== resource.realmId) {
    return deny(request.action, "REALM_MISMATCH", scope);
  }

  const actionBindings = effectiveBindingsWithAction(
    policy,
    request.actorSubjectId,
    request.action,
  );
  const activeBindings = actionBindings.filter(({ binding }) =>
    isBindingActive(binding, request.now),
  );
  const applicable = activeBindings.filter(({ binding }) =>
    scopeAppliesToResource(policy, binding.scope, request.resourceId),
  );
  const constraintComplete = applicable.filter(({ binding }) =>
    bindingConstraintsSatisfied(binding, request.context),
  );
  const grants = constraintComplete.map(({ binding, membershipPath }) =>
    grantFromBinding(policy, binding.id, request.action, membershipPath),
  );

  if (grants.length > 0) {
    return {
      allowed: true,
      action: request.action,
      reasonCode: "ALLOW_PERMISSION",
      matchedGrants: grants,
      evaluatedScope: scope,
      actorLevel: Math.max(...grants.map(({ sourceRank }) => sourceRank)),
    };
  }
  if (actionBindings.length > 0 && activeBindings.length === 0) {
    return deny(request.action, "INACTIVE_BINDING", scope);
  }
  if (activeBindings.length > 0 && applicable.length === 0) {
    return deny(request.action, "SCOPE_MISMATCH", scope);
  }
  if (applicable.length > 0 && constraintComplete.length === 0) {
    return deny(request.action, "CONSTRAINT_NOT_SATISFIED", scope);
  }
  return deny(request.action, "NO_PERMISSION", scope);
}

export function grantsContainingScope(
  policy: PolicySnapshot,
  actorSubjectId: SubjectId,
  action: PermissionKey,
  targetScope: Scope,
  now: string,
  context?: AccessEvaluationContext,
): readonly PermissionGrant[] {
  return effectiveBindingsWithAction(policy, actorSubjectId, action)
    .filter(({ binding }) => isBindingActive(binding, now))
    .filter(({ binding }) => bindingConstraintsSatisfied(binding, context))
    .filter(({ binding }) => scopeContainsScope(policy, binding.scope, targetScope))
    .map(({ binding, membershipPath }) =>
      grantFromBinding(policy, binding.id, action, membershipPath),
    );
}

/**
 * Backwards-compatible binding list. New code that needs provenance should use
 * effectiveBindingsWithAction so it does not discard membership paths.
 */
export function bindingsWithAction(
  policy: PolicySnapshot,
  subjectId: SubjectId,
  action: PermissionKey,
): RoleBinding[] {
  return effectiveBindingsWithAction(policy, subjectId, action).map(({ binding }) => binding);
}

export function effectiveBindingsWithAction(
  policy: PolicySnapshot,
  subjectId: SubjectId,
  action: PermissionKey,
): readonly EffectiveRoleBinding[] {
  return effectiveBindings(policy, subjectId).filter(({ binding }) =>
    policy.roles.get(binding.roleId)?.permissions.includes(action) === true,
  );
}

export function effectiveBindings(
  policy: PolicySnapshot,
  subjectId: SubjectId,
): readonly EffectiveRoleBinding[] {
  const result: EffectiveRoleBinding[] = [];
  const seenBindings = new Set<string>();
  appendBindings(policy, subjectId, EMPTY_MEMBERSHIP_PATH, seenBindings, result);

  for (const membershipPath of policy.membershipPathsBySubject.get(subjectId) ?? []) {
    if (!membershipPathIsActive(policy, membershipPath)) {
      continue;
    }
    const groupSubjectId = membershipPath.at(-1);
    if (groupSubjectId !== undefined) {
      appendBindings(policy, groupSubjectId, membershipPath, seenBindings, result);
    }
  }
  return result;
}

export function grantFromBinding(
  policy: PolicySnapshot,
  bindingId: Parameters<PolicySnapshot["bindings"]["get"]>[0],
  action: PermissionKey,
  membershipPath: readonly SubjectId[] = EMPTY_MEMBERSHIP_PATH,
): PermissionGrant {
  const binding = policy.bindings.get(bindingId);
  if (binding === undefined) {
    throw new TypeError(`Unknown binding '${bindingId}'.`);
  }
  const role = policy.roles.get(binding.roleId);
  const level = role === undefined ? undefined : policy.authorityLevels.get(role.levelId);
  if (role === undefined || level === undefined) {
    throw new TypeError("A validated policy snapshot contains an invalid role binding.");
  }
  return {
    permission: action,
    sourceRoleId: role.id,
    sourceLevelId: level.id,
    sourceRank: level.rank,
    sourceBindingId: binding.id,
    sourceScope: binding.scope,
    membershipPath,
  };
}

export function bindingConstraintsSatisfied(
  binding: RoleBinding,
  context: AccessEvaluationContext | undefined,
): boolean {
  const constraints = binding.constraints;
  if (constraints === undefined) {
    return true;
  }
  if (
    constraints.ownerSubjectId !== undefined &&
    context?.ownerSubjectId !== constraints.ownerSubjectId
  ) {
    return false;
  }
  if (
    constraints.statuses !== undefined &&
    (context?.status === undefined || !constraints.statuses.includes(context.status))
  ) {
    return false;
  }
  return true;
}

function appendBindings(
  policy: PolicySnapshot,
  subjectId: SubjectId,
  membershipPath: readonly SubjectId[],
  seenBindings: Set<string>,
  output: EffectiveRoleBinding[],
): void {
  for (const binding of policy.bindingsBySubject.get(subjectId) ?? []) {
    if (!seenBindings.has(binding.id)) {
      seenBindings.add(binding.id);
      output.push({ binding, membershipPath });
    }
  }
}

function membershipPathIsActive(
  policy: PolicySnapshot,
  membershipPath: readonly SubjectId[],
): boolean {
  // The first entry is the actor, whose disabled state is handled by callers.
  return membershipPath.slice(1).every((subjectId) =>
    policy.subjects.get(subjectId)?.disabled !== true,
  );
}

function deny(
  action: PermissionKey,
  reasonCode: AccessDecision["reasonCode"],
  evaluatedScope: Scope,
): AccessDecision {
  return { allowed: false, action, reasonCode, matchedGrants: [], evaluatedScope };
}
