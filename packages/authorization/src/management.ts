import {
  bindingConstraintsSatisfied,
  effectiveBindings,
  effectiveBindingsWithAction,
  grantFromBinding,
} from "./evaluate.js";
import { isBindingActive, scopeContainsScope, scopesOverlap } from "./scope.js";
import type {
  AccessDecision,
  AccessReasonCode,
  HierarchyGuard,
  PermissionGrant,
  PermissionKey,
  PolicySnapshot,
  RealmId,
  Role,
  RoleBinding,
  RoleBindingId,
  RoleId,
  Scope,
  SubjectId,
} from "./types.js";

export interface AuthorizeRoleAssignmentRequest {
  readonly actorSubjectId: SubjectId;
  readonly targetSubjectId: SubjectId;
  readonly roleId: RoleId;
  readonly scope: Scope;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeRoleCreateRequest {
  readonly actorSubjectId: SubjectId;
  readonly role: Role;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeRoleUpdateRequest {
  readonly actorSubjectId: SubjectId;
  readonly roleId: RoleId;
  readonly nextRole: Role;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeRoleDeleteRequest {
  readonly actorSubjectId: SubjectId;
  readonly roleId: RoleId;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeRoleBindingCreateRequest {
  readonly actorSubjectId: SubjectId;
  readonly binding: RoleBinding;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeRoleBindingUpdateRequest {
  readonly actorSubjectId: SubjectId;
  readonly bindingId: RoleBindingId;
  readonly nextBinding: RoleBinding;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeRoleBindingRemoveRequest {
  readonly actorSubjectId: SubjectId;
  readonly bindingId: RoleBindingId;
  readonly action: PermissionKey;
  readonly now: string;
}

export interface AuthorizeSubjectDisableRequest {
  readonly actorSubjectId: SubjectId;
  readonly targetSubjectId: SubjectId;
  readonly action: PermissionKey;
  readonly now: string;
}

/**
 * Backwards-compatible assignment check for callers that do not yet construct a
 * complete RoleBinding. New mutation code should use authorizeRoleBindingCreate.
 */
export function authorizeRoleAssignment(
  policy: PolicySnapshot,
  request: AuthorizeRoleAssignmentRequest,
): AccessDecision {
  const targetRole = policy.roles.get(request.roleId);
  const target = policy.subjects.get(request.targetSubjectId);
  const resource = policy.resources.get(request.scope.resourceId);
  const evaluatedScope = request.scope;

  if (targetRole === undefined) {
    return deny(request.action, "UNKNOWN_ROLE", evaluatedScope);
  }
  if (target === undefined) {
    return deny(request.action, "UNKNOWN_SUBJECT", evaluatedScope);
  }
  if (resource === undefined) {
    return deny(request.action, "UNKNOWN_RESOURCE", evaluatedScope);
  }
  if (
    targetRole.realmId !== target.realmId ||
    target.realmId !== resource.realmId
  ) {
    return deny(request.action, "REALM_MISMATCH", evaluatedScope);
  }
  const level = policy.authorityLevels.get(targetRole.levelId);
  if (level === undefined) {
    return deny(request.action, "UNKNOWN_AUTHORITY_LEVEL", evaluatedScope);
  }
  if (isProtectedRole(policy, targetRole) || target.protected === true) {
    return deny(request.action, "PROTECTED_TARGET", evaluatedScope, level.rank);
  }
  if (request.actorSubjectId === request.targetSubjectId) {
    return deny(request.action, "SELF_BINDING_MUTATION", evaluatedScope, level.rank);
  }

  const invalidPermission = validateAffectedPermissions(policy, targetRole.permissions);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, evaluatedScope, level.rank);
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: targetRole.realmId,
    expectedGuard: "target-binding",
    targetScopes: [request.scope],
    targetRank: level.rank,
    affectedPermissions: targetRole.permissions,
  });
}

export function authorizeRoleCreate(
  policy: PolicySnapshot,
  request: AuthorizeRoleCreateRequest,
): AccessDecision {
  const scope = realmScope(policy, request.role.realmId);
  if (scope === undefined) {
    return deny(request.action, "REALM_MISMATCH");
  }
  if (policy.roles.has(request.role.id)) {
    return deny(request.action, "ROLE_ALREADY_EXISTS", scope);
  }
  const level = policy.authorityLevels.get(request.role.levelId);
  if (level === undefined) {
    return deny(request.action, "UNKNOWN_AUTHORITY_LEVEL", scope);
  }
  if (level.realmId !== request.role.realmId) {
    return deny(request.action, "REALM_MISMATCH", scope);
  }
  if (request.role.protected === true || level.protected === true) {
    return deny(request.action, "PROTECTED_TARGET", scope, level.rank);
  }
  const invalidPermission = validateRoleDefinition(policy, request.role);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, scope, level.rank);
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: request.role.realmId,
    expectedGuard: "target-role",
    targetScopes: [scope],
    targetRank: level.rank,
    affectedPermissions: request.role.permissions,
  });
}

