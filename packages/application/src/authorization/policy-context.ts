import { asPermissionKey, asResourceId, asSubjectId, evaluateAccess, type AccessDecision } from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import {
  realmFullAccessManagementDecision,
  isRealmAdministrationActor,
  isControlPlaneAdministrationActor,
  realmPolicyActor,
  assertContentRealmAdministration,
} from "./actor-guards.js";
import {
  AUTHORIZATION_MANAGE_PERMISSION,
  SYSTEM_AUTHORIZATION_REALM_ID,
  authorizationOwnerLevelId,
  authorizationOwnerRoleId,
  authorizationPrimaryOwnerBindingId,
  authorizationSystemPolicyRootLevelId,
  authorizationSystemPolicyRootRoleId,
  authorizationSystemPolicyRootBindingId,
  projectionQuarantineKey,
} from "./identifiers.js";
import { createKernelSnapshot, plainDecision } from "./policy-kernel.js";
import { applyPolicyMutation } from "./policy-mutation.js";
import type {
  AuthorizationPolicyState,
  AuthorizationAuditTargetType,
  AuthorizationAuditDraft,
  AuthorizationPolicyMutation,
  AuthorizationStore,
  AuthorizationRuntime,
  AuthorizationPolicyManagementActor,
  AuthorizationDecisionRecord,
  PolicyCacheEntry,
} from "./types.js";
import { validateIdentifier, authorizationDenied } from "./validation.js";

export class AuthorizationPolicyContext {
  readonly #cache = new Map<string, PolicyCacheEntry>();
  /** Fast quarantine checks use the same (realmId, resourceId) key as durable storage. */
  public readonly quarantinedResources = new Set<string>();

  public constructor(
    public readonly store: AuthorizationStore,
    public readonly runtime: AuthorizationRuntime,
  ) {}

  public async load(realmId: string): Promise<PolicyCacheEntry> {
    validateIdentifier(realmId, "realmId");
    const revision = await this.store.getPolicyRevision(realmId);
    if (revision === null) {
      throw new ApplicationError(
        "AUTHORIZATION_NOT_INITIALIZED",
        503,
        `Authorization policy for realm '${realmId}' is not initialized.`,
      );
    }
    const cached = this.#cache.get(realmId);
    if (cached?.state.revision === revision) return cached;
    const state = await this.store.loadPolicy(realmId);
    if (state === null) {
      throw new ApplicationError(
        "AUTHORIZATION_POLICY_UNAVAILABLE",
        503,
        `Authorization policy revision '${revision}' could not be loaded.`,
      );
    }
    if (state.realm.id !== realmId) {
      throw new ApplicationError("AUTHORIZATION_REALM_MISMATCH", 500, "The stored policy belongs to another realm.");
    }
    const entry = { state, snapshot: createKernelSnapshot(state) };
    this.#cache.set(realmId, entry);
    return entry;
  }

