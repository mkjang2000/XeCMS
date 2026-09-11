import type { ScopePropagation, SubjectType } from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import type {
  AuthorizationSubjectRecord,
  AuthorizationLevelRecord,
  AuthorizationRoleRecord,
  AuthorizationBindingRecord,
  AuthorizationGroupMembershipRecord,
  AuthorizationPolicyState,
  AuthorizationDecisionRecord,
} from "./types.js";

export function validateRoleRecord(role: AuthorizationRoleRecord, realmId: string): void {
  validateIdentifier(role.id, "role.id");
  validateRealm(role.realmId, realmId, "role");
  validateIdentifier(role.levelId, "role.levelId");
  validateDisplayName(role.name, "role.name");
  if (role.description !== undefined && role.description.length > 1_000) {
    throw new ApplicationError("ROLE_DESCRIPTION_INVALID", 422, "Role description cannot exceed 1000 characters.");
  }
  assertUniqueCanonicalPermissions(role.permissions, "role.permissions");
  assertUniqueCanonicalPermissions(role.delegatablePermissions, "role.delegatablePermissions");
  for (const permission of role.delegatablePermissions) {
    if (!role.permissions.includes(permission)) {
      throw new ApplicationError(
        "INVALID_ROLE_DELEGATION",
        422,
        `Delegatable permission '${permission}' is not assigned to the role.`,
      );
    }
  }
  if (role.fieldAccess !== undefined) {
    const duplicateResource = findDuplicate(role.fieldAccess.map(({ resourceId }) => resourceId));
    if (duplicateResource !== undefined) {
      throw new ApplicationError(
        "DUPLICATE_FIELD_ACCESS_RESOURCE",
        422,
        `Role field access contains duplicate resource '${duplicateResource}'.`,
      );
    }
    role.fieldAccess.forEach((rule) => {
      validateIdentifier(rule.resourceId, "role.fieldAccess.resourceId");
      assertUniqueFields(rule.readableFields, "readableFields");
      assertUniqueFields(rule.writableFields, "writableFields");
    });
  }
}

export function validateBindingRecord(binding: AuthorizationBindingRecord, realmId: string): void {
  validateIdentifier(binding.id, "binding.id");
  validateRealm(binding.realmId, realmId, "binding");
  validateIdentifier(binding.subjectId, "binding.subjectId");
  validateIdentifier(binding.roleId, "binding.roleId");
  validateIdentifier(binding.resourceId, "binding.resourceId");
  if (!new Set<ScopePropagation>(["self", "children", "self-and-children"]).has(binding.propagation)) {
    throw new ApplicationError("BINDING_PROPAGATION_INVALID", 422, "Binding propagation is invalid.");
  }
  validateOptionalInstant(binding.validFrom, "binding.validFrom");
  validateOptionalInstant(binding.validUntil, "binding.validUntil");
  if (binding.validFrom !== undefined && binding.validUntil !== undefined &&
    Date.parse(binding.validFrom) >= Date.parse(binding.validUntil)) {
    throw new ApplicationError("BINDING_PERIOD_INVALID", 422, "Binding validFrom must precede validUntil.");
  }
  if (binding.constraints?.ownerSubjectId !== undefined) {
    validateIdentifier(binding.constraints.ownerSubjectId, "binding.constraints.ownerSubjectId");
  }
  if (binding.constraints?.statuses !== undefined) {
    if (binding.constraints.statuses.length === 0) {
      throw new ApplicationError("BINDING_CONSTRAINT_INVALID", 422, "Binding statuses cannot be empty.");
    }
    const duplicateStatus = findDuplicate(binding.constraints.statuses);
    if (duplicateStatus !== undefined || binding.constraints.statuses.some((status) => status.trim().length === 0)) {
      throw new ApplicationError("BINDING_CONSTRAINT_INVALID", 422, "Binding statuses must be unique and non-empty.");
    }
  }
}

export function policyReferencesResource(state: AuthorizationPolicyState, resourceId: string): boolean {
  return state.bindings.some((binding) => binding.resourceId === resourceId) ||
    state.roles.some((role) => (role.fieldAccess ?? []).some((rule) => rule.resourceId === resourceId));
}

export function assertResourceAcceptsPolicy(state: AuthorizationPolicyState, resourceId: string): void {
  const resource = state.resources.find(({ id }) => id === resourceId);
  if (resource?.type === "retired-document" || resource?.type === "retired-collection") {
    throw new ApplicationError(
      "AUTHORIZATION_RESOURCE_RETIRED",
      409,
      `Retired resource '${resourceId}' cannot receive new policy references.`,
    );
  }
}

export function validateLevelRecord(level: AuthorizationLevelRecord, realmId: string): void {
  validateIdentifier(level.id, "level.id");
  validateRealm(level.realmId, realmId, "authority level");
  validateDisplayName(level.name, "level.name");
  if (!Number.isSafeInteger(level.rank)) {
    throw new ApplicationError("AUTHORITY_LEVEL_RANK_INVALID", 422, "Authority level rank must be a safe integer.");
  }
}

export function validateSubjectRecord(subject: AuthorizationSubjectRecord, realmId: string): void {
  validateIdentifier(subject.id, "subject.id");
  validateRealm(subject.realmId, realmId, "subject");
  if (subject.identityId !== undefined) validateIdentifier(subject.identityId, "subject.identityId");
  validateDisplayName(subject.name, "subject.name");
  if (!new Set<SubjectType>(["user", "group", "service-account"]).has(subject.type)) {
    throw new ApplicationError("SUBJECT_TYPE_INVALID", 422, "Subject type is invalid.");
  }
}

