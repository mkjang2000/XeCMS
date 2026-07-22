import { createHash } from "node:crypto";

import { minimalBackofficeManifest, serializeAdminAppManifest } from "@xecms/admin-apps";
import { describe, expect, it, vi } from "vitest";

import {
  AdminAppApplicationService,
  AdminAppRuntimeApplicationService,
  StructuralAdminAppDependencyResolver,
  type AdminAppDependencyResolver,
  type AdminAppDependencyResolution,
  type AdminAppDraftRecord,
  type AdminAppRecord,
  type AdminAppRevisionRecord,
  type AdminAppStore,
} from "./admin-apps.js";
import type { ActorAuthorizationGateway, ActorContext } from "./errors.js";

const serialized = serializeAdminAppManifest(minimalBackofficeManifest);
const manifestHash = createHash("sha256").update(serialized).digest("hex");
const app: AdminAppRecord = {
  id: "aap_test",
  workspaceId: "wrk_default",
  manifestId: "backoffice",
  key: "backoffice",
  name: "Backoffice",
  audience: { type: "system" },
  status: "active",
  activeRevisionId: null,
  routeVersion: 1,
  createdAt: "2026-07-17T00:00:00.000Z",
  createdByIdentityId: "identity_owner",
  createdBySubjectId: "subject_owner",
  updatedAt: "2026-07-17T00:00:00.000Z",
  updatedByIdentityId: "identity_owner",
  updatedBySubjectId: "subject_owner",
};
const draft: AdminAppDraftRecord = {
  appId: app.id,
  workspaceId: app.workspaceId,
  baseRevisionId: null,
  draftVersion: 1,
  desiredKey: app.key,
  manifest: minimalBackofficeManifest,
  manifestHash,
  createdAt: app.createdAt,
  createdByIdentityId: app.createdByIdentityId,
  createdBySubjectId: app.createdBySubjectId,
  updatedAt: app.updatedAt,
  updatedByIdentityId: app.updatedByIdentityId,
  updatedBySubjectId: app.updatedBySubjectId,
};

