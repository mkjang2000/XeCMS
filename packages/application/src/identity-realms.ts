import {
  ApplicationError,
  SYSTEM_ACTOR_REALM_ID,
  actorRealmId,
  type ActorContext,
} from "./errors.js";
import type { PasswordHasher } from "./auth.js";
import type {
  RealmOwnerCommandActor,
  RealmPrimaryOwnerStatus,
} from "./authorization.js";
import { COLLECTION_ACTIONS } from "./realm-collection-entitlements.js";
import { MANAGEMENT_ACTIONS } from "./realm-management-delegations.js";
import type {
  DelegationScopeRule,
  ManagementAction,
  RealmManagementDelegation,
  RealmManagementDelegationStore,
} from "./realm-management-delegations.js";
import type {
  CollectionAction,
  CollectionEntitlementConstraint,
  RealmCollectionEntitlement,
  RealmCollectionEntitlementStore,
  RealmEntitlementStatus,
} from "./realm-collection-entitlements.js";

export type IdentityRealmKind = "system" | "content";
export type IdentityRealmStatus = "provisioning" | "active" | "disabled";
export type RealmProvisioningMode = "explicit" | "jit";
export type RealmRegistrationMode = "closed" | "open";
export type RealmMembershipStatus = "pending" | "active" | "suspended";
export type RealmMembershipProvisionedBy =
  | "explicit"
  | "invitation"
  | "jit"
  | "account-link"
  | "signup";

export interface RealmAuthenticationPolicyRecord {
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: RealmProvisioningMode;
  readonly registration: RealmRegistrationMode;
  readonly defaultRoleIds: readonly string[];
}

export interface IdentityRealmRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly kind: IdentityRealmKind;
  readonly status: IdentityRealmStatus;
  readonly profileCollectionId?: string;
  readonly authentication: RealmAuthenticationPolicyRecord;
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface GlobalIdentityRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: "human" | "service";
  /** True only for the workspace-wide CMS Owner identity. */
  readonly isOwner?: boolean;
  readonly primaryIdentifier: string;
  readonly originRealmId: string;
  readonly credentialVersion: number;
  readonly disabledAt?: string;
}

export interface GlobalIdentityCredentialRecord extends GlobalIdentityRecord {
  readonly passwordHash: string;
}

export interface RealmMembershipRecord {
  readonly id: string;
  readonly identityId: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly profileCollectionId?: string;
  readonly profileDocumentId?: string;
  readonly status: RealmMembershipStatus;
  readonly provisionedBy: RealmMembershipProvisionedBy;
  readonly revision: number;
  readonly createdAt: string;
  readonly activatedAt?: string;
  readonly suspendedAt?: string;
  /** Scoped administration projection; durable stores may omit it. */
  readonly identity?: GlobalIdentityRecord;
}

export interface ContentRealmSessionRecord {
  readonly identity: GlobalIdentityRecord;
  readonly realm: IdentityRealmRecord;
  readonly membership: RealmMembershipRecord;
  readonly expiresAt: string;
  readonly authenticatedAt: string;
}

export interface RealmFullAccessBindingRecord {
  readonly id: string;
  readonly realmId: string;
  /** System control-plane Identity receiving this temporary access. */
  readonly systemIdentityId: string;
  readonly grantedByIdentityId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly validUntil: string;
  readonly revokedAt?: string;
  readonly revokedByIdentityId?: string;
  readonly terminationReason?: "revoked" | "expired";
}

export type RealmAdministrationAccessMode =
  | "realm-actor"
  | "cms-owner-readonly"
  | "cms-owner-control-plane"
  | "realm-full-access";

export type RealmAdministrationAuditEvent =
  | "REALM_POLICY_OVERSIGHT_ENTERED"
  | "REALM_POLICY_OVERSIGHT_READ"
  | "REALM_POLICY_OVERSIGHT_EXITED"
  | "REALM_OWNER_ASSIGNED"
  | "REALM_OWNER_TRANSFERRED"
  | "REALM_OWNER_REPLACED"
  | "REALM_OWNER_RECOVERED"
  | "REALM_FULL_ACCESS_ENTERED"
  | "REALM_FULL_ACCESS_OPERATION"
  | "REALM_COLLECTION_ENTITLEMENT_UPDATED"
  | "REALM_COLLECTION_ENTITLEMENT_REMOVED"
  | "REALM_MANAGEMENT_DELEGATION_UPDATED"
  | "REALM_MANAGEMENT_DELEGATION_REMOVED";

