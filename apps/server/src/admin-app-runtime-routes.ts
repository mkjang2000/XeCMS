import {
  ApplicationError,
  adminAppActionAuthorizationResourceId,
  adminAppAuthorizationResourceId,
  adminAppPageAuthorizationResourceId,
  collectionResourceId,
  fieldProtectionRules,
  projectDocumentData,
  realmAuthorizationRootResourceId,
  realmCollectionResourceId,
  resolveComposedQuery,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  type ActorContext,
  type AdminAppRecord,
  type AdminAppRuntimeApplicationService,
  type AuthorizationApplicationService,
  type AuthorizationBatchCheck,
  type ComposedQueryParameterValue,
  type DocumentQueryInput,
  type MaskPolicyRegistry,
} from "@xecms/application";
import {
  extractAdminAppDependencies,
  extractAdminAppDependenciesV2,
  type AdminAppManifest,
  type ComposedPageDefinition,
  type DocumentQueryDataSource,
  type AdminPageDefinition,
  type AdminPageDefinitionV2,
} from "@xecms/admin-apps";
import type {
  AdminAppDto,
  AdminAppRuntimeAccessProfileDto,
  AdminAppRuntimeDto,
  AdminAppRuntimeUserDto,
  CollectionSummaryDto,
  ComposedDocumentDto,
  ComposedQueryResultDto,
  DocumentTreeDto,
  MediaListDto,
  MediaRecordDto,
  MoveDocumentPreviewDto,
  MoveDocumentResultDto,
} from "@xecms/contracts";
import type { CollectionDefinition, SchemaIrV1 } from "@xecms/schema";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

interface RuntimeIdentity {
  readonly actor: ActorContext;
  readonly user: AdminAppRuntimeUserDto;
  readonly audienceHint:
    | { readonly type: "system" }
    | {
        readonly type: "content-realm";
        readonly realmId: string;
        readonly realmKey: string;
        readonly name: string;
      };
}

type AuthorizationBatchCheckInput = AuthorizationBatchCheck extends infer TCheck
  ? TCheck extends { readonly id: string }
    ? Omit<TCheck, "id">
    : never
  : never;

interface Options {
  readonly app: FastifyInstance;
  readonly workspaceId: string;
  readonly runtime: AdminAppRuntimeApplicationService;
  readonly authorization: AuthorizationApplicationService;
  readonly maskPolicies: MaskPolicyRegistry;
  readonly authenticate: (
    request: FastifyRequest,
    audience: AdminAppRecord["audience"],
    requireCsrf: boolean,
  ) => Promise<RuntimeIdentity>;
  readonly getActiveSchema: () => Promise<{
    readonly revisionId: string;
    readonly schema: SchemaIrV1;
  } | null>;
  readonly data: {
    readonly tree: (actor: ActorContext, collectionId: string) => Promise<DocumentTreeDto>;
    readonly query: (
      actor: ActorContext,
      collectionId: string,
      input: DocumentQueryInput,
    ) => Promise<{
      readonly items: readonly { readonly id: string; readonly data: Readonly<Record<string, unknown>> }[];
      readonly hasNextPage: boolean;
      readonly nextCursor?: string;
    }>;
    readonly getDocument: (
      actor: ActorContext,
      collectionId: string,
      documentId: string,
    ) => Promise<{ readonly id: string; readonly data: Readonly<Record<string, unknown>> } | null>;
    readonly previewMove: (
      actor: ActorContext,
      collectionId: string,
      documentId: string,
      body: unknown,
    ) => Promise<MoveDocumentPreviewDto>;
    readonly move: (
      actor: ActorContext,
      collectionId: string,
      documentId: string,
      body: unknown,
    ) => Promise<MoveDocumentResultDto>;
    readonly listMedia: (actor: ActorContext) => Promise<MediaListDto>;
    readonly uploadMedia: (actor: ActorContext, input: {
      readonly encodedFileName: string | string[] | undefined;
      readonly contentType: string | undefined;
      readonly declaredMimeType: string | undefined;
      readonly contentLength: string | undefined;
      readonly body: unknown;
    }) => Promise<MediaRecordDto>;
  };
}

