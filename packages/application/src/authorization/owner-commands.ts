import { ApplicationError } from "../errors.js";
import {
  AUTHORIZATION_MANAGE_PERMISSION,
  SYSTEM_AUTHORIZATION_REALM_ID,
  authorizationOwnerLevelId,
  authorizationOwnerRoleId,
  authorizationPrimaryOwnerBindingId,
  authorizationSystemPolicyRootLevelId,
  authorizationSystemPolicyRootRoleId,
} from "./identifiers.js";
import { createInitialAuthorizationPolicy } from "./initial-policy.js";
import type { AuthorizationPolicyContext } from "./policy-context.js";
import type {
  AuthorizationBindingRecord,
  AuthorizationPolicyState,
  RealmPrimaryOwnerStatus,
  AuthorizationAuditDraft,
  AuthorizationPolicyMutation,
  AuthorizationActor,
  RealmOwnerCommandActor,
  InitialAuthorizationPolicyInput,
} from "./types.js";
import { validateIdentifier } from "./validation.js";

function primaryRealmOwnerStatus(state: AuthorizationPolicyState): RealmPrimaryOwnerStatus {
  const bindingId = authorizationPrimaryOwnerBindingId(state.realm.id);
  const ownerLevelId = authorizationOwnerLevelId(state.realm.id);
  const ownerRoleId = authorizationOwnerRoleId(state.realm.id);
  const rootLevelId = authorizationSystemPolicyRootLevelId(state.realm.id);
  const rootRoleId = authorizationSystemPolicyRootRoleId(state.realm.id);
  const issues: string[] = [];
  const ownerLevel = state.authorityLevels.find(({ id }) => id === ownerLevelId);
  const ownerRole = state.roles.find(({ id }) => id === ownerRoleId);
  const rootLevel = state.authorityLevels.find(({ id }) => id === rootLevelId);
  const rootRole = state.roles.find(({ id }) => id === rootRoleId);
  const rootBindings = state.bindings.filter(({ roleId }) => roleId === rootRoleId);
  if (ownerLevel?.protected !== true || ownerLevel.rank !== 100) issues.push("owner-level-invalid");
  if (
    ownerRole?.protected !== true
    || ownerRole.levelId !== ownerLevelId
    || !ownerRole.permissions.includes(AUTHORIZATION_MANAGE_PERMISSION)
  ) issues.push("owner-role-invalid");
  if (rootLevel?.protected !== true || rootLevel.rank <= (ownerLevel?.rank ?? 100)) {
    issues.push("system-policy-root-level-invalid");
  }
  if (
    rootRole?.protected !== true
    || rootRole.levelId !== rootLevelId
    || !rootRole.permissions.includes(AUTHORIZATION_MANAGE_PERMISSION)
  ) issues.push("system-policy-root-role-invalid");
  if (rootBindings.length !== 1 || rootBindings[0]?.protected !== true) {
    issues.push("system-policy-root-binding-invalid");
  }
  const ownerBindings = state.bindings.filter(({ roleId }) => roleId === ownerRoleId);
  if (ownerBindings.length === 0) {
    return {
      state: issues.length === 0 ? "unassigned" : "invalid",
      realmId: state.realm.id,
      policyRevision: state.revision,
      bindingId,
      issues,
    };
  }
  if (ownerBindings.length !== 1) issues.push("multiple-primary-owner-bindings");
  const binding = ownerBindings.find(({ id }) => id === bindingId) ?? ownerBindings[0]!;
  if (
    binding.id !== bindingId
    || binding.resourceId !== state.realm.rootResourceId
    || binding.propagation !== "self-and-children"
    || binding.protected !== true
    || binding.validFrom !== undefined
    || binding.validUntil !== undefined
    || binding.constraints !== undefined
  ) issues.push("primary-owner-binding-invalid");
  const subject = state.subjects.find(({ id }) => id === binding.subjectId);
  if (
    subject === undefined
    || subject.type !== "user"
    || subject.identityId === undefined
    || subject.protected === true
    || subject.disabled === true
  ) issues.push("primary-owner-subject-invalid");
  return {
    state: issues.length === 0 ? "assigned" : "invalid",
    realmId: state.realm.id,
    policyRevision: state.revision,
    bindingId,
    subjectId: binding.subjectId,
    ...(subject?.identityId === undefined ? {} : { identityId: subject.identityId }),
    issues,
  };
}

