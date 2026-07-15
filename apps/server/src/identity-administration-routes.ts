import {
  ApplicationError,
  SYSTEM_ACTOR_REALM_ID,
  SYSTEM_AUTHORIZATION_RESOURCE_ID,
  type ActorContext,
  type ApiKeyRecord,
  type CreatedApiKey,
  type AuthorizationActor,
  type AuthorizationApplicationService,
  type IdentityAdministrationService,
  type ManagedIdentity,
  type ManagedIdentityKind,
  type ManagedIdentityStatus,
  type ManagedSession,
  type CredentialTokenPurpose,
} from "@xecms/application";
import type {
  CreateManagedIdentityRequest,
  CreateApiKeyRequest,
  CreateServiceIdentityRequest,
  ApiKeyDto,
  ApiKeyListDto,
  CreatedApiKeyDto,
  ManagedIdentityDto,
  ManagedIdentityListDto,
  ManagedIdentityRevisionRequest,
  ManagedSessionDto,
  ManagedSessionListDto,
  ResetManagedIdentityCredentialsRequest,
  SessionRevocationResultDto,
  TransferOwnerRequest,
  UpdateManagedIdentityRequest,
  ChangeOwnPasswordRequest,
  CompleteCredentialTokenRequest,
  CreateCredentialTokenRequest,
  CreatedCredentialTokenDto,
} from "@xecms/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { LoginRateLimiter } from "./rate-limit.js";