export interface RealmAdministrationAuditRecord {
  readonly event: RealmAdministrationAuditEvent;
  readonly systemIdentityId: string;
  readonly realmId: string;
  readonly accessMode: RealmAdministrationAccessMode;
  readonly occurredAt: string;
  readonly realmSubjectId?: string;
  readonly fullAccessBindingId?: string;
  readonly operation?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly result?: string;
  readonly reason?: string;
  /** Structured, event-specific facts such as requested cleanup and its result. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RealmOwnerStatusRecord {
  readonly realmId: string;
  readonly status: "healthy" | "ownerless" | "invalid";
  readonly policyRevision: number;
  readonly owner?: {
    readonly globalIdentityId: string;
    readonly membershipId: string;
    readonly subjectId: string;
    readonly primaryIdentifier: string;
    readonly identityActive: boolean;
    readonly membershipStatus: RealmMembershipStatus;
  };
  readonly issueCode?: string;
}

/** Adapter to the protected authorization-policy Owner command boundary. */
export interface RealmOwnerCoordinator {
  getPrimaryOwner(realmId: string): Promise<RealmPrimaryOwnerStatus>;
  setPrimaryOwner(
    actor: RealmOwnerCommandActor,
    input: {
      readonly expectedRevision: number;
      readonly subjectId: string;
      readonly operation: "assign" | "transfer" | "recover";
    },
  ): Promise<RealmPrimaryOwnerStatus>;
}

export interface RealmOwnerCommandInput {
  readonly realmId: string;
  readonly targetMembershipId: string;
  readonly expectedPolicyRevision: number;
  readonly reason: string;
  readonly reauthenticatedAt: string;
  readonly requestId?: string;
  readonly sessionId?: string;
}

/**
 * Durable identity/realm boundary. Implementations must validate active
 * Identity, Membership and credential version again when resolving a session;
 * a session row alone is never sufficient authorization evidence.
 */
export interface IdentityRealmStore {
  listRealms(workspaceId: string): Promise<readonly IdentityRealmRecord[]>;
  getRealmById(realmId: string): Promise<IdentityRealmRecord | null>;
  getRealmByKey(workspaceId: string, realmKey: string): Promise<IdentityRealmRecord | null>;
  createRealm(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly key: string;
    readonly name: string;
    readonly authentication: RealmAuthenticationPolicyRecord;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<IdentityRealmRecord>;
  updateRealm(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly name: string;
    readonly status: IdentityRealmStatus;
    readonly authentication: RealmAuthenticationPolicyRecord;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<IdentityRealmRecord>;
  listIdentities(workspaceId: string): Promise<readonly GlobalIdentityRecord[]>;
  findIdentityById(identityId: string): Promise<GlobalIdentityRecord | null>;
  findIdentityCredentialByIdentifier(
    workspaceId: string,
    normalizedIdentifier: string,
  ): Promise<GlobalIdentityCredentialRecord | null>;
  listMemberships(realmId: string): Promise<readonly RealmMembershipRecord[]>;
  findMembershipByIdentity(
    realmId: string,
    identityId: string,
  ): Promise<RealmMembershipRecord | null>;
  findMembershipById(membershipId: string): Promise<RealmMembershipRecord | null>;
  /** Mirrors the durable final eligibility guard used by the Owner CAS. */
  isEligibleRealmOwner(input: {
    readonly realmId: string;
    readonly identityId: string;
    readonly subjectId: string;
  }): Promise<boolean>;
  suspendMembership(input: {
    readonly realmId: string;
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord>;
  reactivateMembership(input: {
    readonly realmId: string;
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord>;
  createContentSession(input: {
    readonly tokenHash: string;
    readonly csrfTokenHash: string;
    readonly identityId: string;
    readonly realmId: string;
    readonly membershipId: string;
    readonly subjectId: string;
    readonly credentialVersion: number;
    readonly authenticatedAt: string;
    readonly expiresAt: string;
  }): Promise<void>;
  findContentSession(
    tokenHash: string,
    realmId: string,
    now: string,
  ): Promise<ContentRealmSessionRecord | null>;
  findContentSessionWithCsrf(
    tokenHash: string,
    csrfTokenHash: string,
    realmId: string,
    now: string,
  ): Promise<boolean>;
  deleteContentSession(tokenHash: string, realmId: string): Promise<void>;
  revokeMembershipSessions(input: {
    readonly realmId: string;
    readonly membershipId: string;
    readonly actorIdentityId: string;
    readonly now: string;
    readonly reason: string;
  }): Promise<number>;
  listFullAccessBindings(
    realmId: string,
    now: string,
  ): Promise<readonly RealmFullAccessBindingRecord[]>;
  grantFullAccess(input: RealmFullAccessBindingRecord): Promise<RealmFullAccessBindingRecord>;
  revokeFullAccess(input: {
    readonly realmId: string;
    readonly bindingId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmFullAccessBindingRecord>;
  findActiveFullAccessBinding(
    realmId: string,
    systemIdentityId: string,
    now: string,
  ): Promise<RealmFullAccessBindingRecord | null>;
  hasActiveFullAccess(realmId: string, systemIdentityId: string, now: string): Promise<boolean>;
  recordRealmAdministrationEvent(input: RealmAdministrationAuditRecord): Promise<void>;
}

export interface RealmIdentityProvisioner {
  register(input: {
    readonly realm: IdentityRealmRecord;
    readonly normalizedIdentifier: string;
    readonly displayIdentifier: string;
    readonly passwordHash: string;
    readonly profile: Readonly<Record<string, unknown>>;
    readonly now: string;
  }): Promise<RealmMembershipRecord>;
  provisionExistingIdentity(input: {
    readonly realm: IdentityRealmRecord;
    readonly identity: GlobalIdentityRecord;
    readonly method: "explicit" | "jit" | "account-link" | "signup";
    readonly profile: Readonly<Record<string, unknown>>;
    readonly now: string;
  }): Promise<RealmMembershipRecord>;
}

/** Transactional primitives used by the durable provisioning coordinator. */
export interface RealmIdentityProvisioningStore {
  createGlobalIdentity(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly originRealmId: string;
    readonly normalizedIdentifier: string;
    readonly displayIdentifier: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<GlobalIdentityRecord>;
  createPendingMembership(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly identityId: string;
    readonly realmId: string;
    readonly subjectId: string;
    readonly provisionedBy: RealmMembershipProvisionedBy;
    readonly createdByIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord>;
  activateMembership(input: {
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly profileCollectionId: string;
    readonly profileDocumentId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord>;
}

export interface RealmAuthorizationSubjectProvisioner {
  ensureIdentitySubject(input: {
    readonly realm: IdentityRealmRecord;
    readonly identity: GlobalIdentityRecord;
    readonly subjectId: string;
    readonly displayName: string;
  }): Promise<void>;
  ensureDefaultRoles(input: {
    readonly realm: IdentityRealmRecord;
    readonly subjectId: string;
  }): Promise<void>;
}

export interface RealmProfileProvisioner {
  createProfile(input: {
    readonly realm: IdentityRealmRecord;
    readonly membership: RealmMembershipRecord;
    readonly identifier: {
      readonly normalized: string;
      readonly display: string;
    };
    readonly profile: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly collectionId: string; readonly documentId: string }>;
}

export interface RealmProvisioningRuntime {
  readonly now: () => string;
  readonly newIdentityId: () => string;
  readonly newMembershipId: () => string;
  /** Must be stable for the same Realm/Identity so a pending saga can resume. */
  readonly newSubjectId: (realmId: string, identityId: string) => string;
}

/**
 * Coordinates a fail-closed provisioning saga. Identity/Subject/Membership are
 * stable and idempotent; a crash can leave only a pending Membership, which
 * cannot authenticate and can be resumed by the same coordinator.
 */
export class DurableRealmIdentityProvisioner implements RealmIdentityProvisioner {
  public constructor(
    private readonly store: RealmIdentityProvisioningStore,
    private readonly subjects: RealmAuthorizationSubjectProvisioner,
    private readonly profiles: RealmProfileProvisioner,
    private readonly runtime: RealmProvisioningRuntime,
  ) {}

  public async register(input: {
    readonly realm: IdentityRealmRecord;
    readonly normalizedIdentifier: string;
    readonly displayIdentifier: string;
    readonly passwordHash: string;
    readonly profile: Readonly<Record<string, unknown>>;
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    const identity = await this.store.createGlobalIdentity({
      id: this.runtime.newIdentityId(),
      workspaceId: input.realm.workspaceId,
      originRealmId: input.realm.id,
      normalizedIdentifier: input.normalizedIdentifier,
      displayIdentifier: input.displayIdentifier,
      passwordHash: input.passwordHash,
      now: input.now,
    });
    return this.provision({
      realm: input.realm,
      identity,
      method: "signup",
      profile: input.profile,
      identifier: {
        normalized: input.normalizedIdentifier,
        display: input.displayIdentifier,
      },
      now: input.now,
    });
  }

  public async provisionExistingIdentity(input: {
    readonly realm: IdentityRealmRecord;
    readonly identity: GlobalIdentityRecord;
    readonly method: "explicit" | "jit" | "account-link" | "signup";
    readonly profile: Readonly<Record<string, unknown>>;
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    return this.provision({
      ...input,
      identifier: {
        normalized: input.identity.primaryIdentifier,
        display: input.identity.primaryIdentifier,
      },
    });
  }

  private async provision(input: {
    readonly realm: IdentityRealmRecord;
    readonly identity: GlobalIdentityRecord;
    readonly method: RealmMembershipProvisionedBy;
    readonly profile: Readonly<Record<string, unknown>>;
    readonly identifier: { readonly normalized: string; readonly display: string };
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    if (input.realm.kind !== "content" || input.realm.status !== "active") {
      throw new ApplicationError("CONTENT_REALM_UNAVAILABLE", 409, "The Content Realm is not active.");
    }
    const subjectId = this.runtime.newSubjectId(input.realm.id, input.identity.id);
    await this.subjects.ensureIdentitySubject({
      realm: input.realm,
      identity: input.identity,
      subjectId,
      displayName: input.identifier.display,
    });
    const pending = await this.store.createPendingMembership({
      id: this.runtime.newMembershipId(),
      workspaceId: input.realm.workspaceId,
      identityId: input.identity.id,
      realmId: input.realm.id,
      subjectId,
      provisionedBy: input.method,
      createdByIdentityId: input.identity.id,
      now: input.now,
    });
    if (pending.status === "active") return pending;
    if (pending.status === "suspended") {
      throw new ApplicationError("REALM_MEMBERSHIP_SUSPENDED", 403, "The Realm Membership is suspended.");
    }
    const profile = await this.profiles.createProfile({
      realm: input.realm,
      membership: pending,
      identifier: input.identifier,
      profile: input.profile,
    });
    const active = await this.store.activateMembership({
      membershipId: pending.id,
      expectedRevision: pending.revision,
      profileCollectionId: profile.collectionId,
      profileDocumentId: profile.documentId,
      actorIdentityId: input.identity.id,
      now: this.runtime.now(),
    });
    await this.subjects.ensureDefaultRoles({ realm: input.realm, subjectId: active.subjectId });
    return active;
  }
}

export interface ContentRealmAuthRuntime {
  readonly now: () => string;
  readonly newRealmId: () => string;
  readonly newFullAccessId: () => string;
  readonly randomToken: () => string;
  readonly hashToken: (token: string) => string;
  readonly deriveCsrfToken: (sessionToken: string) => string;
  readonly verifyCsrfToken: (sessionToken: string, csrfToken: string) => boolean;
}

export interface AuthenticatedContentRealmSession {
  readonly identity: GlobalIdentityRecord;
  readonly realm: IdentityRealmRecord;
  readonly membership: RealmMembershipRecord;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export class IdentityRealmApplicationService {
  public constructor(
    private readonly store: IdentityRealmStore,
    private readonly runtime: Pick<
      ContentRealmAuthRuntime,
      "now" | "newRealmId" | "newFullAccessId"
    >,
    private readonly provisioner?: RealmIdentityProvisioner,
    private readonly passwords?: PasswordHasher,
    private readonly owners?: RealmOwnerCoordinator,
    private readonly entitlements?: RealmCollectionEntitlementStore,
    private readonly delegations?: RealmManagementDelegationStore,
  ) {}

  public async listRealms(actor: ActorContext): Promise<readonly IdentityRealmRecord[]> {
    const realms = await this.store.listRealms(actor.workspaceId);
    try {
      await requireRealmAdministration(actor);
      return realms;
    } catch (error: unknown) {
      if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
      const owned = await Promise.all(realms.map(async (realm) =>
        realm.kind === "content" && await this.isCurrentPrimaryOwner(actor, realm.id)));
      const visible = realms.filter((_, index) => owned[index] === true);
      if (visible.length === 0) throw error;
      return visible;
    }
  }

  public async listGlobalIdentities(actor: ActorContext): Promise<readonly GlobalIdentityRecord[]> {
    await requireRealmAdministration(actor);
    const identities = await this.store.listIdentities(actor.workspaceId);
    return identities
      .filter((identity) => identity.workspaceId === actor.workspaceId)
      .map((identity) => ({
        id: identity.id,
        workspaceId: identity.workspaceId,
        kind: identity.kind,
        isOwner: identity.isOwner === true,
        primaryIdentifier: identity.primaryIdentifier,
        originRealmId: identity.originRealmId,
        credentialVersion: identity.credentialVersion,
        ...(identity.disabledAt === undefined ? {} : { disabledAt: identity.disabledAt }),
      }));
  }

  public async createRealm(
    actor: ActorContext,
    input: {
      readonly key: string;
      readonly name: string;
      readonly acceptSystemIdentities?: boolean;
      readonly provisioning?: RealmProvisioningMode;
      readonly registration?: RealmRegistrationMode;
      readonly defaultRoleIds?: readonly string[];
    },
  ): Promise<IdentityRealmRecord> {
    await requireRealmAdministration(actor);
    const key = normalizeRealmKey(input.key);
    const name = displayName(input.name, "Realm name");
    return this.store.createRealm({
      id: this.runtime.newRealmId(),
      workspaceId: actor.workspaceId,
      key,
      name,
      authentication: authenticationPolicy(input),
      actorIdentityId: actor.identityId ?? actor.subjectId,
      now: this.runtime.now(),
    });
  }

  public async updateRealm(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly expectedRevision: number;
      readonly name: string;
      readonly status: IdentityRealmStatus;
      readonly acceptSystemIdentities: boolean;
      readonly provisioning: RealmProvisioningMode;
      readonly registration: RealmRegistrationMode;
      readonly defaultRoleIds: readonly string[];
    },
  ): Promise<IdentityRealmRecord> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, input.realmId);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      invalid("expectedRevision must be a positive safe integer.");
    }
    if (input.status !== "active" && input.status !== "disabled") {
      invalid("An existing Realm status must be active or disabled.");
    }
    const current = await this.requireContentRealm(actor.workspaceId, input.realmId);
    if (input.status === "active" && current.profileCollectionId === undefined) {
      throw new ApplicationError(
        "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
        409,
        "A Content Realm becomes active only after an Auth Collection is applied.",
      );
    }
    return this.store.updateRealm({
      realmId: input.realmId,
      expectedRevision: input.expectedRevision,
      name: displayName(input.name, "Realm name"),
      status: input.status,
      authentication: authenticationPolicy(input),
      actorIdentityId: actor.identityId ?? actor.subjectId,
      now: this.runtime.now(),
    });
  }

  public async listMemberships(
    actor: ActorContext,
    realmId: string,
  ): Promise<readonly RealmMembershipRecord[]> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, realmId);
    await this.requireContentRealm(actor.workspaceId, realmId);
    const [memberships, identities] = await Promise.all([
      this.store.listMemberships(realmId),
      this.store.listIdentities(actor.workspaceId),
    ]);
    const byId = new Map(identities.map((identity) => [identity.id, identity]));
    return memberships.map((membership) => {
      const identity = byId.get(membership.identityId);
      return identity === undefined ? membership : { ...membership, identity };
    });
  }

  /**
   * CMS-level (control-plane) collection access ceiling management. Only a CMS
   * Owner (`requireRealmAdministration`) may read or change entitlements — these
   * are the ceiling that constrains a Realm's own policy, so a Realm operator
   * must never be able to widen them.
   */
  public async listRealmEntitlements(
    actor: ActorContext,
    realmId: string,
  ): Promise<{
    readonly status: RealmEntitlementStatus | null;
    readonly entitlements: readonly RealmCollectionEntitlement[];
  }> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, realmId);
    const store = this.requireEntitlementStore();
    const [status, entitlements] = await Promise.all([
      store.getEnforcement(realmId),
      store.listByRealm(realmId),
    ]);
    return { status, entitlements };
  }

  /** Reverse view: which Realms hold a ceiling on a given collection. */
  public async listCollectionEntitlements(
    actor: ActorContext,
    collectionId: string,
  ): Promise<readonly RealmCollectionEntitlement[]> {
    await requireRealmAdministration(actor);
    const store = this.requireEntitlementStore();
    return store.listByCollection(actor.workspaceId, normalizedId(collectionId, "collectionId"));
  }

  public async putRealmEntitlement(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly collectionId: string;
      readonly actions: readonly string[];
      readonly readableFields?: readonly string[];
      readonly writableFields?: readonly string[];
      readonly constraint?: {
        readonly ownerOnly?: boolean;
        readonly statuses?: readonly string[];
      };
      readonly expectedRevision: number | null;
      readonly reauthenticatedAt: string;
      readonly requestId?: string;
      readonly sessionId?: string;
    },
  ): Promise<RealmCollectionEntitlement> {
    await requireRealmAdministration(actor);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const realm = await this.requireContentRealm(actor.workspaceId, input.realmId);
    const store = this.requireEntitlementStore();

    const collectionId = normalizedId(input.collectionId, "collectionId");
    // A realm's Auth (profile) collection holds its members' identity/profile
    // data. Another realm must never be granted access to it — that would leak
    // account data across the realm boundary. The realm's own Auth collection is
    // already structurally guaranteed (no ceiling needed), so setting a ceiling
    // on ANY Auth collection here is only ever an attempt to open a foreign one.
    await this.assertNotAuthCollectionOfAnotherRealm(actor.workspaceId, input.realmId, collectionId);
    const actions = normalizedActions(input.actions);
    const readableFields = normalizedFields(input.readableFields, "readableFields");
    const writableFields = normalizedFields(input.writableFields, "writableFields");
    assertWritableSubset(readableFields, writableFields);
    const constraint = normalizedConstraint(input.constraint);
    if (input.expectedRevision !== null
      && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
      invalid("expectedRevision must be null (create) or a positive safe integer (update).");
    }

    const updatedBy = actor.identityId ?? actor.subjectId;
    const before = (await store.listByRealm(input.realmId))
      .find((e) => e.collectionId === collectionId);
    const saved = await store.put({
      workspaceId: realm.workspaceId,
      realmId: input.realmId,
      collectionId,
      actions,
      ...(readableFields === undefined ? {} : { readableFields }),
      ...(writableFields === undefined ? {} : { writableFields }),
      ...(constraint === undefined ? {} : { constraint }),
      expectedRevision: input.expectedRevision,
      updatedAt: now,
      updatedBy,
    });
    await this.store.recordRealmAdministrationEvent({
      event: "REALM_COLLECTION_ENTITLEMENT_UPDATED",
      systemIdentityId: updatedBy,
      realmId: input.realmId,
      accessMode: "cms-owner-control-plane",
      occurredAt: now,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      operation: before === undefined ? "create" : "update",
      targetType: "realm-collection-entitlement",
      targetId: collectionId,
      before,
      after: saved,
      result: "success",
      details: { reauthenticatedAt: input.reauthenticatedAt },
    });
    return saved;
  }

  public async deleteRealmEntitlement(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly collectionId: string;
      readonly expectedRevision: number;
      readonly reauthenticatedAt: string;
      readonly requestId?: string;
      readonly sessionId?: string;
    },
  ): Promise<void> {
    await requireRealmAdministration(actor);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    const store = this.requireEntitlementStore();

    const collectionId = normalizedId(input.collectionId, "collectionId");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      invalid("expectedRevision must be a positive safe integer.");
    }
    const before = (await store.listByRealm(input.realmId))
      .find((e) => e.collectionId === collectionId);
    await store.remove({
      realmId: input.realmId,
      collectionId,
      expectedRevision: input.expectedRevision,
    });
    await this.store.recordRealmAdministrationEvent({
      event: "REALM_COLLECTION_ENTITLEMENT_REMOVED",
      systemIdentityId: actor.identityId ?? actor.subjectId,
      realmId: input.realmId,
      accessMode: "cms-owner-control-plane",
      occurredAt: now,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      operation: "remove",
      targetType: "realm-collection-entitlement",
      targetId: collectionId,
      before,
      result: "success",
      details: { reauthenticatedAt: input.reauthenticatedAt },
    });
  }

  private requireEntitlementStore(): RealmCollectionEntitlementStore {
    if (this.entitlements === undefined) {
      throw new ApplicationError(
        "ENTITLEMENT_STORE_UNAVAILABLE",
        500,
        "Collection entitlement management is not configured on this server.",
      );
    }
    return this.entitlements;
  }

  /**
   * Rejects granting an entitlement on a collection that is another realm's Auth
   * (profile) collection. Cross-realm access to identity/profile data must go
   * through explicit user-administration delegation, never through a content
   * access ceiling.
   */
  private async assertNotAuthCollectionOfAnotherRealm(
    workspaceId: string,
    entitlementRealmId: string,
    collectionId: string,
  ): Promise<void> {
    const realms = await this.store.listRealms(workspaceId);
    const owner = realms.find((realm) => realm.profileCollectionId === collectionId);
    if (owner !== undefined && owner.id !== entitlementRealmId) {
      throw new ApplicationError(
        "ENTITLEMENT_FOREIGN_AUTH_COLLECTION",
        422,
        "A realm's Auth Collection cannot be exposed to another realm through an access ceiling.",
      );
    }
  }

  /**
   * CMS-level cross-realm user-administration delegation management. Only a CMS
   * Owner (`requireRealmAdministration`) may read or change delegations — these
   * decide which realm may administer another realm's users.
   */
  public async listRealmDelegations(
    actor: ActorContext,
    managingRealmId: string,
  ): Promise<readonly RealmManagementDelegation[]> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, managingRealmId);
    return this.requireDelegationStore().listByManagingRealm(managingRealmId);
  }

  /** Reverse view: which realms are allowed to administer a given realm's users. */
  public async listManagedByDelegations(
    actor: ActorContext,
    managedRealmId: string,
  ): Promise<readonly RealmManagementDelegation[]> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, managedRealmId);
    return this.requireDelegationStore().listByManagedRealm(managedRealmId);
  }

  public async putRealmDelegation(
    actor: ActorContext,
    input: {
      readonly managingRealmId: string;
      readonly managedRealmId: string;
      readonly actions: readonly string[];
      readonly scopeByAction: Readonly<Record<string, string>>;
      readonly expectedRevision: number | null;
      readonly reauthenticatedAt: string;
      readonly requestId?: string;
      readonly sessionId?: string;
    },
  ): Promise<RealmManagementDelegation> {
    await requireRealmAdministration(actor);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const managingRealmId = normalizedId(input.managingRealmId, "managingRealmId");
    const managedRealmId = normalizedId(input.managedRealmId, "managedRealmId");
    if (managingRealmId === managedRealmId) {
      invalid("A realm cannot be delegated to manage itself.");
    }
    // The managed realm must be a content realm in this workspace. The managing
    // realm may be content or the System realm (reserved for entry point A).
    const managed = await this.requireContentRealm(actor.workspaceId, managedRealmId);
    await this.requireManagingRealm(actor.workspaceId, managingRealmId);
    const store = this.requireDelegationStore();

    const actions = normalizedManagementActions(input.actions);
    const scopeByAction = normalizedScopeByAction(input.scopeByAction, actions);
    if (input.expectedRevision !== null
      && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
      invalid("expectedRevision must be null (create) or a positive safe integer (update).");
    }

    const updatedBy = actor.identityId ?? actor.subjectId;
    const before = await store.getDelegation(managingRealmId, managedRealmId);
    const saved = await store.put({
      workspaceId: managed.workspaceId,
      managingRealmId,
      managedRealmId,
      actions,
      scopeByAction,
      expectedRevision: input.expectedRevision,
      updatedAt: now,
      updatedBy,
    });
    await this.store.recordRealmAdministrationEvent({
      event: "REALM_MANAGEMENT_DELEGATION_UPDATED",
      systemIdentityId: updatedBy,
      realmId: managingRealmId,
      accessMode: "cms-owner-control-plane",
      occurredAt: now,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      operation: before === null ? "create" : "update",
      targetType: "realm-management-delegation",
      targetId: managedRealmId,
      before: before ?? undefined,
      after: saved,
      result: "success",
      details: { reauthenticatedAt: input.reauthenticatedAt },
    });
    return saved;
  }

  public async deleteRealmDelegation(
    actor: ActorContext,
    input: {
      readonly managingRealmId: string;
      readonly managedRealmId: string;
      readonly expectedRevision: number;
      readonly reauthenticatedAt: string;
      readonly requestId?: string;
      readonly sessionId?: string;
    },
  ): Promise<void> {
    await requireRealmAdministration(actor);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const managingRealmId = normalizedId(input.managingRealmId, "managingRealmId");
    const managedRealmId = normalizedId(input.managedRealmId, "managedRealmId");
    await this.requireManagingRealm(actor.workspaceId, managingRealmId);
    const store = this.requireDelegationStore();

    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      invalid("expectedRevision must be a positive safe integer.");
    }
    const before = await store.getDelegation(managingRealmId, managedRealmId);
    await store.remove({ managingRealmId, managedRealmId, expectedRevision: input.expectedRevision });
    await this.store.recordRealmAdministrationEvent({
      event: "REALM_MANAGEMENT_DELEGATION_REMOVED",
      systemIdentityId: actor.identityId ?? actor.subjectId,
      realmId: managingRealmId,
      accessMode: "cms-owner-control-plane",
      occurredAt: now,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      operation: "remove",
      targetType: "realm-management-delegation",
      targetId: managedRealmId,
      before: before ?? undefined,
      result: "success",
      details: { reauthenticatedAt: input.reauthenticatedAt },
    });
  }

  private requireDelegationStore(): RealmManagementDelegationStore {
    if (this.delegations === undefined) {
      throw new ApplicationError(
        "MANAGEMENT_DELEGATION_STORE_UNAVAILABLE",
        500,
        "Cross-realm management delegation is not configured on this server.",
      );
    }
    return this.delegations;
  }

  /**
   * A managing realm is either a content realm in this workspace or the System
   * realm (entry point A). Throws if it is neither.
   */
  private async requireManagingRealm(workspaceId: string, managingRealmId: string): Promise<void> {
    if (managingRealmId === SYSTEM_ACTOR_REALM_ID) return;
    await this.requireContentRealm(workspaceId, managingRealmId);
  }

  /** Explicitly gives an existing System Identity a Content Realm Membership. */
  public async provisionMembership(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly identityId: string;
      readonly profile: Readonly<Record<string, unknown>>;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmMembershipRecord> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, input.realmId);
    if (actorRealmId(actor) !== SYSTEM_ACTOR_REALM_ID) {
      throw new ApplicationError(
        "SYSTEM_REALM_ACTOR_REQUIRED",
        403,
        "Explicit Realm provisioning requires a System Realm operator.",
      );
    }
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const realm = await this.requireContentRealm(actor.workspaceId, input.realmId);
    if (realm.status !== "active") {
      throw new ApplicationError(
        "CONTENT_REALM_NOT_ACTIVE",
        409,
        "Memberships can only be provisioned into an active Content Realm.",
      );
    }
    if (!realm.authentication.acceptSystemIdentities) {
      throw new ApplicationError(
        "SYSTEM_IDENTITY_PROVISIONING_DISABLED",
        409,
        "This Content Realm does not accept System Identities.",
      );
    }
    const identity = await this.store.findIdentityById(input.identityId);
    if (identity === null || identity.workspaceId !== actor.workspaceId) {
      throw new ApplicationError(
        "GLOBAL_IDENTITY_NOT_FOUND",
        404,
        "The Global Identity does not exist in this Workspace.",
      );
    }
    if (identity.disabledAt !== undefined) {
      throw new ApplicationError(
        "GLOBAL_IDENTITY_DISABLED",
        409,
        "A disabled Global Identity cannot be provisioned.",
      );
    }
    if (identity.originRealmId !== SYSTEM_ACTOR_REALM_ID) {
      // Cross-Content-Realm linking requires a separately verified account-link
      // policy/proof. No such proof is part of this administrative use case.
      throw new ApplicationError(
        "IDENTITY_ACCOUNT_LINK_REQUIRED",
        409,
        "The Identity requires an explicit verified account-link operation.",
      );
    }
    const existing = await this.store.findMembershipByIdentity(realm.id, identity.id);
    if (existing?.status === "active") return existing;
    if (existing?.status === "suspended") {
      throw new ApplicationError(
        "REALM_MEMBERSHIP_SUSPENDED",
        403,
        "The existing Realm Membership is suspended.",
      );
    }
    if (this.provisioner === undefined) {
      throw new ApplicationError(
        "IDENTITY_PROVISIONER_UNAVAILABLE",
        503,
        "The durable Identity provisioning service is unavailable.",
      );
    }
    return this.provisioner.provisionExistingIdentity({
      realm,
      identity,
      method: "explicit",
      profile: input.profile,
      now,
    });
  }

