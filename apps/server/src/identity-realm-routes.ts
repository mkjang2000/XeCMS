import {
  ApplicationError,
  SYSTEM_ACTOR_REALM_ID,
  type ActorContext,
  type AuthenticatedContentRealmSession,
  type GlobalIdentityRecord,
  type IdentityRealmRecord,
  type RealmFullAccessBindingRecord,
  type RealmMembershipRecord,
} from "@xecms/application";
import type {
  CollectionListDto,
  AssignRealmOwnerRequest,
  ContentAnonymousSessionDto,
  ContentAuthenticatedSessionDto,
  ContentRealmLoginRequest,
  ContentRealmMetadataDto,
  ContentRealmProfileDto,
  ContentRealmSignupRequest,
  ContentSessionDto,
  CreateDocumentRequest,
  CreateIdentityRealmRequest,
  CreateRealmProfileFieldRequest,
  CreateRealmProfileSchemaRequest,
  GlobalIdentityListDto,
  IdentityRealmDto,
  IdentityRealmListDto,
  DocumentListDto,
  DocumentQueryRequest,
  DocumentQueryResultDto,
  DocumentRecordDto,
  RealmFullAccessBindingDto,
  RealmFullAccessListDto,
  RealmMembershipDto,
  RealmMembershipListDto,
  RealmOwnerStatusDto,
  RecoverRealmOwnerRequest,
  GrantRealmAdministratorRequest,
  RevokeRealmAdministratorRequest,
  ProvisionRealmMembershipRequest,
  RegisterRealmMembershipRequest,
  UpdateContentRealmProfileRequest,
  UpdateDocumentRequest,
  UpdateIdentityRealmRequest,
  UpdateRealmMembershipRequest,
  TransferRealmOwnerRequest,
} from "@xecms/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parseDocumentQueryRequest } from "./document-query-request.js";

export const CONTENT_REALM_SESSION_COOKIE = "xecms_content_session";

type AuthenticatedContentContext = Omit<
  AuthenticatedContentRealmSession,
  "sessionToken" | "csrfToken"
>;

