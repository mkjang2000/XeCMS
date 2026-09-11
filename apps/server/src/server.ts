import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import examplePlugin from "@xecms/example-plugin";
import fastifyStatic from "@fastify/static";
import {
  ApplicationError,
  AdminAppApplicationService,
  AdminAppRuntimeApplicationService,
  CatalogAdminAppDependencyResolver,
  AuthorizationApplicationService,
  AuthApplicationService,
  BasicMediaTypeInspector,
  ContentRealmAuthenticationService,
  ContentRealmAuthorizationProvisioner,
  ContentHierarchyApplicationService,
  DurableRealmIdentityProvisioner,
  DocumentApplicationService,
  DocumentLifecycleHookRegistry,
  EventWorkerService,
  IdentityAdministrationService,
  CrossRealmManagementService,
  IdentityRealmApplicationService,
  WorkspaceSettingsService,
  SiteService,
  RetentionService,
  UnifiedAuditService,
  MediaApplicationService,
  PluginCatalog,
  PluginService,
  normalizeIdentityIdentifier,
  OWNER_CAPABILITIES,
  RelationApplicationService,
  SchemaArtifactApplicationService,
  SchemaApplicationService,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_AUTHORIZATION_RESOURCE_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  createCoreMaskPolicyRegistry,
  realmAuthorizationRootResourceId,
  type AuthorizationPolicyManagementActor,
  type ActorContext,
  type RealmAdministrationActor,
  type RealmProfileProvisioner,
} from "@xecms/application";
import type {
  AuthenticatedSessionDto,
  DocumentQueryResultDto,
  DocumentTreeDto,
  MoveDocumentResultDto,
  MoveDocumentPreviewDto,
  SchemaRevisionEnvelopeDto,
  SessionDto,
} from "@xecms/contracts";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  LocalMediaStorage,
  PostgresDatabase,
  PostgresAuthorizationStore,
  PostgresRealmCollectionEntitlementStore,
  PostgresRealmManagementDelegationStore,
  PostgresAdminAppStore,
  PostgresContentHierarchyStore,
  PostgresIdentityRealmStore,
  PostgresIdentityAdministrationStore,
  PostgresWorkspaceSettingsStore,
  PostgresSiteStore,
  PostgresRetentionStore,
  PostgresUnifiedAuditStore,
  PostgresEventWorkerStore,
  PostgresMediaStore,
  PostgresPluginStore,
  PostgresMigrationPlanner,
  PostgresRelationStore,
  ScryptPasswordHasher,
  qualifiedName,
} from "@xecms/database";
import { starterSchema, type CollectionDefinition, type SchemaIrV1 } from "@xecms/schema";
import { pluginManifestDigest, type XeCmsPluginModule } from "@xecms/plugin-sdk";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { ServerLifecycle } from "./server-lifecycle.js";
import { registerAuthorizationRoutes } from "./authorization-routes.js";
import { registerIdentityRealmRoutes } from "./identity-realm-routes.js";
import { registerIdentityAdministrationRoutes } from "./identity-administration-routes.js";
import { registerJobRoutes } from "./job-routes.js";
import { registerSiteRoutes } from "./site-routes.js";
import { registerOperationsRoutes } from "./operations-routes.js";
import { registerPluginRoutes } from "./plugin-routes.js";
import { registerAdminAppRoutes } from "./admin-app-routes.js";
import { registerAdminAppRuntimeRoutes } from "./admin-app-runtime-routes.js";
import { LoginRateLimiter } from "./rate-limit.js";
import { createApplicationRuntime, createSecurityRuntime } from "./security.js";
import { parseDocumentQueryRequest } from "./document-query-request.js";
import {
  parseEvaluateAccessBatchRequest,
  toEvaluateAccessBatchResponse,
} from "./access-evaluation-request.js";
import {
  requireActorBase,
  authorizationActor,
  authorizationGateway,
  requireSession,
  assertAllowedOrigin,
  assertAllowedContentOrigin,
  setSessionCookie,
  clearSessionCookie,
  sessionDto,
  SESSION_COOKIE,
} from "./request-authentication.js";
import {
  authorizationRealmIdFromRequest,
  isRealmAdministrationReadOperation,
  isIndividuallyAuditedRealmAdministrationRead,
  requireLocalRealmAdministrationRouteAccess,
  accountProfileActor,
  assertOwnRealmProfile,
  toCrossRealmTarget,
} from "./realm-administration-helpers.js";
import {
  revisionDto,
  presentTree,
  mediaRecordDto,
  incompleteMediaRecordDto,
  documentDto,
  problemDetails,
} from "./response-presenters.js";
import {
  byteStream,
  singleHeader,
  credentials,
  setupTemplateInput,
  objectBody,
  nonNegativeInteger,
  nullableString,
  badRequest,
} from "./request-input.js";
import { registerSystemRoutes } from "./system-routes.js";
import { registerSchemaRoutes } from "./schema-routes.js";
import { registerMediaRoutes } from "./media-routes.js";
import { registerDocumentRoutes } from "./document-routes.js";
import { createSchemaProjectionCoordinator } from "./schema-projection.js";
import { createRealmProfileSchemaCommands } from "./realm-profile-schema.js";
import { createAdminRuntimeAuthenticator } from "./admin-runtime-authentication.js";
import { createContentHierarchyRuntime } from "./content-hierarchy-runtime.js";

function pluginExtensionIds(module: XeCmsPluginModule): ReadonlySet<string> {
  const extensions = module.manifest.extensions;
  return new Set([
    ...(extensions?.permissions ?? []),
    ...(extensions?.fields ?? []).map(({ id }) => id),
    ...(extensions?.routes ?? []).map(({ id }) => id),
    ...(extensions?.hooks ?? []),
    ...(extensions?.eventHandlers ?? []),
    ...(extensions?.adminSlots ?? []).map(({ id }) => id),
    ...(module.admin?.cards ?? []).map(({ id }) => id),
  ]);
}

export interface BuildServerOptions {
  readonly config?: ServerConfig;
  readonly database?: PostgresDatabase;
  readonly logger?: boolean;
  readonly plugins?: readonly XeCmsPluginModule[];
  readonly shutdownTimeoutMs?: number;
}

export interface XeCmsServer {
  readonly app: FastifyInstance;
  readonly database: PostgresDatabase;
  readonly config: ServerConfig;
  close(): Promise<void>;
}

/**
 * Plugin packages this build ships. Exported so tooling that has to reason
 * about installed Plugins without a running server (the CLI recovery path for
 * manifest drift) sees exactly the catalogue the server would load.
 */
export const DEFAULT_PLUGIN_MODULES: readonly XeCmsPluginModule[] = [examplePlugin];

export async function buildServer(options: BuildServerOptions = {}): Promise<XeCmsServer> {
  const config = options.config ?? loadServerConfig();
  const database =
    options.database ??
    new PostgresDatabase({
      connectionString: config.databaseUrl,
      schema: config.databaseSchema,
    });
  const lifecycle = new ServerLifecycle(options.database === undefined ? database : undefined, options.shutdownTimeoutMs);
  try {
    return await assembleServer(options, config, database, lifecycle);
  } catch (error: unknown) {
    try {
      await lifecycle.close();
    } catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "Server startup failed and cleanup was incomplete.", { cause: error });
    }
    throw error;
  }
}

