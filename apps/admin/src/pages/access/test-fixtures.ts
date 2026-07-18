import type { AuthorizationPolicy, AuthorizationRole, AuthorizationRoleBinding } from "@xecms/admin";

export function seedPolicy(overrides?: Partial<AuthorizationPolicy>): AuthorizationPolicy {
  const role = (partial: Partial<AuthorizationRole> & Pick<AuthorizationRole, "id" | "levelId" | "name">): AuthorizationRole => ({
    realmId: "system",
    permissions: ["content.read"],
    delegatablePermissions: [],
    fieldAccess: [],
    protected: false,
    ...partial,
  });
  const binding = (partial: Partial<AuthorizationRoleBinding> & Pick<AuthorizationRoleBinding, "id" | "subjectId" | "roleId">): AuthorizationRoleBinding => ({
    realmId: "system",
    resourceId: "root",
    propagation: "self-and-children",
    protected: false,
    ...partial,
  });
  return {
    realmId: "system",
    revision: 7,
    subjects: [
      { id: "subject-owner", realmId: "system", type: "user", name: "Owner", protected: true, disabled: false },
      { id: "subject-editor", realmId: "system", type: "user", name: "Editor Kim", protected: false, disabled: false },
      { id: "subject-new", realmId: "system", type: "user", name: "Newbie", protected: false, disabled: false },
      { id: "subject-grouped", realmId: "system", type: "user", name: "Grouped", protected: false, disabled: false },
      { id: "group-writers", realmId: "system", type: "group", name: "Writers", protected: false, disabled: false },
      { id: "group-parent", realmId: "system", type: "group", name: "Parent Group", protected: false, disabled: false },
    ],
    groupMemberships: [
      { memberSubjectId: "subject-grouped", groupSubjectId: "group-writers" },
      { memberSubjectId: "group-writers", groupSubjectId: "group-parent" },
    ],
    resources: [
      { id: "root", realmId: "system", type: "workspace", name: "Workspace", protected: true },
      { id: "content", realmId: "system", type: "section", name: "Content", parentId: "root", protected: true },
    ],
    levels: [
      { id: "level-owner", realmId: "system", name: "Owner", rank: 100, protected: true },
      { id: "level-admin", realmId: "system", name: "Administrators", rank: 80, protected: false },
      { id: "level-editor", realmId: "system", name: "Editors", rank: 40, protected: false },
      { id: "level-viewer", realmId: "system", name: "Viewers", rank: 10, protected: false },
      { id: "level-public", realmId: "system", name: "Public", rank: 0, protected: true },
    ],
    permissions: [
      { key: "content.read", label: "콘텐츠 조회", category: "content", hierarchyGuard: "none", delegatable: true, protected: false },
      { key: "content.update", label: "콘텐츠 수정", category: "content", hierarchyGuard: "none", delegatable: true, protected: false },
      { key: "content.publish", label: "콘텐츠 게시", category: "content", hierarchyGuard: "none", delegatable: true, protected: false },
    ],
    roles: [
      role({ id: "role-owner", levelId: "level-owner", name: "Workspace Owner", protected: true }),
      role({ id: "role-content-admin", levelId: "level-admin", name: "Content Administrator", permissions: ["content.read", "content.update"] }),
      role({ id: "role-security-admin", levelId: "level-admin", name: "Security Administrator", permissions: ["content.publish"] }),
      role({
        id: "role-editor",
        levelId: "level-editor",
        name: "Editors",
        description: "콘텐츠 담당",
        permissions: ["content.read", "content.update", "content.publish"],
        delegatablePermissions: ["content.update", "content.publish"],
        fieldAccess: [{ resourceId: "content", readableFields: ["title"], writableFields: [] }],
      }),
      role({ id: "role-viewer", levelId: "level-viewer", name: "Viewers" }),
      role({ id: "role-public", levelId: "level-public", name: "Public", protected: true }),
    ],
    bindings: [
      binding({ id: "binding-owner", subjectId: "subject-owner", roleId: "role-owner", protected: true }),
      binding({ id: "binding-editor", subjectId: "subject-editor", roleId: "role-editor" }),
      binding({ id: "binding-group", subjectId: "group-parent", roleId: "role-viewer" }),
    ],
    ...overrides,
  };
}