export interface IdentityRealmAdministrationRouteService {
  listGlobalIdentities(actor: ActorContext): Promise<readonly GlobalIdentityRecord[]>;
  listRealms(actor: ActorContext): Promise<readonly IdentityRealmRecord[]>;
  createRealm(
    actor: ActorContext,
    input: CreateIdentityRealmRequest,
  ): Promise<IdentityRealmRecord>;
  createProfileSchema(
    actor: ActorContext,
    input: CreateRealmProfileSchemaRequest & { readonly realmId: string },
  ): Promise<IdentityRealmRecord>;
  createProfileField(
    actor: ActorContext,
    input: CreateRealmProfileFieldRequest & { readonly realmId: string },
  ): Promise<IdentityRealmRecord>;
  updateRealm(
    actor: ActorContext,
    input: UpdateIdentityRealmRequest & { readonly realmId: string },
  ): Promise<IdentityRealmRecord>;
  listMemberships(
    actor: ActorContext,
    realmId: string,
  ): Promise<readonly RealmAdministrationMembershipRecord[]>;
  provisionMembership(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly identityId: string;
      readonly profile: Readonly<Record<string, unknown>>;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmMembershipRecord>;
  registerMembership(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly identifier: string;
      readonly password: string;
      readonly profile: Readonly<Record<string, unknown>>;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmMembershipRecord>;
  grantRealmAdministrator(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly membershipId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmMembershipRecord>;
  revokeRealmAdministrator(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly membershipId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmMembershipRecord>;
  suspendMembership(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly membershipId: string;
      readonly expectedRevision: number;
    },
  ): Promise<RealmMembershipRecord>;
  reactivateMembership(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly membershipId: string;
      readonly expectedRevision: number;
    },
  ): Promise<RealmMembershipRecord>;
  getOwner(actor: ActorContext, realmId: string): Promise<RealmOwnerStatusDto>;
  assignOwner(
    actor: ActorContext,
    input: Omit<AssignRealmOwnerRequest, "password"> & {
      readonly realmId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmOwnerStatusDto>;
  transferOwner(
    actor: ActorContext,
    input: Omit<TransferRealmOwnerRequest, "password"> & {
      readonly realmId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmOwnerStatusDto>;
  recoverOwner(
    actor: ActorContext,
    input: Omit<RecoverRealmOwnerRequest, "password"> & {
      readonly realmId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmOwnerStatusDto>;
  listFullAccessBindings(
    actor: ActorContext,
    realmId: string,
  ): Promise<readonly RealmFullAccessBindingRecord[]>;
  grantFullAccess(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly reason: string;
      readonly reauthenticatedAt: string;
      readonly validUntil: string;
    },
  ): Promise<RealmFullAccessBindingRecord>;
  revokeFullAccess(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly bindingId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmFullAccessBindingRecord>;
}

export interface RealmAdministrationMembershipRecord extends RealmMembershipRecord {
  /** True only for the trusted canonical content-administrator binding. */
  readonly realmAdministrator?: boolean;
}

export interface ContentRealmAuthenticationRouteService {
  signup(
    input: ContentRealmSignupRequest & { readonly realmKey: string },
  ): Promise<AuthenticatedContentRealmSession>;
  login(
    input: ContentRealmLoginRequest & { readonly realmKey: string },
  ): Promise<AuthenticatedContentRealmSession>;
  authenticate(input: {
    readonly realmKey: string;
    readonly sessionToken: string;
  }): Promise<AuthenticatedContentContext>;
  assertCsrfToken(input: {
    readonly realmKey: string;
    readonly sessionToken: string;
    readonly csrfToken: string;
  }): Promise<void>;
  logout(input: { readonly realmKey: string; readonly sessionToken: string }): Promise<void>;
}

export interface ContentRealmMetadataRouteSource {
  getByKey(realmKey: string): Promise<{
    readonly realm: IdentityRealmRecord;
    readonly identifierFieldIds: readonly string[];
  } | null>;
}

export interface IdentityRealmRouteActorAdapter {
  /** Must authenticate the System session and enforce Admin Origin+CSRF when requested. */
  requireSystemActor(request: FastifyRequest, requireCsrf: boolean): Promise<ActorContext>;
  /**
   * Verifies the submitted password against the authenticated System identity.
   * Only this adapter's server-generated timestamp is accepted as proof.
   */
  verifySystemReauthentication(
    request: FastifyRequest,
    actor: ActorContext,
    password: string,
  ): Promise<{ readonly reauthenticatedAt: string }>;
  /** Supplies the Content Realm authorization gateway for a validated Content session. */
  contentActorForSession(
    session: AuthenticatedContentContext,
  ): ActorContext | Promise<ActorContext>;
}

export interface ContentRealmProfileRouteAdapter {
  get(input: ContentRealmProfileContext): Promise<ContentRealmProfileValue>;
  update(
    input: ContentRealmProfileContext & UpdateContentRealmProfileRequest,
  ): Promise<ContentRealmProfileValue>;
}

export interface ContentRealmDocumentRouteAdapter {
  listCollections(actor: ActorContext): Promise<CollectionListDto>;
  listDocuments(input: {
    readonly actor: ActorContext;
    readonly collectionId: string;
    readonly page?: number;
    readonly pageSize?: number;
  }): Promise<DocumentListDto>;
  queryDocuments(input: {
    readonly actor: ActorContext;
    readonly collectionId: string;
    readonly request: DocumentQueryRequest;
  }): Promise<DocumentQueryResultDto>;
  getDocument(input: {
    readonly actor: ActorContext;
    readonly collectionId: string;
    readonly documentId: string;
  }): Promise<DocumentRecordDto>;
  createDocument(input: {
    readonly actor: ActorContext;
    readonly collectionId: string;
    readonly request: CreateDocumentRequest;
  }): Promise<DocumentRecordDto>;
  updateDocument(input: {
    readonly actor: ActorContext;
    readonly collectionId: string;
    readonly documentId: string;
    readonly request: UpdateDocumentRequest;
  }): Promise<DocumentRecordDto>;
}

export interface ContentRealmProfileContext {
  readonly actor: ActorContext;
  readonly realmId: string;
  readonly realmKey: string;
  readonly membershipId: string;
  readonly subjectId: string;
  readonly profileDocumentId: string;
}

export interface ContentRealmProfileValue {
  readonly data: Readonly<Record<string, unknown>>;
  readonly revision: number;
}

export interface IdentityRealmRouteSecurityAdapter {
  /** Content origins are configured independently from Admin Studio origins. */
  assertContentOrigin(request: FastifyRequest, realmKey: string): void | Promise<void>;
  csrfTokenForContentSession(sessionToken: string): string;
  assertContentLoginAllowed?(request: FastifyRequest, realmKey: string, identifier: string): void;
  recordContentLoginFailure?(request: FastifyRequest, realmKey: string, identifier: string): void;
  clearContentLoginFailures?(request: FastifyRequest, realmKey: string, identifier: string): void;
}

export interface RegisterIdentityRealmRoutesOptions {
  readonly app: FastifyInstance;
  readonly administration: IdentityRealmAdministrationRouteService;
  readonly contentAuthentication: ContentRealmAuthenticationRouteService;
  readonly metadata: ContentRealmMetadataRouteSource;
  readonly actors: IdentityRealmRouteActorAdapter;
  readonly profiles: ContentRealmProfileRouteAdapter;
  readonly documents: ContentRealmDocumentRouteAdapter;
  readonly security: IdentityRealmRouteSecurityAdapter;
  readonly secureCookies: boolean;
}

/**
 * Registers M4-A's bounded System Admin and Content Realm HTTP surfaces.
 * Wiring stays outside this module so the two authentication audiences cannot
 * accidentally share cookies, Origin policy, CSRF validation, or Actor state.
 */
export function registerIdentityRealmRoutes(options: RegisterIdentityRealmRoutesOptions): void {
  const {
    app,
    administration,
    contentAuthentication,
    metadata,
    actors,
    profiles,
    documents,
    security,
  } = options;
  const cookieName = CONTENT_REALM_SESSION_COOKIE;

  const systemActor = async (
    request: FastifyRequest,
    requireCsrf: boolean,
  ): Promise<ActorContext> => {
    const actor = await actors.requireSystemActor(request, requireCsrf);
    if (actor.realmId !== undefined && actor.realmId !== SYSTEM_ACTOR_REALM_ID) {
      throw new ApplicationError(
        "IDENTITY_REALM_ADMIN_AUDIENCE_MISMATCH",
        403,
        "Identity Realm administration requires a System Realm session.",
      );
    }
    if (actor.authentication === "api-key") {
      throw new ApplicationError(
        "API_KEY_ADMINISTRATION_FORBIDDEN",
        403,
        "API keys cannot administer Identity Realms or Full Access.",
      );
    }
    return externalActor(actor);
  };

  app.get("/api/global-identities", async (request): Promise<GlobalIdentityListDto> => ({
    items: (await administration.listGlobalIdentities(await systemActor(request, false)))
      .map((identity) => ({
        globalIdentityId: identity.id,
        kind: identity.kind,
        isOwner: identity.isOwner === true,
        primaryIdentifier: identity.primaryIdentifier,
        originRealmId: identity.originRealmId,
        credentialVersion: identity.credentialVersion,
        ...(identity.disabledAt === undefined ? {} : { disabledAt: identity.disabledAt }),
      })),
  }));

  app.get("/api/identity-realms", async (request): Promise<IdentityRealmListDto> => ({
    items: (await administration.listRealms(await systemActor(request, false))).map(toRealmDto),
  }));

  app.get("/api/identity-realms/:realmId", async (request): Promise<IdentityRealmDto> => {
    const actor = await systemActor(request, false);
    const { realmId } = pathParams(request.params, ["realmId"]);
    const realm = (await administration.listRealms(actor)).find((candidate) => candidate.id === realmId);
    if (realm === undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_NOT_FOUND",
        404,
        "The Identity Realm does not exist.",
      );
    }
    return toRealmDto(realm);
  });

  app.post("/api/identity-realms", async (request, reply): Promise<IdentityRealmDto> => {
    const actor = await systemActor(request, true);
    const realm = await administration.createRealm(actor, parseCreateRealm(request.body));
    reply.code(201);
    return toRealmDto(realm);
  });

  app.post("/api/identity-realms/:realmId/profile-schema", async (request): Promise<IdentityRealmDto> => {
    const actor = await systemActor(request, true);
    const { realmId } = pathParams(request.params, ["realmId"]);
    const realm = await administration.createProfileSchema(actor, {
      realmId,
      ...parseCreateProfileSchema(request.body),
    });
    return toRealmDto(realm);
  });

  app.post("/api/identity-realms/:realmId/profile-fields", async (request): Promise<IdentityRealmDto> => {
    const actor = await systemActor(request, true);
    const { realmId } = pathParams(request.params, ["realmId"]);
    const realm = await administration.createProfileField(actor, {
      realmId,
      ...parseCreateProfileField(request.body),
    });
    return toRealmDto(realm);
  });

  app.patch("/api/identity-realms/:realmId", async (request): Promise<IdentityRealmDto> => {
    const actor = await systemActor(request, true);
    const { realmId } = pathParams(request.params, ["realmId"]);
    const realm = await administration.updateRealm(actor, {
      realmId,
      ...parseUpdateRealm(request.body),
    });
    return toRealmDto(realm);
  });

  app.get(
    "/api/identity-realms/:realmId/memberships",
    async (request): Promise<RealmMembershipListDto> => {
      const actor = await systemActor(request, false);
      const { realmId } = pathParams(request.params, ["realmId"]);
      return {
        items: (await administration.listMemberships(actor, realmId)).map(toMembershipDto),
      };
    },
  );

  app.post(
    "/api/content-realms/:realmKey/collections/:collectionId/documents/query",
    async (request, reply): Promise<DocumentQueryResultDto> => {
      const { realmKey, collectionId } = pathParams(request.params, ["realmKey", "collectionId"]);
      const authenticated = await requireContentSession(
        request,
        realmKey,
        false,
        contentAuthentication,
        security,
        cookieName,
      );
      const actor = await contentActorContext(authenticated.session, realmKey, actors);
      noStore(reply);
      return documents.queryDocuments({
        actor,
        collectionId,
        request: parseDocumentQueryRequest(request.body),
      });
    },
  );

  app.delete(
    "/api/identity-realms/:realmId/memberships/:membershipId/administrator",
    async (request): Promise<RealmMembershipDto> => {
      const actor = await systemActor(request, true);
      const { realmId, membershipId } = pathParams(request.params, ["realmId", "membershipId"]);
      const body = parseRevokeAdministrator(request.body);
      const verified = await actors.verifySystemReauthentication(request, actor, body.reauthPassword);
      const membership = await administration.revokeRealmAdministrator(actor, {
        realmId,
        membershipId,
        reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      });
      return toMembershipDto(membership);
    },
  );

  app.post(
    "/api/identity-realms/:realmId/memberships",
    async (request, reply): Promise<RealmMembershipDto> => {
      const actor = await systemActor(request, true);
      const { realmId } = pathParams(request.params, ["realmId"]);
      const body = parseMembershipProvision(request.body);
      const verified = await actors.verifySystemReauthentication(request, actor, body.password);
      const membership = await administration.provisionMembership(actor, {
        realmId,
        identityId: body.globalIdentityId,
        profile: body.profile,
        reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      });
      reply.code(201);
      return toMembershipDto(membership);
    },
  );

  app.post(
    "/api/identity-realms/:realmId/memberships/register",
    async (request, reply): Promise<RealmMembershipDto> => {
      const actor = await systemActor(request, true);
      const { realmId } = pathParams(request.params, ["realmId"]);
      const body = parseMembershipRegister(request.body);
      // The operator re-authenticates with their own password; `password` is the
      // brand-new user's initial credential and must never be used for reauth.
      const verified = await actors.verifySystemReauthentication(request, actor, body.reauthPassword);
      const membership = await administration.registerMembership(actor, {
        realmId,
        identifier: body.identifier,
        password: body.password,
        profile: body.profile,
        reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      });
      reply.code(201);
      return toMembershipDto(membership);
    },
  );

  app.post(
    "/api/identity-realms/:realmId/memberships/:membershipId/administrator",
    async (request, reply): Promise<RealmMembershipDto> => {
      const actor = await systemActor(request, true);
      const { realmId, membershipId } = pathParams(request.params, ["realmId", "membershipId"]);
      const body = parseGrantAdministrator(request.body);
      const verified = await actors.verifySystemReauthentication(request, actor, body.reauthPassword);
      const membership = await administration.grantRealmAdministrator(actor, {
        realmId,
        membershipId,
        reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      });
      reply.code(201);
      return toMembershipDto(membership);
    },
  );

  app.patch(
    "/api/identity-realms/:realmId/memberships/:membershipId",
    async (request): Promise<RealmMembershipDto> => {
      const actor = await systemActor(request, true);
      const { realmId, membershipId } = pathParams(request.params, ["realmId", "membershipId"]);
      const body = parseMembershipUpdate(request.body);
      const input = { realmId, membershipId, expectedRevision: body.expectedRevision };
      const membership = body.status === "suspended"
        ? await administration.suspendMembership(actor, input)
        : await administration.reactivateMembership(actor, input);
      return toMembershipDto(membership);
    },
  );

  app.get(
    "/api/identity-realms/:realmId/owner",
    async (request): Promise<RealmOwnerStatusDto> => {
      const actor = await systemActor(request, false);
      const { realmId } = pathParams(request.params, ["realmId"]);
      return administration.getOwner(actor, realmId);
    },
  );

  const ownerCommand = (
    operation: "assign" | "transfer" | "recover",
  ) => async (request: FastifyRequest): Promise<RealmOwnerStatusDto> => {
    const actor = await systemActor(request, true);
    const { realmId } = pathParams(request.params, ["realmId"]);
    const body = parseOwnerCommand(request.body, operation === "transfer");
    const verified = await actors.verifySystemReauthentication(request, actor, body.password);
    const common = {
      realmId,
      targetMembershipId: body.targetMembershipId,
      expectedPolicyRevision: body.expectedPolicyRevision,
      reason: body.reason,
      reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      requestId: request.id,
    };
    if (operation === "assign") return administration.assignOwner(actor, common);
    if (operation === "recover") return administration.recoverOwner(actor, common);
    return administration.transferOwner(actor, {
      ...common,
      ...(body.revokePreviousSessions === undefined
        ? {}
        : { revokePreviousSessions: body.revokePreviousSessions }),
      ...(body.suspendPreviousMembership === undefined
        ? {}
        : { suspendPreviousMembership: body.suspendPreviousMembership }),
    });
  };

  app.post("/api/identity-realms/:realmId/owner/assign", ownerCommand("assign"));
  app.post("/api/identity-realms/:realmId/owner/transfer", ownerCommand("transfer"));
  app.post("/api/identity-realms/:realmId/owner/recover", ownerCommand("recover"));

  app.get(
    "/api/identity-realms/:realmId/full-access",
    async (request): Promise<RealmFullAccessListDto> => {
      const actor = await systemActor(request, false);
      const { realmId } = pathParams(request.params, ["realmId"]);
      const items = (await administration.listFullAccessBindings(actor, realmId)).map(
        toFullAccessDto,
      );
      const systemIdentityId = actor.identityId ?? actor.subjectId;
      const now = Date.now();
      const activeBinding = items.find((binding) =>
        binding.systemIdentityId === systemIdentityId
        && binding.revokedAt === undefined
        && Date.parse(binding.validUntil) > now);
      return {
        items,
        ...(activeBinding === undefined ? {} : { activeBinding }),
      };
    },
  );

  app.post(
    "/api/identity-realms/:realmId/full-access",
    async (request, reply): Promise<RealmFullAccessBindingDto> => {
      const actor = await systemActor(request, true);
      const { realmId } = pathParams(request.params, ["realmId"]);
      const body = parseFullAccessGrant(request.body);
      const verified = await actors.verifySystemReauthentication(request, actor, body.password);
      const binding = await administration.grantFullAccess(actor, {
        realmId,
        reason: body.reason,
        validUntil: body.validUntil,
        reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      });
      reply.code(201);
      return toFullAccessDto(binding);
    },
  );

  app.delete(
    "/api/identity-realms/:realmId/full-access/:bindingId",
    async (request): Promise<RealmFullAccessBindingDto> => {
      const actor = await systemActor(request, true);
      const { realmId, bindingId } = pathParams(request.params, ["realmId", "bindingId"]);
      const body = parseFullAccessRevoke(request.body);
      const verified = await actors.verifySystemReauthentication(request, actor, body.password);
      return toFullAccessDto(await administration.revokeFullAccess(actor, {
        realmId,
        bindingId,
        reauthenticatedAt: trustedReauthenticationTimestamp(verified),
      }));
    },
  );

  app.get(
    "/api/content-realms/:realmKey",
    async (request): Promise<ContentRealmMetadataDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      return toMetadataDto(await activeMetadata(metadata, realmKey));
    },
  );

  app.post(
    "/api/content-realms/:realmKey/signup",
    async (request, reply): Promise<ContentAuthenticatedSessionDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      await security.assertContentOrigin(request, realmKey);
      const session = await contentAuthentication.signup({
        realmKey,
        ...parseSignup(request.body),
      });
      assertSessionCoherence(session, realmKey);
      setContentSessionCookie(reply, options, cookieName, realmKey, session);
      noStore(reply);
      reply.code(201);
      return authenticatedSessionDto(session);
    },
  );

  app.post(
    "/api/content-realms/:realmKey/login",
    async (request, reply): Promise<ContentAuthenticatedSessionDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      await security.assertContentOrigin(request, realmKey);
      const body = parseLogin(request.body);
      security.assertContentLoginAllowed?.(request, realmKey, body.identifier);
      try {
        const session = await contentAuthentication.login({ realmKey, ...body });
        security.clearContentLoginFailures?.(request, realmKey, body.identifier);
        assertSessionCoherence(session, realmKey);
        setContentSessionCookie(reply, options, cookieName, realmKey, session);
        noStore(reply);
        return authenticatedSessionDto(session);
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "AUTHENTICATION_FAILED") {
          security.recordContentLoginFailure?.(request, realmKey, body.identifier);
        }
        throw error;
      }
    },
  );

  app.get(
    "/api/content-realms/:realmKey/session",
    async (request, reply): Promise<ContentSessionDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      noStore(reply);
      const token = request.cookies[cookieName];
      if (token === undefined) {
        return anonymousSessionDto(await activeMetadata(metadata, realmKey));
      }
      try {
        const session = await contentAuthentication.authenticate({ realmKey, sessionToken: token });
        assertSessionCoherence(session, realmKey);
        return authenticatedSessionDto({
          ...session,
          sessionToken: token,
          csrfToken: security.csrfTokenForContentSession(token),
        });
      } catch (error: unknown) {
        if (!(error instanceof ApplicationError) || error.code !== "CONTENT_SESSION_INVALID") {
          throw error;
        }
        clearContentSessionCookie(reply, options, cookieName, realmKey);
        return anonymousSessionDto(await activeMetadata(metadata, realmKey));
      }
    },
  );

  app.post("/api/content-realms/:realmKey/logout", async (request, reply): Promise<void> => {
    const { realmKey } = pathParams(request.params, ["realmKey"]);
    const authenticated = await requireContentSession(
      request,
      realmKey,
      true,
      contentAuthentication,
      security,
      cookieName,
    );
    await contentAuthentication.logout({
      realmKey,
      sessionToken: authenticated.sessionToken,
    });
    clearContentSessionCookie(reply, options, cookieName, realmKey);
    noStore(reply);
    reply.code(204).send();
  });

  app.get(
    "/api/content-realms/:realmKey/profile",
    async (request, reply): Promise<ContentRealmProfileDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      const authenticated = await requireContentSession(
        request,
        realmKey,
        false,
        contentAuthentication,
        security,
        cookieName,
      );
      const context = await profileContext(authenticated.session, realmKey, actors);
      const profile = await profiles.get(context);
      noStore(reply);
      return profileDto(context, profile);
    },
  );

  app.patch(
    "/api/content-realms/:realmKey/profile",
    async (request, reply): Promise<ContentRealmProfileDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      const authenticated = await requireContentSession(
        request,
        realmKey,
        true,
        contentAuthentication,
        security,
        cookieName,
      );
      const context = await profileContext(authenticated.session, realmKey, actors);
      const profile = await profiles.update({
        ...context,
        ...parseProfileUpdate(request.body),
      });
      noStore(reply);
      return profileDto(context, profile);
    },
  );

