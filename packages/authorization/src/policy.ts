import { PolicyValidationError, type PolicyIssue } from "./errors.js";
import type {
  AuthorityLevel,
  GroupMembership,
  GroupMembershipId,
  PermissionDefinition,
  PermissionKey,
  PolicyInput,
  PolicySnapshot,
  RealmId,
  Realm,
  Resource,
  ResourceId,
  Role,
  RoleBinding,
  Subject,
  SubjectId,
} from "./types.js";

export function createPolicySnapshot(input: PolicyInput): PolicySnapshot {
  const normalized = cloneAndFreezeInput(input);
  const normalizedGroupMemberships = normalized.groupMemberships ?? [];
  const issues: PolicyIssue[] = [];
  const realms = uniqueMap(normalized.realms, "realms", issues, ({ id }) => id);
  const subjects = uniqueMap(normalized.subjects, "subjects", issues, ({ id }) => id);
  const resources = uniqueMap(normalized.resources, "resources", issues, ({ id }) => id);
  const authorityLevels = uniqueMap(normalized.authorityLevels, "authorityLevels", issues, ({ id }) => id);
  const roles = uniqueMap(normalized.roles, "roles", issues, ({ id }) => id);
  const permissions = uniqueMap(normalized.permissions, "permissions", issues, ({ key }) => key);
  const bindings = uniqueMap(normalized.bindings, "bindings", issues, ({ id }) => id);
  const groupMemberships = uniqueMap(
    normalizedGroupMemberships,
    "groupMemberships",
    issues,
    ({ id }) => id,
  );

  normalized.realms.forEach((realm, index) => {
    const root = resources.get(realm.rootResourceId);
    if (root === undefined || root.realmId !== realm.id || root.parentId !== undefined) {
      issues.push({
        code: "REALM_ROOT_NOT_FOUND",
        message: `Realm '${realm.id}' must reference a root resource in the same realm.`,
        path: ["realms", index, "rootResourceId"],
        objectId: realm.id,
      });
    }
  });

  validateResources(normalized.resources, resources, realms, issues);
  validateLevels(normalized.authorityLevels, realms, issues);
  validateSubjects(normalized.subjects, realms, issues);
  validateRoles(normalized.roles, authorityLevels, permissions, resources, realms, issues);
  validateBindings(normalized.bindings, subjects, roles, resources, realms, issues);
  validateGroupMemberships(normalizedGroupMemberships, subjects, realms, issues);

  if (issues.length > 0) {
    throw new PolicyValidationError(issues);
  }

  const bindingsBySubject = new Map<SubjectId, RoleBinding[]>();
  normalized.bindings.forEach((binding) => {
    const current = bindingsBySubject.get(binding.subjectId) ?? [];
    current.push(binding);
    bindingsBySubject.set(binding.subjectId, current);
  });

  const readonlyBindingsBySubject = new Map<SubjectId, readonly RoleBinding[]>();
  bindingsBySubject.forEach((subjectBindings, subjectId) => {
    readonlyBindingsBySubject.set(subjectId, Object.freeze([...subjectBindings]));
  });

  const groupMembershipsByMember = indexGroupMemberships(normalizedGroupMemberships);
  const membershipPathsBySubject = buildMembershipPaths(normalized.subjects, groupMembershipsByMember);

  return Object.freeze({
    realms: immutableMap(realms),
    subjects: immutableMap(subjects),
    resources: immutableMap(resources),
    authorityLevels: immutableMap(authorityLevels),
    roles: immutableMap(roles),
    permissions: immutableMap(permissions),
    bindings: immutableMap(bindings),
    bindingsBySubject: immutableMap(readonlyBindingsBySubject),
    groupMemberships: immutableMap(groupMemberships),
    groupMembershipsByMember: immutableMap(groupMembershipsByMember),
    membershipPathsBySubject: immutableMap(membershipPathsBySubject),
  }) as PolicySnapshot;
}

