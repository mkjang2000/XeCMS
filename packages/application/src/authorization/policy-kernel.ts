import {
  asAuthorityLevelId,
  asGroupMembershipId,
  asPermissionKey,
  asRealmId,
  asResourceId,
  asRoleBindingId,
  asRoleId,
  asSubjectId,
  createPolicySnapshot,
  PolicyValidationError,
  type AccessDecision,
  type AccessEvaluationContext,
  type FieldAccessDecision,
  type PolicySnapshot,
  type Role,
  type RoleBinding,
} from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import type {
  AuthorizationRoleRecord,
  AuthorizationBindingRecord,
  AuthorizationPolicyState,
  AuthorizationEvaluationContext,
  AuthorizationDecisionRecord,
  AuthorizationFieldDecisionRecord,
} from "./types.js";

export function createKernelSnapshot(state: AuthorizationPolicyState): PolicySnapshot {
  try {
    return createPolicySnapshot({
      realms: [{
        id: asRealmId(state.realm.id),
        rootResourceId: asResourceId(state.realm.rootResourceId),
      }],
      subjects: state.subjects.map((subject) => ({
        id: asSubjectId(subject.id),
        realmId: asRealmId(subject.realmId),
        type: subject.type,
        ...(subject.protected === undefined ? {} : { protected: subject.protected }),
        ...(subject.disabled === undefined ? {} : { disabled: subject.disabled }),
      })),
      resources: state.resources.map((resource) => ({
        id: asResourceId(resource.id),
        realmId: asRealmId(resource.realmId),
        ...(resource.parentId === undefined ? {} : { parentId: asResourceId(resource.parentId) }),
        ...(resource.protected === undefined ? {} : { protected: resource.protected }),
      })),
      authorityLevels: state.authorityLevels.map((level) => ({
        id: asAuthorityLevelId(level.id),
        realmId: asRealmId(level.realmId),
        name: level.name,
        rank: level.rank,
        ...(level.protected === undefined ? {} : { protected: level.protected }),
      })),
      permissions: state.permissions.map((permission) => ({
        key: asPermissionKey(permission.key),
        hierarchyGuard: permission.hierarchyGuard,
        delegatable: permission.delegatable,
        ...(permission.protected === undefined ? {} : { protected: permission.protected }),
      })),
      roles: state.roles.map(toKernelRole),
      bindings: state.bindings.map(toKernelBinding),
      groupMemberships: state.groupMemberships.map((membership) => ({
        id: asGroupMembershipId(membership.id),
        realmId: asRealmId(membership.realmId),
        memberSubjectId: asSubjectId(membership.memberSubjectId),
        groupSubjectId: asSubjectId(membership.groupSubjectId),
      })),
    });
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      throw new ApplicationError(
        "AUTHORIZATION_POLICY_INVALID",
        422,
        "The authorization policy graph is invalid.",
        {
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path,
          })),
        },
      );
    }
    throw error;
  }
}

export function toKernelRole(role: AuthorizationRoleRecord): Role {
  return {
    id: asRoleId(role.id),
    realmId: asRealmId(role.realmId),
    levelId: asAuthorityLevelId(role.levelId),
    name: role.name,
    permissions: role.permissions.map(asPermissionKey),
    delegatablePermissions: role.delegatablePermissions.map(asPermissionKey),
    ...(role.fieldAccess === undefined ? {} : {
      fieldAccess: role.fieldAccess.map((rule) => ({
        resourceId: asResourceId(rule.resourceId),
        readableFields: [...rule.readableFields],
        writableFields: [...rule.writableFields],
      })),
    }),
    ...(role.protected === undefined ? {} : { protected: role.protected }),
  };
}

export function toKernelBinding(binding: AuthorizationBindingRecord): RoleBinding {
  return {
    id: asRoleBindingId(binding.id),
    realmId: asRealmId(binding.realmId),
    subjectId: asSubjectId(binding.subjectId),
    roleId: asRoleId(binding.roleId),
    scope: {
      resourceId: asResourceId(binding.resourceId),
      propagation: binding.propagation,
    },
    ...(binding.validFrom === undefined ? {} : { validFrom: binding.validFrom }),
    ...(binding.validUntil === undefined ? {} : { validUntil: binding.validUntil }),
    ...(binding.constraints === undefined ? {} : {
      constraints: {
        ...(binding.constraints.ownerSubjectId === undefined
          ? {}
          : { ownerSubjectId: asSubjectId(binding.constraints.ownerSubjectId) }),
        ...(binding.constraints.statuses === undefined
          ? {}
          : { statuses: [...binding.constraints.statuses] }),
      },
    }),
    ...(binding.protected === undefined ? {} : { protected: binding.protected }),
  };
}

export function toKernelContextProperty(
  context: AuthorizationEvaluationContext | undefined,
): { readonly context?: AccessEvaluationContext } {
  if (context === undefined) return {};
  return {
    context: {
      ...(context.ownerSubjectId === undefined
        ? {}
        : { ownerSubjectId: asSubjectId(context.ownerSubjectId) }),
      ...(context.status === undefined ? {} : { status: context.status }),
    },
  };
}

export function plainDecision(decision: AccessDecision): AuthorizationDecisionRecord {
  return {
    allowed: decision.allowed,
    action: decision.action,
    reasonCode: decision.reasonCode,
    matchedGrants: decision.matchedGrants.map((grant) => ({
      permission: grant.permission,
      sourceRoleId: grant.sourceRoleId,
      sourceLevelId: grant.sourceLevelId,
      sourceRank: grant.sourceRank,
      sourceBindingId: grant.sourceBindingId,
      sourceScope: {
        resourceId: grant.sourceScope.resourceId,
        propagation: grant.sourceScope.propagation,
      },
      membershipPath: [...grant.membershipPath],
    })),
    ...(decision.evaluatedScope === undefined ? {} : {
      evaluatedScope: {
        resourceId: decision.evaluatedScope.resourceId,
        propagation: decision.evaluatedScope.propagation,
      },
    }),
    ...(decision.actorLevel === undefined ? {} : { actorLevel: decision.actorLevel }),
    ...(decision.targetLevel === undefined ? {} : { targetLevel: decision.targetLevel }),
  };
}

export function plainFieldDecision(decision: FieldAccessDecision): AuthorizationFieldDecisionRecord {
  return {
    allowed: decision.allowed,
    access: decision.access,
    field: decision.field,
    resourceId: decision.resourceId,
    reasonCode: decision.reasonCode,
    matchedGrants: decision.matchedGrants.map((grant) => ({
      sourceRoleId: grant.sourceRoleId,
      sourceBindingId: grant.sourceBindingId,
      sourceResourceId: grant.sourceResourceId,
      membershipPath: [...grant.membershipPath],
    })),
  };
}
