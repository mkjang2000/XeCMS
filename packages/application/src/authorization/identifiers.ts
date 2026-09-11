import { validateIdentifier } from "./validation.js";

export const AUTHORIZATION_MANAGE_PERMISSION = "authorization.manage";

export const SYSTEM_AUTHORIZATION_REALM_ID = "rlm_system";

export const SYSTEM_WORKSPACE_RESOURCE_ID = "resource:workspace";

export const SYSTEM_SCHEMA_RESOURCE_ID = "resource:schema";

export const SYSTEM_CONTENT_RESOURCE_ID = "resource:content";

export const SYSTEM_AUTHORIZATION_RESOURCE_ID = "resource:authorization";

export const SYSTEM_AUDIT_RESOURCE_ID = "resource:audit";

export const SYSTEM_PUBLIC_SUBJECT_ID = "subject:public";

export function authorizationOwnerLevelId(realmId: string): string {
  return `authorization:${realmId}:level:owner`;
}

export function authorizationOwnerRoleId(realmId: string): string {
  return `authorization:${realmId}:role:owner`;
}

export function authorizationPrimaryOwnerBindingId(realmId: string): string {
  return `authorization:${realmId}:binding:primary-owner`;
}

export function authorizationSystemPolicyRootLevelId(realmId: string): string {
  return `authorization:${realmId}:level:system-policy-root`;
}

export function authorizationSystemPolicyRootRoleId(realmId: string): string {
  return `authorization:${realmId}:role:system-policy-root`;
}

export function authorizationSystemPolicyRootBindingId(realmId: string): string {
  return `authorization:${realmId}:binding:system-policy-root`;
}

export function collectionResourceId(collectionId: string): string {
  validateIdentifier(collectionId, "collectionId");
  return `resource:collection:${collectionId}`;
}

export function documentResourceId(documentId: string): string {
  validateIdentifier(documentId, "documentId");
  return `resource:document:${documentId}`;
}

/**
 * Realm-aware collection projection ID. System Realm keeps its M3 identifier
 * for backwards compatibility; every other realm gets an isolated namespace.
 */
export function realmCollectionResourceId(realmId: string, collectionId: string): string {
  validateIdentifier(realmId, "realmId");
  validateIdentifier(collectionId, "collectionId");
  return `${realmCollectionResourcePrefix(realmId)}${collectionId}`;
}

/**
 * Realm-aware document projection ID. System Realm keeps its M3 identifier
 * for backwards compatibility; every other realm gets an isolated namespace.
 */
export function realmDocumentResourceId(realmId: string, documentId: string): string {
  validateIdentifier(realmId, "realmId");
  validateIdentifier(documentId, "documentId");
  return `${realmDocumentResourcePrefix(realmId)}${documentId}`;
}

/** @deprecated Use realmCollectionResourceId. Kept for early M3 adapters. */
export function collectionAuthorizationResourceId(realmId: string, collectionId: string): string {
  return realmCollectionResourceId(realmId, collectionId);
}

export function realmCollectionResourcePrefix(realmId: string): string {
  return realmId === SYSTEM_AUTHORIZATION_REALM_ID
    ? "resource:collection:"
    : `authorization:${realmId}:resource:collection:`;
}

export function realmDocumentResourcePrefix(realmId: string): string {
  return realmId === SYSTEM_AUTHORIZATION_REALM_ID
    ? "resource:document:"
    : `authorization:${realmId}:resource:document:`;
}

export function projectionQuarantineKey(realmId: string, resourceId: string): string {
  return `${realmId}\u0000${resourceId}`;
}

export function coreResourceId(
  realmId: string,
  kind: "schema" | "content" | "authorization" | "audit",
): string {
  if (realmId === SYSTEM_AUTHORIZATION_REALM_ID) {
    switch (kind) {
      case "schema": return SYSTEM_SCHEMA_RESOURCE_ID;
      case "content": return SYSTEM_CONTENT_RESOURCE_ID;
      case "authorization": return SYSTEM_AUTHORIZATION_RESOURCE_ID;
      case "audit": return SYSTEM_AUDIT_RESOURCE_ID;
    }
  }
  return `authorization:${realmId}:resource:${kind}`;
}