const RECOVERABLE_PRIMARY_OWNER_ISSUES = new Set([
  "multiple-primary-owner-bindings",
  "primary-owner-binding-invalid",
  "primary-owner-subject-invalid",
]);

function ownerCommandAuditActor(
  actor: RealmOwnerCommandActor,
): Pick<AuthorizationAuditDraft, "actorSubjectId" | "actorIdentityId" | "accessMode"> {
  return actor.accessMode === "realm-actor"
    ? {
        actorSubjectId: actor.subjectId,
        actorIdentityId: actor.systemIdentityId,
        accessMode: actor.accessMode,
      }
    : {
        ...(actor.systemSubjectId === undefined ? {} : { actorSubjectId: actor.systemSubjectId }),
        actorIdentityId: actor.systemIdentityId,
        accessMode: actor.accessMode,
      };
}

type AuthorizationOwnerCommandsDependencies = Pick<AuthorizationPolicyContext,
  "audit" | "cachePersistedState" | "load" | "requireOwnerManagement" | "runtime" | "store"
>;

export class AuthorizationOwnerCommands {
  public constructor(
    private readonly context: AuthorizationOwnerCommandsDependencies,
  ) {}

  public async initialize(
    input: InitialAuthorizationPolicyInput,
  ): Promise<AuthorizationPolicyState> {
    if (await this.context.store.getPolicyRevision(input.realmId) !== null) {
      throw new ApplicationError(
        "AUTHORIZATION_ALREADY_INITIALIZED",
        409,
        `Authorization policy for realm '${input.realmId}' is already initialized.`,
      );
    }
    const state = createInitialAuthorizationPolicy(input);
    const persisted = await this.context.store.initialize({
      realmId: input.realmId,
      expectedRevision: null,
      state,
      audit: this.context.audit(
        input.ownerSubjectId,
        "policy.initialize",
        "policy",
        input.realmId,
        null,
        {
          realmId: input.realmId,
          rootResourceId: input.rootResourceId,
          ownerSubjectId: input.ownerSubjectId,
        },
        null,
      ),
    });
    this.context.cachePersistedState(input.realmId, persisted, null);
    return persisted;
  }

  /** Internal CAS key for system-maintained projections; does not expose policy data. */
  public async currentPolicyRevision(realmId: string): Promise<number> {
    return (await this.context.load(realmId)).state.revision;
  }

  /**
   * Trusted provisioning read. It is intentionally not wired to HTTP routes;
   * Realm bootstrap needs to distinguish an uninitialized revision-0 policy
   * from an initialized policy before a protected Subject exists.
   */
  public async loadTrustedProvisioningPolicy(
    realmId: string,
  ): Promise<AuthorizationPolicyState | null> {
    validateIdentifier(realmId, "realmId");
    if (await this.context.store.getPolicyRevision(realmId) === null) return null;
    return (await this.context.load(realmId)).state;
  }

  /** Trusted control-plane read; caller must authenticate the CMS Owner boundary. */
  public async getTrustedPrimaryRealmOwner(realmId: string): Promise<RealmPrimaryOwnerStatus> {
    return primaryRealmOwnerStatus((await this.context.load(realmId)).state);
  }

