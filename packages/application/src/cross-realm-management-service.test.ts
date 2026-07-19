import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "./errors.js";
import { CrossRealmManagementService } from "./cross-realm-management-service.js";
import { InMemoryRealmManagementDelegationStore } from "./realm-management-delegations.js";
import type { CrossRealmTargetMembership } from "./cross-realm-management-gate.js";

const NOW = "2026-07-20T00:00:00.000Z";

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    subjectId: "subject_b_admin",
    identityId: "usr_b_admin",
    workspaceId: "wrk",
    realmId: "rlm_b",
    capabilities: [],
    authorization: {
      require: vi.fn(async () => undefined),
      filterReadableData: vi.fn(async ({ data }) => data),
      assertWritableData: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

function membership(
  realmId: string,
  realmKind: "system" | "content" = "content",
  status: "pending" | "active" | "suspended" = "active",
): CrossRealmTargetMembership {
  return { realmId, realmKind, status };
}

describe("CrossRealmManagementService.authorize", () => {
  it("allows when the actor's realm holds the action and a delegation grants it", async () => {
    const delegations = new InMemoryRealmManagementDelegationStore();
    delegations.seed({
      workspaceId: "wrk", managingRealmId: "rlm_b", managedRealmId: "rlm_a",
      actions: ["identity.credentials.reset"], scopeByAction: { "identity.credentials.reset": "any" },
      revision: 1, updatedAt: NOW, updatedBy: "cms",
    });
    const service = new CrossRealmManagementService(delegations);
    await expect(service.authorize(actor(), {
      action: "identity.credentials.reset",
      targetMemberships: [membership("rlm_a")],
    })).resolves.toBeUndefined();
  });

  it("denies (step a) when the actor lacks the action in their own realm", async () => {
    const delegations = new InMemoryRealmManagementDelegationStore();
    delegations.seed({
      workspaceId: "wrk", managingRealmId: "rlm_b", managedRealmId: "rlm_a",
      actions: ["identity.credentials.reset"], scopeByAction: { "identity.credentials.reset": "any" },
      revision: 1, updatedAt: NOW, updatedBy: "cms",
    });
    const denied = actor();
    (denied.authorization!.require as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { status: 403 }),
    );
    const service = new CrossRealmManagementService(delegations);
    await expect(service.authorize(denied, {
      action: "identity.credentials.reset",
      targetMemberships: [membership("rlm_a")],
    })).rejects.toMatchObject({ status: 403 });
  });

  it("denies (step b) when there is no delegation", async () => {
    const service = new CrossRealmManagementService(new InMemoryRealmManagementDelegationStore());
    await expect(service.authorize(actor(), {
      action: "identity.credentials.reset",
      targetMemberships: [membership("rlm_a")],
    })).rejects.toMatchObject({ code: "CROSS_REALM_NO_DELEGATION", status: 403 });
  });

  it("denies a CMS account even with a matching delegation", async () => {
    const delegations = new InMemoryRealmManagementDelegationStore();
    delegations.seed({
      workspaceId: "wrk", managingRealmId: "rlm_b", managedRealmId: "rlm_a",
      actions: ["identity.disable"], scopeByAction: { "identity.disable": "any" },
      revision: 1, updatedAt: NOW, updatedBy: "cms",
    });
    const service = new CrossRealmManagementService(delegations);
    await expect(service.authorize(actor(), {
      action: "identity.disable",
      targetMemberships: [membership("rlm_a"), membership("rlm_system", "system")],
    })).rejects.toMatchObject({ code: "CROSS_REALM_CMS_ACCOUNT_NOT_ELIGIBLE", status: 403 });
  });

  it("rejects an actor without a realm session", async () => {
    const service = new CrossRealmManagementService(new InMemoryRealmManagementDelegationStore());
    const { realmId: _omit, ...noRealm } = actor();
    void _omit;
    await expect(service.authorize(noRealm, {
      action: "identity.disable",
      targetMemberships: [membership("rlm_a")],
    })).rejects.toMatchObject({ code: "CROSS_REALM_ACTOR_INVALID" });
  });
});
