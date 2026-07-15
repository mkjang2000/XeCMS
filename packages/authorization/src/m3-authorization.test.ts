import { describe, expect, it } from "vitest";

import {
  asAuthorityLevelId,
  asGroupMembershipId,
  asPermissionKey,
  asRealmId,
  asResourceId,
  asRoleBindingId,
  asRoleId,
  asSubjectId,
  authorizeRoleAssignment,
  createPolicySnapshot,
  evaluateAccess,
  evaluateFieldAccess,
  type PolicyInput,
  type Role,
} from "./index.js";

const NOW = "2026-07-15T00:00:00Z";
const realm = asRealmId("realm_main");
const root = asResourceId("resource_root");
const site = asResourceId("resource_site");
const document = asResourceId("resource_document");

const alice = asSubjectId("subject_alice");
const bob = asSubjectId("subject_bob");
const target = asSubjectId("subject_target");
const childGroup = asSubjectId("group_child");
const parentGroup = asSubjectId("group_parent");

const read = asPermissionKey("content.read");
const update = asPermissionKey("content.update");
const roleAssign = asPermissionKey("role.assign");

const level80 = asAuthorityLevelId("level_80");
const level40 = asAuthorityLevelId("level_40");
const level20 = asAuthorityLevelId("level_20");

const groupAdmin = asRoleId("role_group_admin");
const editor = asRoleId("role_editor");
const constrainedReader = asRoleId("role_constrained_reader");

function basePolicy(): PolicyInput {
  return {
    realms: [{ id: realm, rootResourceId: root }],
    subjects: [
      { id: alice, realmId: realm, type: "user" },
      { id: bob, realmId: realm, type: "user" },
      { id: target, realmId: realm, type: "user" },
      { id: childGroup, realmId: realm, type: "group" },
      { id: parentGroup, realmId: realm, type: "group" },
    ],
    resources: [
      { id: root, realmId: realm },
      { id: site, realmId: realm, parentId: root },
      { id: document, realmId: realm, parentId: site },
    ],
    authorityLevels: [
      { id: level80, realmId: realm, name: "Administrator", rank: 80 },
      { id: level40, realmId: realm, name: "Editor", rank: 40 },
      { id: level20, realmId: realm, name: "Assistant", rank: 20 },
    ],
    permissions: [
      { key: read, hierarchyGuard: "none", delegatable: true },
      { key: update, hierarchyGuard: "none", delegatable: true },
      { key: roleAssign, hierarchyGuard: "target-binding", delegatable: false },
    ],
    roles: [
      {
        id: groupAdmin,
        realmId: realm,
        levelId: level80,
        name: "Group Admin",
        permissions: [read, update, roleAssign],
        delegatablePermissions: [read, update],
        fieldAccess: [
          {
            resourceId: site,
            readableFields: ["title"],
            writableFields: ["title", "summary"],
          },
        ],
      },
      {
        id: editor,
        realmId: realm,
        levelId: level40,
        name: "Editor",
        permissions: [read, update],
        delegatablePermissions: [],
      },
      {
        id: constrainedReader,
        realmId: realm,
        levelId: level20,
        name: "Constrained reader",
        permissions: [read],
        delegatablePermissions: [],
      },
    ],
    bindings: [
      {
        id: asRoleBindingId("binding_group_admin"),
        realmId: realm,
        subjectId: parentGroup,
        roleId: groupAdmin,
        scope: { resourceId: site, propagation: "self-and-children" },
      },
      {
        id: asRoleBindingId("binding_bob_constrained"),
        realmId: realm,
        subjectId: bob,
        roleId: constrainedReader,
        scope: { resourceId: site, propagation: "self-and-children" },
        validFrom: "2026-07-14T00:00:00Z",
        validUntil: "2026-07-16T00:00:00Z",
        constraints: { ownerSubjectId: bob, statuses: ["draft", "rejected"] },
      },
    ],
    groupMemberships: [
      {
        id: asGroupMembershipId("membership_alice_child"),
        realmId: realm,
        memberSubjectId: alice,
        groupSubjectId: childGroup,
      },
      {
        id: asGroupMembershipId("membership_child_parent"),
        realmId: realm,
        memberSubjectId: childGroup,
        groupSubjectId: parentGroup,
      },
    ],
  };
}