  /**
   * Creates a brand-new Global Identity and provisions its Membership in one
   * administrative step, reusing the same durable saga as public signup. Unlike
   * signup this ignores the Realm registration policy — it is an operator action
   * gated by System Realm administration and recent re-authentication.
   */
  public async registerMembership(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly identifier: string;
      readonly password: string;
      readonly profile: Readonly<Record<string, unknown>>;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmMembershipRecord> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, input.realmId);
    if (actorRealmId(actor) !== SYSTEM_ACTOR_REALM_ID) {
      throw new ApplicationError(
        "SYSTEM_REALM_ACTOR_REQUIRED",
        403,
        "Explicit Realm provisioning requires a System Realm operator.",
      );
    }
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const realm = await this.requireContentRealm(actor.workspaceId, input.realmId);
    if (realm.status !== "active") {
      throw new ApplicationError(
        "CONTENT_REALM_NOT_ACTIVE",
        409,
        "Memberships can only be provisioned into an active Content Realm.",
      );
    }
    if (this.provisioner === undefined || this.passwords === undefined) {
      throw new ApplicationError(
        "IDENTITY_PROVISIONER_UNAVAILABLE",
        503,
        "The durable Identity provisioning service is unavailable.",
      );
    }
    const identifier = normalizeIdentityIdentifier(input.identifier);
    validateContentPassword(input.password, identifier);
    const passwordHash = await this.passwords.hash(input.password);
    return this.provisioner.register({
      realm,
      normalizedIdentifier: identifier,
      displayIdentifier: input.identifier.trim(),
      passwordHash,
      profile: input.profile,
      now,
    });
  }

