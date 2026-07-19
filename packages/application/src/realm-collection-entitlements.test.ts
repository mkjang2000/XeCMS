import { describe, expect, it } from "vitest";
import {
  InMemoryRealmCollectionEntitlementStore,
  type RealmCollectionEntitlement,
} from "./realm-collection-entitlements.js";

const WORKSPACE = "wrk_default";
const NOW = "2026-07-20T00:00:00.000Z";

function entitlement(
  realmId: string,
  collectionId: string,
  overrides: Partial<RealmCollectionEntitlement> = {},
): RealmCollectionEntitlement {
  return {
    workspaceId: WORKSPACE,
    realmId,
    collectionId,
    actions: ["read"],
    revision: 1,
    updatedAt: NOW,
    updatedBy: "cms",
    ...overrides,
  };
}

describe("InMemoryRealmCollectionEntitlementStore", () => {
  it("carries the guaranteed Auth collection through enforcement reads", async () => {
    const store = new InMemoryRealmCollectionEntitlementStore();
    store.setEnforcement("rlm_a", WORKSPACE, "enforced", "col_auth");
    const status = await store.getEnforcement("rlm_a");
    expect(status).toMatchObject({ state: "enforced", guaranteedCollectionId: "col_auth" });
    // A later state change keeps the guarantee.
    store.setEnforcement("rlm_a", WORKSPACE, "disabled");
    expect((await store.getEnforcement("rlm_a"))?.guaranteedCollectionId).toBe("col_auth");
  });

  it("prunes ceilings whose collection is no longer active, bumping the version", async () => {
    const store = new InMemoryRealmCollectionEntitlementStore();
    store.setEnforcement("rlm_a", WORKSPACE, "enforced");
    store.seed(entitlement("rlm_a", "col_live"));
    store.seed(entitlement("rlm_a", "col_retired"));
    const before = await store.getEnforcement("rlm_a");

    await store.pruneRetiredCollectionEntitlements(WORKSPACE, ["col_live"]);

    const remaining = await store.listByRealm("rlm_a");
    expect(remaining.map((e) => e.collectionId)).toEqual(["col_live"]);
    // Version bumped so cached ceilings invalidate.
    expect((await store.getEnforcement("rlm_a"))!.version).toBeGreaterThan(before!.version);
  });

  it("only prunes within the given workspace", async () => {
    const store = new InMemoryRealmCollectionEntitlementStore();
    store.seed(entitlement("rlm_a", "col_x"));
    store.seed(entitlement("rlm_other", "col_x", { workspaceId: "wrk_other" }));

    // Prune wrk_default with an empty active set — the other workspace is untouched.
    await store.pruneRetiredCollectionEntitlements(WORKSPACE, []);

    expect(await store.listByRealm("rlm_a")).toHaveLength(0);
    expect(await store.listByRealm("rlm_other")).toHaveLength(1);
  });
});