describe("M3 nested group authorization", () => {
  it("inherits a nested group binding and records the complete membership path", () => {
    const policy = createPolicySnapshot(basePolicy());
    const decision = evaluateAccess(policy, {
      actorSubjectId: alice,
      action: read,
      resourceId: document,
      now: NOW,
    });

    expect(decision).toEqual(expect.objectContaining({ allowed: true, actorLevel: 80 }));
    expect(decision.matchedGrants).toEqual([
      expect.objectContaining({
        sourceRoleId: groupAdmin,
        membershipPath: [alice, childGroup, parentGroup],
      }),
    ]);
    expect(policy.membershipPathsBySubject.get(alice)).toEqual([
      [alice, childGroup],
      [alice, childGroup, parentGroup],
    ]);
    expect(Object.isFrozen(policy.membershipPathsBySubject.get(alice)?.[1])).toBe(true);
  });

  it("uses the inherited management grant's own rank, scope, and delegation", () => {
    const policy = createPolicySnapshot(basePolicy());
    const decision = authorizeRoleAssignment(policy, {
      actorSubjectId: alice,
      targetSubjectId: target,
      roleId: editor,
      scope: { resourceId: document, propagation: "self" },
      action: roleAssign,
      now: NOW,
    });

    expect(decision).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_MANAGEMENT",
      actorLevel: 80,
      targetLevel: 40,
    }));
    expect(decision.matchedGrants[0]?.membershipPath).toEqual([
      alice,
      childGroup,
      parentGroup,
    ]);
  });

  it("does not inherit through a disabled group", () => {
    const input = basePolicy();
    const policy = createPolicySnapshot({
      ...input,
      subjects: input.subjects.map((subject) =>
        subject.id === childGroup ? { ...subject, disabled: true } : subject,
      ),
    });

    expect(evaluateAccess(policy, {
      actorSubjectId: alice,
      action: read,
      resourceId: document,
      now: NOW,
    })).toEqual(expect.objectContaining({ allowed: false, reasonCode: "NO_PERMISSION" }));
  });

  it("does not combine a high inherited rank with a low inherited management grant", () => {
    const input = basePolicy();
    const highWithoutAssign = asRoleId("role_high_without_assign");
    const lowAssigner = asRoleId("role_low_assigner");
    const roles: readonly Role[] = [
      ...input.roles.filter(({ id }) => id !== groupAdmin),
      {
        id: highWithoutAssign,
        realmId: realm,
        levelId: level80,
        name: "High without assignment",
        permissions: [read],
        delegatablePermissions: [read],
      },
      {
        id: lowAssigner,
        realmId: realm,
        levelId: level20,
        name: "Low assigner",
        permissions: [read, roleAssign],
        delegatablePermissions: [read],
      },
    ];
    const policy = createPolicySnapshot({
      ...input,
      roles,
      bindings: [
        ...input.bindings.filter(({ roleId }) => roleId !== groupAdmin),
        {
          id: asRoleBindingId("binding_group_high"),
          realmId: realm,
          subjectId: childGroup,
          roleId: highWithoutAssign,
          scope: { resourceId: site, propagation: "self-and-children" },
        },
        {
          id: asRoleBindingId("binding_group_low_assigner"),
          realmId: realm,
          subjectId: parentGroup,
          roleId: lowAssigner,
          scope: { resourceId: site, propagation: "self-and-children" },
        },
      ],
    });

    expect(authorizeRoleAssignment(policy, {
      actorSubjectId: alice,
      targetSubjectId: target,
      roleId: editor,
      scope: { resourceId: document, propagation: "self" },
      action: roleAssign,
      now: NOW,
    })).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "TARGET_NOT_LOWER",
    }));
  });

  it("rejects non-group targets, duplicate edges, cycles, and cross-realm memberships", () => {
    const base = basePolicy();
    const otherRealm = asRealmId("realm_other");
    const otherRoot = asResourceId("resource_other_root");
    const invalid: PolicyInput = {
      ...base,
      realms: [...base.realms, { id: otherRealm, rootResourceId: otherRoot }],
      resources: [...base.resources, { id: otherRoot, realmId: otherRealm }],
      groupMemberships: [
        ...(base.groupMemberships ?? []),
        {
          id: asGroupMembershipId("membership_target_not_group"),
          realmId: realm,
          memberSubjectId: alice,
          groupSubjectId: bob,
        },
        {
          id: asGroupMembershipId("membership_duplicate_edge"),
          realmId: realm,
          memberSubjectId: alice,
          groupSubjectId: childGroup,
        },
        {
          id: asGroupMembershipId("membership_cycle"),
          realmId: realm,
          memberSubjectId: parentGroup,
          groupSubjectId: childGroup,
        },
        {
          id: asGroupMembershipId("membership_cross_realm"),
          realmId: otherRealm,
          memberSubjectId: alice,
          groupSubjectId: parentGroup,
        },
      ],
    };

    expect(() => createPolicySnapshot(invalid)).toThrowError(expect.objectContaining({
      code: "INVALID_POLICY_GRAPH",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "GROUP_MEMBERSHIP_TARGET_NOT_GROUP" }),
        expect.objectContaining({ code: "DUPLICATE_GROUP_MEMBERSHIP" }),
        expect.objectContaining({ code: "GROUP_MEMBERSHIP_CYCLE" }),
        expect.objectContaining({ code: "REALM_MISMATCH" }),
      ]),
    }));
  });
});

