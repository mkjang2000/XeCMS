import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "./errors.js";
import {
  ContentRealmAuthenticationService,
  DurableRealmIdentityProvisioner,
  IdentityRealmApplicationService,
  normalizeIdentityIdentifier,
  normalizeRealmKey,
  type ContentRealmSessionRecord,
  type GlobalIdentityCredentialRecord,
  type GlobalIdentityRecord,
  type IdentityRealmRecord,
  type IdentityRealmStore,
  type RealmFullAccessBindingRecord,
  type RealmAdministrationAuditRecord,
  type RealmIdentityProvisioner,
  type RealmMembershipRecord,
  type RealmOwnerCoordinator,
} from "./identity-realms.js";
import {
  InMemoryRealmCollectionEntitlementStore,
} from "./realm-collection-entitlements.js";
import {
  InMemoryRealmManagementDelegationStore,
} from "./realm-management-delegations.js";

const NOW = "2026-07-15T00:00:00.000Z";
const WORKSPACE_ID = "wrk_default";

class MemoryIdentityRealmStore implements IdentityRealmStore {
  readonly realms = new Map<string, IdentityRealmRecord>();
  readonly identities = new Map<string, GlobalIdentityCredentialRecord>();
  readonly memberships = new Map<string, RealmMembershipRecord>();
  readonly sessions = new Map<string, ContentRealmSessionRecord & { readonly csrf: string }>();
  readonly fullAccess = new Map<string, RealmFullAccessBindingRecord>();
  readonly administrationEvents: RealmAdministrationAuditRecord[] = [];