  app.get(
    "/api/content-realms/:realmKey/collections",
    async (request, reply): Promise<CollectionListDto> => {
      const { realmKey } = pathParams(request.params, ["realmKey"]);
      const authenticated = await requireContentSession(
        request,
        realmKey,
        false,
        contentAuthentication,
        security,
        cookieName,
      );
      const actor = await contentActorContext(authenticated.session, realmKey, actors);
      noStore(reply);
      return documents.listCollections(actor);
    },
  );

  app.get(
    "/api/content-realms/:realmKey/collections/:collectionId/documents",
    async (request, reply): Promise<DocumentListDto> => {
      const { realmKey, collectionId } = pathParams(request.params, ["realmKey", "collectionId"]);
      const authenticated = await requireContentSession(
        request,
        realmKey,
        false,
        contentAuthentication,
        security,
        cookieName,
      );
      const actor = await contentActorContext(authenticated.session, realmKey, actors);
      const query = paginationQuery(request.query);
      noStore(reply);
      return documents.listDocuments({ actor, collectionId, ...query });
    },
  );

  app.post(
    "/api/content-realms/:realmKey/collections/:collectionId/documents",
    async (request, reply): Promise<DocumentRecordDto> => {
      const { realmKey, collectionId } = pathParams(request.params, ["realmKey", "collectionId"]);
      const authenticated = await requireContentSession(
        request,
        realmKey,
        true,
        contentAuthentication,
        security,
        cookieName,
      );
      const actor = await contentActorContext(authenticated.session, realmKey, actors);
      const document = await documents.createDocument({
        actor,
        collectionId,
        request: parseCreateDocument(request.body),
      });
      noStore(reply);
      reply.code(201);
      return document;
    },
  );

