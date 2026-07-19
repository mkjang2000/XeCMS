import { describe, expect, it } from "vitest";
import {
  evaluateCrossRealmManagement,
  type CrossRealmTargetMembership,
} from "./cross-realm-management-gate.js";
import type {
  ManagementAction,
  RealmManagementDelegation,
} from "./realm-management-delegations.js";

const NOW = "2026-07-20T00:00:00.000Z";

function membership(
  realmId: string,
  realmKind: "system" | "content",
  status: "pending" | "active" | "suspended" = "active",
): CrossRealmTargetMembership {
  return { realmId, realmKind, status };
}

function delegation(
  managingRealmId: string,
  managedRealmId: string,
  action: ManagementAction,
  scope: "any" | "all",
): RealmManagementDelegation {
  return {
    workspaceId: "wrk",
    managingRealmId,
    managedRealmId,
    actions: [action],
    scopeByAction: { [action]: scope },
    revision: 1,
    updatedAt: NOW,
    updatedBy: "cms",
  };
}

const RESET: ManagementAction = "identity.credentials.reset";

describe("evaluateCrossRealmManagement (fail-closed)", () => {
  it("denies when there is no delegation at all", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content")],
      delegations: [],
    })).toEqual({ kind: "deny", reason: "NO_DELEGATION" });
  });

  it("denies when the delegation grants a different action", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content")],
      delegations: [delegation("rlm_b", "rlm_a", "identity.disable", "any")],
    })).toEqual({ kind: "deny", reason: "NO_DELEGATION" });
  });

  it("denies when the delegation belongs to a different managing realm", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content")],
      delegations: [delegation("rlm_c", "rlm_a", RESET, "any")],
    })).toEqual({ kind: "deny", reason: "NO_DELEGATION" });
  });

  // --- CMS-account cut (highest priority, non-overridable) ---
  it("always denies a CMS account even with a matching delegation", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      // Target holds an active System membership → CMS account.
      targetMemberships: [membership("rlm_a", "content"), membership("rlm_system", "system")],
      delegations: [delegation("rlm_b", "rlm_a", RESET, "any")],
    })).toEqual({ kind: "deny", reason: "CMS_ACCOUNT_NOT_ELIGIBLE" });
  });

  it("ignores a suspended System membership for the CMS cut", () => {
    // Suspended system membership does not make it a live CMS account; falls through to delegation.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content"), membership("rlm_system", "system", "suspended")],
      delegations: [delegation("rlm_b", "rlm_a", RESET, "any")],
    })).toEqual({ kind: "allow" });
  });

  // --- any semantics ---
  it("any: allows when at least one target realm is delegated", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content"), membership("rlm_c", "content")],
      delegations: [delegation("rlm_b", "rlm_a", RESET, "any")],
    })).toEqual({ kind: "allow" });
  });

  // --- all semantics ---
  it("all: denies when only some target realms are delegated", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content"), membership("rlm_c", "content")],
      delegations: [delegation("rlm_b", "rlm_a", RESET, "all")],
    })).toEqual({ kind: "deny", reason: "SCOPE_NOT_SATISFIED" });
  });

  it("all: allows when every target realm is delegated", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content"), membership("rlm_c", "content")],
      delegations: [
        delegation("rlm_b", "rlm_a", RESET, "all"),
        delegation("rlm_b", "rlm_c", RESET, "all"),
      ],
    })).toEqual({ kind: "allow" });
  });

  // --- own-realm is always covered (no delegation needed) ---
  it("allows managing a user of the actor's own realm without any delegation", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_b", "content")],
      delegations: [],
    })).toEqual({ kind: "allow" });
  });

  it("all: covers own realm automatically but still requires delegation for the other realm", () => {
    // Target in own realm + another realm, with an "all"-scoped delegation only for the other realm.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_a", "content")],
      delegations: [delegation("rlm_b", "rlm_a", RESET, "all")],
    })).toEqual({ kind: "allow" });
    // Without the rlm_a delegation, the cross-realm part fails (all).
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_a", "content")],
      delegations: [],
    })).toEqual({ kind: "deny", reason: "NO_DELEGATION" });
  });

  it("still blocks a CMS account that also belongs to the actor's own realm", () => {
    // Own-realm coverage must never override the CMS-account cut.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_system", "system")],
      delegations: [],
    })).toEqual({ kind: "deny", reason: "CMS_ACCOUNT_NOT_ELIGIBLE" });
  });

  // --- membership actions are judged per-realm, not across the whole account ---
  it("membership: always allows suspending the OWN realm's membership of a multi-realm account", () => {
    // Account belongs to A and B; B admin suspends the B membership → own realm, no delegation needed.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: "membership.suspend",
      membershipRealmId: "rlm_b",
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_a", "content")],
      delegations: [],
    })).toEqual({ kind: "allow" });
  });

  it("membership: suspending ANOTHER realm's membership needs a delegation for that realm", () => {
    // B admin tries to suspend the A membership of the same account → needs B→A delegation.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: "membership.suspend",
      membershipRealmId: "rlm_a",
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_a", "content")],
      delegations: [],
    })).toEqual({ kind: "deny", reason: "NO_DELEGATION" });
    // With the B→A delegation (for the membership action), it is allowed.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: "membership.suspend",
      membershipRealmId: "rlm_a",
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_a", "content")],
      delegations: [delegation("rlm_b", "rlm_a", "membership.suspend", "all")],
    })).toEqual({ kind: "allow" });
  });

  it("membership: still blocks a CMS account regardless of the membership realm", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: "membership.suspend",
      membershipRealmId: "rlm_b",
      targetMemberships: [membership("rlm_b", "content"), membership("rlm_system", "system")],
      delegations: [],
    })).toEqual({ kind: "deny", reason: "CMS_ACCOUNT_NOT_ELIGIBLE" });
  });

  it("denies when the target has no active content membership (empty T)", () => {
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content", "suspended")],
      delegations: [delegation("rlm_b", "rlm_a", RESET, "any")],
    })).toEqual({ kind: "deny", reason: "SCOPE_NOT_SATISFIED" });
  });

  it("prefers the more permissive rule when action scopes disagree across rows", () => {
    // rlm_a delegated as "all", rlm_c as "any" → action becomes "any" → single match suffices.
    expect(evaluateCrossRealmManagement({
      actorRealmId: "rlm_b",
      action: RESET,
      targetMemberships: [membership("rlm_a", "content"), membership("rlm_x", "content")],
      delegations: [
        delegation("rlm_b", "rlm_a", RESET, "all"),
        delegation("rlm_b", "rlm_c", RESET, "any"),
      ],
    })).toEqual({ kind: "allow" });
  });
});