function validateResources(
  input: readonly Resource[],
  resources: ReadonlyMap<ResourceId, Resource>,
  realms: ReadonlyMap<RealmId, Realm>,
  issues: PolicyIssue[],
): void {
  input.forEach((resource, index) => {
    if (!realms.has(resource.realmId)) {
      referenceIssue(issues, ["resources", index, "realmId"], resource.id, "realm", resource.realmId);
    }
    if (resource.parentId !== undefined) {
      const parent = resources.get(resource.parentId);
      if (parent === undefined) {
        referenceIssue(issues, ["resources", index, "parentId"], resource.id, "resource", resource.parentId);
      } else if (parent.realmId !== resource.realmId) {
        realmIssue(issues, ["resources", index, "parentId"], resource.id);
      }
    }

    const visited = new Set<ResourceId>();
    let invalidChain = false;
    let current: Resource | undefined = resource;
    while (current !== undefined) {
      if (visited.has(current.id)) {
        issues.push({
          code: "RESOURCE_CYCLE",
          message: `Resource '${resource.id}' participates in a parent cycle.`,
          path: ["resources", index, "parentId"],
          objectId: resource.id,
        });
        invalidChain = true;
        break;
      }
      visited.add(current.id);
      if (current.parentId === undefined) {
        break;
      }
      const parent = resources.get(current.parentId);
      if (parent === undefined || parent.realmId !== resource.realmId) {
        invalidChain = true;
        break;
      }
      current = parent;
    }

    const realm = realms.get(resource.realmId);
    if (!invalidChain && realm !== undefined && current?.id !== realm.rootResourceId) {
      issues.push({
        code: "RESOURCE_NOT_CONNECTED_TO_REALM_ROOT",
        message: `Resource '${resource.id}' is not connected to realm root '${realm.rootResourceId}'.`,
        path: ["resources", index, "parentId"],
        objectId: resource.id,
      });
    }
  });
}

function validateLevels(
  levels: readonly AuthorityLevel[],
  realms: ReadonlyMap<RealmId, unknown>,
  issues: PolicyIssue[],
): void {
  const ranks = new Set<string>();
  levels.forEach((level, index) => {
    if (!realms.has(level.realmId)) {
      referenceIssue(issues, ["authorityLevels", index, "realmId"], level.id, "realm", level.realmId);
    }
    if (!Number.isFinite(level.rank)) {
      issues.push({
        code: "DUPLICATE_LEVEL_RANK",
        message: "Authority level rank must be finite.",
        path: ["authorityLevels", index, "rank"],
        objectId: level.id,
      });
    }
    const rankKey = `${level.realmId}:${level.rank}`;
    if (ranks.has(rankKey)) {
      issues.push({
        code: "DUPLICATE_LEVEL_RANK",
        message: `Authority level rank '${level.rank}' is already used in realm '${level.realmId}'.`,
        path: ["authorityLevels", index, "rank"],
        objectId: level.id,
      });
    }
    ranks.add(rankKey);
  });
}

function validateSubjects(
  subjects: readonly { readonly id: SubjectId; readonly realmId: RealmId }[],
  realms: ReadonlyMap<RealmId, unknown>,
  issues: PolicyIssue[],
): void {
  subjects.forEach((subject, index) => {
    if (!realms.has(subject.realmId)) {
      referenceIssue(issues, ["subjects", index, "realmId"], subject.id, "realm", subject.realmId);
    }
  });
}