export function registerAdminAppRuntimeRoutes(options: Options): void {
  const respond = async (request: FastifyRequest, reply: FastifyReply): Promise<AdminAppRuntimeDto> => {
    const appKey = routeKey(request.params);
    const audience = await options.runtime.audience(options.workspaceId, appKey);
    if (audience === null) runtimeNotFound();
    const identity = await options.authenticate(request, audience, false);
    const runtime = options.runtime.load(identity.actor, appKey).catch((error: unknown) => {
      if (error instanceof ApplicationError && error.status === 403) {
        throw new ApplicationError(
          "ADMIN_APP_ACCESS_DENIED",
          403,
          "The authenticated account cannot access this Admin App.",
          { details: { audience: identity.audienceHint } },
        );
      }
      throw error;
    });
    const [loaded, activeSchema] = await Promise.all([
      runtime,
      options.getActiveSchema(),
    ]);
    if (activeSchema === null) {
      throw new ApplicationError(
        "ADMIN_APP_SCHEMA_UNAVAILABLE",
        503,
        "The active Schema required by this Admin App is unavailable.",
      );
    }
    const collections = runtimeCollections(
      loaded.revision.manifest,
      activeSchema.schema,
      activeSchema.revisionId,
      identity.user.realmKey,
    );
    const access = await buildAdminAppRuntimeAccessProfile(
      options.authorization,
      identity.actor,
      loaded.app,
      loaded.revision.manifest,
      collections,
    );
    reply.header("cache-control", "private, no-store");
    return {
      app: appDto(loaded.app),
      revisionId: loaded.revision.id,
      manifest: loaded.revision.manifest,
      schema: { revisionId: activeSchema.revisionId, collections },
      user: identity.user,
      access,
      dependencyHealth: loaded.dependencyHealth,
    };
  };

  options.app.get("/api/admin-apps/runtime/:appKey", respond);
  options.app.post("/api/admin-apps/runtime/:appKey/access", respond);

  const dataContext = async (request: FastifyRequest, requireCsrf: boolean) => {
    const appKey = routeKey(request.params);
    const audience = await options.runtime.audience(options.workspaceId, appKey);
    if (audience === null) runtimeNotFound();
    const identity = await options.authenticate(request, audience, requireCsrf);
    const loaded = await options.runtime.load(identity.actor, appKey);
    return { identity, manifest: loaded.revision.manifest };
  };
  const collectionContext = async (request: FastifyRequest, requireCsrf: boolean) => {
    const context = await dataContext(request, requireCsrf);
    const collectionId = routeValue(request.params, "collectionId");
    if (!manifestCollectionIds(context.manifest).includes(collectionId)) {
      throw new ApplicationError(
        "ADMIN_APP_COLLECTION_NOT_INCLUDED",
        404,
        "The Collection is not included in this Admin App Revision.",
      );
    }
    return { ...context, collectionId };
  };

  options.app.get(
    "/api/admin-apps/runtime/:appKey/collections/:collectionId/tree",
    async (request, reply): Promise<DocumentTreeDto> => {
      const context = await collectionContext(request, false);
      reply.header("cache-control", "private, no-store");
      const [tree, activeSchema] = await Promise.all([
        options.data.tree(context.identity.actor, context.collectionId),
        options.getActiveSchema(),
      ]);
      return maskTreeDocuments(options.maskPolicies, tree, activeSchema, context.collectionId);
    },
  );
  options.app.post(
    "/api/admin-apps/runtime/:appKey/pages/:pageId/data-sources/:dataSourceId/query",
    async (request, reply): Promise<ComposedQueryResultDto> => {
      const appKey = routeKey(request.params);
      const audience = await options.runtime.audience(options.workspaceId, appKey);
      if (audience === null) runtimeNotFound();
      const identity = await options.authenticate(request, audience, false);
      const [loaded, activeSchema] = await Promise.all([
        options.runtime.load(identity.actor, appKey),
        options.getActiveSchema(),
      ]);
      if (activeSchema === null) {
        throw new ApplicationError("ADMIN_APP_SCHEMA_UNAVAILABLE", 503, "The active Schema is unavailable.");
      }
      const { page, dataSource } = resolveComposedDataSource(
        loaded.revision.manifest,
        routeValue(request.params, "pageId"),
        routeValue(request.params, "dataSourceId"),
      );
      const collections = runtimeCollections(
        loaded.revision.manifest,
        activeSchema.schema,
        activeSchema.revisionId,
        identity.user.realmKey,
      );
      const access = await buildAdminAppRuntimeAccessProfile(
        options.authorization,
        identity.actor,
        loaded.app,
        loaded.revision.manifest,
        collections,
      );
      if (access.pages[page.id] !== true) {
        throw new ApplicationError("ADMIN_APP_PAGE_ACCESS_DENIED", 403, "The page is not readable.");
      }
      // Only parameters the Data Source declares may reach the query; any other
      // key a client sends is ignored (no runtime-assembled query paths).
      const declared = new Set((dataSource.parameters ?? []).map(({ id }) => id));
      const rawParameters = composedQueryParameters(request.body);
      const parameters = Object.fromEntries(
        Object.entries(rawParameters).filter(([key]) => declared.has(key)),
      );
      const input = resolveComposedQuery({
        dataSource,
        parameters,
        ...(composedQueryCursor(request.body) === undefined ? {} : { cursor: composedQueryCursor(request.body)! }),
      });
      const result = await options.data.query(identity.actor, dataSource.collectionId, input);
      const rules = fieldProtectionRules(dataSourceFieldSummaries(collections, dataSource));
      const pageUnmasked = access.pageUnmasked[page.id] === true;
      reply.header("cache-control", "private, no-store");
      return {
        items: result.items.map((item) => ({
          id: item.id,
          data: projectDocumentData({
            registry: options.maskPolicies,
            data: item.data,
            pageAllowed: true,
            pageUnmasked,
            rules,
          }),
        })),
        hasNextPage: result.hasNextPage,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      };
    },
  );
  options.app.post(
    "/api/admin-apps/runtime/:appKey/pages/:pageId/components/:componentId/document",
    async (request, reply): Promise<ComposedDocumentDto | null> => {
      const appKey = routeKey(request.params);
      const audience = await options.runtime.audience(options.workspaceId, appKey);
      if (audience === null) runtimeNotFound();
      const identity = await options.authenticate(request, audience, false);
      const [loaded, activeSchema] = await Promise.all([
        options.runtime.load(identity.actor, appKey),
        options.getActiveSchema(),
      ]);
      if (activeSchema === null) {
        throw new ApplicationError("ADMIN_APP_SCHEMA_UNAVAILABLE", 503, "The active Schema is unavailable.");
      }
      const { page, component } = resolveDetailComponent(
        loaded.revision.manifest,
        routeValue(request.params, "pageId"),
        routeValue(request.params, "componentId"),
      );
      const documentId = composedDocumentId(request.body);
      const collectionId = detailCollectionId(component);
      if (documentId === undefined || collectionId === undefined) runtimeNotFound();
      if (!manifestCollectionIds(loaded.revision.manifest).includes(collectionId)) runtimeNotFound();

      const collections = runtimeCollections(
        loaded.revision.manifest, activeSchema.schema, activeSchema.revisionId, identity.user.realmKey,
      );
      const access = await buildAdminAppRuntimeAccessProfile(
        options.authorization, identity.actor, loaded.app, loaded.revision.manifest, collections,
      );
      if (access.pages[page.id] !== true) {
        throw new ApplicationError("ADMIN_APP_PAGE_ACCESS_DENIED", 403, "The page is not readable.");
      }
      const document = await options.data.getDocument(identity.actor, collectionId, documentId);
      reply.header("cache-control", "private, no-store");
      if (document === null) return null;
      const rules = fieldProtectionRules(detailFieldSummaries(collections, component, collectionId));
      return {
        id: document.id,
        data: projectDocumentData({
          registry: options.maskPolicies,
          data: document.data,
          pageAllowed: true,
          pageUnmasked: access.pageUnmasked[page.id] === true,
          rules,
        }),
      };
    },
  );
  options.app.post(
    "/api/admin-apps/runtime/:appKey/collections/:collectionId/documents/:documentId/move/preview",
    async (request, reply): Promise<MoveDocumentPreviewDto> => {
      const context = await collectionContext(request, true);
      reply.header("cache-control", "private, no-store");
      return options.data.previewMove(
        context.identity.actor,
        context.collectionId,
        routeValue(request.params, "documentId"),
        request.body,
      );
    },
  );
  options.app.post(
    "/api/admin-apps/runtime/:appKey/collections/:collectionId/documents/:documentId/move",
    async (request, reply): Promise<MoveDocumentResultDto> => {
      const context = await collectionContext(request, true);
      reply.header("cache-control", "private, no-store");
      return options.data.move(
        context.identity.actor,
        context.collectionId,
        routeValue(request.params, "documentId"),
        request.body,
      );
    },
  );
  options.app.get(
    "/api/admin-apps/runtime/:appKey/media",
    async (request, reply): Promise<MediaListDto> => {
      const context = await dataContext(request, false);
      reply.header("cache-control", "private, no-store");
      return options.data.listMedia(context.identity.actor);
    },
  );
  options.app.post(
    "/api/admin-apps/runtime/:appKey/media",
    async (request, reply): Promise<MediaRecordDto> => {
      const context = await dataContext(request, true);
      const declaredMimeType = request.headers["x-media-content-type"];
      const result = await options.data.uploadMedia(context.identity.actor, {
        encodedFileName: request.headers["x-file-name"],
        contentType: request.headers["content-type"],
        declaredMimeType: typeof declaredMimeType === "string" ? declaredMimeType : undefined,
        contentLength: request.headers["content-length"],
        body: request.body,
      });
      reply.header("cache-control", "private, no-store");
      reply.code(201);
      return result;
    },
  );
}

