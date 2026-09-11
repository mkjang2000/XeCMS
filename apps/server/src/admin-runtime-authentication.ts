import {
  ApplicationError,
  AuthorizationApplicationService,
  AuthApplicationService,
  ContentRealmAuthenticationService,
  SYSTEM_AUTHORIZATION_REALM_ID,
} from "@xecms/application";
import { DEFAULT_WORKSPACE_ID, PostgresIdentityRealmStore } from "@xecms/database";
import { type ServerConfig } from "./config.js";
import { contentRealmRuntimeCookieName } from "./identity-realm-routes.js";
import type { registerAdminAppRuntimeRoutes } from "./admin-app-runtime-routes.js";
import {
  authorizationActor,
  authorizationGateway,
  requireSession,
  assertAllowedContentOrigin,
  SESSION_COOKIE,
} from "./request-authentication.js";

interface Options {
  readonly auth: AuthApplicationService;
  readonly config: ServerConfig;
  readonly authorization: AuthorizationApplicationService;
  readonly identityRealmStore: PostgresIdentityRealmStore;
  readonly contentRealmAuthentication: ContentRealmAuthenticationService;
}

export function createAdminRuntimeAuthenticator(options: Options): Parameters<typeof registerAdminAppRuntimeRoutes>[0]["authenticate"] {
  const { auth, config, authorization, identityRealmStore, contentRealmAuthentication } = options;
  return async (request, audience, requireCsrf) => {
    if (audience.type === "system") {
      if (request.cookies[SESSION_COOKIE] === undefined) {
        throw new ApplicationError(
          "ADMIN_APP_RUNTIME_SESSION_REQUIRED",
          401,
          "A System Realm session is required for this Admin App.",
          { details: { audience: { type: "system" } } },
        );
      }
      const authenticated = await requireSession(request, auth, config, requireCsrf);
      const identity = authenticated.session.identity;
      const policyActor = authorizationActor(identity.id);
      return {
        audienceHint: { type: "system" },
        actor: {
          subjectId: identity.id,
          identityId: identity.id,
          workspaceId: identity.workspaceId,
          realmId: SYSTEM_AUTHORIZATION_REALM_ID,
          capabilities: authenticated.session.capabilities,
          authorization: authorizationGateway(authorization, policyActor),
          authentication: "session",
        },
        user: {
          identityId: identity.id,
          subjectId: identity.id,
          displayName: identity.username,
          realmId: SYSTEM_AUTHORIZATION_REALM_ID,
        },
      };
    }
    const realm = await identityRealmStore.getRealmById(audience.realmId);
    if (
      realm === null || realm.workspaceId !== DEFAULT_WORKSPACE_ID
      || realm.kind !== "content" || realm.status !== "active"
    ) {
      throw new ApplicationError(
        "ADMIN_APP_AUDIENCE_UNAVAILABLE",
        503,
        "The Admin App audience Realm is unavailable.",
      );
    }
    const sessionToken = request.cookies[contentRealmRuntimeCookieName(realm.key)];
    if (sessionToken === undefined) {
      throw new ApplicationError(
        "ADMIN_APP_RUNTIME_SESSION_REQUIRED",
        401,
        "An authenticated Content Realm session is required.",
        { details: { audience: { type: "content-realm", realmId: realm.id, realmKey: realm.key, name: realm.name } } },
      );
    }
    const session = await contentRealmAuthentication.authenticate({
      realmKey: realm.key,
      sessionToken,
    });
    if (requireCsrf) {
      await assertAllowedContentOrigin(request, config);
      const csrfToken = request.headers["x-csrf-token"];
      if (typeof csrfToken !== "string") {
        throw new ApplicationError("CSRF_TOKEN_REQUIRED", 403, "X-CSRF-Token is required.");
      }
      await contentRealmAuthentication.assertCsrfToken({
        realmKey: realm.key,
        sessionToken,
        csrfToken,
      });
    }
    const policyActor = { realmId: realm.id, subjectId: session.membership.subjectId };
    return {
      audienceHint: {
        type: "content-realm",
        realmId: realm.id,
        realmKey: realm.key,
        name: realm.name,
      },
      actor: {
        subjectId: session.membership.subjectId,
        identityId: session.identity.id,
        workspaceId: realm.workspaceId,
        realmId: realm.id,
        capabilities: [],
        authorization: authorizationGateway(authorization, policyActor),
        authentication: "session",
      },
      user: {
        identityId: session.identity.id,
        subjectId: session.membership.subjectId,
        displayName: session.identity.primaryIdentifier,
        realmId: realm.id,
        realmKey: realm.key,
      },
    };
  };
}