  async listRealms(workspaceId: string) {
    return [...this.realms.values()].filter((realm) => realm.workspaceId === workspaceId);
  }
  async getRealmById(realmId: string) { return this.realms.get(realmId) ?? null; }
  async getRealmByKey(workspaceId: string, realmKey: string) {
    return [...this.realms.values()].find((realm) =>
      realm.workspaceId === workspaceId && realm.key === realmKey) ?? null;
  }
  async createRealm(input: Parameters<IdentityRealmStore["createRealm"]>[0]) {
    const realm: IdentityRealmRecord = {
      id: input.id,
      workspaceId: input.workspaceId,
      key: input.key,
      name: input.name,
      kind: "content",
      status: "provisioning",
      authentication: input.authentication,
      revision: 1,
      createdAt: input.now,
      createdBy: input.actorIdentityId,
      updatedAt: input.now,
      updatedBy: input.actorIdentityId,
    };
    this.realms.set(realm.id, realm);
    return realm;
  }
  async updateRealm(input: Parameters<IdentityRealmStore["updateRealm"]>[0]) {
    const before = this.realms.get(input.realmId);
    if (before === undefined || before.revision !== input.expectedRevision) throw new Error("conflict");
    const realm: IdentityRealmRecord = {
      ...before,
      name: input.name,
      status: input.status,
      authentication: input.authentication,
      revision: before.revision + 1,
      updatedAt: input.now,
      updatedBy: input.actorIdentityId,
    };
    this.realms.set(realm.id, realm);
    return realm;
  }
  async listIdentities(workspaceId: string): Promise<readonly GlobalIdentityRecord[]> {
    return [...this.identities.values()].filter((identity) => identity.workspaceId === workspaceId);
  }
  async findIdentityById(identityId: string) { return this.identities.get(identityId) ?? null; }
  async findIdentityCredentialByIdentifier(workspaceId: string, normalizedIdentifier: string) {
    return [...this.identities.values()].find((identity) =>
      identity.workspaceId === workspaceId && identity.primaryIdentifier === normalizedIdentifier) ?? null;
  }
  async listMemberships(realmId: string) {
    return [...this.memberships.values()].filter((membership) => membership.realmId === realmId);
  }
  async findMembershipByIdentity(realmId: string, identityId: string) {
    return [...this.memberships.values()].find((membership) =>
      membership.realmId === realmId && membership.identityId === identityId) ?? null;
  }
  async findMembershipById(membershipId: string) { return this.memberships.get(membershipId) ?? null; }
  async isEligibleRealmOwner(input: Parameters<IdentityRealmStore["isEligibleRealmOwner"]>[0]) {
    const identity = this.identities.get(input.identityId);
    const contentMembership = await this.findMembershipByIdentity(input.realmId, input.identityId);
    const systemMembership = await this.findMembershipByIdentity("rlm_system", input.identityId);
    return identity !== undefined
      && identity.kind === "human"
      && identity.isOwner !== true
      && identity.disabledAt === undefined
      && contentMembership?.status === "active"
      && contentMembership.subjectId === input.subjectId
      && systemMembership?.status === "active";
  }
  async suspendMembership(input: Parameters<IdentityRealmStore["suspendMembership"]>[0]) {
    const suspended = this.changeMembership(
      input.realmId,
      input.membershipId,
      input.expectedRevision,
      "suspended",
      input.now,
    );
    for (const [tokenHash, session] of this.sessions) {
      if (session.membership.id === input.membershipId) this.sessions.delete(tokenHash);
    }
    return suspended;
  }
  async reactivateMembership(input: Parameters<IdentityRealmStore["reactivateMembership"]>[0]) {
    return this.changeMembership(input.realmId, input.membershipId, input.expectedRevision, "active", input.now);
  }
  async createContentSession(input: Parameters<IdentityRealmStore["createContentSession"]>[0]) {
    const identity = this.identities.get(input.identityId);
    const realm = this.realms.get(input.realmId);
    const membership = this.memberships.get(input.membershipId);
    if (identity === undefined || realm === undefined || membership === undefined) throw new Error("missing");
    this.sessions.set(input.tokenHash, {
      identity,
      realm,
      membership,
      expiresAt: input.expiresAt,
      authenticatedAt: input.authenticatedAt,
      csrf: input.csrfTokenHash,
    });
  }
  async findContentSession(tokenHash: string, realmId: string, now: string) {
    const session = this.sessions.get(tokenHash);
    const currentRealm = session === undefined ? undefined : this.realms.get(session.realm.id);
    const currentMembership = session === undefined
      ? undefined
      : this.memberships.get(session.membership.id);
    const currentIdentity = session === undefined
      ? undefined
      : this.identities.get(session.identity.id);
    if (
      session === undefined ||
      session.realm.id !== realmId ||
      currentRealm?.status !== "active" ||
      currentMembership?.status !== "active" ||
      currentIdentity === undefined ||
      currentIdentity.disabledAt !== undefined ||
      session.expiresAt <= now
    ) return null;
    return {
      ...session,
      identity: currentIdentity,
      realm: currentRealm,
      membership: currentMembership,
    };
  }
  async findContentSessionWithCsrf(tokenHash: string, csrfTokenHash: string, realmId: string, now: string) {
    const session = await this.findContentSession(tokenHash, realmId, now);
    return session !== null && this.sessions.get(tokenHash)?.csrf === csrfTokenHash;
  }
  async deleteContentSession(tokenHash: string, realmId: string) {
    if (this.sessions.get(tokenHash)?.realm.id === realmId) this.sessions.delete(tokenHash);
  }
  async revokeMembershipSessions(input: Parameters<IdentityRealmStore["revokeMembershipSessions"]>[0]) {
    let revoked = 0;
    for (const [tokenHash, session] of this.sessions) {
      if (session.realm.id === input.realmId && session.membership.id === input.membershipId) {
        this.sessions.delete(tokenHash);
        revoked += 1;
      }
    }
    return revoked;
  }
  async listFullAccessBindings(realmId: string, _now: string) {
    return [...this.fullAccess.values()].filter((binding) => binding.realmId === realmId);
  }
  async grantFullAccess(input: RealmFullAccessBindingRecord) {
    this.fullAccess.set(input.id, input);
    return input;
  }
  async revokeFullAccess(input: Parameters<IdentityRealmStore["revokeFullAccess"]>[0]) {
    const binding = this.fullAccess.get(input.bindingId);
    if (binding === undefined || binding.realmId !== input.realmId) throw new Error("missing");
    const revoked = { ...binding, revokedAt: input.now, revokedByIdentityId: input.actorIdentityId };
    this.fullAccess.set(binding.id, revoked);
    return revoked;
  }
  async findActiveFullAccessBinding(realmId: string, systemIdentityId: string, now: string) {
    return [...this.fullAccess.values()].find((binding) =>
      binding.realmId === realmId &&
      binding.systemIdentityId === systemIdentityId &&
      binding.revokedAt === undefined &&
      binding.validUntil > now) ?? null;
  }
  async hasActiveFullAccess(realmId: string, systemIdentityId: string, now: string) {
    return await this.findActiveFullAccessBinding(realmId, systemIdentityId, now) !== null;
  }
  async recordRealmAdministrationEvent(input: RealmAdministrationAuditRecord) {
    this.administrationEvents.push(input);
  }
  async createGlobalIdentity(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly originRealmId: string;
    readonly normalizedIdentifier: string;
    readonly displayIdentifier: string;
    readonly passwordHash: string;
    readonly now: string;
  }) {
    const existing = await this.findIdentityCredentialByIdentifier(
      input.workspaceId,
      input.normalizedIdentifier,
    );
    if (existing !== null) return existing;
    const identity: GlobalIdentityCredentialRecord = {
      id: input.id,
      workspaceId: input.workspaceId,
      kind: "human",
      primaryIdentifier: input.normalizedIdentifier,
      originRealmId: input.originRealmId,
      credentialVersion: 1,
      passwordHash: input.passwordHash,
    };
    this.identities.set(identity.id, identity);
    return identity;
  }
  async createPendingMembership(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly identityId: string;
    readonly realmId: string;
    readonly subjectId: string;
    readonly provisionedBy: RealmMembershipRecord["provisionedBy"];
    readonly createdByIdentityId: string;
    readonly now: string;
  }) {
    const existing = await this.findMembershipByIdentity(input.realmId, input.identityId);
    if (existing !== null) return existing;
    const membership: RealmMembershipRecord = {
      id: input.id,
      identityId: input.identityId,
      realmId: input.realmId,
      subjectId: input.subjectId,
      status: "pending",
      provisionedBy: input.provisionedBy,
      revision: 1,
      createdAt: input.now,
    };
    this.memberships.set(membership.id, membership);
    return membership;
  }
  async activateMembership(input: {
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly profileCollectionId: string;
    readonly profileDocumentId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }) {
    const before = this.memberships.get(input.membershipId);
    if (before === undefined || before.revision !== input.expectedRevision) throw new Error("conflict");
    const active: RealmMembershipRecord = {
      ...before,
      profileCollectionId: input.profileCollectionId,
      profileDocumentId: input.profileDocumentId,
      status: "active",
      revision: before.revision + 1,
      activatedAt: input.now,
    };
    this.memberships.set(active.id, active);
    return active;
  }

  private changeMembership(
    realmId: string,
    membershipId: string,
    expectedRevision: number,
    status: "active" | "suspended",
    now: string,
  ): RealmMembershipRecord {
    const before = this.memberships.get(membershipId);
    if (before === undefined || before.realmId !== realmId || before.revision !== expectedRevision) {
      throw new Error("conflict");
    }
    const after: RealmMembershipRecord = {
      ...before,
      status,
      revision: before.revision + 1,
      ...(status === "suspended" ? { suspendedAt: now } : { activatedAt: now }),
    };
    this.memberships.set(after.id, after);
    return after;
  }
}

function contentRealm(overrides: Partial<IdentityRealmRecord> = {}): IdentityRealmRecord {
  return {
    id: "rlm_community",
    workspaceId: WORKSPACE_ID,
    key: "community",
    name: "Community",
    kind: "content",
    status: "active",
    profileCollectionId: "col_members",
    authentication: {
      acceptSystemIdentities: true,
      provisioning: "jit",
      registration: "open",
      defaultRoleIds: [],
    },
    revision: 1,
    createdAt: NOW,
    createdBy: "usr_owner",
    updatedAt: NOW,
    updatedBy: "usr_owner",
    ...overrides,
  };
}

function systemIdentity(overrides: Partial<GlobalIdentityCredentialRecord> = {}): GlobalIdentityCredentialRecord {
  return {
    id: "usr_owner",
    workspaceId: WORKSPACE_ID,
    kind: "human",
    primaryIdentifier: "owner@example.com",
    originRealmId: "rlm_system",
    credentialVersion: 1,
    passwordHash: "hash:correct horse battery staple",
    ...overrides,
  };
}