export function authorizeRoleUpdate(
  policy: PolicySnapshot,
  request: AuthorizeRoleUpdateRequest,
): AccessDecision {
  const current = policy.roles.get(request.roleId);
  if (current === undefined) {
    return deny(request.action, "UNKNOWN_ROLE");
  }
  const scope = realmScope(policy, current.realmId);
  if (request.nextRole.id !== request.roleId) {
    return deny(request.action, "IDENTITY_CHANGE_NOT_ALLOWED", scope);
  }
  if (request.nextRole.realmId !== current.realmId) {
    return deny(request.action, "REALM_MISMATCH", scope);
  }
  const currentLevel = policy.authorityLevels.get(current.levelId);
  const nextLevel = policy.authorityLevels.get(request.nextRole.levelId);
  if (currentLevel === undefined || nextLevel === undefined) {
    return deny(request.action, "UNKNOWN_AUTHORITY_LEVEL", scope);
  }
  if (nextLevel.realmId !== request.nextRole.realmId) {
    return deny(request.action, "REALM_MISMATCH", scope);
  }
  const targetRank = Math.max(currentLevel.rank, nextLevel.rank);
  if (
    isProtectedRole(policy, current) ||
    request.nextRole.protected === true ||
    nextLevel.protected === true
  ) {
    return deny(request.action, "PROTECTED_TARGET", scope, targetRank);
  }
  const invalidPermission = validateRoleDefinition(policy, request.nextRole);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, scope, targetRank);
  }
  if (scope === undefined) {
    return deny(request.action, "REALM_MISMATCH");
  }
  const affectedPermissions = unionPermissions(current.permissions, request.nextRole.permissions);

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: current.realmId,
    expectedGuard: "target-role",
    targetScopes: [scope],
    targetRank,
    affectedPermissions,
  });
}

export function authorizeRoleDelete(
  policy: PolicySnapshot,
  request: AuthorizeRoleDeleteRequest,
): AccessDecision {
  const role = policy.roles.get(request.roleId);
  if (role === undefined) {
    return deny(request.action, "UNKNOWN_ROLE");
  }
  const scope = realmScope(policy, role.realmId);
  const level = policy.authorityLevels.get(role.levelId);
  if (scope === undefined || level === undefined) {
    return deny(request.action, scope === undefined ? "REALM_MISMATCH" : "UNKNOWN_AUTHORITY_LEVEL", scope);
  }
  if (isProtectedRole(policy, role)) {
    return deny(request.action, "PROTECTED_TARGET", scope, level.rank);
  }
  const invalidPermission = validateAffectedPermissions(policy, role.permissions);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, scope, level.rank);
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: role.realmId,
    expectedGuard: "target-role",
    targetScopes: [scope],
    targetRank: level.rank,
    affectedPermissions: role.permissions,
  });
}

export function authorizeRoleBindingCreate(
  policy: PolicySnapshot,
  request: AuthorizeRoleBindingCreateRequest,
): AccessDecision {
  if (policy.bindings.has(request.binding.id)) {
    return deny(request.action, "BINDING_ALREADY_EXISTS", request.binding.scope);
  }
  const target = resolveBindingTarget(policy, request.binding);
  if (target.reasonCode !== undefined) {
    return deny(request.action, target.reasonCode, request.binding.scope, target.rank);
  }
  if (request.actorSubjectId === request.binding.subjectId) {
    return deny(request.action, "SELF_BINDING_MUTATION", request.binding.scope, target.rank);
  }
  if (target.protected === true) {
    return deny(request.action, "PROTECTED_TARGET", request.binding.scope, target.rank);
  }
  const invalidPermission = validateAffectedPermissions(policy, target.role!.permissions);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, request.binding.scope, target.rank);
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: request.binding.realmId,
    expectedGuard: "target-binding",
    targetScopes: [request.binding.scope],
    targetRank: target.rank,
    affectedPermissions: target.role!.permissions,
  });
}