  public async suspendMembership(
    actor: ActorContext,
    input: { readonly realmId: string; readonly membershipId: string; readonly expectedRevision: number },
  ): Promise<RealmMembershipRecord> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, input.realmId);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    const membership = await this.store.findMembershipById(input.membershipId);
    if (membership !== null && membership.realmId === input.realmId) {
      const owner = await this.requireOwners().getPrimaryOwner(input.realmId);
      if (owner.state === "assigned" && owner.subjectId === membership.subjectId) {
        throw new ApplicationError(
          "REALM_PRIMARY_OWNER_MEMBERSHIP_SUSPENSION_FORBIDDEN",
          409,
          "Transfer the Primary Realm Owner before suspending their Membership.",
        );
      }
    }
    return this.store.suspendMembership({
      ...input,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      now: this.runtime.now(),
    });
  }

  public async reactivateMembership(
    actor: ActorContext,
    input: { readonly realmId: string; readonly membershipId: string; readonly expectedRevision: number },
  ): Promise<RealmMembershipRecord> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, input.realmId);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    return this.store.reactivateMembership({
      ...input,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      now: this.runtime.now(),
    });
  }

  public async getOwner(
    actor: ActorContext,
    realmId: string,
  ): Promise<RealmOwnerStatusRecord> {
    await this.requireCmsOwnerOrPrimaryOwner(actor, realmId);
    await this.requireContentRealm(actor.workspaceId, realmId);
    return this.resolveOwnerStatus(realmId, await this.requireOwners().getPrimaryOwner(realmId));
  }

  public async assignOwner(
    actor: ActorContext,
    input: RealmOwnerCommandInput,
  ): Promise<RealmOwnerStatusRecord> {
    await requireRealmAdministration(actor);
    return this.changeOwner(actor, input, "assign", true);
  }

  public async transferOwner(
    actor: ActorContext,
    input: RealmOwnerCommandInput & {
      readonly revokePreviousSessions?: boolean;
      readonly suspendPreviousMembership?: boolean;
    },
  ): Promise<RealmOwnerStatusRecord> {
    // Normal transfers may be initiated by the current human Realm Owner even
    // when that operator is not the CMS Owner. The coordinator rechecks the
    // deterministic current Owner Binding before committing the CAS mutation.
    let cmsOwner = true;
    try {
      await requireRealmAdministration(actor);
    } catch (error: unknown) {
      if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
      cmsOwner = false;
    }
    return this.changeOwner(actor, input, "transfer", cmsOwner);
  }

  public async recoverOwner(
    actor: ActorContext,
    input: RealmOwnerCommandInput,
  ): Promise<RealmOwnerStatusRecord> {
    await requireRealmAdministration(actor);
    return this.changeOwner(actor, input, "recover", true);
  }

  private async changeOwner(
    actor: ActorContext,
    input: RealmOwnerCommandInput & {
      readonly revokePreviousSessions?: boolean;
      readonly suspendPreviousMembership?: boolean;
    },
    operation: "assign" | "transfer" | "recover",
    cmsOwner: boolean,
  ): Promise<RealmOwnerStatusRecord> {
    const realm = await this.requireContentRealm(actor.workspaceId, input.realmId);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const reason = displayName(input.reason, "Realm Owner change reason");
    const targetMembership = await this.store.findMembershipById(input.targetMembershipId);
    if (
      targetMembership === null
      || targetMembership.realmId !== realm.id
      || targetMembership.status !== "active"
    ) {
      throw new ApplicationError(
        "REALM_OWNER_TARGET_MEMBERSHIP_INELIGIBLE",
        409,
        "Realm Owner requires an active Membership in the target Realm.",
      );
    }
    const targetIdentity = await this.store.findIdentityById(targetMembership.identityId);
    if (
      targetIdentity === null
      || targetIdentity.workspaceId !== realm.workspaceId
      || targetIdentity.kind !== "human"
      || targetIdentity.disabledAt !== undefined
    ) {
      throw new ApplicationError(
        "REALM_OWNER_TARGET_IDENTITY_INELIGIBLE",
        409,
        "Realm Owner requires an active System operator Identity.",
      );
    }
    const systemMembership = await this.store.findMembershipByIdentity(
      SYSTEM_ACTOR_REALM_ID,
      targetIdentity.id,
    );
    if (systemMembership?.status !== "active") {
      throw new ApplicationError(
        "REALM_OWNER_TARGET_SYSTEM_OPERATOR_REQUIRED",
        409,
        "Realm Owner must be an active System operator.",
      );
    }
    if (!await this.store.isEligibleRealmOwner({
      realmId: realm.id,
      identityId: targetIdentity.id,
      subjectId: targetMembership.subjectId,
    })) {
      throw new ApplicationError(
        "REALM_OWNER_TARGET_SYSTEM_OPERATOR_REQUIRED",
        409,
        "Realm Owner must be an active, login-capable human System operator.",
      );
    }
    const systemIdentityId = actor.identityId ?? actor.subjectId;
    if (targetIdentity.isOwner === true || (cmsOwner && targetIdentity.id === systemIdentityId)) {
      throw new ApplicationError(
        "REALM_OWNER_CMS_OWNER_SELF_ASSIGNMENT_FORBIDDEN",
        403,
        "The CMS Owner cannot assign their own Identity as Realm Owner.",
      );
    }
    const owners = this.requireOwners();
    const before = await owners.getPrimaryOwner(realm.id);
    const previousOwnerMembership = before.state === "assigned"
      && before.identityId !== undefined
      && before.subjectId !== targetMembership.subjectId
      ? await this.store.findMembershipByIdentity(realm.id, before.identityId)
      : null;
    const commandActor: RealmOwnerCommandActor = cmsOwner
      ? {
          accessMode: "cms-owner-control-plane",
          realmId: realm.id,
          systemIdentityId,
          systemSubjectId: actor.subjectId,
        }
      : {
          accessMode: "realm-actor",
          realmId: realm.id,
          subjectId: (await this.requireCurrentOwnerActor(
            realm.id,
            systemIdentityId,
            before,
          )).subjectId,
          systemIdentityId,
        };
    const changed = await owners.setPrimaryOwner(commandActor, {
      expectedRevision: input.expectedPolicyRevision,
      subjectId: targetMembership.subjectId,
      operation,
    });
    const cleanup = operation === "transfer"
      ? await this.cleanupTransferredOwner({
          realmId: realm.id,
          actorIdentityId: systemIdentityId,
          now,
          previousOwnerSubjectId: before.subjectId,
          previousOwnerMembership,
          targetSubjectId: targetMembership.subjectId,
          revokePreviousSessions: input.revokePreviousSessions === true,
          suspendPreviousMembership: input.suspendPreviousMembership === true,
        })
      : undefined;
    await this.store.recordRealmAdministrationEvent({
      event: operation === "assign"
        ? "REALM_OWNER_ASSIGNED"
        : operation === "transfer"
          ? cmsOwner
            ? "REALM_OWNER_REPLACED"
            : "REALM_OWNER_TRANSFERRED"
          : "REALM_OWNER_RECOVERED",
      systemIdentityId,
      realmId: realm.id,
      accessMode: cmsOwner ? "cms-owner-control-plane" : "realm-actor",
      occurredAt: now,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(commandActor.accessMode === "realm-actor"
        ? { realmSubjectId: commandActor.subjectId }
        : {}),
      operation,
      targetType: "primary-realm-owner",
      targetId: targetMembership.subjectId,
      before,
      after: changed,
      reason,
      result: cleanup?.error === undefined ? "success" : "owner-changed-cleanup-failed",
      details: {
        reauthenticatedAt: input.reauthenticatedAt,
        forcedByCmsOwner: cmsOwner,
        ...(cleanup === undefined ? {} : { previousOwnerCleanup: cleanup.audit }),
      },
    });
    if (cleanup?.error !== undefined) {
      throw new ApplicationError(
        "REALM_OWNER_TRANSFER_CLEANUP_FAILED",
        409,
        "The Realm Owner changed, but the previous Owner cleanup did not complete.",
        {
          details: {
            ownerTransferCommitted: true,
            policyRevision: changed.policyRevision,
            previousOwnerCleanup: cleanup.audit,
          },
        },
      );
    }
    return this.resolveOwnerStatus(realm.id, changed);
  }

  private async cleanupTransferredOwner(input: {
    readonly realmId: string;
    readonly actorIdentityId: string;
    readonly now: string;
    readonly previousOwnerSubjectId: string | undefined;
    readonly previousOwnerMembership: RealmMembershipRecord | null;
    readonly targetSubjectId: string;
    readonly revokePreviousSessions: boolean;
    readonly suspendPreviousMembership: boolean;
  }): Promise<{
    readonly audit: Readonly<Record<string, unknown>>;
    readonly error?: unknown;
  }> {
    const requested = {
      revokePreviousSessions: input.revokePreviousSessions,
      suspendPreviousMembership: input.suspendPreviousMembership,
    };
    if (input.previousOwnerSubjectId === input.targetSubjectId) {
      return { audit: { requested, outcome: "skipped-same-owner" } };
    }
    if (input.previousOwnerMembership === null) {
      return { audit: { requested, outcome: "skipped-no-previous-membership" } };
    }
    if (!input.revokePreviousSessions && !input.suspendPreviousMembership) {
      return {
        audit: {
          requested,
          outcome: "not-requested",
          previousMembershipId: input.previousOwnerMembership.id,
        },
      };
    }

    try {
      if (input.suspendPreviousMembership) {
        if (input.previousOwnerMembership.status !== "suspended") {
          const suspended = await this.store.suspendMembership({
            realmId: input.realmId,
            membershipId: input.previousOwnerMembership.id,
            expectedRevision: input.previousOwnerMembership.revision,
            actorIdentityId: input.actorIdentityId,
            now: input.now,
          });
          return {
            audit: {
              requested,
              outcome: "completed",
              previousMembershipId: suspended.id,
              membershipSuspended: true,
              sessionsCleared: true,
              resultingMembershipRevision: suspended.revision,
            },
          };
        }
        const revokedSessions = await this.store.revokeMembershipSessions({
          realmId: input.realmId,
          membershipId: input.previousOwnerMembership.id,
          actorIdentityId: input.actorIdentityId,
          now: input.now,
          reason: "realm-owner-transferred",
        });
        return {
          audit: {
            requested,
            outcome: "completed",
            previousMembershipId: input.previousOwnerMembership.id,
            membershipAlreadySuspended: true,
            sessionsCleared: true,
            revokedSessions,
          },
        };
      }

      const revokedSessions = await this.store.revokeMembershipSessions({
        realmId: input.realmId,
        membershipId: input.previousOwnerMembership.id,
        actorIdentityId: input.actorIdentityId,
        now: input.now,
        reason: "realm-owner-transferred",
      });
      return {
        audit: {
          requested,
          outcome: "completed",
          previousMembershipId: input.previousOwnerMembership.id,
          membershipSuspended: false,
          sessionsCleared: true,
          revokedSessions,
        },
      };
    } catch (error: unknown) {
      return {
        audit: {
          requested,
          outcome: "failed",
          previousMembershipId: input.previousOwnerMembership.id,
          errorCode: error instanceof ApplicationError ? error.code : "REALM_OWNER_CLEANUP_INTERNAL_ERROR",
        },
        error,
      };
    }
  }

  private async requireCurrentOwnerActor(
    realmId: string,
    systemIdentityId: string,
    owner: RealmPrimaryOwnerStatus,
  ): Promise<{ readonly subjectId: string }> {
    const membership = await this.store.findMembershipByIdentity(realmId, systemIdentityId);
    if (
      owner.state !== "assigned"
      || owner.subjectId === undefined
      || membership?.status !== "active"
      || membership.subjectId !== owner.subjectId
    ) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_REQUIRED",
        403,
        "Only the current Primary Realm Owner can transfer ownership.",
      );
    }
    return { subjectId: membership.subjectId };
  }

  private async resolveOwnerStatus(
    realmId: string,
    owner: RealmPrimaryOwnerStatus,
  ): Promise<RealmOwnerStatusRecord> {
    if (owner.state === "unassigned") {
      return {
        realmId,
        status: "ownerless",
        policyRevision: owner.policyRevision,
        issueCode: "REALM_PRIMARY_OWNER_MISSING",
      };
    }
    if (owner.state === "invalid" || owner.subjectId === undefined || owner.identityId === undefined) {
      return {
        realmId,
        status: "invalid",
        policyRevision: owner.policyRevision,
        issueCode: owner.issues[0] ?? "REALM_PRIMARY_OWNER_POLICY_INVALID",
      };
    }
    const memberships = await this.store.listMemberships(realmId);
    const membership = memberships.find(({ subjectId }) => subjectId === owner.subjectId);
    const identity = await this.store.findIdentityById(owner.identityId);
    if (membership === undefined || identity === null) {
      return {
        realmId,
        status: "invalid",
        policyRevision: owner.policyRevision,
        issueCode: "REALM_PRIMARY_OWNER_IDENTITY_LINK_INVALID",
      };
    }
    const healthy = await this.store.isEligibleRealmOwner({
      realmId,
      identityId: owner.identityId,
      subjectId: owner.subjectId,
    });
    return {
      realmId,
      status: healthy ? "healthy" : "invalid",
      policyRevision: owner.policyRevision,
      owner: {
        globalIdentityId: identity.id,
        membershipId: membership.id,
        subjectId: membership.subjectId,
        primaryIdentifier: identity.primaryIdentifier,
        identityActive: identity.disabledAt === undefined,
        membershipStatus: membership.status,
      },
      ...(healthy ? {} : { issueCode: "REALM_PRIMARY_OWNER_INACTIVE" }),
    };
  }

  private async requireCmsOwnerOrPrimaryOwner(
    actor: ActorContext,
    realmId: string,
  ): Promise<void> {
    try {
      await requireRealmAdministration(actor);
      return;
    } catch (error: unknown) {
      if (!(error instanceof ApplicationError) || error.status !== 403) throw error;
      if (await this.isCurrentPrimaryOwner(actor, realmId)) return;
      throw error;
    }
  }

  private async isCurrentPrimaryOwner(actor: ActorContext, realmId: string): Promise<boolean> {
    if (this.owners === undefined || actorRealmId(actor) !== SYSTEM_ACTOR_REALM_ID) return false;
    const systemIdentityId = actor.identityId ?? actor.subjectId;
    const membership = await this.store.findMembershipByIdentity(realmId, systemIdentityId);
    if (membership?.status !== "active") return false;
    const owner = await this.owners.getPrimaryOwner(realmId);
    return owner.state === "assigned"
      && owner.subjectId !== undefined
      && membership.subjectId === owner.subjectId;
  }

  private requireOwners(): RealmOwnerCoordinator {
    if (this.owners === undefined) {
      throw new ApplicationError(
        "REALM_OWNER_COORDINATOR_UNAVAILABLE",
        503,
        "Realm Owner management is not configured.",
      );
    }
    return this.owners;
  }

  public async listFullAccessBindings(
    actor: ActorContext,
    realmId: string,
  ): Promise<readonly RealmFullAccessBindingRecord[]> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, realmId);
    return this.store.listFullAccessBindings(realmId, this.runtime.now());
  }

  public async grantFullAccess(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly reason: string;
      readonly reauthenticatedAt: string;
      readonly validUntil: string;
    },
  ): Promise<RealmFullAccessBindingRecord> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const reason = displayName(input.reason, "Full Access reason");
    const timestamp = Date.parse(input.validUntil);
    const nowTimestamp = Date.parse(now);
    if (!Number.isFinite(timestamp) || timestamp <= nowTimestamp) {
      invalid("validUntil must be a future ISO timestamp.");
    }
    if (timestamp > nowTimestamp + 4 * 60 * 60 * 1000) {
      invalid("validUntil cannot be more than 4 hours in the future.");
    }
    const systemIdentityId = actor.identityId ?? actor.subjectId;
    return this.store.grantFullAccess({
      id: this.runtime.newFullAccessId(),
      realmId: input.realmId,
      systemIdentityId,
      grantedByIdentityId: systemIdentityId,
      reason,
      createdAt: now,
      validUntil: input.validUntil,
    });
  }

  public async revokeFullAccess(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly bindingId: string;
      readonly reauthenticatedAt: string;
    },
  ): Promise<RealmFullAccessBindingRecord> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    return this.store.revokeFullAccess({
      realmId: input.realmId,
      bindingId: input.bindingId,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      now,
    });
  }

  private async requireContentRealm(workspaceId: string, realmId: string): Promise<IdentityRealmRecord> {
    const realm = await this.store.getRealmById(realmId);
    if (realm === null || realm.workspaceId !== workspaceId || realm.kind !== "content") {
      throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Content Realm does not exist.");
    }
    return realm;
  }
}

