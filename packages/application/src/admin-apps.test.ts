import { createHash } from "node:crypto";

import { minimalBackofficeManifest, serializeAdminAppManifest } from "@xecms/admin-apps";
import { describe, expect, it, vi } from "vitest";

import {
  AdminAppApplicationService,
  StructuralAdminAppDependencyResolver,
  type AdminAppDependencyResolver,
  type AdminAppDependencyResolution,
  type AdminAppDraftRecord,
  type AdminAppRecord,
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
