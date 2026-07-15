declare const authorizationIdBrand: unique symbol;
declare const validatedPolicySnapshotBrand: unique symbol;

type Brand<TValue, TName extends string> = TValue & {
  readonly [authorizationIdBrand]: TName;
};

export type RealmId = Brand<string, "RealmId">;
export type SubjectId = Brand<string, "SubjectId">;
export type ResourceId = Brand<string, "ResourceId">;
export type AuthorityLevelId = Brand<string, "AuthorityLevelId">;
export type RoleId = Brand<string, "RoleId">;
export type RoleBindingId = Brand<string, "RoleBindingId">;
export type GroupMembershipId = Brand<string, "GroupMembershipId">;
export type PermissionKey = Brand<string, "PermissionKey">;

export type SubjectType = "user" | "group" | "service-account";
export type ScopePropagation = "self" | "children" | "self-and-children";
export type HierarchyGuard = "none" | "target-role" | "target-binding" | "target-subject";

export interface Realm {
  readonly id: RealmId;
  readonly rootResourceId: ResourceId;
}

export interface Subject {
  readonly id: SubjectId;
  readonly realmId: RealmId;
  readonly type: SubjectType;
  readonly protected?: boolean;
  readonly disabled?: boolean;
}

export interface Resource {
  readonly id: ResourceId;
  readonly realmId: RealmId;
  readonly parentId?: ResourceId;
  readonly protected?: boolean;
}

export interface Scope {
  readonly resourceId: ResourceId;
  readonly propagation: ScopePropagation;
}

export interface AuthorityLevel {
  readonly id: AuthorityLevelId;
  readonly realmId: RealmId;
  readonly name: string;
  readonly rank: number;
  readonly protected?: boolean;
}

export interface FieldAccessRule {
  /** The rule applies to this resource and all of its descendants. */
  readonly resourceId: ResourceId;
  readonly readableFields: readonly string[];
  readonly writableFields: readonly string[];
}

export interface Role {
  readonly id: RoleId;
  readonly realmId: RealmId;
  readonly levelId: AuthorityLevelId;
  readonly name: string;
  readonly permissions: readonly PermissionKey[];
  readonly delegatablePermissions: readonly PermissionKey[];
  readonly fieldAccess?: readonly FieldAccessRule[];
  readonly protected?: boolean;
}

export interface RoleBindingConstraints {
  /** The evaluated resource must have this owner. Missing owner context fails closed. */
  readonly ownerSubjectId?: SubjectId;
  /** The evaluated resource status must be one of these values. Missing status context fails closed. */
  readonly statuses?: readonly string[];
}

export interface RoleBinding {
  readonly id: RoleBindingId;
  readonly realmId: RealmId;
  readonly subjectId: SubjectId;
  readonly roleId: RoleId;
  readonly scope: Scope;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: RoleBindingConstraints;
  readonly protected?: boolean;
}

export interface GroupMembership {
  readonly id: GroupMembershipId;
  readonly realmId: RealmId;
  readonly memberSubjectId: SubjectId;
  readonly groupSubjectId: SubjectId;
}

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly hierarchyGuard: HierarchyGuard;
  readonly delegatable: boolean;
  readonly protected?: boolean;
}

export interface PolicyInput {
  readonly realms: readonly Realm[];
  readonly subjects: readonly Subject[];
  readonly resources: readonly Resource[];
  readonly authorityLevels: readonly AuthorityLevel[];
  readonly roles: readonly Role[];
  readonly permissions: readonly PermissionDefinition[];
  readonly bindings: readonly RoleBinding[];
  /** Optional for backwards compatibility with M0 policies. */
  readonly groupMemberships?: readonly GroupMembership[];
}

export interface PolicySnapshot {
  /** Nominal marker: snapshots are created only through createPolicySnapshot. */
  readonly [validatedPolicySnapshotBrand]: true;
  readonly realms: ReadonlyMap<RealmId, Realm>;
  readonly subjects: ReadonlyMap<SubjectId, Subject>;
  readonly resources: ReadonlyMap<ResourceId, Resource>;
  readonly authorityLevels: ReadonlyMap<AuthorityLevelId, AuthorityLevel>;
  readonly roles: ReadonlyMap<RoleId, Role>;
  readonly permissions: ReadonlyMap<PermissionKey, PermissionDefinition>;
  readonly bindings: ReadonlyMap<RoleBindingId, RoleBinding>;
  readonly bindingsBySubject: ReadonlyMap<SubjectId, readonly RoleBinding[]>;
  readonly groupMemberships: ReadonlyMap<GroupMembershipId, GroupMembership>;
  readonly groupMembershipsByMember: ReadonlyMap<SubjectId, readonly GroupMembership[]>;
  /** Immutable direct and nested membership paths. Direct bindings use an empty path. */
  readonly membershipPathsBySubject: ReadonlyMap<SubjectId, readonly (readonly SubjectId[])[]>;
}