/**
 * Applies Schema-sensitive Field masking to a Collection tree before it crosses
 * the response boundary. The generic tree endpoint has no composed-page unmask
 * gate, so a sensitive Field is always masked by its Schema default here; V2
 * composed pages wire `page.unmask` through {@link projectDocumentData} in CPB-4.
 */
function maskTreeDocuments(
  maskPolicies: MaskPolicyRegistry,
  tree: DocumentTreeDto,
  activeSchema: { readonly schema: SchemaIrV1 } | null,
  collectionId: string,
): DocumentTreeDto {
  const collection = activeSchema?.schema.collections.find(({ id }) => String(id) === collectionId);
  if (collection === undefined) return tree;
  const rules = fieldProtectionRules(collection.fields.map((field) => ({
    name: field.name,
    ...(field.sensitivity === undefined ? {} : { sensitivity: field.sensitivity }),
  })));
  if (rules.length === 0) return tree;
  return {
    ...tree,
    items: tree.items.map((node) => ({
      ...node,
      document: {
        ...node.document,
        data: projectDocumentData({
          registry: maskPolicies,
          data: node.document.data,
          pageAllowed: true,
          pageUnmasked: false,
          rules,
        }),
      },
    })),
  };
}

/** Resolves a composed-page Data Source from the manifest, 404 on any miss. */
function resolveComposedDataSource(
  manifest: AdminAppManifest,
  pageId: string,
  dataSourceId: string,
): { readonly page: ComposedPageDefinition; readonly dataSource: DocumentQueryDataSource } {
  if (manifest.formatVersion !== 2) runtimeNotFound();
  const page = manifest.pages.find(
    (candidate): candidate is ComposedPageDefinition =>
      candidate.type === "composed-page" && candidate.id === pageId,
  );
  if (page === undefined) runtimeNotFound();
  const dataSource = page.dataSources.find((candidate) => candidate.id === dataSourceId);
  if (dataSource === undefined || dataSource.type !== "document-query") runtimeNotFound();
  return { page, dataSource };
}