export function registerIdentityAdministrationRoutes(options: {
  readonly app: FastifyInstance;
  readonly identities: IdentityAdministrationService;
  readonly authorization: AuthorizationApplicationService;
  readonly requireActor: (
    request: FastifyRequest,
    requireCsrf: boolean,
  ) => Promise<ActorContext>;
  readonly currentSessionId: (request: FastifyRequest) => Promise<string>;
  readonly verifySystemReauthentication: (
    request: FastifyRequest,
    actor: ActorContext,
    password: string,
  ) => Promise<void>;
}): void {
  const credentialTokenLimiter = new LoginRateLimiter(5, 15 * 60 * 1000);
  const actorFor = async (request: FastifyRequest, mutate: boolean): Promise<ActorContext> => {
    const actor = await options.requireActor(request, mutate);
    if ((actor.realmId ?? SYSTEM_ACTOR_REALM_ID) !== SYSTEM_ACTOR_REALM_ID) {
      throw new ApplicationError(
        "IDENTITY_ADMIN_AUDIENCE_MISMATCH",
        403,
        "Identity administration requires a System Realm session.",
      );
    }
    if (actor.authentication === "api-key") {
      throw new ApplicationError("API_KEY_ADMINISTRATION_FORBIDDEN", 403, "API keys cannot administer Identities or credentials.");
    }
    return actor;
  };
  const authorizationActor = (actor: ActorContext): AuthorizationActor => ({
    realmId: SYSTEM_ACTOR_REALM_ID,
    subjectId: actor.subjectId,
  });
  const requireRead = async (actor: ActorContext): Promise<void> => {
    await options.authorization.require(authorizationActor(actor), {
      action: "identity.read",
      resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
    });
  };
  const requireTargetMutation = async (
    actor: ActorContext,
    identity: ManagedIdentity,
    action: "identity.invite" | "identity.update" | "identity.disable" | "identity.credentials.reset" | "identity.session.revoke" | "identity.owner.transfer",
  ): Promise<void> => {
    const target = identity.memberships.find(({ realmKind, status }) =>
      realmKind === "system" && status === "active"
    );
    if (target === undefined) {
      // Content-only identities do not have a System hierarchy rank. Their
      // global lifecycle is therefore restricted to the protected policy root.
      await options.authorization.require(authorizationActor(actor), {
        action: "authorization.manage",
        resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
      });
      return;
    }
    await options.authorization.requireSubjectManagement(authorizationActor(actor), {
      action,
      targetSubjectId: target.subjectId,
    });
  };

  options.app.get("/api/identities", async (request): Promise<ManagedIdentityListDto> => {
    const actor = await actorFor(request, false);
    await requireRead(actor);
    const query = parseListQuery(request.query);
    const page = await options.identities.list({ workspaceId: actor.workspaceId, ...query });
    return {
      items: page.items.map(toDto),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  });

  options.app.post("/api/identities", async (request, reply): Promise<ManagedIdentityDto> => {
    const actor = await actorFor(request, true);
    await options.authorization.require(authorizationActor(actor), {
      action: "identity.invite",
      resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
    });
    const body = parseCreate(request.body);
    const identity = await options.identities.createHuman({
      workspaceId: actor.workspaceId,
      primaryIdentifier: body.primaryIdentifier,
      temporaryPassword: body.temporaryPassword,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      actorSubjectId: actor.subjectId,
    });
    reply.code(201);
    return toDto(identity);
  });

  options.app.get("/api/identities/:identityId", async (request): Promise<ManagedIdentityDto> => {
    const actor = await actorFor(request, false);
    await requireRead(actor);
    return toDto(await options.identities.get(identityId(request.params), actor.workspaceId));
  });

  options.app.patch("/api/identities/:identityId", async (request): Promise<ManagedIdentityDto> => {
    const actor = await actorFor(request, true);
    const id = identityId(request.params);
    const before = await options.identities.get(id, actor.workspaceId);
    await requireTargetMutation(actor, before, "identity.update");
    const body = parseUpdate(request.body);
    return toDto(await options.identities.updateIdentifier({
      identityId: id,
      workspaceId: actor.workspaceId,
      expectedRevision: body.expectedRevision,
      primaryIdentifier: body.primaryIdentifier,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      actorSubjectId: actor.subjectId,
    }));
  });

  for (const disabled of [true, false] as const) {
    options.app.post(
      `/api/identities/:identityId/${disabled ? "disable" : "reactivate"}`,
      async (request): Promise<ManagedIdentityDto> => {
        const actor = await actorFor(request, true);
        const id = identityId(request.params);
        const before = await options.identities.get(id, actor.workspaceId);
        await requireTargetMutation(actor, before, "identity.disable");
        const body = parseRevision(request.body);
        return toDto(await options.identities.setDisabled({
          identityId: id,
          workspaceId: actor.workspaceId,
          expectedRevision: body.expectedRevision,
          disabled,
          actorIdentityId: actor.identityId ?? actor.subjectId,
          actorSubjectId: actor.subjectId,
        }));
      },
    );
  }

  options.app.post(
    "/api/identities/:identityId/credentials/reset",
    async (request): Promise<ManagedIdentityDto> => {
      const actor = await actorFor(request, true);
      const id = identityId(request.params);
      const before = await options.identities.get(id, actor.workspaceId);
      await requireTargetMutation(actor, before, "identity.credentials.reset");
      const body = parseCredentialReset(request.body);
      await options.verifySystemReauthentication(request, actor, body.currentPassword);
      return toDto(await options.identities.resetPassword({
        identityId: id,
        workspaceId: actor.workspaceId,
        expectedRevision: body.expectedRevision,
        temporaryPassword: body.temporaryPassword,
        revokeApiKeys: body.revokeApiKeys ?? false,
        actorIdentityId: actor.identityId ?? actor.subjectId,
        actorSubjectId: actor.subjectId,
      }));
    },
  );

  for (const purpose of ["invitation", "password-reset"] as const) {
    const suffix = purpose === "invitation" ? "invitations" : "credentials/reset-token";
    options.app.post(
      `/api/identities/:identityId/${suffix}`,
      async (request, reply): Promise<CreatedCredentialTokenDto> => {
        const actor = await actorFor(request, true);
        const id = identityId(request.params);
        const before = await options.identities.get(id, actor.workspaceId);
        if (purpose === "invitation") {
          await options.authorization.require(authorizationActor(actor), {
            action: "identity.invite",
            resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
          });
        } else {
          await requireTargetMutation(actor, before, "identity.credentials.reset");
        }
        const body = parseCredentialTokenCreate(request.body);
        await options.verifySystemReauthentication(request, actor, body.currentPassword);
        const token = await options.identities.createCredentialToken({
          identityId: id,
          workspaceId: actor.workspaceId,
          expectedRevision: body.expectedRevision,
          purpose,
          actorIdentityId: actor.identityId ?? actor.subjectId,
          actorSubjectId: actor.subjectId,
        });
        reply.code(201);
        return token;
      },
    );
  }

  options.app.post(
    "/api/identities/:identityId/system-membership",
    async (request, reply): Promise<ManagedIdentityDto> => {
      const actor = await actorFor(request, true);
      await options.authorization.require(authorizationActor(actor), {
        action: "identity.system-membership.create",
        resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
      });
      const body = parseRevision(request.body);
      const identity = await options.identities.createSystemMembership({
        identityId: identityId(request.params), workspaceId: actor.workspaceId,
        expectedRevision: body.expectedRevision,
        actorIdentityId: actor.identityId ?? actor.subjectId, actorSubjectId: actor.subjectId,
      });
      reply.code(201);
      return toDto(identity);
    },
  );

  options.app.post("/api/credentials/password", async (request, reply): Promise<void> => {
    const actor = await actorFor(request, true);
    const body = parseOwnPasswordChange(request.body);
    await options.verifySystemReauthentication(request, actor, body.currentPassword);
    await options.identities.changeOwnPassword({
      identityId: actor.identityId ?? actor.subjectId,
      workspaceId: actor.workspaceId,
      newPassword: body.newPassword,
    });
    reply.code(204).send();
  });

  for (const purpose of ["invitation", "password-reset"] as const) {
    const path = purpose === "invitation" ? "/api/credentials/setup" : "/api/credentials/reset/complete";
    options.app.post(path, async (request, reply): Promise<void> => {
      const key = `${purpose}:${request.ip}`;
      credentialTokenLimiter.assertAllowed(key);
      const body = parseCredentialTokenComplete(request.body);
      try {
        await options.identities.completeCredentialToken({ purpose, token: body.token, newPassword: body.newPassword });
        credentialTokenLimiter.clear(key);
      } catch (error: unknown) {
        credentialTokenLimiter.recordFailure(key);
        throw error;
      }
      reply.code(204).send();
    });
  }

  options.app.get(
    "/api/identities/:identityId/sessions",
    async (request): Promise<ManagedSessionListDto> => {
      const actor = await actorFor(request, false);
      const id = identityId(request.params);
      if (id !== (actor.identityId ?? actor.subjectId)) {
        const target = await options.identities.get(id, actor.workspaceId);
        await requireTargetMutation(actor, target, "identity.session.revoke");
      }
      const currentSessionId = await options.currentSessionId(request);
      return {
        items: (await options.identities.listSessions({
          identityId: id,
          workspaceId: actor.workspaceId,
          currentSessionId,
        })).map(toSessionDto),
      };
    },
  );

  options.app.delete("/api/sessions/:sessionId", async (request): Promise<ManagedSessionDto> => {
    const actor = await actorFor(request, true);
    const id = pathValue(request.params, "sessionId");
    const before = await options.identities.getSession(id, actor.workspaceId);
    if (before.identityId !== (actor.identityId ?? actor.subjectId)) {
      const target = await options.identities.get(before.identityId, actor.workspaceId);
      await requireTargetMutation(actor, target, "identity.session.revoke");
    }
    return toSessionDto(await options.identities.revokeSession({
      sessionId: id,
      workspaceId: actor.workspaceId,
      actorIdentityId: actor.identityId ?? actor.subjectId,
    }));
  });

  options.app.post(
    "/api/identities/:identityId/sessions/revoke",
    async (request): Promise<SessionRevocationResultDto> => {
      const actor = await actorFor(request, true);
      const id = identityId(request.params);
      if (id !== (actor.identityId ?? actor.subjectId)) {
        const target = await options.identities.get(id, actor.workspaceId);
        await requireTargetMutation(actor, target, "identity.session.revoke");
      }
      parseEmptyBody(request.body);
      return { revokedCount: await options.identities.revokeAllSessions({
        identityId: id,
        workspaceId: actor.workspaceId,
        actorIdentityId: actor.identityId ?? actor.subjectId,
      }) };
    },
  );

  options.app.post("/api/owner/transfer", async (request): Promise<ManagedIdentityDto> => {
    const actor = await actorFor(request, true);
    const body = parseOwnerTransfer(request.body);
    const target = await options.identities.get(body.targetIdentityId, actor.workspaceId);
    await requireTargetMutation(actor, target, "identity.owner.transfer");
    await options.verifySystemReauthentication(request, actor, body.currentPassword);
    return toDto(await options.identities.transferOwner({
      workspaceId: actor.workspaceId,
      targetIdentityId: body.targetIdentityId,
      reason: body.reason,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      actorSubjectId: actor.subjectId,
    }));
  });

  options.app.post("/api/service-identities", async (request, reply): Promise<ManagedIdentityDto> => {
    const actor = await actorFor(request, true);
    await options.authorization.require(authorizationActor(actor), {
      action: "service-account.create", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
    });
    const body = parseServiceIdentity(request.body);
    const identity = await options.identities.createService({
      workspaceId: actor.workspaceId, primaryIdentifier: body.primaryIdentifier,
      actorIdentityId: actor.identityId ?? actor.subjectId, actorSubjectId: actor.subjectId,
    });
    reply.code(201);
    return toDto(identity);
  });

  options.app.get(
    "/api/service-identities/:identityId/api-keys",
    async (request): Promise<ApiKeyListDto> => {
      const actor = await actorFor(request, false);
      await requireRead(actor);
      const id = identityId(request.params);
      const identity = await options.identities.get(id, actor.workspaceId);
      if (identity.kind !== "service") invalid("API keys require a Service Identity.");
      return { items: (await options.identities.listApiKeys(id, actor.workspaceId)).map(toApiKeyDto) };
    },
  );

  options.app.post(
    "/api/service-identities/:identityId/api-keys",
    async (request, reply): Promise<CreatedApiKeyDto> => {
      const actor = await actorFor(request, true);
      await options.authorization.require(authorizationActor(actor), {
        action: "api-key.create", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
      });
      const id = identityId(request.params);
      const body = parseApiKey(request.body);
      const key = await options.identities.createApiKey({
        identityId: id, workspaceId: actor.workspaceId, name: body.name, scopes: body.scopes,
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
        actorIdentityId: actor.identityId ?? actor.subjectId, actorSubjectId: actor.subjectId,
      });
      reply.code(201);
      return toCreatedApiKeyDto(key);
    },
  );

  options.app.delete("/api/api-keys/:apiKeyId", async (request): Promise<ApiKeyDto> => {
    const actor = await actorFor(request, true);
    await options.authorization.require(authorizationActor(actor), {
      action: "api-key.revoke", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID,
    });
    return toApiKeyDto(await options.identities.revokeApiKey({
      apiKeyId: pathValue(request.params, "apiKeyId"), workspaceId: actor.workspaceId,
      actorIdentityId: actor.identityId ?? actor.subjectId,
    }));
  });
}

function parseListQuery(value: unknown): {
  readonly limit: number;
  readonly cursor?: string;
  readonly query?: string;
  readonly kind?: ManagedIdentityKind;
  readonly status?: ManagedIdentityStatus;
  readonly originRealmId?: string;
  readonly realmId?: string;
} {
  const input = object(value, "Identity query");
  unexpected(input, ["limit", "cursor", "query", "kind", "status", "originRealmId", "realmId"]);
  const rawLimit = input["limit"];
  const limit = rawLimit === undefined ? 25 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid("limit must be between 1 and 100.");
  const cursor = optionalString(input["cursor"], "cursor", 2048);
  const query = optionalString(input["query"], "query", 120);
  const kind = enumeration(input["kind"], "kind", ["human", "service"] as const);
  const status = enumeration(input["status"], "status", ["active", "disabled"] as const);
  const originRealmId = optionalString(input["originRealmId"], "originRealmId", 200);
  const realmId = optionalString(input["realmId"], "realmId", 200);
  return { limit, ...(cursor === undefined ? {} : { cursor }), ...(query === undefined ? {} : { query }),
    ...(kind === undefined ? {} : { kind }), ...(status === undefined ? {} : { status }),
    ...(originRealmId === undefined ? {} : { originRealmId }), ...(realmId === undefined ? {} : { realmId }) };
}

function parseCreate(value: unknown): CreateManagedIdentityRequest {
  const input = object(value, "Identity create body");
  unexpected(input, ["primaryIdentifier", "temporaryPassword"]);
  return {
    primaryIdentifier: requiredString(input["primaryIdentifier"], "primaryIdentifier", 120),
    temporaryPassword: requiredString(input["temporaryPassword"], "temporaryPassword", 128, false),
  };
}

function parseUpdate(value: unknown): UpdateManagedIdentityRequest {
  const input = object(value, "Identity update body");
  unexpected(input, ["expectedRevision", "primaryIdentifier"]);
  return {
    expectedRevision: positiveRevision(input["expectedRevision"]),
    primaryIdentifier: requiredString(input["primaryIdentifier"], "primaryIdentifier", 120),
  };
}

function parseRevision(value: unknown): ManagedIdentityRevisionRequest {
  const input = object(value, "Identity revision body");
  unexpected(input, ["expectedRevision"]);
  return { expectedRevision: positiveRevision(input["expectedRevision"]) };
}

function parseCredentialReset(value: unknown): ResetManagedIdentityCredentialsRequest {
  const input = object(value, "Credential reset body");
  unexpected(input, ["expectedRevision", "temporaryPassword", "currentPassword", "revokeApiKeys"]);
  const revokeApiKeys = input["revokeApiKeys"];
  if (revokeApiKeys !== undefined && typeof revokeApiKeys !== "boolean") invalid("revokeApiKeys must be a boolean.");
  return {
    expectedRevision: positiveRevision(input["expectedRevision"]),
    temporaryPassword: requiredString(input["temporaryPassword"], "temporaryPassword", 128, false),
    currentPassword: requiredString(input["currentPassword"], "currentPassword", 128, false),
    ...(revokeApiKeys === undefined ? {} : { revokeApiKeys: revokeApiKeys as boolean }),
  };
}

function parseCredentialTokenCreate(value: unknown): CreateCredentialTokenRequest {
  const input = object(value, "Credential token body");
  unexpected(input, ["expectedRevision", "currentPassword"]);
  return {
    expectedRevision: positiveRevision(input["expectedRevision"]),
    currentPassword: requiredString(input["currentPassword"], "currentPassword", 128, false),
  };
}

function parseCredentialTokenComplete(value: unknown): CompleteCredentialTokenRequest {
  const input = object(value, "Credential completion body");
  unexpected(input, ["token", "newPassword"]);
  return {
    token: requiredString(input["token"], "token", 512, false),
    newPassword: requiredString(input["newPassword"], "newPassword", 128, false),
  };
}

function parseOwnPasswordChange(value: unknown): ChangeOwnPasswordRequest {
  const input = object(value, "Password change body");
  unexpected(input, ["currentPassword", "newPassword"]);
  return {
    currentPassword: requiredString(input["currentPassword"], "currentPassword", 128, false),
    newPassword: requiredString(input["newPassword"], "newPassword", 128, false),
  };
}

function parseOwnerTransfer(value: unknown): TransferOwnerRequest {
  const input = object(value, "Owner transfer body");
  unexpected(input, ["targetIdentityId", "reason", "currentPassword"]);
  return {
    targetIdentityId: requiredString(input["targetIdentityId"], "targetIdentityId", 200),
    reason: requiredString(input["reason"], "reason", 500),
    currentPassword: requiredString(input["currentPassword"], "currentPassword", 128, false),
  };
}

function parseServiceIdentity(value: unknown): CreateServiceIdentityRequest {
  const input = object(value, "Service Identity body");
  unexpected(input, ["primaryIdentifier"]);
  return { primaryIdentifier: requiredString(input["primaryIdentifier"], "primaryIdentifier", 120) };
}

function parseApiKey(value: unknown): CreateApiKeyRequest {
  const input = object(value, "API key body");
  unexpected(input, ["name", "scopes", "expiresAt"]);
  const scopes = input["scopes"];
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) invalid("scopes must be a string array.");
  const expiresAt = optionalString(input["expiresAt"], "expiresAt", 80);
  return {
    name: requiredString(input["name"], "name", 120),
    scopes: scopes as string[],
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function parseEmptyBody(value: unknown): void {
  const input = object(value ?? {}, "Request body");
  unexpected(input, []);
}

function toDto(identity: ManagedIdentity): ManagedIdentityDto {
  return {
    identityId: identity.id,
    workspaceId: identity.workspaceId,
    kind: identity.kind,
    primaryIdentifier: identity.primaryIdentifier,
    originRealmId: identity.originRealmId,
    isOwner: identity.isOwner,
    status: identity.status,
    credentialVersion: identity.credentialVersion,
    passwordChangeRequired: identity.passwordChangeRequired,
    revision: identity.revision,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    ...(identity.disabledAt === undefined ? {} : { disabledAt: identity.disabledAt }),
    memberships: identity.memberships,
  };
}

function toSessionDto(session: ManagedSession): ManagedSessionDto {
  return {
    sessionId: session.id, audience: session.audience, identityId: session.identityId,
    realmId: session.realmId, realmName: session.realmName, membershipId: session.membershipId,
    createdAt: session.createdAt, authenticatedAt: session.authenticatedAt,
    expiresAt: session.expiresAt, current: session.current,
    ...(session.revokedAt === undefined ? {} : { revokedAt: session.revokedAt }),
    ...(session.revokedByIdentityId === undefined ? {} : { revokedByIdentityId: session.revokedByIdentityId }),
    ...(session.revokeReason === undefined ? {} : { revokeReason: session.revokeReason }),
  };
}

function toApiKeyDto(key: ApiKeyRecord): ApiKeyDto {
  return {
    apiKeyId: key.id, identityId: key.identityId, name: key.name, prefix: key.prefix,
    scopes: key.scopes, createdAt: key.createdAt,
    ...(key.expiresAt === undefined ? {} : { expiresAt: key.expiresAt }),
    ...(key.lastUsedAt === undefined ? {} : { lastUsedAt: key.lastUsedAt }),
    ...(key.revokedAt === undefined ? {} : { revokedAt: key.revokedAt }),
  };
}
function toCreatedApiKeyDto(key: CreatedApiKey): CreatedApiKeyDto {
  return { ...toApiKeyDto(key), secret: key.secret };
}

function identityId(value: unknown): string {
  return requiredString(object(value, "Identity path")["identityId"], "identityId", 200);
}
function pathValue(value: unknown, name: string): string {
  return requiredString(object(value, "Request path")[name], name, 200);
}
function positiveRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid("expectedRevision must be a positive integer.");
  return value as number;
}
function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}
function unexpected(input: Readonly<Record<string, unknown>>, allowed: readonly string[]): void {
  const key = Object.keys(input).find((candidate) => !allowed.includes(candidate));
  if (key !== undefined) invalid(`Unexpected property '${key}'.`);
}
function requiredString(value: unknown, label: string, maximum: number, trim = true): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.includes("\u0000")) invalid(`${label} is invalid.`);
  const result = trim ? value.trim() : value;
  if (result.length === 0) invalid(`${label} is invalid.`);
  return result;
}
function optionalString(value: unknown, label: string, maximum: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, label, maximum);
}
function enumeration<const T extends readonly string[]>(value: unknown, label: string, allowed: T): T[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) invalid(`${label} is invalid.`);
  return value as T[number];
}
function invalid(detail: string): never {
  throw new ApplicationError("IDENTITY_REQUEST_INVALID", 400, detail);
}
