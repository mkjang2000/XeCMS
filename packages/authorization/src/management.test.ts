import { describe, expect, it } from "vitest";

import {
  asAuthorityLevelId,
  asPermissionKey,
  asRealmId,
  asResourceId,
  asRoleBindingId,
  asRoleId,
  asSubjectId,
  authorizeRoleBindingCreate,
  authorizeRoleBindingRemove,
  authorizeRoleBindingUpdate,
  authorizeRoleCreate,
  authorizeRoleDelete,
  authorizeRoleUpdate,
  authorizeSubjectDisable,
  createPolicySnapshot,
  evaluateAccess,
  getSubjectAuthorityRank,
  type AccessDecision,
  type PolicyInput,
  type Role,
  type RoleBinding,
} from "./index.js";

const NOW = "2026-07-14T00:00:00Z";

const realm = asRealmId("realm_main");
const otherRealm = asRealmId("realm_other");
const root = asResourceId("resource_root");
const siteA = asResourceId("resource_site_a");
const siteAChild = asResourceId("resource_site_a_child");
const siteB = asResourceId("resource_site_b");
const otherRoot = asResourceId("resource_other_root");

const admin = asSubjectId("subject_admin");
const junior = asSubjectId("subject_junior");
const target = asSubjectId("subject_target");
const peerTarget = asSubjectId("subject_peer_target");
const noRoleTarget = asSubjectId("subject_no_role_target");
const expiredHighTarget = asSubjectId("subject_expired_high_target");
const toxicActor = asSubjectId("subject_toxic_actor");
const splitActor = asSubjectId("subject_split_actor");
const scopeSplitActor = asSubjectId("subject_scope_split_actor");
const expiredActor = asSubjectId("subject_expired_actor");
const disabledActor = asSubjectId("subject_disabled_actor");
const protectedTarget = asSubjectId("subject_protected_target");
const otherTarget = asSubjectId("subject_other_target");

const read = asPermissionKey("content.read");
const update = asPermissionKey("content.update");
const mediaRead = asPermissionKey("media.read");
const roleCreate = asPermissionKey("role.create");
const roleUpdate = asPermissionKey("role.update");
const roleDelete = asPermissionKey("role.delete");
const bindingCreate = asPermissionKey("role-binding.create");
const bindingUpdate = asPermissionKey("role-binding.update");
const bindingRemove = asPermissionKey("role-binding.remove");
const subjectDisable = asPermissionKey("identity.disable");
const nonDelegatable = asPermissionKey("system.security.manage");

const level100 = asAuthorityLevelId("level_100");
const level90 = asAuthorityLevelId("level_90");
const level60 = asAuthorityLevelId("level_60");
const level40 = asAuthorityLevelId("level_40");
const level20 = asAuthorityLevelId("level_20");
const otherLevel20 = asAuthorityLevelId("other_level_20");

const managerRole = asRoleId("role_manager");
const peerRole = asRoleId("role_peer");
const midRole = asRoleId("role_mid");
const juniorManagerRole = asRoleId("role_junior_manager");
const lowRole = asRoleId("role_low");
const highRole = asRoleId("role_high");
const highNoManagementRole = asRoleId("role_high_no_management");
const lowManagementRole = asRoleId("role_low_management");
const splitReadRole = asRoleId("role_split_read");
const splitUpdateRole = asRoleId("role_split_update");
const protectedRole = asRoleId("role_protected");
const nonDelegatableRole = asRoleId("role_non_delegatable");
const otherRole = asRoleId("role_other");

const adminBinding = asRoleBindingId("binding_admin");
const targetBinding = asRoleBindingId("binding_target_mid");
const protectedBinding = asRoleBindingId("binding_protected");

const managementActions = [
  roleCreate,
  roleUpdate,
  roleDelete,
  bindingCreate,
  bindingUpdate,
  bindingRemove,
  subjectDisable,
] as const;