export function authorizeRoleBindingUpdate(
  policy: PolicySnapshot,
  request: AuthorizeRoleBindingUpdateRequest,
): AccessDecision {
  const current = policy.bindings.get(request.bindingId);
  if (current === undefined) {
    return deny(request.action, "UNKNOWN_BINDING", request.nextBinding.scope);
  }
  if (request.nextBinding.id !== request.bindingId) {
    return deny(request.action, "IDENTITY_CHANGE_NOT_ALLOWED", current.scope);
  }
  if (request.nextBinding.realmId !== current.realmId) {
    return deny(request.action, "REALM_MISMATCH", current.scope);
  }
  const currentTarget = resolveBindingTarget(policy, current);
  const nextTarget = resolveBindingTarget(policy, request.nextBinding);
  if (currentTarget.reasonCode !== undefined) {
    return deny(request.action, currentTarget.reasonCode, current.scope, currentTarget.rank);
  }
  if (nextTarget.reasonCode !== undefined) {
    return deny(request.action, nextTarget.reasonCode, request.nextBinding.scope, nextTarget.rank);
  }
  const targetRank = Math.max(currentTarget.rank!, nextTarget.rank!);
  if (
    request.actorSubjectId === current.subjectId ||
    request.actorSubjectId === request.nextBinding.subjectId
  ) {
    return deny(request.action, "SELF_BINDING_MUTATION", current.scope, targetRank);
  }
  if (
    current.protected === true ||
    request.nextBinding.protected === true ||
    currentTarget.protected === true ||
    nextTarget.protected === true
  ) {
    return deny(request.action, "PROTECTED_TARGET", current.scope, targetRank);
  }
  const affectedPermissions = unionPermissions(
    currentTarget.role!.permissions,
    nextTarget.role!.permissions,
  );
  const invalidPermission = validateAffectedPermissions(policy, affectedPermissions);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, current.scope, targetRank);
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: current.realmId,
    expectedGuard: "target-binding",
    targetScopes: [current.scope, request.nextBinding.scope],
    targetRank,
    affectedPermissions,
  });
}

export function authorizeRoleBindingRemove(
  policy: PolicySnapshot,
  request: AuthorizeRoleBindingRemoveRequest,
): AccessDecision {
  const binding = policy.bindings.get(request.bindingId);
  if (binding === undefined) {
    return deny(request.action, "UNKNOWN_BINDING");
  }
  const target = resolveBindingTarget(policy, binding);
  if (target.reasonCode !== undefined) {
    return deny(request.action, target.reasonCode, binding.scope, target.rank);
  }
  if (request.actorSubjectId === binding.subjectId) {
    return deny(request.action, "SELF_BINDING_MUTATION", binding.scope, target.rank);
  }
  if (binding.protected === true || target.protected === true) {
    return deny(request.action, "PROTECTED_TARGET", binding.scope, target.rank);
  }
  const invalidPermission = validateAffectedPermissions(policy, target.role!.permissions);
  if (invalidPermission !== undefined) {
    return deny(request.action, invalidPermission, binding.scope, target.rank);
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: binding.realmId,
    expectedGuard: "target-binding",
    targetScopes: [binding.scope],
    targetRank: target.rank,
    affectedPermissions: target.role!.permissions,
  });
}