export interface PermissionGrant {
  readonly permission: PermissionKey;
  readonly sourceRoleId: RoleId;
  readonly sourceLevelId: AuthorityLevelId;
  readonly sourceRank: number;
  readonly sourceBindingId: RoleBindingId;
  readonly sourceScope: Scope;
  readonly membershipPath: readonly SubjectId[];
}

export type AccessReasonCode =
  | "ALLOW_PERMISSION"
  | "ALLOW_MANAGEMENT"
  | "UNKNOWN_PERMISSION"
  | "UNKNOWN_SUBJECT"
  | "UNKNOWN_RESOURCE"
  | "UNKNOWN_ROLE"
  | "UNKNOWN_BINDING"
  | "UNKNOWN_AUTHORITY_LEVEL"
  | "REALM_MISMATCH"
  | "SUBJECT_DISABLED"
  | "NO_PERMISSION"
  | "SCOPE_MISMATCH"
  | "CONSTRAINT_NOT_SATISFIED"
  | "HIERARCHY_CONTEXT_REQUIRED"
  | "TARGET_NOT_LOWER"
  | "DELEGATION_NOT_ALLOWED"
  | "NON_DELEGATABLE_PERMISSION"
  | "PROTECTED_TARGET"
  | "SELF_BINDING_MUTATION"
  | "SELF_SUBJECT_MUTATION"
  | "INACTIVE_BINDING"
  | "NO_SINGLE_GRANT_SATISFIES_MANAGEMENT"
  | "HIERARCHY_GUARD_MISMATCH"
  | "ROLE_ALREADY_EXISTS"
  | "BINDING_ALREADY_EXISTS"
  | "IDENTITY_CHANGE_NOT_ALLOWED"
  | "INVALID_DELEGATION"
  | "INVALID_BINDING_CONSTRAINT"
  | "INVALID_FIELD_ACCESS_RULE"
  | "WILDCARD_PERMISSION_NOT_ALLOWED";

export interface AccessDecision {
  readonly allowed: boolean;
  readonly action: PermissionKey;
  readonly reasonCode: AccessReasonCode;
  readonly matchedGrants: readonly PermissionGrant[];
  readonly evaluatedScope?: Scope;
  readonly actorLevel?: number;
  readonly targetLevel?: number;
}

export interface AccessEvaluationContext {
  readonly ownerSubjectId?: SubjectId;
  readonly status?: string;
}

export type FieldAccessMode = "read" | "write";

export interface FieldAccessGrant {
  readonly sourceRoleId: RoleId;
  readonly sourceBindingId: RoleBindingId;
  readonly sourceResourceId: ResourceId;
  readonly membershipPath: readonly SubjectId[];
}

export type FieldAccessReasonCode =
  | "ALLOW_FIELD_UNRESTRICTED"
  | "ALLOW_FIELD_RULE"
  | "FIELD_ACCESS_DENIED"
  | "UNKNOWN_PERMISSION"
  | "NO_PERMISSION"
  | "INACTIVE_BINDING"
  | "SCOPE_MISMATCH"
  | "CONSTRAINT_NOT_SATISFIED"
  | "HIERARCHY_CONTEXT_REQUIRED"
  | "UNKNOWN_SUBJECT"
  | "UNKNOWN_RESOURCE"
  | "REALM_MISMATCH"
  | "SUBJECT_DISABLED";

export interface FieldAccessDecision {
  readonly allowed: boolean;
  readonly access: FieldAccessMode;
  readonly field: string;
  readonly resourceId: ResourceId;
  readonly reasonCode: FieldAccessReasonCode;
  readonly matchedGrants: readonly FieldAccessGrant[];
}

function asBrand<T>(value: string, label: string): T {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} cannot be empty.`);
  }
  return value as T;
}

export const asRealmId = (value: string): RealmId => asBrand<RealmId>(value, "RealmId");
export const asSubjectId = (value: string): SubjectId => asBrand<SubjectId>(value, "SubjectId");
export const asResourceId = (value: string): ResourceId => asBrand<ResourceId>(value, "ResourceId");
export const asAuthorityLevelId = (value: string): AuthorityLevelId =>
  asBrand<AuthorityLevelId>(value, "AuthorityLevelId");
export const asRoleId = (value: string): RoleId => asBrand<RoleId>(value, "RoleId");
export const asRoleBindingId = (value: string): RoleBindingId =>
  asBrand<RoleBindingId>(value, "RoleBindingId");
export const asGroupMembershipId = (value: string): GroupMembershipId =>
  asBrand<GroupMembershipId>(value, "GroupMembershipId");
export const asPermissionKey = (value: string): PermissionKey =>
  asBrand<PermissionKey>(value, "PermissionKey");
