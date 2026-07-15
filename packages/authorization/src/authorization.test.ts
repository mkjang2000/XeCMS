import { describe, expect, it } from "vitest";

import {
  asAuthorityLevelId,
  asPermissionKey,
  asRealmId,
  asResourceId,
  asRoleBindingId,
  asRoleId,
  asSubjectId,
  authorizeRoleAssignment,
  createPolicySnapshot,
  evaluateAccess,
  scopeAppliesToResource,
  type PolicyInput,
} from "./index.js";

const realm = asRealmId("realm_system");
const root = asResourceId("resource_root");
const siteA = asResourceId("resource_site_a");
const siteAPosts = asResourceId("resource_site_a_posts");
const siteB = asResourceId("resource_site_b");
const actor = asSubjectId("subject_actor");
const target = asSubjectId("subject_target");
const toxicActor = asSubjectId("subject_toxic_actor");

const read = asPermissionKey("content.read");
const update = asPermissionKey("content.update");
const roleAssign = asPermissionKey("role.assign");
const protectedPermission = asPermissionKey("system.owner.transfer");

const level80 = asAuthorityLevelId("level_80");
const level40 = asAuthorityLevelId("level_40");
const level20 = asAuthorityLevelId("level_20");
const level10 = asAuthorityLevelId("level_10");

const contentAdmin = asRoleId("role_content_admin");
const peerAdmin = asRoleId("role_peer_admin");
const editor = asRoleId("role_editor");
const viewer = asRoleId("role_viewer");
const highNoAssign = asRoleId("role_high_no_assign");
const lowAssigner = asRoleId("role_low_assigner");
const protectedRole = asRoleId("role_protected");

function policyInput(): PolicyInput {
  return {
    realms: [{ id: realm, rootResourceId: root }],
    subjects: [
      { id: actor, realmId: realm, type: "user" },
      { id: target, realmId: realm, type: "user" },
      { id: toxicActor, realmId: realm, type: "user" },
    ],
    resources: [
      { id: root, realmId: realm },
      { id: siteA, realmId: realm, parentId: root },
      { id: siteAPosts, realmId: realm, parentId: siteA },
      { id: siteB, realmId: realm, parentId: root },
    ],
    authorityLevels: [
      { id: level80, realmId: realm, name: "Administrator", rank: 80 },
      { id: level40, realmId: realm, name: "Editor", rank: 40 },
      { id: level20, realmId: realm, name: "Assistant", rank: 20 },
      { id: level10, realmId: realm, name: "Viewer", rank: 10 },
    ],
    permissions: [
      { key: read, hierarchyGuard: "none", delegatable: true },
      { key: update, hierarchyGuard: "none", delegatable: true },
      { key: roleAssign, hierarchyGuard: "target-binding", delegatable: false },
      {
        key: protectedPermission,
        hierarchyGuard: "target-subject",
        delegatable: false,
        protected: true,
      },
    ],
    roles: [
      {
        id: contentAdmin,
        realmId: realm,
        levelId: level80,
        name: "Content Admin",
        permissions: [read, update, roleAssign],
        delegatablePermissions: [read, update],
      },
      {
        id: peerAdmin,
        realmId: realm,
        levelId: level80,
        name: "Security Admin",
        permissions: [roleAssign],
        delegatablePermissions: [],
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
        id: viewer,
        realmId: realm,
        levelId: level10,
        name: "Viewer",
        permissions: [read],
        delegatablePermissions: [],
      },
      {
        id: highNoAssign,
        realmId: realm,
        levelId: level80,
        name: "High without assign",
        permissions: [read, update],
        delegatablePermissions: [read, update],
      },
      {
        id: lowAssigner,
        realmId: realm,
        levelId: level20,
        name: "Low assigner",
        permissions: [roleAssign],
        delegatablePermissions: [],
      },
      {
        id: protectedRole,
        realmId: realm,
        levelId: level10,
        name: "Protected",
        permissions: [protectedPermission],
        delegatablePermissions: [],
        protected: true,
      },
    ],
    bindings: [
      {
        id: asRoleBindingId("binding_actor_admin"),
        realmId: realm,
        subjectId: actor,
        roleId: contentAdmin,
        scope: { resourceId: siteA, propagation: "self-and-children" },
      },
      {
        id: asRoleBindingId("binding_toxic_high"),
        realmId: realm,
        subjectId: toxicActor,
        roleId: highNoAssign,
        scope: { resourceId: siteA, propagation: "self-and-children" },
      },
      {
        id: asRoleBindingId("binding_toxic_low"),
        realmId: realm,
        subjectId: toxicActor,
        roleId: lowAssigner,
        scope: { resourceId: siteA, propagation: "self-and-children" },
      },
    ],
  };
}