  app.get(
    "/api/content-realms/:realmKey/collections/:collectionId/documents/:documentId",
    async (request, reply): Promise<DocumentRecordDto> => {
      const { realmKey, collectionId, documentId } = pathParams(
        request.params,
        ["realmKey", "collectionId", "documentId"],
      );
      const authenticated = await requireContentSession(
        request,
        realmKey,
        false,
        contentAuthentication,
        security,
        cookieName,
      );
      const actor = await contentActorContext(authenticated.session, realmKey, actors);
      noStore(reply);
      return documents.getDocument({ actor, collectionId, documentId });
    },
  );

  app.patch(
    "/api/content-realms/:realmKey/collections/:collectionId/documents/:documentId",
    async (request, reply): Promise<DocumentRecordDto> => {
      const { realmKey, collectionId, documentId } = pathParams(
        request.params,
        ["realmKey", "collectionId", "documentId"],
      );
      const authenticated = await requireContentSession(
        request,
        realmKey,
        true,
        contentAuthentication,
        security,
        cookieName,
      );
      const actor = await contentActorContext(authenticated.session, realmKey, actors);
      noStore(reply);
      return documents.updateDocument({
        actor,
        collectionId,
        documentId,
        request: parseUpdateDocument(request.body),
      });
    },
  );
}

