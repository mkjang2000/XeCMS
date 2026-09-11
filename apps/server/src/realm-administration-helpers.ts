import {
  ApplicationError,
  AuthorizationApplicationService,
  type ManagedIdentity,
  type AuthorizationActor,
  type ActorContext,
  type DocumentRecord,
} from "@xecms/application";
import { type FastifyRequest } from "fastify";
import { type CrossRealmManagedTarget } from "./identity-realm-routes.js";

export function authorizationRealmIdFromRequest(request: FastifyRequest): string {
  const params = request.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new ApplicationError("REQUEST_PATH_INVALID", 400, "realmId is required.");
  }
  const realmId = (params as Readonly<Record<string, unknown>>)["realmId"];
  if (typeof realmId !== "string" || realmId.length === 0) {
    throw new ApplicationError("REQUEST_PATH_INVALID", 400, "realmId is required.");
  }
  return realmId;
}

export function isRealmAdministrationReadOperation(request: FastifyRequest): boolean {
  const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
  return request.method === "GET"
    || request.method === "HEAD"
    || route.endsWith("/simulate");
}

export function isIndividuallyAuditedRealmAdministrationRead(request: FastifyRequest): boolean {
  const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
  return route.endsWith("/audit") || route.endsWith("/simulate");
}

export async function requireLocalRealmAdministrationRouteAccess(
  authorization: AuthorizationApplicationService,
  actor: AuthorizationActor,
  request: FastifyRequest,
): Promise<void> {
  const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
  if (route.endsWith("/policy") || route.endsWith("/simulate")) {
    await authorization.getPolicy(actor);
    return;
  }
  // Role and Binding mutations need target hierarchy/rank context that is only
  // available inside the application command.  A root-only preflight would
  // incorrectly reject valid assignments with HIERARCHY_CONTEXT_REQUIRED.
  if (route.includes("/roles") || route.includes("/bindings")) {
    await authorization.getPolicy(actor);
    return;
  }
  const rootResourceId = `authorization:${actor.realmId}:resource:workspace`;
  if (route.endsWith("/audit")) {
    await authorization.require(actor, { action: "audit.read", resourceId: rootResourceId });
    return;
  }
  let action: string;
  if (route.includes("/levels") || route.includes("/subjects") || route.includes("/group-memberships")) {
    action = "authorization.manage";
  } else {
    action = "authorization.manage";
  }
  await authorization.require(actor, { action, resourceId: rootResourceId });
}

export function accountProfileActor(actor: ActorContext): ActorContext {
  return {
    subjectId: actor.subjectId,
    ...(actor.identityId === undefined ? {} : { identityId: actor.identityId }),
    workspaceId: actor.workspaceId,
    ...(actor.realmId === undefined ? {} : { realmId: actor.realmId }),
    capabilities: ["document:read", "document:update"],
  };
}

export function assertOwnRealmProfile(
  document: Pick<DocumentRecord, "collectionId" | "ownerSubjectId">,
  subjectId: string,
  collectionId: string,
): void {
  if (document.collectionId !== collectionId || document.ownerSubjectId !== subjectId) {
    throw new ApplicationError(
      "REALM_PROFILE_OWNERSHIP_MISMATCH",
      403,
      "The Profile Document does not belong to this Realm Membership.",
    );
  }
}

/** Projects a managed identity onto the minimal shape entry point B needs. */
export function toCrossRealmTarget(identity: ManagedIdentity): CrossRealmManagedTarget {
  return {
    identityId: identity.id,
    primaryIdentifier: identity.primaryIdentifier,
    revision: identity.revision,
    disabled: identity.status === "disabled",
    memberships: identity.memberships.map((m) => ({
      realmId: m.realmId,
      realmKind: m.realmKind,
      status: m.status,
    })),
  };
}