/** Resolves a composed-page detail Component from the manifest, 404 on any miss. */
function resolveDetailComponent(
  manifest: AdminAppManifest,
  pageId: string,
  componentId: string,
): { readonly page: ComposedPageDefinition; readonly component: { readonly kind: string; readonly props: Readonly<Record<string, unknown>> } } {
  if (manifest.formatVersion !== 2) runtimeNotFound();
  const page = manifest.pages.find(
    (candidate): candidate is ComposedPageDefinition =>
      candidate.type === "composed-page" && candidate.id === pageId,
  );
  if (page === undefined) runtimeNotFound();
  const component = page.components.find((candidate) => candidate.id === componentId);
  if (component === undefined || component.kind !== "core.output.detail") runtimeNotFound();
  return { page, component };
}

function detailCollectionId(component: { readonly props: Readonly<Record<string, unknown>> }): string | undefined {
  const value = component.props["collectionId"];
  return typeof value === "string" ? value : undefined;
}

function composedDocumentId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const id = (body as Readonly<Record<string, unknown>>)["documentId"];
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Field summaries (name + sensitivity) for the fields a detail Component projects. */
function detailFieldSummaries(
  collections: readonly CollectionSummaryDto[],
  component: { readonly props: Readonly<Record<string, unknown>> },
  collectionId: string,
) {
  const collection = collections.find(({ id }) => id === collectionId);
  if (collection === undefined) return [];
  const fieldProps = Array.isArray(component.props["fields"]) ? component.props["fields"] : [];
  const requested = new Set(
    (fieldProps as readonly unknown[])
      .map((field) => (field !== null && typeof field === "object" ? (field as Record<string, unknown>)["fieldId"] : undefined))
      .filter((id): id is string => typeof id === "string"),
  );
  return collection.fields
    .filter((field) => requested.has(field.id))
    .map((field) => (field.sensitivity === undefined
      ? { name: field.name }
      : { name: field.name, sensitivity: field.sensitivity }));
}

