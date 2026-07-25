import {
  adminAppActionAuthorizationResourceId,
  adminAppPageAuthorizationResourceId,
  type ActorContext,
  type AdminAppRecord,
  type AuthorizationApplicationService,
  type AuthorizationBatchCheck,
} from "@xecms/application";
import { minimalBackofficeManifest } from "@xecms/admin-apps";
import { describe, expect, it, vi } from "vitest";

import { buildAdminAppRuntimeAccessProfile } from "./admin-app-runtime-routes.js";

describe("Admin App Runtime access profile", () => {
  it("intersects Page and Action gates with the existing Realm decisions", async () => {
    const app = { id: "aap_access_profile" } as AdminAppRecord;
    const deniedPage = adminAppPageAuthorizationResourceId(app.id, "order-list");
    const deniedAction = adminAppActionAuthorizationResourceId(
      app.id,
      "order-create",
      "core.action.create",
    );
    const evaluateBatch = vi.fn(async (
      _actor: unknown,
      input: { readonly checks: readonly AuthorizationBatchCheck[] },
    ) => ({
      policyRevision: 7,
      items: input.checks.map((check) => {
        const allowed = !(
          (check.action === "admin-app.page.read" && check.resourceId === deniedPage)
          || (check.action === "admin-app.page.unmask"
            && check.resourceId === adminAppPageAuthorizationResourceId(app.id, "order-create"))
          || (check.action === "admin-app.action.execute" && check.resourceId === deniedAction)
        );
        return {
          id: check.id,
          type: check.type,
          supported: true,
          decision: { allowed },
          ...(check.type === "permission"
            ? { resourceId: check.resourceId }
            : { action: check.action }),
        };
      }),
    }));
    const authorization = {
      currentPolicyRevision: vi.fn(async () => 7),
      evaluateBatch,
    } as unknown as AuthorizationApplicationService;
    const actor = {
      subjectId: "subject_runtime",
      identityId: "identity_runtime",
      workspaceId: "wrk_default",
      realmId: "rlm_system",
      capabilities: [],
    } as ActorContext;

    const profile = await buildAdminAppRuntimeAccessProfile(
      authorization,
      actor,
      app,
      minimalBackofficeManifest,
      [],
      2,
    );

    expect(profile.policyRevision).toBe(7);
    expect(profile.pages).toMatchObject({ "order-list": false, "order-create": true });
    expect(profile.pageUnmasked).toMatchObject({ "order-list": false, "order-create": false });
    expect(profile.actions).toMatchObject({
      "order-list:core.action.update": false,
      "order-create:core.action.create": false,
      "overview:core.action.create": true,
    });
  });

  it("keeps V1 Generated Pages compatible with the legacy app-level gate", async () => {
    const app = { id: "aap_legacy" } as AdminAppRecord;
    const authorization = {
      currentPolicyRevision: vi.fn(async () => 3),
      evaluateBatch: vi.fn(async (
        _actor: unknown,
        input: { readonly checks: readonly AuthorizationBatchCheck[] },
      ) => ({
        policyRevision: 3,
        items: input.checks.map((check) => ({
          id: check.id,
          type: check.type,
          supported: true,
          decision: { allowed: !check.action.startsWith("admin-app.page.")
            && check.action !== "admin-app.action.execute" },
          ...(check.type === "permission"
            ? { resourceId: check.resourceId }
            : { action: check.action }),
        })),
      })),
    } as unknown as AuthorizationApplicationService;
    const actor = {
      subjectId: "subject_legacy",
      identityId: "identity_legacy",
      workspaceId: "wrk_default",
      realmId: "rlm_system",
      capabilities: [],
    } as ActorContext;

    const profile = await buildAdminAppRuntimeAccessProfile(
      authorization,
      actor,
      app,
      minimalBackofficeManifest,
      [],
    );

    expect(profile.pages["order-list"]).toBe(true);
    expect(profile.pageUnmasked["order-list"]).toBe(true);
    expect(profile.actions["order-list:core.action.update"]).toBe(true);
  });
});