async function requireContentSession(
  request: FastifyRequest,
  realmKey: string,
  requireCsrf: boolean,
  authentication: ContentRealmAuthenticationRouteService,
  security: IdentityRealmRouteSecurityAdapter,
  cookieName: string,
): Promise<{
  readonly sessionToken: string;
  readonly session: AuthenticatedContentContext;
}> {
  const sessionToken = request.cookies[cookieName];
  if (sessionToken === undefined) {
    throw new ApplicationError(
      "CONTENT_SESSION_REQUIRED",
      401,
      "An authenticated Content Realm session is required.",
    );
  }
  const session = await authentication.authenticate({ realmKey, sessionToken });
  assertSessionCoherence(session, realmKey);
  if (requireCsrf) {
    await security.assertContentOrigin(request, realmKey);
    const csrfToken = request.headers["x-csrf-token"];
    if (typeof csrfToken !== "string") {
      throw new ApplicationError("CSRF_TOKEN_REQUIRED", 403, "X-CSRF-Token is required.");
    }
    await authentication.assertCsrfToken({ realmKey, sessionToken, csrfToken });
  }
  return { sessionToken, session };
}

async function profileContext(
  session: AuthenticatedContentContext,
  realmKey: string,
  actors: IdentityRealmRouteActorAdapter,
): Promise<ContentRealmProfileContext> {
  assertSessionCoherence(session, realmKey);
  const profileDocumentId = session.membership.profileDocumentId;
  if (profileDocumentId === undefined) {
    throw new ApplicationError(
      "IDENTITY_PROVISIONING_INCOMPLETE",
      503,
      "The Realm Profile provisioning is incomplete.",
    );
  }
  return {
    actor: await contentActorContext(session, realmKey, actors),
    realmId: session.realm.id,
    realmKey: session.realm.key,
    membershipId: session.membership.id,
    subjectId: session.membership.subjectId,
    profileDocumentId,
  };
}

async function contentActorContext(
  session: AuthenticatedContentContext,
  realmKey: string,
  actors: IdentityRealmRouteActorAdapter,
): Promise<ActorContext> {
  assertSessionCoherence(session, realmKey);
  const candidate = await actors.contentActorForSession(session);
  if (
    candidate.subjectId !== session.membership.subjectId ||
    candidate.identityId !== session.identity.id ||
    candidate.workspaceId !== session.realm.workspaceId ||
    candidate.realmId !== session.realm.id
  ) {
    throw new ApplicationError(
      "CONTENT_ACTOR_CONTEXT_INVALID",
      500,
      "The Content Realm actor context does not match the authenticated Membership.",
    );
  }
  return externalActor(candidate);
}

function assertSessionCoherence(session: AuthenticatedContentContext, realmKey: string): void {
  if (
    session.realm.kind !== "content" ||
    session.realm.status !== "active" ||
    session.realm.key !== realmKey ||
    session.membership.realmId !== session.realm.id ||
    session.membership.identityId !== session.identity.id ||
    session.membership.status !== "active"
  ) {
    throw new ApplicationError(
      "REALM_SESSION_MISMATCH",
      403,
      "The Content session does not belong to the requested Realm.",
    );
  }
}

async function activeMetadata(
  source: ContentRealmMetadataRouteSource,
  realmKey: string,
): Promise<{ readonly realm: IdentityRealmRecord; readonly identifierFieldIds: readonly string[] }> {
  const metadata = await source.getByKey(realmKey);
  if (
    metadata === null ||
    metadata.realm.kind !== "content" ||
    metadata.realm.status !== "active" ||
    metadata.realm.key !== realmKey
  ) {
    throw new ApplicationError(
      "CONTENT_REALM_UNAVAILABLE",
      404,
      "The Content Realm is unavailable.",
    );
  }
  if (
    metadata.realm.profileCollectionId === undefined ||
    metadata.identifierFieldIds.length === 0
  ) {
    throw new ApplicationError(
      "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
      503,
      "The Content Realm configuration is incomplete.",
    );
  }
  return metadata;
}