export class ContentRealmAuthenticationService {
  public constructor(
    private readonly store: IdentityRealmStore,
    private readonly passwords: PasswordHasher,
    private readonly provisioner: RealmIdentityProvisioner,
    private readonly runtime: ContentRealmAuthRuntime,
    private readonly workspaceId: string,
    private readonly sessionLifetimeMs = 8 * 60 * 60 * 1000,
  ) {}

  public async signup(input: {
    readonly realmKey: string;
    readonly identifier: string;
    readonly password: string;
    readonly profile: Readonly<Record<string, unknown>>;
  }): Promise<AuthenticatedContentRealmSession> {
    const realm = await this.activeRealm(input.realmKey);
    if (realm.authentication.registration !== "open") {
      throw new ApplicationError("REALM_REGISTRATION_CLOSED", 403, "Registration is not available.");
    }
    const identifier = normalizeIdentityIdentifier(input.identifier);
    validateContentPassword(input.password, identifier);
    const existing = await this.store.findIdentityCredentialByIdentifier(this.workspaceId, identifier);
    if (existing !== null) {
      return this.resumeSignup(realm, existing, input.password, input.profile);
    }
    try {
      const membership = await this.provisioner.register({
        realm,
        normalizedIdentifier: identifier,
        displayIdentifier: input.identifier.trim(),
        passwordHash: await this.passwords.hash(input.password),
        profile: input.profile,
        now: this.runtime.now(),
      });
      const identity = await this.requireIdentity(membership.identityId);
      return this.issueSession(realm, identity, membership);
    } catch (error: unknown) {
      // Concurrent or interrupted signup may have committed the Identity before
      // Membership/Profile activation. Resume only after proving the same
      // credential; identifier equality alone is never account linking.
      if (!(error instanceof ApplicationError) || error.code !== "IDENTITY_IDENTIFIER_CONFLICT") {
        throw error;
      }
      const raced = await this.store.findIdentityCredentialByIdentifier(this.workspaceId, identifier);
      if (raced === null) throw error;
      return this.resumeSignup(realm, raced, input.password, input.profile);
    }
  }