function validateRoles(
  roles: readonly Role[],
  levels: ReadonlyMap<string, AuthorityLevel>,
  permissions: ReadonlyMap<PermissionKey, PermissionDefinition>,
  resources: ReadonlyMap<ResourceId, Resource>,
  realms: ReadonlyMap<RealmId, unknown>,
  issues: PolicyIssue[],
): void {
  roles.forEach((role, index) => {
    if (!realms.has(role.realmId)) {
      referenceIssue(issues, ["roles", index, "realmId"], role.id, "realm", role.realmId);
    }
    const level = levels.get(role.levelId);
    if (level === undefined) {
      referenceIssue(issues, ["roles", index, "levelId"], role.id, "authority level", role.levelId);
    } else if (level.realmId !== role.realmId) {
      realmIssue(issues, ["roles", index, "levelId"], role.id);
    }

    const assigned = new Set(role.permissions);
    role.permissions.forEach((permission, permissionIndex) => {
      if (containsWildcard(permission)) {
        issues.push({
          code: "WILDCARD_PERMISSION_NOT_ALLOWED",
          message: `Role '${role.id}' must use exact permission keys instead of '${permission}'.`,
          path: ["roles", index, "permissions", permissionIndex],
          objectId: role.id,
        });
      }
      if (!permissions.has(permission)) {
        issues.push({
          code: "UNKNOWN_PERMISSION",
          message: `Role '${role.id}' contains unknown permission '${permission}'.`,
          path: ["roles", index, "permissions", permissionIndex],
          objectId: role.id,
        });
      }
    });
    role.delegatablePermissions.forEach((permission, permissionIndex) => {
      if (containsWildcard(permission)) {
        issues.push({
          code: "WILDCARD_PERMISSION_NOT_ALLOWED",
          message: `Role '${role.id}' must use exact delegatable permission keys instead of '${permission}'.`,
          path: ["roles", index, "delegatablePermissions", permissionIndex],
          objectId: role.id,
        });
      }
      const definition = permissions.get(permission);
      if (!assigned.has(permission) || definition?.delegatable !== true || definition.protected === true) {
        issues.push({
          code: "INVALID_DELEGATION",
          message: `Role '${role.id}' cannot delegate permission '${permission}'.`,
          path: ["roles", index, "delegatablePermissions", permissionIndex],
          objectId: role.id,
        });
      }
    });

    const fieldAccessResources = new Set<ResourceId>();
    (role.fieldAccess ?? []).forEach((rule, ruleIndex) => {
      const path = ["roles", index, "fieldAccess", ruleIndex] as const;
      const resource = resources.get(rule.resourceId);
      if (resource === undefined) {
        referenceIssue(
          issues,
          [...path, "resourceId"],
          role.id,
          "resource",
          rule.resourceId,
        );
      } else if (resource.realmId !== role.realmId) {
        realmIssue(issues, [...path, "resourceId"], role.id);
      }
      if (fieldAccessResources.has(rule.resourceId)) {
        issues.push({
          code: "INVALID_FIELD_ACCESS_RULE",
          message: `Role '${role.id}' contains multiple field access rules for '${rule.resourceId}'.`,
          path,
          objectId: role.id,
        });
      }
      fieldAccessResources.add(rule.resourceId);
      validateFieldNames(rule.readableFields, [...path, "readableFields"], role.id, issues);
      validateFieldNames(rule.writableFields, [...path, "writableFields"], role.id, issues);
    });
  });
}

/**
 * A small runtime-readonly Map facade. Object.freeze(new Map()) does not prevent
 * Map#set, so validated snapshots never expose their backing mutable maps.
 */
class ImmutableMap<TKey, TValue> implements ReadonlyMap<TKey, TValue> {
  readonly #values: Map<TKey, TValue>;

  public constructor(values: ReadonlyMap<TKey, TValue>) {
    this.#values = new Map(values);
    Object.freeze(this);
  }

  public get size(): number {
    return this.#values.size;
  }

  public get(key: TKey): TValue | undefined {
    return this.#values.get(key);
  }

  public has(key: TKey): boolean {
    return this.#values.has(key);
  }

  public entries(): MapIterator<[TKey, TValue]> {
    return this.#values.entries();
  }

  public keys(): MapIterator<TKey> {
    return this.#values.keys();
  }

  public values(): MapIterator<TValue> {
    return this.#values.values();
  }

  public forEach(
    callbackfn: (value: TValue, key: TKey, map: ReadonlyMap<TKey, TValue>) => void,
    thisArg?: unknown,
  ): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  public [Symbol.iterator](): MapIterator<[TKey, TValue]> {
    return this.entries();
  }

  public get [Symbol.toStringTag](): string {
    return "ImmutableMap";
  }
}

function immutableMap<TKey, TValue>(values: ReadonlyMap<TKey, TValue>): ReadonlyMap<TKey, TValue> {
  return new ImmutableMap(values);
}

function cloneAndFreezeInput(input: PolicyInput): PolicyInput {
  return Object.freeze({
    realms: Object.freeze(input.realms.map(cloneRealm)),
    subjects: Object.freeze(input.subjects.map(cloneSubject)),
    resources: Object.freeze(input.resources.map(cloneResource)),
    authorityLevels: Object.freeze(input.authorityLevels.map(cloneAuthorityLevel)),
    roles: Object.freeze(input.roles.map(cloneRole)),
    permissions: Object.freeze(input.permissions.map(clonePermission)),
    bindings: Object.freeze(input.bindings.map(cloneBinding)),
    groupMemberships: Object.freeze((input.groupMemberships ?? []).map(cloneGroupMembership)),
  });
}