function parseCreateRealm(value: unknown): CreateIdentityRealmRequest {
  const body = exactObject(value, [
    "key",
    "name",
    "acceptSystemIdentities",
    "provisioning",
    "registration",
    "defaultRoleIds",
  ], "Identity Realm create request");
  const acceptSystemIdentities = optionalBoolean(body, "acceptSystemIdentities");
  const provisioning = optionalProvisioning(body, "provisioning");
  const registration = optionalRegistration(body, "registration");
  const defaultRoleIds = optionalStringArray(body, "defaultRoleIds");
  return {
    key: requiredString(body, "key"),
    name: requiredString(body, "name"),
    ...(acceptSystemIdentities === undefined ? {} : { acceptSystemIdentities }),
    ...(provisioning === undefined ? {} : { provisioning }),
    ...(registration === undefined ? {} : { registration }),
    ...(defaultRoleIds === undefined ? {} : { defaultRoleIds }),
  };
}

function parseCreateProfileSchema(value: unknown): CreateRealmProfileSchemaRequest {
  const body = exactObject(value, [
    "collectionName",
    "collectionLabel",
    "identifierFieldName",
    "includeDisplayName",
  ], "Realm Profile Schema create request");
  return {
    collectionName: requiredString(body, "collectionName"),
    collectionLabel: requiredString(body, "collectionLabel"),
    identifierFieldName: requiredString(body, "identifierFieldName"),
    includeDisplayName: requiredBoolean(body, "includeDisplayName"),
  };
}

function parseCreateProfileField(value: unknown): CreateRealmProfileFieldRequest {
  const body = exactObject(value, ["name", "label", "type"], "Realm Profile Field create request");
  const type = requiredString(body, "type");
  if (type !== "text" && type !== "textarea") {
    invalid("type must be 'text' or 'textarea'.");
  }
  return {
    name: requiredString(body, "name"),
    label: requiredString(body, "label"),
    type,
  };
}

function parseUpdateRealm(value: unknown): UpdateIdentityRealmRequest {
  const body = exactObject(value, [
    "expectedRevision",
    "name",
    "status",
    "acceptSystemIdentities",
    "provisioning",
    "registration",
    "defaultRoleIds",
  ], "Identity Realm update request");
  const status = requiredString(body, "status");
  if (status !== "active" && status !== "disabled") {
    invalid("status must be 'active' or 'disabled'.");
  }
  return {
    expectedRevision: positiveRevision(body, "expectedRevision"),
    name: requiredString(body, "name"),
    status,
    acceptSystemIdentities: requiredBoolean(body, "acceptSystemIdentities"),
    provisioning: requiredProvisioning(body, "provisioning"),
    registration: requiredRegistration(body, "registration"),
    defaultRoleIds: requiredStringArray(body, "defaultRoleIds"),
  };
}

function parseMembershipUpdate(value: unknown): UpdateRealmMembershipRequest {
  const body = exactObject(value, ["expectedRevision", "status"], "Membership update request");
  const status = requiredString(body, "status");
  if (status !== "active" && status !== "suspended") {
    invalid("status must be 'active' or 'suspended'.");
  }
  return {
    expectedRevision: positiveRevision(body, "expectedRevision"),
    status,
  };
}

function parseMembershipProvision(value: unknown): ProvisionRealmMembershipRequest {
  const body = exactObject(
    value,
    ["globalIdentityId", "profile", "password"],
    "Membership provisioning request",
  );
  return {
    globalIdentityId: requiredString(body, "globalIdentityId"),
    profile: recordValue(body["profile"], "profile"),
    password: requiredString(body, "password"),
  };
}

function parseMembershipRegister(value: unknown): RegisterRealmMembershipRequest {
  const body = exactObject(
    value,
    ["identifier", "password", "profile", "reauthPassword"],
    "Membership register request",
  );
  return {
    identifier: requiredString(body, "identifier"),
    password: requiredString(body, "password"),
    profile: recordValue(body["profile"], "profile"),
    reauthPassword: requiredString(body, "reauthPassword"),
  };
}

function parseGrantAdministrator(value: unknown): GrantRealmAdministratorRequest {
  const body = exactObject(value, ["reauthPassword"], "Grant administrator request");
  return {
    reauthPassword: requiredString(body, "reauthPassword"),
  };
}

function parseRevokeAdministrator(value: unknown): RevokeRealmAdministratorRequest {
  const body = exactObject(value, ["reauthPassword"], "Revoke administrator request");
  return {
    reauthPassword: requiredString(body, "reauthPassword"),
  };
}

function parseOwnerCommand(
  value: unknown,
  allowTransferOptions: boolean,
): TransferRealmOwnerRequest {
  const body = exactObject(value, allowTransferOptions
    ? [
        "targetMembershipId",
        "expectedPolicyRevision",
        "reason",
        "password",
        "revokePreviousSessions",
        "suspendPreviousMembership",
      ]
    : ["targetMembershipId", "expectedPolicyRevision", "reason", "password"],
  "Realm Owner command request");
  const revokePreviousSessions = allowTransferOptions
    ? optionalBoolean(body, "revokePreviousSessions")
    : undefined;
  const suspendPreviousMembership = allowTransferOptions
    ? optionalBoolean(body, "suspendPreviousMembership")
    : undefined;
  return {
    targetMembershipId: requiredString(body, "targetMembershipId"),
    expectedPolicyRevision: positiveRevision(body, "expectedPolicyRevision"),
    reason: requiredString(body, "reason"),
    password: requiredString(body, "password"),
    ...(revokePreviousSessions === undefined ? {} : { revokePreviousSessions }),
    ...(suspendPreviousMembership === undefined ? {} : { suspendPreviousMembership }),
  };
}

interface ParsedFullAccessGrant {
  readonly reason: string;
  readonly password: string;
  readonly validUntil: string;
}

function parseFullAccessGrant(value: unknown): ParsedFullAccessGrant {
  const body = exactObject(value, [
    "reason",
    "password",
    "validUntil",
  ], "Full Access grant request");
  return {
    reason: requiredString(body, "reason"),
    password: requiredString(body, "password"),
    validUntil: requiredString(body, "validUntil"),
  };
}

