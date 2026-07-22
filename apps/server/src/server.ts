import { constants, existsSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
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
  type ManagedIdentity,
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
  SYSTEM_PUBLIC_SUBJECT_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  collectionResourceId,
  type AuthorizationActor,
  type AuthorizationPolicyManagementActor,
  type ActorContext,
  type AuthenticatedSession,
  type ContentHierarchyQueryResult,
  type DocumentRecord,
  type MediaRecord,
  type RealmAdministrationActor,
  type RealmProfileProvisioner,
} from "@xecms/application";
import type {
  ApplySchemaRequest,
  ApplySetupTemplateRequest,
  AuthenticatedSessionDto,
  BootstrapRequest,
  CollectionListDto,
  CreateRealmProfileFieldRequest,
  CreateRealmProfileSchemaRequest,
  DeleteDocumentRequest,
  DocumentListDto,
  DocumentQueryResultDto,
  DocumentRecordDto,
  DocumentRevisionDetailDto,
  DocumentRevisionListDto,
  DocumentTreeDto,
  GeneratedTypesDto,
  HealthResponse,
  IncompleteMediaRecordDto,
  IssueSchemaIdsRequest,
  IssueSchemaIdsResponse,
  LoginRequest,
  MediaConsistencyReportDto,
  MediaListDto,
  MediaRecordDto,
  MoveDocumentResultDto,
  MoveDocumentPreviewDto,
  PublishedDocumentListDto,
  PublishedDocumentRecordDto,
  ProblemDetails,
  SaveSchemaDraftRequest,
  SchemaDraftEnvelopeDto,
  SchemaManifestDto,
  SchemaPreviewDto,
  SchemaRevisionEnvelopeDto,
  SessionDto,
  SystemDiagnosticsDto,
  WorkspaceSettingsDto,
  UpdateWorkspaceSettingsRequest,
  UpdateDocumentRequest,
} from "@xecms/contracts";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  CORE_MIGRATION_IDS,
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
import { isStarterName, serializeSchema, starterSchema, type CollectionDefinition, type SchemaIrV1 } from "@xecms/schema";
import { pluginManifestDigest, type XeCmsPluginModule } from "@xecms/plugin-sdk";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { registerAuthorizationRoutes } from "./authorization-routes.js";
import {
  registerIdentityRealmRoutes,
  contentRealmRuntimeCookieName,
  type CrossRealmManagedTarget,
} from "./identity-realm-routes.js";
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