describe("AdminAppApplicationService", () => {
  it("uses canonical management permissions and refuses Apply with dependency blockers", async () => {
    const requirePermission = permissionMock();
    const applyDraft = vi.fn();
    const store = {
      getApp: vi.fn(async () => app),
      getDraft: vi.fn(async () => draft),
      applyDraft,
    } as unknown as AdminAppStore;
    const resolver: AdminAppDependencyResolver = {
      resolve: vi.fn(async (): Promise<AdminAppDependencyResolution> => ({
        dependencies: [{ kind: "collection", id: "col_orders" }],
        blockers: [{ code: "COLLECTION_MISSING", message: "Collection is missing." }],
      })),
    };
    const service = new AdminAppApplicationService(store, resolver, runtime());
    const actor = systemActor(requirePermission);
    const preview = await service.preview(actor, {
      appId: app.id,
      expectedActiveRevisionId: null,
      expectedRouteVersion: 1,
      expectedDraftVersion: 1,
    });

    expect(preview.blockers).toEqual([
      { code: "COLLECTION_MISSING", message: "Collection is missing." },
    ]);
    await expect(service.apply(actor, {
      appId: app.id,
      expectedActiveRevisionId: null,
      expectedRouteVersion: 1,
      expectedDraftVersion: 1,
      planId: preview.planId,
    })).rejects.toMatchObject({ code: "ADMIN_APP_PREVIEW_BLOCKED", status: 409 });
    expect(applyDraft).not.toHaveBeenCalled();
    expect(requirePermission).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin-app.apply",
      resourceId: "resource:workspace",
    }));
  });

  it("maps strict Manifest issues and rejects Content Realm management before storage", async () => {
    const createAppDraft = vi.fn();
    const service = new AdminAppApplicationService(
      { createAppDraft } as unknown as AdminAppStore,
      new StructuralAdminAppDependencyResolver(),
      runtime(),
    );
    await expect(service.create(systemActor(permissionMock()), {
      manifest: { ...minimalBackofficeManifest, unexpected: true },
    })).rejects.toMatchObject({ code: "ADMIN_APP_MANIFEST_INVALID", status: 422 });
    await expect(service.list({
      ...systemActor(permissionMock()),
      realmId: "rlm_content",
    })).rejects.toMatchObject({ code: "ADMIN_APP_MANAGEMENT_REALM_REQUIRED", status: 403 });
    expect(createAppDraft).not.toHaveBeenCalled();
  });

  it("rejects cross-Realm Auth Collections before a Draft reaches storage", async () => {
    const createAppDraft = vi.fn();
    const saveDraft = vi.fn();
    const resolver: AdminAppDependencyResolver = {
      resolve: vi.fn(async (): Promise<AdminAppDependencyResolution> => ({
        dependencies: [],
        blockers: [{
          code: "AUTH_COLLECTION_REALM_MISMATCH",
          message: "Auth Collection belongs to another Realm.",
          details: { collectionId: "col_members", collectionRealmKey: "community" },
        }],
      })),
    };
    const service = new AdminAppApplicationService(
      { createAppDraft, saveDraft } as unknown as AdminAppStore,
      resolver,
      runtime(),
    );
    const actor = systemActor(permissionMock());

    await expect(service.create(actor, { manifest: minimalBackofficeManifest }))
      .rejects.toMatchObject({ code: "ADMIN_APP_REALM_BOUNDARY_VIOLATION", status: 422 });
    await expect(service.saveDraft(actor, {
      appId: app.id,
      expectedDraftVersion: 1,
      expectedBaseRevisionId: null,
      manifest: minimalBackofficeManifest,
    })).rejects.toMatchObject({ code: "ADMIN_APP_REALM_BOUNDARY_VIOLATION", status: 422 });
    expect(createAppDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("extracts stable structural dependencies without claiming runtime availability", async () => {
    const resolution = await new StructuralAdminAppDependencyResolver().resolve({
      workspaceId: "wrk_default",
      manifest: minimalBackofficeManifest,
    });
    expect(resolution.blockers).toEqual([]);
    expect(resolution.dependencies).toEqual(expect.arrayContaining([
      { kind: "collection", id: "col_orders" },
      { kind: "field", id: "fld_order_number" },
      { kind: "widget", id: "core.widget.quick-action" },
    ]));
  });

  it("reports active Revision dependency drift through the management health contract", async () => {
    const activeApp = { ...app, activeRevisionId: "aar_active" };
    const activeRevision: AdminAppRevisionRecord = {
      id: "aar_active",
      appId: activeApp.id,
      workspaceId: activeApp.workspaceId,
      sequence: 1,
      parentRevisionId: null,
      manifest: minimalBackofficeManifest,
      manifestHash,
      dependencies: [{ kind: "schema-revision", id: "asr_active", fingerprint: "schema-before" }],
      createdAt: activeApp.createdAt,
      createdByIdentityId: activeApp.createdByIdentityId,
      createdBySubjectId: activeApp.createdBySubjectId,
    };
    const resolver: AdminAppDependencyResolver = {
      resolve: vi.fn(async (): Promise<AdminAppDependencyResolution> => ({
        dependencies: [{ kind: "schema-revision", id: "asr_active", fingerprint: "schema-after" }],
        blockers: [],
      })),
    };
    const service = new AdminAppApplicationService({
      getApp: vi.fn(async () => activeApp),
      getRevision: vi.fn(async () => activeRevision),
    } as unknown as AdminAppStore, resolver, runtime());

    await expect(service.health(systemActor(permissionMock()), activeApp.id)).resolves.toMatchObject({
      activeRevisionId: activeRevision.id,
      state: "degraded",
      blockers: [expect.objectContaining({
        code: "ADMIN_APP_DEPENDENCY_DRIFT",
        details: expect.objectContaining({
          kind: "schema-revision",
          expectedFingerprint: "schema-before",
          actualFingerprint: "schema-after",
        }),
      })],
    });
  });
});

describe("AdminAppRuntimeApplicationService", () => {
  const activeApp: AdminAppRecord = { ...app, activeRevisionId: "aar_active" };
  const revision: AdminAppRevisionRecord = {
    id: "aar_active",
    appId: activeApp.id,
    workspaceId: activeApp.workspaceId,
    sequence: 1,
    parentRevisionId: null,
    manifest: minimalBackofficeManifest,
    manifestHash,
    dependencies: [],
    createdAt: activeApp.createdAt,
    createdByIdentityId: activeApp.createdByIdentityId,
    createdBySubjectId: activeApp.createdBySubjectId,
  };

  it("does not return a Manifest until the audience actor passes admin-app.access", async () => {
    const requirePermission = permissionMock();
    const resolver = new StructuralAdminAppDependencyResolver();
    const service = new AdminAppRuntimeApplicationService({
      getAppByKey: vi.fn(async () => activeApp),
      getRevision: vi.fn(async () => revision),
    } as unknown as AdminAppStore, resolver, runtime().now);

    const loaded = await service.load(systemActor(requirePermission), "backoffice");

    expect(loaded.revision.manifest).toEqual(minimalBackofficeManifest);
    expect(loaded.dependencyHealth.healthy).toBe(true);
    expect(requirePermission).toHaveBeenCalledWith({
      action: "admin-app.access",
      resourceId: "resource:admin-app:aap_test",
    });
  });

  it("fails closed for archived, unapplied, and wrong-audience Apps", async () => {
    const getAppByKey = vi.fn(async (): Promise<AdminAppRecord> => ({
      ...activeApp,
      audience: { type: "content-realm" as const, realmId: "rlm_community" },
    }));
    const service = new AdminAppRuntimeApplicationService({
      getAppByKey,
    } as unknown as AdminAppStore, new StructuralAdminAppDependencyResolver(), runtime().now);

    await expect(service.load(systemActor(permissionMock()), "backoffice"))
      .rejects.toMatchObject({ code: "ADMIN_APP_AUDIENCE_SESSION_REQUIRED", status: 401 });
    getAppByKey.mockResolvedValueOnce({ ...activeApp, status: "archived" });
    await expect(service.load(systemActor(permissionMock()), "backoffice"))
      .rejects.toMatchObject({ code: "ADMIN_APP_RUNTIME_NOT_FOUND", status: 404 });
    getAppByKey.mockResolvedValueOnce({ ...activeApp, activeRevisionId: null });
    await expect(service.audience("wrk_default", "backoffice")).resolves.toBeNull();
  });

  it("uses the same dependency drift result in the Runtime", async () => {
    const driftedRevision: AdminAppRevisionRecord = {
      ...revision,
      dependencies: [{ kind: "renderer", id: "core.renderer.generated", fingerprint: "renderer-v1" }],
    };
    const resolver: AdminAppDependencyResolver = {
      resolve: vi.fn(async (): Promise<AdminAppDependencyResolution> => ({
        dependencies: [{ kind: "renderer", id: "core.renderer.generated", fingerprint: "renderer-v2" }],
        blockers: [],
      })),
    };
    const service = new AdminAppRuntimeApplicationService({
      getAppByKey: vi.fn(async () => activeApp),
      getRevision: vi.fn(async () => driftedRevision),
    } as unknown as AdminAppStore, resolver, runtime().now);

    await expect(service.load(systemActor(permissionMock()), "backoffice")).resolves.toMatchObject({
      dependencyHealth: {
        healthy: false,
        blockers: [expect.objectContaining({ code: "ADMIN_APP_DEPENDENCY_DRIFT" })],
      },
    });
  });
});

function runtime() {
  return {
    now: () => "2026-07-17T00:00:00.000Z",
    newAppId: () => "aap_new",
    newRevisionId: () => "aar_new",
  };
}

function permissionMock() {
  return vi.fn(async (
    _input: Parameters<ActorAuthorizationGateway["require"]>[0],
  ): Promise<void> => undefined);
}

function systemActor(requirePermission: ActorAuthorizationGateway["require"]): ActorContext {
  return {
    subjectId: "subject_owner",
    identityId: "identity_owner",
    workspaceId: "wrk_default",
    realmId: "rlm_system",
    capabilities: [],
    authorization: {
      require: requirePermission,
      filterReadableData: async ({ data }) => data,
      assertWritableData: async () => undefined,
    },
    authentication: "session",
  };
}
