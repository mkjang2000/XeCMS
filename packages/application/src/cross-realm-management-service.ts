/**
 * Orchestrates the authorization for cross-realm user administration (entry
 * point B): a Content Realm B operator administering a Content Realm A user.
 *
 * Two AND-combined checks, plus a hard CMS-account exclusion inside the gate:
 *   (a) the actor holds the action permission inside their OWN realm's policy;
 *   (b) the CMS has delegated (actorRealm → the target's realm(s), action) with
 *       the any/all rule satisfied.
 *
 * This service authorizes only. The route performs the actual mutation with the
 * existing identity-administration service once `authorize` resolves.
 */

import { ApplicationError, type ActorContext } from "./errors.js";
import { realmAuthorizationRootResourceId } from "./realm-authorization-provisioning.js";
import {
  evaluateCrossRealmManagement,
  type CrossRealmTargetMembership,
} from "./cross-realm-management-gate.js";
import type {
  ManagementAction,
  RealmManagementDelegationStore,
} from "./realm-management-delegations.js";

/** Actions that entry point B may perform. Identity-level only in the first cut. */
export type CrossRealmIdentityAction =
  | "identity.credentials.reset"
  | "identity.disable"
  | "identity.update"
  | "identity.session.revoke";

export const CROSS_REALM_IDENTITY_ACTIONS: readonly CrossRealmIdentityAction[] = [
  "identity.credentials.reset",
  "identity.disable",
  "identity.update",
  "identity.session.revoke",
];

export interface CrossRealmManagementAuthorizeInput {
  readonly action: CrossRealmIdentityAction;
  /** The target account's memberships, from the identity-administration store. */
  readonly targetMemberships: readonly CrossRealmTargetMembership[];
}

export class CrossRealmManagementService {
  public constructor(private readonly delegations: RealmManagementDelegationStore) {}

  /**
   * Authorizes an entry-point-B management request. Throws `ApplicationError`
   * (403/500) on denial; resolves when permitted.
   */
  public async authorize(
    actor: ActorContext,
    input: CrossRealmManagementAuthorizeInput,
  ): Promise<void> {
    if (actor.realmId === undefined) {
      throw new ApplicationError(
        "CROSS_REALM_ACTOR_INVALID",
        403,
        "A Content Realm session is required for cross-realm administration.",
      );
    }
    if (actor.authorization === undefined) {
      throw new ApplicationError(
        "CROSS_REALM_ACTOR_INVALID",
        500,
        "The actor is missing its authorization gateway.",
      );
    }

    // [a] The actor must hold this action inside their OWN realm's policy. Uses
    // the realm's root resource — cross-realm user administration is a realm-wide
    // capability, not tied to a content resource.
    await actor.authorization.require({
      action: input.action,
      resourceId: realmAuthorizationRootResourceId(actor.realmId),
    });

    // [b] + CMS-account cut: judge the CMS delegation for this acting realm.
    const delegations = await this.delegations.listByManagingRealm(actor.realmId);
    const verdict = evaluateCrossRealmManagement({
      actorRealmId: actor.realmId,
      action: input.action,
      targetMemberships: input.targetMemberships,
      delegations,
    });
    if (verdict.kind === "allow") return;

    const status = 403;
    const message = verdict.reason === "CMS_ACCOUNT_NOT_ELIGIBLE"
      ? "System accounts cannot be administered across realms."
      : "This realm is not delegated to administer that user.";
    throw new ApplicationError(`CROSS_REALM_${verdict.reason}`, status, message);
  }
}