function activeMembership(identityId = "usr_owner"): RealmMembershipRecord {
  return {
    id: `mbr_${identityId}`,
    identityId,
    realmId: "rlm_community",
    subjectId: `subject:${identityId}:community`,
    profileCollectionId: "col_members",
    profileDocumentId: `doc_${identityId}`,
    status: "active",
    provisionedBy: "jit",
    revision: 1,
    createdAt: NOW,
    activatedAt: NOW,
  };
}

const passwords = {
  hash: vi.fn(async (value: string) => `hash:${value}`),
  verify: vi.fn(async (value: string, hash: string) => hash === `hash:${value}`),
  verifyDummy: vi.fn(async () => undefined),
};

const runtime = {
  now: () => NOW,
  newRealmId: () => "rlm_new",
  newFullAccessId: () => "full_access_new",
  randomToken: () => "session-token",
  hashToken: (value: string) => `hashed:${value}`,
  deriveCsrfToken: (value: string) => `csrf:${value}`,
  verifyCsrfToken: (value: string, csrf: string) => csrf === `csrf:${value}`,
};

describe("M4-A Identity Realm", () => {
  it("normalizes stable Realm keys and identity identifiers", () => {
    expect(normalizeRealmKey("  My-Community ")).toBe("my-community");
    expect(normalizeIdentityIdentifier("  MEMBER@Example.COM ")).toBe("member@example.com");
    expect(() => normalizeRealmKey("system")).toThrow(/reserved/i);
  });

  it("creates a content Realm only through protected System administration", async () => {
    const store = new MemoryIdentityRealmStore();
    const service = new IdentityRealmApplicationService(store, runtime);
    const owner: ActorContext = {
      subjectId: "usr_owner",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    const realm = await service.createRealm(owner, {
      key: "Community",
      name: " Community ",
      acceptSystemIdentities: true,
      provisioning: "jit",
      registration: "open",
    });
    expect(realm).toMatchObject({ id: "rlm_new", key: "community", status: "provisioning" });

    await expect(service.createRealm({ ...owner, capabilities: [] }, {
      key: "another",
      name: "Another",
    })).rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
  });

  it("lists only Workspace-scoped public Global Identity fields for Realm administration", async () => {
    const store = new MemoryIdentityRealmStore();
    store.identities.set("usr_visible", systemIdentity({
      id: "usr_visible",
      primaryIdentifier: "visible@example.com",
      passwordHash: "hash:must-never-leave-the-store",
    }));
    store.identities.set("usr_other_workspace", systemIdentity({
      id: "usr_other_workspace",
      workspaceId: "wrk_other",
      primaryIdentifier: "other@example.com",
      passwordHash: "hash:also-private",
    }));
    const listIdentities = vi.spyOn(store, "listIdentities");
    const service = new IdentityRealmApplicationService(store, runtime);
    const operator: ActorContext = {
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    const identities = await service.listGlobalIdentities(operator);
    expect(listIdentities).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(identities).toEqual([{
      id: "usr_visible",
      workspaceId: WORKSPACE_ID,
      kind: "human",
      isOwner: false,
      primaryIdentifier: "visible@example.com",
      originRealmId: "rlm_system",
      credentialVersion: 1,
    }]);
    expect(identities[0]).not.toHaveProperty("passwordHash");
    await expect(service.listGlobalIdentities({ ...operator, capabilities: [] }))
      .rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
  });

  it("JIT provisions a System Identity without copying System authorization", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const identity = systemIdentity();
    store.realms.set(realm.id, realm);
    store.identities.set(identity.id, identity);
    const provisioner: RealmIdentityProvisioner = {
      register: vi.fn(),
      provisionExistingIdentity: vi.fn(async ({ identity: current }) => {
        const membership = activeMembership(current.id);
        store.memberships.set(membership.id, membership);
        return membership;
      }),
    };
    const service = new ContentRealmAuthenticationService(
      store,
      passwords,
      provisioner,
      runtime,
      WORKSPACE_ID,
    );
    const session = await service.login({
      realmKey: "community",
      identifier: "OWNER@example.com",
      password: "correct horse battery staple",
      jitProfile: { displayName: "Owner as member" },
    });
    expect(session.membership.subjectId).toBe("subject:usr_owner:community");
    expect(session.membership.subjectId).not.toBe(identity.id);
    expect(provisioner.provisionExistingIdentity).toHaveBeenCalledWith(expect.objectContaining({
      method: "jit",
    }));
    expect((await service.authenticate({
      realmKey: "community",
      sessionToken: "session-token",
    })).membership.id).toBe("mbr_usr_owner");
  });

  it("resumes an interrupted same-credential signup without treating identifier equality as linking", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const identity = systemIdentity({
      id: "usr_interrupted_signup",
      primaryIdentifier: "member@example.com",
      originRealmId: realm.id,
      passwordHash: "hash:correct horse battery staple",
    });
    const pending: RealmMembershipRecord = {
      id: `mbr_${identity.id}`,
      identityId: identity.id,
      realmId: realm.id,
      subjectId: `subject:${identity.id}:community`,
      status: "pending",
      provisionedBy: "signup",
      revision: 1,
      createdAt: NOW,
    };
    store.realms.set(realm.id, realm);
    store.identities.set(identity.id, identity);
    store.memberships.set(pending.id, pending);
    const provisionExistingIdentity = vi.fn(async () => {
      const active = { ...activeMembership(identity.id), provisionedBy: "signup" as const };
      store.memberships.set(active.id, active);
      return active;
    });
    const service = new ContentRealmAuthenticationService(
      store,
      passwords,
      { register: vi.fn(), provisionExistingIdentity },
      runtime,
      WORKSPACE_ID,
    );

    const resumed = await service.signup({
      realmKey: realm.key,
      identifier: "MEMBER@example.com",
      password: "correct horse battery staple",
      profile: { displayName: "Member" },
    });
    expect(resumed.membership.status).toBe("active");
    expect(provisionExistingIdentity).toHaveBeenCalledWith(expect.objectContaining({
      identity,
      method: "signup",
    }));

    provisionExistingIdentity.mockClear();
    await expect(service.signup({
      realmKey: realm.key,
      identifier: "member@example.com",
      password: "different secure password",
      profile: {},
    })).rejects.toMatchObject({ code: "IDENTITY_IDENTIFIER_CONFLICT", status: 409 });
    expect(provisionExistingIdentity).not.toHaveBeenCalled();
  });

  it("explicitly provisions the target Global Identity without confusing it with the operator Subject", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm({
      authentication: {
        acceptSystemIdentities: true,
        provisioning: "explicit",
        registration: "closed",
        defaultRoleIds: [],
      },
    });
    const target = systemIdentity({
      id: "usr_target_member",
      primaryIdentifier: "target@example.com",
    });
    store.realms.set(realm.id, realm);
    store.identities.set(target.id, target);
    const provisionExistingIdentity = vi.fn(async ({ identity }: {
      readonly identity: GlobalIdentityRecord;
    }) => {
      const membership: RealmMembershipRecord = {
        ...activeMembership(identity.id),
        provisionedBy: "explicit",
      };
      store.memberships.set(membership.id, membership);
      return membership;
    });
    const service = new IdentityRealmApplicationService(store, runtime, {
      register: vi.fn(),
      provisionExistingIdentity,
    });
    const operator: ActorContext = {
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      realmId: "rlm_system",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    const provisioned = await service.provisionMembership(operator, {
      realmId: realm.id,
      identityId: target.id,
      profile: { displayName: "Target member" },
      reauthenticatedAt: NOW,
    });
    expect(provisioned).toMatchObject({
      identityId: target.id,
      subjectId: "subject:usr_target_member:community",
      provisionedBy: "explicit",
    });
    expect(provisioned.subjectId).not.toBe(target.id);
    expect(provisioned.subjectId).not.toBe(operator.subjectId);
    expect(provisionExistingIdentity).toHaveBeenCalledWith({
      realm,
      identity: target,
      method: "explicit",
      profile: { displayName: "Target member" },
      now: NOW,
    });
    await expect(service.provisionMembership(operator, {
      realmId: realm.id,
      identityId: target.id,
      profile: { displayName: "A duplicate request must not rewrite the profile" },
      reauthenticatedAt: NOW,
    })).resolves.toBe(provisioned);
    expect(provisionExistingIdentity).toHaveBeenCalledTimes(1);
  });

  it("registers a brand-new user, hashing the initial password before the saga", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm({
      authentication: {
        acceptSystemIdentities: false,
        provisioning: "explicit",
        registration: "closed",
        defaultRoleIds: [],
      },
    });
    store.realms.set(realm.id, realm);
    const register = vi.fn<RealmIdentityProvisioner["register"]>(
      async () => activeMembership("usr_new_member"),
    );
    const service = new IdentityRealmApplicationService(
      store,
      runtime,
      { register, provisionExistingIdentity: vi.fn() },
      { hash: vi.fn(async (password: string) => `hashed:${password}`) } as never,
    );
    const operator: ActorContext = {
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      realmId: "rlm_system",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };

    await service.registerMembership(operator, {
      realmId: realm.id,
      identifier: "New.User@Example.com",
      password: "sufficiently-long-pw",
      profile: { displayName: "New user" },
      reauthenticatedAt: NOW,
    });

    expect(register).toHaveBeenCalledTimes(1);
    const call = register.mock.calls[0]?.[0];
    // Identifier is normalized, password is hashed (never passed in the clear).
    expect(call).toMatchObject({
      realm,
      normalizedIdentifier: "new.user@example.com",
      passwordHash: "hashed:sufficiently-long-pw",
      profile: { displayName: "New user" },
    });
  });

  it("rejects a too-short initial password before creating any identity", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    store.realms.set(realm.id, realm);
    const register = vi.fn();
    const service = new IdentityRealmApplicationService(
      store,
      runtime,
      { register, provisionExistingIdentity: vi.fn() },
      { hash: vi.fn() } as never,
    );
    const operator: ActorContext = {
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      realmId: "rlm_system",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };

    await expect(service.registerMembership(operator, {
      realmId: realm.id,
      identifier: "short@example.com",
      password: "short",
      profile: {},
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    // No identity or membership is created when the password is rejected.
    expect(register).not.toHaveBeenCalled();
  });

  it("returns an already active explicit Membership idempotently", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const target = systemIdentity({ id: "usr_existing_member" });
    const membership: RealmMembershipRecord = {
      ...activeMembership(target.id),
      provisionedBy: "explicit",
    };
    store.realms.set(realm.id, realm);
    store.identities.set(target.id, target);
    store.memberships.set(membership.id, membership);
    const provisionExistingIdentity = vi.fn(async () => membership);
    const service = new IdentityRealmApplicationService(store, runtime, {
      register: vi.fn(),
      provisionExistingIdentity,
    });
    const operator: ActorContext = {
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    await expect(service.provisionMembership(operator, {
      realmId: realm.id,
      identityId: target.id,
      profile: { ignoredForExisting: true },
      reauthenticatedAt: NOW,
    })).resolves.toBe(membership);
    expect(provisionExistingIdentity).not.toHaveBeenCalled();
  });

  it("fails explicit provisioning closed at every Realm and Identity boundary", async () => {
    const operator: ActorContext = {
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    interface DenialCase {
      readonly label: string;
      readonly realm: IdentityRealmRecord;
      readonly identity?: GlobalIdentityCredentialRecord;
      readonly actor?: ActorContext;
      readonly reauthenticatedAt?: string;
      readonly injectProvisioner?: boolean;
      readonly membership?: RealmMembershipRecord;
      readonly code: string;
      readonly status: number;
    }
    const cases: readonly DenialCase[] = [
      {
        label: "missing management permission",
        realm: contentRealm(),
        identity: systemIdentity(),
        actor: { ...operator, capabilities: [] },
        code: "ACCESS_DENIED",
        status: 403,
      },
      {
        label: "Content Realm actor",
        realm: contentRealm(),
        identity: systemIdentity(),
        actor: { ...operator, realmId: "rlm_community" },
        code: "SYSTEM_REALM_ACTOR_REQUIRED",
        status: 403,
      },
      {
        label: "stale reauthentication",
        realm: contentRealm(),
        identity: systemIdentity(),
        reauthenticatedAt: "2026-07-14T23:00:00.000Z",
        code: "RECENT_REAUTHENTICATION_REQUIRED",
        status: 403,
      },
      {
        label: "inactive Realm",
        realm: contentRealm({ status: "disabled" }),
        identity: systemIdentity(),
        code: "CONTENT_REALM_NOT_ACTIVE",
        status: 409,
      },
      {
        label: "System Identities rejected",
        realm: contentRealm({
          authentication: {
            acceptSystemIdentities: false,
            provisioning: "explicit",
            registration: "closed",
            defaultRoleIds: [],
          },
        }),
        identity: systemIdentity(),
        code: "SYSTEM_IDENTITY_PROVISIONING_DISABLED",
        status: 409,
      },
      {
        label: "cross-Workspace Identity",
        realm: contentRealm(),
        identity: systemIdentity({ workspaceId: "wrk_other" }),
        code: "GLOBAL_IDENTITY_NOT_FOUND",
        status: 404,
      },
      {
        label: "disabled Identity",
        realm: contentRealm(),
        identity: systemIdentity({ disabledAt: NOW }),
        code: "GLOBAL_IDENTITY_DISABLED",
        status: 409,
      },
      {
        label: "unverified cross-Realm account link",
        realm: contentRealm(),
        identity: systemIdentity({ originRealmId: "rlm_other_content" }),
        code: "IDENTITY_ACCOUNT_LINK_REQUIRED",
        status: 409,
      },
      {
        label: "suspended existing Membership",
        realm: contentRealm(),
        identity: systemIdentity(),
        membership: {
          ...activeMembership(),
          status: "suspended",
          suspendedAt: NOW,
        },
        code: "REALM_MEMBERSHIP_SUSPENDED",
        status: 403,
      },
      {
        label: "missing production provisioner",
        realm: contentRealm(),
        identity: systemIdentity(),
        injectProvisioner: false,
        code: "IDENTITY_PROVISIONER_UNAVAILABLE",
        status: 503,
      },
    ];

    for (const denial of cases) {
      const store = new MemoryIdentityRealmStore();
      store.realms.set(denial.realm.id, denial.realm);
      if (denial.identity !== undefined) store.identities.set(denial.identity.id, denial.identity);
      if (denial.membership !== undefined) store.memberships.set(denial.membership.id, denial.membership);
      const provisionExistingIdentity = vi.fn(async () => activeMembership());
      const service = new IdentityRealmApplicationService(
        store,
        runtime,
        denial.injectProvisioner === false
          ? undefined
          : { register: vi.fn(), provisionExistingIdentity },
      );
      await expect(service.provisionMembership(denial.actor ?? operator, {
        realmId: denial.realm.id,
        identityId: denial.identity?.id ?? "usr_missing",
        profile: {},
        reauthenticatedAt: denial.reauthenticatedAt ?? NOW,
      }), denial.label).rejects.toMatchObject({ code: denial.code, status: denial.status });
      expect(provisionExistingIdentity, denial.label).not.toHaveBeenCalled();
    }
  });

  it("keeps Membership pending until Subject and Profile provisioning complete", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    store.realms.set(realm.id, realm);
    const ensureIdentitySubject = vi.fn(async () => undefined);
    const ensureDefaultRoles = vi.fn(async () => undefined);
    const createProfile = vi.fn(async () => ({
      collectionId: "col_members",
      documentId: "doc_new_profile",
    }));
    const provisioner = new DurableRealmIdentityProvisioner(
      store,
      { ensureIdentitySubject, ensureDefaultRoles },
      { createProfile },
      {
        now: () => NOW,
        newIdentityId: () => "usr_new",
        newMembershipId: () => "mbr_new",
        newSubjectId: (realmId, identityId) => `subject:${realmId}:${identityId}`,
      },
    );
    const membership = await provisioner.register({
      realm,
      normalizedIdentifier: "new@example.com",
      displayIdentifier: "new@example.com",
      passwordHash: "hash:very secure password",
      profile: { displayName: "New member" },
      now: NOW,
    });
    expect(ensureIdentitySubject).toHaveBeenCalledBefore(createProfile);
    expect(membership).toMatchObject({
      id: "mbr_new",
      status: "active",
      profileDocumentId: "doc_new_profile",
      subjectId: "subject:rlm_community:usr_new",
    });
    expect(ensureDefaultRoles).toHaveBeenCalledAfter(createProfile);
  });

  it("returns one authentication failure when explicit membership is missing", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm({
      authentication: {
        acceptSystemIdentities: true,
        provisioning: "explicit",
        registration: "closed",
        defaultRoleIds: [],
      },
    });
    const identity = systemIdentity();
    store.realms.set(realm.id, realm);
    store.identities.set(identity.id, identity);
    const service = new ContentRealmAuthenticationService(
      store,
      passwords,
      { register: vi.fn(), provisionExistingIdentity: vi.fn() },
      runtime,
      WORKSPACE_ID,
    );
    await expect(service.login({
      realmKey: realm.key,
      identifier: identity.primaryIdentifier,
      password: "correct horse battery staple",
    })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED", status: 401 });
  });

  it("grants System Identity Full Access without a Realm Membership after recent reauthentication", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    store.realms.set(realm.id, realm);
    const service = new IdentityRealmApplicationService(store, runtime);
    const owner: ActorContext = {
      subjectId: "subject_system_owner",
      identityId: "usr_owner",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    const granted = await service.grantFullAccess(owner, {
      realmId: realm.id,
      reason: " Initial realm recovery ",
      reauthenticatedAt: NOW,
      validUntil: "2026-07-15T00:30:00.000Z",
    });
    expect(granted).toMatchObject({
      id: "full_access_new",
      realmId: realm.id,
      systemIdentityId: "usr_owner",
      grantedByIdentityId: "usr_owner",
      reason: "Initial realm recovery",
      validUntil: "2026-07-15T00:30:00.000Z",
    });
    await expect(service.grantFullAccess(owner, {
      realmId: realm.id,
      reason: "stale proof",
      reauthenticatedAt: "2026-07-14T23:00:00.000Z",
      validUntil: "2026-07-15T00:30:00.000Z",
    })).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED", status: 403 });
    await expect(service.grantFullAccess(owner, {
      realmId: realm.id,
      reason: "excessive window",
      reauthenticatedAt: NOW,
      validUntil: "2026-07-15T04:00:00.001Z",
    })).rejects.toMatchObject({ code: "IDENTITY_REALM_INPUT_INVALID", status: 422 });
  });

  it("blocks ordinary suspension of the current Primary Realm Owner", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const currentOwnerIdentity = systemIdentity({
      id: "usr_realm_owner",
      primaryIdentifier: "realm-owner@example.com",
    });
    const currentOwnerMembership = activeMembership(currentOwnerIdentity.id);
    store.realms.set(realm.id, realm);
    store.identities.set(currentOwnerIdentity.id, currentOwnerIdentity);
    store.memberships.set(currentOwnerMembership.id, currentOwnerMembership);
    const owner = {
      state: "assigned" as const,
      realmId: realm.id,
      policyRevision: 4,
      bindingId: `authorization:${realm.id}:binding:primary-owner`,
      subjectId: currentOwnerMembership.subjectId,
      identityId: currentOwnerIdentity.id,
      issues: [],
    };
    const owners = {
      getPrimaryOwner: vi.fn(async () => owner),
      setPrimaryOwner: vi.fn(async () => owner),
    } satisfies RealmOwnerCoordinator;
    const service = new IdentityRealmApplicationService(
      store,
      runtime,
      undefined,
      undefined,
      owners,
    );

    await expect(service.suspendMembership({
      subjectId: "subject_system_operator",
      identityId: "usr_system_operator",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    }, {
      realmId: realm.id,
      membershipId: currentOwnerMembership.id,
      expectedRevision: currentOwnerMembership.revision,
    })).rejects.toMatchObject({
      code: "REALM_PRIMARY_OWNER_MEMBERSHIP_SUSPENSION_FORBIDDEN",
      status: 409,
    });
    expect(store.memberships.get(currentOwnerMembership.id)?.status).toBe("active");
  });

  it("applies and audits previous-Owner suspension after the Owner CAS transfer", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const previousIdentity = systemIdentity({
      id: "usr_previous_owner",
      primaryIdentifier: "previous-owner@example.com",
    });
    const targetIdentity = systemIdentity({
      id: "usr_next_owner",
      primaryIdentifier: "next-owner@example.com",
    });
    const previousMembership = activeMembership(previousIdentity.id);
    const targetMembership = activeMembership(targetIdentity.id);
    const targetSystemMembership: RealmMembershipRecord = {
      ...targetMembership,
      id: "mbr_system_next_owner",
      realmId: "rlm_system",
      subjectId: "subject:usr_next_owner:system",
    };
    store.realms.set(realm.id, realm);
    store.identities.set(previousIdentity.id, previousIdentity);
    store.identities.set(targetIdentity.id, targetIdentity);
    store.memberships.set(previousMembership.id, previousMembership);
    store.memberships.set(targetMembership.id, targetMembership);
    store.memberships.set(targetSystemMembership.id, targetSystemMembership);
    store.sessions.set("previous-owner-session", {
      identity: previousIdentity,
      realm,
      membership: previousMembership,
      expiresAt: "2026-07-15T08:00:00.000Z",
      authenticatedAt: NOW,
      csrf: "previous-owner-csrf",
    });
    const before = {
      state: "assigned" as const,
      realmId: realm.id,
      policyRevision: 7,
      bindingId: `authorization:${realm.id}:binding:primary-owner`,
      subjectId: previousMembership.subjectId,
      identityId: previousIdentity.id,
      issues: [],
    };
    const changed = {
      ...before,
      policyRevision: 8,
      subjectId: targetMembership.subjectId,
      identityId: targetIdentity.id,
    };
    const owners = {
      getPrimaryOwner: vi.fn(async () => before),
      setPrimaryOwner: vi.fn(async () => changed),
    } satisfies RealmOwnerCoordinator;
    const service = new IdentityRealmApplicationService(
      store,
      runtime,
      undefined,
      undefined,
      owners,
    );

    await expect(service.transferOwner({
      subjectId: "subject_cms_owner",
      identityId: "usr_cms_owner",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    }, {
      realmId: realm.id,
      targetMembershipId: targetMembership.id,
      expectedPolicyRevision: before.policyRevision,
      reason: "Primary owner handoff",
      reauthenticatedAt: NOW,
      suspendPreviousMembership: true,
    })).resolves.toMatchObject({
      status: "healthy",
      policyRevision: 8,
      owner: { membershipId: targetMembership.id },
    });

    expect(owners.setPrimaryOwner).toHaveBeenCalledOnce();
    expect(store.memberships.get(previousMembership.id)).toMatchObject({
      status: "suspended",
      revision: 2,
    });
    expect(store.sessions.has("previous-owner-session")).toBe(false);
    expect(store.administrationEvents).toContainEqual(expect.objectContaining({
      event: "REALM_OWNER_REPLACED",
      result: "success",
      details: expect.objectContaining({
        previousOwnerCleanup: expect.objectContaining({
          requested: {
            revokePreviousSessions: false,
            suspendPreviousMembership: true,
          },
          outcome: "completed",
          membershipSuspended: true,
          sessionsCleared: true,
        }),
      }),
    }));
  });

  it("revokes previous-Owner sessions without suspending Membership when requested", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const previousIdentity = systemIdentity({ id: "usr_previous_active_owner" });
    const targetIdentity = systemIdentity({ id: "usr_next_active_owner" });
    const previousMembership = activeMembership(previousIdentity.id);
    const targetMembership = activeMembership(targetIdentity.id);
    const targetSystemMembership: RealmMembershipRecord = {
      ...targetMembership,
      id: "mbr_system_next_active_owner",
      realmId: "rlm_system",
      subjectId: "subject:usr_next_active_owner:system",
    };
    for (const identity of [previousIdentity, targetIdentity]) store.identities.set(identity.id, identity);
    for (const membership of [previousMembership, targetMembership, targetSystemMembership]) {
      store.memberships.set(membership.id, membership);
    }
    store.realms.set(realm.id, realm);
    store.sessions.set("previous-active-owner-session", {
      identity: previousIdentity,
      realm,
      membership: previousMembership,
      expiresAt: "2026-07-15T08:00:00.000Z",
      authenticatedAt: NOW,
      csrf: "previous-active-owner-csrf",
    });
    const before = {
      state: "assigned" as const,
      realmId: realm.id,
      policyRevision: 11,
      bindingId: `authorization:${realm.id}:binding:primary-owner`,
      subjectId: previousMembership.subjectId,
      identityId: previousIdentity.id,
      issues: [],
    };
    const owners = {
      getPrimaryOwner: vi.fn(async () => before),
      setPrimaryOwner: vi.fn(async () => ({
        ...before,
        policyRevision: 12,
        subjectId: targetMembership.subjectId,
        identityId: targetIdentity.id,
      })),
    } satisfies RealmOwnerCoordinator;
    const service = new IdentityRealmApplicationService(
      store,
      runtime,
      undefined,
      undefined,
      owners,
    );

    await service.transferOwner({
      subjectId: "subject_cms_owner",
      identityId: "usr_cms_owner",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    }, {
      realmId: realm.id,
      targetMembershipId: targetMembership.id,
      expectedPolicyRevision: before.policyRevision,
      reason: "Keep former owner as a member",
      reauthenticatedAt: NOW,
      revokePreviousSessions: true,
    });

    expect(store.memberships.get(previousMembership.id)?.status).toBe("active");
    expect(store.sessions.has("previous-active-owner-session")).toBe(false);
    expect(store.administrationEvents.at(-1)).toMatchObject({
      details: {
        previousOwnerCleanup: {
          outcome: "completed",
          membershipSuspended: false,
          sessionsCleared: true,
          revokedSessions: 1,
        },
      },
    });
  });

  it("invalidates an existing content session as soon as its Membership is suspended", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const identity = systemIdentity();
    const membership = activeMembership();
    store.realms.set(realm.id, realm);
    store.identities.set(identity.id, identity);
    store.memberships.set(membership.id, membership);
    const service = new ContentRealmAuthenticationService(
      store,
      passwords,
      { register: vi.fn(), provisionExistingIdentity: vi.fn() },
      runtime,
      WORKSPACE_ID,
    );
    await service.login({
      realmKey: realm.key,
      identifier: identity.primaryIdentifier,
      password: "correct horse battery staple",
    });
    await store.suspendMembership({
      realmId: realm.id,
      membershipId: membership.id,
      expectedRevision: membership.revision,
      actorIdentityId: "usr_owner",
      now: NOW,
    });
    await expect(service.authenticate({
      realmKey: realm.key,
      sessionToken: "session-token",
    })).rejects.toMatchObject({ code: "CONTENT_SESSION_INVALID", status: 401 });
  });
});