/** Field summaries (name + sensitivity) for the fields a Data Source projects. */
function dataSourceFieldSummaries(
  collections: readonly CollectionSummaryDto[],
  dataSource: DocumentQueryDataSource,
) {
  const collection = collections.find(({ id }) => id === dataSource.collectionId);
  if (collection === undefined) return [];
  const requested = new Set(dataSource.fields);
  return collection.fields
    .filter((field) => requested.has(field.id))
    .map((field) => (field.sensitivity === undefined
      ? { name: field.name }
      : { name: field.name, sensitivity: field.sensitivity }));
}

function composedQueryParameters(body: unknown): Readonly<Record<string, ComposedQueryParameterValue>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  const parameters = (body as Readonly<Record<string, unknown>>)["parameters"];
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) return {};
  const result: Record<string, ComposedQueryParameterValue> = {};
  for (const [key, value] of Object.entries(parameters as Readonly<Record<string, unknown>>)) {
    if (value === null || typeof value === "string" || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))) {
      result[key] = value as ComposedQueryParameterValue;
    } else if (Array.isArray(value) && value.every((item) =>
      item === null || typeof item === "string" || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item)))) {
      result[key] = value as ComposedQueryParameterValue;
    }
  }
  return result;
}

function composedQueryCursor(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const cursor = (body as Readonly<Record<string, unknown>>)["cursor"];
  return typeof cursor === "string" ? cursor : undefined;
}