  /**
   * Assigns, transfers, or repairs the single human Primary Owner Binding.
   * This is deliberately outside ordinary Role Binding authorization: the Owner
   * Role is protected and non-assignable there. The deterministic Binding is
   * created or retargeted by one policy CAS mutation, so transfer never exposes
   * an intermediate ownerless revision. Membership/Identity eligibility beyond
   * the policy projection must be checked transactionally by the caller/store.
   */
  public async setTrustedPrimaryRealmOwner(
    actor: RealmOwnerCommandActor,
    input: {
      readonly expectedRevision: number;
      readonly subjectId: string;
      readonly operation: "assign" | "transfer" | "recover";
    },
  ): Promise<RealmPrimaryOwnerStatus> {
    validateIdentifier(actor.realmId, "realmId");
    validateIdentifier(input.subjectId, "owner.subjectId");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new ApplicationError("POLICY_REVISION_INVALID", 400, "expectedRevision must be a positive integer.");
    }
    if (actor.realmId === SYSTEM_AUTHORIZATION_REALM_ID) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_CONTENT_REALM_REQUIRED",
        409,
        "The trusted Primary Realm Owner command is only available for Content Realms.",
      );
    }
    const entry = await this.context.load(actor.realmId);
    if (entry.state.revision !== input.expectedRevision) {
      throw new ApplicationError(
        "POLICY_REVISION_CONFLICT",
        409,
        `Expected policy revision '${input.expectedRevision}', but current revision is '${entry.state.revision}'.`,
        { details: { expectedRevision: input.expectedRevision, actualRevision: entry.state.revision } },
      );
    }
    const current = primaryRealmOwnerStatus(entry.state);
    if (
      current.state === "invalid"
      && (
        input.operation !== "recover"
        || current.issues.some((issue) => !RECOVERABLE_PRIMARY_OWNER_ISSUES.has(issue))
      )
    ) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_POLICY_INVALID",
        409,
        "The protected Realm policy is malformed beyond the Primary Owner recovery boundary.",
        { details: { issues: current.issues } },
      );
    }
    if (input.operation === "assign" && current.state !== "unassigned") {
      throw new ApplicationError("REALM_PRIMARY_OWNER_EXISTS", 409, "The Realm already has a Primary Owner.");
    }
    if (input.operation === "transfer" && current.state !== "assigned") {
      throw new ApplicationError("REALM_PRIMARY_OWNER_MISSING", 409, "The Realm has no Primary Owner to transfer.");
    }
    if (
      actor.accessMode === "realm-actor"
      && (current.state !== "assigned" || current.subjectId !== actor.subjectId)
    ) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_REQUIRED",
        403,
        "Only the current Primary Realm Owner can perform a normal transfer.",
      );
    }
    const subject = entry.state.subjects.find(({ id }) => id === input.subjectId);
    if (
      subject === undefined
      || subject.realmId !== actor.realmId
      || subject.type !== "user"
      || subject.identityId === undefined
      || subject.protected === true
      || subject.disabled === true
    ) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_SUBJECT_INELIGIBLE",
        409,
        "A Primary Realm Owner must be an active identity-linked human Subject.",
      );
    }
    if (
      actor.accessMode === "cms-owner-control-plane"
      && subject.identityId === actor.systemIdentityId
    ) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_SELF_ASSIGNMENT_FORBIDDEN",
        403,
        "The CMS Owner cannot assign their own System Identity as a Realm Owner.",
      );
    }
    if (current.state === "assigned" && current.subjectId === subject.id) return current;

    const binding: AuthorizationBindingRecord = {
      id: authorizationPrimaryOwnerBindingId(actor.realmId),
      realmId: actor.realmId,
      subjectId: subject.id,
      roleId: authorizationOwnerRoleId(actor.realmId),
      resourceId: entry.state.realm.rootResourceId,
      propagation: "self-and-children",
      protected: true,
    };
    const previousOwnerBindings = entry.state.bindings.filter(
      ({ roleId }) => roleId === authorizationOwnerRoleId(actor.realmId),
    );
    const before = previousOwnerBindings.length === 0
      ? null
      : previousOwnerBindings.length === 1
        ? previousOwnerBindings[0]!
        : previousOwnerBindings;
    const mutation: AuthorizationPolicyMutation = {
      type: "binding.replace-primary-owner",
      value: binding,
    };
    const auditActor = ownerCommandAuditActor(actor);
    const persisted = await this.context.store.mutatePolicy({
      realmId: actor.realmId,
      expectedRevision: entry.state.revision,
      mutation,
      audit: {
        id: this.context.runtime.newAuditId(),
        ...auditActor,
        action: `realm-owner.${input.operation}`,
        targetType: "binding",
        targetId: binding.id,
        before,
        after: binding,
        decision: null,
        occurredAt: this.context.runtime.now(),
      },
    });
    this.context.cachePersistedState(actor.realmId, persisted, entry.state.revision);
    return primaryRealmOwnerStatus(persisted);
  }

  /**
   * Parent-changing hierarchy moves can change Binding/FieldAccess applicability.
   * M3 deliberately uses the protected Owner guard until a rank/delegation-aware
   * move-management command is introduced.
   */
  public async requireHierarchyPolicyManagement(actor: AuthorizationActor): Promise<void> {
    const entry = await this.context.load(actor.realmId);
    this.context.requireOwnerManagement(actor, entry);
  }
}
