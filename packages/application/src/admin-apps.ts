import { createHash } from "node:crypto";

import {
  decodeAdminAppManifestAny,
  diffManifestValues,
  extractAdminAppDependencies,
  extractAdminAppDependenciesV2,
  serializeManifestValue,
  type AdminAppAudience,
  type AdminAppManifest,
  type AdminAppManifestDiff,
  type AdminPageDefinitionV2,
} from "@xecms/admin-apps";

import { ApplicationError, assertCapability, actorRealmId, type ActorContext } from "./errors.js";
import type { AuthorizationResourceRecord } from "./authorization.js";

export type AdminAppStatus = "active" | "archived";

/** Stable authorization target used by admin-app.access Bindings. */
export function adminAppAuthorizationResourceId(appId: string): string {
  if (appId.trim().length === 0) {
    throw new ApplicationError("ADMIN_APP_ID_INVALID", 422, "Admin App ID cannot be empty.");
  }
  return `resource:admin-app:${appId}`;
}

export function adminAppPageAuthorizationResourceId(appId: string, pageId: string): string {
  const root = adminAppAuthorizationResourceId(appId);
  if (pageId.trim().length === 0) {
    throw new ApplicationError("ADMIN_APP_PAGE_ID_INVALID", 422, "Admin App Page ID cannot be empty.");
  }
  return `${root}:page:${pageId}`;
}

export function adminAppActionAuthorizationResourceId(
  appId: string,
  pageId: string,
  actionId: string,
): string {
  const page = adminAppPageAuthorizationResourceId(appId, pageId);
  if (actionId.trim().length === 0) {
    throw new ApplicationError("ADMIN_APP_ACTION_ID_INVALID", 422, "Admin App Action ID cannot be empty.");
  }
  const digest = createHash("sha256").update(actionId).digest("hex").slice(0, 32);
  return `${page}:action:${digest}`;
}

/** Stable Realm projection used by Apply and Rollback. */
export function adminAppAuthorizationResources(
  appId: string,
  realmId: string,
  manifest: AdminAppManifest,
  rootResourceId: string,
): readonly AuthorizationResourceRecord[] {
  const root: AuthorizationResourceRecord = {
    id: adminAppAuthorizationResourceId(appId),
    realmId,
    name: manifest.name,
    type: "admin-app",
    parentId: rootResourceId,
    protected: true,
  };
  const resources: AuthorizationResourceRecord[] = [root];
  for (const page of manifest.pages) {
    const pageResource: AuthorizationResourceRecord = {
      id: adminAppPageAuthorizationResourceId(appId, page.id),
      realmId,
      name: page.type === "document-form" ? page.id : (page.title ?? page.id),
      type: "admin-app-page",
      parentId: root.id,
      protected: true,
    };
    resources.push(pageResource);
    const seen = new Set<string>();
    for (const action of adminAppPageActions(page)) {
      if (seen.has(action.id)) continue;
      seen.add(action.id);
      resources.push({
        id: adminAppActionAuthorizationResourceId(appId, page.id, action.id),
        realmId,
        name: action.label ?? action.id,
        type: "admin-app-action",
        parentId: pageResource.id,
        protected: true,
      });
    }
  }
  return resources;
}

function adminAppPageActions(
  page: AdminPageDefinitionV2,
): readonly { readonly id: string; readonly label?: string }[] {
  // Composed Pages carry their Actions on component/page events (CPB-7). Each
  // distinct actionId becomes an admin-app-action resource so the
  // admin-app.action.execute gate has a resource to bind against.
  if (page.type === "composed-page") return composedPageActions(page);
  if (page.type === "collection-list") {
    return [...(page.rowActions ?? []), ...(page.bulkActions ?? [])];
  }
  if (page.type === "document-form" || page.type === "document-detail" || page.type === "singleton") {
    return page.actions ?? [];
  }
  if (page.type === "dashboard") {
    return page.widgets.flatMap(({ action }) => action === undefined ? [] : [action]);
  }
  return [];
}