export async function buildAdminAppRuntimeAccessProfile(
  authorization: AuthorizationApplicationService,
  actor: ActorContext,
  app: AdminAppRecord,
  manifest: AdminAppManifest,
  collections: readonly CollectionSummaryDto[],
  contractVersion: number = manifest.formatVersion,
): Promise<AdminAppRuntimeAccessProfileDto> {
  const policyActor = { subjectId: actor.subjectId, realmId: actor.realmId ?? "rlm_system" };
  const checks = new CheckCatalog();
  const appCheck = checks.permission("admin-app.access", adminAppAuthorizationResourceId(app.id));
  const permissionChecks = new Map<string, string>();
  const rememberPermission = (action: string, resourceId: string): string => {
    const key = permissionKey(action, resourceId);
    permissionChecks.set(key, checks.permission(action, resourceId));
    return key;
  };

  for (const reference of explicitPermissionReferences(manifest)) {
    rememberPermission(reference.action, reference.resourceId);
  }

  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const granularAppGates = contractVersion >= 2;
  const pageChecks = new Map<string, { readonly mode: "all" | "any"; readonly ids: readonly string[] }>();
  const pageGateChecks = new Map<string, { readonly read: string; readonly unmask: string }>();
  const actionChecks = new Map<string, {
    readonly pageId: string;
    readonly gate?: string;
    readonly domain?: string;
  }>();
  const fieldChecks = new Map<string, { readonly read: string; readonly create: string; readonly update: string }>();
  const rememberAction = (
    pageId: string,
    actionId: string,
    check: { readonly gate?: string; readonly domain?: string },
  ): void => {
    const key = `${pageId}:${actionId}`;
    actionChecks.set(key, { pageId, ...actionChecks.get(key), ...check });
  };

  for (const page of manifest.pages) {
    const pageResourceId = adminAppPageAuthorizationResourceId(app.id, page.id);
    if (granularAppGates) {
      pageGateChecks.set(page.id, {
        read: checks.permission("admin-app.page.read", pageResourceId),
        unmask: checks.permission("admin-app.page.unmask", pageResourceId),
      });
    }
    for (const action of pageActions(page)) {
      rememberAction(page.id, action.id, {
        ...(granularAppGates ? {
          gate: checks.permission(
            "admin-app.action.execute",
            adminAppActionAuthorizationResourceId(app.id, page.id, action.id),
          ),
        } : {}),
      });
    }
    const resourceId = pageCollectionId(page) === null
      ? null
      : collectionResource(actor.realmId ?? "rlm_system", pageCollectionId(page)!);
    const requirement = pageRequirement(page, resourceId, checks);
    pageChecks.set(page.id, requirement);
    if (page.type === "composed-page") {
      // Composed action.execute effects gate on the built-in content permission
      // against the effect's target Collection resource.
      for (const { actionId, collectionId } of composedActions(page)) {
        const permission = builtInActionPermission(actionId);
        if (permission === null || collectionId === undefined) continue;
        const actionResource = collectionResource(actor.realmId ?? "rlm_system", collectionId);
        rememberAction(page.id, actionId, { domain: checks.permission(permission, actionResource) });
      }
    }
    if (resourceId !== null) {
      for (const action of pageActions(page)) {
        const permission = builtInActionPermission(action.id);
        if (permission !== null) {
          rememberAction(page.id, action.id, { domain: checks.permission(permission, resourceId) });
        }
      }
      if (page.type === "document-detail" && page.layout.panels.some(({ type }) => type === "revisions")) {
        rememberAction(page.id, "core.action.revision.read", {
          domain: checks.permission("content.revision.read", resourceId),
        });
        rememberAction(page.id, "core.action.revision.restore", {
          domain: checks.permission("content.revision.restore", resourceId),
        });
      }
      const collection = collectionById.get(pageCollectionId(page)!);
      if (page.type === "collection-list" && collection?.hierarchy?.enabled === true) {
        rememberAction(page.id, "core.action.hierarchy.move", {
          domain: checks.permission("content.update", resourceId),
        });
      }
      if ((page.type === "document-form" || page.type === "singleton")
        && collection?.fields.some(({ type }) => type === "upload" || type === "rich-text") === true) {
        const realmId = actor.realmId ?? SYSTEM_AUTHORIZATION_REALM_ID;
        const mediaResourceId = realmId === SYSTEM_AUTHORIZATION_REALM_ID
          ? SYSTEM_WORKSPACE_RESOURCE_ID
          : realmAuthorizationRootResourceId(realmId);
        rememberAction(page.id, "core.action.media.read", {
          domain: checks.permission("media.read", mediaResourceId),
        });
        rememberAction(page.id, "core.action.media.upload", {
          domain: checks.permission("media.upload", mediaResourceId),
        });
      }
      for (const field of collection?.fields ?? []) {
        const key = `${collection!.id}:${field.id}`;
        if (fieldChecks.has(key)) continue;
        fieldChecks.set(key, {
          read: checks.field("content.read", resourceId, field.name, "read"),
          create: checks.field("content.create", resourceId, field.name, "write"),
          update: checks.field("content.update", resourceId, field.name, "write"),
        });
      }
    }
  }

  const evaluated = await evaluateStable(authorization, policyActor, checks.items);
  const allowed = (id: string): boolean => evaluated.decisions.get(id) === true;
  const pages = Object.fromEntries([...pageChecks].map(([pageId, requirement]) => {
    const contentAllowed = requirement.ids.length === 0
      || (requirement.mode === "all"
        ? requirement.ids.every(allowed)
        : requirement.ids.some(allowed));
    const gate = pageGateChecks.get(pageId);
    return [pageId, (gate === undefined || allowed(gate.read)) && contentAllowed];
  }));
  const pageUnmasked = Object.fromEntries([...pageChecks].map(([pageId]) => {
    const gate = pageGateChecks.get(pageId);
    return [pageId, pages[pageId] === true && (gate === undefined || allowed(gate.unmask))];
  }));
  const readable = new Map<string, string[]>();
  const writable = new Map<string, string[]>();
  for (const [key, ids] of fieldChecks) {
    const separator = key.indexOf(":");
    const collectionId = key.slice(0, separator);
    const fieldId = key.slice(separator + 1);
    if (allowed(ids.read)) add(readable, collectionId, fieldId);
    if (allowed(ids.create) || allowed(ids.update)) add(writable, collectionId, fieldId);
  }
  return {
    appAllowed: allowed(appCheck),
    pages,
    pageUnmasked,
    actions: Object.fromEntries([...actionChecks].map(([key, action]) => [
      key,
      pages[action.pageId] === true
        && (action.gate === undefined || allowed(action.gate))
        && (action.domain === undefined || allowed(action.domain)),
    ])),
    permissions: Object.fromEntries([...permissionChecks].map(([key, id]) => [key, allowed(id)])),
    readableFields: fieldProfile(collections, readable),
    writableFields: fieldProfile(collections, writable),
    policyRevision: evaluated.policyRevision,
  };
}

class CheckCatalog {
  public readonly items: AuthorizationBatchCheck[] = [];
  private readonly ids = new Map<string, string>();

  public permission(action: string, resourceId: string): string {
    return this.add(`permission\0${action}\0${resourceId}`, {
      type: "permission", action, resourceId,
    });
  }

  public field(action: string, resourceId: string, field: string, access: "read" | "write"): string {
    return this.add(`field\0${action}\0${resourceId}\0${field}\0${access}`, {
      type: "field", action, resourceId, field, access,
    });
  }