  public async login(input: {
    readonly realmKey: string;
    readonly identifier: string;
    readonly password: string;
    readonly jitProfile?: Readonly<Record<string, unknown>>;
  }): Promise<AuthenticatedContentRealmSession> {
    const realm = await this.activeRealm(input.realmKey);
    const normalizedIdentifier = normalizeIdentityIdentifier(input.identifier);
    const identity = await this.store.findIdentityCredentialByIdentifier(
      this.workspaceId,
      normalizedIdentifier,
    );
    let verified = false;
    if (identity === null) {
      await this.passwords.verifyDummy(input.password);
    } else {
      verified = await this.passwords.verify(input.password, identity.passwordHash);
    }
    if (identity === null || !verified) authenticationFailed();

    let membership = await this.store.findMembershipByIdentity(realm.id, identity.id);
    if (membership === null) {
      if (
        !realm.authentication.acceptSystemIdentities ||
        realm.authentication.provisioning !== "jit" ||
        identity.originRealmId !== "rlm_system"
      ) {
        authenticationFailed();
      }
      membership = await this.provisioner.provisionExistingIdentity({
        realm,
        identity,
        method: "jit",
        profile: input.jitProfile ?? {},
        now: this.runtime.now(),
      });
    }
    if (membership.status !== "active") authenticationFailed();
    return this.issueSession(realm, identity, membership);
  }