/** Distinct action.execute actionIds referenced by a Composed Page's events. */
function composedPageActions(
  page: Extract<AdminPageDefinitionV2, { type: "composed-page" }>,
): readonly { readonly id: string; readonly label?: string }[] {
  const seen = new Set<string>();
  const events = [
    ...(page.events ?? []),
    ...page.components.flatMap((component) => component.events ?? []),
  ];
  const actions: { readonly id: string }[] = [];
  for (const event of events) {
    for (const effect of event.effects) {
      if (effect.kind !== "action.execute") continue;
      const actionId = effect.args?.["actionId"];
      if (typeof actionId !== "string" || seen.has(actionId)) continue;
      seen.add(actionId);
      actions.push({ id: actionId });
    }
  }
  return actions;
}

export interface AdminAppRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly manifestId: string;
  readonly key: string;
  readonly name: string;
  readonly audience: AdminAppAudience;
  readonly status: AdminAppStatus;
  readonly activeRevisionId: string | null;
  readonly routeVersion: number;
  readonly createdAt: string;
  readonly createdByIdentityId: string;
  readonly createdBySubjectId: string;
  readonly updatedAt: string;
  readonly updatedByIdentityId: string;
  readonly updatedBySubjectId: string;
  readonly archivedAt?: string;
  readonly archivedByIdentityId?: string;
  readonly archivedBySubjectId?: string;
}

export interface AdminAppDraftRecord {
  readonly appId: string;
  readonly workspaceId: string;
  readonly baseRevisionId: string | null;
  readonly draftVersion: number;
  readonly desiredKey: string;
  readonly manifest: AdminAppManifest;
  readonly manifestHash: string;
  readonly createdAt: string;
  readonly createdByIdentityId: string;
  readonly createdBySubjectId: string;
  readonly updatedAt: string;
  readonly updatedByIdentityId: string;
  readonly updatedBySubjectId: string;
}

export type AdminAppDependencyKind =
  | "schema-revision"
  | "authorization-policy"
  | "collection"
  | "component"
  | "field"
  | "relation"
  | "realm"
  | "permission"
  | "resource"
  | "action"
  | "widget"
  | "renderer"
  | "plugin"
  | "extension"
  | "mask-policy";