async function assembleServer(
  options: BuildServerOptions,
  config: ServerConfig,
  database: PostgresDatabase,
  lifecycle: ServerLifecycle,
): Promise<XeCmsServer> {
  const pluginModules = options.plugins ?? [...DEFAULT_PLUGIN_MODULES];
  const pluginCatalog = new PluginCatalog(pluginModules);
  await database.migrate();

  const securityRuntime = createSecurityRuntime(config.sessionSecret);
  const passwordHasher = new ScryptPasswordHasher();
  const auth = new AuthApplicationService(database, passwordHasher, securityRuntime);
  const identityRealmStore = new PostgresIdentityRealmStore(database.pool, database.schema);
  const identityAdministrationStore = new PostgresIdentityAdministrationStore(
    database.pool,
    database.schema,
  );
  const identityAdministration = new IdentityAdministrationService(
    identityAdministrationStore,
    passwordHasher,
    {
      now: () => new Date().toISOString(),
      newIdentityId: securityRuntime.newIdentityId,
      newAuditId: () => `audit_${randomUUID()}`,
      newApiKeyId: () => `api_${randomUUID()}`,
      randomSecret: () => randomBytes(32).toString("base64url"),
      hashApiKey: (rawKey) => createHmac("sha256", config.sessionSecret)
        .update("api-key\0").update(rawKey).digest("base64url"),
      newCredentialTokenId: () => `credential_${randomUUID()}`,
      hashCredentialToken: (rawToken) => createHash("sha256").update(rawToken).digest("base64url"),
    },
  );
  const workspaceSettings = new WorkspaceSettingsService(
    new PostgresWorkspaceSettingsStore(database.pool, database.schema),
    () => new Date().toISOString(),
  );
  const sites = new SiteService(new PostgresSiteStore(database.pool, database.schema), {
    now: () => new Date().toISOString(), newSiteId: () => `site_${randomUUID()}`,
  });
  const pluginStore=new PostgresPluginStore(database.pool,database.schema);
  const desiredPlugins=await pluginStore.list(DEFAULT_WORKSPACE_ID);
  const loadedPluginIds=new Set(desiredPlugins.filter(record=>record.desiredState==="enabled").map(record=>record.pluginId));
  const loadedPluginModules=pluginModules.filter(module=>loadedPluginIds.has(module.manifest.id));
  const plugins=new PluginService(pluginStore,pluginCatalog,{now:()=>new Date().toISOString(),newPlanId:()=>`plugin_plan_${randomUUID()}`,loadedPluginIds});
  await plugins.assertStartupState(DEFAULT_WORKSPACE_ID);
  for(const module of loadedPluginModules){const health=await module.server?.health?.();if(health?.status==="degraded")throw new ApplicationError("PLUGIN_STARTUP_HEALTH_FAILED",503,`Plugin '${module.manifest.id}' startup health check failed: ${health.detail??"degraded"}. Run xecms plugin inspect, then xecms plugin disable ${module.manifest.id} --offline to recover.`)}
  await plugins.reconcileRuntime(DEFAULT_WORKSPACE_ID);
  const authorizationStore = new PostgresAuthorizationStore(database.pool, database.schema);
  const entitlementStore = new PostgresRealmCollectionEntitlementStore(database.pool, database.schema);
  const delegationStore = new PostgresRealmManagementDelegationStore(database.pool, database.schema);
  const crossRealmManagementService = new CrossRealmManagementService(delegationStore);
  const adminAppStore = new PostgresAdminAppStore(database.pool, database.schema);
  const adminAppDependencyResolver = new CatalogAdminAppDependencyResolver({
      getActiveSchema: async (workspaceId) => {
        if (workspaceId !== DEFAULT_WORKSPACE_ID) return null;
        const active = await database.getActiveSchema();
        return active === null ? null : {
          revisionId: active.revisionId, hash: active.hash, schema: active.schema,
        };
      },
      getRealm: async (workspaceId, realmId) => {
        const realm = await identityRealmStore.getRealmById(realmId);
        return realm === null || realm.workspaceId !== workspaceId ? null : realm;
      },
      getAuthorization: async (workspaceId, realmId) => {
        const realm = await identityRealmStore.getRealmById(realmId);
        if (realm === null || realm.workspaceId !== workspaceId) return null;
        const policy = await authorizationStore.loadPolicy(realmId);
        return policy === null ? null : {
          realmId,
          revision: policy.revision,
          permissionKeys: new Set(policy.permissions.map(({ key }) => key)),
          resourceIds: new Set(policy.resources.map(({ id }) => id)),
        };
      },
      getPlugin: async (workspaceId, pluginId) => {
        if (!pluginCatalog.has(pluginId)) return null;
        const module = pluginCatalog.get(pluginId);
        const installed = await pluginStore.get(workspaceId, pluginId);
        return {
          id: pluginId,
          version: module.manifest.version,
          manifestDigest: pluginManifestDigest(module.manifest),
          ...(installed === null ? {} : { installedManifestDigest: installed.manifestDigest }),
          installed: installed !== null,
          enabled: installed?.desiredState === "enabled",
          runtimeLoaded: loadedPluginIds.has(pluginId),
          extensionIds: pluginExtensionIds(module),
        };
      },
    });
  const adminApps = new AdminAppApplicationService(
    adminAppStore,
    adminAppDependencyResolver,
    {
      now: () => new Date().toISOString(),
      newAppId: () => `aap_${randomUUID()}`,
      newRevisionId: () => `aar_${randomUUID()}`,
    },
  );
  const unifiedAudit = new UnifiedAuditService(
    new PostgresUnifiedAuditStore(database.pool, database.schema),
  );
  const retention = new RetentionService(
    new PostgresRetentionStore(database.pool, database.schema),
    { now: () => new Date().toISOString(), newPlanId: () => `retention_${randomUUID()}` },
  );
  const requireActor = (
    request: FastifyRequest,
    authService: AuthApplicationService,
    authorizationService: AuthorizationApplicationService,
    serverConfig: ServerConfig,
    requireCsrf: boolean,
  ) => requireActorBase(
    request,
    authService,
    authorizationService,
    identityAdministration,
    serverConfig,
    requireCsrf,
  );
  const authorization = new AuthorizationApplicationService(authorizationStore, {
    now: () => new Date().toISOString(),
    newAuditId: () => `audit_${randomUUID()}`,
    newId: (prefix) => `${prefix}_${randomUUID()}`,
  }, entitlementStore);
  const adminAppRuntime = new AdminAppRuntimeApplicationService(
    adminAppStore,
    adminAppDependencyResolver,
    () => new Date().toISOString(),
  );
  const realmAuthorization = new ContentRealmAuthorizationProvisioner(authorization);
  const hierarchyStore = new PostgresContentHierarchyStore(database.pool, database.schema);
  const ensureAuthorizationPolicy = async (owner: {
    readonly id: string;
    readonly username: string;
  }): Promise<void> => {
    if (await authorizationStore.getPolicyRevision(SYSTEM_AUTHORIZATION_REALM_ID) === null) {
      await authorization.initialize({
        realmId: SYSTEM_AUTHORIZATION_REALM_ID,
        realmName: "System Realm",
        rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
        rootResourceName: DEFAULT_WORKSPACE_NAME,
        ownerSubjectId: owner.id,
        ownerIdentityId: owner.id,
        ownerSubjectName: owner.username,
      });
    }
  };
  const schema = new SchemaApplicationService(
    database,
    new PostgresMigrationPlanner(config.databaseSchema),
    () => new Date().toISOString(),
  );
  const schemaArtifacts = new SchemaArtifactApplicationService(
    database,
    () => new Date().toISOString(),
  );
  const relations = new RelationApplicationService(
    new PostgresRelationStore(database.pool, database.schema),
  );
  const lifecycleHooks = new DocumentLifecycleHookRegistry();
  for(const module of loadedPluginModules)for(const hook of module.server?.hooks??[])lifecycleHooks.register({id:hook.id,...(hook.priority===undefined?{}:{priority:hook.priority}),stages:hook.stages,run:(context)=>hook.run(context as unknown as Readonly<Record<string,unknown>>) });
  const documents = new DocumentApplicationService(
    database,
    database,
    createApplicationRuntime(),
    relations,
    lifecycleHooks,
  );
  const eventStore = new PostgresEventWorkerStore(database.pool, database.schema);
  const searchHandlerId = "core.search-projection";
  const eventWorker = new EventWorkerService(eventStore, [{
    id: searchHandlerId,
    topics: [
      "document.created",
      "document.draft-created",
      "document.revision-restored",
      "document.deleted",
      "document.purged",
    ],
    handle: (event, context) => eventStore.applySearchProjection(event, {
      ...context,
      handlerId: searchHandlerId,
      now: new Date().toISOString(),
    }),
  },...loadedPluginModules.flatMap(module=>(module.server?.eventHandlers??[]).map(handler=>({id:handler.id,topics:handler.topics,handle:(event:import("@xecms/application").DurableEvent,context:{readonly idempotencyKey:string;readonly deliveryId:string})=>handler.handle(event as unknown as Readonly<Record<string,unknown>>,context)})))], {
    now: () => new Date().toISOString(),
    workerId: `worker_${process.pid}_${randomUUID()}`,
    leaseMs: config.workerLeaseMs,
    batchSize: config.workerBatchSize,
    maxAttempts: config.workerMaxAttempts,
  });
  lifecycle.attachWorker(eventWorker);
  const realmProfileProvisioner: RealmProfileProvisioner = {
    createProfile: async (input) => {
      const collectionId = input.realm.profileCollectionId;
      const active = await database.getActiveSchema();
      const collection = active?.schema.collections.find(({ id }) => String(id) === collectionId);
      if (
        collectionId === undefined ||
        collection === undefined ||
        collection.auth?.realmKey !== input.realm.key
      ) {
        throw new ApplicationError(
          "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
          503,
          "The active Auth Collection for this Content Realm is unavailable.",
        );
      }
      const primaryFieldId = collection.auth.identifierFieldIds[0];
      const primaryField = collection.fields.find(({ id }) => id === primaryFieldId);
      if (primaryField === undefined) {
        throw new ApplicationError(
          "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
          503,
          "The primary Realm identifier Field is unavailable.",
        );
      }
      const existing = await database.pool.query<{ readonly id: string; readonly data: unknown }>(
        `SELECT document.id, revision.data
           FROM ${qualifiedName(database.schema, "_xecms_documents")} document
           JOIN ${qualifiedName(database.schema, "_xecms_document_revisions")} revision
             ON revision.id = document.current_draft_revision_id
          WHERE document.workspace_id = $1
            AND document.collection_id = $2
            AND document.created_by = $3
            AND document.deletion IS NULL
          ORDER BY document.created_at ASC`,
        [input.realm.workspaceId, collectionId, input.membership.subjectId],
      );
      const recovered = existing.rows.filter(({ data }) => {
        if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
        const value = (data as Readonly<Record<string, unknown>>)[primaryField.name];
        return typeof value === "string" && normalizeIdentityIdentifier(value) === input.identifier.normalized;
      });
      if (recovered.length === 1) {
        return { collectionId, documentId: recovered[0]!.id };
      }
      if (recovered.length > 1) {
        throw new ApplicationError(
          "IDENTITY_REALM_PROFILE_CONFLICT",
          409,
          "Multiple profile Documents exist for the pending Realm Membership.",
        );
      }
      const profile = await documents.create({
        subjectId: input.membership.subjectId,
        identityId: input.membership.identityId,
        workspaceId: input.realm.workspaceId,
        realmId: input.realm.id,
        capabilities: OWNER_CAPABILITIES,
        execution: "identity-provisioning",
      }, collectionId, {
        ...input.profile,
        [primaryField.name]: input.identifier.display,
      });
      return { collectionId, documentId: profile.id };
    },
  };
  const realmRuntime = {
    ...securityRuntime,
    newRealmId: () => `rlm_${randomUUID()}`,
    newFullAccessId: () => `full_access_${randomUUID()}`,
  };
  const realmIdentityProvisioner = new DurableRealmIdentityProvisioner(
    identityRealmStore,
    realmAuthorization,
    realmProfileProvisioner,
    {
      now: () => new Date().toISOString(),
      newIdentityId: securityRuntime.newIdentityId,
      newMembershipId: () => `membership_${randomUUID()}`,
      newSubjectId: (realmId, identityId) => {
        const digest = createHash("sha256")
          .update(realmId)
          .update("\0")
          .update(identityId)
          .digest("hex")
          .slice(0, 32);
        return `authorization:${realmId}:subject:identity:${digest}`;
      },
    },
  );
  const identityRealms = new IdentityRealmApplicationService(
    identityRealmStore,
    realmRuntime,
    realmIdentityProvisioner,
    passwordHasher,
    {
      getPrimaryOwner: async (realmId) => {
        const realm = await identityRealmStore.getRealmById(realmId);
        if (realm === null) {
          throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
        }
        return realmAuthorization.getPrimaryOwner(realm);
      },
      setPrimaryOwner: async (actor, input) => {
        const realm = await identityRealmStore.getRealmById(actor.realmId);
        if (realm === null) {
          throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
        }
        return realmAuthorization.setPrimaryOwner({ realm, actor, ...input });
      },
    },
    entitlementStore,
    delegationStore,
  );
  const contentRealmAuthentication = new ContentRealmAuthenticationService(
    identityRealmStore,
    passwordHasher,
    realmIdentityProvisioner,
    realmRuntime,
    DEFAULT_WORKSPACE_ID,
  );
  const hierarchy = new ContentHierarchyApplicationService(
    database,
    hierarchyStore,
    { now: () => new Date().toISOString() },
  );
  const { syncAuthorizationResources, reconcileAuthorizationHierarchy, applySchemaWithProjection } = createSchemaProjectionCoordinator({
    database,
    authorization,
    hierarchyStore,
    identityRealmStore,
    realmAuthorization,
    entitlementStore,
    sites,
    schema,
  });
  const { createContentDocument, treeDto, calculateMovePreview, moveHierarchyDocument } = createContentHierarchyRuntime({
    database, documents, hierarchy, authorization, sites, reconcileAuthorizationHierarchy,
  });
  const { createDefaultRealmProfileSchema, createDefaultRealmProfileField } = createRealmProfileSchemaCommands({
    config,
    identityRealms,
    identityRealmStore,
    schema,
    applySchemaWithProjection,
  });
  const existingOwner = await database.findOwnerIdentity();
  if (existingOwner !== null) {
    await ensureAuthorizationPolicy(existingOwner);
    const actor = authorizationActor(existingOwner.id);
    await database.withContentProjectionLock(async () => {
      const collections = (await database.getActiveSchema())?.schema.collections ?? [];
      await sites.reconcileCollections({
        workspaceId: DEFAULT_WORKSPACE_ID,
        activeCollectionIds: collections.map(({ id }) => String(id)),
        actorIdentityId: existingOwner.id,
        actorSubjectId: existingOwner.id,
      });
      await syncAuthorizationResources(actor, collections);
      await reconcileAuthorizationHierarchy(actor, collections, "startup");
      for (const realm of await identityRealmStore.listRealms(DEFAULT_WORKSPACE_ID)) {
        if (realm.kind !== "content" || realm.status === "disabled") continue;
        await realmAuthorization.ensureRealmPolicy(realm);
        await realmAuthorization.syncCollectionResources({
          realm,
          collections: collections.map(({ id, name }) => ({ id: String(id), name })),
        });
        // Keep entitlement ceilings in step with the projected collections at startup.
        await entitlementStore.reconcileRealmFromPolicy(realm.id, realm.workspaceId);
      }
    });
  }
  const mediaStore = new PostgresMediaStore(database.pool, database.schema);
  const media = new MediaApplicationService(
    mediaStore,
    new LocalMediaStorage(config.mediaStorageRoot),
    new BasicMediaTypeInspector(),
    {
      now: () => new Date().toISOString(),
      newMediaId: () => `media_${randomUUID()}`,
      storageKeyFor: (mediaId) => `objects/${mediaId}`,
    },
    {
      maxUploadBytes: config.mediaMaxUploadBytes,
      allowedMimeTypes: config.mediaAllowedMimeTypes,
    },
  );
  const limiter = new LoginRateLimiter();
  const app = Fastify({
    logger: options.logger ?? config.nodeEnv !== "test",
    // Keep ordinary JSON/text endpoints bounded independently from the media
    // stream, whose byte limit is enforced while writing to storage.
    bodyLimit: 1024 * 1024,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });
  lifecycle.attachApp(app);
  if (config.disableAdminOrigins) {
    app.log.warn("Admin Origin validation is disabled for this development process.");
  }
  await app.register(cookie);
  app.addContentTypeParser("*", (request, payload, done) => {
    const runtimeMediaUpload = /^\/api\/admin-apps\/runtime\/[^/]+\/media(?:\?|$)/.test(request.url);
    if ((request.url.startsWith("/api/media") || runtimeMediaUpload) && request.method === "POST") {
      done(null, payload);
      return;
    }
    done(new ApplicationError("CONTENT_TYPE_UNSUPPORTED", 415, "Unsupported Content-Type."), undefined);
  });

  // Policy mutation and hierarchy projection must be one linear history even
  // when requests hit different server instances. GET policy reads remain
  // lock-free; every authorization POST/PATCH/DELETE holds the same session
  // advisory lock used by topology+projection commands until the response.
  const authorizationMutationLocks = new WeakMap<FastifyRequest, () => Promise<void>>();
  const authorizationMutationSessions = new WeakMap<
    FastifyRequest,
    Awaited<ReturnType<typeof requireSession>>
  >();
  const releaseAuthorizationMutationLock = async (request: FastifyRequest): Promise<void> => {
    const release = authorizationMutationLocks.get(request);
    if (release === undefined) return;
    authorizationMutationLocks.delete(request);
    await release();
  };
  app.addHook("preHandler", async (request) => {
    if (
      (
        request.url.startsWith("/api/authorization/") ||
        /^\/api\/identity-realms\/[^/]+\/authorization(?:\/|\?)/.test(request.url)
      ) &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "OPTIONS"
    ) {
      // Authenticate and validate Origin+CSRF before joining the lock queue;
      // unauthenticated traffic cannot consume coordination capacity.
      authorizationMutationSessions.set(
        request,
        await requireSession(request, auth, config, true),
      );
      authorizationMutationLocks.set(request, await database.acquireContentProjectionLock());
    }
  });
  app.addHook("onError", async (request) => releaseAuthorizationMutationLock(request));
  app.addHook("onResponse", async (request) => releaseAuthorizationMutationLock(request));

  const recordedRealmOversightEntries = new Set<string>();
  const recordedRealmFullAccessEntries = new Set<string>();
  const resolveActiveRealmFullAccessActor = async (
    request: FastifyRequest,
    authenticated: Awaited<ReturnType<typeof requireSession>>,
    realmId: string,
    readOnlyOperation: boolean,
  ): Promise<Extract<RealmAdministrationActor, { readonly accessMode: "realm-full-access" }> | null> => {
    const now = new Date().toISOString();
    const activeFullAccess = await identityRealmStore.findActiveFullAccessBinding(
      realmId,
      authenticated.session.identity.id,
      now,
    );
    if (activeFullAccess === null) return null;
    const auditedRead = isIndividuallyAuditedRealmAdministrationRead(request);
    const sessionId = `session_${createHash("md5")
      .update(securityRuntime.hashToken(authenticated.sessionToken))
      .digest("hex")}`;
    const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "unknown";
    const entryKey = `${sessionId}\0${realmId}\0${activeFullAccess.id}`;
    if (!readOnlyOperation || auditedRead || !recordedRealmFullAccessEntries.has(entryKey)) {
      await identityRealmStore.recordRealmAdministrationEvent({
        event: !readOnlyOperation || auditedRead
          ? "REALM_FULL_ACCESS_OPERATION"
          : "REALM_FULL_ACCESS_ENTERED",
        systemIdentityId: authenticated.session.identity.id,
        realmId,
        accessMode: "realm-full-access",
        fullAccessBindingId: activeFullAccess.id,
        operation: `${request.method} ${route}`,
        requestId: request.id,
        sessionId,
        occurredAt: now,
        result: "authorized",
      });
      if (readOnlyOperation && !auditedRead) recordedRealmFullAccessEntries.add(entryKey);
    }
    return {
      accessMode: "realm-full-access",
      realmId,
      systemIdentityId: authenticated.session.identity.id,
      fullAccessBindingId: activeFullAccess.id,
      fullAccessValidUntil: activeFullAccess.validUntil,
    };
  };
  registerAuthorizationRoutes({
    app,
    authorization,
    realmId: SYSTEM_AUTHORIZATION_REALM_ID,
    requireAuthorizationActor: async (request, requireCsrf) => {
      const authenticated = authorizationMutationSessions.get(request) ??
        await requireSession(request, auth, config, requireCsrf);
      return authorizationActor(authenticated.session.identity.id);
    },
  });

  app.post("/api/access/evaluate-batch", async (request, reply) => {
    // This self-profile endpoint is intentionally session-only. Routing it
    // through a raw Subject while accepting an API key would ignore that key's
    // narrower scope ceiling and overstate the caller's effective access.
    const authenticated = await requireSession(request, auth, config, false);
    const evaluation = await authorization.evaluateBatch(
      authorizationActor(authenticated.session.identity.id),
      parseEvaluateAccessBatchRequest(request.body),
    );
    reply.header("cache-control", "private, no-store");
    return toEvaluateAccessBatchResponse(evaluation);
  });

  registerJobRoutes({
    app,
    worker: eventWorker,
    authorization,
    resourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
    requireActor: async (request, requireCsrf) => {
      const authenticated = await requireSession(request, auth, config, requireCsrf);
      return authorizationActor(authenticated.session.identity.id);
    },
  });

  registerIdentityAdministrationRoutes({
    app,
    identities: identityAdministration,
    authorization,
    requireActor: async (request, requireCsrf) =>
      (await requireActor(request, auth, authorization, config, requireCsrf)).actor,
    currentSessionId: async (request) => {
      const authenticated = await requireSession(request, auth, config, false);
      return `session_${createHash("md5").update(securityRuntime.hashToken(authenticated.sessionToken)).digest("hex")}`;
    },
    verifySystemReauthentication: async (request, actor, password) => {
      const authenticated = await requireSession(request, auth, config, false);
      if ((actor.identityId ?? actor.subjectId) !== authenticated.session.identity.id) {
        throw new ApplicationError("SYSTEM_REAUTHENTICATION_CONTEXT_MISMATCH", 403, "The reauthentication challenge does not match the System session.");
      }
      await auth.reauthenticate({
        identityId: authenticated.session.identity.id,
        username: authenticated.session.identity.username,
        password,
      });
    },
  });
  registerSiteRoutes({
    app, sites, authorization,
    requireActor: async (request, csrf) => (await requireActor(request, auth, authorization, config, csrf)).actor,
    reauthenticate: async (request, actor, password) => {
      const authenticated = await requireSession(request, auth, config, false);
      if (authenticated.session.identity.id !== actor.identityId) throw new ApplicationError("SYSTEM_REAUTHENTICATION_CONTEXT_MISMATCH",403,"The reauthentication challenge does not match the System session.");
      await auth.reauthenticate({identityId:authenticated.session.identity.id,username:authenticated.session.identity.username,password});
    },
  });
  registerAdminAppRoutes({
    app,
    adminApps,
    requireActor: async (request, csrf) =>
      (await requireActor(request, auth, authorization, config, csrf)).actor,
    reauthenticate: async (request, actor, password) => {
      const authenticated = await requireSession(request, auth, config, false);
      if (authenticated.session.identity.id !== actor.identityId) {
        throw new ApplicationError(
          "SYSTEM_REAUTHENTICATION_CONTEXT_MISMATCH",
          403,
          "The reauthentication challenge does not match the System session.",
        );
      }
      await auth.reauthenticate({
        identityId: authenticated.session.identity.id,
        username: authenticated.session.identity.username,
        password,
      });
    },
  });
  registerAdminAppRuntimeRoutes({
    app,
    workspaceId: DEFAULT_WORKSPACE_ID,
    runtime: adminAppRuntime,
    authorization,
    maskPolicies: createCoreMaskPolicyRegistry(),
    authenticate: createAdminRuntimeAuthenticator({
      auth, config, authorization, identityRealmStore, contentRealmAuthentication,
    }),
    getActiveSchema: async () => {
      const active = await database.getActiveSchema();
      return active === null ? null : { revisionId: active.revisionId, schema: active.schema };
    },
    data: {
      tree: (actor, collectionId) => treeDto(actor, collectionId, { kind: "all" }),
      query: async (actor, collectionId, input) => {
        const page = await documents.query(actor, collectionId, input);
        return {
          items: page.items.map((document) => ({ id: document.id, data: document.data })),
          hasNextPage: page.hasNextPage,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      },
      aggregate: (actor, collectionId, input) => documents.aggregate(actor, collectionId, input),
      getDocument: async (actor, collectionId, documentId) => {
        try {
          const document = await documents.get(actor, collectionId, documentId);
          return { id: document.id, data: document.data };
        } catch (error: unknown) {
          // A missing document yields an empty detail; access denials propagate.
          if (error instanceof ApplicationError && error.code === "DOCUMENT_NOT_FOUND") return null;
          throw error;
        }
      },
      previewMove: (actor, collectionId, documentId, body) =>
        database.withContentProjectionLock(async () =>
          (await calculateMovePreview(actor, collectionId, documentId, body)).dto),
      move: (actor, collectionId, documentId, body) =>
        moveHierarchyDocument(actor, collectionId, documentId, body),
      listMedia: async (actor) => {
        await requireRuntimeMediaPermission(actor, "media.read");
        const [records, consistency] = await Promise.all([
          media.list(actor.workspaceId),
          media.checkConsistency(actor.workspaceId),
        ]);
        const missing = new Set(consistency.missing.map(({ id }) => id));
        return { items: records.map((record) => mediaRecordDto(record, missing.has(record.id))) };
      },
      uploadMedia: async (actor, input) => {
        await requireRuntimeMediaPermission(actor, "media.upload");
        const encodedFileName = singleHeader(input.encodedFileName, "x-file-name");
        let originalFileName: string;
        try {
          originalFileName = decodeURIComponent(encodedFileName);
        } catch {
          throw badRequest("MEDIA_FILE_NAME_INVALID", "x-file-name must be URI encoded UTF-8.");
        }
        const declaredMimeType = (input.declaredMimeType ?? input.contentType ?? "")
          .split(";", 1)[0]?.trim() ?? "";
        if (input.contentLength !== undefined) {
          const byteLength = Number(input.contentLength);
          if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
            throw badRequest("MEDIA_CONTENT_LENGTH_INVALID", "content-length must be a non-negative integer.");
          }
          if (byteLength > config.mediaMaxUploadBytes) {
            throw new ApplicationError(
              "MEDIA_SIZE_LIMIT_EXCEEDED",
              413,
              `Media exceeds the ${config.mediaMaxUploadBytes} byte upload limit.`,
            );
          }
        }
        const uploaded = await media.upload({
          workspaceId: actor.workspaceId,
          actorId: actor.subjectId,
          originalFileName,
          declaredMimeType,
          stream: byteStream(input.body),
        });
        return mediaRecordDto(uploaded.media, false);
      },
    },
  });
  registerOperationsRoutes({
    app, audit: unifiedAudit, retention, authorization,
    requireActor: async (request, csrf) =>
      (await requireActor(request, auth, authorization, config, csrf)).actor,
    reauthenticate: async (request, actor, password) => {
      const authenticated = await requireSession(request, auth, config, false);
      if (authenticated.session.identity.id !== actor.identityId) {
        throw new ApplicationError("SYSTEM_REAUTHENTICATION_CONTEXT_MISMATCH", 403,
          "The reauthentication challenge does not match the System session.");
      }
      await auth.reauthenticate({ identityId: authenticated.session.identity.id,
        username: authenticated.session.identity.username, password });
    },
    mediaConsistency: async (workspaceId) => {
      const report = await media.checkConsistency(workspaceId);
      return { missing: report.missing.map((record) => mediaRecordDto(record, true)),
        orphanStorageKeys: report.orphanStorageKeys,
        incomplete: report.incomplete.map(incompleteMediaRecordDto), healthyCount: report.healthyCount };
    },
  });
  registerPluginRoutes({
    app,plugins,authorization,loadedModules:loadedPluginModules,
    loadedConfigs:new Map(desiredPlugins.filter(record=>record.desiredState==="enabled").map(record=>[record.pluginId,record.config])),
    requireActor:async(request,csrf)=>(await requireActor(request,auth,authorization,config,csrf)).actor,
    reauthenticate:async(request,actor,password)=>{const authenticated=await requireSession(request,auth,config,false);if(authenticated.session.identity.id!==actor.identityId)throw new ApplicationError("SYSTEM_REAUTHENTICATION_CONTEXT_MISMATCH",403,"The reauthentication challenge does not match the System session.");await auth.reauthenticate({identityId:authenticated.session.identity.id,username:authenticated.session.identity.username,password});},
  });

  registerAuthorizationRoutes({
    app,
    authorization,
    basePath: "/api/identity-realms/:realmId/authorization",
    resolveRealmId: authorizationRealmIdFromRequest,
    requireAuthorizationActor: async (
      request,
      requireCsrf,
    ): Promise<AuthorizationPolicyManagementActor> => {
      const authenticated = authorizationMutationSessions.get(request) ??
        await requireSession(request, auth, config, requireCsrf);
      const realmId = authorizationRealmIdFromRequest(request);
      const realm = await identityRealmStore.getRealmById(realmId);
      if (
        realm === null ||
        realm.kind !== "content" ||
        realm.status !== "active" ||
        realm.workspaceId !== authenticated.session.identity.workspaceId
      ) {
        throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
      }
      const membership = await identityRealmStore.resolveActiveMembership(
        realmId,
        authenticated.session.identity.id,
      );
      const readOnlyOperation = isRealmAdministrationReadOperation(request);
      let localDenial: ApplicationError | undefined;
      let localAdministrationActor:
        | Extract<RealmAdministrationActor, { readonly accessMode: "realm-actor" }>
        | undefined;
      if (membership !== null) {
        const localActor = { realmId, subjectId: membership.subjectId };
        localAdministrationActor = {
          accessMode: "realm-actor",
          realmId,
          subjectId: membership.subjectId,
          systemIdentityId: authenticated.session.identity.id,
        };
        try {
          await requireLocalRealmAdministrationRouteAccess(authorization, localActor, request);
          if (readOnlyOperation) return localAdministrationActor;
        } catch (error: unknown) {
          if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
          localDenial = error;
        }
        // Mutation preflight cannot see target rank/scope. Always execute the
        // concrete command as the ordinary Realm Subject first. The route's
        // fallback hook may use Full Access only for an actual policy denial.
        if (!readOnlyOperation) return localAdministrationActor;
      }

      // Only the System CMS Owner may cross the Realm boundary. Revalidate the
      // System policy on every request so a revoked CMS Owner immediately loses
      // both oversight and an otherwise-unexpired Full Access grant.
      try {
        await authorization.require(
          authorizationActor(authenticated.session.identity.id),
          { action: "authorization.manage", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID },
        );
      } catch (error: unknown) {
        if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
        // A non-CMS local administrator still receives the ordinary Realm actor;
        // the concrete application command performs the final target/rank check.
        if (localAdministrationActor !== undefined) return localAdministrationActor;
        if (localDenial !== undefined) throw localDenial;
        throw error;
      }
      const auditedRead = isIndividuallyAuditedRealmAdministrationRead(request);
      const sessionId = `session_${createHash("md5")
        .update(securityRuntime.hashToken(authenticated.sessionToken))
        .digest("hex")}`;
      const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "unknown";
      const activeFullAccessActor = await resolveActiveRealmFullAccessActor(
        request,
        authenticated,
        realmId,
        readOnlyOperation,
      );
      if (activeFullAccessActor !== null) return activeFullAccessActor;
      if (!readOnlyOperation) {
        if (localDenial !== undefined) throw localDenial;
        throw new ApplicationError(
          "REALM_FULL_ACCESS_REQUIRED",
          403,
          "An active Realm Full Access grant is required for this policy change.",
        );
      }
      const oversightKey = `${sessionId}\0${realmId}`;
      if (auditedRead || !recordedRealmOversightEntries.has(oversightKey)) {
        await identityRealmStore.recordRealmAdministrationEvent({
          event: auditedRead ? "REALM_POLICY_OVERSIGHT_READ" : "REALM_POLICY_OVERSIGHT_ENTERED",
          systemIdentityId: authenticated.session.identity.id,
          realmId,
          accessMode: "cms-owner-readonly",
          operation: `${request.method} ${route}`,
          requestId: request.id,
          sessionId,
          occurredAt: new Date().toISOString(),
          result: "authorized",
        });
        if (!auditedRead) recordedRealmOversightEntries.add(oversightKey);
      }
      return {
        accessMode: "cms-owner-readonly",
        realmId,
        systemIdentityId: authenticated.session.identity.id,
      };
    },
    resolveAuthorizationMutationFallback: async (request, actor, error) => {
      if (
        !(error instanceof ApplicationError)
        || (error.code !== "AUTHORIZATION_DENIED" && error.code !== "OWNER_AUTHORIZATION_REQUIRED")
        || !("accessMode" in actor)
        || actor.accessMode !== "realm-actor"
      ) {
        return null;
      }
      const authenticated = authorizationMutationSessions.get(request) ??
        await requireSession(request, auth, config, true);
      if (authenticated.session.identity.id !== actor.systemIdentityId) return null;
      try {
        // Revalidate the CMS Owner boundary at fallback time. The local command
        // ran without this privilege, and revocation must take effect instantly.
        await authorization.require(
          authorizationActor(authenticated.session.identity.id),
          { action: "authorization.manage", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID },
        );
      } catch (fallbackError: unknown) {
        if (fallbackError instanceof ApplicationError && fallbackError.status === 403) return null;
        throw fallbackError;
      }
      return resolveActiveRealmFullAccessActor(request, authenticated, actor.realmId, false);
    },
  });

  registerIdentityRealmRoutes({
    app,
    administration: {
      listGlobalIdentities: (actor) => identityRealms.listGlobalIdentities(actor),
      listRealms: (actor) => identityRealms.listRealms(actor),
      createRealm: async (actor, input) => {
        const realm = await identityRealms.createRealm(actor, input);
        await database.withContentProjectionLock(async () => {
          await realmAuthorization.ensureRealmPolicy(realm);
          const collections = (await database.getActiveSchema())?.schema.collections ?? [];
          await realmAuthorization.syncCollectionResources({
            realm,
            collections: collections.map(({ id, name }) => ({ id: String(id), name })),
          });
        });
        // New realm joins the entitlement regime: enforced, with access-preserving
        // ceilings derived from its current policy (consistent with migrated realms).
        await entitlementStore.reconcileRealmFromPolicy(realm.id, realm.workspaceId);
        return realm;
      },
      createProfileSchema: createDefaultRealmProfileSchema,
      createProfileField: createDefaultRealmProfileField,
      updateRealm: (actor, input) => identityRealms.updateRealm(actor, input),
      listMemberships: async (actor, realmId) => {
        const memberships = await identityRealms.listMemberships(actor, realmId);
        // Annotate each Membership with whether it holds the trusted Content
        // Administrator binding, so the Admin UI can reflect appointment state.
        const realm = await identityRealmStore.getRealmById(realmId);
        if (realm === null || realm.kind !== "content") return memberships;
        const administratorSubjectIds = new Set(
          await realmAuthorization.listRealmAdministratorSubjectIds(realm),
        );
        return memberships.map((membership) => ({
          ...membership,
          realmAdministrator: administratorSubjectIds.has(membership.subjectId),
        }));
      },
      provisionMembership: (actor, input) => identityRealms.provisionMembership(actor, input),
      registerMembership: (actor, input) => identityRealms.registerMembership(actor, input),
      grantRealmAdministrator: async (actor, input) => {
        const realm = await identityRealmStore.getRealmById(input.realmId);
        if (
          realm === null ||
          realm.kind !== "content" ||
          realm.status !== "active" ||
          realm.workspaceId !== actor.workspaceId
        ) {
          throw new ApplicationError(
            "CONTENT_REALM_UNAVAILABLE",
            409,
            "The Content Realm is not active.",
          );
        }
        const actorIdentityId = actor.identityId ?? actor.subjectId;
        try {
          // CMS Owner may appoint Realm administrators from the System control
          // plane without becoming a local Realm Subject.
          await authorization.require(
            authorizationActor(actorIdentityId),
            { action: "authorization.manage", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID },
          );
        } catch (error: unknown) {
          if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
          // A human Primary Realm Owner may perform the same operation, but a
          // generic System operator or Content Administrator may not use this
          // trusted provisioner path.
          const [owner, actorMembership] = await Promise.all([
            realmAuthorization.getPrimaryOwner(realm),
            identityRealmStore.resolveActiveMembership(realm.id, actorIdentityId),
          ]);
          if (
            owner.state !== "assigned"
            || owner.subjectId === undefined
            || actorMembership?.subjectId !== owner.subjectId
          ) {
            throw error;
          }
        }
        const membership = await identityRealmStore.findMembershipById(input.membershipId);
        if (
          membership === null ||
          membership.realmId !== realm.id ||
          membership.status !== "active"
        ) {
          throw new ApplicationError(
            "REALM_MEMBERSHIP_NOT_ACTIVE",
            409,
            "An active Realm Membership is required to grant administration.",
          );
        }
        // Trusted path: the operator holds no policy permission in this Realm, so
        // the protected provisioner Subject binds the Content Administrator Role.
        await realmAuthorization.grantRealmAdministrator({
          realm,
          subjectId: membership.subjectId,
        });
        // The new administrator's root binding reaches every collection; ensure
        // ceilings exist so the appointment is not silently blocked by the gate.
        await entitlementStore.reconcileRealmFromPolicy(realm.id, realm.workspaceId);
        return membership;
      },
      revokeRealmAdministrator: async (actor, input) => {
        const realm = await identityRealmStore.getRealmById(input.realmId);
        if (
          realm === null ||
          realm.kind !== "content" ||
          realm.status !== "active" ||
          realm.workspaceId !== actor.workspaceId
        ) {
          throw new ApplicationError(
            "CONTENT_REALM_UNAVAILABLE",
            409,
            "The Content Realm is not active.",
          );
        }
        const actorIdentityId = actor.identityId ?? actor.subjectId;
        try {
          // CMS Owner may revoke Realm administrators from the System control
          // plane without becoming a local Realm Subject.
          await authorization.require(
            authorizationActor(actorIdentityId),
            { action: "authorization.manage", resourceId: SYSTEM_AUTHORIZATION_RESOURCE_ID },
          );
        } catch (error: unknown) {
          if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
          // A human Primary Realm Owner may perform the same operation, but a
          // generic System operator or Content Administrator may not use this
          // trusted provisioner path.
          const [owner, actorMembership] = await Promise.all([
            realmAuthorization.getPrimaryOwner(realm),
            identityRealmStore.resolveActiveMembership(realm.id, actorIdentityId),
          ]);
          if (
            owner.state !== "assigned"
            || owner.subjectId === undefined
            || actorMembership?.subjectId !== owner.subjectId
          ) {
            throw error;
          }
        }
        const membership = await identityRealmStore.findMembershipById(input.membershipId);
        if (
          membership === null ||
          membership.realmId !== realm.id ||
          membership.status !== "active"
        ) {
          throw new ApplicationError(
            "REALM_MEMBERSHIP_NOT_ACTIVE",
            409,
            "An active Realm Membership is required to revoke administration.",
          );
        }
        // Trusted path: removes only the canonical Content Administrator Binding
        // held by the protected provisioner Subject. Idempotent otherwise.
        await realmAuthorization.revokeRealmAdministrator({
          realm,
          subjectId: membership.subjectId,
        });
        return membership;
      },
      suspendMembership: (actor, input) => identityRealms.suspendMembership(actor, input),
      reactivateMembership: (actor, input) => identityRealms.reactivateMembership(actor, input),
      getOwner: (actor, realmId) => identityRealms.getOwner(actor, realmId),
      assignOwner: (actor, input) => identityRealms.assignOwner(actor, input),
      transferOwner: (actor, input) => identityRealms.transferOwner(actor, input),
      recoverOwner: (actor, input) => identityRealms.recoverOwner(actor, input),
      listFullAccessBindings: (actor, realmId) =>
        identityRealms.listFullAccessBindings(actor, realmId),
      grantFullAccess: (actor, input) => identityRealms.grantFullAccess(actor, input),
      revokeFullAccess: (actor, input) => identityRealms.revokeFullAccess(actor, input),
      listRealmEntitlements: (actor, realmId) =>
        identityRealms.listRealmEntitlements(actor, realmId),
      listCollectionEntitlements: (actor, collectionId) =>
        identityRealms.listCollectionEntitlements(actor, collectionId),
      putRealmEntitlement: (actor, input) => identityRealms.putRealmEntitlement(actor, input),
      deleteRealmEntitlement: (actor, input) => identityRealms.deleteRealmEntitlement(actor, input),
      listRealmDelegations: (actor, managingRealmId) =>
        identityRealms.listRealmDelegations(actor, managingRealmId),
      listManagedByDelegations: (actor, managedRealmId) =>
        identityRealms.listManagedByDelegations(actor, managedRealmId),
      putRealmDelegation: (actor, input) => identityRealms.putRealmDelegation(actor, input),
      deleteRealmDelegation: (actor, input) => identityRealms.deleteRealmDelegation(actor, input),
    },
    contentAuthentication: contentRealmAuthentication,
    metadata: {
      getByKey: async (realmKey) => {
        const realm = await identityRealmStore.getRealmByKey(DEFAULT_WORKSPACE_ID, realmKey);
        if (realm === null) return null;
        const configRecord = realm.profileCollectionId === undefined
          ? null
          : await identityRealmStore.getAuthCollectionConfig(realm.profileCollectionId);
        return {
          realm,
          identifierFieldIds: configRecord?.realmId === realm.id && configRecord.status === "active"
            ? configRecord.identifierFieldIds
            : [],
        };
      },
    },
    actors: {
      requireSystemActor: async (request, requireCsrf) =>
        (await requireActor(request, auth, authorization, config, requireCsrf)).actor,
      verifySystemReauthentication: async (request, actor, password) => {
        const authenticated = await requireSession(request, auth, config, false);
        if (actor.identityId !== authenticated.session.identity.id) {
          throw new ApplicationError(
            "SYSTEM_REAUTHENTICATION_CONTEXT_MISMATCH",
            403,
            "The reauthentication challenge does not match the System session.",
          );
        }
        return {
          reauthenticatedAt: await auth.reauthenticate({
            identityId: authenticated.session.identity.id,
            username: authenticated.session.identity.username,
            password,
          }),
        };
      },
      contentActorForSession: (session) => {
        const policyActor = { realmId: session.realm.id, subjectId: session.membership.subjectId };
        return {
          subjectId: session.membership.subjectId,
          identityId: session.identity.id,
          workspaceId: session.realm.workspaceId,
          realmId: session.realm.id,
          capabilities: [],
          authorization: authorizationGateway(authorization, policyActor),
        };
      },
    },
    profiles: {
      get: async (input) => {
        const actor = accountProfileActor(input.actor);
        const realm = await identityRealmStore.getRealmById(input.realmId);
        const collectionId = realm?.profileCollectionId;
        if (collectionId === undefined) {
          throw new ApplicationError(
            "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
            503,
            "The Realm Profile Collection is unavailable.",
          );
        }
        const document = await documents.get(actor, collectionId, input.profileDocumentId);
        assertOwnRealmProfile(document, input.subjectId, collectionId);
        return { data: document.data, revision: document.version };
      },
      update: async (input) => {
        const actor = accountProfileActor(input.actor);
        const realm = await identityRealmStore.getRealmById(input.realmId);
        const collectionId = realm?.profileCollectionId;
        if (collectionId === undefined) {
          throw new ApplicationError(
            "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
            503,
            "The Realm Profile Collection is unavailable.",
          );
        }
        const current = await documents.get(actor, collectionId, input.profileDocumentId);
        assertOwnRealmProfile(current, input.subjectId, collectionId);
        const updated = await documents.update(actor, collectionId, input.profileDocumentId, {
          expectedVersion: input.expectedRevision,
          data: input.data,
        });
        return { data: updated.data, revision: updated.version };
      },
    },
    documents: {
      listCollections: async (actor) => {
        const active = await database.getActiveSchema();
        if (active === null) return { items: [] };
        const readable: CollectionDefinition[] = [];
        for (const collection of active.schema.collections) {
          try {
            await documents.list(actor, String(collection.id), { page: 1, pageSize: 1, state: "active" });
            readable.push(collection);
          } catch (error: unknown) {
            if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
          }
        }
        return {
          items: readable.map((collection) => ({
            id: String(collection.id),
            name: collection.name,
            ...(collection.label === undefined ? {} : { label: collection.label }),
            kind: collection.kind ?? "collection",
            ...(collection.hierarchy === undefined ? {} : {
              hierarchy: {
                enabled: collection.hierarchy.enabled,
                ordering: collection.hierarchy.ordering ?? "manual",
                permissionInheritance: collection.hierarchy.permissionInheritance === true,
              },
            }),
            fields: collection.fields.map((field) => ({
              id: String(field.id),
              name: field.name,
              ...(field.label === undefined ? {} : { label: field.label }),
              type: field.type,
              required: field.required === true,
              ...(field.sensitivity === undefined ? {} : { sensitivity: field.sensitivity }),
            })),
            status: "applied" as const,
            hasPendingChanges: false,
            revisionId: active.revisionId,
          })),
        };
      },
      listDocuments: ({ actor, collectionId, page, pageSize }) =>
        documents.list(actor, collectionId, {
          ...(page === undefined ? {} : { page }),
          ...(pageSize === undefined ? {} : { pageSize }),
          state: "active",
        }),
      queryDocuments: async ({ actor, collectionId, request }) => {
        const result = await documents.query(actor, collectionId, {
          ...request,
          state: request.state ?? "active",
        });
        return {
          items: result.items.map(documentDto),
          hasNextPage: result.hasNextPage,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        };
      },
      getDocument: ({ actor, collectionId, documentId }) =>
        documents.get(actor, collectionId, documentId),
      createDocument: ({ actor, collectionId, request }) =>
        createContentDocument(actor, collectionId, request),
      updateDocument: ({ actor, collectionId, documentId, request }) =>
        documents.update(actor, collectionId, documentId, {
          data: request.data,
          expectedVersion: request.expectedVersion,
        }),
      deleteDocument: ({ actor, collectionId, documentId, expectedVersion }) =>
        documents.delete(actor, collectionId, documentId, expectedVersion),
      publishDocument: ({ actor, collectionId, documentId, expectedVersion }) =>
        documents.publish(actor, collectionId, documentId, expectedVersion),
      unpublishDocument: ({ actor, collectionId, documentId, expectedVersion }) =>
        documents.unpublish(actor, collectionId, documentId, expectedVersion),
      restoreDeletedDocument: ({ actor, collectionId, documentId, expectedVersion }) =>
        documents.restoreDeleted(actor, collectionId, documentId, expectedVersion),
      listRevisions: ({ actor, collectionId, documentId }) =>
        documents.listRevisions(actor, collectionId, documentId),
      getRevision: ({ actor, collectionId, documentId, revisionId }) =>
        documents.getRevision(actor, collectionId, documentId, revisionId),
      restoreRevision: ({ actor, collectionId, documentId, revisionId, expectedVersion }) =>
        documents.restoreRevision(actor, collectionId, documentId, revisionId, expectedVersion),
    },
    security: {
      assertContentOrigin: (request) => assertAllowedContentOrigin(request, config),
      csrfTokenForContentSession: securityRuntime.deriveCsrfToken,
      assertContentLoginAllowed: (request, realmKey, identifier) => {
        const normalized = normalizeIdentityIdentifier(identifier);
        limiter.assertAllowed(`content-ip:${realmKey}:${request.ip}`);
        limiter.assertAllowed(`content-identity:${realmKey}:${request.ip}:${normalized}`);
      },
      recordContentLoginFailure: (request, realmKey, identifier) => {
        const normalized = normalizeIdentityIdentifier(identifier);
        limiter.recordFailure(`content-ip:${realmKey}:${request.ip}`);
        limiter.recordFailure(`content-identity:${realmKey}:${request.ip}:${normalized}`);
      },
      clearContentLoginFailures: (request, realmKey, identifier) => {
        const normalized = normalizeIdentityIdentifier(identifier);
        limiter.clear(`content-ip:${realmKey}:${request.ip}`);
        limiter.clear(`content-identity:${realmKey}:${request.ip}:${normalized}`);
      },
    },
    secureCookies: config.secureCookies,
    crossRealmManagement: {
      getTarget: async (identityId, workspaceId) =>
        toCrossRealmTarget(await identityAdministration.get(identityId, workspaceId)),
      authorize: (actor, input) =>
        crossRealmManagementService.authorize(actor, {
          action: input.action,
          targetMemberships: input.target.memberships,
        }),
      resetPassword: async ({ actor, target, temporaryPassword }) =>
        toCrossRealmTarget(await identityAdministration.resetPassword({
          identityId: target.identityId,
          workspaceId: actor.workspaceId,
          expectedRevision: target.revision,
          temporaryPassword,
          revokeApiKeys: true,
          actorIdentityId: actor.identityId ?? actor.subjectId,
          actorSubjectId: actor.subjectId,
        })),
      setDisabled: async ({ actor, target, disabled }) =>
        toCrossRealmTarget(await identityAdministration.setDisabled({
          identityId: target.identityId,
          workspaceId: actor.workspaceId,
          expectedRevision: target.revision,
          disabled,
          actorIdentityId: actor.identityId ?? actor.subjectId,
          actorSubjectId: actor.subjectId,
        })),
      revokeSessions: async ({ actor, target }) => {
        await identityAdministration.revokeAllSessions({
          identityId: target.identityId,
          workspaceId: actor.workspaceId,
          actorIdentityId: actor.identityId ?? actor.subjectId,
        });
        // Session revocation doesn't change the identity revision; re-read for a fresh view.
        return toCrossRealmTarget(await identityAdministration.get(target.identityId, actor.workspaceId));
      },
    },
  });

  registerSystemRoutes({
    app,
    database,
    config,
    plugins,
    workspaceSettings,
    auth,
    requireActor: (request, requireCsrf) => requireActor(request, auth, authorization, config, requireCsrf)
  });

  app.get("/api/bootstrap/status", async () => ({
    required: await auth.bootstrapRequired(),
    templateRequired: (await database.getActiveSchema()) === null,
  }));

  const bootstrapHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSessionDto> => {
    assertAllowedOrigin(request, config);
    const body = credentials(request.body);
    const owner = await auth.bootstrap({
      username: body.username,
      password: body.password,
    });
    await ensureAuthorizationPolicy(owner);
    await database.withContentProjectionLock(async () => {
      await syncAuthorizationResources(
        authorizationActor(owner.id),
        (await database.getActiveSchema())?.schema.collections ?? [],
      );
      await reconcileAuthorizationHierarchy(
        authorizationActor(owner.id),
        (await database.getActiveSchema())?.schema.collections ?? [],
        "startup",
      );
    });
    const session = await auth.login(body);
    setSessionCookie(reply, config, session.sessionToken, session.expiresAt);
    reply.code(201);
    return sessionDto(session, await database.getActiveSchema());
  };
  app.post("/api/bootstrap", bootstrapHandler);
  app.post("/api/admin/bootstrap", bootstrapHandler);

  const ensureSetupTemplateRealms = async (
    actor: ActorContext,
    templateSchema: SchemaIrV1,
  ): Promise<void> => {
    for (const collection of templateSchema.collections) {
      const definition = collection.auth;
      if (definition === undefined) continue;
      const existingRealm = await identityRealmStore.getRealmByKey(actor.workspaceId, definition.realmKey);
      if (existingRealm === null) {
        const realm = await identityRealms.createRealm(actor, {
          key: definition.realmKey,
          name: definition.realmKey.charAt(0).toUpperCase() + definition.realmKey.slice(1),
          acceptSystemIdentities: definition.acceptSystemIdentities,
          provisioning: definition.provisioning,
          registration: "closed",
          defaultRoleIds: definition.defaultRoleIds,
        });
        await database.withContentProjectionLock(async () => {
          await realmAuthorization.ensureRealmPolicy(realm);
          const collections = (await database.getActiveSchema())?.schema.collections ?? [];
          await realmAuthorization.syncCollectionResources({
            realm,
            collections: collections.map(({ id, name }) => ({ id: String(id), name })),
          });
        });
        await entitlementStore.reconcileRealmFromPolicy(realm.id, realm.workspaceId);
      }
    }
  };

  app.post("/api/setup/template", async (request): Promise<SchemaRevisionEnvelopeDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, true);
    if ((await database.getActiveSchema()) !== null) {
      throw new ApplicationError("SETUP_ALREADY_COMPLETED", 409, "The initial template has already been applied.");
    }
    const input = setupTemplateInput(request.body);
    let templateSchema: SchemaIrV1;
    try {
      templateSchema = starterSchema(input.starter, input);
    } catch (error: unknown) {
      if (error instanceof RangeError) throw badRequest("SETUP_TEMPLATE_INVALID", error.message);
      throw error;
    }
    await ensureSetupTemplateRealms(actor, templateSchema);
    const existingDraft = await schema.getDraft(actor);
    const draft = await schema.importManifest(actor, {
      baseRevisionId: null,
      expectedDraftVersion: existingDraft?.draftVersion ?? null,
      schema: templateSchema,
    });
    const preview = await schema.preview(actor, { expectedDraftVersion: draft.draftVersion });
    return revisionDto(await applySchemaWithProjection(actor, {
      expectedRevisionId: null,
      expectedDraftVersion: draft.draftVersion,
      planId: preview.planId,
      approveDestructive: false,
    }));
  });

  app.post("/api/auth/login", async (request, reply): Promise<AuthenticatedSessionDto> => {
    assertAllowedOrigin(request, config);
    const body = credentials(request.body);
    const normalizedUsername = body.username.normalize("NFKC").toLocaleLowerCase("en-US");
    const rateLimitKeys = [`ip:${request.ip}`, `identity:${request.ip}:${normalizedUsername}`];
    rateLimitKeys.forEach((key) => limiter.assertAllowed(key));
    try {
      const session = await auth.login(body);
      if (session.identity.isOwner) {
        await ensureAuthorizationPolicy(session.identity);
        await database.withContentProjectionLock(async () => {
          await syncAuthorizationResources(
            authorizationActor(session.identity.id),
            (await database.getActiveSchema())?.schema.collections ?? [],
          );
          await reconcileAuthorizationHierarchy(
            authorizationActor(session.identity.id),
            (await database.getActiveSchema())?.schema.collections ?? [],
            "startup",
          );
        });
      }
      rateLimitKeys.forEach((key) => limiter.clear(key));
      setSessionCookie(reply, config, session.sessionToken, session.expiresAt);
      return sessionDto(session, await database.getActiveSchema());
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === "AUTHENTICATION_FAILED") {
        rateLimitKeys.forEach((key) => limiter.recordFailure(key));
      }
      throw error;
    }
  });

  app.get("/api/auth/session", async (request, reply): Promise<SessionDto> => {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (sessionToken === undefined) {
      return { user: null };
    }
    try {
      const session = await auth.authenticate({ sessionToken });
      return {
        user: { id: session.identity.id, username: session.identity.username },
        passwordChangeRequired: session.identity.passwordChangeRequired,
        csrfToken: auth.csrfTokenForSession(sessionToken),
        workspace: { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME },
        capabilities: session.capabilities,
        schema: { revisionId: (await database.getActiveSchema())?.revisionId ?? null },
        expiresAt: session.expiresAt,
      };
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === "SESSION_INVALID") {
        clearSessionCookie(reply, config);
        return { user: null };
      }
      throw error;
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const authenticated = await requireSession(request, auth, config, true);
    await auth.logout(authenticated.sessionToken, authenticated.session.identity.id);
    clearSessionCookie(reply, config);
    reply.code(204).send();
  });

  registerSchemaRoutes({
    app,
    config,
    schema,
    schemaArtifacts,
    requireActor: (request, requireCsrf) => requireActor(request, auth, authorization, config, requireCsrf),
    applySchemaWithProjection
  });

  async function requireRuntimeMediaPermission(actor: ActorContext, action: "media.read" | "media.upload"): Promise<void> {
    if (actor.authorization === undefined) {
      throw new ApplicationError("ACCESS_DENIED", 403, `The '${action}' permission is required.`);
    }
    const realmId = actor.realmId ?? SYSTEM_AUTHORIZATION_REALM_ID;
    await actor.authorization.require({
      action,
      resourceId: realmId === SYSTEM_AUTHORIZATION_REALM_ID
        ? SYSTEM_WORKSPACE_RESOURCE_ID
        : realmAuthorizationRootResourceId(realmId),
    });
  }

  app.get<{
    Params: { collectionId: string };
    Querystring: { parentId?: string };
  }>("/api/collections/:collectionId/tree", async (request): Promise<DocumentTreeDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    if (request.query.parentId === undefined) {
      return treeDto(actor, request.params.collectionId, { kind: "all" });
    }
    return request.query.parentId === ""
      ? treeDto(actor, request.params.collectionId, { kind: "roots" })
      : treeDto(actor, request.params.collectionId, {
          kind: "children",
          documentId: request.query.parentId,
        });
  });

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/ancestors",
    async (request): Promise<DocumentTreeDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      return treeDto(actor, request.params.collectionId, {
        kind: "ancestors",
        documentId: request.params.documentId,
      });
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/descendants",
    async (request): Promise<DocumentTreeDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      return treeDto(actor, request.params.collectionId, {
        kind: "descendants",
        documentId: request.params.documentId,
      });
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/subtree",
    async (request): Promise<DocumentTreeDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      return treeDto(actor, request.params.collectionId, {
        kind: "subtree",
        documentId: request.params.documentId,
      });
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/move/preview",
    async (request): Promise<MoveDocumentPreviewDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      return database.withContentProjectionLock(async () => (await calculateMovePreview(
          actor,
          request.params.collectionId,
          request.params.documentId,
          request.body,
        )).dto);
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/move",
    async (request): Promise<MoveDocumentResultDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      return moveHierarchyDocument(
        actor,
        request.params.collectionId,
        request.params.documentId,
        request.body,
      );
    },
  );

  app.post<{ Params: { collectionId: string }; Body: unknown }>(
    "/api/collections/:collectionId/documents/query",
    async (request): Promise<DocumentQueryResultDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      const result = await documents.query(
        actor,
        request.params.collectionId,
        parseDocumentQueryRequest(request.body),
      );
      return {
        items: result.items.map(documentDto),
        hasNextPage: result.hasNextPage,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      };
    },
  );

  app.post<{ Params: { collectionId: string } }>(
    "/api/collections/:collectionId/tree/reorder",
    async (request): Promise<DocumentTreeDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      const orderedDocumentIds = body["orderedDocumentIds"];
      if (!Array.isArray(orderedDocumentIds) || !orderedDocumentIds.every((value) => typeof value === "string")) {
        throw badRequest("REQUEST_BODY_INVALID", "orderedDocumentIds must be an array of document IDs.");
      }
      return database.withContentProjectionLock(async () => {
        const result = await hierarchy.reorderChildren(actor, request.params.collectionId, {
          parentId: nullableString(body["parentId"], "parentId"),
          orderedDocumentIds,
          expectedVersion: nonNegativeInteger(body["expectedVersion"], "expectedVersion"),
        });
        return presentTree(
          actor,
          request.params.collectionId,
          { version: result.state.version, items: result.state.positions },
          documents,
        );
      });
    },
  );

  registerDocumentRoutes({
    app,
    documents,
    sites,
    database,
    authorization,
    requireActor: (request, requireCsrf) => requireActor(request, auth, authorization, config, requireCsrf),
    createContentDocument,
    reconcileAuthorizationHierarchy
  });

  registerMediaRoutes({
    app,
    config,
    authorization,
    media,
    requireActor: (request, requireCsrf) => requireActor(request, auth, authorization, config, requireCsrf)
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      throw new ApplicationError("ROUTE_NOT_FOUND", 404, "The requested API route does not exist.");
    }
    reply.code(404).send("Not Found");
  });

  app.setErrorHandler(async (error, request, reply) => {
    const problem = problemDetails(error instanceof Error ? error : new Error("Unknown error"), request.id);
    if (problem.status >= 500) {
      request.log.error({ err: error, requestId: request.id }, "request failed");
    }
    reply.type("application/problem+json").code(problem.status).send(problem);
  });

  if (existsSync(join(config.adminDist, "index.html"))) {
    await app.register(fastifyStatic, {
      root: config.adminDist,
      prefix: "/admin/",
      decorateReply: true,
      wildcard: false,
    });
    app.get("/", async (_request, reply) => reply.redirect("/admin/"));
    app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
    app.get("/admin/*", async (_request, reply) => reply.sendFile("index.html"));
    app.get("/apps/:appKey", async (_request, reply) => reply.sendFile("index.html"));
    app.get("/apps/:appKey/*", async (_request, reply) => reply.sendFile("index.html"));
    app.get("/community/:realmKey", async (_request, reply) => reply.sendFile("index.html"));
  }

  if (config.workerEnabled) lifecycle.startWorker(config.workerPollMs);

  return { app, database, config, close: () => lifecycle.close() };
}