  public async authenticate(input: {
    readonly realmKey: string;
    readonly sessionToken: string;
  }): Promise<Omit<AuthenticatedContentRealmSession, "sessionToken" | "csrfToken">> {
    const realm = await this.activeRealm(input.realmKey);
    const session = await this.store.findContentSession(
      this.runtime.hashToken(input.sessionToken),
      realm.id,
      this.runtime.now(),
    );
    if (session === null) {
      throw new ApplicationError("CONTENT_SESSION_INVALID", 401, "The Realm session is invalid or expired.");
    }
    return {
      identity: session.identity,
      realm: session.realm,
      membership: session.membership,
      expiresAt: session.expiresAt,
    };
  }

  public async assertCsrfToken(input: {
    readonly realmKey: string;
    readonly sessionToken: string;
    readonly csrfToken: string;
  }): Promise<void> {
    const realm = await this.activeRealm(input.realmKey);
    if (!this.runtime.verifyCsrfToken(input.sessionToken, input.csrfToken)) csrfFailed();
    const valid = await this.store.findContentSessionWithCsrf(
      this.runtime.hashToken(input.sessionToken),
      this.runtime.hashToken(input.csrfToken),
      realm.id,
      this.runtime.now(),
    );
    if (!valid) csrfFailed();
  }

  public async logout(input: { readonly realmKey: string; readonly sessionToken: string }): Promise<void> {
    const realm = await this.activeRealm(input.realmKey);
    await this.store.deleteContentSession(this.runtime.hashToken(input.sessionToken), realm.id);
  }

  private async resumeSignup(
    realm: IdentityRealmRecord,
    identity: GlobalIdentityCredentialRecord,
    password: string,
    profile: Readonly<Record<string, unknown>>,
  ): Promise<AuthenticatedContentRealmSession> {
    const verified = await this.passwords.verify(password, identity.passwordHash);
    if (!verified || identity.originRealmId !== realm.id || identity.disabledAt !== undefined) {
      throw new ApplicationError(
        "IDENTITY_IDENTIFIER_CONFLICT",
        409,
        "That Identity identifier already exists. Sign in and use verified account linking.",
      );
    }
    let membership = await this.store.findMembershipByIdentity(realm.id, identity.id);
    if (membership?.status === "suspended") {
      throw new ApplicationError("REALM_MEMBERSHIP_SUSPENDED", 403, "The Realm Membership is suspended.");
    }
    if (membership?.status !== "active") {
      membership = await this.provisioner.provisionExistingIdentity({
        realm,
        identity,
        method: "signup",
        profile,
        now: this.runtime.now(),
      });
    }
    return this.issueSession(realm, identity, membership);
  }

  private async activeRealm(realmKey: string): Promise<IdentityRealmRecord> {
    const realm = await this.store.getRealmByKey(this.workspaceId, normalizeRealmKey(realmKey));
    if (realm === null || realm.kind !== "content" || realm.status !== "active") {
      // Do not distinguish missing and disabled Realms at the authentication boundary.
      throw new ApplicationError("CONTENT_REALM_UNAVAILABLE", 404, "The Content Realm is unavailable.");
    }
    return realm;
  }

  private async requireIdentity(identityId: string): Promise<GlobalIdentityRecord> {
    const identity = await this.store.findIdentityById(identityId);
    if (identity === null || identity.disabledAt !== undefined) {
      throw new ApplicationError("IDENTITY_PROVISIONING_INCOMPLETE", 503, "Identity provisioning is incomplete.");
    }
    return identity;
  }

  private async issueSession(
    realm: IdentityRealmRecord,
    identity: GlobalIdentityRecord,
    membership: RealmMembershipRecord,
  ): Promise<AuthenticatedContentRealmSession> {
    if (
      membership.realmId !== realm.id ||
      membership.identityId !== identity.id ||
      membership.status !== "active"
    ) {
      throw new ApplicationError("IDENTITY_PROVISIONING_INCOMPLETE", 503, "Identity provisioning is incomplete.");
    }
    const sessionToken = this.runtime.randomToken();
    const csrfToken = this.runtime.deriveCsrfToken(sessionToken);
    const authenticatedAt = this.runtime.now();
    const expiresAt = new Date(Date.parse(authenticatedAt) + this.sessionLifetimeMs).toISOString();
    await this.store.createContentSession({
      tokenHash: this.runtime.hashToken(sessionToken),
      csrfTokenHash: this.runtime.hashToken(csrfToken),
      identityId: identity.id,
      realmId: realm.id,
      membershipId: membership.id,
      subjectId: membership.subjectId,
      credentialVersion: identity.credentialVersion,
      authenticatedAt,
      expiresAt,
    });
    return { identity, realm, membership, sessionToken, csrfToken, expiresAt };
  }
}