function cloneRealm(realm: Realm): Realm {
  return Object.freeze({ ...realm });
}

function cloneSubject(subject: Subject): Subject {
  return Object.freeze({ ...subject });
}

function cloneResource(resource: Resource): Resource {
  return Object.freeze({ ...resource });
}

function cloneAuthorityLevel(level: AuthorityLevel): AuthorityLevel {
  return Object.freeze({ ...level });
}

function cloneRole(role: Role): Role {
  return Object.freeze({
    ...role,
    permissions: Object.freeze([...role.permissions]),
    delegatablePermissions: Object.freeze([...role.delegatablePermissions]),
    ...(role.fieldAccess === undefined
      ? {}
      : {
          fieldAccess: Object.freeze(role.fieldAccess.map((rule) => Object.freeze({
            ...rule,
            readableFields: Object.freeze([...rule.readableFields]),
            writableFields: Object.freeze([...rule.writableFields]),
          }))),
        }),
  });
}

function clonePermission(permission: PermissionDefinition): PermissionDefinition {
  return Object.freeze({ ...permission });
}

function cloneBinding(binding: RoleBinding): RoleBinding {
  return Object.freeze({
    ...binding,
    scope: Object.freeze({ ...binding.scope }),
    ...(binding.constraints === undefined
      ? {}
      : {
          constraints: Object.freeze({
            ...binding.constraints,
            ...(binding.constraints.statuses === undefined
              ? {}
              : { statuses: Object.freeze([...binding.constraints.statuses]) }),
          }),
        }),
  });
}

function cloneGroupMembership(membership: GroupMembership): GroupMembership {
  return Object.freeze({ ...membership });
}

function containsWildcard(permission: PermissionKey): boolean {
  return permission.includes("*");
}

function validateBindings(
  bindings: readonly RoleBinding[],
  subjects: ReadonlyMap<string, Subject>,
  roles: ReadonlyMap<string, Role>,
  resources: ReadonlyMap<string, Resource>,
  realms: ReadonlyMap<RealmId, unknown>,
  issues: PolicyIssue[],
): void {
  bindings.forEach((binding, index) => {
    if (!realms.has(binding.realmId)) {
      referenceIssue(issues, ["bindings", index, "realmId"], binding.id, "realm", binding.realmId);
    }
    const subject = subjects.get(binding.subjectId);
    const role = roles.get(binding.roleId);
    const resource = resources.get(binding.scope.resourceId);
    if (subject === undefined) {
      referenceIssue(issues, ["bindings", index, "subjectId"], binding.id, "subject", binding.subjectId);
    } else if (subject.realmId !== binding.realmId) {
      realmIssue(issues, ["bindings", index, "subjectId"], binding.id);
    }
    if (role === undefined) {
      referenceIssue(issues, ["bindings", index, "roleId"], binding.id, "role", binding.roleId);
    } else if (role.realmId !== binding.realmId) {
      realmIssue(issues, ["bindings", index, "roleId"], binding.id);
    }
    if (resource === undefined) {
      referenceIssue(issues, ["bindings", index, "scope", "resourceId"], binding.id, "resource", binding.scope.resourceId);
    } else if (resource.realmId !== binding.realmId) {
      realmIssue(issues, ["bindings", index, "scope", "resourceId"], binding.id);
    }
    const validFrom = parseOptionalInstant(binding.validFrom);
    const validUntil = parseOptionalInstant(binding.validUntil);
    if (
      (binding.validFrom !== undefined && validFrom === null) ||
      (binding.validUntil !== undefined && validUntil === null) ||
      (validFrom !== null && validUntil !== null && validFrom >= validUntil)
    ) {
      issues.push({
        code: "INVALID_BINDING_PERIOD",
        message: `Role binding '${binding.id}' has an invalid active period.`,
        path: ["bindings", index],
        objectId: binding.id,
      });
    }

    const constraintOwnerId = binding.constraints?.ownerSubjectId;
    if (constraintOwnerId !== undefined) {
      const owner = subjects.get(constraintOwnerId);
      if (owner === undefined) {
        referenceIssue(
          issues,
          ["bindings", index, "constraints", "ownerSubjectId"],
          binding.id,
          "subject",
          constraintOwnerId,
        );
      } else if (owner.realmId !== binding.realmId) {
        realmIssue(
          issues,
          ["bindings", index, "constraints", "ownerSubjectId"],
          binding.id,
        );
      }
    }
    if (binding.constraints?.statuses !== undefined) {
      const statuses = binding.constraints.statuses;
      if (
        statuses.length === 0 ||
        statuses.some((status) => status.trim().length === 0) ||
        new Set(statuses).size !== statuses.length
      ) {
        issues.push({
          code: "INVALID_BINDING_CONSTRAINT",
          message: `Role binding '${binding.id}' must contain unique, non-empty statuses.`,
          path: ["bindings", index, "constraints", "statuses"],
          objectId: binding.id,
        });
      }
    }
  });
}