function role(
  id: ReturnType<typeof asRoleId>,
  levelId: ReturnType<typeof asAuthorityLevelId>,
  name: string,
  permissions: readonly ReturnType<typeof asPermissionKey>[],
  delegatablePermissions: readonly ReturnType<typeof asPermissionKey>[] = [],
  extra: Partial<Role> = {},
): Role {
  return {
    id,
    realmId: realm,
    levelId,
    name,
    permissions,
    delegatablePermissions,
    ...extra,
  };
}

function binding(
  id: ReturnType<typeof asRoleBindingId>,
  subjectId: ReturnType<typeof asSubjectId>,
  roleId: ReturnType<typeof asRoleId>,
  resourceId = root,
  propagation: RoleBinding["scope"]["propagation"] = "self-and-children",
  extra: Partial<RoleBinding> = {},
): RoleBinding {
  return {
    id,
    realmId: realm,
    subjectId,
    roleId,
    scope: { resourceId, propagation },
    ...extra,
  };
}

function policyInput(): PolicyInput {
  return {
    realms: [
      { id: realm, rootResourceId: root },
      { id: otherRealm, rootResourceId: otherRoot },
    ],
    subjects: [
      { id: admin, realmId: realm, type: "user" },
      { id: junior, realmId: realm, type: "user" },
      { id: target, realmId: realm, type: "user" },
      { id: peerTarget, realmId: realm, type: "user" },
      { id: noRoleTarget, realmId: realm, type: "user" },
      { id: expiredHighTarget, realmId: realm, type: "user" },
      { id: toxicActor, realmId: realm, type: "user" },
      { id: splitActor, realmId: realm, type: "user" },
      { id: scopeSplitActor, realmId: realm, type: "user" },
      { id: expiredActor, realmId: realm, type: "user" },
      { id: disabledActor, realmId: realm, type: "user", disabled: true },
      { id: protectedTarget, realmId: realm, type: "user", protected: true },
      { id: otherTarget, realmId: otherRealm, type: "user" },
    ],
    resources: [
      { id: root, realmId: realm },
      { id: siteA, realmId: realm, parentId: root },
      { id: siteAChild, realmId: realm, parentId: siteA },
      { id: siteB, realmId: realm, parentId: root },
      { id: otherRoot, realmId: otherRealm },
    ],
    authorityLevels: [
      { id: level100, realmId: realm, name: "Owner-like", rank: 100 },
      { id: level90, realmId: realm, name: "Administrator", rank: 90 },
      { id: level60, realmId: realm, name: "Manager", rank: 60 },
      { id: level40, realmId: realm, name: "Junior administrator", rank: 40 },
      { id: level20, realmId: realm, name: "Member", rank: 20 },
      { id: otherLevel20, realmId: otherRealm, name: "Other member", rank: 20 },
    ],
    permissions: [
      { key: read, hierarchyGuard: "none", delegatable: true },
      { key: update, hierarchyGuard: "none", delegatable: true },
      { key: mediaRead, hierarchyGuard: "none", delegatable: true },
      { key: roleCreate, hierarchyGuard: "target-role", delegatable: false },
      { key: roleUpdate, hierarchyGuard: "target-role", delegatable: false },
      { key: roleDelete, hierarchyGuard: "target-role", delegatable: false },
      { key: bindingCreate, hierarchyGuard: "target-binding", delegatable: false },
      { key: bindingUpdate, hierarchyGuard: "target-binding", delegatable: false },
      { key: bindingRemove, hierarchyGuard: "target-binding", delegatable: false },
      { key: subjectDisable, hierarchyGuard: "target-subject", delegatable: false },
      { key: nonDelegatable, hierarchyGuard: "none", delegatable: false, protected: true },
    ],
    roles: [
      role(
        managerRole,
        level90,
        "Manager",
        [...managementActions, read, update, mediaRead],
        [read, update, mediaRead],
      ),
      role(peerRole, level90, "Peer", [read]),
      role(midRole, level60, "Mid", [read, update]),
      role(
        juniorManagerRole,
        level40,
        "Junior manager",
        [...managementActions, read, update, mediaRead],
        [read, update, mediaRead],
      ),
      role(lowRole, level20, "Low", [read]),
      role(highRole, level100, "High", [read]),
      role(highNoManagementRole, level90, "High without management", [read, update], [read, update]),
      role(lowManagementRole, level20, "Low management", [bindingCreate, read, update], [read, update]),
      role(splitReadRole, level90, "Split read", [bindingUpdate, read, update], [read]),
      role(splitUpdateRole, level90, "Split update", [bindingUpdate, read, update], [update]),
      role(protectedRole, level20, "Protected role", [read], [], { protected: true }),
      role(nonDelegatableRole, level20, "Non-delegatable", [nonDelegatable]),
      {
        id: otherRole,
        realmId: otherRealm,
        levelId: otherLevel20,
        name: "Other role",
        permissions: [read],
        delegatablePermissions: [],
      },
    ],
    bindings: [
      binding(adminBinding, admin, managerRole),
      binding(asRoleBindingId("binding_junior"), junior, juniorManagerRole),
      binding(targetBinding, target, midRole, siteA, "self"),
      binding(asRoleBindingId("binding_peer"), peerTarget, peerRole),
      binding(asRoleBindingId("binding_expired_high"), expiredHighTarget, highRole, root, "self-and-children", {
        validUntil: "2026-07-13T00:00:00Z",
      }),
      binding(asRoleBindingId("binding_toxic_high"), toxicActor, highNoManagementRole),
      binding(asRoleBindingId("binding_toxic_low"), toxicActor, lowManagementRole),
      binding(asRoleBindingId("binding_split_read"), splitActor, splitReadRole),
      binding(asRoleBindingId("binding_split_update"), splitActor, splitUpdateRole),
      binding(asRoleBindingId("binding_scope_a"), scopeSplitActor, managerRole, siteA, "self"),
      binding(asRoleBindingId("binding_scope_b"), scopeSplitActor, managerRole, siteB, "self"),
      binding(asRoleBindingId("binding_expired_actor"), expiredActor, managerRole, root, "self-and-children", {
        validUntil: "2026-07-13T00:00:00Z",
      }),
      binding(asRoleBindingId("binding_disabled_actor"), disabledActor, managerRole),
      binding(protectedBinding, protectedTarget, lowRole, siteA, "self", { protected: true }),
      {
        id: asRoleBindingId("binding_other"),
        realmId: otherRealm,
        subjectId: otherTarget,
        roleId: otherRole,
        scope: { resourceId: otherRoot, propagation: "self-and-children" },
      },
    ],
  };
}