export function normalizeRealmKey(value: string): string {
  if (typeof value !== "string") invalid("Realm key must be a string.");
  const key = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/.test(key)) {
    invalid("Realm key must be 3-49 lowercase letters, numbers, or hyphens.");
  }
  if (key === "system" || key === "admin" || key === "api") {
    invalid(`Realm key '${key}' is reserved.`);
  }
  return key;
}

export function normalizeIdentityIdentifier(value: string): string {
  if (typeof value !== "string") invalid("Identity identifier must be a string.");
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (normalized.length < 3 || normalized.length > 254 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    invalid("Identity identifier must contain 3-254 valid characters.");
  }
  return normalized;
}

function authenticationPolicy(input: {
  readonly acceptSystemIdentities?: boolean;
  readonly provisioning?: RealmProvisioningMode;
  readonly registration?: RealmRegistrationMode;
  readonly defaultRoleIds?: readonly string[];
}): RealmAuthenticationPolicyRecord {
  const provisioning = input.provisioning ?? "explicit";
  const registration = input.registration ?? "closed";
  if (provisioning !== "explicit" && provisioning !== "jit") invalid("Invalid provisioning mode.");
  if (registration !== "closed" && registration !== "open") invalid("Invalid registration mode.");
  const defaultRoleIds = uniqueNonEmptyStrings(input.defaultRoleIds ?? [], "defaultRoleIds");
  if (provisioning === "jit" && input.acceptSystemIdentities !== true) {
    invalid("JIT provisioning requires acceptSystemIdentities=true.");
  }
  return {
    acceptSystemIdentities: input.acceptSystemIdentities === true,
    provisioning,
    registration,
    defaultRoleIds,
  };
}

function validateContentPassword(password: string, identifier: string): void {
  if (typeof password !== "string" || password.length > 128 || password.includes("\u0000")) {
    invalid("Password is not valid.");
  }
  if (password.length < 12) {
    throw new ApplicationError("PASSWORD_TOO_SHORT", 422, "Password must contain at least 12 characters.");
  }
  if (password.toLocaleLowerCase("en-US") === identifier) {
    throw new ApplicationError("PASSWORD_MATCHES_IDENTIFIER", 422, "Password cannot match the identifier.");
  }
}

async function requireRealmAdministration(actor: ActorContext): Promise<void> {
  if (actor.authorization !== undefined) {
    await actor.authorization.require({
      action: "authorization.manage",
      resourceId: "resource:authorization",
    });
    return;
  }
  if (!actor.capabilities.includes("schema:apply")) {
    throw new ApplicationError("ACCESS_DENIED", 403, "Realm administration permission is required.");
  }
}

function displayName(value: string, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 1 || normalized.length > 120) invalid(`${label} must contain 1-120 characters.`);
  return normalized;
}

function normalizedId(value: string, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    invalid(`${label} must contain 1-200 characters.`);
  }
  return normalized;
}

const COLLECTION_ACTION_SET = new Set<string>(COLLECTION_ACTIONS);

function normalizedActions(value: readonly string[]): readonly CollectionAction[] {
  if (!Array.isArray(value)) invalid("actions must be an array.");
  const seen = new Set<CollectionAction>();
  for (const raw of value) {
    if (typeof raw !== "string" || !COLLECTION_ACTION_SET.has(raw)) {
      invalid(`Unknown collection action: ${JSON.stringify(raw)}.`);
    }
    seen.add(raw as CollectionAction);
  }
  return COLLECTION_ACTIONS.filter((action) => seen.has(action));
}

const MANAGEMENT_ACTION_SET = new Set<string>(MANAGEMENT_ACTIONS);

function normalizedManagementActions(value: readonly string[]): readonly ManagementAction[] {
  if (!Array.isArray(value)) invalid("actions must be an array.");
  const seen = new Set<ManagementAction>();
  for (const raw of value) {
    if (typeof raw !== "string" || !MANAGEMENT_ACTION_SET.has(raw)) {
      invalid(`Unknown management action: ${JSON.stringify(raw)}.`);
    }
    seen.add(raw as ManagementAction);
  }
  if (seen.size === 0) invalid("A delegation must grant at least one action.");
  return MANAGEMENT_ACTIONS.filter((action) => seen.has(action));
}

/**
 * Normalises the per-action any/all rule. Every declared action gets an explicit
 * rule (defaulting to the stricter "all" when omitted); keys for actions not in
 * the delegation are rejected to avoid dangling scope entries.
 */
function normalizedScopeByAction(
  value: Readonly<Record<string, string>>,
  actions: readonly ManagementAction[],
): Readonly<Partial<Record<ManagementAction, DelegationScopeRule>>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("scopeByAction must be an object.");
  }
  const allowed = new Set<string>(actions);
  const result: Partial<Record<ManagementAction, DelegationScopeRule>> = {};
  for (const [action, rule] of Object.entries(value)) {
    if (!allowed.has(action)) {
      invalid(`scopeByAction has a rule for '${action}', which is not a granted action.`);
    }
    if (rule !== "any" && rule !== "all") {
      invalid(`scopeByAction.${action} must be 'any' or 'all'.`);
    }
    result[action as ManagementAction] = rule;
  }
  // Default any action without an explicit rule to the stricter "all".
  for (const action of actions) {
    if (result[action] === undefined) result[action] = "all";
  }
  return result;
}

function normalizedFields(
  value: readonly string[] | undefined,
  label: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalid(`${label} must be an array or omitted.`);
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") invalid(`${label} entries must be strings.`);
    const field = raw.trim();
    if (field.length < 1 || field.length > 200) {
      invalid(`${label} entries must contain 1-200 characters.`);
    }
    seen.add(field);
  }
  return [...seen];
}

/** Enforce writable ⊆ readable so a ceiling can never permit a blind write. */
function assertWritableSubset(
  readableFields: readonly string[] | undefined,
  writableFields: readonly string[] | undefined,
): void {
  if (writableFields === undefined) return;
  if (readableFields === undefined) return;
  const readable = new Set(readableFields);
  for (const field of writableFields) {
    if (!readable.has(field)) {
      throw new ApplicationError(
        "ENTITLEMENT_FIELD_INVALID",
        422,
        `writableFields must be a subset of readableFields (offending field: ${field}).`,
      );
    }
  }
}

function normalizedConstraint(
  value: { readonly ownerOnly?: boolean; readonly statuses?: readonly string[] } | undefined,
): CollectionEntitlementConstraint | undefined {
  if (value === undefined) return undefined;
  const constraint: { ownerOnly?: boolean; statuses?: readonly string[] } = {};
  if (value.ownerOnly !== undefined) {
    if (typeof value.ownerOnly !== "boolean") invalid("constraint.ownerOnly must be a boolean.");
    if (value.ownerOnly) constraint.ownerOnly = true;
  }
  if (value.statuses !== undefined) {
    if (!Array.isArray(value.statuses)) invalid("constraint.statuses must be an array.");
    const seen = new Set<string>();
    for (const raw of value.statuses) {
      if (typeof raw !== "string") invalid("constraint.statuses entries must be strings.");
      const status = raw.trim();
      if (status.length < 1 || status.length > 100) {
        invalid("constraint.statuses entries must contain 1-100 characters.");
      }
      seen.add(status);
    }
    if (seen.size > 0) constraint.statuses = [...seen];
  }
  return Object.keys(constraint).length === 0 ? undefined : constraint;
}

function requireRecentReauthentication(reauthenticatedAt: string, now: string): void {
  const proof = Date.parse(reauthenticatedAt);
  const current = Date.parse(now);
  if (
    !Number.isFinite(proof) ||
    !Number.isFinite(current) ||
    proof > current + 30_000 ||
    current - proof > 5 * 60 * 1000
  ) {
    throw new ApplicationError(
      "RECENT_REAUTHENTICATION_REQUIRED",
      403,
      "Realm Full Access changes require recent reauthentication.",
    );
  }
}

function uniqueNonEmptyStrings(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) invalid(`${label} must be an array.`);
  const normalized = values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) invalid(`${label} contains an invalid value.`);
    return value.trim();
  });
  if (new Set(normalized).size !== normalized.length) invalid(`${label} must not contain duplicates.`);
  return Object.freeze(normalized);
}

function authenticationFailed(): never {
  throw new ApplicationError("AUTHENTICATION_FAILED", 401, "The identifier or password is incorrect.");
}

function csrfFailed(): never {
  throw new ApplicationError("CSRF_TOKEN_INVALID", 403, "The CSRF token is invalid.");
}

function invalid(message: string): never {
  throw new ApplicationError("IDENTITY_REALM_INPUT_INVALID", 422, message);
}
