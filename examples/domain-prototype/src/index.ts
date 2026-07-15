import {
  asAuthorityLevelId,
  asPermissionKey,
  asRealmId,
  asResourceId,
  asRoleBindingId,
  asRoleId,
  asSubjectId as asAuthorizationSubjectId,
  authorizeRoleAssignment,
  createPolicySnapshot,
} from "@xecms/authorization";
import {
  asCollectionId as asDocumentCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  createDocument,
  createDraft,
  getDisplayState,
  publishDocument,
  type JsonObject,
} from "@xecms/core";
import {
  asCollectionId,
  asFieldId,
  assertValidSchema,
  diffSchemas,
  type SchemaIrV1,
} from "@xecms/schema";

const schemaV1: SchemaIrV1 = {
  format: "xecms.schema",
  formatVersion: 1,
  collections: [
    {
      id: asCollectionId("col_posts"),
      name: "posts",
      fields: [
        {
          id: asFieldId("fld_title"),
          name: "title",
          type: "text",
          required: true,
        },
      ],
    },
  ],
};

const schemaV2: SchemaIrV1 = {
  ...schemaV1,
  collections: [
    {
      ...schemaV1.collections[0]!,
      fields: [
        {
          ...schemaV1.collections[0]!.fields[0]!,
          name: "headline",
        },
      ],
    },
  ],
};

assertValidSchema(schemaV1);
assertValidSchema(schemaV2);

const author = asSubjectId("subject_author");
const created = createDocument<JsonObject>({
  documentId: asDocumentId("doc_welcome"),
  workspaceId: asWorkspaceId("workspace_main"),
  collectionId: asDocumentCollectionId("col_posts"),
  revisionId: asRevisionId("rev_1"),
  schemaRevisionId: asSchemaRevisionId("schema_rev_1"),
  data: { title: "Welcome to XeCMS" },
  actorId: author,
  now: asUtcInstant("2026-07-14T00:00:00Z"),
}).state;
const published = publishDocument(created, {
  actorId: author,
  now: asUtcInstant("2026-07-14T00:10:00Z"),
  expectedVersion: 1,
}).state;
const edited = createDraft(published, {
  revisionId: asRevisionId("rev_2"),
  schemaRevisionId: asSchemaRevisionId("schema_rev_2"),
  data: { headline: "XeCMS domain prototype" },
  actorId: author,
  now: asUtcInstant("2026-07-14T00:20:00Z"),
  expectedVersion: 2,
}).state;

const realmId = asRealmId("realm_system");
const rootResourceId = asResourceId("resource_root");
const siteResourceId = asResourceId("resource_site");
const adminSubjectId = asAuthorizationSubjectId("subject_admin");
const editorSubjectId = asAuthorizationSubjectId("subject_editor");
const adminLevelId = asAuthorityLevelId("level_admin");
const editorLevelId = asAuthorityLevelId("level_editor");
const adminRoleId = asRoleId("role_content_admin");
const editorRoleId = asRoleId("role_editor");
const contentUpdate = asPermissionKey("content.update");
const roleAssign = asPermissionKey("role.assign");

const policy = createPolicySnapshot({
  realms: [{ id: realmId, rootResourceId }],
  subjects: [
    { id: adminSubjectId, realmId, type: "user" },
    { id: editorSubjectId, realmId, type: "user" },
  ],
  resources: [
    { id: rootResourceId, realmId },
    { id: siteResourceId, realmId, parentId: rootResourceId },
  ],
  authorityLevels: [
    { id: adminLevelId, realmId, name: "Administrator", rank: 80 },
    { id: editorLevelId, realmId, name: "Editor", rank: 40 },
  ],
  permissions: [
    { key: contentUpdate, hierarchyGuard: "none", delegatable: true },
    { key: roleAssign, hierarchyGuard: "target-binding", delegatable: false },
  ],
  roles: [
    {
      id: adminRoleId,
      realmId,
      levelId: adminLevelId,
      name: "Content Administrator",
      permissions: [contentUpdate, roleAssign],
      delegatablePermissions: [contentUpdate],
    },
    {
      id: editorRoleId,
      realmId,
      levelId: editorLevelId,
      name: "Editor",
      permissions: [contentUpdate],
      delegatablePermissions: [],
    },
  ],
  bindings: [
    {
      id: asRoleBindingId("binding_admin"),
      realmId,
      subjectId: adminSubjectId,
      roleId: adminRoleId,
      scope: { resourceId: siteResourceId, propagation: "self-and-children" },
    },
  ],
});

const roleAssignment = authorizeRoleAssignment(policy, {
  actorSubjectId: adminSubjectId,
  targetSubjectId: editorSubjectId,
  roleId: editorRoleId,
  scope: { resourceId: siteResourceId, propagation: "self" },
  action: roleAssign,
  now: "2026-07-14T00:30:00Z",
});

console.log(
  JSON.stringify(
    {
      schemaChanges: diffSchemas(schemaV1, schemaV2),
      document: {
        id: edited.identity.id,
        state: getDisplayState(edited),
        publishedRevisionId: edited.identity.publication?.revisionId,
        draftRevisionId: edited.identity.currentDraftRevisionId,
      },
      roleAssignment,
    },
    null,
    2,
  ),
);