export interface AdminAppDependencyRecord {
  readonly kind: AdminAppDependencyKind;
  readonly id: string;
  readonly fingerprint?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AdminAppRevisionRecord {
  readonly id: string;
  readonly appId: string;
  readonly workspaceId: string;
  readonly sequence: number;
  readonly parentRevisionId: string | null;
  readonly manifest: AdminAppManifest;
  readonly manifestHash: string;
  readonly dependencies: readonly AdminAppDependencyRecord[];
  readonly createdAt: string;
  readonly createdByIdentityId: string;
  readonly createdBySubjectId: string;
}

export interface AdminAppActivationResult {
  readonly app: AdminAppRecord;
  readonly revision: AdminAppRevisionRecord;
}

export interface AdminAppUserViewRecord {
  readonly appId: string;
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly pageId: string;
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AdminAppAuthorInput {
  readonly actorIdentityId: string;
  readonly actorSubjectId: string;
  readonly now: string;
}

export interface AdminAppStore {
  listApps(workspaceId: string, includeArchived?: boolean): Promise<readonly AdminAppRecord[]>;
  getApp(workspaceId: string, appId: string): Promise<AdminAppRecord | null>;
  getAppByKey(workspaceId: string, appKey: string): Promise<AdminAppRecord | null>;
  createAppDraft(input: AdminAppAuthorInput & {
    readonly id: string;
    readonly workspaceId: string;
    readonly manifest: AdminAppManifest;
  }): Promise<{ readonly app: AdminAppRecord; readonly draft: AdminAppDraftRecord }>;
  createDraft(input: AdminAppAuthorInput & {
    readonly appId: string;
    readonly workspaceId: string;
    readonly expectedRouteVersion: number;
  }): Promise<AdminAppDraftRecord>;
  getDraft(workspaceId: string, appId: string): Promise<AdminAppDraftRecord | null>;
  saveDraft(input: AdminAppAuthorInput & {
    readonly appId: string;
    readonly workspaceId: string;
    readonly expectedDraftVersion: number;
    readonly expectedBaseRevisionId: string | null;
    readonly manifest: AdminAppManifest;
  }): Promise<AdminAppDraftRecord>;
  discardDraft(input: AdminAppAuthorInput & {
    readonly appId: string;
    readonly workspaceId: string;
    readonly expectedDraftVersion: number;
  }): Promise<void>;
  listRevisions(workspaceId: string, appId: string): Promise<readonly AdminAppRevisionRecord[]>;
  getRevision(
    workspaceId: string,
    appId: string,
    revisionId: string,
  ): Promise<AdminAppRevisionRecord | null>;
  applyDraft(input: AdminAppAuthorInput & {
    readonly appId: string;
    readonly workspaceId: string;
    readonly revisionId: string;
    readonly expectedActiveRevisionId: string | null;
    readonly expectedRouteVersion: number;
    readonly expectedDraftVersion: number;
    readonly dependencies: readonly AdminAppDependencyRecord[];
  }): Promise<AdminAppActivationResult>;
  activateRevision(input: AdminAppAuthorInput & {
    readonly appId: string;
    readonly workspaceId: string;
    readonly targetRevisionId: string;
    readonly expectedActiveRevisionId: string;
    readonly expectedRouteVersion: number;
  }): Promise<AdminAppActivationResult>;
  setArchived(input: AdminAppAuthorInput & {
    readonly appId: string;
    readonly workspaceId: string;
    readonly expectedRouteVersion: number;
    readonly archived: boolean;
  }): Promise<AdminAppRecord>;
  deleteUnappliedApp(input: {
    readonly appId: string;
    readonly workspaceId: string;
    readonly expectedRouteVersion: number;
  }): Promise<void>;
}

export interface AdminAppRuntimeRecord {
  readonly app: AdminAppRecord;
  readonly revision: AdminAppRevisionRecord;
  readonly dependencyHealth: {
    readonly healthy: boolean;
    readonly checkedAt: string;
    readonly blockers: readonly AdminAppPreviewBlocker[];
  };
}

export interface AdminAppManagementHealth {
  readonly activeRevisionId: string | null;
  readonly state: "not-applied" | "healthy" | "degraded";
  readonly checkedAt: string;
  readonly blockers: readonly AdminAppPreviewBlocker[];
}

/**
 * Read-only execution boundary for an applied Admin App. The route adapter may
 * inspect only the audience before authentication; Manifest data is returned
 * only after the matching Realm actor passes admin-app.access.
 */
export class AdminAppRuntimeApplicationService {
  public constructor(
    private readonly store: AdminAppStore,
    private readonly dependencies: AdminAppDependencyResolver,
    private readonly now: () => string,
  ) {}

  public async audience(
    workspaceId: string,
    appKey: string,
  ): Promise<AdminAppAudience | null> {
    const app = await this.store.getAppByKey(workspaceId, appKey);
    if (app === null || app.status !== "active" || app.activeRevisionId === null) return null;
    return app.audience;
  }