function validateGroupMemberships(
  memberships: readonly GroupMembership[],
  subjects: ReadonlyMap<SubjectId, Subject>,
  realms: ReadonlyMap<RealmId, unknown>,
  issues: PolicyIssue[],
): void {
  const validByMember = new Map<SubjectId, GroupMembership[]>();
  const pairs = new Set<string>();

  memberships.forEach((membership, index) => {
    if (!realms.has(membership.realmId)) {
      referenceIssue(
        issues,
        ["groupMemberships", index, "realmId"],
        membership.id,
        "realm",
        membership.realmId,
      );
    }
    const member = subjects.get(membership.memberSubjectId);
    const group = subjects.get(membership.groupSubjectId);
    if (member === undefined) {
      referenceIssue(
        issues,
        ["groupMemberships", index, "memberSubjectId"],
        membership.id,
        "subject",
        membership.memberSubjectId,
      );
    } else if (member.realmId !== membership.realmId) {
      realmIssue(issues, ["groupMemberships", index, "memberSubjectId"], membership.id);
    }
    if (group === undefined) {
      referenceIssue(
        issues,
        ["groupMemberships", index, "groupSubjectId"],
        membership.id,
        "subject",
        membership.groupSubjectId,
      );
    } else {
      if (group.realmId !== membership.realmId) {
        realmIssue(issues, ["groupMemberships", index, "groupSubjectId"], membership.id);
      }
      if (group.type !== "group") {
        issues.push({
          code: "GROUP_MEMBERSHIP_TARGET_NOT_GROUP",
          message: `Group membership '${membership.id}' must target a group subject.`,
          path: ["groupMemberships", index, "groupSubjectId"],
          objectId: membership.id,
        });
      }
    }

    const pairKey = `${membership.realmId}:${membership.memberSubjectId}:${membership.groupSubjectId}`;
    if (pairs.has(pairKey)) {
      issues.push({
        code: "DUPLICATE_GROUP_MEMBERSHIP",
        message: `Subject '${membership.memberSubjectId}' is already a member of '${membership.groupSubjectId}'.`,
        path: ["groupMemberships", index],
        objectId: membership.id,
      });
    }
    pairs.add(pairKey);

    if (
      member !== undefined &&
      group?.type === "group" &&
      member.realmId === membership.realmId &&
      group.realmId === membership.realmId
    ) {
      const current = validByMember.get(membership.memberSubjectId) ?? [];
      current.push(membership);
      validByMember.set(membership.memberSubjectId, current);
    }
  });

  memberships.forEach((membership, index) => {
    if (
      membership.memberSubjectId === membership.groupSubjectId ||
      hasMembershipPath(
        validByMember,
        membership.groupSubjectId,
        membership.memberSubjectId,
        new Set(),
      )
    ) {
      issues.push({
        code: "GROUP_MEMBERSHIP_CYCLE",
        message: `Group membership '${membership.id}' creates a membership cycle.`,
        path: ["groupMemberships", index, "groupSubjectId"],
        objectId: membership.id,
      });
    }
  });
}

function hasMembershipPath(
  membershipsByMember: ReadonlyMap<SubjectId, readonly GroupMembership[]>,
  currentId: SubjectId,
  targetId: SubjectId,
  visited: Set<SubjectId>,
): boolean {
  if (currentId === targetId) {
    return true;
  }
  if (visited.has(currentId)) {
    return false;
  }
  visited.add(currentId);
  return (membershipsByMember.get(currentId) ?? []).some((membership) =>
    hasMembershipPath(
      membershipsByMember,
      membership.groupSubjectId,
      targetId,
      new Set(visited),
    ),
  );
}

