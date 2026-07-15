export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  session: ["session"] as const,
  collections: ["collections"] as const,
  schemaManifest: ["schema", "manifest"] as const,
  schemaTypes: ["schema", "types"] as const,
  media: ["media"] as const,
  collectionDraft: (collectionId: string) => ["collections", collectionId, "draft"] as const,
  collectionApplied: (collectionId: string) => ["collections", collectionId, "applied"] as const,
  migration: (collectionId: string, draftVersion: string) =>
    ["collections", collectionId, "migration", draftVersion] as const,
  documentsRoot: (collectionId: string) => ["documents", collectionId] as const,
  documentTree: (collectionId: string) => ["documents", collectionId, "tree"] as const,
  relationOptions: (collectionIds: readonly string[]) => ["documents", "relation-options", ...collectionIds] as const,
  documents: (collectionId: string, page: number, state: "active" | "deleted" = "active") =>
    ["documents", collectionId, "state", state, "page", page] as const,
  document: (collectionId: string, documentId: string) =>
    ["documents", collectionId, documentId] as const,
  revisionsRoot: (collectionId: string, documentId: string) =>
    ["documents", collectionId, documentId, "revisions"] as const,
  revisions: (collectionId: string, documentId: string) =>
    ["documents", collectionId, documentId, "revisions", "list"] as const,
  revision: (collectionId: string, documentId: string, revisionId: string) =>
    ["documents", collectionId, documentId, "revisions", revisionId] as const,
  authorization: ["authorization", "system", "policy"] as const,
  authorizationAudit: ["authorization", "system", "audit"] as const,
  realmAuthorization: (realmId: string) => ["authorization", "realm", realmId, "policy"] as const,
  realmAuthorizationAudit: (realmId: string) => ["authorization", "realm", realmId, "audit"] as const,
  globalIdentities: ["identity-realms", "global-identities"] as const,
  identityRealms: ["identity-realms", "list"] as const,
  identityRealm: (realmId: string) => ["identity-realms", realmId, "detail"] as const,
  realmMemberships: (realmId: string) => ["identity-realms", realmId, "memberships"] as const,
  realmFullAccess: (realmId: string) => ["identity-realms", realmId, "full-access"] as const,
  jobs: (page: number, status: string, topic: string, handlerId: string) =>
    ["jobs", "list", page, status, topic, handlerId] as const,
};