describe("M3 constraints and hierarchy guard", () => {
  it("requires all owner and status context and keeps time bounds fail-closed", () => {
    const policy = createPolicySnapshot(basePolicy());
    const decide = (context?: { ownerSubjectId?: typeof bob; status?: string }, now = NOW) =>
      evaluateAccess(policy, {
        actorSubjectId: bob,
        action: read,
        resourceId: document,
        now,
        ...(context === undefined ? {} : { context }),
      });

    expect(decide({ ownerSubjectId: bob, status: "draft" })).toEqual(
      expect.objectContaining({ allowed: true }),
    );
    expect(decide()).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "CONSTRAINT_NOT_SATISFIED",
    }));
    expect(decide({ ownerSubjectId: bob, status: "published" })).toEqual(
      expect.objectContaining({ allowed: false, reasonCode: "CONSTRAINT_NOT_SATISFIED" }),
    );
    expect(decide({ ownerSubjectId: alice, status: "draft" })).toEqual(
      expect.objectContaining({ allowed: false, reasonCode: "CONSTRAINT_NOT_SATISFIED" }),
    );
    expect(decide({ ownerSubjectId: bob, status: "draft" }, "2026-07-16T00:00:00Z"))
      .toEqual(expect.objectContaining({ allowed: false, reasonCode: "INACTIVE_BINDING" }));
  });

  it("never evaluates a hierarchy-guarded action through the ordinary path", () => {
    const policy = createPolicySnapshot(basePolicy());
    expect(evaluateAccess(policy, {
      actorSubjectId: alice,
      action: roleAssign,
      resourceId: document,
      now: NOW,
    })).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "HIERARCHY_CONTEXT_REQUIRED",
    }));
  });

  it("rejects empty or duplicate constraint statuses", () => {
    const input = basePolicy();
    expect(() => createPolicySnapshot({
      ...input,
      bindings: input.bindings.map((binding) =>
        binding.subjectId === bob
          ? { ...binding, constraints: { ownerSubjectId: bob, statuses: ["draft", "draft"] } }
          : binding,
      ),
    })).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_BINDING_CONSTRAINT" }),
      ]),
    }));
  });
});