export function authorizeSubjectDisable(
  policy: PolicySnapshot,
  request: AuthorizeSubjectDisableRequest,
): AccessDecision {
  const target = policy.subjects.get(request.targetSubjectId);
  if (target === undefined) {
    return deny(request.action, "UNKNOWN_SUBJECT");
  }
  const scope = realmScope(policy, target.realmId);
  if (scope === undefined) {
    return deny(request.action, "REALM_MISMATCH");
  }
  if (request.actorSubjectId === request.targetSubjectId) {
    return deny(request.action, "SELF_SUBJECT_MUTATION", scope);
  }
  if (target.protected === true || subjectHasProtectedAuthority(policy, target.id, scope, request.now)) {
    return deny(
      request.action,
      "PROTECTED_TARGET",
      scope,
      getSubjectAuthorityRank(policy, target.id, scope, request.now),
    );
  }

  return authorizeManagement(policy, {
    actorSubjectId: request.actorSubjectId,
    action: request.action,
    now: request.now,
    realmId: target.realmId,
    expectedGuard: "target-subject",
    targetScopes: [scope],
    targetRank: getSubjectAuthorityRank(policy, target.id, scope, request.now),
    affectedPermissions: [],
  });
}

/** Highest active role rank held by a subject anywhere overlapping targetScope. */
export function getSubjectAuthorityRank(
  policy: PolicySnapshot,
  subjectId: SubjectId,
  targetScope: Scope,
  now: string,
): number | undefined {
  const ranks = effectiveBindings(policy, subjectId)
    .filter(({ binding }) => isBindingActive(binding, now))
    .filter(({ binding }) => scopesOverlap(policy, binding.scope, targetScope))
    .map(({ binding }) => {
      const role = policy.roles.get(binding.roleId);
      const level = role === undefined ? undefined : policy.authorityLevels.get(role.levelId);
      return level?.rank;
    })
    .filter((rank): rank is number => rank !== undefined);

  return ranks.length === 0 ? undefined : Math.max(...ranks);
}

interface ManagementEvaluation {
  readonly actorSubjectId: SubjectId;
  readonly action: PermissionKey;
  readonly now: string;
  readonly realmId: RealmId;
  readonly expectedGuard: HierarchyGuard;
  readonly targetScopes: readonly Scope[];
  readonly targetRank: number | undefined;
  readonly affectedPermissions: readonly PermissionKey[];
}

function authorizeManagement(
  policy: PolicySnapshot,
  request: ManagementEvaluation,
): AccessDecision {
  const primaryScope = request.targetScopes[0];
  const definition = policy.permissions.get(request.action);
  if (definition === undefined) {
    return deny(request.action, "UNKNOWN_PERMISSION", primaryScope, request.targetRank);
  }
  if (definition.hierarchyGuard !== request.expectedGuard) {
    return deny(request.action, "HIERARCHY_GUARD_MISMATCH", primaryScope, request.targetRank);
  }
  const actor = policy.subjects.get(request.actorSubjectId);
  if (actor === undefined) {
    return deny(request.action, "UNKNOWN_SUBJECT", primaryScope, request.targetRank);
  }
  if (actor.disabled === true) {
    return deny(request.action, "SUBJECT_DISABLED", primaryScope, request.targetRank);
  }
  if (actor.realmId !== request.realmId) {
    return deny(request.action, "REALM_MISMATCH", primaryScope, request.targetRank);
  }
  for (const scope of request.targetScopes) {
    const resource = policy.resources.get(scope.resourceId);
    if (resource === undefined) {
      return deny(request.action, "UNKNOWN_RESOURCE", primaryScope, request.targetRank);
    }
    if (resource.realmId !== request.realmId) {
      return deny(request.action, "REALM_MISMATCH", primaryScope, request.targetRank);
    }
  }

  const actionBindings = effectiveBindingsWithAction(
    policy,
    request.actorSubjectId,
    request.action,
  );
  if (actionBindings.length === 0) {
    return deny(request.action, "NO_PERMISSION", primaryScope, request.targetRank);
  }
  const activeBindings = actionBindings.filter(({ binding }) =>
    isBindingActive(binding, request.now),
  );
  if (activeBindings.length === 0) {
    return deny(request.action, "INACTIVE_BINDING", primaryScope, request.targetRank);
  }
  const constraintComplete = activeBindings.filter(({ binding }) =>
    bindingConstraintsSatisfied(binding, undefined),
  );
  if (constraintComplete.length === 0) {
    return deny(
      request.action,
      "CONSTRAINT_NOT_SATISFIED",
      primaryScope,
      request.targetRank,
    );
  }
  const grants = constraintComplete.map(({ binding, membershipPath }) =>
    grantFromBinding(policy, binding.id, request.action, membershipPath),
  );
  const scopeComplete = grants.filter((grant) =>
    request.targetScopes.every((scope) => scopeContainsScope(policy, grant.sourceScope, scope)),
  );
  if (scopeComplete.length === 0) {
    const coveredAcrossGrants = request.targetScopes.every((scope) =>
      grants.some((grant) => scopeContainsScope(policy, grant.sourceScope, scope)),
    );
    return deny(
      request.action,
      coveredAcrossGrants ? "NO_SINGLE_GRANT_SATISFIES_MANAGEMENT" : "SCOPE_MISMATCH",
      primaryScope,
      request.targetRank,
    );
  }

  const rankComplete = request.targetRank === undefined
    ? scopeComplete
    : scopeComplete.filter((grant) => grant.sourceRank > request.targetRank!);
  if (rankComplete.length === 0) {
    return deny(request.action, "TARGET_NOT_LOWER", primaryScope, request.targetRank);
  }

  if (request.affectedPermissions.some((permission) => {
    const affected = policy.permissions.get(permission)!;
    return affected.delegatable !== true || affected.protected === true;
  })) {
    return deny(request.action, "NON_DELEGATABLE_PERMISSION", primaryScope, request.targetRank);
  }

  const delegationComplete = rankComplete.filter((grant) => {
    const sourceRole = policy.roles.get(grant.sourceRoleId)!;
    return request.affectedPermissions.every((permission) =>
      sourceRole.delegatablePermissions.includes(permission),
    );
  });
  if (delegationComplete.length === 0) {
    const delegatedAcrossGrants = request.affectedPermissions.every((permission) =>
      rankComplete.some((grant) =>
        policy.roles.get(grant.sourceRoleId)?.delegatablePermissions.includes(permission) === true,
      ),
    );
    return deny(
      request.action,
      delegatedAcrossGrants
        ? "NO_SINGLE_GRANT_SATISFIES_MANAGEMENT"
        : "DELEGATION_NOT_ALLOWED",
      primaryScope,
      request.targetRank,
    );
  }

  return allow(request.action, primaryScope, delegationComplete, request.targetRank);
}