export function validateGroupMembershipRecord(
  membership: AuthorizationGroupMembershipRecord,
  realmId: string,
): void {
  validateIdentifier(membership.id, "membership.id");
  validateRealm(membership.realmId, realmId, "group membership");
  validateIdentifier(membership.memberSubjectId, "membership.memberSubjectId");
  validateIdentifier(membership.groupSubjectId, "membership.groupSubjectId");
}

export function assertValidGroupMembership(
  state: AuthorizationPolicyState,
  membership: AuthorizationGroupMembershipRecord,
  replacedId: string | undefined,
): void {
  const member = requireRecord(state.subjects, membership.memberSubjectId, "member subject");
  const group = requireRecord(state.subjects, membership.groupSubjectId, "group subject");
  if (group.type !== "group") {
    throw new ApplicationError(
      "GROUP_MEMBERSHIP_TARGET_NOT_GROUP",
      422,
      `Subject '${group.id}' is not a group.`,
    );
  }
  if (member.realmId !== membership.realmId || group.realmId !== membership.realmId) {
    throw new ApplicationError("AUTHORIZATION_REALM_MISMATCH", 422, "Group membership crosses realms.");
  }
  if (membership.memberSubjectId === membership.groupSubjectId) {
    throw new ApplicationError("GROUP_MEMBERSHIP_CYCLE", 422, "A group cannot contain itself.");
  }
  if (state.groupMemberships.some((candidate) =>
    candidate.id !== replacedId &&
    candidate.memberSubjectId === membership.memberSubjectId &&
    candidate.groupSubjectId === membership.groupSubjectId)) {
    throw new ApplicationError("DUPLICATE_GROUP_MEMBERSHIP", 409, "The group membership already exists.");
  }
  if (member.type === "group") {
    const memberships = state.groupMemberships
      .filter(({ id }) => id !== replacedId)
      .concat(membership);
    const pending = [membership.groupSubjectId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === membership.memberSubjectId) {
        throw new ApplicationError("GROUP_MEMBERSHIP_CYCLE", 422, "The group membership creates a cycle.");
      }
      if (visited.has(current)) continue;
      visited.add(current);
      memberships
        .filter(({ memberSubjectId }) => memberSubjectId === current)
        .forEach(({ groupSubjectId }) => pending.push(groupSubjectId));
    }
  }
}

function validateRealm(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new ApplicationError(
      "AUTHORIZATION_REALM_MISMATCH",
      422,
      `The ${label} belongs to realm '${actual}', not '${expected}'.`,
    );
  }
}

export function validateIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 255) {
    throw new ApplicationError("AUTHORIZATION_ID_INVALID", 422, `${label} must be a non-empty identifier.`);
  }
}

export function validateDisplayName(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 120) {
    throw new ApplicationError("AUTHORIZATION_NAME_INVALID", 422, `${label} must contain 1-120 characters.`);
  }
}

export function validateOptionalInstant(value: string | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new ApplicationError("AUTHORIZATION_INSTANT_INVALID", 422, `${label} must be an ISO timestamp.`);
  }
}

export function assertCanonicalPermission(permission: string): void {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(permission)) {
    throw new ApplicationError(
      "PERMISSION_KEY_INVALID",
      422,
      `Permission '${permission}' must be a canonical dot-delimited key.`,
    );
  }
}

function assertUniqueCanonicalPermissions(permissions: readonly string[], label: string): void {
  const duplicate = findDuplicate(permissions);
  if (duplicate !== undefined) {
    throw new ApplicationError("DUPLICATE_PERMISSION", 422, `${label} contains duplicate '${duplicate}'.`);
  }
  permissions.forEach(assertCanonicalPermission);
}

function assertUniqueFields(fields: readonly string[], label: string): void {
  const duplicate = findDuplicate(fields);
  if (duplicate !== undefined) {
    throw new ApplicationError("DUPLICATE_FIELD_ACCESS", 422, `${label} contains duplicate '${duplicate}'.`);
  }
  fields.forEach(validateFieldName);
}

export function validateFieldName(field: string): void {
  if (typeof field !== "string" || field.trim().length === 0 || field.length > 255) {
    throw new ApplicationError("FIELD_NAME_INVALID", 422, "Field name must contain 1-255 characters.");
  }
}

export function requireRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  id: string,
  label: string,
): TRecord {
  const record = records.find((candidate) => candidate.id === id);
  if (record === undefined) {
    throw new ApplicationError(
      "AUTHORIZATION_OBJECT_NOT_FOUND",
      404,
      `${label[0]?.toUpperCase() ?? "O"}${label.slice(1)} '${id}' was not found.`,
    );
  }
  return record;
}

export function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

export function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function identityChange(label: string, id: string): never {
  throw new ApplicationError(
    "AUTHORIZATION_IDENTITY_CHANGE_NOT_ALLOWED",
    422,
    `The ${label} identity '${id}' cannot be changed.`,
  );
}

export function protectedTarget(label: string, id: string): never {
  throw new ApplicationError(
    "AUTHORIZATION_PROTECTED_TARGET",
    403,
    `Protected ${label} '${id}' cannot be changed.`,
  );
}

export function protectedInput(label: string): never {
  throw new ApplicationError(
    "AUTHORIZATION_PROTECTED_INPUT_NOT_ALLOWED",
    403,
    `A protected ${label} can only be created during policy initialization.`,
  );
}

export function authorizationDenied(decision: AuthorizationDecisionRecord): never {
  throw new ApplicationError(
    "AUTHORIZATION_DENIED",
    403,
    `Authorization denied: ${decision.reasonCode}.`,
    { details: { decision } },
  );
}