  public async load(actor: ActorContext, appKey: string): Promise<AdminAppRuntimeRecord> {
    const app = await this.store.getAppByKey(actor.workspaceId, appKey);
    if (app === null || app.status !== "active" || app.activeRevisionId === null) {
      throw runtimeNotFound();
    }
    const audienceRealmId = app.audience.type === "system" ? "rlm_system" : app.audience.realmId;
    if (actorRealmId(actor) !== audienceRealmId) {
      throw new ApplicationError(
        "ADMIN_APP_AUDIENCE_SESSION_REQUIRED",
        401,
        "A session for the Admin App audience is required.",
      );
    }
    if (actor.authorization === undefined) {
      throw new ApplicationError("ACCESS_DENIED", 403, "Admin App access is denied.");
    }
    await actor.authorization.require({
      action: "admin-app.access",
      resourceId: adminAppAuthorizationResourceId(app.id),
    });
    const revision = await this.store.getRevision(actor.workspaceId, app.id, app.activeRevisionId);
    if (revision === null) {
      throw new ApplicationError(
        "ADMIN_APP_RUNTIME_INTEGRITY_ERROR",
        503,
        "The active Admin App revision is unavailable.",
      );
    }
    const resolution = await this.dependencies.resolve({
      workspaceId: actor.workspaceId,
      manifest: revision.manifest,
    });
    const blockers = dependencyHealthBlockers(revision.dependencies, resolution);
    return {
      app,
      revision,
      dependencyHealth: {
        healthy: blockers.length === 0,
        checkedAt: this.now(),
        blockers,
      },
    };
  }
}

export interface AdminAppPreviewBlocker {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AdminAppDependencyResolution {
  readonly dependencies: readonly AdminAppDependencyRecord[];
  readonly blockers: readonly AdminAppPreviewBlocker[];
}

export interface AdminAppDependencyResolver {
  resolve(input: {
    readonly workspaceId: string;
    readonly manifest: AdminAppManifest;
  }): Promise<AdminAppDependencyResolution>;
}

export interface AdminAppPreview {
  readonly appId: string;
  readonly activeRevisionId: string | null;
  readonly routeVersion: number;
  readonly draftVersion: number;
  readonly manifestHash: string;
  readonly planId: string;
  readonly diff: AdminAppManifestDiff | null;
  readonly dependencies: readonly AdminAppDependencyRecord[];
  readonly blockers: readonly AdminAppPreviewBlocker[];
}

export interface AdminAppManifestArtifact {
  readonly format: "xecms.admin-app-export";
  readonly formatVersion: 1;
  readonly appId: string;
  readonly revisionId: string | null;
  readonly manifest: AdminAppManifest;
  readonly serialized: string;
  readonly hash: string;
}

export interface AdminAppRuntime {
  readonly now: () => string;
  readonly newAppId: () => string;
  readonly newRevisionId: () => string;
}

export class StructuralAdminAppDependencyResolver implements AdminAppDependencyResolver {
  public resolve(input: {
    readonly workspaceId: string;
    readonly manifest: AdminAppManifest;
  }): Promise<AdminAppDependencyResolution> {
    const dependencies: AdminAppDependencyRecord[] = [];
    const add = (kind: AdminAppDependencyKind, values: readonly string[]): void => {
      values.forEach((id) => dependencies.push({ kind, id }));
    };
    if (input.manifest.formatVersion === 2) {
      const extracted = extractAdminAppDependenciesV2(input.manifest);
      add("realm", extracted.audienceRealmIds);
      add("collection", extracted.collectionIds);
      add("field", extracted.fieldIds);
      add("action", extracted.actionIds);
      add("mask-policy", extracted.maskPolicyIds);
      add("resource", extracted.resourceIds);
      extracted.permissionReferences.forEach(({ action, resourceId }) => dependencies.push({
        kind: "permission",
        id: `${action}@${encodeURIComponent(resourceId)}`,
        metadata: { action, resourceId },
      }));
      return Promise.resolve({ dependencies, blockers: [] });
    }
    const extracted = extractAdminAppDependencies(input.manifest);
    add("realm", extracted.audienceRealmIds);
    add("collection", extracted.collectionIds);
    add("field", extracted.fieldIds);
    add("relation", extracted.relationIds);
    add("action", extracted.actionIds);
    add("widget", extracted.widgetIds);
    add("renderer", extracted.rendererIds);
    add("extension", extracted.extensionIds);
    add("plugin", extracted.pluginIds);
    add("resource", extracted.resourceIds);
    extracted.permissionReferences.forEach(({ action, resourceId }) => dependencies.push({
      kind: "permission",
      id: `${action}@${encodeURIComponent(resourceId)}`,
      metadata: { action, resourceId },
    }));
    return Promise.resolve({ dependencies, blockers: [] });
  }
}

export class AdminAppApplicationService {
  public constructor(
    private readonly store: AdminAppStore,
    private readonly dependencies: AdminAppDependencyResolver,
    private readonly runtime: AdminAppRuntime,
  ) {}

  public async list(actor: ActorContext, includeArchived = false): Promise<readonly AdminAppRecord[]> {
    await this.allow(actor, "read");
    return this.store.listApps(actor.workspaceId, includeArchived);
  }