  private add(
    key: string,
    input: AuthorizationBatchCheckInput,
  ): string {
    const existing = this.ids.get(key);
    if (existing !== undefined) return existing;
    const id = `runtime-check-${this.items.length + 1}`;
    this.ids.set(key, id);
    this.items.push({ id, ...input } as AuthorizationBatchCheck);
    return id;
  }
}

async function evaluateStable(
  authorization: AuthorizationApplicationService,
  actor: { readonly subjectId: string; readonly realmId: string },
  checks: readonly AuthorizationBatchCheck[],
): Promise<{ readonly policyRevision: number; readonly decisions: ReadonlyMap<string, boolean> }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await authorization.currentPolicyRevision(actor.realmId);
    const chunks = chunk(checks, 100);
    const results = [];
    for (const items of chunks) results.push(await authorization.evaluateBatch(actor, { checks: items }));
    const after = await authorization.currentPolicyRevision(actor.realmId);
    if (before === after && results.every(({ policyRevision }) => policyRevision === before)) {
      return {
        policyRevision: before,
        decisions: new Map(results.flatMap(({ items }) => items.map((item) => [
          item.id,
          item.supported && item.decision.allowed,
        ] as const))),
      };
    }
  }
  throw new ApplicationError(
    "ADMIN_APP_ACCESS_PROFILE_STALE",
    409,
    "Authorization changed while the Admin App access profile was evaluated. Retry the request.",
  );
}

function pageRequirement(
  page: AdminPageDefinitionV2,
  resourceId: string | null,
  checks: CheckCatalog,
): { readonly mode: "all" | "any"; readonly ids: readonly string[] } {
  // Composed Pages gate access via admin-app.page.read; per-Data-Source content
  // permissions are computed in CPB-4, so no page-level content requirement here.
  if (page.type === "composed-page") return { mode: "all", ids: [] };
  if (resourceId === null) return { mode: "all", ids: [] };
  switch (page.type) {
    case "collection-list": return { mode: "all", ids: [checks.permission("content.list", resourceId)] };
    case "document-detail": return { mode: "all", ids: [checks.permission("content.read", resourceId)] };
    case "singleton": return { mode: "any", ids: [
      checks.permission("content.read", resourceId), checks.permission("content.update", resourceId),
    ] };
    case "document-form": {
      if (page.mode === "create") return { mode: "all", ids: [checks.permission("content.create", resourceId)] };
      if (page.mode === "edit") return { mode: "all", ids: [checks.permission("content.update", resourceId)] };
      return { mode: "any", ids: [
        checks.permission("content.create", resourceId), checks.permission("content.update", resourceId),
      ] };
    }
    case "dashboard":
    case "plugin-page": return { mode: "all", ids: [] };
  }
}

function pageCollectionId(page: AdminPageDefinitionV2): string | null {
  if (page.type === "composed-page") return null;
  return "collectionId" in page ? page.collectionId : null;
}

function pageActions(page: AdminPageDefinitionV2): readonly { readonly id: string }[] {
  if (page.type === "composed-page") return composedActions(page).map(({ actionId }) => ({ id: actionId }));
  if ("actions" in page) return page.actions ?? [];
  if (page.type === "collection-list") return [...(page.rowActions ?? []), ...(page.bulkActions ?? [])];
  if (page.type === "dashboard") {
    return page.widgets.flatMap(({ action }) => action === undefined ? [] : [action]);
  }
  return [];
}

/**
 * The `action.execute` effects a Composed Page declares, with the target
 * Collection (from the effect's `collectionId` arg). These drive the App action
 * gate and the built-in content permission gate; the actual mutation is
 * re-validated by the content API, so the Manifest cannot forge a permission.
 */
function composedActions(page: ComposedPageDefinition): readonly { readonly actionId: string; readonly collectionId?: string }[] {
  const result: { readonly actionId: string; readonly collectionId?: string }[] = [];
  const seen = new Set<string>();
  const events = [
    ...(page.events ?? []),
    ...page.components.flatMap((component) => component.events ?? []),
  ];
  for (const event of events) {
    for (const effect of event.effects) {
      if (effect.kind !== "action.execute") continue;
      const actionId = effect.args?.["actionId"];
      if (typeof actionId !== "string" || seen.has(actionId)) continue;
      seen.add(actionId);
      const collectionId = effect.args?.["collectionId"];
      result.push({ actionId, ...(typeof collectionId === "string" ? { collectionId } : {}) });
    }
  }
  return result;
}

