import {
  ApplicationError,
  SYSTEM_ACTOR_REALM_ID,
  actorRealmId,
  type ActorContext,
} from "./errors.js";
import type { PasswordHasher } from "./auth.js";

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
  readonly subjectId: string;
  readonly grantedByIdentityId: string;
  readonly grantedBySubjectId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly validUntil?: string;
  readonly revokedAt?: string;
  readonly revokedByIdentityId?: string;
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
  listFullAccessBindings(realmId: string): Promise<readonly RealmFullAccessBindingRecord[]>;
  grantFullAccess(input: RealmFullAccessBindingRecord): Promise<RealmFullAccessBindingRecord>;
  revokeFullAccess(input: {
    readonly realmId: string;
    readonly bindingId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmFullAccessBindingRecord>;
  hasActiveFullAccess(realmId: string, subjectId: string, now: string): Promise<boolean>;
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
  ) {}

  public async listRealms(actor: ActorContext): Promise<readonly IdentityRealmRecord[]> {
    await requireRealmAdministration(actor);
    return this.store.listRealms(actor.workspaceId);
  }

  public async listGlobalIdentities(actor: ActorContext): Promise<readonly GlobalIdentityRecord[]> {
    await requireRealmAdministration(actor);
    const identities = await this.store.listIdentities(actor.workspaceId);
    return identities
      .filter((identity) => identity.workspaceId === actor.workspaceId)
      .map((identity) => ({
        id: identity.id,
        workspaceId: identity.workspaceId,
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
    await requireRealmAdministration(actor);
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
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, realmId);
    return this.store.listMemberships(realmId);
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
    await requireRealmAdministration(actor);
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

  public async suspendMembership(
    actor: ActorContext,
    input: { readonly realmId: string; readonly membershipId: string; readonly expectedRevision: number },
  ): Promise<RealmMembershipRecord> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
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
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    return this.store.reactivateMembership({
      ...input,
      actorIdentityId: actor.identityId ?? actor.subjectId,
      now: this.runtime.now(),
    });
  }

  public async listFullAccessBindings(
    actor: ActorContext,
    realmId: string,
  ): Promise<readonly RealmFullAccessBindingRecord[]> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, realmId);
    return this.store.listFullAccessBindings(realmId);
  }

  public async grantFullAccess(
    actor: ActorContext,
    input: {
      readonly realmId: string;
      readonly subjectId: string;
      readonly reason: string;
      readonly reauthenticatedAt: string;
      readonly validUntil?: string;
    },
  ): Promise<RealmFullAccessBindingRecord> {
    await requireRealmAdministration(actor);
    await this.requireContentRealm(actor.workspaceId, input.realmId);
    const now = this.runtime.now();
    requireRecentReauthentication(input.reauthenticatedAt, now);
    const membership = (await this.store.listMemberships(input.realmId)).find(
      (candidate) => candidate.subjectId === input.subjectId,
    );
    if (membership?.status !== "active") {
      throw new ApplicationError(
        "REALM_MEMBERSHIP_NOT_ACTIVE",
        409,
        "Realm Full Access requires an active Membership.",
      );
    }
    const reason = displayName(input.reason, "Full Access reason");
    if (input.validUntil !== undefined) {
      const timestamp = Date.parse(input.validUntil);
      if (!Number.isFinite(timestamp) || timestamp <= Date.parse(now)) {
        invalid("validUntil must be a future ISO timestamp.");
      }
    }
    return this.store.grantFullAccess({
      id: this.runtime.newFullAccessId(),
      realmId: input.realmId,
      subjectId: input.subjectId,
      grantedByIdentityId: actor.identityId ?? actor.subjectId,
      grantedBySubjectId: actor.subjectId,
      reason,
      createdAt: now,
      ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil }),
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