  public async get(actor: ActorContext, appId: string): Promise<AdminAppRecord> {
    await this.allow(actor, "read");
    return this.requireApp(actor.workspaceId, appId);
  }

  public async getDraft(actor: ActorContext, appId: string): Promise<AdminAppDraftRecord | null> {
    await this.allow(actor, "read");
    await this.requireApp(actor.workspaceId, appId);
    return this.store.getDraft(actor.workspaceId, appId);
  }

  public async create(actor: ActorContext, input: { readonly manifest: unknown }): Promise<{
    readonly app: AdminAppRecord;
    readonly draft: AdminAppDraftRecord;
  }> {
    await this.allow(actor, "create");
    const manifest = decodeManifest(input.manifest);
    await this.assertRealmBoundary(actor.workspaceId, manifest);
    return this.store.createAppDraft({
      id: this.runtime.newAppId(),
      workspaceId: actor.workspaceId,
      manifest,
      ...author(actor, this.runtime.now()),
    });
  }

  public async createDraft(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedRouteVersion: number;
  }): Promise<AdminAppDraftRecord> {
    await this.allow(actor, "update");
    return this.store.createDraft({
      workspaceId: actor.workspaceId,
      ...input,
      ...author(actor, this.runtime.now()),
    });
  }

  public async saveDraft(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedDraftVersion: number;
    readonly expectedBaseRevisionId: string | null;
    readonly manifest: unknown;
  }): Promise<AdminAppDraftRecord> {
    await this.allow(actor, "update");
    const manifest = decodeManifest(input.manifest);
    await this.assertRealmBoundary(actor.workspaceId, manifest);
    return this.store.saveDraft({
      workspaceId: actor.workspaceId,
      appId: input.appId,
      expectedDraftVersion: input.expectedDraftVersion,
      expectedBaseRevisionId: input.expectedBaseRevisionId,
      manifest,
      ...author(actor, this.runtime.now()),
    });
  }

  public async discardDraft(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedDraftVersion: number;
  }): Promise<void> {
    await this.allow(actor, "update");
    return this.store.discardDraft({
      workspaceId: actor.workspaceId,
      ...input,
      ...author(actor, this.runtime.now()),
    });
  }

  public async validate(actor: ActorContext, input: { readonly manifest: unknown }): Promise<{
    readonly manifest: AdminAppManifest;
    readonly serialized: string;
    readonly hash: string;
    readonly resolution: AdminAppDependencyResolution;
  }> {
    await this.allow(actor, "read");
    const manifest = decodeManifest(input.manifest);
    const serialized = serializeManifestValue(manifest);
    return {
      manifest,
      serialized,
      hash: sha256(serialized),
      resolution: await this.dependencies.resolve({ workspaceId: actor.workspaceId, manifest }),
    };
  }

  public async health(actor: ActorContext, appId: string): Promise<AdminAppManagementHealth> {
    await this.allow(actor, "read");
    const app = await this.requireApp(actor.workspaceId, appId);
    const checkedAt = this.runtime.now();
    if (app.activeRevisionId === null) {
      return {
        activeRevisionId: null,
        state: "not-applied",
        checkedAt,
        blockers: [],
      };
    }
    const revision = await this.requireRevision(actor.workspaceId, app.id, app.activeRevisionId);
    const resolution = await this.dependencies.resolve({
      workspaceId: actor.workspaceId,
      manifest: revision.manifest,
    });
    const blockers = dependencyHealthBlockers(revision.dependencies, resolution);
    return {
      activeRevisionId: revision.id,
      state: blockers.length === 0 ? "healthy" : "degraded",
      checkedAt,
      blockers,
    };
  }

