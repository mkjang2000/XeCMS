import type { SubjectType } from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import {
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_PUBLIC_SUBJECT_ID,
  authorizationOwnerLevelId,
  authorizationOwnerRoleId,
  authorizationSystemPolicyRootLevelId,
  authorizationSystemPolicyRootRoleId,
  authorizationSystemPolicyRootBindingId,
  coreResourceId,
} from "./identifiers.js";
import {
  DEFAULT_PERMISSION_CATALOG,
  CONTENT_PERMISSIONS,
  ROLE_MANAGEMENT_PERMISSIONS,
  IDENTITY_PERMISSIONS,
} from "./permission-catalog.js";
import { createKernelSnapshot } from "./policy-kernel.js";
import type { AuthorizationPolicySeed, InitialAuthorizationPolicyInput } from "./types.js";
import { validateIdentifier, validateDisplayName } from "./validation.js";

/** Deterministic seed IDs make bootstrap idempotency and adapter fixtures reproducible. */
export function createInitialAuthorizationPolicy(
  input: InitialAuthorizationPolicyInput,
): AuthorizationPolicySeed {
  validateIdentifier(input.realmId, "realmId");
  validateIdentifier(input.rootResourceId, "rootResourceId");
  validateIdentifier(input.ownerSubjectId, "ownerSubjectId");
  if (input.ownerIdentityId !== undefined) {
    validateIdentifier(input.ownerIdentityId, "ownerIdentityId");
  }
  if (
    input.ownerSubjectType !== undefined
    && !new Set<SubjectType>(["user", "group", "service-account"]).has(input.ownerSubjectType)
  ) {
    throw new ApplicationError("SUBJECT_TYPE_INVALID", 422, "Owner Subject type is invalid.");
  }
  validateDisplayName(input.realmName, "realmName");
  validateDisplayName(input.rootResourceName, "rootResourceName");
  validateDisplayName(input.ownerSubjectName, "ownerSubjectName");

  const prefix = `authorization:${input.realmId}`;
  if (input.ownerIsSystemPolicyRoot === true && input.ownerSubjectType !== "service-account") {
    throw new ApplicationError(
      "SYSTEM_POLICY_ROOT_SUBJECT_INVALID",
      422,
      "A System Policy Root must be initialized as a service-account Subject.",
    );
  }
  const levelIds = {
    systemPolicyRoot: authorizationSystemPolicyRootLevelId(input.realmId),
    owner: authorizationOwnerLevelId(input.realmId),
    administrator: `${prefix}:level:administrator`,
    editor: `${prefix}:level:editor`,
    viewer: `${prefix}:level:viewer`,
    public: `${prefix}:level:public`,
  } as const;
  const roleIds = {
    systemPolicyRoot: authorizationSystemPolicyRootRoleId(input.realmId),
    owner: authorizationOwnerRoleId(input.realmId),
    contentAdministrator: `${prefix}:role:content-administrator`,
    securityAdministrator: `${prefix}:role:security-administrator`,
    editor: `${prefix}:role:editor`,
    viewer: `${prefix}:role:viewer`,
    public: `${prefix}:role:public`,
  } as const;
  const publicSubjectId = input.realmId === SYSTEM_AUTHORIZATION_REALM_ID
    ? SYSTEM_PUBLIC_SUBJECT_ID
    : `${prefix}:subject:public`;
  const allPermissions = DEFAULT_PERMISSION_CATALOG.map(({ key }) => key);
  const ownerDelegations = DEFAULT_PERMISSION_CATALOG
    .filter(({ delegatable, protected: isProtected }) => delegatable && isProtected !== true)
    .map(({ key }) => key);
  const contentAdministratorPermissions = uniqueStrings([
    "authorization.read",
    ...CONTENT_PERMISSIONS,
    "schema.read",
    "schema.create",
    "schema.update",
    "schema.apply",
    "schema.export",
    "admin-app.read",
    "admin-app.create",
    "admin-app.update",
    "admin-app.apply",
    "admin-app.delete",
    "admin-app.export",
    "admin-app.access",
    "admin-app.page.read",
    "admin-app.page.unmask",
    "admin-app.action.execute",
    ...ROLE_MANAGEMENT_PERMISSIONS,
    "authority-level.read",
    "identity.read",
    "group.read",
    "media.read",
    "media.upload",
    "media.delete",
    "audit.read",
  ]);
  const contentAdministratorDelegations = uniqueStrings([
    ...CONTENT_PERMISSIONS,
    "schema.read",
    "admin-app.read",
    "admin-app.access",
    "admin-app.page.read",
    "admin-app.page.unmask",
    "admin-app.action.execute",
    "role.read",
    "media.read",
    "media.upload",
    "media.delete",
  ]);
  const securityAdministratorPermissions = uniqueStrings([
    "authorization.read",
    ...IDENTITY_PERMISSIONS,
    ...ROLE_MANAGEMENT_PERMISSIONS,
    "authority-level.read",
    "audit.read",
  ]);
  const securityAdministratorDelegations = uniqueStrings([
    ...IDENTITY_PERMISSIONS,
    "role.read",
  ]);
  const editorPermissions = uniqueStrings([
    ...CONTENT_PERMISSIONS,
    "schema.read",
    "media.read",
    "media.upload",
  ]);
  const viewerPermissions = [
    "content.list",
    "content.read",
    "content.revision.read",
    "schema.read",
    "media.read",
  ] as const;
  const publicPermissions = ["content.list", "content.read", "media.read"] as const;

  const state: AuthorizationPolicySeed = {
    realm: {
      id: input.realmId,
      name: input.realmName,
      rootResourceId: input.rootResourceId,
    },
    subjects: [
      {
        id: input.ownerSubjectId,
        realmId: input.realmId,
        ...(input.ownerIdentityId === undefined ? {} : { identityId: input.ownerIdentityId }),
        name: input.ownerSubjectName,
        type: input.ownerSubjectType ?? "user",
        protected: true,
      },
      {
        id: publicSubjectId,
        realmId: input.realmId,
        name: "Public",
        type: "service-account",
        protected: true,
      },
    ],
    resources: [
      {
        id: input.rootResourceId,
        realmId: input.realmId,
        name: input.rootResourceName,
        type: "workspace",
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "schema"),
        realmId: input.realmId,
        name: "Schema",
        type: "schema",
        parentId: input.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "content"),
        realmId: input.realmId,
        name: "Content",
        type: "content-root",
        parentId: input.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "authorization"),
        realmId: input.realmId,
        name: "Access control",
        type: "authorization",
        parentId: input.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "audit"),
        realmId: input.realmId,
        name: "Audit",
        type: "audit",
        parentId: input.rootResourceId,
        protected: true,
      },
    ],
    authorityLevels: [
      ...(input.ownerIsSystemPolicyRoot === true ? [{
        id: levelIds.systemPolicyRoot,
        realmId: input.realmId,
        name: "System Policy Root",
        rank: 110,
        protected: true,
      }] : []),
      { id: levelIds.owner, realmId: input.realmId, name: "Owner", rank: 100, protected: true },
      { id: levelIds.administrator, realmId: input.realmId, name: "Administrators", rank: 80 },
      { id: levelIds.editor, realmId: input.realmId, name: "Editors", rank: 40 },
      { id: levelIds.viewer, realmId: input.realmId, name: "Viewers", rank: 10 },
      { id: levelIds.public, realmId: input.realmId, name: "Public", rank: 0, protected: true },
    ],
    permissions: DEFAULT_PERMISSION_CATALOG,
    roles: [
      ...(input.ownerIsSystemPolicyRoot === true ? [{
        id: roleIds.systemPolicyRoot,
        realmId: input.realmId,
        levelId: levelIds.systemPolicyRoot,
        name: "System Policy Root",
        permissions: allPermissions,
        delegatablePermissions: ownerDelegations,
        protected: true,
      }] : []),
      {
        id: roleIds.owner,
        realmId: input.realmId,
        levelId: levelIds.owner,
        name: "Owner",
        permissions: allPermissions,
        delegatablePermissions: ownerDelegations,
        protected: true,
      },
      {
        id: roleIds.contentAdministrator,
        realmId: input.realmId,
        levelId: levelIds.administrator,
        name: "Content Administrator",
        permissions: contentAdministratorPermissions,
        delegatablePermissions: contentAdministratorDelegations,
      },
      {
        id: roleIds.securityAdministrator,
        realmId: input.realmId,
        levelId: levelIds.administrator,
        name: "Security Administrator",
        permissions: securityAdministratorPermissions,
        delegatablePermissions: securityAdministratorDelegations,
      },
      {
        id: roleIds.editor,
        realmId: input.realmId,
        levelId: levelIds.editor,
        name: "Editor",
        permissions: editorPermissions,
        delegatablePermissions: [],
      },
      {
        id: roleIds.viewer,
        realmId: input.realmId,
        levelId: levelIds.viewer,
        name: "Viewer",
        permissions: viewerPermissions,
        delegatablePermissions: [],
      },
      {
        id: roleIds.public,
        realmId: input.realmId,
        levelId: levelIds.public,
        name: "Public",
        permissions: publicPermissions,
        delegatablePermissions: [],
        protected: true,
      },
    ],
    bindings: [
      {
        id: input.ownerIsSystemPolicyRoot === true
          ? authorizationSystemPolicyRootBindingId(input.realmId)
          : `${prefix}:binding:owner`,
        realmId: input.realmId,
        subjectId: input.ownerSubjectId,
        roleId: input.ownerIsSystemPolicyRoot === true ? roleIds.systemPolicyRoot : roleIds.owner,
        resourceId: input.rootResourceId,
        propagation: "self-and-children",
        protected: true,
      },
      {
        id: `${prefix}:binding:public`,
        realmId: input.realmId,
        subjectId: publicSubjectId,
        roleId: roleIds.public,
        resourceId: input.rootResourceId,
        propagation: "self-and-children",
        protected: true,
      },
    ],
    groupMemberships: [],
  };
  createKernelSnapshot({ ...state, revision: 0 });
  return deepFreezePolicySeed(state);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function deepFreezePolicySeed(state: AuthorizationPolicySeed): AuthorizationPolicySeed {
  const freezeArray = <T>(values: readonly T[]): readonly T[] => Object.freeze([...values]);
  return Object.freeze({
    realm: Object.freeze({ ...state.realm }),
    subjects: freezeArray(state.subjects.map((subject) => Object.freeze({ ...subject }))),
    resources: freezeArray(state.resources.map((resource) => Object.freeze({ ...resource }))),
    authorityLevels: freezeArray(state.authorityLevels.map((level) => Object.freeze({ ...level }))),
    permissions: freezeArray(state.permissions.map((permission) => Object.freeze({ ...permission }))),
    roles: freezeArray(state.roles.map((role) => Object.freeze({
      ...role,
      permissions: freezeArray(role.permissions),
      delegatablePermissions: freezeArray(role.delegatablePermissions),
      ...(role.fieldAccess === undefined ? {} : {
        fieldAccess: freezeArray(role.fieldAccess.map((rule) => Object.freeze({
          ...rule,
          readableFields: freezeArray(rule.readableFields),
          writableFields: freezeArray(rule.writableFields),
        }))),
      }),
    }))),
    bindings: freezeArray(state.bindings.map((binding) => Object.freeze({
      ...binding,
      ...(binding.constraints === undefined ? {} : {
        constraints: Object.freeze({
          ...binding.constraints,
          ...(binding.constraints.statuses === undefined
            ? {}
            : { statuses: freezeArray(binding.constraints.statuses) }),
        }),
      }),
    }))),
    groupMemberships: freezeArray(
      state.groupMemberships.map((membership) => Object.freeze({ ...membership })),
    ),
  });
}