  public async loadForMutation(
    actor: AuthorizationPolicyManagementActor,
    expectedRevision: number,
  ): Promise<PolicyCacheEntry> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ApplicationError("POLICY_REVISION_INVALID", 400, "expectedRevision must be a positive integer.");
    }
    const entry = await this.load(actor.realmId);
    if (isControlPlaneAdministrationActor(actor)) {
      assertContentRealmAdministration(actor);
      if (actor.accessMode === "cms-owner-readonly") {
        throw new ApplicationError(
          "REALM_ADMINISTRATION_READ_ONLY",
          403,
          "CMS Owner oversight is read-only without active Realm Full Access.",
        );
      }
    } else {
      const actorSubject = entry.state.subjects.find(({ id }) => id === realmPolicyActor(actor).subjectId);
      if (actorSubject === undefined || actorSubject.realmId !== actor.realmId) {
        throw new ApplicationError("AUTHORIZATION_ACTOR_UNKNOWN", 403, "The actor does not belong to this realm.");
      }
    }
    if (entry.state.revision !== expectedRevision) {
      throw new ApplicationError(
        "POLICY_REVISION_CONFLICT",
        409,
        `Expected policy revision '${expectedRevision}', but current revision is '${entry.state.revision}'.`,
        { details: { expectedRevision, actualRevision: entry.state.revision } },
      );
    }
    return entry;
  }

  public requireOwnerManagement(
    actor: AuthorizationPolicyManagementActor,
    entry: PolicyCacheEntry,
  ): AuthorizationDecisionRecord {
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      AUTHORIZATION_MANAGE_PERMISSION,
      entry.state.realm.rootResourceId,
    );
    if (fullAccessDecision !== null) return fullAccessDecision;
    const realmActor = realmPolicyActor(actor);
    const decision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(realmActor.subjectId),
      action: asPermissionKey(AUTHORIZATION_MANAGE_PERMISSION),
      resourceId: asResourceId(entry.state.realm.rootResourceId),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const actorSubject = entry.state.subjects.find(({ id }) => id === realmActor.subjectId);
    const hasProtectedOwnerGrant = decision.matchedGrants.some((grant) => {
      if (actor.realmId === SYSTEM_AUTHORIZATION_REALM_ID) {
        return actorSubject?.protected === true
          && grant.sourceRoleId === authorizationOwnerRoleId(actor.realmId);
      }
      const hasSystemPolicyRoot = entry.state.roles.some(
        ({ id }) => id === authorizationSystemPolicyRootRoleId(actor.realmId),
      );
      const isLegacyProtectedOwner = !hasSystemPolicyRoot
        && actorSubject?.protected === true
        && grant.sourceRoleId === authorizationOwnerRoleId(actor.realmId);
      const isSystemRoot = actorSubject?.protected === true
        && actorSubject.type === "service-account"
        && grant.sourceRoleId === authorizationSystemPolicyRootRoleId(actor.realmId)
        && grant.sourceLevelId === authorizationSystemPolicyRootLevelId(actor.realmId)
        && grant.sourceBindingId === authorizationSystemPolicyRootBindingId(actor.realmId);
      const isHumanPrimaryOwner = actorSubject?.protected !== true
        && actorSubject?.type === "user"
        && actorSubject.identityId !== undefined
        && actorSubject.disabled !== true
        && grant.sourceRoleId === authorizationOwnerRoleId(actor.realmId)
        && grant.sourceLevelId === authorizationOwnerLevelId(actor.realmId)
        && grant.sourceBindingId === authorizationPrimaryOwnerBindingId(actor.realmId);
      return isLegacyProtectedOwner || isSystemRoot || isHumanPrimaryOwner;
    });
    if (!hasProtectedOwnerGrant) {
      throw new ApplicationError(
        "OWNER_AUTHORIZATION_REQUIRED",
        403,
        `The protected '${AUTHORIZATION_MANAGE_PERMISSION}' owner grant is required.`,
      );
    }
    return plainDecision(decision);
  }

  public async commit<TMutation extends AuthorizationPolicyMutation>(
    actor: AuthorizationPolicyManagementActor,
    entry: PolicyCacheEntry,
    mutation: TMutation,
    targetType: AuthorizationAuditTargetType,
    targetId: string,
    before: unknown | null,
    after: unknown | null,
    decision: AuthorizationDecisionRecord | null = null,
  ): Promise<AuthorizationPolicyState> {
    const projected = applyPolicyMutation(entry.state, mutation);
    createKernelSnapshot(projected);
    const persisted = await this.store.mutatePolicy({
      realmId: actor.realmId,
      expectedRevision: entry.state.revision,
      mutation,
      audit: this.policyMutationAudit(actor, mutation.type, targetType, targetId, before, after, decision),
    });
    this.cachePersistedState(actor.realmId, persisted, entry.state.revision);
    return persisted;
  }

  public audit(
    actorSubjectId: string,
    action: string,
    targetType: AuthorizationAuditTargetType,
    targetId: string,
    before: unknown | null,
    after: unknown | null,
    decision: AuthorizationDecisionRecord | null,
  ): AuthorizationAuditDraft {
    return {
      id: this.runtime.newAuditId(),
      actorSubjectId,
      action,
      targetType,
      targetId,
      before,
      after,
      decision,
      occurredAt: this.runtime.now(),
    };
  }

  private policyMutationAudit(
    actor: AuthorizationPolicyManagementActor,
    action: string,
    targetType: AuthorizationAuditTargetType,
    targetId: string,
    before: unknown | null,
    after: unknown | null,
    decision: AuthorizationDecisionRecord | null,
  ): AuthorizationAuditDraft {
    if (isControlPlaneAdministrationActor(actor)) {
      return {
        id: this.runtime.newAuditId(),
        actorIdentityId: actor.systemIdentityId,
        accessMode: actor.accessMode,
        ...(actor.accessMode === "realm-full-access"
          ? { fullAccessBindingId: actor.fullAccessBindingId }
          : {}),
        action,
        targetType,
        targetId,
        before,
        after,
        decision,
        occurredAt: this.runtime.now(),
      };
    }
    const realmActor = realmPolicyActor(actor);
    return {
      ...this.audit(realmActor.subjectId, action, targetType, targetId, before, after, decision),
      ...(isRealmAdministrationActor(actor)
        ? { actorIdentityId: actor.systemIdentityId, accessMode: actor.accessMode }
        : {}),
    };
  }

  public cachePersistedState(
    realmId: string,
    state: AuthorizationPolicyState,
    previousRevision: number | null,
  ): void {
    if (state.realm.id !== realmId) {
      throw new ApplicationError("AUTHORIZATION_REALM_MISMATCH", 500, "The persisted policy belongs to another realm.");
    }
    if (!Number.isSafeInteger(state.revision) || state.revision < 1 ||
      (previousRevision !== null && state.revision <= previousRevision)) {
      this.#cache.delete(realmId);
      throw new ApplicationError(
        "POLICY_REVISION_NOT_ADVANCED",
        500,
        "The authorization store did not advance the policy revision.",
      );
    }
    this.#cache.set(realmId, { state, snapshot: createKernelSnapshot(state) });
  }

  public requireDecision(decision: AccessDecision): void {
    if (!decision.allowed) authorizationDenied(plainDecision(decision));
  }

  public async assertProjectionAvailable(realmId: string, resourceId: string): Promise<void> {
    if (!this.quarantinedResources.has(projectionQuarantineKey(realmId, resourceId)) &&
      !(await this.store.isResourceQuarantined(realmId, resourceId))) return;
    throw new ApplicationError(
      "AUTHORIZATION_PROJECTION_UNAVAILABLE",
      503,
      `Authorization projection for resource '${resourceId}' is being reconciled.`,
    );
  }
}