  public async preview(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedActiveRevisionId: string | null;
    readonly expectedRouteVersion: number;
    readonly expectedDraftVersion: number;
  }): Promise<AdminAppPreview> {
    await this.allow(actor, "apply");
    const [app, draft] = await Promise.all([
      this.requireApp(actor.workspaceId, input.appId),
      this.requireDraft(actor.workspaceId, input.appId),
    ]);
    if (app.activeRevisionId !== input.expectedActiveRevisionId) {
      revisionConflict(input.expectedActiveRevisionId, app.activeRevisionId);
    }
    if (app.routeVersion !== input.expectedRouteVersion) {
      routeConflict(input.expectedRouteVersion, app.routeVersion);
    }
    if (draft.baseRevisionId !== app.activeRevisionId) {
      revisionConflict(draft.baseRevisionId, app.activeRevisionId);
    }
    if (draft.draftVersion !== input.expectedDraftVersion) {
      draftConflict(input.expectedDraftVersion, draft.draftVersion);
    }
    const active = app.activeRevisionId === null
      ? null
      : await this.requireRevision(actor.workspaceId, app.id, app.activeRevisionId);
    const resolution = await this.dependencies.resolve({
      workspaceId: actor.workspaceId,
      manifest: draft.manifest,
    });
    const preview = {
      appId: app.id,
      activeRevisionId: app.activeRevisionId,
      routeVersion: app.routeVersion,
      draftVersion: draft.draftVersion,
      manifestHash: draft.manifestHash,
      diff: active === null ? null : diffManifestValues(active.manifest, draft.manifest),
      dependencies: resolution.dependencies,
      blockers: resolution.blockers,
    };
    return { ...preview, planId: previewId(preview) };
  }

  public async apply(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedActiveRevisionId: string | null;
    readonly expectedRouteVersion: number;
    readonly expectedDraftVersion: number;
    readonly planId: string;
  }): Promise<AdminAppActivationResult> {
    await this.allow(actor, "apply");
    const preview = await this.preview(actor, input);
    if (preview.planId !== input.planId) {
      throw new ApplicationError(
        "ADMIN_APP_PLAN_STALE",
        409,
        "The Admin App Preview changed before Apply.",
        { details: { expectedPlanId: input.planId, actualPlanId: preview.planId } },
      );
    }
    if (preview.blockers.length > 0) {
      throw new ApplicationError(
        "ADMIN_APP_PREVIEW_BLOCKED",
        409,
        "The Admin App cannot be applied while Preview blockers remain.",
        { details: { blockers: preview.blockers } },
      );
    }
    return this.store.applyDraft({
      appId: input.appId,
      workspaceId: actor.workspaceId,
      revisionId: this.runtime.newRevisionId(),
      expectedActiveRevisionId: input.expectedActiveRevisionId,
      expectedRouteVersion: input.expectedRouteVersion,
      expectedDraftVersion: input.expectedDraftVersion,
      dependencies: preview.dependencies,
      ...author(actor, this.runtime.now()),
    });
  }

  public async rollback(actor: ActorContext, input: {
    readonly appId: string;
    readonly targetRevisionId: string;
    readonly expectedActiveRevisionId: string;
    readonly expectedRouteVersion: number;
  }): Promise<AdminAppActivationResult> {
    await this.allow(actor, "apply");
    return this.store.activateRevision({
      workspaceId: actor.workspaceId,
      ...input,
      ...author(actor, this.runtime.now()),
    });
  }

  public async listRevisions(
    actor: ActorContext,
    appId: string,
  ): Promise<readonly AdminAppRevisionRecord[]> {
    await this.allow(actor, "read");
    await this.requireApp(actor.workspaceId, appId);
    return this.store.listRevisions(actor.workspaceId, appId);
  }

  public async setArchived(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedRouteVersion: number;
    readonly archived: boolean;
  }): Promise<AdminAppRecord> {
    await this.allow(actor, "delete");
    return this.store.setArchived({
      workspaceId: actor.workspaceId,
      ...input,
      ...author(actor, this.runtime.now()),
    });
  }

  public async deleteUnapplied(actor: ActorContext, input: {
    readonly appId: string;
    readonly expectedRouteVersion: number;
  }): Promise<void> {
    await this.allow(actor, "delete");
    return this.store.deleteUnappliedApp({ workspaceId: actor.workspaceId, ...input });
  }

  public async exportManifest(actor: ActorContext, input: {
    readonly appId: string;
    readonly revisionId?: string;
  }): Promise<AdminAppManifestArtifact> {
    await this.allow(actor, "export");
    const app = await this.requireApp(actor.workspaceId, input.appId);
    const revisionId = input.revisionId ?? app.activeRevisionId;
    let manifest: AdminAppManifest;
    if (revisionId === null) {
      manifest = (await this.requireDraft(actor.workspaceId, app.id)).manifest;
    } else {
      manifest = (await this.requireRevision(actor.workspaceId, app.id, revisionId)).manifest;
    }
    const serialized = serializeManifestValue(manifest);
    return {
      format: "xecms.admin-app-export",
      formatVersion: 1,
      appId: app.id,
      revisionId,
      manifest,
      serialized,
      hash: sha256(serialized),
    };
  }

  public async importManifest(actor: ActorContext, input: {
    readonly appId?: string;
    readonly expectedRouteVersion?: number;
    readonly expectedDraftVersion?: number | null;
    readonly expectedBaseRevisionId?: string | null;
    readonly manifest: unknown;
  }): Promise<{ readonly app: AdminAppRecord; readonly draft: AdminAppDraftRecord }> {
    const manifest = decodeManifest(input.manifest);
    if (input.appId === undefined) return this.create(actor, { manifest });
    await this.allow(actor, "update");
    await this.assertRealmBoundary(actor.workspaceId, manifest);
    const app = await this.requireApp(actor.workspaceId, input.appId);
    let draft = await this.store.getDraft(actor.workspaceId, app.id);
    if (draft === null) {
      if (input.expectedDraftVersion !== null && input.expectedDraftVersion !== undefined) {
        draftConflict(input.expectedDraftVersion, null);
      }
      if (input.expectedRouteVersion === undefined) {
        throw new ApplicationError(
          "ADMIN_APP_ROUTE_VERSION_REQUIRED",
          400,
          "expectedRouteVersion is required when creating an imported Draft.",
        );
      }
      draft = await this.store.createDraft({
        appId: app.id,
        workspaceId: actor.workspaceId,
        expectedRouteVersion: input.expectedRouteVersion,
        ...author(actor, this.runtime.now()),
      });
    } else if (input.expectedDraftVersion !== draft.draftVersion) {
      draftConflict(input.expectedDraftVersion ?? null, draft.draftVersion);
    }
    const saved = await this.store.saveDraft({
      appId: app.id,
      workspaceId: actor.workspaceId,
      expectedDraftVersion: draft.draftVersion,
      expectedBaseRevisionId: input.expectedBaseRevisionId ?? draft.baseRevisionId,
      manifest,
      ...author(actor, this.runtime.now()),
    });
    return { app, draft: saved };
  }

  private async assertRealmBoundary(
    workspaceId: string,
    manifest: AdminAppManifest,
  ): Promise<void> {
    const resolution = await this.dependencies.resolve({ workspaceId, manifest });
    const blockers = resolution.blockers.filter(
      ({ code }) => code === "AUTH_COLLECTION_REALM_MISMATCH",
    );
    if (blockers.length === 0) return;
    throw new ApplicationError(
      "ADMIN_APP_REALM_BOUNDARY_VIOLATION",
      422,
      "An Admin App cannot include an Auth Collection owned by another Realm.",
      { details: { blockers } },
    );
  }

  private async allow(
    actor: ActorContext,
    action: "read" | "create" | "update" | "apply" | "delete" | "export",
  ): Promise<void> {
    if (actorRealmId(actor) !== "rlm_system") {
      throw new ApplicationError(
        "ADMIN_APP_MANAGEMENT_REALM_REQUIRED",
        403,
        "Admin Apps can only be managed from the System Realm.",
      );
    }
    const capability = action === "read" || action === "export"
      ? "schema:read"
      : action === "apply"
        ? "schema:apply"
        : "schema:write";
    await assertCapability(actor, capability, {
      action: `admin-app.${action}`,
      resourceId: "resource:workspace",
    });
  }

  private async requireApp(workspaceId: string, appId: string): Promise<AdminAppRecord> {
    const app = await this.store.getApp(workspaceId, appId);
    if (app === null) throw new ApplicationError("ADMIN_APP_NOT_FOUND", 404, "The Admin App does not exist.");
    return app;
  }

  private async requireDraft(workspaceId: string, appId: string): Promise<AdminAppDraftRecord> {
    const draft = await this.store.getDraft(workspaceId, appId);
    if (draft === null) throw new ApplicationError("ADMIN_APP_DRAFT_NOT_FOUND", 404, "The App Draft does not exist.");
    return draft;
  }

  private async requireRevision(
    workspaceId: string,
    appId: string,
    revisionId: string,
  ): Promise<AdminAppRevisionRecord> {
    const revision = await this.store.getRevision(workspaceId, appId, revisionId);
    if (revision === null) {
      throw new ApplicationError("ADMIN_APP_REVISION_NOT_FOUND", 404, "The Admin App revision does not exist.");
    }
    return revision;
  }
}