interface ResolvedBindingTarget {
  readonly role?: Role;
  readonly rank?: number;
  readonly protected?: boolean;
  readonly reasonCode?: AccessReasonCode;
}

function resolveBindingTarget(
  policy: PolicySnapshot,
  binding: RoleBinding,
): ResolvedBindingTarget {
  const subject = policy.subjects.get(binding.subjectId);
  if (subject === undefined) {
    return { reasonCode: "UNKNOWN_SUBJECT" };
  }
  const role = policy.roles.get(binding.roleId);
  if (role === undefined) {
    return { reasonCode: "UNKNOWN_ROLE" };
  }
  const resource = policy.resources.get(binding.scope.resourceId);
  if (resource === undefined) {
    return { reasonCode: "UNKNOWN_RESOURCE" };
  }
  const level = policy.authorityLevels.get(role.levelId);
  if (level === undefined) {
    return { role, reasonCode: "UNKNOWN_AUTHORITY_LEVEL" };
  }
  if (
    subject.realmId !== binding.realmId ||
    role.realmId !== binding.realmId ||
    resource.realmId !== binding.realmId ||
    level.realmId !== binding.realmId
  ) {
    return { role, rank: level.rank, reasonCode: "REALM_MISMATCH" };
  }
  const ownerSubjectId = binding.constraints?.ownerSubjectId;
  if (ownerSubjectId !== undefined) {
    const owner = policy.subjects.get(ownerSubjectId);
    if (owner === undefined) {
      return { role, rank: level.rank, reasonCode: "UNKNOWN_SUBJECT" };
    }
    if (owner.realmId !== binding.realmId) {
      return { role, rank: level.rank, reasonCode: "REALM_MISMATCH" };
    }
  }
  const statuses = binding.constraints?.statuses;
  if (
    statuses !== undefined &&
    (statuses.length === 0 ||
      statuses.some((status) => status.trim().length === 0) ||
      new Set(statuses).size !== statuses.length)
  ) {
    return { role, rank: level.rank, reasonCode: "INVALID_BINDING_CONSTRAINT" };
  }
  return {
    role,
    rank: level.rank,
    protected:
      binding.protected === true ||
      subject.protected === true ||
      role.protected === true ||
      level.protected === true,
  };
}