describe("M4 realm collection entitlement management (CMS Owner)", () => {
  const cmsOwner: ActorContext = {
    subjectId: "subject_cms_owner",
    identityId: "usr_cms_owner",
    realmId: "rlm_system",
    workspaceId: WORKSPACE_ID,
    capabilities: ["schema:apply"],
  };

  function setup() {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    store.realms.set(realm.id, realm);
    const entitlements = new InMemoryRealmCollectionEntitlementStore();
    const service = new IdentityRealmApplicationService(
      store,
      runtime,
      undefined,
      undefined,
      undefined,
      entitlements,
    );
    return { store, realm, entitlements, service };
  }

  it("rejects entitlement management from an actor without administration capability", async () => {
    const { service, realm } = setup();
    const outsider: ActorContext = { ...cmsOwner, capabilities: [] };
    await expect(service.listRealmEntitlements(outsider, realm.id))
      .rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
    await expect(service.putRealmEntitlement(outsider, {
      realmId: realm.id,
      collectionId: "col_articles",
      actions: ["read"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
  });

  it("creates an entitlement, normalizes actions, and records an audit event", async () => {
    const { service, store, realm } = setup();
    const saved = await service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      // Deliberately out of canonical order + duplicate to prove normalization.
      actions: ["update", "read", "read"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    });
    expect(saved.actions).toEqual(["read", "update"]);
    expect(saved.workspaceId).toBe(WORKSPACE_ID);
    expect(saved.revision).toBe(1);
    expect(saved.updatedBy).toBe("usr_cms_owner");

    const listed = await service.listRealmEntitlements(cmsOwner, realm.id);
    expect(listed.entitlements).toHaveLength(1);
    expect(listed.entitlements[0]?.collectionId).toBe("col_articles");

    const event = store.administrationEvents.at(-1);
    expect(event?.event).toBe("REALM_COLLECTION_ENTITLEMENT_UPDATED");
    expect(event?.operation).toBe("create");
    expect(event?.targetId).toBe("col_articles");
  });

  it("rejects unknown actions before writing anything", async () => {
    const { service, realm, entitlements } = setup();
    await expect(service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      actions: ["read", "teleport"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "IDENTITY_REALM_INPUT_INVALID", status: 422 });
    expect(await entitlements.listByRealm(realm.id)).toHaveLength(0);
  });

  it("enforces writableFields ⊆ readableFields (no blind writes)", async () => {
    const { service, realm } = setup();
    await expect(service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      actions: ["read", "update"],
      readableFields: ["title"],
      writableFields: ["title", "body"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "ENTITLEMENT_FIELD_INVALID", status: 422 });
  });

  it("requires recent reauthentication for writes", async () => {
    const { service, realm } = setup();
    await expect(service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      actions: ["read"],
      expectedRevision: null,
      reauthenticatedAt: "2026-07-14T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED" });
  });

  it("drops an entitlement and records a removal audit event", async () => {
    const { service, store, realm, entitlements } = setup();
    const saved = await service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      actions: ["read"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    });
    await service.deleteRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      expectedRevision: saved.revision,
      reauthenticatedAt: NOW,
    });
    expect(await entitlements.listByRealm(realm.id)).toHaveLength(0);
    expect(store.administrationEvents.at(-1)?.event)
      .toBe("REALM_COLLECTION_ENTITLEMENT_REMOVED");
  });

  it("lists entitlements in reverse by collection across realms", async () => {
    const { service, store, realm, entitlements } = setup();
    const other = contentRealm({ id: "rlm_blog", key: "blog", name: "Blog" });
    store.realms.set(other.id, other);
    await service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_articles",
      actions: ["read"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    });
    await service.putRealmEntitlement(cmsOwner, {
      realmId: other.id,
      collectionId: "col_articles",
      actions: ["read", "create"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    });
    void entitlements;
    const reverse = await service.listCollectionEntitlements(cmsOwner, "col_articles");
    expect(reverse.map((e) => e.realmId).sort()).toEqual(["rlm_blog", "rlm_community"]);
  });

  it("fails closed when the entitlement store is not configured", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    store.realms.set(realm.id, realm);
    const service = new IdentityRealmApplicationService(store, runtime);
    await expect(service.listRealmEntitlements(cmsOwner, realm.id))
      .rejects.toMatchObject({ code: "ENTITLEMENT_STORE_UNAVAILABLE", status: 500 });
  });

  it("refuses to expose another realm's Auth collection through a ceiling", async () => {
    const { service, store, realm } = setup();
    // A second realm whose Auth (profile) collection is col_portal_auth.
    const other = contentRealm({ id: "rlm_portal", key: "portal", name: "Portal", profileCollectionId: "col_portal_auth" });
    store.realms.set(other.id, other);
    // Trying to grant realm (rlm_community) a ceiling on the portal's Auth collection is rejected.
    await expect(service.putRealmEntitlement(cmsOwner, {
      realmId: realm.id,
      collectionId: "col_portal_auth",
      actions: ["read"],
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "ENTITLEMENT_FOREIGN_AUTH_COLLECTION", status: 422 });
  });
});

