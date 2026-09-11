import type { PolicySnapshot } from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import type { RealmCollectionEntitlement, RealmCollectionEntitlementStore } from "../realm-collection-entitlements.js";
import { applyActionGate, gateActionFor, resolveEntitlementCollectionId } from "../entitlement-gate.js";
import { SYSTEM_AUTHORIZATION_REALM_ID } from "./identifiers.js";
import type {
  AuthorizationActor,
  AuthorizationEvaluationContext,
  AuthorizationDecisionRecord,
  PolicyCacheEntry,
} from "./types.js";

export class AuthorizationEntitlementCeiling {
  /** Entitlement revisions invalidate this cache independently of policy revisions. */
  readonly #entitlementCache = new Map<
    string,
    {
      readonly version: number;
      readonly byCollectionId: Map<string, RealmCollectionEntitlement>;
      readonly guaranteedCollectionId?: string;
    } | null
  >();

  public constructor(private readonly entitlementStore: RealmCollectionEntitlementStore) {}

  /**
   * Loads the entitlement ceiling for a realm, or `null` when the gate does not
   * apply (system realm, or enforcement disabled). Fails closed: an `enforced`
   * realm missing its enforcement/entitlement data throws rather than skipping.
   * Cache is keyed by the realm's entitlement version (lightweight integer),
   * independent of the policy cache.
   */
  private async loadEntitlements(
    realmId: string,
  ): Promise<{
    readonly byCollectionId: Map<string, RealmCollectionEntitlement>;
    readonly guaranteedCollectionId?: string;
  } | null> {
    // The ceiling only applies to Content Realms.
    if (realmId === SYSTEM_AUTHORIZATION_REALM_ID) return null;
    const enforcement = await this.entitlementStore.getEnforcement(realmId);
    // No enforcement row = feature not activated for this realm yet → skip.
    if (enforcement === null || enforcement.state === "disabled") {
      this.#entitlementCache.set(realmId, null);
      return null;
    }
    // enforcement.state === "enforced": the ceiling is authoritative from here on.
    const cached = this.#entitlementCache.get(realmId);
    if (cached !== undefined && cached !== null && cached.version === enforcement.version) {
      return cached;
    }
    const entitlements = await this.entitlementStore.listByRealm(realmId);
    const byCollectionId = new Map(entitlements.map((e) => [e.collectionId, e]));
    const entry = {
      version: enforcement.version,
      byCollectionId,
      ...(enforcement.guaranteedCollectionId === undefined
        ? {}
        : { guaranteedCollectionId: enforcement.guaranteedCollectionId }),
    };
    this.#entitlementCache.set(realmId, entry);
    return entry;
  }

  /**
   * Resolves the entitlement governing a content resource for an enforced realm.
   * Returns `"skip"` (gate not applicable) or the entitlement (possibly undefined
   * = ceiling absent = deny). Throws fail-closed when a content resource cannot be
   * mapped to a collection.
   */
  private resolveEntitlementForResource(
    ceiling: {
      readonly byCollectionId: Map<string, RealmCollectionEntitlement>;
      readonly guaranteedCollectionId?: string;
    },
    snapshot: PolicySnapshot,
    realmId: string,
    resourceId: string,
  ): { readonly kind: "skip" } | { readonly kind: "gate"; readonly entitlement: RealmCollectionEntitlement | undefined } {
    const resolution = resolveEntitlementCollectionId(snapshot, realmId, resourceId);
    if (resolution.kind === "skip") return { kind: "skip" };
    if (resolution.kind === "unresolved-content") {
      // A content resource we cannot tie to a collection: fail closed.
      throw new ApplicationError(
        "ENTITLEMENT_RESOURCE_UNRESOLVED",
        403,
        "The content resource could not be mapped to a collection for entitlement enforcement.",
      );
    }
    // A realm can never be cut off from its own Auth (profile) collection —
    // the ceiling does not apply there. Skip the gate so realm policy governs.
    if (resolution.collectionId === ceiling.guaranteedCollectionId) return { kind: "skip" };
    return { kind: "gate", entitlement: ceiling.byCollectionId.get(resolution.collectionId) };
  }

  /**
   * Narrows a permission decision by the collection-entitlement ceiling. Only an
   * allowed decision is narrowed; a denied one is returned unchanged.
   */
  public async gateDecision(
    actor: AuthorizationActor,
    entry: PolicyCacheEntry,
    input: { readonly action: string; readonly resourceId: string; readonly context?: AuthorizationEvaluationContext },
    decision: AuthorizationDecisionRecord,
  ): Promise<AuthorizationDecisionRecord> {
    if (!decision.allowed) return decision;
    const gateAction = gateActionFor(input.action);
    if (gateAction === undefined) return decision; // non-content action: not gated.
    const ceiling = await this.loadEntitlements(actor.realmId);
    if (ceiling === null) return decision; // system realm or enforcement disabled.
    const resolved = this.resolveEntitlementForResource(ceiling, entry.snapshot, actor.realmId, input.resourceId);
    if (resolved.kind === "skip") return decision;
    const verdict = applyActionGate({
      entitlement: resolved.entitlement,
      gateAction,
      actorSubjectId: actor.subjectId,
      ...(input.context?.ownerSubjectId === undefined ? {} : { ownerSubjectId: input.context.ownerSubjectId }),
      ...(input.context?.status === undefined ? {} : { status: input.context.status }),
    });
    if (verdict.kind === "allow") return decision;
    return { ...decision, allowed: false, reasonCode: "DENY_ENTITLEMENT_GATE", matchedGrants: [] };
  }

  /**
   * Field-path entitlement gate for filterReadableData/assertWritableData.
   * Returns the field-level ceiling for this (resource, action):
   * - `"skip"`: gate not applicable (system realm, disabled, non-content action, non-content resource).
   * - `"deny-action"`: the ceiling forbids the action entirely → caller must deny the enclosing decision.
   * - `{ entitlement }`: apply per-field intersection (entitlement undefined = ceiling absent = deny all).
   * Throws fail-closed for an unresolvable content resource.
   */
  public async fieldEntitlementGate(
    actor: AuthorizationActor,
    entry: PolicyCacheEntry,
    input: { readonly action: string; readonly resourceId: string; readonly context?: AuthorizationEvaluationContext },
  ): Promise<"skip" | "deny-action" | { readonly entitlement: RealmCollectionEntitlement | undefined }> {
    const gateAction = gateActionFor(input.action);
    if (gateAction === undefined) return "skip";
    const ceiling = await this.loadEntitlements(actor.realmId);
    if (ceiling === null) return "skip";
    const resolved = this.resolveEntitlementForResource(ceiling, entry.snapshot, actor.realmId, input.resourceId);
    if (resolved.kind === "skip") return "skip";
    const verdict = applyActionGate({
      entitlement: resolved.entitlement,
      gateAction,
      actorSubjectId: actor.subjectId,
      ...(input.context?.ownerSubjectId === undefined ? {} : { ownerSubjectId: input.context.ownerSubjectId }),
      ...(input.context?.status === undefined ? {} : { status: input.context.status }),
    });
    if (verdict.kind === "deny") return "deny-action";
    return { entitlement: resolved.entitlement };
  }
}
