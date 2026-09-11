import {
  ApplicationError,
  AuthorizationApplicationService,
  AuthApplicationService,
  IdentityAdministrationService,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_PUBLIC_SUBJECT_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  type AuthorizationActor,
  type ActorContext,
  type AuthenticatedSession,
} from "@xecms/application";
import type { AuthenticatedSessionDto } from "@xecms/contracts";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "@xecms/database";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { type ServerConfig } from "./config.js";

export const SESSION_COOKIE = "xecms_session";

export type RequestActorResolver = (
  request: FastifyRequest,
  requireCsrf: boolean,
) => ReturnType<typeof requireActorBase>;

export async function requireActorBase(
  request: FastifyRequest,
  auth: AuthApplicationService,
  authorization: AuthorizationApplicationService,
  identityAdministration: IdentityAdministrationService,
  config: ServerConfig,
  requireCsrf: boolean,
): Promise<{ readonly actor: ActorContext; readonly sessionToken: string }> {
  const authorizationHeader = request.headers.authorization;
  if (authorizationHeader?.startsWith("Bearer ")) {
    if (request.headers.cookie !== undefined || request.headers["x-csrf-token"] !== undefined) {
      throw new ApplicationError("API_KEY_AUTHENTICATION_MIXED", 400, "Bearer API key authentication cannot be mixed with cookies or CSRF tokens.");
    }
    const rawKey = authorizationHeader.slice("Bearer ".length).trim();
    const apiKey = await identityAdministration.authenticateApiKey(rawKey);
    if (apiKey === null) {
      throw new ApplicationError("API_KEY_INVALID", 401, "The API key is invalid or inactive.");
    }
    const policyActor = authorizationActor(apiKey.subjectId);
    return {
      actor: {
        subjectId: apiKey.subjectId,
        identityId: apiKey.identityId,
        workspaceId: apiKey.workspaceId,
        realmId: SYSTEM_AUTHORIZATION_REALM_ID,
        capabilities: [],
        authorization: authorizationGateway(authorization, policyActor, apiKey.scopes),
        authentication: "api-key",
      },
      sessionToken: rawKey,
    };
  }
  const authenticated = await requireSession(request, auth, config, requireCsrf);
  if (
    requireCsrf &&
    authenticated.session.identity.passwordChangeRequired &&
    request.url.split("?", 1)[0] !== "/api/credentials/password"
  ) {
    throw new ApplicationError(
      "PASSWORD_CHANGE_REQUIRED",
      403,
      "The temporary password must be changed before performing Admin mutations.",
    );
  }
  return {
    actor: {
      subjectId: authenticated.session.identity.id,
      identityId: authenticated.session.identity.id,
      workspaceId: authenticated.session.identity.workspaceId,
      realmId: SYSTEM_AUTHORIZATION_REALM_ID,
      capabilities: authenticated.session.capabilities,
      authorization: authorizationGateway(
        authorization,
        authorizationActor(authenticated.session.identity.id),
      ),
      authentication: "session",
    },
    sessionToken: authenticated.sessionToken,
  };
}

export function authorizationActor(subjectId: string): AuthorizationActor {
  return { subjectId, realmId: SYSTEM_AUTHORIZATION_REALM_ID };
}

export function authorizationGateway(
  authorization: AuthorizationApplicationService,
  actor: AuthorizationActor,
  apiKeyScopes?: readonly string[],
): NonNullable<ActorContext["authorization"]> {
  const requireScope = (action: string): void => {
    if (apiKeyScopes !== undefined && !apiKeyScopes.includes(action)) {
      throw new ApplicationError("API_KEY_SCOPE_DENIED", 403, `The API key scope does not include '${action}'.`);
    }
  };
  return {
    require: async (input) => {
      requireScope(input.action);
      await authorization.require(actor, input);
    },
    filterReadableData: (input) => {
      requireScope(input.action ?? "content.read");
      return authorization.filterReadableData(actor, input);
    },
    assertWritableData: (input) => {
      requireScope(input.action ?? "content.update");
      return authorization.assertWritableData(actor, input);
    },
  };
}

export function publicActor(authorization: AuthorizationApplicationService): ActorContext {
  const policyActor = authorizationActor(SYSTEM_PUBLIC_SUBJECT_ID);
  return {
    subjectId: SYSTEM_PUBLIC_SUBJECT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    capabilities: [],
    authorization: authorizationGateway(authorization, policyActor),
  };
}

export async function requireSession(
  request: FastifyRequest,
  auth: AuthApplicationService,
  config: ServerConfig,
  requireCsrf: boolean,
): Promise<{
  readonly sessionToken: string;
  readonly session: Awaited<ReturnType<AuthApplicationService["authenticate"]>>;
}> {
  const sessionToken = request.cookies[SESSION_COOKIE];
  if (sessionToken === undefined) {
    throw new ApplicationError("SESSION_REQUIRED", 401, "An authenticated session is required.");
  }
  const session = await auth.authenticate({ sessionToken });
  if (requireCsrf) {
    assertAllowedOrigin(request, config);
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string") {
      throw new ApplicationError("CSRF_TOKEN_REQUIRED", 403, "X-CSRF-Token is required.");
    }
    await auth.assertCsrfToken(sessionToken, csrf);
  }
  return { sessionToken, session };
}

export function assertAllowedOrigin(request: FastifyRequest, config: ServerConfig): void {
  if (config.disableAdminOrigins) return;
  assertAllowedRequestOrigin(request, config.adminOrigins);
}

export function assertAllowedContentOrigin(request: FastifyRequest, config: ServerConfig): void {
  assertAllowedRequestOrigin(request, config.contentOrigins);
}

export function assertAllowedRequestOrigin(
  request: FastifyRequest,
  allowedOrigins: readonly string[],
): void {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return;
  }
  const host = request.headers.host;
  const requestOrigin = host === undefined ? null : `${request.protocol}://${host}`;
  if (origin !== requestOrigin && !allowedOrigins.includes(origin)) {
    throw new ApplicationError("ORIGIN_NOT_ALLOWED", 403, "The request origin is not allowed.");
  }
}

export function setSessionCookie(
  reply: FastifyReply,
  config: ServerConfig,
  sessionToken: string,
  expiresAt: string,
): void {
  reply.setCookie(SESSION_COOKIE, sessionToken, {
    path: "/",
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
  });
}

export function sessionDto(
  session: AuthenticatedSession,
  active: { readonly revisionId: string } | null,
): AuthenticatedSessionDto {
  return {
    user: { id: session.identity.id, username: session.identity.username },
    passwordChangeRequired: session.identity.passwordChangeRequired,
    csrfToken: session.csrfToken,
    workspace: { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME },
    capabilities: session.capabilities,
    schema: { revisionId: active?.revisionId ?? null },
    expiresAt: session.expiresAt,
  };
}

export async function requirePolicyPermission(actor: ActorContext, action: string): Promise<void> {
  if (actor.authorization === undefined) {
    throw new ApplicationError("ACCESS_DENIED", 403, `The '${action}' permission is required.`);
  }
  await actor.authorization.require({ action, resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
}