describe("M3 resource and field access", () => {
  it("rejects resources that do not terminate at their realm root", () => {
    const input = basePolicy();
    const orphan = asResourceId("resource_orphan");
    expect(() => createPolicySnapshot({
      ...input,
      resources: [...input.resources, { id: orphan, realmId: realm }],
    })).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "RESOURCE_NOT_CONNECTED_TO_REALM_ROOT" }),
      ]),
    }));
  });

  it("applies inherited field allowlists for read and write and otherwise defaults unrestricted", () => {
    const policy = createPolicySnapshot(basePolicy());
    const decide = (actorSubjectId: typeof alice | typeof target, access: "read" | "write", field: string) =>
      evaluateFieldAccess(policy, {
        actorSubjectId,
        resourceId: document,
        access,
        field,
        now: NOW,
      });

    expect(decide(alice, "read", "title")).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_RULE",
    }));
    expect(decide(alice, "read", "secret")).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "FIELD_ACCESS_DENIED",
    }));
    expect(decide(alice, "write", "summary")).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_RULE",
    }));
    expect(decide(alice, "write", "secret")).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "FIELD_ACCESS_DENIED",
    }));
    expect(decide(alice, "read", "title").matchedGrants[0]?.membershipPath).toEqual([
      alice,
      childGroup,
      parentGroup,
    ]);
    expect(decide(target, "write", "secret")).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_UNRESTRICTED",
    }));
  });

  it("keeps an unrestricted Owner grant unrestricted when a lower restricted role is added", () => {
    const input = basePolicy();
    const ownerRole = asRoleId("role_owner_unrestricted");
    const policy = createPolicySnapshot({
      ...input,
      roles: [
        ...input.roles,
        {
          id: ownerRole,
          realmId: realm,
          levelId: level80,
          name: "Owner unrestricted",
          permissions: [read],
          delegatablePermissions: [],
          protected: true,
        },
      ],
      bindings: [
        ...input.bindings,
        {
          id: asRoleBindingId("binding_owner_unrestricted"),
          realmId: realm,
          subjectId: alice,
          roleId: ownerRole,
          scope: { resourceId: root, propagation: "self-and-children" },
          protected: true,
        },
      ],
    });

    const decision = evaluateFieldAccess(policy, {
      actorSubjectId: alice,
      resourceId: document,
      field: "secret",
      access: "read",
      permission: read,
      now: NOW,
    });

    expect(decision).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_UNRESTRICTED",
    }));
    expect(decision.matchedGrants).toEqual([
      expect.objectContaining({
        sourceRoleId: ownerRole,
        sourceBindingId: asRoleBindingId("binding_owner_unrestricted"),
        membershipPath: [],
      }),
    ]);
  });

  it("lets an unrelated role field rule neither restrict nor open another permission", () => {
    const input = basePolicy();
    const unrestrictedReader = asRoleId("role_unrestricted_reader");
    const unrelatedRestrictedUpdater = asRoleId("role_unrelated_restricted_updater");
    const readBindingId = asRoleBindingId("binding_target_unrestricted_reader");
    const unrelatedBindingId = asRoleBindingId("binding_target_restricted_updater");
    const roles: readonly Role[] = [
      ...input.roles,
      {
        id: unrestrictedReader,
        realmId: realm,
        levelId: level40,
        name: "Unrestricted reader",
        permissions: [read],
        delegatablePermissions: [],
      },
      {
        id: unrelatedRestrictedUpdater,
        realmId: realm,
        levelId: level40,
        name: "Restricted updater",
        permissions: [update],
        delegatablePermissions: [],
        fieldAccess: [{ resourceId: site, readableFields: [], writableFields: ["title"] }],
      },
    ];
    const unrelatedBinding = {
      id: unrelatedBindingId,
      realmId: realm,
      subjectId: target,
      roleId: unrelatedRestrictedUpdater,
      scope: { resourceId: site, propagation: "self-and-children" as const },
    };
    const withRelevantRead = createPolicySnapshot({
      ...input,
      roles,
      bindings: [
        ...input.bindings,
        {
          id: readBindingId,
          realmId: realm,
          subjectId: target,
          roleId: unrestrictedReader,
          scope: { resourceId: site, propagation: "self-and-children" },
        },
        unrelatedBinding,
      ],
    });

    expect(evaluateFieldAccess(withRelevantRead, {
      actorSubjectId: target,
      resourceId: document,
      field: "secret",
      access: "read",
      permission: read,
      now: NOW,
    })).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_UNRESTRICTED",
      matchedGrants: [expect.objectContaining({ sourceRoleId: unrestrictedReader })],
    }));

    const withoutRelevantRead = createPolicySnapshot({
      ...input,
      roles,
      bindings: [...input.bindings, unrelatedBinding],
    });
    expect(evaluateFieldAccess(withoutRelevantRead, {
      actorSubjectId: target,
      resourceId: document,
      field: "title",
      access: "read",
      permission: read,
      now: NOW,
    })).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "NO_PERMISSION",
      matchedGrants: [],
    }));
  });

  it("unions allowlists when every relevant permission grant is restricted", () => {
    const input = basePolicy();
    const summaryReader = asRoleId("role_summary_reader");
    const policy = createPolicySnapshot({
      ...input,
      roles: [
        ...input.roles,
        {
          id: summaryReader,
          realmId: realm,
          levelId: level40,
          name: "Summary reader",
          permissions: [read],
          delegatablePermissions: [],
          fieldAccess: [{ resourceId: site, readableFields: ["summary"], writableFields: [] }],
        },
      ],
      bindings: [
        ...input.bindings,
        {
          id: asRoleBindingId("binding_alice_summary_reader"),
          realmId: realm,
          subjectId: alice,
          roleId: summaryReader,
          scope: { resourceId: site, propagation: "self-and-children" },
        },
      ],
    });
    const decide = (field: string) => evaluateFieldAccess(policy, {
      actorSubjectId: alice,
      resourceId: document,
      field,
      access: "read",
      permission: read,
      now: NOW,
    });

    expect(decide("title")).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_RULE",
    }));
    expect(decide("summary")).toEqual(expect.objectContaining({
      allowed: true,
      reasonCode: "ALLOW_FIELD_RULE",
      matchedGrants: [expect.objectContaining({ sourceRoleId: summaryReader })],
    }));
    expect(decide("secret")).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "FIELD_ACCESS_DENIED",
    }));
  });

  it("does not turn a context-mismatched permission grant into unrestricted field access", () => {
    const policy = createPolicySnapshot(basePolicy());
    const evaluate = (context?: { ownerSubjectId: typeof bob; status: string }) =>
      evaluateFieldAccess(policy, {
        actorSubjectId: bob,
        resourceId: document,
        field: "secret",
        access: "read",
        permission: read,
        now: NOW,
        ...(context === undefined ? {} : { context }),
      });

    expect(evaluate()).toEqual(expect.objectContaining({
      allowed: false,
      reasonCode: "CONSTRAINT_NOT_SATISFIED",
    }));
    expect(evaluate({ ownerSubjectId: bob, status: "draft" })).toEqual(
      expect.objectContaining({ allowed: true, reasonCode: "ALLOW_FIELD_UNRESTRICTED" }),
    );
  });

  it("deep-freezes constraints and field access rules in a validated snapshot", () => {
    const policy = createPolicySnapshot(basePolicy());
    const role = policy.roles.get(groupAdmin)!;
    const binding = policy.bindings.get(asRoleBindingId("binding_bob_constrained"))!;

    expect(Object.isFrozen(role.fieldAccess)).toBe(true);
    expect(Object.isFrozen(role.fieldAccess?.[0])).toBe(true);
    expect(Object.isFrozen(role.fieldAccess?.[0]?.readableFields)).toBe(true);
    expect(Object.isFrozen(binding.constraints)).toBe(true);
    expect(Object.isFrozen(binding.constraints?.statuses)).toBe(true);
  });

  it("rejects duplicate field rules and invalid field names", () => {
    const input = basePolicy();
    expect(() => createPolicySnapshot({
      ...input,
      roles: input.roles.map((role) =>
        role.id === groupAdmin
          ? {
              ...role,
              fieldAccess: [
                { resourceId: site, readableFields: ["title", ""], writableFields: [] },
                { resourceId: site, readableFields: [], writableFields: [] },
              ],
            }
          : role,
      ),
    })).toThrowError(expect.objectContaining({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_FIELD_ACCESS_RULE" }),
      ]),
    }));
  });
});
