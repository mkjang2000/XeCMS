import {
  ApplicationError,
  adminAppAuthorizationResourceId,
  collectionResourceId,
  realmAuthorizationRootResourceId,
  realmCollectionResourceId,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  type ActorContext,
  type AdminAppRecord,
  type AdminAppRuntimeApplicationService,
  type AuthorizationApplicationService,
  type AuthorizationBatchCheck,
} from "@xecms/application";
import { extractAdminAppDependencies, type AdminAppManifestV1, type AdminPageDefinition } from "@xecms/admin-apps";
import type {
  AdminAppDto,
  AdminAppRuntimeAccessProfileDto,
  AdminAppRuntimeDto,
  AdminAppRuntimeUserDto,
  CollectionSummaryDto,
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
    const access = await accessProfile(
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
    if (!extractAdminAppDependencies(context.manifest).collectionIds.includes(collectionId)) {
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
      return options.data.tree(context.identity.actor, context.collectionId);
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

async function accessProfile(
  authorization: AuthorizationApplicationService,
  actor: ActorContext,
  app: AdminAppRecord,
  manifest: AdminAppManifestV1,
  collections: readonly CollectionSummaryDto[],
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
  const pageChecks = new Map<string, { readonly mode: "all" | "any"; readonly ids: readonly string[] }>();
  const actionChecks = new Map<string, string>();
  const fieldChecks = new Map<string, { readonly read: string; readonly create: string; readonly update: string }>();

  for (const page of manifest.pages) {
    const resourceId = pageCollectionId(page) === null
      ? null
      : collectionResource(actor.realmId ?? "rlm_system", pageCollectionId(page)!);
    const requirement = pageRequirement(page, resourceId, checks);
    pageChecks.set(page.id, requirement);
    if (resourceId !== null) {
      for (const action of pageActions(page)) {
        const permission = builtInActionPermission(action.id);
        if (permission !== null) {
          actionChecks.set(`${page.id}:${action.id}`, checks.permission(permission, resourceId));
        }
      }
      if (page.type === "document-detail" && page.layout.panels.some(({ type }) => type === "revisions")) {
        actionChecks.set(`${page.id}:core.action.revision.read`, checks.permission("content.revision.read", resourceId));
        actionChecks.set(`${page.id}:core.action.revision.restore`, checks.permission("content.revision.restore", resourceId));
      }
      const collection = collectionById.get(pageCollectionId(page)!);
      if (page.type === "collection-list" && collection?.hierarchy?.enabled === true) {
        actionChecks.set(
          `${page.id}:core.action.hierarchy.move`,
          checks.permission("content.update", resourceId),
        );
      }
      if ((page.type === "document-form" || page.type === "singleton")
        && collection?.fields.some(({ type }) => type === "upload" || type === "rich-text") === true) {
        const realmId = actor.realmId ?? SYSTEM_AUTHORIZATION_REALM_ID;
        const mediaResourceId = realmId === SYSTEM_AUTHORIZATION_REALM_ID
          ? SYSTEM_WORKSPACE_RESOURCE_ID
          : realmAuthorizationRootResourceId(realmId);
        actionChecks.set(`${page.id}:core.action.media.read`, checks.permission("media.read", mediaResourceId));
        actionChecks.set(`${page.id}:core.action.media.upload`, checks.permission("media.upload", mediaResourceId));
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
  const pages = Object.fromEntries([...pageChecks].map(([pageId, requirement]) => [
    pageId,
    requirement.ids.length === 0
      ? true
      : requirement.mode === "all"
        ? requirement.ids.every(allowed)
        : requirement.ids.some(allowed),
  ]));
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
    actions: Object.fromEntries([...actionChecks].map(([key, id]) => [key, allowed(id)])),
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
  page: AdminPageDefinition,
  resourceId: string | null,
  checks: CheckCatalog,
): { readonly mode: "all" | "any"; readonly ids: readonly string[] } {
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

function pageCollectionId(page: AdminPageDefinition): string | null {
  return "collectionId" in page ? page.collectionId : null;
}

function pageActions(page: AdminPageDefinition): readonly { readonly id: string }[] {
  if ("actions" in page) return page.actions ?? [];
  if (page.type === "collection-list") return [...(page.rowActions ?? []), ...(page.bulkActions ?? [])];
  return [];
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

function explicitPermissionReferences(manifest: AdminAppManifestV1): readonly {
  readonly action: string;
  readonly resourceId: string;
}[] {
  return extractAdminAppDependencies(manifest).permissionReferences;
}

function collectionResource(realmId: string, collectionId: string): string {
  return realmId === "rlm_system"
    ? collectionResourceId(collectionId)
    : realmCollectionResourceId(realmId, collectionId);
}

function permissionKey(action: string, resourceId: string): string {
  return `${action}@${encodeURIComponent(resourceId)}`;
}

function runtimeCollections(
  manifest: AdminAppManifestV1,
  schema: SchemaIrV1,
  revisionId: string,
  audienceRealmKey?: string,
): readonly CollectionSummaryDto[] {
  const ids = new Set(extractAdminAppDependencies(manifest).collectionIds);
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