function validateRoleDefinition(
  policy: PolicySnapshot,
  role: Role,
): AccessReasonCode | undefined {
  const permissionIssue = validateAffectedPermissions(policy, role.permissions);
  if (permissionIssue !== undefined) {
    return permissionIssue;
  }
  for (const permission of role.delegatablePermissions) {
    if (permission.includes("*")) {
      return "WILDCARD_PERMISSION_NOT_ALLOWED";
    }
    const definition = policy.permissions.get(permission);
    if (
      definition === undefined ||
      !role.permissions.includes(permission) ||
      definition.delegatable !== true ||
      definition.protected === true
    ) {
      return definition === undefined ? "UNKNOWN_PERMISSION" : "INVALID_DELEGATION";
    }
  }
  const seenResources = new Set<string>();
  for (const rule of role.fieldAccess ?? []) {
    const resource = policy.resources.get(rule.resourceId);
    if (resource === undefined) {
      return "UNKNOWN_RESOURCE";
    }
    if (resource.realmId !== role.realmId) {
      return "REALM_MISMATCH";
    }
    if (
      seenResources.has(rule.resourceId) ||
      !validFieldNames(rule.readableFields) ||
      !validFieldNames(rule.writableFields)
    ) {
      return "INVALID_FIELD_ACCESS_RULE";
    }
    seenResources.add(rule.resourceId);
  }
  return undefined;
}

function validFieldNames(fields: readonly string[]): boolean {
  return (
    fields.every((field) => field.trim().length > 0) &&
    new Set(fields).size === fields.length
  );
}

function validateAffectedPermissions(
  policy: PolicySnapshot,
  permissions: readonly PermissionKey[],
): AccessReasonCode | undefined {
  for (const permission of permissions) {
    if (permission.includes("*")) {
      return "WILDCARD_PERMISSION_NOT_ALLOWED";
    }
    const definition = policy.permissions.get(permission);
    if (definition === undefined) {
      return "UNKNOWN_PERMISSION";
    }
  }
  return undefined;
}

function subjectHasProtectedAuthority(
  policy: PolicySnapshot,
  subjectId: SubjectId,
  scope: Scope,
  now: string,
): boolean {
  return effectiveBindings(policy, subjectId).some(({ binding }) => {
    if (!isBindingActive(binding, now) || !scopesOverlap(policy, binding.scope, scope)) {
      return false;
    }
    const role = policy.roles.get(binding.roleId);
    return binding.protected === true || (role !== undefined && isProtectedRole(policy, role));
  });
}

function isProtectedRole(policy: PolicySnapshot, role: Role): boolean {
  return role.protected === true || policy.authorityLevels.get(role.levelId)?.protected === true;
}

function realmScope(policy: PolicySnapshot, realmId: RealmId): Scope | undefined {
  const realm = policy.realms.get(realmId);
  return realm === undefined
    ? undefined
    : { resourceId: realm.rootResourceId, propagation: "self-and-children" };
}

function unionPermissions(
  left: readonly PermissionKey[],
  right: readonly PermissionKey[],
): readonly PermissionKey[] {
  return [...new Set([...left, ...right])];
}

function allow(
  action: PermissionKey,
  evaluatedScope: Scope | undefined,
  grants: readonly PermissionGrant[],
  targetLevel?: number,
): AccessDecision {
  return {
    allowed: true,
    action,
    reasonCode: "ALLOW_MANAGEMENT",
    matchedGrants: grants,
    ...(evaluatedScope === undefined ? {} : { evaluatedScope }),
    actorLevel: Math.max(...grants.map(({ sourceRank }) => sourceRank)),
    ...(targetLevel === undefined ? {} : { targetLevel }),
  };
}

function deny(
  action: PermissionKey,
  reasonCode: AccessReasonCode,
  evaluatedScope?: Scope,
  targetLevel?: number,
): AccessDecision {
  return {
    allowed: false,
    action,
    reasonCode,
    matchedGrants: [],
    ...(evaluatedScope === undefined ? {} : { evaluatedScope }),
    ...(targetLevel === undefined ? {} : { targetLevel }),
  };
}
