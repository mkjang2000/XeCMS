/**
 * CMS-level delegation that lets one Content Realm ("managing") administer the
 * members of another Content Realm ("managed"). It is an additive grant: without
 * a delegation row, the managing realm can do nothing to the managed realm's
 * users (fail-closed). The final decision is `managing-realm policy AND this
 * delegation`, plus a hard exclusion for CMS (System) accounts.
 *
 * Sibling to `realm-collection-entitlements.ts` — same CMS-declaration shape, but
 * the axis is (managingRealm × managedRealm) and the action domain is user
 * administration, not content access.
 */

/**
 * User-administration actions a delegation can grant. These map 1:1 to the
 * existing identity/membership management operations.
 */
export type ManagementAction =
  | "identity.credentials.reset"
  | "identity.disable"
  | "identity.update"
  | "identity.session.revoke"
  | "membership.suspend"
  | "membership.reactivate"
  | "membership.provision";

export const MANAGEMENT_ACTIONS: readonly ManagementAction[] = [
  "identity.credentials.reset",
  "identity.disable",
  "identity.update",
  "identity.session.revoke",
  "membership.suspend",
  "membership.reactivate",
  "membership.provision",
];

/**
 * How a delegated action is judged when the target account belongs to several
 * realms. `any`: allowed if at least one of the target's realms is delegated.
 * `all`: allowed only if every realm the target belongs to is delegated.
 */
export type DelegationScopeRule = "any" | "all";

export interface RealmManagementDelegation {
  readonly workspaceId: string;
  /** The realm whose administrators may act. `rlm_system` for System-operator delegation (entry point A). */
  readonly managingRealmId: string;
  /** The realm whose members may be administered. */
  readonly managedRealmId: string;
  /** Actions this delegation permits. Empty = nothing (row still meaningful for its presence? no — see put validation). */
  readonly actions: readonly ManagementAction[];
  /** Per-action any/all rule. Only meaningful for actions in `actions`. */
  readonly scopeByAction: Readonly<Partial<Record<ManagementAction, DelegationScopeRule>>>;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface PutRealmManagementDelegationInput {
  readonly workspaceId: string;
  readonly managingRealmId: string;
  readonly managedRealmId: string;
  readonly actions: readonly ManagementAction[];
  readonly scopeByAction: Readonly<Partial<Record<ManagementAction, DelegationScopeRule>>>;
  readonly expectedRevision: number | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface RemoveRealmManagementDelegationInput {
  readonly managingRealmId: string;
  readonly managedRealmId: string;
  readonly expectedRevision: number;
}

/**
 * Storage port for management delegations. Read on the administration path (not
 * the hot content-judgement path), so no version cache is needed. Injected as a
 * required dependency — a missing store is a wiring error, never a reason to
 * skip the gate.
 */
export interface RealmManagementDelegationStore {
  listByManagingRealm(managingRealmId: string): Promise<readonly RealmManagementDelegation[]>;
  listByManagedRealm(managedRealmId: string): Promise<readonly RealmManagementDelegation[]>;
  getDelegation(
    managingRealmId: string,
    managedRealmId: string,
  ): Promise<RealmManagementDelegation | null>;
  put(input: PutRealmManagementDelegationInput): Promise<RealmManagementDelegation>;
  remove(input: RemoveRealmManagementDelegationInput): Promise<void>;
}

/**
 * In-memory delegation store. Used by tests and any non-Postgres wiring. Not
 * persistent; not for production.
 */
export class InMemoryRealmManagementDelegationStore implements RealmManagementDelegationStore {
  readonly #rows = new Map<string, RealmManagementDelegation>();

  #key(managingRealmId: string, managedRealmId: string): string {
    return `${managingRealmId} ${managedRealmId}`;
  }

  /** Test helper: insert a delegation directly. */
  seed(delegation: RealmManagementDelegation): void {
    this.#rows.set(this.#key(delegation.managingRealmId, delegation.managedRealmId), delegation);
  }

  async listByManagingRealm(managingRealmId: string): Promise<readonly RealmManagementDelegation[]> {
    return [...this.#rows.values()].filter((d) => d.managingRealmId === managingRealmId);
  }

  async listByManagedRealm(managedRealmId: string): Promise<readonly RealmManagementDelegation[]> {
    return [...this.#rows.values()].filter((d) => d.managedRealmId === managedRealmId);
  }

  async getDelegation(
    managingRealmId: string,
    managedRealmId: string,
  ): Promise<RealmManagementDelegation | null> {
    return this.#rows.get(this.#key(managingRealmId, managedRealmId)) ?? null;
  }

  async put(input: PutRealmManagementDelegationInput): Promise<RealmManagementDelegation> {
    const delegation: RealmManagementDelegation = {
      workspaceId: input.workspaceId,
      managingRealmId: input.managingRealmId,
      managedRealmId: input.managedRealmId,
      actions: [...input.actions],
      scopeByAction: { ...input.scopeByAction },
      revision: (input.expectedRevision ?? 0) + 1,
      updatedAt: input.updatedAt,
      updatedBy: input.updatedBy,
    };
    this.#rows.set(this.#key(input.managingRealmId, input.managedRealmId), delegation);
    return delegation;
  }

  async remove(input: RemoveRealmManagementDelegationInput): Promise<void> {
    this.#rows.delete(this.#key(input.managingRealmId, input.managedRealmId));
  }
}
