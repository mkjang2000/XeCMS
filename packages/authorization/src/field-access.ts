import {
  bindingConstraintsSatisfied,
  effectiveBindings,
} from "./evaluate.js";
import { isBindingActive, scopeAppliesToResource } from "./scope.js";
import type {
  AccessEvaluationContext,
  FieldAccessDecision,
  FieldAccessGrant,
  FieldAccessMode,
  PermissionKey,
  PolicySnapshot,
  ResourceId,
  SubjectId,
} from "./types.js";

export interface EvaluateFieldAccessRequest {
  readonly actorSubjectId: SubjectId;
  readonly resourceId: ResourceId;
  readonly field: string;
  readonly access: FieldAccessMode;
  /** Limits field rules to bindings that grant this enclosing operation. */
  readonly permission?: PermissionKey;
  readonly now: string;
  readonly context?: AccessEvaluationContext;
}

/**
 * Evaluates the field restriction layer only. Callers must still authorize the
 * enclosing document operation. When permission is supplied, only grants for
 * that operation participate; omitting it preserves the M3 prototype's
 * backwards-compatible field-layer behavior.
 */
export function evaluateFieldAccess(
  policy: PolicySnapshot,
  request: EvaluateFieldAccessRequest,
): FieldAccessDecision {
  if (request.field.trim().length === 0) {
    throw new TypeError("Field name cannot be empty.");
  }
  const actor = policy.subjects.get(request.actorSubjectId);
  if (actor === undefined) {
    return decision(request, false, "UNKNOWN_SUBJECT", []);
  }
  if (actor.disabled === true) {
    return decision(request, false, "SUBJECT_DISABLED", []);
  }
  const resource = policy.resources.get(request.resourceId);
  if (resource === undefined) {
    return decision(request, false, "UNKNOWN_RESOURCE", []);
  }
  if (actor.realmId !== resource.realmId) {
    return decision(request, false, "REALM_MISMATCH", []);
  }

  if (request.permission !== undefined) {
    const permission = policy.permissions.get(request.permission);
    if (permission === undefined) {
      return decision(request, false, "UNKNOWN_PERMISSION", []);
    }
    if (permission.hierarchyGuard !== "none") {
      return decision(request, false, "HIERARCHY_CONTEXT_REQUIRED", []);
    }
  }

  const permissionBindings = effectiveBindings(policy, request.actorSubjectId)
    .filter(({ binding }) => {
      const role = policy.roles.get(binding.roleId);
      return request.permission === undefined || role?.permissions.includes(request.permission) === true;
    });

  if (request.permission !== undefined && permissionBindings.length === 0) {
    return decision(request, false, "NO_PERMISSION", []);
  }

  const activeBindings = permissionBindings.filter(({ binding }) =>
    isBindingActive(binding, request.now),
  );
  if (request.permission !== undefined && activeBindings.length === 0) {
    return decision(request, false, "INACTIVE_BINDING", []);
  }

  const scopedBindings = activeBindings.filter(({ binding }) =>
    scopeAppliesToResource(policy, binding.scope, request.resourceId),
  );
  if (request.permission !== undefined && scopedBindings.length === 0) {
    return decision(request, false, "SCOPE_MISMATCH", []);
  }

  const relevantBindings = scopedBindings.filter(({ binding }) =>
    bindingConstraintsSatisfied(binding, request.context),
  );
  if (request.permission !== undefined && relevantBindings.length === 0) {
    return decision(request, false, "CONSTRAINT_NOT_SATISFIED", []);
  }

  const evaluatedRoles = relevantBindings.map(({ binding, membershipPath }) => {
    const role = policy.roles.get(binding.roleId)!;
    const rules = (role.fieldAccess ?? []).filter((rule) =>
      scopeAppliesToResource(
        policy,
        { resourceId: rule.resourceId, propagation: "self-and-children" },
        request.resourceId,
      ),
    );
    return { binding, membershipPath, role, rules };
  });

  // RBAC is additive. A relevant grant without a field restriction remains
  // unrestricted; receiving an additional restricted role cannot reduce it.
  const unrestricted = evaluatedRoles.filter(({ rules }) => rules.length === 0);
  if (unrestricted.length > 0) {
    return decision(
      request,
      true,
      "ALLOW_FIELD_UNRESTRICTED",
      unrestricted.map(({ binding, membershipPath, role }) => ({
        sourceRoleId: role.id,
        sourceBindingId: binding.id,
        sourceResourceId: binding.scope.resourceId,
        membershipPath,
      })),
    );
  }

  const restrictions = evaluatedRoles.flatMap(({ binding, membershipPath, role, rules }) =>
    rules.map((rule) => ({ binding, membershipPath, role, rule })),
  );

  if (restrictions.length === 0) {
    return decision(request, true, "ALLOW_FIELD_UNRESTRICTED", []);
  }

  const allowed = restrictions.filter(({ rule }) =>
    (request.access === "read" ? rule.readableFields : rule.writableFields).includes(
      request.field,
    ),
  );
  if (allowed.length > 0) {
    return decision(
      request,
      true,
      "ALLOW_FIELD_RULE",
      allowed.map(({ binding, membershipPath, role, rule }) => ({
        sourceRoleId: role.id,
        sourceBindingId: binding.id,
        sourceResourceId: rule.resourceId,
        membershipPath,
      })),
    );
  }

  return decision(
    request,
    false,
    "FIELD_ACCESS_DENIED",
    restrictions.map(({ binding, membershipPath, role, rule }) => ({
      sourceRoleId: role.id,
      sourceBindingId: binding.id,
      sourceResourceId: rule.resourceId,
      membershipPath,
    })),
  );
}

function decision(
  request: EvaluateFieldAccessRequest,
  allowed: boolean,
  reasonCode: FieldAccessDecision["reasonCode"],
  matchedGrants: readonly FieldAccessGrant[],
): FieldAccessDecision {
  return {
    allowed,
    access: request.access,
    field: request.field,
    resourceId: request.resourceId,
    reasonCode,
    matchedGrants,
  };
}