function parseFullAccessRevoke(value: unknown): { readonly password: string } {
  const body = exactObject(value, ["password"], "Full Access revoke request");
  return { password: requiredString(body, "password") };
}

function parseSignup(value: unknown): ContentRealmSignupRequest {
  const body = exactObject(value, ["identifier", "password", "profile"], "Realm signup request");
  return {
    identifier: requiredString(body, "identifier"),
    password: requiredString(body, "password"),
    profile: recordValue(body["profile"], "profile"),
  };
}

function parseLogin(value: unknown): ContentRealmLoginRequest {
  const body = exactObject(value, ["identifier", "password", "jitProfile"], "Realm login request");
  const jitProfile = body["jitProfile"] === undefined
    ? undefined
    : recordValue(body["jitProfile"], "jitProfile");
  return {
    identifier: requiredString(body, "identifier"),
    password: requiredString(body, "password"),
    ...(jitProfile === undefined ? {} : { jitProfile }),
  };
}

function parseProfileUpdate(value: unknown): UpdateContentRealmProfileRequest {
  const body = exactObject(value, ["expectedRevision", "data"], "Realm Profile update request");
  return {
    expectedRevision: positiveRevision(body, "expectedRevision"),
    data: recordValue(body["data"], "data"),
  };
}

function parseCreateDocument(value: unknown): CreateDocumentRequest {
  const body = exactObject(value, ["data", "hierarchy"], "Document create request");
  const data = recordValue(body["data"], "data");
  if (body["hierarchy"] === undefined) return { data };
  const hierarchy = exactObject(
    body["hierarchy"],
    ["parentId", "position", "expectedVersion"],
    "Document hierarchy placement",
  );
  const parentId = hierarchy["parentId"];
  if (parentId !== null && typeof parentId !== "string") {
    invalid("parentId must be a string or null.");
  }
  return {
    data,
    hierarchy: {
      parentId,
      position: nonNegativeInteger(hierarchy, "position"),
      expectedVersion: nonNegativeInteger(hierarchy, "expectedVersion"),
    },
  };
}

function parseUpdateDocument(value: unknown): UpdateDocumentRequest {
  const body = exactObject(value, ["data", "expectedVersion"], "Document update request");
  return {
    data: recordValue(body["data"], "data"),
    expectedVersion: positiveRevision(body, "expectedVersion"),
  };
}

function paginationQuery(value: unknown): { readonly page?: number; readonly pageSize?: number } {
  const query = exactObject(value, ["page", "pageSize"], "Document list query");
  const page = optionalPositiveInteger(query, "page");
  const pageSize = optionalPositiveInteger(query, "pageSize");
  if (pageSize !== undefined && pageSize > 100) invalid("pageSize must not exceed 100.");
  return {
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
}

function toRealmDto(realm: IdentityRealmRecord): IdentityRealmDto {
  return {
    realmId: realm.id,
    realmKey: realm.key,
    name: realm.name,
    kind: realm.kind,
    status: realm.status,
    ...(realm.profileCollectionId === undefined
      ? {}
      : { profileCollectionId: realm.profileCollectionId }),
    authentication: realm.authentication,
    revision: realm.revision,
    createdAt: realm.createdAt,
    createdBy: realm.createdBy,
    updatedAt: realm.updatedAt,
    updatedBy: realm.updatedBy,
  };
}

function toMembershipDto(membership: RealmMembershipRecord): RealmMembershipDto {
  return {
    membershipId: membership.id,
    globalIdentityId: membership.identityId,
    realmId: membership.realmId,
    subjectId: membership.subjectId,
    ...(membership.profileCollectionId === undefined
      ? {}
      : { profileCollectionId: membership.profileCollectionId }),
    ...(membership.profileDocumentId === undefined
      ? {}
      : { profileDocumentId: membership.profileDocumentId }),
    status: membership.status,
    provisionedBy: membership.provisionedBy,
    revision: membership.revision,
    createdAt: membership.createdAt,
    ...(membership.activatedAt === undefined ? {} : { activatedAt: membership.activatedAt }),
    ...(membership.suspendedAt === undefined ? {} : { suspendedAt: membership.suspendedAt }),
    ...((membership as RealmAdministrationMembershipRecord).realmAdministrator === undefined
      ? {}
      : {
          realmAdministrator:
            (membership as RealmAdministrationMembershipRecord).realmAdministrator === true,
        }),
    ...(membership.identity === undefined
      ? {}
      : {
          identity: {
            globalIdentityId: membership.identity.id,
            kind: membership.identity.kind,
            isOwner: membership.identity.isOwner === true,
            primaryIdentifier: membership.identity.primaryIdentifier,
            originRealmId: membership.identity.originRealmId,
            credentialVersion: membership.identity.credentialVersion,
            ...(membership.identity.disabledAt === undefined
              ? {}
              : { disabledAt: membership.identity.disabledAt }),
          },
        }),
  };
}

function toFullAccessDto(binding: RealmFullAccessBindingRecord): RealmFullAccessBindingDto {
  return {
    bindingId: binding.id,
    realmId: binding.realmId,
    systemIdentityId: binding.systemIdentityId,
    grantedByGlobalIdentityId: binding.grantedByIdentityId,
    reason: binding.reason,
    createdAt: binding.createdAt,
    validUntil: binding.validUntil,
    ...(binding.revokedAt === undefined ? {} : { revokedAt: binding.revokedAt }),
    ...(binding.revokedByIdentityId === undefined
      ? {}
      : { revokedByGlobalIdentityId: binding.revokedByIdentityId }),
    ...(binding.terminationReason === undefined
      ? {}
      : { terminationReason: binding.terminationReason }),
  };
}

function toMetadataDto(input: {
  readonly realm: IdentityRealmRecord;
  readonly identifierFieldIds: readonly string[];
}): ContentRealmMetadataDto {
  return {
    realmId: input.realm.id,
    realmKey: input.realm.key,
    name: input.realm.name,
    profileCollectionId: input.realm.profileCollectionId!,
    identifierFieldIds: input.identifierFieldIds,
    acceptSystemIdentities: input.realm.authentication.acceptSystemIdentities,
    provisioning: input.realm.authentication.provisioning,
    registration: input.realm.authentication.registration,
    revision: input.realm.revision,
  };
}

function authenticatedSessionDto(
  session: AuthenticatedContentRealmSession,
): ContentAuthenticatedSessionDto {
  assertSessionCoherence(session, session.realm.key);
  return {
    authenticated: true,
    globalIdentityId: session.identity.id,
    realmId: session.realm.id,
    realmKey: session.realm.key,
    membershipId: session.membership.id,
    subjectId: session.membership.subjectId,
    ...(session.membership.profileDocumentId === undefined
      ? {}
      : { profileDocumentId: session.membership.profileDocumentId }),
    realmRevision: session.realm.revision,
    membershipRevision: session.membership.revision,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  };
}

function anonymousSessionDto(input: {
  readonly realm: IdentityRealmRecord;
}): ContentAnonymousSessionDto {
  return {
    authenticated: false,
    realmId: input.realm.id,
    realmKey: input.realm.key,
    realmRevision: input.realm.revision,
  };
}

function profileDto(
  context: ContentRealmProfileContext,
  profile: ContentRealmProfileValue,
): ContentRealmProfileDto {
  return {
    realmId: context.realmId,
    realmKey: context.realmKey,
    membershipId: context.membershipId,
    subjectId: context.subjectId,
    profileDocumentId: context.profileDocumentId,
    data: profile.data,
    revision: profile.revision,
  };
}

function setContentSessionCookie(
  reply: FastifyReply,
  options: Pick<RegisterIdentityRealmRoutesOptions, "secureCookies">,
  cookieName: string,
  realmKey: string,
  session: Pick<AuthenticatedContentRealmSession, "sessionToken" | "expiresAt">,
): void {
  reply.setCookie(cookieName, session.sessionToken, {
    path: contentRealmCookiePath(realmKey),
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: "lax",
    expires: new Date(session.expiresAt),
  });
}

function clearContentSessionCookie(
  reply: FastifyReply,
  options: Pick<RegisterIdentityRealmRoutesOptions, "secureCookies">,
  cookieName: string,
  realmKey: string,
): void {
  reply.clearCookie(cookieName, {
    path: contentRealmCookiePath(realmKey),
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: "lax",
  });
}

function contentRealmCookiePath(realmKey: string): string {
  return `/api/content-realms/${encodeURIComponent(realmKey)}`;
}

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}