describe("M4 realm management delegation (CMS Owner)", () => {
  const cmsOwner: ActorContext = {
    subjectId: "subject_cms_owner",
    identityId: "usr_cms_owner",
    realmId: "rlm_system",
    workspaceId: WORKSPACE_ID,
    capabilities: ["schema:apply"],
  };

  function setup() {
    const store = new MemoryIdentityRealmStore();
    const managing = contentRealm({ id: "rlm_admin", key: "admin", name: "관리자전산" });
    const managed = contentRealm({ id: "rlm_portal", key: "portal", name: "업무포탈" });
    store.realms.set(managing.id, managing);
    store.realms.set(managed.id, managed);
    const delegations = new InMemoryRealmManagementDelegationStore();
    const service = new IdentityRealmApplicationService(
      store, runtime, undefined, undefined, undefined, undefined, delegations,
    );
    return { store, managing, managed, delegations, service };
  }

  it("rejects delegation management from a non-administration actor", async () => {
    const { service, managing, managed } = setup();
    const outsider: ActorContext = { ...cmsOwner, capabilities: [] };
    await expect(service.listRealmDelegations(outsider, managing.id))
      .rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
    await expect(service.putRealmDelegation(outsider, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      actions: ["identity.credentials.reset"],
      scopeByAction: {},
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
  });

  it("creates a delegation, defaults scope to all, and records an audit event", async () => {
    const { service, store, managing, managed } = setup();
    const saved = await service.putRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      actions: ["identity.credentials.reset", "identity.disable"],
      scopeByAction: { "identity.credentials.reset": "any" },
      expectedRevision: null,
      reauthenticatedAt: NOW,
    });
    // Explicit rule kept; the other action defaults to the stricter "all".
    expect(saved.scopeByAction).toEqual({
      "identity.credentials.reset": "any",
      "identity.disable": "all",
    });
    expect(saved.revision).toBe(1);

    const listed = await service.listRealmDelegations(cmsOwner, managing.id);
    expect(listed).toHaveLength(1);
    const reverse = await service.listManagedByDelegations(cmsOwner, managed.id);
    expect(reverse.map((d) => d.managingRealmId)).toEqual(["rlm_admin"]);

    const event = store.administrationEvents.at(-1);
    expect(event?.event).toBe("REALM_MANAGEMENT_DELEGATION_UPDATED");
    expect(event?.operation).toBe("create");
    expect(event?.targetId).toBe("rlm_portal");
  });

  it("rejects a self-delegation", async () => {
    const { service, managing } = setup();
    await expect(service.putRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managing.id,
      actions: ["identity.disable"],
      scopeByAction: {},
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects unknown actions and dangling scope keys", async () => {
    const { service, managing, managed } = setup();
    await expect(service.putRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      actions: ["identity.teleport"],
      scopeByAction: {},
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ code: "IDENTITY_REALM_INPUT_INVALID", status: 422 });
    await expect(service.putRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      actions: ["identity.disable"],
      scopeByAction: { "identity.credentials.reset": "any" },
      expectedRevision: null,
      reauthenticatedAt: NOW,
    })).rejects.toMatchObject({ status: 422 });
  });

  it("requires recent reauthentication", async () => {
    const { service, managing, managed } = setup();
    await expect(service.putRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      actions: ["identity.disable"],
      scopeByAction: {},
      expectedRevision: null,
      reauthenticatedAt: "2026-07-14T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED" });
  });

  it("removes a delegation and records a removal audit event", async () => {
    const { service, store, managing, managed, delegations } = setup();
    const saved = await service.putRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      actions: ["identity.disable"],
      scopeByAction: {},
      expectedRevision: null,
      reauthenticatedAt: NOW,
    });
    await service.deleteRealmDelegation(cmsOwner, {
      managingRealmId: managing.id,
      managedRealmId: managed.id,
      expectedRevision: saved.revision,
      reauthenticatedAt: NOW,
    });
    expect(await delegations.listByManagingRealm(managing.id)).toHaveLength(0);
    expect(store.administrationEvents.at(-1)?.event).toBe("REALM_MANAGEMENT_DELEGATION_REMOVED");
  });

  it("fails closed when the delegation store is not configured", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    store.realms.set(realm.id, realm);
    const service = new IdentityRealmApplicationService(store, runtime);
    await expect(service.listRealmDelegations(cmsOwner, realm.id))
      .rejects.toMatchObject({ code: "MANAGEMENT_DELEGATION_STORE_UNAVAILABLE", status: 500 });
  });
});