function lowCandidate(id = "role_candidate"): Role {
  return role(asRoleId(id), level20, "Candidate", [read]);
}

function lowBindingCandidate(id = "binding_candidate"): RoleBinding {
  return binding(asRoleBindingId(id), noRoleTarget, lowRole, siteA, "self");
}

describe("dedicated role management authorization", () => {
  it("authorizes role create, update, and delete only at realm scope", () => {
    const policy = createPolicySnapshot(policyInput());

    expect(authorizeRoleCreate(policy, {
      actorSubjectId: admin,
      role: lowCandidate(),
      action: roleCreate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 20 }));

    expect(authorizeRoleUpdate(policy, {
      actorSubjectId: admin,
      roleId: midRole,
      nextRole: role(midRole, level60, "Renamed mid", [read, update]),
      action: roleUpdate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 60 }));

    expect(authorizeRoleDelete(policy, {
      actorSubjectId: admin,
      roleId: lowRole,
      action: roleDelete,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 20 }));
  });

  it("uses max(old rank, new rank) so lowering a role cannot bypass hierarchy", () => {
    const policy = createPolicySnapshot(policyInput());
    const decision = authorizeRoleUpdate(policy, {
      actorSubjectId: junior,
      roleId: midRole,
      nextRole: role(midRole, level20, "Downgraded", [read, update]),
      action: roleUpdate,
      now: NOW,
    });

    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "TARGET_NOT_LOWER",
      targetLevel: 60,
    }));
  });

  it("rejects unknown, wildcard, and invalid delegatable permissions on a proposed role", () => {
    const policy = createPolicySnapshot(policyInput());
    const unknown = asPermissionKey("unknown.permission");
    const wildcard = asPermissionKey("content.*");

    expect(authorizeRoleCreate(policy, {
      actorSubjectId: admin,
      role: role(asRoleId("role_unknown"), level20, "Unknown", [unknown]),
      action: roleCreate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "UNKNOWN_PERMISSION" }));

    expect(authorizeRoleCreate(policy, {
      actorSubjectId: admin,
      role: role(asRoleId("role_wildcard"), level20, "Wildcard", [wildcard]),
      action: roleCreate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "WILDCARD_PERMISSION_NOT_ALLOWED" }));

    expect(authorizeRoleCreate(policy, {
      actorSubjectId: admin,
      role: role(asRoleId("role_bad_delegate"), level20, "Bad delegate", [read], [update]),
      action: roleCreate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "INVALID_DELEGATION" }));
  });
});