function trustedReauthenticationTimestamp(value: {
  readonly reauthenticatedAt: string;
}): string {
  if (
    typeof value.reauthenticatedAt !== "string" ||
    value.reauthenticatedAt.length === 0 ||
    !Number.isFinite(Date.parse(value.reauthenticatedAt))
  ) {
    throw new ApplicationError(
      "SYSTEM_REAUTHENTICATION_RESULT_INVALID",
      500,
      "The System reauthentication adapter returned an invalid result.",
    );
  }
  return value.reauthenticatedAt;
}

function externalActor(actor: ActorContext): ActorContext {
  return {
    subjectId: actor.subjectId,
    ...(actor.identityId === undefined ? {} : { identityId: actor.identityId }),
    workspaceId: actor.workspaceId,
    ...(actor.realmId === undefined ? {} : { realmId: actor.realmId }),
    capabilities: actor.capabilities,
    ...(actor.authorization === undefined ? {} : { authorization: actor.authorization }),
    ...(actor.authentication === undefined ? {} : { authentication: actor.authentication }),
  };
}

function pathParams<TName extends string>(
  value: unknown,
  names: readonly TName[],
): Readonly<Record<TName, string>> {
  const params = exactObject(value, names, "route parameters");
  const output = {} as Record<TName, string>;
  for (const name of names) output[name] = requiredString(params, name);
  return output;
}

function exactObject<TName extends string>(
  value: unknown,
  allowedKeys: readonly TName[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be a JSON object.`);
  }
  const object = value as Readonly<Record<string, unknown>>;
  const unexpected = Object.keys(object).find((key) => !allowedKeys.includes(key as TName));
  if (unexpected !== undefined) {
    invalid(`${label} contains an unexpected '${unexpected}' property.`);
  }
  return object;
}

function requiredString(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(
  body: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  if (body[key] === undefined) return undefined;
  return requiredString(body, key);
}

function requiredBoolean(body: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") invalid(`${key} must be a boolean.`);
  return value;
}

function optionalBoolean(
  body: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  if (body[key] === undefined) return undefined;
  return requiredBoolean(body, key);
}

function positiveRevision(body: Readonly<Record<string, unknown>>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid(`${key} must be a positive safe integer.`);
  }
  return value as number;
}

function nonNegativeInteger(body: Readonly<Record<string, unknown>>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${key} must be a non-negative safe integer.`);
  }
  return value as number;
}

function optionalPositiveInteger(
  body: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  const value = typeof raw === "string" && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : raw;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid(`${key} must be a positive safe integer.`);
  }
  return value as number;
}

function requiredProvisioning(
  body: Readonly<Record<string, unknown>>,
  key: string,
): "explicit" | "jit" {
  const value = requiredString(body, key);
  if (value !== "explicit" && value !== "jit") {
    invalid(`${key} must be 'explicit' or 'jit'.`);
  }
  return value;
}

function optionalProvisioning(
  body: Readonly<Record<string, unknown>>,
  key: string,
): "explicit" | "jit" | undefined {
  if (body[key] === undefined) return undefined;
  return requiredProvisioning(body, key);
}

function requiredRegistration(
  body: Readonly<Record<string, unknown>>,
  key: string,
): "closed" | "open" {
  const value = requiredString(body, key);
  if (value !== "closed" && value !== "open") {
    invalid(`${key} must be 'closed' or 'open'.`);
  }
  return value;
}

function optionalRegistration(
  body: Readonly<Record<string, unknown>>,
  key: string,
): "closed" | "open" | undefined {
  if (body[key] === undefined) return undefined;
  return requiredRegistration(body, key);
}

function requiredStringArray(
  body: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = body[key];
  if (!Array.isArray(value)) invalid(`${key} must be an array.`);
  const result = value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      invalid(`${key}[${index}] must be a non-empty string.`);
    }
    return item as string;
  });
  if (new Set(result).size !== result.length) invalid(`${key} must not contain duplicates.`);
  return result;
}

function optionalStringArray(
  body: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined {
  if (body[key] === undefined) return undefined;
  return requiredStringArray(body, key);
}

function recordValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(detail: string): never {
  throw new ApplicationError("IDENTITY_REALM_REQUEST_INVALID", 400, detail);
}