function builtInActionPermission(actionId: string): string | null {
  switch (actionId) {
    case "core.action.create": return "content.create";
    case "core.action.update": return "content.update";
    case "core.action.delete": return "content.delete";
    case "core.action.archive": return "content.archive";
    case "core.action.restore": return "content.restore";
    case "core.action.publish": return "content.publish";
    case "core.action.unpublish": return "content.unpublish";
    case "core.action.export": return "content.read";
    default: return null;
  }
}

function explicitPermissionReferences(manifest: AdminAppManifest): readonly {
  readonly action: string;
  readonly resourceId: string;
}[] {
  return manifest.formatVersion === 2
    ? extractAdminAppDependenciesV2(manifest).permissionReferences
    : extractAdminAppDependencies(manifest).permissionReferences;
}

function collectionResource(realmId: string, collectionId: string): string {
  return realmId === "rlm_system"
    ? collectionResourceId(collectionId)
    : realmCollectionResourceId(realmId, collectionId);
}

function permissionKey(action: string, resourceId: string): string {
  return `${action}@${encodeURIComponent(resourceId)}`;
}

/** Collection ids a manifest depends on, dispatched by format version. */
function manifestCollectionIds(manifest: AdminAppManifest): readonly string[] {
  return manifest.formatVersion === 2
    ? extractAdminAppDependenciesV2(manifest).collectionIds
    : extractAdminAppDependencies(manifest).collectionIds;
}

function runtimeCollections(
  manifest: AdminAppManifest,
  schema: SchemaIrV1,
  revisionId: string,
  audienceRealmKey?: string,
): readonly CollectionSummaryDto[] {
  const ids = new Set(manifestCollectionIds(manifest));
  const byId = new Map(schema.collections.map((collection) => [String(collection.id), collection]));
  for (const collectionId of [...ids]) {
    const collection = byId.get(collectionId);
    for (const field of collection?.fields ?? []) {
      if (field.type !== "relation") continue;
      const target = byId.get(String(field.targetCollectionId));
      if (target !== undefined && (target.auth === undefined || target.auth.realmKey === audienceRealmKey)) {
        ids.add(String(target.id));
      }
    }
  }
  return schema.collections.filter(({ id }) => ids.has(String(id))).map((collection) =>
    collectionDto(collection, revisionId));
}

function collectionDto(collection: CollectionDefinition, revisionId: string): CollectionSummaryDto {
  return {
    id: String(collection.id),
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
      id: String(field.id),
      name: field.name,
      ...(field.label === undefined ? {} : { label: field.label }),
      type: field.type,
      required: field.required === true,
      ...(field.sensitivity === undefined ? {} : { sensitivity: field.sensitivity }),
      ...(field.type === "select" || field.type === "enum" ? {
        options: field.options,
        multiple: field.multiple === true,
      } : {}),
      ...(field.type === "relation" ? {
        targetCollectionId: String(field.targetCollectionId),
        relationCardinality: field.cardinality,
      } : {}),
      ...(field.type === "upload" ? {
        multiple: field.multiple === true,
        ...(field.acceptedMimeTypes === undefined ? {} : { acceptedMimeTypes: field.acceptedMimeTypes }),
      } : {}),
    })),
    status: "applied",
    hasPendingChanges: false,
    revisionId,
  };
}

function fieldProfile(
  collections: readonly CollectionSummaryDto[],
  allowed: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[] | null>> {
  return Object.fromEntries(collections.map((collection) => {
    const fields = allowed.get(collection.id) ?? [];
    return [collection.id, fields.length === collection.fields.length ? null : fields];
  }));
}

function add(target: Map<string, string[]>, key: string, value: string): void {
  const values = target.get(key) ?? [];
  values.push(value);
  target.set(key, values);
}

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function routeKey(value: unknown): string {
  const candidate = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)["appKey"]
    : undefined;
  if (typeof candidate !== "string" || candidate.length < 1 || candidate.length > 63) runtimeNotFound();
  return candidate;
}

function routeValue(value: unknown, key: string): string {
  const candidate = typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)[key]
    : undefined;
  if (typeof candidate !== "string" || candidate.length === 0) runtimeNotFound();
  return candidate;
}

function runtimeNotFound(): never {
  throw new ApplicationError(
    "ADMIN_APP_RUNTIME_NOT_FOUND",
    404,
    "The requested Admin App is not available.",
  );
}

function appDto(record: AdminAppRecord): AdminAppDto {
  return { ...record };
}
