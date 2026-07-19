/**
 * Pure decision logic for cross-realm user administration. Given the acting
 * realm, the requested action, the target account's memberships, and the CMS
 * delegations in force, decide whether the action is permitted.
 *
 * This function assumes the actor has ALREADY been checked for the action
 * permission inside their own realm's policy (step a, done by the caller). It
 * only judges the CMS delegation (step b) plus the CMS-account exclusion.
 *
 * Fail-closed: the order of checks is the security boundary. The CMS-account cut
 * runs first and can never be overridden by any delegation.
 */

import type {
  DelegationScopeRule,
  ManagementAction,
  RealmManagementDelegation,
} from "./realm-management-delegations.js";

/** Minimal membership shape needed for the decision (subset of ManagedIdentityMembership). */
export interface CrossRealmTargetMembership {
  readonly realmId: string;
  readonly realmKind: "system" | "content";
  readonly status: "pending" | "active" | "suspended";
}

export type CrossRealmManagementVerdict =
  | { readonly kind: "allow" }
  | {
      readonly kind: "deny";
      readonly reason:
        | "CMS_ACCOUNT_NOT_ELIGIBLE"
        | "NO_DELEGATION"
        | "SCOPE_NOT_SATISFIED";
    };

/**
 * Membership-level actions affect one specific realm membership, so they are
 * judged against that single realm only — not the account's whole realm set.
 * Identity-level actions affect the whole account, so they are judged against
 * every realm the account belongs to.
 */
const MEMBERSHIP_ACTIONS: ReadonlySet<ManagementAction> = new Set([
  "membership.suspend",
  "membership.reactivate",
  "membership.provision",
]);

export interface CrossRealmManagementInput {
  /** The realm the actor is acting from (managing realm). `rlm_system` for System operators. */
  readonly actorRealmId: string;
  readonly action: ManagementAction;
  readonly targetMemberships: readonly CrossRealmTargetMembership[];
  /**
   * For a membership-level action, the single realm whose membership is being
   * changed. Required for membership actions; ignored for identity actions.
   */
  readonly membershipRealmId?: string;
  /** All delegations where managingRealmId === actorRealmId (the caller pre-filters or passes the realm's set). */
  readonly delegations: readonly RealmManagementDelegation[];
}

/**
 * Decide a cross-realm management request. Never throws — a missing store or
 * absent delegation surfaces as a deny, and the caller maps that to 403.
 */
export function evaluateCrossRealmManagement(
  input: CrossRealmManagementInput,
): CrossRealmManagementVerdict {
  // [1] CMS-account cut (highest priority, non-overridable). A target that holds
  // any active System membership is a CMS account and can only be administered
  // through the existing CMS-Owner path — never via cross-realm delegation.
  const isCmsAccount = input.targetMemberships.some(
    (m) => m.realmKind === "system" && m.status === "active",
  );
  if (isCmsAccount) return { kind: "deny", reason: "CMS_ACCOUNT_NOT_ELIGIBLE" };

  // [b] Delegation judgement.
  // T = the realms this action is judged against.
  // - identity action: every active content realm the account belongs to.
  // - membership action: only the single realm whose membership is changing.
  const isMembershipAction = MEMBERSHIP_ACTIONS.has(input.action);
  const activeContentRealmIds = input.targetMemberships
    .filter((m) => m.realmKind === "content" && m.status === "active")
    .map((m) => m.realmId);
  const targetRealmIds = isMembershipAction
    ? new Set(input.membershipRealmId === undefined ? [] : [input.membershipRealmId])
    : new Set(activeContentRealmIds);
  // A realm always governs its OWN members: managing a user of your own realm is
  // never a cross-realm act, so the acting realm counts as covered without a
  // delegation. (Self-delegation rows are forbidden, so this must live here.)
  // The actor's own-realm permission is still enforced separately (step a).
  const coveredRealmIds = new Set<string>([input.actorRealmId]);
  // The action's scope rule is a property of the action, not of an individual
  // (managing, managed) pair. If rows disagree, prefer the more permissive "any"
  // (the CMS-Owner CRUD normalises to keep them consistent per acting realm).
  let rule: DelegationScopeRule = "all";
  let hasDelegation = false;
  for (const delegation of input.delegations) {
    if (delegation.managingRealmId !== input.actorRealmId) continue;
    if (!delegation.actions.includes(input.action)) continue;
    coveredRealmIds.add(delegation.managedRealmId);
    hasDelegation = true;
    if ((delegation.scopeByAction[input.action] ?? "all") === "any") rule = "any";
  }

  if (targetRealmIds.size === 0) {
    // No content realm to govern: both any and all fail closed.
    return { kind: "deny", reason: "SCOPE_NOT_SATISFIED" };
  }
  // If the target is entirely within the actor's own realm, no delegation is
  // needed. Otherwise a delegation must exist to reach beyond the own realm.
  const reachesBeyondOwnRealm = [...targetRealmIds].some((id) => id !== input.actorRealmId);
  if (reachesBeyondOwnRealm && !hasDelegation) {
    return { kind: "deny", reason: "NO_DELEGATION" };
  }

  // any: at least one of the target's realms is covered (own realm or delegated).
  // all: every realm the target belongs to is covered.
  const permitted = rule === "any"
    ? [...targetRealmIds].some((realmId) => coveredRealmIds.has(realmId))
    : [...targetRealmIds].every((realmId) => coveredRealmIds.has(realmId));

  return permitted ? { kind: "allow" } : { kind: "deny", reason: "SCOPE_NOT_SATISFIED" };
}