const XECMS_VERSION = "0.5.0";
const SESSION_COOKIE = "xecms_session";

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
  const pluginModules=options.plugins??[...DEFAULT_PLUGIN_MODULES];
  const pluginCatalog=new PluginCatalog(pluginModules);
  const database =
    options.database ??
    new PostgresDatabase({
      connectionString: config.databaseUrl,
      schema: config.databaseSchema,
    });
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
  for(const module of loadedPluginModules){const health=await module.server?.health?.();if(health?.status==="degraded")throw new ApplicationError("PLUGIN_STARTUP_HEALTH_FAILED",503,`Plugin '${module.manifest.id}' startup health check failed: ${health.detail??"degraded"}`)}
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
  const syncAuthorizationResources = async (
    actor: AuthorizationActor,
    collections: readonly CollectionDefinition[],
  ): Promise<void> => {
    const siteByCollection = new Map(
      (await sites.list(DEFAULT_WORKSPACE_ID)).flatMap((site) =>
        site.collectionIds.map((collectionId) => [collectionId, site.id] as const)),
    );
    const policy = await authorization.getPolicy(actor);
    await authorization.syncCoreResources(actor, {
      expectedRevision: policy.revision,
      collections: collections.map(({ id, name }) => {
        const collectionId = String(id);
        const siteId = siteByCollection.get(collectionId);
        return { id: collectionId, name,
          ...(siteId === undefined ? {} : { parentResourceId: `resource:site:${siteId}` }) };
      }),
    });
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
  const reconcileAuthorizationHierarchy = async (
    actor: AuthorizationActor,
    collections: readonly CollectionDefinition[],
    reason: "startup" | "schema.apply" | "hierarchy.create" | "hierarchy.move" | "hierarchy.purge",
    expectedPolicyRevision?: number,
  ) => {
    const projections = [];
    for (const collection of collections) {
      if (collection.hierarchy?.enabled !== true || collection.hierarchy.permissionInheritance !== true) continue;
      const tree = await hierarchyStore.listAllByIds(DEFAULT_WORKSPACE_ID, String(collection.id));
      for (const position of tree.items) {
        const documentId = String(position.documentId);
        projections.push({
          documentId,
          collectionId: String(collection.id),
          parentDocumentId: position.parentId === null ? null : String(position.parentId),
        });
      }
    }
    const expectedRevision = expectedPolicyRevision ?? await authorization.currentPolicyRevision(actor.realmId);
    return authorization.reconcileContentHierarchyResources(actor, {
      expectedRevision,
      managedCollectionIds: collections.map(({ id }) => String(id)),
      projections,
      reason,
    });
  };
  const assertSafeAuthorizationHierarchyTransition = async (policyActor: AuthorizationActor): Promise<void> => {
    const [active, draft] = await Promise.all([
      database.getActiveSchema(),
      database.getSchemaDraft(),
    ]);
    if (draft === null) return;
    const policy = await authorization.getPolicy(policyActor);
    const policyReferences = (resourceId: string): boolean =>
      policy.bindings.some((binding) => binding.resourceId === resourceId) ||
      policy.roles.some((role) => (role.fieldAccess ?? []).some((rule) => rule.resourceId === resourceId));
    const permissionInheritanceEnabled = (collection: CollectionDefinition | undefined): boolean =>
      collection?.hierarchy?.enabled === true && collection.hierarchy.permissionInheritance === true;

    // A previously retired ID must not reactivate old grants merely by being
    // reintroduced in a draft. This guard deliberately runs before schema.apply.
    for (const candidate of draft.schema.collections) {
      const resourceId = collectionResourceId(String(candidate.id));
      const resource = policy.resources.find(({ id }) => id === resourceId);
      if (resource?.type === "retired-collection" && policyReferences(resourceId)) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Retired collection '${candidate.name}' has policy references that must be migrated before reuse.`,
          { details: { collectionId: String(candidate.id) } },
        );
      }
      const previous = active?.schema.collections.find(({ id }) => String(id) === String(candidate.id));
      if (
        previous === undefined &&
        permissionInheritanceEnabled(candidate) &&
        await database.countDocumentsByCollectionId(String(candidate.id)) > 0
      ) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Collection '${candidate.name}' has existing documents that require an authorization migration before permission inheritance can be enabled.`,
          { details: { collectionId: String(candidate.id) } },
        );
      }
    }

    for (const previous of active?.schema.collections ?? []) {
      const next = draft.schema.collections.find(({ id }) => String(id) === String(previous.id));
      if (next === undefined) {
        const resourceId = collectionResourceId(String(previous.id));
        if (policyReferences(resourceId)) {
          throw new ApplicationError(
            "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
            409,
            `Collection '${previous.name}' has authorization policy references that must be migrated before removal.`,
            { details: { collectionId: String(previous.id) } },
          );
        }
      }
      if (permissionInheritanceEnabled(previous) === permissionInheritanceEnabled(next)) continue;
      const documentCount = await database.countDocumentsByCollectionId(String(previous.id));
      if (documentCount > 0) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Collection '${previous.name}' has documents whose authorization inheritance mode requires migration.`,
          { details: { collectionId: String(previous.id), documentCount } },
        );
      }
    }
  };
  const prepareContentRealmsForSchemaApply = async (
    collections: readonly CollectionDefinition[],
  ): Promise<void> => {
    const projectedCollections = collections.map(({ id, name }) => ({ id: String(id), name }));
    for (const collection of collections) {
      if (collection.auth === undefined) continue;
      const realm = await identityRealmStore.getRealmByKey(
        DEFAULT_WORKSPACE_ID,
        collection.auth.realmKey,
      );
      if (realm === null || realm.kind !== "content" || realm.status === "disabled") {
        throw new ApplicationError(
          "IDENTITY_REALM_NOT_FOUND",
          409,
          `Create and enable Content Realm '${collection.auth.realmKey}' before applying this Auth Collection.`,
        );
      }
      await realmAuthorization.ensureRealmPolicy(realm);
      // A newly created Realm cannot serve traffic yet, so projecting the
      // draft first closes the schema-activation/resource-projection window.
      if (realm.status === "provisioning") {
        await realmAuthorization.syncCollectionResources({ realm, collections: projectedCollections });
        await entitlementStore.reconcileRealmFromPolicy(realm.id, realm.workspaceId);
      }
    }
  };
  const syncConfiguredContentRealmResources = async (
    collections: readonly CollectionDefinition[],
    newlyAddedCollectionIds: readonly string[] = [],
  ): Promise<void> => {
    const projectedCollections = collections.map(({ id, name }) => ({ id: String(id), name }));
    for (const realmKey of new Set(
      collections.flatMap(({ auth: definition }) => definition === undefined ? [] : [definition.realmKey]),
    )) {
      const realm = await identityRealmStore.getRealmByKey(DEFAULT_WORKSPACE_ID, realmKey);
      if (realm === null || realm.kind !== "content" || realm.status !== "active") {
        throw new ApplicationError(
          "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
          503,
          `Content Realm '${realmKey}' did not activate with its Auth Collection.`,
        );
      }
      await realmAuthorization.syncCollectionResources({ realm, collections: projectedCollections });
      // Newly projected collections must gain access-preserving ceilings so the
      // realm's existing owner/admin bindings keep reaching them under enforcement.
      await entitlementStore.reconcileRealmFromPolicy(
        realm.id,
        realm.workspaceId,
        newlyAddedCollectionIds,
      );
    }
  };
  const applySchemaWithProjection = async (
    actor: ActorContext,
    input: {
      readonly expectedRevisionId: string | null;
      readonly expectedDraftVersion: string;
      readonly planId: string;
      readonly approveDestructive: boolean;
    },
  ) => database.withContentProjectionLock(async () => {
    const policyActor = authorizationActor(actor.subjectId);
    await assertSafeAuthorizationHierarchyTransition(policyActor);
    const pendingDraft = await database.getSchemaDraft();
    if (pendingDraft === null) {
      throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No schema draft exists.");
    }
    const previousCollectionIds = new Set(
      ((await database.getActiveSchema())?.schema.collections ?? []).map(({ id }) => String(id)),
    );
    const newlyAddedCollectionIds = pendingDraft.schema.collections
      .map(({ id }) => String(id))
      .filter((id) => !previousCollectionIds.has(id));
    await prepareContentRealmsForSchemaApply(pendingDraft.schema.collections);
    const quarantined = await authorization.quarantineAllContentResources(policyActor);
    let applied;
    try {
      applied = await schema.apply(actor, input);
    } catch (error: unknown) {
      await authorization.releaseContentResourceQuarantine(policyActor, quarantined);
      throw error;
    }
    try {
      await sites.reconcileCollections({
        workspaceId: actor.workspaceId,
        activeCollectionIds: applied.revision.schema.collections.map(({ id }) => String(id)),
        actorIdentityId: actor.identityId ?? actor.subjectId,
        actorSubjectId: actor.subjectId,
      });
      await syncAuthorizationResources(policyActor, applied.revision.schema.collections);
      await reconcileAuthorizationHierarchy(
        policyActor,
        applied.revision.schema.collections,
        "schema.apply",
      );
      await syncConfiguredContentRealmResources(
        applied.revision.schema.collections,
        newlyAddedCollectionIds,
      );
      // Drop entitlement ceilings for any collection retired by this apply.
      await entitlementStore.pruneRetiredCollectionEntitlements(
        actor.workspaceId,
        applied.revision.schema.collections.map(({ id }) => String(id)),
      );
    } catch (error: unknown) {
      // Schema is already committed; keep the durable fence until startup/retry reconcile.
      throw error;
    }
    return applied.revision;
  });
  const createDefaultRealmProfileSchema = async (
    actor: ActorContext,
    input: CreateRealmProfileSchemaRequest & { readonly realmId: string },
  ) => {
    assertSchemaMutationAllowed(config, "editor");
    const realm = (await identityRealms.listRealms(actor)).find(({ id }) => id === input.realmId);
    if (realm === undefined || realm.kind !== "content") {
      throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
    }
    if (realm.profileCollectionId !== undefined) return realm;
    if (realm.status !== "provisioning") {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "Only a provisioning Content Realm can create a default Profile Schema.",
      );
    }

    const [active, draft] = await Promise.all([schema.getActive(actor), schema.getDraft(actor)]);
    const activeSchema: SchemaIrV1 = active?.schema ?? {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [],
    };
    const activeProfile = activeSchema.collections.find(
      ({ auth: definition }) => definition?.realmKey === realm.key,
    );
    if (activeProfile !== undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "The Realm Auth Collection is already applied but the Realm activation is incomplete.",
      );
    }

    const draftedProfile = draft?.schema.collections.find(
      ({ auth: definition }) => definition?.realmKey === realm.key,
    );
    let workingDraft = draft;
    if (draftedProfile !== undefined && draft !== null) {
      const draftWithoutProfile = {
        ...draft.schema,
        collections: draft.schema.collections.filter(({ id }) => id !== draftedProfile.id),
      };
      if (serializeSchema(draftWithoutProfile) !== serializeSchema(activeSchema)) {
        throw new ApplicationError(
          "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
          409,
          "Apply or discard the other pending Schema changes before creating the Realm Profile Schema.",
        );
      }
      const draftedIdentifierId = draftedProfile.auth?.identifierFieldIds[0];
      const draftedIdentifier = draftedProfile.fields.find(({ id }) => id === draftedIdentifierId);
      const expectedFieldCount = input.includeDisplayName ? 2 : 1;
      const matchesRequest = draftedProfile.name === input.collectionName
        && draftedProfile.label === input.collectionLabel
        && draftedProfile.fields.length === expectedFieldCount
        && draftedIdentifier?.name === input.identifierFieldName
        && draftedProfile.auth?.identifierFieldIds.length === 1
        && draftedProfile.fields.some(({ name }) => name === "displayName") === input.includeDisplayName;
      if (!matchesRequest) {
        throw new ApplicationError(
          "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
          409,
          "The pending Realm Profile Schema was created with different quick setup values.",
        );
      }
    } else {
      if (draft !== null && serializeSchema(draft.schema) !== serializeSchema(activeSchema)) {
        throw new ApplicationError(
          "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
          409,
          "Apply or discard the pending Schema changes before creating the Realm Profile Schema.",
        );
      }
      if (activeSchema.collections.some(({ name }) => name === input.collectionName)) {
        throw new ApplicationError(
          "COLLECTION_NAME_CONFLICT",
          409,
          `Collection '${input.collectionName}' already exists.`,
        );
      }
      const fieldCount = input.includeDisplayName ? 2 : 1;
      const [collectionIds, fieldIds] = await Promise.all([
        schema.issueIds(actor, { kind: "collection", count: 1 }),
        schema.issueIds(actor, { kind: "field", count: fieldCount }),
      ]);
      const collectionId = collectionIds[0];
      const identifierFieldId = fieldIds[0];
      if (collectionId === undefined || identifierFieldId === undefined) {
        throw new ApplicationError("SCHEMA_ID_REQUEST_INVALID", 500, "Stable Schema IDs were not issued.");
      }
      const fields = [{
        id: identifierFieldId,
        name: input.identifierFieldName,
        label: "Login ID",
        type: "text" as const,
        required: true,
        unique: true,
      }];
      const displayNameFieldId = fieldIds[1];
      if (input.includeDisplayName && displayNameFieldId !== undefined) {
        fields.push({
          id: displayNameFieldId,
          name: "displayName",
          label: "Display name",
          type: "text",
          required: false,
          unique: false,
        });
      }
      const profileCollection = {
        id: collectionId,
        name: input.collectionName,
        label: input.collectionLabel,
        fields,
        auth: {
          enabled: true as const,
          realmKey: realm.key,
          identifierFieldIds: [identifierFieldId],
          acceptSystemIdentities: realm.authentication.acceptSystemIdentities,
          provisioning: realm.authentication.provisioning,
          defaultRoleIds: realm.authentication.defaultRoleIds,
        },
      } as unknown as CollectionDefinition;
      workingDraft = await schema.saveDraft(actor, {
        baseRevisionId: active?.revisionId ?? null,
        expectedDraftVersion: draft?.draftVersion ?? null,
        schema: { ...activeSchema, collections: [...activeSchema.collections, profileCollection] },
      });
    }

    if (workingDraft === null) {
      throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No Realm Profile Schema draft exists.");
    }
    const preview = await schema.preview(actor, { expectedDraftVersion: workingDraft.draftVersion });
    if (preview.requiresDestructiveApproval) {
      throw new ApplicationError(
        "SCHEMA_QUICK_SETUP_DESTRUCTIVE",
        409,
        "Quick setup cannot apply destructive Schema changes.",
      );
    }
    await applySchemaWithProjection(actor, {
      expectedRevisionId: preview.baseRevisionId,
      expectedDraftVersion: preview.draftVersion,
      planId: preview.planId,
      approveDestructive: false,
    });
    const activated = await identityRealmStore.getRealmById(realm.id);
    if (activated === null || activated.status !== "active" || activated.profileCollectionId === undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        503,
        "The Realm did not activate after applying its Profile Schema.",
      );
    }
    return activated;
  };
  const createDefaultRealmProfileField = async (
    actor: ActorContext,
    input: CreateRealmProfileFieldRequest & { readonly realmId: string },
  ) => {
    assertSchemaMutationAllowed(config, "editor");
    const realm = (await identityRealms.listRealms(actor)).find(({ id }) => id === input.realmId);
    if (realm === undefined || realm.kind !== "content") {
      throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
    }
    if (realm.profileCollectionId === undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "Create and apply the Realm Profile Schema before adding Profile fields.",
      );
    }
    if (realm.status !== "active") {
      throw new ApplicationError(
        "IDENTITY_REALM_DISABLED",
        409,
        "Enable the Content Realm before adding Profile fields.",
      );
    }

    const [active, draft] = await Promise.all([schema.getActive(actor), schema.getDraft(actor)]);
    if (active === null) {
      throw new ApplicationError("SCHEMA_REVISION_NOT_FOUND", 404, "No active Schema exists.");
    }
    if (draft !== null && serializeSchema(draft.schema) !== serializeSchema(active.schema)) {
      throw new ApplicationError(
        "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT",
        409,
        "Apply or discard the pending Schema changes before adding a Realm Profile field.",
      );
    }
    const profile = active.schema.collections.find(({ id }) => id === realm.profileCollectionId);
    if (profile === undefined || profile.auth?.realmKey !== realm.key) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "The Realm Profile Collection is not configured as its Auth Collection.",
      );
    }

    const normalizedName = input.name.toLocaleLowerCase("en-US");
    const existingField = profile.fields.find(
      ({ name }) => name.toLocaleLowerCase("en-US") === normalizedName,
    );
    if (existingField !== undefined) {
      const isIdentifier = profile.auth.identifierFieldIds.includes(existingField.id);
      if (!isIdentifier
        && existingField.name === input.name
        && existingField.label === input.label
        && existingField.type === input.type
        && existingField.required !== true) {
        return realm;
      }
      throw new ApplicationError(
        "PROFILE_FIELD_NAME_CONFLICT",
        409,
        `Profile field '${input.name}' already exists with different settings.`,
      );
    }

    const [fieldId] = await schema.issueIds(actor, { kind: "field", count: 1 });
    if (fieldId === undefined) {
      throw new ApplicationError("SCHEMA_ID_REQUEST_INVALID", 500, "A stable Field ID was not issued.");
    }
    const updatedProfile = {
      ...profile,
      fields: [...profile.fields, {
        id: fieldId,
        name: input.name,
        label: input.label,
        type: input.type,
        required: false,
        unique: false,
      }],
    } as unknown as CollectionDefinition;
    const workingDraft = await schema.saveDraft(actor, {
      baseRevisionId: active.revisionId,
      expectedDraftVersion: draft?.draftVersion ?? null,
      schema: {
        ...active.schema,
        collections: active.schema.collections.map((collection) =>
          collection.id === profile.id ? updatedProfile : collection),
      },
    });
    const preview = await schema.preview(actor, { expectedDraftVersion: workingDraft.draftVersion });
    if (preview.requiresDestructiveApproval) {
      throw new ApplicationError(
        "SCHEMA_QUICK_SETUP_DESTRUCTIVE",
        409,
        "A Realm Profile field quick addition must not require destructive approval.",
      );
    }
    await applySchemaWithProjection(actor, {
      expectedRevisionId: preview.baseRevisionId,
      expectedDraftVersion: preview.draftVersion,
      planId: preview.planId,
      approveDestructive: false,
    });
    return (await identityRealmStore.getRealmById(realm.id)) ?? realm;
  };
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
  if (config.disableAdminOrigins) {
    app.log.warn("Admin Origin validation is disabled for this development process.");
  }
  await app.register(cookie);
  app.addContentTypeParser("*", (request, payload, done) => {
    if (request.url.startsWith("/api/media") && request.method === "POST") {
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
    authenticate: async (request, audience) => {
      if (audience.type === "system") {
        if (request.cookies[SESSION_COOKIE] === undefined) {
          throw new ApplicationError(
            "ADMIN_APP_RUNTIME_SESSION_REQUIRED",
            401,
            "A System Realm session is required for this Admin App.",
            { details: { audience: { type: "system" } } },
          );
        }
        const authenticated = await requireSession(request, auth, config, false);
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
    },
    getActiveSchema: async () => {
      const active = await database.getActiveSchema();
      return active === null ? null : { revisionId: active.revisionId, schema: active.schema };
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
      createDocument: async ({ actor, collectionId, request }) => {
        const active = await database.getActiveSchema();
        const collection = active?.schema.collections.find(
          ({ id, name }) => String(id) === collectionId || name === collectionId,
        );
        if (collection?.hierarchy?.enabled === true || request.hierarchy !== undefined) {
          throw new ApplicationError(
            "CONTENT_REALM_HIERARCHY_MUTATION_UNAVAILABLE",
            409,
            "Content Realm hierarchy mutations require the dedicated hierarchy workflow.",
          );
        }
        return documents.create(actor, collectionId, request.data);
      },
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

  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("x-xecms-version", XECMS_VERSION);
    reply.header("x-xecms-api-version", "1");
  });

  app.get("/api/live", async () => ({ status: "live", version: XECMS_VERSION }));

  app.get("/api/ready", async (_request, reply) => {
    const checks:{database:boolean;migrations:boolean;storage:boolean;plugins:boolean}={database:false,migrations:false,storage:false,plugins:false};
    try{await database.ping();checks.database=true;const migrationTable=qualifiedName(database.schema,"_xecms_core_migrations");const result=await database.pool.query<{id:string}>(`SELECT id FROM ${migrationTable} ORDER BY id`);checks.migrations=CORE_MIGRATION_IDS.every(id=>result.rows.some(row=>row.id===id))&&!result.rows.some(row=>!CORE_MIGRATION_IDS.includes(row.id as never));await mkdir(config.mediaStorageRoot,{recursive:true});await access(config.mediaStorageRoot,constants.R_OK|constants.W_OK);checks.storage=true;const catalog=await plugins.listCatalog(DEFAULT_WORKSPACE_ID);checks.plugins=catalog.every(plugin=>plugin.installed?.desiredState!=="enabled"||plugin.runtimeLoaded&&!plugin.restartRequired)}catch{reply.code(503);return{status:"not-ready",checks,version:XECMS_VERSION}}if(Object.values(checks).some(value=>!value))reply.code(503);return{status:Object.values(checks).every(Boolean)?"ready":"not-ready",checks,version:XECMS_VERSION};
  });

  app.get("/api/health", async (): Promise<HealthResponse> => {
    await database.ping();
    return { status: "ok", database: "connected", version: XECMS_VERSION };
  });

  app.get("/api/system/diagnostics", async (request): Promise<SystemDiagnosticsDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    await actor.authorization!.require({ action: "system.settings.read", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
    const postgres = await database.pool.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    return { environment: config.nodeEnv, xecmsVersion: XECMS_VERSION, nodeVersion: process.version,
      postgresVersion: postgres.rows[0]!.version, schemaMode: config.schemaMode,
      workerEnabled: config.workerEnabled, uploadLimitBytes: config.mediaMaxUploadBytes,
      allowedMimeTypes: config.mediaAllowedMimeTypes, adminOriginCount: config.adminOrigins.length,
      contentOriginCount: config.contentOrigins.length, storageAdapter: "local" };
  });

  app.get("/api/workspace/settings", async (request): Promise<WorkspaceSettingsDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    await actor.authorization!.require({ action: "system.settings.read", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
    return workspaceSettingsDto(await workspaceSettings.get(actor.workspaceId));
  });

  app.patch("/api/workspace/settings", async (request): Promise<WorkspaceSettingsDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, true);
    if (actor.authentication === "api-key") throw new ApplicationError("API_KEY_ADMINISTRATION_FORBIDDEN", 403, "API keys cannot change Workspace settings.");
    await actor.authorization!.require({ action: "system.settings.update", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
    const body = workspaceSettingsInput(request.body);
    const authenticated = await requireSession(request, auth, config, false);
    await auth.reauthenticate({ identityId: authenticated.session.identity.id,
      username: authenticated.session.identity.username, password: body.currentPassword });
    return workspaceSettingsDto(await workspaceSettings.update({ workspaceId: actor.workspaceId,
      expectedRevision: body.expectedRevision, displayName: body.displayName,
      defaultTimezone: body.defaultTimezone, adminLocale: body.adminLocale,
      actorIdentityId: actor.identityId ?? actor.subjectId, actorSubjectId: actor.subjectId }));
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

  app.get("/api/schema", async (request): Promise<SchemaRevisionEnvelopeDto | null> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    const current = await schema.getActive(actor);
    return current === null ? null : revisionDto(current);
  });

  app.get("/api/schema/draft", async (request): Promise<SchemaDraftEnvelopeDto | null> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    return schema.getDraft(actor);
  });

  app.get("/api/schema/manifest", async (request): Promise<SchemaManifestDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    const artifact = await schemaArtifacts.exportManifest(actor);
    return {
      schema: JSON.parse(artifact.contents) as SchemaManifestDto["schema"],
      serialized: artifact.contents,
      hash: artifact.hash,
    };
  });

  app.get("/api/schema/types", async (request): Promise<GeneratedTypesDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    const artifact = await schemaArtifacts.generateTypes(actor);
    return {
      fileName: artifact.fileName,
      source: artifact.contents,
      hash: artifact.hash,
    };
  });

  app.put("/api/schema/manifest", async (request): Promise<SchemaDraftEnvelopeDto> => {
    assertSchemaMutationAllowed(config, "manifest");
    const { actor } = await requireActor(request, auth, authorization, config, true);
    const body = objectBody(request.body);
    if (!("schema" in body)) {
      throw badRequest("REQUEST_BODY_INVALID", "schema is required.");
    }
    return schema.importManifest(actor, {
      baseRevisionId: nullableString(body["baseRevisionId"], "baseRevisionId"),
      expectedDraftVersion: nullableString(
        body["expectedDraftVersion"],
        "expectedDraftVersion",
      ),
      schema: body["schema"],
    });
  });

  app.post("/api/schema/ids", async (request): Promise<IssueSchemaIdsResponse> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, auth, authorization, config, true);
    const body = objectBody(request.body);
    const kind = body["kind"];
    const count = body["count"];
    if (
      (kind !== "collection" &&
        kind !== "field" &&
        kind !== "relation" &&
        kind !== "component") ||
      typeof count !== "number"
    ) {
      throw badRequest("SCHEMA_ID_REQUEST_INVALID", "kind and count are required.");
    }
    const ids = await schema.issueIds(actor, { kind, count });
    return { ids } satisfies IssueSchemaIdsResponse;
  });

  app.put("/api/schema/draft", async (request): Promise<SchemaDraftEnvelopeDto> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, auth, authorization, config, true);
    const body = objectBody(request.body);
    const baseRevisionId = nullableString(body["baseRevisionId"], "baseRevisionId");
    const expectedDraftVersion = nullableString(
      body["expectedDraftVersion"],
      "expectedDraftVersion",
    );
    if (!("schema" in body)) {
      throw badRequest("REQUEST_BODY_INVALID", "schema is required.");
    }
    return schema.saveDraft(actor, {
      baseRevisionId,
      expectedDraftVersion,
      schema: body["schema"],
    });
  });

  app.post("/api/schema/preview", async (request): Promise<SchemaPreviewDto> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, auth, authorization, config, true);
    const body = objectBody(request.body);
    const expectedDraftVersion = requiredString(
      body["expectedDraftVersion"],
      "expectedDraftVersion",
    );
    const preview = await schema.preview(actor, { expectedDraftVersion });
    return {
      planId: preview.planId,
      baseRevisionId: preview.baseRevisionId,
      draftVersion: preview.draftVersion,
      schema: preview.schema,
      changes: preview.changes,
      operations: preview.operations.map(({ id, kind, summary, severity, sql }) => ({
        id,
        kind,
        summary,
        severity,
        sql,
      })),
      requiresDestructiveApproval: preview.requiresDestructiveApproval,
    };
  });

  app.post("/api/schema/apply", async (request): Promise<SchemaRevisionEnvelopeDto> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, auth, authorization, config, true);
    const body = objectBody(request.body);
    const expectedRevisionId = nullableString(body["expectedRevisionId"], "expectedRevisionId");
    const expectedDraftVersion = requiredString(body["expectedDraftVersion"], "expectedDraftVersion");
    const planId = requiredString(body["planId"], "planId");
    const approveDestructive = body["approveDestructive"];
    if (typeof approveDestructive !== "boolean") {
      throw badRequest("REQUEST_BODY_INVALID", "approveDestructive must be a boolean.");
    }
    return revisionDto(await applySchemaWithProjection(actor, {
      expectedRevisionId,
      expectedDraftVersion,
      planId,
      approveDestructive,
    }));
  });

  app.get("/api/collections", async (request): Promise<CollectionListDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    const [active, draft] = await Promise.all([schema.getActive(actor), schema.getDraft(actor)]);
    return collectionList(active, draft);
  });

  const treeDto = async (
    actor: ActorContext,
    collectionId: string,
    mode: { readonly kind: "all" | "roots" | "children" | "ancestors" | "descendants" | "subtree"; readonly documentId?: string },
  ): Promise<DocumentTreeDto> => {
    let result: ContentHierarchyQueryResult;
    if (mode.kind === "roots") {
      result = await hierarchy.listRoots(actor, collectionId);
    } else if (mode.kind === "children") {
      result = await hierarchy.listChildren(actor, collectionId, requiredString(mode.documentId, "parentId"));
    } else if (mode.kind === "ancestors") {
      result = await hierarchy.listAncestors(actor, collectionId, requiredString(mode.documentId, "documentId"));
    } else if (mode.kind === "descendants") {
      result = await hierarchy.listDescendants(actor, collectionId, requiredString(mode.documentId, "documentId"));
    } else if (mode.kind === "subtree") {
      result = await hierarchy.getSubtree(actor, collectionId, requiredString(mode.documentId, "documentId"));
  } else {
      result = await hierarchy.listAll(actor, collectionId);
    }
    return presentTree(actor, collectionId, result, documents);
  };

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

  const calculateMovePreview = async (
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    rawBody: unknown,
    requireExpectedPolicyRevision = false,
  ): Promise<{
    readonly dto: MoveDocumentPreviewDto;
    readonly hypotheticalTree: ContentHierarchyQueryResult;
    readonly request: {
      readonly newParentId: string | null;
      readonly position: number;
      readonly expectedVersion: number;
    };
  }> => {
    const body = objectBody(rawBody);
    const request = {
      newParentId: nullableString(body["newParentId"], "newParentId"),
      position: nonNegativeInteger(body["position"], "position"),
      expectedVersion: nonNegativeInteger(body["expectedVersion"], "expectedVersion"),
    };
    const expectedPolicyRevisionValue = body["expectedPolicyRevision"];
    if (requireExpectedPolicyRevision && expectedPolicyRevisionValue === undefined) {
      throw badRequest(
        "POLICY_REVISION_REQUIRED",
        "expectedPolicyRevision from a move preview is required.",
      );
    }
    if (expectedPolicyRevisionValue !== undefined && (
      typeof expectedPolicyRevisionValue !== "number" ||
      !Number.isSafeInteger(expectedPolicyRevisionValue) ||
      expectedPolicyRevisionValue < 1
    )) {
      throw badRequest("POLICY_REVISION_INVALID", "expectedPolicyRevision must be a positive integer.");
    }
    const policyRevision = await authorization.currentPolicyRevision(SYSTEM_AUTHORIZATION_REALM_ID);
    if (expectedPolicyRevisionValue !== undefined && expectedPolicyRevisionValue !== policyRevision) {
      throw new ApplicationError(
        "POLICY_REVISION_CONFLICT",
        409,
        `Expected policy revision '${expectedPolicyRevisionValue}', but current revision is '${policyRevision}'.`,
        { details: { expectedRevision: expectedPolicyRevisionValue, actualRevision: policyRevision } },
      );
    }
    const result = await hierarchy.previewMove(actor, collectionId, {
      documentId,
      ...request,
    });
    let permissionImpact = result.permissionImpact;
    if (permissionImpact !== null) {
      const contextsByResourceId = Object.fromEntries(await Promise.all(
        permissionImpact.affectedDocumentIds.map(async (affectedDocumentId) => {
          const aggregate = await database.loadDocument(affectedDocumentId);
          if (aggregate === null) {
            throw new ApplicationError(
              "HIERARCHY_INVARIANT_VIOLATION",
              500,
              "A hierarchy node has no matching document.",
            );
          }
          return [
            `resource:document:${affectedDocumentId}`,
            {
              ownerSubjectId: String(aggregate.identity.createdBy),
              status: aggregate.identity.deletion !== null
                ? "deleted"
                : aggregate.identity.lifecycle.kind === "archived"
                  ? "archived"
                  : aggregate.identity.publication !== null && aggregate.identity.currentDraftRevisionId !== null
                    ? "published-with-draft"
                    : aggregate.identity.publication !== null
                      ? "published"
                      : "draft",
            },
          ] as const;
        }),
      ));
      const effective = await authorization.previewResourceParentChange(
        authorizationActor(actor.subjectId),
        {
          resourceId: permissionImpact.documentResourceId,
          newParentResourceId: permissionImpact.afterParentResourceId,
          affectedResourceIds: permissionImpact.affectedResourceIds,
          contextsByResourceId,
        },
      );
      if (effective.policyRevision !== policyRevision) {
        throw new ApplicationError(
          "POLICY_REVISION_CONFLICT",
          409,
          "The authorization policy changed while the move preview was calculated.",
          { details: { expectedRevision: policyRevision, actualRevision: effective.policyRevision } },
        );
      }
      permissionImpact = {
        ...permissionImpact,
        requiresAuthorizationManagement: effective.requiresAuthorizationManagement,
        effectivePermissionChanges: effective.effectivePermissionChanges,
        effectiveFieldAccessChanges: effective.effectiveFieldAccessChanges,
        effectivePermissionChangesTruncated: effective.effectivePermissionChangesTruncated,
      };
    }
    return {
      request,
      hypotheticalTree: { version: result.state.version, items: result.state.positions },
      dto: {
        previousParentId: eventStringOrNull(result.event.before, "parentId"),
        previousPosition: eventInteger(result.event.before, "sortKey"),
        affectedDocumentIds: result.event.affectedDocumentIds,
        policyRevision,
        permissionImpact,
      },
    };
  };

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
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return database.withContentProjectionLock(async () => {
        const preview = await calculateMovePreview(
          actor,
          request.params.collectionId,
          request.params.documentId,
          request.body,
          true,
        );
        const policyActor = authorizationActor(actor.subjectId);
        if (preview.dto.permissionImpact?.requiresAuthorizationManagement === true) {
          await authorization.requireHierarchyPolicyManagement(policyActor);
        }

        // Prepare every read needed by the response before the command. A
        // successful write can therefore never be followed by a response 403.
        const hypotheticalById = new Map(preview.hypotheticalTree.items.map((position) => [
          String(position.documentId),
          position,
        ]));
        const movedPosition = hypotheticalById.get(request.params.documentId);
        if (movedPosition === undefined) {
          throw new ApplicationError("HIERARCHY_INVARIANT_VIOLATION", 500, "Moved node is missing.");
        }
        const candidateIds = new Set<string>([request.params.documentId]);
        let pathCursor: string | null = request.params.documentId;
        while (pathCursor !== null) {
          candidateIds.add(pathCursor);
          const position = hypotheticalById.get(pathCursor);
          pathCursor = position?.parentId === null || position?.parentId === undefined
            ? null
            : String(position.parentId);
        }
        preview.hypotheticalTree.items.forEach((position) => {
          if (position.parentId !== null && String(position.parentId) === request.params.documentId) {
            candidateIds.add(String(position.documentId));
          }
        });
        const readableDocuments = new Map<string, Awaited<ReturnType<typeof documents.get>>>();
        for (const candidateId of candidateIds) {
          try {
            readableDocuments.set(
              candidateId,
              await documents.get(actor, request.params.collectionId, candidateId),
            );
          } catch (error: unknown) {
            if (candidateId === request.params.documentId || !(error instanceof ApplicationError) || error.status !== 403) {
              throw error;
            }
          }
        }
        const movedDocument = readableDocuments.get(request.params.documentId);
        if (movedDocument === undefined) {
          throw new ApplicationError("AUTHORIZATION_DENIED", 403, "The moved document is not readable.");
        }

        let affectedResourceIds: readonly string[] = [];
        let fenced = false;
        let result;
        try {
          result = await hierarchy.moveNode(
            actor,
            request.params.collectionId,
            { documentId: request.params.documentId, ...preview.request },
            {
              beforeCommit: async (authorizedPreview) => {
                affectedResourceIds = authorizedPreview.permissionImpact?.affectedResourceIds ?? [];
                await authorization.quarantineContentResources(
                  policyActor,
                  affectedResourceIds,
                  "hierarchy-move-pending",
                );
                fenced = true;
              },
            },
          );
        } catch (error: unknown) {
          if (fenced) {
            await authorization.releaseContentResourceQuarantine(policyActor, affectedResourceIds);
          }
          throw error;
        }
        let policyRevision = preview.dto.policyRevision;
        try {
          const reconciled = await reconcileAuthorizationHierarchy(
            policyActor,
            (await database.getActiveSchema())?.schema.collections ?? [],
            "hierarchy.move",
            preview.dto.policyRevision,
          );
          policyRevision = reconciled.revision;
        } catch (error: unknown) {
          // Durable quarantine intentionally remains until a later reconcile or restart.
          throw error;
        }
        const committedPosition = result.state.positions.find(
          ({ documentId }) => String(documentId) === request.params.documentId,
        );
        if (committedPosition === undefined) {
          throw new ApplicationError("HIERARCHY_INVARIANT_VIOLATION", 500, "Moved node is missing.");
        }
        const visiblePath: string[] = [request.params.documentId];
        let visibleCursor = committedPosition.parentId === null ? null : String(committedPosition.parentId);
        while (visibleCursor !== null && readableDocuments.has(visibleCursor)) {
          visiblePath.unshift(visibleCursor);
          const parent = result.state.positions.find(({ documentId }) => String(documentId) === visibleCursor);
          visibleCursor = parent?.parentId === null || parent?.parentId === undefined
            ? null
            : String(parent.parentId);
        }
        const visibleParentId = committedPosition.parentId !== null &&
          readableDocuments.has(String(committedPosition.parentId))
          ? String(committedPosition.parentId)
          : null;
        return {
          version: result.state.version,
          node: {
            document: movedDocument,
            parentId: visibleParentId,
            position: committedPosition.sortKey,
            depth: visiblePath.length - 1,
            path: visiblePath,
            hasChildren: result.state.positions.some((position) =>
              position.parentId !== null &&
              String(position.parentId) === request.params.documentId &&
              readableDocuments.has(String(position.documentId))),
          },
          previousParentId: eventStringOrNull(result.event.before, "parentId"),
          previousPosition: eventInteger(result.event.before, "sortKey"),
          affectedDocumentIds: result.event.affectedDocumentIds,
          policyRevision,
          permissionImpact: preview.dto.permissionImpact,
        };
      });
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

  app.get<{
    Params: { collectionId: string };
    Querystring: { page?: string; pageSize?: string };
  }>(
    "/api/content/:collectionId/documents",
    async (request): Promise<PublishedDocumentListDto> =>
      documents.listPublished(publicActor(authorization), request.params.collectionId, {
        ...(request.query.page === undefined ? {} : { page: Number(request.query.page) }),
        ...(request.query.pageSize === undefined ? {} : { pageSize: Number(request.query.pageSize) }),
      }),
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/content/:collectionId/documents/:documentId",
    async (request): Promise<PublishedDocumentRecordDto> =>
      documents.getPublished(
        publicActor(authorization),
        request.params.collectionId,
        request.params.documentId,
      ),
  );

  app.get<{
    Params: { collectionId: string };
    Querystring: { page?: string; pageSize?: string; state?: string };
  }>(
    "/api/collections/:collectionId/documents",
    async (request): Promise<DocumentListDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      const state = request.query.state;
      if (state !== undefined && state !== "active" && state !== "deleted") {
        throw badRequest("INVALID_DOCUMENT_STATE", "state must be 'active' or 'deleted'.");
      }
      return documents.list(actor, request.params.collectionId, {
        ...(request.query.page === undefined ? {} : { page: Number(request.query.page) }),
        ...(request.query.pageSize === undefined ? {} : { pageSize: Number(request.query.pageSize) }),
        ...(state === undefined ? {} : { state }),
      });
    },
  );

  app.post<{ Params: { collectionId: string } }>(
    "/api/collections/:collectionId/documents",
    async (request, reply): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      if (!("data" in body)) {
        throw badRequest("REQUEST_BODY_INVALID", "data is required.");
      }
      const result = await database.withContentProjectionLock(async () => {
        const active = await database.getActiveSchema();
        const collection = active?.schema.collections.find(
          ({ id, name }) => String(id) === request.params.collectionId || name === request.params.collectionId,
        );
        let placement: {
          readonly parentId: string | null;
          readonly position: number;
          readonly expectedVersion: number;
        } | undefined;
        if (collection?.hierarchy?.enabled === true) {
          if (body["hierarchy"] === undefined) {
            const roots = await hierarchy.listRoots(actor, request.params.collectionId);
            placement = { parentId: null, position: roots.items.length, expectedVersion: roots.version };
          } else {
            const hierarchyBody = objectBody(body["hierarchy"]);
            placement = {
              parentId: nullableString(hierarchyBody["parentId"], "hierarchy.parentId"),
              position: nonNegativeInteger(hierarchyBody["position"], "hierarchy.position"),
              expectedVersion: nonNegativeInteger(
                hierarchyBody["expectedVersion"],
                "hierarchy.expectedVersion",
              ),
            };
          }
        } else if (body["hierarchy"] !== undefined) {
          throw badRequest("HIERARCHY_NOT_ENABLED", "This collection does not enable hierarchy.");
        }
        const created = await documents.create(
          actor,
          request.params.collectionId,
          body["data"],
          placement,
        );
        try {
          await reconcileAuthorizationHierarchy(
            authorizationActor(actor.subjectId),
            (await database.getActiveSchema())?.schema.collections ?? [],
            "hierarchy.create",
          );
        } catch (error: unknown) {
          // The new resource is absent, so every document-level check naturally fails closed.
          throw error;
        }
        return created;
      });
      reply.code(201);
      return result;
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      return documents.get(actor, request.params.collectionId, request.params.documentId);
    },
  );

  app.patch<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      if (!("data" in body) || typeof body["expectedVersion"] !== "number") {
        throw badRequest("REQUEST_BODY_INVALID", "data and expectedVersion are required.");
      }
      return documents.update(actor, request.params.collectionId, request.params.documentId, {
        data: body["data"],
        expectedVersion: body["expectedVersion"],
      });
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/publish",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.publish(
        actor,
        request.params.collectionId,
        request.params.documentId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/unpublish",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.unpublish(
        actor,
        request.params.collectionId,
        request.params.documentId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/revisions",
    async (request): Promise<DocumentRevisionListDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      return documents.listRevisions(
        actor,
        request.params.collectionId,
        request.params.documentId,
      );
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string; revisionId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/revisions/:revisionId",
    async (request): Promise<DocumentRevisionDetailDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, false);
      return documents.getRevision(
        actor,
        request.params.collectionId,
        request.params.documentId,
        request.params.revisionId,
      );
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string; revisionId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/revisions/:revisionId/restore",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.restoreRevision(
        actor,
        request.params.collectionId,
        request.params.documentId,
        request.params.revisionId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/restore",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.restoreDeleted(
        actor,
        request.params.collectionId,
        request.params.documentId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.delete<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/purge",
    async (request, reply) => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      await database.withContentProjectionLock(async () => {
        const policyActor = authorizationActor(actor.subjectId);
        let quarantined: readonly string[] = [];
        let fenced = false;
        try {
          await documents.purge(
            actor,
            request.params.collectionId,
            request.params.documentId,
            expectedDocumentVersion(request.body),
            {
              beforeCommit: async () => {
                quarantined = await authorization.quarantineAllContentResources(policyActor);
                fenced = true;
              },
            },
          );
        } catch (error: unknown) {
          if (fenced) {
            await authorization.releaseContentResourceQuarantine(policyActor, quarantined);
          }
          throw error;
        }
        try {
          await reconcileAuthorizationHierarchy(
            policyActor,
            (await database.getActiveSchema())?.schema.collections ?? [],
            "hierarchy.purge",
          );
        } catch (error: unknown) {
          // Purge is committed; retain the durable fence for startup recovery.
          throw error;
        }
      });
      reply.code(204).send();
    },
  );

  app.delete<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId",
    async (request, reply) => {
      const { actor } = await requireActor(request, auth, authorization, config, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      if (typeof body["expectedVersion"] !== "number") {
        throw badRequest("REQUEST_BODY_INVALID", "expectedVersion is required.");
      }
      await documents.delete(
        actor,
        request.params.collectionId,
        request.params.documentId,
        body["expectedVersion"],
      );
      reply.code(204).send();
    },
  );

  app.get("/api/media", async (request): Promise<MediaListDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, false);
    await requirePolicyPermission(actor, "media.read");
    const [records, consistency] = await Promise.all([
      media.list(actor.workspaceId),
      media.checkConsistency(actor.workspaceId),
    ]);
    const missing = new Set(consistency.missing.map(({ id }) => id));
    return { items: records.map((record) => mediaRecordDto(record, missing.has(record.id))) };
  });

  app.post("/api/media", async (request, reply): Promise<MediaRecordDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, true);
    await requirePolicyPermission(actor, "media.upload");
    const encodedFileName = singleHeader(request.headers["x-file-name"], "x-file-name");
    let originalFileName: string;
    try {
      originalFileName = decodeURIComponent(encodedFileName);
    } catch {
      throw badRequest("MEDIA_FILE_NAME_INVALID", "x-file-name must be URI encoded UTF-8.");
    }
    const declaredMimeType = (request.headers["content-type"] ?? "").split(";", 1)[0]?.trim() ?? "";
    const declaredLength = request.headers["content-length"];
    if (declaredLength !== undefined) {
      const byteLength = Number(declaredLength);
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
      stream: byteStream(request.body),
    });
    reply.code(201);
    return mediaRecordDto(uploaded.media, false);
  });

  app.get<{ Params: { mediaId: string } }>(
    "/api/media/:mediaId/content",
    async (request, reply) => {
      const actor = publicActor(authorization);
      await requirePolicyPermission(actor, "media.read");
      const opened = await media.open(request.params.mediaId);
      reply.header("content-type", opened.media.mimeType);
      reply.header("content-length", String(opened.media.size));
      reply.header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(opened.media.originalFileName)}`,
      );
      reply.header("cache-control", "public, max-age=3600, immutable");
      return reply.send(Readable.from(opened.stream));
    },
  );

  app.delete<{ Params: { mediaId: string } }>("/api/media/:mediaId", async (request, reply) => {
    const { actor } = await requireActor(request, auth, authorization, config, true);
    await requirePolicyPermission(actor, "media.delete");
    await media.delete(request.params.mediaId);
    reply.code(204).send();
  });

  app.post("/api/media/consistency", async (request): Promise<MediaConsistencyReportDto> => {
    const { actor } = await requireActor(request, auth, authorization, config, true);
    await requirePolicyPermission(actor, "media.read");
    const report = await media.checkConsistency(actor.workspaceId);
    return {
      missing: report.missing.map((record) => mediaRecordDto(record, true)),
      orphanStorageKeys: report.orphanStorageKeys,
      incomplete: report.incomplete.map(incompleteMediaRecordDto),
      healthyCount: report.healthyCount,
    };
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

  let workerTimer: NodeJS.Timeout | undefined;
  if (config.workerEnabled) {
    const runWorker = () => {
      void eventWorker.runOnce().catch((error: unknown) => {
        app.log.error({ err: error }, "event worker cycle failed");
      });
    };
    workerTimer = setInterval(runWorker, config.workerPollMs);
    workerTimer.unref();
    runWorker();
  }

  return {
    app,
    database,
    config,
    async close(): Promise<void> {
      if (workerTimer !== undefined) clearInterval(workerTimer);
      await app.close();
      if (options.database === undefined) {
        await database.close();
      }
    },
  };
}

async function requireActorBase(
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

function authorizationRealmIdFromRequest(request: FastifyRequest): string {
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

function authorizationActor(subjectId: string): AuthorizationActor {
  return { subjectId, realmId: SYSTEM_AUTHORIZATION_REALM_ID };
}

function isRealmAdministrationReadOperation(request: FastifyRequest): boolean {
  const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
  return request.method === "GET"
    || request.method === "HEAD"
    || route.endsWith("/simulate");
}

function isIndividuallyAuditedRealmAdministrationRead(request: FastifyRequest): boolean {
  const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
  return route.endsWith("/audit") || route.endsWith("/simulate");
}

async function requireLocalRealmAdministrationRouteAccess(
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

function authorizationGateway(
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

function accountProfileActor(actor: ActorContext): ActorContext {
  return {
    subjectId: actor.subjectId,
    ...(actor.identityId === undefined ? {} : { identityId: actor.identityId }),
    workspaceId: actor.workspaceId,
    ...(actor.realmId === undefined ? {} : { realmId: actor.realmId }),
    capabilities: ["document:read", "document:update"],
  };
}

function assertOwnRealmProfile(
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

function publicActor(authorization: AuthorizationApplicationService): ActorContext {
  const policyActor = authorizationActor(SYSTEM_PUBLIC_SUBJECT_ID);
  return {
    subjectId: SYSTEM_PUBLIC_SUBJECT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    capabilities: [],
    authorization: authorizationGateway(authorization, policyActor),
  };
}

async function requireSession(
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

function assertAllowedOrigin(request: FastifyRequest, config: ServerConfig): void {
  if (config.disableAdminOrigins) return;
  assertAllowedRequestOrigin(request, config.adminOrigins);
}

function assertSchemaMutationAllowed(config: ServerConfig, surface: "editor" | "manifest"): void {
  if (config.schemaMode === "locked") {
    throw new ApplicationError("SCHEMA_MUTATION_LOCKED", 423, "Schema mutation is locked by the server environment.");
  }
  if (config.schemaMode === "manifest-only" && surface === "editor") {
    throw new ApplicationError("SCHEMA_MANIFEST_ONLY", 423, "Only Schema Manifest import is allowed by the server environment.");
  }
}

function assertAllowedContentOrigin(request: FastifyRequest, config: ServerConfig): void {
  assertAllowedRequestOrigin(request, config.contentOrigins);
}

function assertAllowedRequestOrigin(
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

function setSessionCookie(
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

function clearSessionCookie(reply: FastifyReply, config: ServerConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
  });
}

function sessionDto(
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

function workspaceSettingsDto(value: {
  readonly id: string; readonly displayName: string; readonly defaultTimezone: string;
  readonly adminLocale: string; readonly revision: number; readonly updatedAt: string;
  readonly updatedBy: string;
}): WorkspaceSettingsDto {
  return { workspaceId: value.id, displayName: value.displayName,
    defaultTimezone: value.defaultTimezone, adminLocale: value.adminLocale,
    revision: value.revision, updatedAt: value.updatedAt, updatedBy: value.updatedBy };
}

function workspaceSettingsInput(value: unknown): UpdateWorkspaceSettingsRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApplicationError("WORKSPACE_SETTINGS_REQUEST_INVALID", 400, "Workspace settings body must be an object.");
  }
  const input = value as Record<string, unknown>;
  const allowed = ["expectedRevision", "displayName", "defaultTimezone", "adminLocale", "currentPassword"];
  if (Object.keys(input).some((key) => !allowed.includes(key)) ||
      !Number.isSafeInteger(input["expectedRevision"]) || Number(input["expectedRevision"]) < 1 ||
      ["displayName", "defaultTimezone", "adminLocale", "currentPassword"].some((key) => typeof input[key] !== "string" || (input[key] as string).length === 0)) {
    throw new ApplicationError("WORKSPACE_SETTINGS_REQUEST_INVALID", 400, "Workspace settings body is invalid.");
  }
  return input as unknown as UpdateWorkspaceSettingsRequest;
}

function revisionDto(revision: {
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly schema: SchemaRevisionEnvelopeDto["schema"];
  readonly createdAt: string;
  readonly createdBy: string;
}): SchemaRevisionEnvelopeDto {
  return {
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    schema: revision.schema,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
  };
}

function collectionList(
  active: { readonly revisionId: string; readonly schema: { readonly collections: readonly CollectionDefinition[] } } | null,
  draft: { readonly schema: { readonly collections: readonly CollectionDefinition[] } } | null,
): CollectionListDto {
  const activeById = new Map(active?.schema.collections.map((collection) => [collection.id, collection]) ?? []);
  const draftById = new Map(draft?.schema.collections.map((collection) => [collection.id, collection]) ?? []);
  const ids = new Set([...activeById.keys(), ...draftById.keys()]);
  return {
    items: [...ids].map((id) => {
      const applied = activeById.get(id);
      const pending = draftById.get(id);
      const collection = applied ?? pending;
      if (collection === undefined) {
        throw new Error("Collection overlay is inconsistent.");
      }
      const hasPendingChanges =
        draft !== null &&
        (applied === undefined || pending === undefined || JSON.stringify(applied) !== JSON.stringify(pending));
      return {
        id: collection.id,
        name: collection.name,
        ...(collection.label === undefined ? {} : { label: collection.label }),
        ...(collection.auth === undefined ? {} : { authRealmKey: collection.auth.realmKey }),
        kind: collection.kind ?? "collection",
        ...(collection.hierarchy === undefined ? {} : {
          hierarchy: {
            enabled: collection.hierarchy.enabled,
            ordering: collection.hierarchy.ordering ?? "manual",
            permissionInheritance: collection.hierarchy.permissionInheritance === true,
          },
        }),
        fields: collection.fields.map((field) => ({
          id: field.id,
          name: field.name,
          ...(field.label === undefined ? {} : { label: field.label }),
          type: field.type,
          required: field.required === true,
        })),
        status: applied === undefined ? "draft" as const : "applied" as const,
        hasPendingChanges,
        revisionId: applied === undefined ? null : active?.revisionId ?? null,
      };
    }),
  };
}

async function presentTree(
  actor: ActorContext,
  collectionId: string,
  result: ContentHierarchyQueryResult,
  documents: DocumentApplicationService,
): Promise<DocumentTreeDto> {
  if (result.items.length > 1_000) {
    throw new ApplicationError(
      "HIERARCHY_QUERY_TOO_LARGE",
      413,
      "A synchronous hierarchy response is limited to 1000 nodes.",
      { details: { limit: 1_000, actual: result.items.length } },
    );
  }
  const byId = new Map(result.items.map((position) => [String(position.documentId), position]));
  const childrenByParent = new Map<string, typeof result.items[number][]>();
  for (const position of result.items) {
    const parentKey = position.parentId === null ? "" : String(position.parentId);
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(position);
    childrenByParent.set(parentKey, siblings);
  }
  childrenByParent.forEach((siblings) => siblings.sort((left, right) => left.sortKey - right.sortKey));
  const orderedPositions: typeof result.items[number][] = [];
  const appendSubtree = (position: typeof result.items[number]): void => {
    orderedPositions.push(position);
    (childrenByParent.get(String(position.documentId)) ?? []).forEach(appendSubtree);
  };
  result.items
    .filter((position) => position.parentId === null || !byId.has(String(position.parentId)))
    .sort((left, right) => left.sortKey - right.sortKey)
    .forEach(appendSubtree);
  const readableEntries = await Promise.all(orderedPositions.map(async (position) => {
    const documentId = String(position.documentId);
    try {
      return [documentId, await documents.get(actor, collectionId, documentId)] as const;
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.status === 403) return null;
      throw error;
    }
  }));
  const readable = new Map(readableEntries.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  ));
  const items = orderedPositions.flatMap((position) => {
    const documentId = String(position.documentId);
    const document = readable.get(documentId);
    if (document === undefined) return [];
    const path: string[] = [documentId];
    let cursor = position.parentId === null ? null : String(position.parentId);
    const visited = new Set(path);
    while (cursor !== null && readable.has(cursor) && !visited.has(cursor)) {
      path.unshift(cursor);
      visited.add(cursor);
      const parent = byId.get(cursor);
      cursor = parent?.parentId === null || parent?.parentId === undefined
        ? null
        : String(parent.parentId);
    }
    const visibleParentId = position.parentId !== null && readable.has(String(position.parentId))
      ? String(position.parentId)
      : null;
    return {
      document,
      parentId: visibleParentId,
      position: position.sortKey,
      depth: path.length - 1,
      path,
      hasChildren: result.items.some((candidate) =>
        candidate.parentId !== null &&
        String(candidate.parentId) === documentId &&
        readable.has(String(candidate.documentId))),
    };
  });
  return { version: result.version, items };
}

function mediaRecordDto(record: MediaRecord, missing: boolean): MediaRecordDto {
  if (record.status !== "ready" || record.size === null || record.sha256 === null) {
    throw new ApplicationError("MEDIA_NOT_READY", 500, `Media '${record.id}' is not ready.`);
  }
  return {
    id: record.id,
    fileName: record.originalFileName,
    mimeType: record.mimeType,
    size: record.size,
    checksum: record.sha256,
    storageKey: record.storageKey,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    status: missing ? "missing" : "available",
  };
}

function incompleteMediaRecordDto(record: MediaRecord): IncompleteMediaRecordDto {
  if (record.status === "ready") {
    throw new ApplicationError("MEDIA_RECORD_STATE_INVALID", 500, `Media '${record.id}' is ready.`);
  }
  return {
    id: record.id,
    fileName: record.originalFileName,
    mimeType: record.mimeType,
    storageKey: record.storageKey,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    status: record.status,
    ...(record.failureReason === undefined ? {} : { failureReason: record.failureReason }),
  };
}

async function requirePolicyPermission(actor: ActorContext, action: string): Promise<void> {
  if (actor.authorization === undefined) {
    throw new ApplicationError("ACCESS_DENIED", 403, `The '${action}' permission is required.`);
  }
  await actor.authorization.require({ action, resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
}

function byteStream(value: unknown): AsyncIterable<Uint8Array> {
  if (
    value === null ||
    typeof value !== "object" ||
    !(Symbol.asyncIterator in value) ||
    typeof value[Symbol.asyncIterator] !== "function"
  ) {
    throw badRequest("MEDIA_STREAM_INVALID", "The request body must be a binary stream.");
  }
  const source = value as AsyncIterable<unknown>;
  return {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of source) {
        if (chunk instanceof Uint8Array) yield chunk;
        else if (typeof chunk === "string") yield Buffer.from(chunk);
        else throw badRequest("MEDIA_STREAM_INVALID", "The upload contains an invalid chunk.");
      }
    },
  };
}

function singleHeader(value: string | readonly string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("REQUEST_HEADER_INVALID", `${name} is required.`);
  }
  return value;
}

function eventStringOrNull(
  payload: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function eventInteger(payload: Readonly<Record<string, unknown>> | null, key: string): number {
  const value = payload?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

function credentials(input: unknown): BootstrapRequest & LoginRequest {
  const body = objectBody(input);
  const username = requiredString(body["username"], "username");
  const password = requiredString(body["password"], "password");
  return { username, password };
}

function setupTemplateInput(input: unknown): ApplySetupTemplateRequest {
  const body = objectBody(input);
  const starter = requiredString(body["starter"], "starter");
  if (!isStarterName(starter)) {
    throw badRequest("SETUP_TEMPLATE_INVALID", "starter must be minimal, blog or community.");
  }
  const rawModules = body["enabledModuleIds"];
  if (!Array.isArray(rawModules) || rawModules.some((value) => typeof value !== "string")) {
    throw badRequest("SETUP_TEMPLATE_INVALID", "enabledModuleIds must be an array of strings.");
  }
  const enabledModuleIds = [...new Set(rawModules as string[])];
  const rawLabels = body["collectionLabels"];
  if (rawLabels === null || typeof rawLabels !== "object" || Array.isArray(rawLabels)) {
    throw badRequest("SETUP_TEMPLATE_INVALID", "collectionLabels must be an object of strings.");
  }
  const collectionLabels: Record<string, string> = {};
  for (const [collectionId, label] of Object.entries(rawLabels as Record<string, unknown>)) {
    if (typeof label !== "string") {
      throw badRequest("SETUP_TEMPLATE_INVALID", `collectionLabels.${collectionId} must be a string.`);
    }
    collectionLabels[collectionId] = label;
  }
  return { starter, enabledModuleIds, collectionLabels };
}

function documentDto(document: DocumentRecord): DocumentRecordDto {
  return {
    id: document.id,
    collectionId: document.collectionId,
    data: document.data,
    version: document.version,
    displayState: document.displayState,
    draftRevisionId: document.draftRevisionId,
    publication: document.publication,
    deletion: document.deletion,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function objectBody(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("REQUEST_BODY_INVALID", "The request body must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function expectedDocumentVersion(input: unknown): number {
  const body = objectBody(input);
  const expectedVersion = body["expectedVersion"];
  if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
    throw badRequest("REQUEST_BODY_INVALID", "expectedVersion must be a positive integer.");
  }
  return expectedVersion as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest("REQUEST_BODY_INVALID", `${field} must be a non-negative safe integer.`);
  }
  return value;
}

/** Projects a managed identity onto the minimal shape entry point B needs. */
function toCrossRealmTarget(identity: ManagedIdentity): CrossRealmManagedTarget {
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("REQUEST_BODY_INVALID", `${field} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return requiredString(value, field);
}

function badRequest(code: string, message: string): ApplicationError {
  return new ApplicationError(code, 400, message);
}

function problemDetails(error: Error, requestId: string): ProblemDetails {
  if (error instanceof ApplicationError) {
    return {
      type: `urn:xecms:error:${error.code.toLocaleLowerCase("en-US")}`,
      title: statusTitle(error.status),
      status: error.status,
      detail: error.message,
      code: error.code,
      requestId,
      ...(error.options.issues === undefined ? {} : { issues: error.options.issues }),
      ...(error.options.details === undefined ? {} : { details: error.options.details }),
    };
  }
  const status = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  return {
    type: `urn:xecms:error:${status >= 500 ? "internal-server-error" : "request-invalid"}`,
    title: statusTitle(status),
    status,
    detail: status >= 500 ? "An unexpected server error occurred." : error.message,
    code: status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_INVALID",
    requestId,
  };
}

function statusTitle(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Content";
    case 429:
      return "Too Many Requests";
    default:
      return status >= 500 ? "Internal Server Error" : "Request Failed";
  }
}