describe("ordinary access", () => {
  it("applies self-and-children scope to descendants", () => {
    const policy = createPolicySnapshot(policyInput());
    const decision = evaluateAccess(policy, {
      actorSubjectId: actor,
      action: update,
      resourceId: siteAPosts,
      now: "2026-07-14T00:00:00Z",
    });

    expect(decision).toEqual(
      expect.objectContaining({ allowed: true, reasonCode: "ALLOW_PERMISSION", actorLevel: 80 }),
    );
    expect(decision.matchedGrants[0]).toEqual(
      expect.objectContaining({ sourceRoleId: contentAdmin, sourceRank: 80 }),
    );
  });

  it("does not apply permissions to a sibling resource", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      evaluateAccess(policy, {
        actorSubjectId: actor,
        action: update,
        resourceId: siteB,
        now: "2026-07-14T00:00:00Z",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "SCOPE_MISMATCH" }));
  });

  it("treats children as descendants but excludes the scope root", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      scopeAppliesToResource(policy, { resourceId: siteA, propagation: "children" }, siteA),
    ).toBe(false);
    expect(
      scopeAppliesToResource(policy, { resourceId: siteA, propagation: "children" }, siteAPosts),
    ).toBe(true);
  });
});

describe("management access", () => {
  it("allows one grant to assign a lower role within its scope and delegation", () => {
    const policy = createPolicySnapshot(policyInput());
    const decision = authorizeRoleAssignment(policy, {
      actorSubjectId: actor,
      targetSubjectId: target,
      roleId: editor,
      scope: { resourceId: siteAPosts, propagation: "self" },
      action: roleAssign,
      now: "2026-07-14T00:00:00Z",
    });

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: true,
        reasonCode: "ALLOW_MANAGEMENT",
        actorLevel: 80,
        targetLevel: 40,
      }),
    );
  });

  it("rejects same-level peers", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      authorizeRoleAssignment(policy, {
        actorSubjectId: actor,
        targetSubjectId: target,
        roleId: peerAdmin,
        scope: { resourceId: siteA, propagation: "self" },
        action: roleAssign,
        now: "2026-07-14T00:00:00Z",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "TARGET_NOT_LOWER" }));
  });

  it("rejects management outside the actor scope even when the target role is lower", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      authorizeRoleAssignment(policy, {
        actorSubjectId: actor,
        targetSubjectId: target,
        roleId: viewer,
        scope: { resourceId: siteB, propagation: "self" },
        action: roleAssign,
        now: "2026-07-14T00:00:00Z",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "SCOPE_MISMATCH" }));
  });

  it("does not combine a high role's rank with a low role's management permission", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      authorizeRoleAssignment(policy, {
        actorSubjectId: toxicActor,
        targetSubjectId: target,
        roleId: editor,
        scope: { resourceId: siteA, propagation: "self" },
        action: roleAssign,
        now: "2026-07-14T00:00:00Z",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "TARGET_NOT_LOWER" }));
  });

  it("rejects non-delegatable protected permissions", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      authorizeRoleAssignment(policy, {
        actorSubjectId: actor,
        targetSubjectId: target,
        roleId: protectedRole,
        scope: { resourceId: siteA, propagation: "self" },
        action: roleAssign,
        now: "2026-07-14T00:00:00Z",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "PROTECTED_TARGET" }));
  });

  it("rejects self-assignment even when level, scope, and delegation would pass", () => {
    const policy = createPolicySnapshot(policyInput());
    expect(
      authorizeRoleAssignment(policy, {
        actorSubjectId: actor,
        targetSubjectId: actor,
        roleId: editor,
        scope: { resourceId: siteA, propagation: "self" },
        action: roleAssign,
        now: "2026-07-14T00:00:00Z",
      }),
    ).toEqual(expect.objectContaining({ allowed: false, reasonCode: "SELF_BINDING_MUTATION" }));
  });
});

describe("policy validation", () => {
  it("rejects duplicate authority ranks inside a realm", () => {
    const input = policyInput();
    expect(() =>
      createPolicySnapshot({
        ...input,
        authorityLevels: [
          ...input.authorityLevels,
          { id: asAuthorityLevelId("level_duplicate"), realmId: realm, name: "Duplicate", rank: 80 },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_POLICY_GRAPH",
        issues: expect.arrayContaining([expect.objectContaining({ code: "DUPLICATE_LEVEL_RANK" })]),
      }),
    );
  });
});