describe("dedicated binding management authorization", () => {
  it("authorizes create, update, and remove with full target scope and delegation", () => {
    const policy = createPolicySnapshot(policyInput());

    expect(authorizeRoleBindingCreate(policy, {
      actorSubjectId: admin,
      binding: lowBindingCandidate(),
      action: bindingCreate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 20 }));

    expect(authorizeRoleBindingUpdate(policy, {
      actorSubjectId: admin,
      bindingId: targetBinding,
      nextBinding: binding(targetBinding, target, lowRole, siteB, "self"),
      action: bindingUpdate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 60 }));

    expect(authorizeRoleBindingRemove(policy, {
      actorSubjectId: admin,
      bindingId: targetBinding,
      action: bindingRemove,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 60 }));
  });

  it("uses max(old rank, new rank) so lowering a binding cannot bypass hierarchy", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(authorizeRoleBindingUpdate(policy, {
      actorSubjectId: junior,
      bindingId: targetBinding,
      nextBinding: binding(targetBinding, target, lowRole, siteA, "self"),
      action: bindingUpdate,
      now: NOW,
    })).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "TARGET_NOT_LOWER",
      targetLevel: 60,
    }));
  });

  it("requires one grant to contain both the old and new scope", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(authorizeRoleBindingUpdate(policy, {
      actorSubjectId: scopeSplitActor,
      bindingId: targetBinding,
      nextBinding: binding(targetBinding, target, lowRole, siteB, "self"),
      action: bindingUpdate,
      now: NOW,
    })).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "NO_SINGLE_GRANT_SATISFIES_MANAGEMENT",
    }));
  });

  it("requires the grant to contain propagation, not just the same scope root", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(authorizeRoleBindingCreate(policy, {
      actorSubjectId: scopeSplitActor,
      binding: binding(asRoleBindingId("binding_subtree"), noRoleTarget, lowRole, siteA, "self-and-children"),
      action: bindingCreate,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "SCOPE_MISMATCH" }));
  });
});

describe("subject hierarchy management", () => {
  it("calculates the highest active target rank across the full realm", () => {
    const policy = createPolicySnapshot(policyInput());
    const realmWide = { resourceId: root, propagation: "self-and-children" } as const;

    expect(getSubjectAuthorityRank(policy, target, realmWide, NOW)).toBe(60);
    expect(getSubjectAuthorityRank(policy, noRoleTarget, realmWide, NOW)).toBeUndefined();
    expect(getSubjectAuthorityRank(policy, expiredHighTarget, realmWide, NOW)).toBeUndefined();
  });

  it("requires realm-wide scope and a strictly higher action grant", () => {
    const policy = createPolicySnapshot(policyInput());

    expect(authorizeSubjectDisable(policy, {
      actorSubjectId: admin,
      targetSubjectId: target,
      action: subjectDisable,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: true, actorLevel: 90, targetLevel: 60 }));

    expect(authorizeSubjectDisable(policy, {
      actorSubjectId: admin,
      targetSubjectId: peerTarget,
      action: subjectDisable,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "TARGET_NOT_LOWER", targetLevel: 90 }));

    expect(authorizeSubjectDisable(policy, {
      actorSubjectId: scopeSplitActor,
      targetSubjectId: noRoleTarget,
      action: subjectDisable,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "SCOPE_MISMATCH" }));
  });
});