function indexGroupMemberships(
  memberships: readonly GroupMembership[],
): ReadonlyMap<SubjectId, readonly GroupMembership[]> {
  const mutable = new Map<SubjectId, GroupMembership[]>();
  memberships.forEach((membership) => {
    const current = mutable.get(membership.memberSubjectId) ?? [];
    current.push(membership);
    mutable.set(membership.memberSubjectId, current);
  });
  const indexed = new Map<SubjectId, readonly GroupMembership[]>();
  mutable.forEach((values, subjectId) => {
    indexed.set(
      subjectId,
      Object.freeze([...values].sort((left, right) => left.id.localeCompare(right.id))),
    );
  });
  return indexed;
}

function buildMembershipPaths(
  subjects: readonly Subject[],
  membershipsByMember: ReadonlyMap<SubjectId, readonly GroupMembership[]>,
): ReadonlyMap<SubjectId, readonly (readonly SubjectId[])[]> {
  const result = new Map<SubjectId, readonly (readonly SubjectId[])[]>();
  subjects.forEach((subject) => {
    const paths: (readonly SubjectId[])[] = [];
    collectMembershipPaths(
      membershipsByMember,
      subject.id,
      Object.freeze([subject.id]),
      new Set([subject.id]),
      paths,
    );
    if (paths.length > 0) {
      paths.sort((left, right) =>
        left.length - right.length || left.join("\u0000").localeCompare(right.join("\u0000")),
      );
      result.set(subject.id, Object.freeze(paths));
    }
  });
  return result;
}

function collectMembershipPaths(
  membershipsByMember: ReadonlyMap<SubjectId, readonly GroupMembership[]>,
  currentId: SubjectId,
  path: readonly SubjectId[],
  visited: ReadonlySet<SubjectId>,
  output: (readonly SubjectId[])[],
): void {
  (membershipsByMember.get(currentId) ?? []).forEach((membership) => {
    const groupId = membership.groupSubjectId;
    if (visited.has(groupId)) {
      return;
    }
    const nextPath = Object.freeze([...path, groupId]);
    output.push(nextPath);
    collectMembershipPaths(
      membershipsByMember,
      groupId,
      nextPath,
      new Set([...visited, groupId]),
      output,
    );
  });
}

function validateFieldNames(
  fields: readonly string[],
  path: readonly (string | number)[],
  roleId: string,
  issues: PolicyIssue[],
): void {
  if (
    fields.some((field) => field.trim().length === 0) ||
    new Set(fields).size !== fields.length
  ) {
    issues.push({
      code: "INVALID_FIELD_ACCESS_RULE",
      message: `Role '${roleId}' field access lists must contain unique, non-empty field names.`,
      path,
      objectId: roleId,
    });
  }
}

function uniqueMap<T, TKey extends string>(
  values: readonly T[],
  path: string,
  issues: PolicyIssue[],
  selectId: (value: T) => TKey,
): Map<TKey, T> {
  const map = new Map<TKey, T>();
  values.forEach((value, index) => {
    const id = selectId(value);
    if (map.has(id)) {
      issues.push({
        code: "DUPLICATE_ID",
        message: `Duplicate ID '${id}' in ${path}.`,
        path: [path, index],
        objectId: id,
      });
    } else {
      map.set(id, value);
    }
  });
  return map;
}

function parseOptionalInstant(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function referenceIssue(
  issues: PolicyIssue[],
  path: readonly (string | number)[],
  objectId: string,
  referenceType: string,
  referenceId: string,
): void {
  issues.push({
    code: "REFERENCE_NOT_FOUND",
    message: `Object '${objectId}' references unknown ${referenceType} '${referenceId}'.`,
    path,
    objectId,
  });
}

function realmIssue(
  issues: PolicyIssue[],
  path: readonly (string | number)[],
  objectId: string,
): void {
  issues.push({
    code: "REALM_MISMATCH",
    message: `Object '${objectId}' references an object in another realm.`,
    path,
    objectId,
  });
}
