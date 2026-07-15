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
  type RealmIdentityProvisioner,
  type RealmMembershipRecord,
} from "./identity-realms.js";

const NOW = "2026-07-15T00:00:00.000Z";
const WORKSPACE_ID = "wrk_default";

class MemoryIdentityRealmStore implements IdentityRealmStore {
  readonly realms = new Map<string, IdentityRealmRecord>();
  readonly identities = new Map<string, GlobalIdentityCredentialRecord>();
  readonly memberships = new Map<string, RealmMembershipRecord>();
  readonly sessions = new Map<string, ContentRealmSessionRecord & { readonly csrf: string }>();
  readonly fullAccess = new Map<string, RealmFullAccessBindingRecord>();

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
  async suspendMembership(input: Parameters<IdentityRealmStore["suspendMembership"]>[0]) {
    return this.changeMembership(input.realmId, input.membershipId, input.expectedRevision, "suspended", input.now);
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
  async listFullAccessBindings(realmId: string) {
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
  async hasActiveFullAccess(realmId: string, subjectId: string, now: string) {
    return [...this.fullAccess.values()].some((binding) =>
      binding.realmId === realmId &&
      binding.subjectId === subjectId &&
      binding.revokedAt === undefined &&
      (binding.validUntil === undefined || binding.validUntil > now));
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

  it("grants Full Access only to an active Content Membership with recent reauthentication", async () => {
    const store = new MemoryIdentityRealmStore();
    const realm = contentRealm();
    const membership = activeMembership();
    store.realms.set(realm.id, realm);
    store.memberships.set(membership.id, membership);
    const service = new IdentityRealmApplicationService(store, runtime);
    const owner: ActorContext = {
      subjectId: "subject_system_owner",
      identityId: "usr_owner",
      workspaceId: WORKSPACE_ID,
      capabilities: ["schema:apply"],
    };
    const granted = await service.grantFullAccess(owner, {
      realmId: realm.id,
      subjectId: membership.subjectId,
      reason: " Initial realm recovery ",
      reauthenticatedAt: NOW,
    });
    expect(granted).toMatchObject({
      id: "full_access_new",
      realmId: realm.id,
      grantedByIdentityId: "usr_owner",
      reason: "Initial realm recovery",
    });
    await expect(service.grantFullAccess(owner, {
      realmId: realm.id,
      subjectId: membership.subjectId,
      reason: "stale proof",
      reauthenticatedAt: "2026-07-14T23:00:00.000Z",
    })).rejects.toMatchObject({ code: "RECENT_REAUTHENTICATION_REQUIRED", status: 403 });
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