describe("table-driven privilege escalation regression suite", () => {
  const scenarios: readonly {
    readonly name: string;
    readonly decide: (policy: ReturnType<typeof createPolicySnapshot>) => AccessDecision;
    readonly reasonCode: AccessDecision["reasonCode"];
  }[] = [
    {
      name: "a low action grant cannot borrow an unrelated high role rank",
      decide: (policy) => authorizeRoleBindingCreate(policy, {
        actorSubjectId: toxicActor,
        binding: binding(asRoleBindingId("binding_toxic_attempt"), noRoleTarget, midRole, siteA, "self"),
        action: bindingCreate,
        now: NOW,
      }),
      reasonCode: "TARGET_NOT_LOWER",
    },
    {
      name: "delegation split across roles is not combined",
      decide: (policy) => authorizeRoleBindingUpdate(policy, {
        actorSubjectId: splitActor,
        bindingId: targetBinding,
        nextBinding: binding(targetBinding, target, midRole, siteA, "self"),
        action: bindingUpdate,
        now: NOW,
      }),
      reasonCode: "NO_SINGLE_GRANT_SATISFIES_MANAGEMENT",
    },
    {
      name: "expired management bindings grant no authority",
      decide: (policy) => authorizeRoleBindingCreate(policy, {
        actorSubjectId: expiredActor,
        binding: lowBindingCandidate("binding_expired_attempt"),
        action: bindingCreate,
        now: NOW,
      }),
      reasonCode: "INACTIVE_BINDING",
    },
    {
      name: "a disabled actor cannot exercise an otherwise valid binding",
      decide: (policy) => authorizeRoleBindingCreate(policy, {
        actorSubjectId: disabledActor,
        binding: lowBindingCandidate("binding_disabled_attempt"),
        action: bindingCreate,
        now: NOW,
      }),
      reasonCode: "SUBJECT_DISABLED",
    },
    {
      name: "cross-realm subject management is isolated",
      decide: (policy) => authorizeSubjectDisable(policy, {
        actorSubjectId: admin,
        targetSubjectId: otherTarget,
        action: subjectDisable,
        now: NOW,
      }),
      reasonCode: "REALM_MISMATCH",
    },
    {
      name: "a role action cannot be substituted for a binding action",
      decide: (policy) => authorizeRoleBindingCreate(policy, {
        actorSubjectId: admin,
        binding: lowBindingCandidate("binding_wrong_guard"),
        action: roleCreate,
        now: NOW,
      }),
      reasonCode: "HIERARCHY_GUARD_MISMATCH",
    },
    {
      name: "self-binding removal is never allowed",
      decide: (policy) => authorizeRoleBindingRemove(policy, {
        actorSubjectId: admin,
        bindingId: adminBinding,
        action: bindingRemove,
        now: NOW,
      }),
      reasonCode: "SELF_BINDING_MUTATION",
    },
    {
      name: "self-disable is never allowed",
      decide: (policy) => authorizeSubjectDisable(policy, {
        actorSubjectId: admin,
        targetSubjectId: admin,
        action: subjectDisable,
        now: NOW,
      }),
      reasonCode: "SELF_SUBJECT_MUTATION",
    },
    {
      name: "protected bindings cannot be removed",
      decide: (policy) => authorizeRoleBindingRemove(policy, {
        actorSubjectId: admin,
        bindingId: protectedBinding,
        action: bindingRemove,
        now: NOW,
      }),
      reasonCode: "PROTECTED_TARGET",
    },
    {
      name: "protected subjects cannot be disabled",
      decide: (policy) => authorizeSubjectDisable(policy, {
        actorSubjectId: admin,
        targetSubjectId: protectedTarget,
        action: subjectDisable,
        now: NOW,
      }),
      reasonCode: "PROTECTED_TARGET",
    },
    {
      name: "non-delegatable permissions cannot be assigned",
      decide: (policy) => authorizeRoleBindingCreate(policy, {
        actorSubjectId: admin,
        binding: binding(asRoleBindingId("binding_non_delegatable"), noRoleTarget, nonDelegatableRole),
        action: bindingCreate,
        now: NOW,
      }),
      reasonCode: "NON_DELEGATABLE_PERMISSION",
    },
  ];

  it.each(scenarios)("denies $name", ({ decide, reasonCode }) => {
    expect(decide(createPolicySnapshot(policyInput()))).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode,
    }));
  });
});