function decodeManifest(input: unknown): AdminAppManifest {
  try {
    return decodeAdminAppManifestAny(input);
  } catch (error: unknown) {
    if (error instanceof Error && "issues" in error &&
        Array.isArray((error as { readonly issues?: unknown }).issues)) {
      const issues = (error as { readonly issues: readonly {
        readonly code: string;
        readonly message: string;
        readonly path: readonly (string | number)[];
      }[] }).issues;
      throw new ApplicationError("ADMIN_APP_MANIFEST_INVALID", 422, error.message, { issues });
    }
    throw error;
  }
}

function previewId(input: Omit<AdminAppPreview, "planId">): string {
  return `admin_app_plan_${sha256(JSON.stringify(input))}`;
}

function dependencyHealthBlockers(
  expected: readonly AdminAppDependencyRecord[],
  resolution: AdminAppDependencyResolution,
): readonly AdminAppPreviewBlocker[] {
  const blockers = [...resolution.blockers];
  const actual = new Map(resolution.dependencies.map((dependency) => [
    `${dependency.kind}\0${dependency.id}`,
    dependency,
  ]));
  for (const dependency of expected) {
    if (dependency.fingerprint === undefined) continue;
    // Authorization policy revisions change during normal App Resource/Binding
    // administration. Existence and compatibility are resolved above; treating
    // their shared policy revision as immutable drift would degrade an App
    // immediately after Apply or every access grant/revoke.
    if (
      dependency.kind === "authorization-policy"
      || dependency.kind === "permission"
      || dependency.kind === "resource"
    ) continue;
    const current = actual.get(`${dependency.kind}\0${dependency.id}`);
    if (current === undefined || current.fingerprint === dependency.fingerprint) continue;
    blockers.push({
      code: "ADMIN_APP_DEPENDENCY_DRIFT",
      message: `${dependency.kind} '${dependency.id}' changed after this App Revision was applied.`,
      details: {
        kind: dependency.kind,
        id: dependency.id,
        expectedFingerprint: dependency.fingerprint,
        actualFingerprint: current.fingerprint ?? null,
      },
    });
  }
  return blockers;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function author(actor: ActorContext, now: string): {
  readonly actorIdentityId: string;
  readonly actorSubjectId: string;
  readonly now: string;
} {
  return { actorIdentityId: actor.identityId ?? actor.subjectId, actorSubjectId: actor.subjectId, now };
}

function revisionConflict(expected: string | null, actual: string | null): never {
  throw new ApplicationError(
    "ADMIN_APP_REVISION_CONFLICT",
    409,
    "The active Admin App revision changed after it was loaded.",
    { details: { expectedRevisionId: expected, actualRevisionId: actual } },
  );
}

function routeConflict(expected: number, actual: number): never {
  throw new ApplicationError(
    "ADMIN_APP_ROUTE_CONFLICT",
    409,
    "The Admin App route changed after it was loaded.",
    { details: { expectedRouteVersion: expected, actualRouteVersion: actual } },
  );
}

function draftConflict(expected: number | null, actual: number | null): never {
  throw new ApplicationError(
    "ADMIN_APP_DRAFT_CONFLICT",
    409,
    "The Admin App Draft was changed by another editor.",
    { details: { expectedDraftVersion: expected, actualDraftVersion: actual } },
  );
}

function runtimeNotFound(): ApplicationError {
  return new ApplicationError(
    "ADMIN_APP_RUNTIME_NOT_FOUND",
    404,
    "The requested Admin App is not available.",
  );
}