describe("validated policy snapshot", () => {
  it("detaches and freezes snapshot values and does not expose Map mutation", () => {
    const input = policyInput();
    const policy = createPolicySnapshot(input);
    const originalName = policy.roles.get(lowRole)!.name;

    (input.roles.find(({ id }) => id === lowRole) as { name: string }).name = "Mutated input";

    expect(policy.roles.get(lowRole)!.name).toBe(originalName);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.roles.get(lowRole))).toBe(true);
    expect(Object.isFrozen(policy.roles.get(lowRole)!.permissions)).toBe(true);
    expect(Object.isFrozen(policy.bindings.get(targetBinding)!.scope)).toBe(true);
    expect((policy.roles as unknown as { set?: unknown }).set).toBeUndefined();
  });

  it("rejects cycle, cross-realm reference, unknown permission, wildcard, and invalid periods", () => {
    const base = policyInput();
    const unknown = asPermissionKey("unknown.permission");
    const wildcard = asPermissionKey("content.*");

    const invalidInputs: readonly [PolicyInput, string][] = [
      [
        {
          ...base,
          resources: base.resources.map((resource) =>
            resource.id === siteA
              ? { ...resource, parentId: siteAChild }
              : resource,
          ),
        },
        "RESOURCE_CYCLE",
      ],
      [
        {
          ...base,
          bindings: [
            ...base.bindings,
            {
              id: asRoleBindingId("binding_cross_realm"),
              realmId: realm,
              subjectId: otherTarget,
              roleId: lowRole,
              scope: { resourceId: siteA, propagation: "self" },
            },
          ],
        },
        "REALM_MISMATCH",
      ],
      [
        {
          ...base,
          roles: base.roles.map((candidate) =>
            candidate.id === lowRole ? { ...candidate, permissions: [unknown] } : candidate,
          ),
        },
        "UNKNOWN_PERMISSION",
      ],
      [
        {
          ...base,
          permissions: [
            ...base.permissions,
            { key: wildcard, hierarchyGuard: "none", delegatable: true },
          ],
          roles: base.roles.map((candidate) =>
            candidate.id === lowRole ? { ...candidate, permissions: [wildcard] } : candidate,
          ),
        },
        "WILDCARD_PERMISSION_NOT_ALLOWED",
      ],
      [
        {
          ...base,
          bindings: base.bindings.map((candidate) =>
            candidate.id === targetBinding
              ? { ...candidate, validFrom: NOW, validUntil: NOW }
              : candidate,
          ),
        },
        "INVALID_BINDING_PERIOD",
      ],
    ];

    invalidInputs.forEach(([input, expectedCode]) => {
      expect(() => createPolicySnapshot(input)).toThrowError(expect.objectContaining({
        code: "INVALID_POLICY_GRAPH",
        issues: expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
      }));
    });
  });

  it("treats expired grants as inactive for ordinary access", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(evaluateAccess(policy, {
      actorSubjectId: expiredActor,
      action: read,
      resourceId: root,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "INACTIVE_BINDING" }));
  });
});
