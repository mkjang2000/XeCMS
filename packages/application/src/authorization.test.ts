import { describe, expect, it } from "vitest";
import {
  AuthorizationApplicationService,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_CONTENT_RESOURCE_ID,
  SYSTEM_PUBLIC_SUBJECT_ID,
  SYSTEM_SCHEMA_RESOURCE_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  applyPolicyMutation,
  collectionResourceId,
  createInitialAuthorizationPolicy,
  documentResourceId,
  realmCollectionResourceId,
  realmDocumentResourceId,
  type AuthorizationActor,
  type AuthorizationAuditDraft,
  type AuthorizationAuditPage,
  type AuthorizationAuditRecord,
  type AuthorizationPolicyMutation,
  type AuthorizationPolicySeed,
  type AuthorizationPolicyState,
  type AuthorizationRoleRecord,
  type AuthorizationRuntime,
  type AuthorizationStore,
  type NewAuthorizationSubjectRecord,
} from "./authorization.js";
import { InMemoryRealmCollectionEntitlementStore } from "./realm-collection-entitlements.js";

const NOW = "2026-07-15T12:00:00.000Z";
const OWNER_ID = "subject:owner";
const REALM_ID = SYSTEM_AUTHORIZATION_REALM_ID;
const OWNER: AuthorizationActor = { subjectId: OWNER_ID, realmId: REALM_ID };

type Assert<TValue extends true> = TValue;
type _OrdinarySubjectCreateDoesNotExposeIdentityId = Assert<
  "identityId" extends keyof NewAuthorizationSubjectRecord ? false : true
>;

class MemoryAuthorizationStore implements AuthorizationStore {
  public state: AuthorizationPolicyState | null = null;
  public readonly audits: AuthorizationAuditRecord[] = [];
  public loadCount = 0;
  public readonly quarantined = new Set<string>();

  public async getPolicyRevision(realmId: string): Promise<number | null> {
    return this.state?.realm.id === realmId ? this.state.revision : null;
  }

  public async loadPolicy(realmId: string): Promise<AuthorizationPolicyState | null> {
    this.loadCount += 1;
    return this.state?.realm.id === realmId ? this.state : null;
  }

  public async initialize(input: {
    readonly realmId: string;
    readonly expectedRevision: null;
    readonly state: AuthorizationPolicySeed;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    if (this.state !== null || input.expectedRevision !== null) throw new Error("initialization conflict");
    this.state = { ...input.state, revision: 1 };
    this.recordAudit(input.realmId, 1, input.audit);
    return this.state;
  }

  public async mutatePolicy<TMutation extends AuthorizationPolicyMutation>(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly mutation: TMutation;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    if (this.state === null || this.state.realm.id !== input.realmId) throw new Error("missing policy");
    if (this.state.revision !== input.expectedRevision) throw new Error("revision conflict");
    this.state = applyPolicyMutation(this.state, input.mutation);
    this.recordAudit(input.realmId, this.state.revision, input.audit);
    return this.state;
  }

  public async listAudit(input: {
    readonly realmId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<AuthorizationAuditPage> {
    const start = input.cursor === undefined ? 0 : Number(input.cursor);
    const items = this.audits
      .filter(({ realmId }) => realmId === input.realmId)
      .slice(start, start + input.limit);
    const next = start + items.length;
    return {
      items,
      ...(next < this.audits.length ? { nextCursor: String(next) } : {}),
    };
  }

  public async isResourceQuarantined(realmId: string, resourceId: string): Promise<boolean> {
    return realmId === REALM_ID && this.quarantined.has(resourceId);
  }

  public async quarantineResources(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    if (input.realmId !== REALM_ID) throw new Error("realm mismatch");
    input.resourceIds.forEach((id) => this.quarantined.add(id));
  }

  public async releaseResourceQuarantine(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    if (input.realmId !== REALM_ID) throw new Error("realm mismatch");
    input.resourceIds.forEach((id) => this.quarantined.delete(id));
  }

  public externalRevisionBump(): void {
    if (this.state === null) throw new Error("missing policy");
    this.state = { ...this.state, revision: this.state.revision + 1 };
  }

  private recordAudit(realmId: string, revision: number, audit: AuthorizationAuditDraft): void {
    this.audits.push({ ...audit, realmId, revision });
  }
}

class MultiRealmMemoryAuthorizationStore implements AuthorizationStore {
  public readonly states = new Map<string, AuthorizationPolicyState>();
  public readonly audits: AuthorizationAuditRecord[] = [];
  public readonly quarantined = new Set<string>();

  public async getPolicyRevision(realmId: string): Promise<number | null> {
    return this.states.get(realmId)?.revision ?? null;
  }

  public async loadPolicy(realmId: string): Promise<AuthorizationPolicyState | null> {
    return this.states.get(realmId) ?? null;
  }

  public async initialize(input: {
    readonly realmId: string;
    readonly expectedRevision: null;
    readonly state: AuthorizationPolicySeed;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    if (this.states.has(input.realmId) || input.expectedRevision !== null) {
      throw new Error("initialization conflict");
    }
    const state = { ...input.state, revision: 1 };
    this.states.set(input.realmId, state);
    this.recordAudit(input.realmId, state.revision, input.audit);
    return state;
  }

  public async mutatePolicy<TMutation extends AuthorizationPolicyMutation>(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly mutation: TMutation;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    const current = this.states.get(input.realmId);
    if (current === undefined) throw new Error("missing policy");
    if (current.revision !== input.expectedRevision) throw new Error("revision conflict");
    const state = applyPolicyMutation(current, input.mutation);
    this.states.set(input.realmId, state);
    this.recordAudit(input.realmId, state.revision, input.audit);
    return state;
  }

  public async listAudit(input: {
    readonly realmId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<AuthorizationAuditPage> {
    const start = input.cursor === undefined ? 0 : Number(input.cursor);
    const items = this.audits
      .filter(({ realmId }) => realmId === input.realmId)
      .slice(start, start + input.limit);
    return { items };
  }

  public async isResourceQuarantined(realmId: string, resourceId: string): Promise<boolean> {
    return this.quarantined.has(this.quarantineKey(realmId, resourceId));
  }

  public async quarantineResources(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    input.resourceIds.forEach((resourceId) => this.quarantined.add(
      this.quarantineKey(input.realmId, resourceId),
    ));
  }

  public async releaseResourceQuarantine(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    input.resourceIds.forEach((resourceId) => this.quarantined.delete(
      this.quarantineKey(input.realmId, resourceId),
    ));
  }

  private quarantineKey(realmId: string, resourceId: string): string {
    return `${realmId}\u0000${resourceId}`;
  }

  private recordAudit(realmId: string, revision: number, audit: AuthorizationAuditDraft): void {
    this.audits.push({ ...audit, realmId, revision });
  }
}

function runtime(): AuthorizationRuntime {
  let id = 0;
  return {
    now: () => NOW,
    newAuditId: () => `audit:${++id}`,
    newId: (prefix) => `${prefix}:generated:${++id}`,
  };
}

async function setup(): Promise<{
  readonly store: MemoryAuthorizationStore;
  readonly service: AuthorizationApplicationService;
}> {
  const store = new MemoryAuthorizationStore();
  const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
  await service.initialize({
    realmId: REALM_ID,
    realmName: "System",
    rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
    rootResourceName: "Workspace",
    ownerSubjectId: OWNER_ID,
    ownerSubjectName: "Owner",
  });
  return { store, service };
}

async function initializeRealm(
  service: AuthorizationApplicationService,
  realmId: string,
  ownerSubjectId: string,
  rootResourceId = `authorization:${realmId}:resource:workspace`,
): Promise<AuthorizationActor> {
  await service.initialize({
    realmId,
    realmName: realmId,
    rootResourceId,
    rootResourceName: `${realmId} workspace`,
    ownerSubjectId,
    ownerSubjectName: `${realmId} owner`,
  });
  return { realmId, subjectId: ownerSubjectId };
}

function realmState(
  store: MultiRealmMemoryAuthorizationStore,
  realmId: string,
): AuthorizationPolicyState {
  const state = store.states.get(realmId);
  if (state === undefined) throw new Error(`missing policy for ${realmId}`);
  return state;
}

function current(store: MemoryAuthorizationStore): AuthorizationPolicyState {
  if (store.state === null) throw new Error("test policy was not initialized");
  return store.state;
}

function roleNamed(store: MemoryAuthorizationStore, name: string): AuthorizationRoleRecord {
  const role = current(store).roles.find((candidate) => candidate.name === name);
  if (role === undefined) throw new Error(`missing role ${name}`);
  return role;
}

async function createSubject(
  service: AuthorizationApplicationService,
  store: MemoryAuthorizationStore,
  id: string,
  name: string,
  type: "user" | "group" = "user",
): Promise<void> {
  await service.createSubject(OWNER, {
    expectedRevision: current(store).revision,
    subject: { id, realmId: REALM_ID, name, type },
  });
}

describe("AuthorizationApplicationService", () => {
  it("seeds protected ownership, core resources, canonical permissions, and horizontal admin roles", async () => {
    const seed = createInitialAuthorizationPolicy({
      realmId: REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: OWNER_ID,
      ownerIdentityId: "identity:global-owner",
      ownerSubjectName: "Owner",
    });

    const owner = seed.roles.find(({ name }) => name === "Owner")!;
    const contentAdmin = seed.roles.find(({ name }) => name === "Content Administrator")!;
    const securityAdmin = seed.roles.find(({ name }) => name === "Security Administrator")!;
    const contentLevel = seed.authorityLevels.find(({ id }) => id === contentAdmin.levelId)!;
    const securityLevel = seed.authorityLevels.find(({ id }) => id === securityAdmin.levelId)!;

    expect(owner.protected).toBe(true);
    expect(seed.subjects.find(({ id }) => id === OWNER_ID)).toMatchObject({
      identityId: "identity:global-owner",
    });
    expect(seed.subjects.find(({ id }) => id === SYSTEM_PUBLIC_SUBJECT_ID)).not.toHaveProperty(
      "identityId",
    );
    expect(owner.permissions).toContain("authorization.manage");
    expect(owner.permissions).toContain("content.purge");
    expect(owner.delegatablePermissions).not.toContain("authorization.manage");
    expect(contentLevel.id).toBe(securityLevel.id);
    expect(contentLevel.rank).toBe(80);
    expect(seed.roles.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "Editor",
      "Viewer",
      "Public",
    ]));
    expect(seed.subjects).toContainEqual(expect.objectContaining({
      id: SYSTEM_PUBLIC_SUBJECT_ID,
      protected: true,
    }));
    expect(seed.resources.map(({ id }) => id)).toEqual(expect.arrayContaining([
      SYSTEM_SCHEMA_RESOURCE_ID,
      SYSTEM_CONTENT_RESOURCE_ID,
      "resource:authorization",
      "resource:audit",
    ]));
    expect(seed.permissions.every(({ key }) =>
      /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(key))).toBe(true);
  });

  it("preserves System Realm resource IDs and namespaces the same physical content in other realms", async () => {
    expect(realmCollectionResourceId(SYSTEM_AUTHORIZATION_REALM_ID, "posts"))
      .toBe(collectionResourceId("posts"));
    expect(realmDocumentResourceId(SYSTEM_AUTHORIZATION_REALM_ID, "shared"))
      .toBe(documentResourceId("shared"));
    expect(realmCollectionResourceId("rlm_community", "posts"))
      .toBe("authorization:rlm_community:resource:collection:posts");
    expect(realmDocumentResourceId("rlm_community", "shared"))
      .toBe("authorization:rlm_community:resource:document:shared");

    const store = new MultiRealmMemoryAuthorizationStore();
    const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    const community = await initializeRealm(service, "rlm_community", "subject:community-owner");
    const commerce = await initializeRealm(service, "rlm_commerce", "subject:commerce-owner");

    for (const actor of [community, commerce]) {
      await service.syncCoreResources(actor, {
        expectedRevision: realmState(store, actor.realmId).revision,
        collections: [{ id: "posts", name: "Posts" }],
      });
      await service.reconcileContentHierarchyResources(actor, {
        expectedRevision: realmState(store, actor.realmId).revision,
        managedCollectionIds: ["posts"],
        projections: [
          { documentId: "root", collectionId: "posts", parentDocumentId: null },
          { documentId: "shared", collectionId: "posts", parentDocumentId: "root" },
        ],
        reason: "startup",
      });
    }

    const communityCollection = realmCollectionResourceId(community.realmId, "posts");
    const communityRoot = realmDocumentResourceId(community.realmId, "root");
    const communityDocument = realmDocumentResourceId(community.realmId, "shared");
    const commerceCollection = realmCollectionResourceId(commerce.realmId, "posts");
    const commerceDocument = realmDocumentResourceId(commerce.realmId, "shared");
    expect(communityCollection).not.toBe(commerceCollection);
    expect(communityDocument).not.toBe(commerceDocument);
    expect(realmState(store, community.realmId).resources).toContainEqual(expect.objectContaining({
      id: communityDocument,
      parentId: communityRoot,
      realmId: community.realmId,
    }));
    expect(realmState(store, commerce.realmId).resources).toContainEqual(expect.objectContaining({
      id: commerceDocument,
      parentId: realmDocumentResourceId(commerce.realmId, "root"),
      realmId: commerce.realmId,
    }));

    await service.createSubject(community, {
      expectedRevision: realmState(store, community.realmId).revision,
      subject: {
        id: "subject:community-reader",
        realmId: community.realmId,
        name: "Community reader",
        type: "user",
      },
    });
    const communityViewer = realmState(store, community.realmId).roles.find(
      ({ name }) => name === "Viewer",
    );
    if (communityViewer === undefined) throw new Error("missing community viewer role");
    await service.createBinding(community, {
      expectedRevision: realmState(store, community.realmId).revision,
      binding: {
        id: "binding:community-shared-viewer",
        realmId: community.realmId,
        subjectId: "subject:community-reader",
        roleId: communityViewer.id,
        resourceId: communityDocument,
        propagation: "self",
      },
    });
    await service.reconcileContentHierarchyResources(community, {
      expectedRevision: realmState(store, community.realmId).revision,
      managedCollectionIds: ["posts"],
      projections: [{ documentId: "root", collectionId: "posts", parentDocumentId: null }],
      reason: "schema.apply",
    });

    expect(realmState(store, community.realmId).resources).toContainEqual(expect.objectContaining({
      id: communityDocument,
      type: "retired-document",
      parentId: "authorization:rlm_community:resource:content",
    }));
    expect(realmState(store, commerce.realmId).resources).toContainEqual(expect.objectContaining({
      id: commerceDocument,
      type: "document",
      parentId: realmDocumentResourceId(commerce.realmId, "root"),
    }));

    await service.syncCoreResources(community, {
      expectedRevision: realmState(store, community.realmId).revision,
      collections: [],
    });
    expect(realmState(store, community.realmId).resources).toContainEqual(expect.objectContaining({
      id: communityCollection,
      type: "retired-collection",
      parentId: "authorization:rlm_community:resource:content",
    }));
    expect(realmState(store, commerce.realmId).resources).toContainEqual(expect.objectContaining({
      id: commerceCollection,
      type: "collection",
    }));
  });

  it("keeps process-local projection quarantine isolated by realm even for equal resource IDs", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    const sharedResourceId = "resource:shared-root";
    const community = await initializeRealm(
      service,
      "rlm_quarantine_community",
      "subject:quarantine-community-owner",
      sharedResourceId,
    );
    const commerce = await initializeRealm(
      service,
      "rlm_quarantine_commerce",
      "subject:quarantine-commerce-owner",
      sharedResourceId,
    );

    await service.quarantineContentResources(community, [sharedResourceId]);
    await expect(service.authorize(community, {
      action: "content.read",
      resourceId: sharedResourceId,
    })).rejects.toMatchObject({ code: "AUTHORIZATION_PROJECTION_UNAVAILABLE", status: 503 });
    await expect(service.authorize(commerce, {
      action: "content.read",
      resourceId: sharedResourceId,
    })).resolves.toMatchObject({ allowed: true });
  });

  it("evaluates a self access profile against one revision and marks hierarchy checks unsupported", async () => {
    const store = new MemoryAuthorizationStore();
    const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    await service.initialize({
      realmId: REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: OWNER_ID,
      ownerSubjectName: "Owner",
    });
    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision,
      collections: [{ id: "posts", name: "Posts" }],
    });
    const policyRevision = current(store).revision;
    const posts = collectionResourceId("posts");

    await expect(service.evaluateBatch(OWNER, {
      checks: [
        {
          id: "posts.read",
          type: "permission",
          action: "content.read",
          resourceId: posts,
        },
        {
          id: "posts.title.read",
          type: "field",
          action: "content.read",
          resourceId: posts,
          field: "title",
          access: "read",
        },
        {
          id: "owner.transfer",
          type: "permission",
          action: "identity.owner.transfer",
          resourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
        },
        {
          id: "plugin.missing",
          type: "permission",
          action: "plugin.missing",
          resourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
        },
      ],
    })).resolves.toEqual({
      policyRevision,
      items: [
        expect.objectContaining({
          id: "posts.read",
          type: "permission",
          supported: true,
          decision: expect.objectContaining({ allowed: true, action: "content.read" }),
        }),
        expect.objectContaining({
          id: "posts.title.read",
          type: "field",
          action: "content.read",
          supported: true,
          decision: expect.objectContaining({
            allowed: true,
            access: "read",
            field: "title",
          }),
        }),
        expect.objectContaining({
          id: "owner.transfer",
          type: "permission",
          supported: false,
          decision: expect.objectContaining({
            allowed: false,
            reasonCode: "HIERARCHY_CONTEXT_REQUIRED",
          }),
        }),
        expect.objectContaining({
          id: "plugin.missing",
          type: "permission",
          supported: false,
          decision: expect.objectContaining({ allowed: false, reasonCode: "UNKNOWN_PERMISSION" }),
        }),
      ],
    });
  });

  it("rejects invalid access profile batch boundaries", async () => {
    const store = new MemoryAuthorizationStore();
    const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    await service.initialize({
      realmId: REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: OWNER_ID,
      ownerSubjectName: "Owner",
    });
    const duplicate = {
      id: "same",
      type: "permission" as const,
      action: "content.read",
      resourceId: SYSTEM_CONTENT_RESOURCE_ID,
    };

    await expect(service.evaluateBatch(OWNER, { checks: [] })).rejects.toMatchObject({
      code: "ACCESS_BATCH_SIZE_INVALID",
      status: 422,
    });
    await expect(service.evaluateBatch(OWNER, { checks: [duplicate, duplicate] })).rejects.toMatchObject({
      code: "ACCESS_BATCH_DUPLICATE_ID",
      status: 422,
    });
  });

  it("keeps arbitrary Global Identity linkage out of ordinary Subject mutations", async () => {
    const { store, service } = await setup();
    const revision = current(store).revision;
    await expect(service.createSubject(OWNER, {
      expectedRevision: revision,
      subject: {
        id: "subject:attempted-link",
        realmId: REALM_ID,
        name: "Attempted link",
        type: "user",
        identityId: "identity:arbitrary",
      } as NewAuthorizationSubjectRecord,
    })).rejects.toMatchObject({ code: "SUBJECT_IDENTITY_LINK_NOT_ALLOWED", status: 422 });
    expect(current(store).revision).toBe(revision);
    expect(current(store).subjects).not.toContainEqual(expect.objectContaining({
      id: "subject:attempted-link",
    }));
  });

  it("keeps Realm Full Access out of every content and field authorization path", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    const owner = await initializeRealm(service, "rlm_full_data_plane", "subject:data-owner");
    await service.syncCoreResources(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      collections: [{ id: "posts", name: "Posts" }],
    });
    await service.createSubject(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      subject: { id: "subject:no-data-grant", realmId: owner.realmId, name: "No data grant", type: "user" },
    });
    const actor = { realmId: owner.realmId, subjectId: "subject:no-data-grant" };
    const posts = realmCollectionResourceId(owner.realmId, "posts");

    await expect(service.authorize(actor, {
      action: "content.update",
      resourceId: posts,
    })).resolves.toMatchObject({ allowed: false, reasonCode: "NO_PERMISSION" });
    await expect(service.evaluateField(actor, {
      resourceId: posts,
      field: "privateNotes",
      access: "read",
      action: "content.read",
    })).resolves.toMatchObject({ allowed: false });
    await expect(service.filterReadableData(actor, {
      resourceId: posts,
      data: { title: "Hidden", secret: "Hidden" },
    })).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED", status: 403 });
    await expect(service.assertWritableData(actor, {
      resourceId: posts,
      data: { title: "Denied" },
    })).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED", status: 403 });
  });

  it("supports audited CMS read-only oversight and management-only Full Access without a Realm Subject", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const service = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    const owner = await initializeRealm(service, "rlm_admin_control_plane", "subject:policy-owner");
    const readonly = {
      accessMode: "cms-owner-readonly" as const,
      realmId: owner.realmId,
      systemIdentityId: "identity:cms-owner",
    };
    const full = {
      accessMode: "realm-full-access" as const,
      realmId: owner.realmId,
      systemIdentityId: "identity:cms-owner",
      fullAccessBindingId: "full-access:grant-one",
    };

    await expect(service.getPolicy(readonly)).resolves.toMatchObject({ realm: { id: owner.realmId } });
    await expect(service.createSubject(readonly, {
      expectedRevision: realmState(store, owner.realmId).revision,
      subject: { id: "subject:readonly", realmId: owner.realmId, name: "Readonly", type: "user" },
    })).rejects.toMatchObject({ code: "REALM_ADMINISTRATION_READ_ONLY", status: 403 });

    await service.createSubject(full, {
      expectedRevision: realmState(store, owner.realmId).revision,
      subject: { id: "subject:recovered", realmId: owner.realmId, name: "Recovered", type: "user" },
    });
    expect(realmState(store, owner.realmId).subjects).toContainEqual(expect.objectContaining({
      id: "subject:recovered",
    }));
    expect(store.audits.at(-1)).toMatchObject({
      actorIdentityId: full.systemIdentityId,
      accessMode: "realm-full-access",
      fullAccessBindingId: full.fullAccessBindingId,
      decision: { reasonCode: "ALLOW_REALM_FULL_ACCESS" },
    });
    expect(store.audits.at(-1)).not.toHaveProperty("actorSubjectId");
    await expect(service.deleteBinding(full, {
      expectedRevision: realmState(store, owner.realmId).revision,
      bindingId: `authorization:${owner.realmId}:binding:owner`,
    })).rejects.toMatchObject({ code: "AUTHORIZATION_PROTECTED_TARGET", status: 403 });

    await expect(service.getPolicy({ ...readonly, realmId: REALM_ID })).rejects.toMatchObject({
      code: "REALM_ADMINISTRATION_CONTENT_REALM_REQUIRED",
      status: 403,
    });
  });

  it("denies same-level administration and out-of-scope binding assignment", async () => {
    const { store, service } = await setup();
    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision,
      collections: [{ id: "site-a", name: "Site A" }, { id: "site-b", name: "Site B" }],
    });
    await createSubject(service, store, "subject:root-admin", "Root content admin");
    await createSubject(service, store, "subject:site-admin", "Site content admin");
    await createSubject(service, store, "subject:editor", "Editor target");
    const contentAdmin = roleNamed(store, "Content Administrator");
    const securityAdmin = roleNamed(store, "Security Administrator");
    const editor = roleNamed(store, "Editor");

    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:root-admin",
        realmId: REALM_ID,
        subjectId: "subject:root-admin",
        roleId: contentAdmin.id,
        resourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
        propagation: "self-and-children",
      },
    });
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:site-admin",
        realmId: REALM_ID,
        subjectId: "subject:site-admin",
        roleId: contentAdmin.id,
        resourceId: collectionResourceId("site-a"),
        propagation: "self-and-children",
      },
    });

    await expect(service.updateRole(
      { subjectId: "subject:root-admin", realmId: REALM_ID },
      {
        expectedRevision: current(store).revision,
        roleId: securityAdmin.id,
        role: { ...securityAdmin, description: "same-level mutation attempt" },
      },
    )).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
      options: { details: { decision: { reasonCode: "TARGET_NOT_LOWER" } } },
    });

    await expect(service.createBinding(
      { subjectId: "subject:site-admin", realmId: REALM_ID },
      {
        expectedRevision: current(store).revision,
        binding: {
          id: "binding:outside-scope",
          realmId: REALM_ID,
          subjectId: "subject:editor",
          roleId: editor.id,
          resourceId: collectionResourceId("site-b"),
          propagation: "self-and-children",
        },
      },
    )).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
      options: { details: { decision: { reasonCode: "SCOPE_MISMATCH" } } },
    });
  });

  it("explains permissions inherited through a nested group membership path", async () => {
    const { store, service } = await setup();
    await service.syncCollectionResource(OWNER, {
      expectedRevision: current(store).revision,
      collectionId: "posts",
      collectionName: "Posts",
    });
    await createSubject(service, store, "subject:alice", "Alice");
    await createSubject(service, store, "group:editors", "Editors group", "group");
    await createSubject(service, store, "group:company", "Company group", "group");
    await service.createGroupMembership(OWNER, {
      expectedRevision: current(store).revision,
      membership: {
        id: "membership:alice-editors",
        realmId: REALM_ID,
        memberSubjectId: "subject:alice",
        groupSubjectId: "group:editors",
      },
    });
    await service.createGroupMembership(OWNER, {
      expectedRevision: current(store).revision,
      membership: {
        id: "membership:editors-company",
        realmId: REALM_ID,
        memberSubjectId: "group:editors",
        groupSubjectId: "group:company",
      },
    });
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:company-viewer",
        realmId: REALM_ID,
        subjectId: "group:company",
        roleId: roleNamed(store, "Viewer").id,
        resourceId: SYSTEM_CONTENT_RESOURCE_ID,
        propagation: "self-and-children",
      },
    });

    const decision = await service.authorize(
      { subjectId: "subject:alice", realmId: REALM_ID },
      { action: "content.read", resourceId: collectionResourceId("posts") },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.matchedGrants[0]?.membershipPath).toEqual([
      "subject:alice",
      "group:editors",
      "group:company",
    ]);
  });

  it("keys its snapshot cache by persisted policy revision", async () => {
    const { store, service } = await setup();
    await service.syncCollectionResource(OWNER, {
      expectedRevision: current(store).revision,
      collectionId: "posts",
      collectionName: "Posts",
    });
    const freshService = new AuthorizationApplicationService(store, runtime(), new InMemoryRealmCollectionEntitlementStore());
    store.loadCount = 0;
    const request = { action: "content.read", resourceId: collectionResourceId("posts") } as const;
    const publicActor = { subjectId: SYSTEM_PUBLIC_SUBJECT_ID, realmId: REALM_ID };

    expect((await freshService.authorize(publicActor, request)).allowed).toBe(true);
    expect((await freshService.authorize(publicActor, request)).allowed).toBe(true);
    expect(store.loadCount).toBe(1);

    const publicBinding = current(store).bindings.find(
      ({ subjectId }) => subjectId === SYSTEM_PUBLIC_SUBJECT_ID,
    );
    if (publicBinding === undefined) throw new Error("missing public binding");
    store.state = applyPolicyMutation(current(store), {
      type: "binding.delete",
      id: publicBinding.id,
    });
    expect((await freshService.authorize(publicActor, request)).allowed).toBe(false);
    expect(store.loadCount).toBe(2);
  });

  it("reconciles hierarchy resources in one audited revision and previews effective move deltas without writes", async () => {
    const { store, service } = await setup();
    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision,
      collections: [{ id: "pages", name: "Pages" }],
    });
    const firstRevision = current(store).revision;
    const projections = [
      { documentId: "root-a", collectionId: "pages", parentDocumentId: null, name: "Root A" },
      { documentId: "root-b", collectionId: "pages", parentDocumentId: null, name: "Root B" },
      { documentId: "child", collectionId: "pages", parentDocumentId: "root-a", name: "Child" },
    ] as const;
    const reconciled = await service.reconcileContentHierarchyResources(OWNER, {
      expectedRevision: firstRevision,
      managedCollectionIds: ["pages"],
      projections,
      reason: "startup",
    });
    expect(reconciled).toMatchObject({ changed: true, revision: firstRevision + 1 });
    expect(current(store).resources.find(({ id }) => id === documentResourceId("child")))
      .toMatchObject({ name: "Document child", parentId: documentResourceId("root-a") });
    expect(store.audits.at(-1)).toMatchObject({
      action: "resource.reconcile",
      targetId: "content-hierarchy-resources",
    });

    await createSubject(service, store, "subject:mover", "Mover");
    await createSubject(service, store, "subject:field-reader", "Field reader");
    const viewer = roleNamed(store, "Viewer");
    await service.updateRole(OWNER, {
      expectedRevision: current(store).revision,
      roleId: viewer.id,
      role: {
        ...viewer,
        fieldAccess: [{
          resourceId: documentResourceId("root-a"),
          readableFields: ["title"],
          writableFields: [],
        }],
      },
    });
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:root-b-viewer",
        realmId: REALM_ID,
        subjectId: "subject:mover",
        roleId: viewer.id,
        resourceId: documentResourceId("root-b"),
        propagation: "self-and-children",
      },
    });
    for (const resourceId of [documentResourceId("root-a"), documentResourceId("root-b")]) {
      await service.createBinding(OWNER, {
        expectedRevision: current(store).revision,
        binding: {
          id: `binding:field-reader:${resourceId}`,
          realmId: REALM_ID,
          subjectId: "subject:field-reader",
          roleId: viewer.id,
          resourceId,
          propagation: "self-and-children",
        },
      });
    }
    const previewRevision = current(store).revision;
    const preview = await service.previewResourceParentChange(OWNER, {
      resourceId: documentResourceId("child"),
      newParentResourceId: documentResourceId("root-b"),
      affectedResourceIds: [documentResourceId("child")],
    });
    expect(preview.policyRevision).toBe(previewRevision);
    expect(preview.requiresAuthorizationManagement).toBe(true);
    expect(preview.effectivePermissionChanges).toContainEqual(expect.objectContaining({
      subjectId: "subject:mover",
      resourceId: documentResourceId("child"),
      permission: "content.read",
      beforeAllowed: false,
      afterAllowed: true,
      change: "granted",
    }));
    expect(preview.effectiveFieldAccessChanges).toContainEqual({
      subjectId: "subject:field-reader",
      resourceId: documentResourceId("child"),
      operation: "read",
      beforeFields: ["title"],
      afterFields: null,
      change: "broadened",
    });
    expect(preview.effectivePermissionChangesTruncated).toBe(false);
    expect(current(store).revision).toBe(previewRevision);
    expect(current(store).resources.find(({ id }) => id === documentResourceId("child"))?.parentId)
      .toBe(documentResourceId("root-a"));
    await expect(service.previewResourceParentChange(
      { subjectId: "subject:mover", realmId: REALM_ID },
      {
        resourceId: documentResourceId("child"),
        newParentResourceId: documentResourceId("root-b"),
        affectedResourceIds: [documentResourceId("child")],
      },
    )).resolves.toMatchObject({
      policyRevision: previewRevision,
      effectivePermissionChanges: [],
    });

    await service.quarantineContentResources(OWNER, [documentResourceId("child")]);
    await expect(service.authorize(OWNER, {
      action: "content.read",
      resourceId: documentResourceId("child"),
    })).rejects.toMatchObject({ code: "AUTHORIZATION_PROJECTION_UNAVAILABLE", status: 503 });
    const unchanged = await service.reconcileContentHierarchyResources(OWNER, {
      expectedRevision: previewRevision,
      managedCollectionIds: ["pages"],
      projections,
      reason: "startup",
    });
    expect(unchanged.changed).toBe(false);
    await expect(service.authorize(OWNER, {
      action: "content.read",
      resourceId: documentResourceId("child"),
    })).resolves.toMatchObject({ allowed: true });
  });

  it("retires stale hierarchy resources while preserving bindings and field rules that still reference them", async () => {
    const { store, service } = await setup();
    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision,
      collections: [{ id: "pages", name: "Pages" }],
    });
    const projections = [
      { documentId: "root", collectionId: "pages", parentDocumentId: null, name: "Root" },
      { documentId: "child", collectionId: "pages", parentDocumentId: "root", name: "Child" },
    ] as const;
    await service.reconcileContentHierarchyResources(OWNER, {
      expectedRevision: current(store).revision,
      managedCollectionIds: ["pages"],
      projections,
      reason: "startup",
    });
    await createSubject(service, store, "subject:scoped", "Scoped reader");
    const viewer = roleNamed(store, "Viewer");
    await service.updateRole(OWNER, {
      expectedRevision: current(store).revision,
      roleId: viewer.id,
      role: {
        ...viewer,
        fieldAccess: [{
          resourceId: documentResourceId("child"),
          readableFields: ["title"],
          writableFields: [],
        }],
      },
    });
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:child-viewer",
        realmId: REALM_ID,
        subjectId: "subject:scoped",
        roleId: viewer.id,
        resourceId: documentResourceId("child"),
        propagation: "self",
      },
    });
    const revisionBefore = current(store).revision;
    const reconciled = await service.reconcileContentHierarchyResources(OWNER, {
      expectedRevision: revisionBefore,
      managedCollectionIds: ["pages"],
      projections: [projections[0]],
      reason: "schema.apply",
    });

    expect(reconciled).toMatchObject({
      changed: true,
      revision: revisionBefore + 1,
      deletedResourceIds: [],
      retiredResourceIds: [documentResourceId("child")],
      removedBindingIds: [],
      removedFieldAccess: [],
    });
    expect(current(store).resources.find(({ id }) => id === documentResourceId("child"))).toMatchObject({
      type: "retired-document",
      parentId: SYSTEM_CONTENT_RESOURCE_ID,
    });
    expect(current(store).bindings.some(({ id }) => id === "binding:child-viewer")).toBe(true);
    expect(roleNamed(store, "Viewer").fieldAccess).toEqual([{
      resourceId: documentResourceId("child"),
      readableFields: ["title"],
      writableFields: [],
    }]);
  });

  it("keeps retired collection grants inert and rejects referenced ID reuse", async () => {
    const { store, service } = await setup();
    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision,
      collections: [{ id: "legacy", name: "Legacy" }],
    });
    await createSubject(service, store, "subject:legacy", "Legacy reader");
    const viewer = roleNamed(store, "Viewer");
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:legacy-viewer",
        realmId: REALM_ID,
        subjectId: "subject:legacy",
        roleId: viewer.id,
        resourceId: collectionResourceId("legacy"),
        propagation: "self-and-children",
      },
    });

    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision,
      collections: [],
    });
    expect(current(store).resources.find(({ id }) => id === collectionResourceId("legacy")))
      .toMatchObject({ type: "retired-collection" });
    expect(current(store).bindings.some(({ id }) => id === "binding:legacy-viewer")).toBe(true);

    const revisionBeforeReuse = current(store).revision;
    await expect(service.syncCoreResources(OWNER, {
      expectedRevision: revisionBeforeReuse,
      collections: [{ id: "legacy", name: "Legacy again" }],
    })).rejects.toMatchObject({
      code: "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
      status: 409,
    });
    expect(current(store).revision).toBe(revisionBeforeReuse);
    expect(current(store).resources.find(({ id }) => id === collectionResourceId("legacy")))
      .toMatchObject({ type: "retired-collection" });
  });

  it("filters unreadable fields, rejects unwritable fields, and audits before/after with provenance", async () => {
    const { store, service } = await setup();
    await service.syncCollectionResource(OWNER, {
      expectedRevision: current(store).revision,
      collectionId: "posts",
      collectionName: "Posts",
    });
    await createSubject(service, store, "subject:writer", "Writer");
    const editor = roleNamed(store, "Editor");
    const update = await service.updateRole(OWNER, {
      expectedRevision: current(store).revision,
      roleId: editor.id,
      role: {
        ...editor,
        description: "Can edit public post fields",
        fieldAccess: [{
          resourceId: collectionResourceId("posts"),
          readableFields: ["title", "body"],
          writableFields: ["title"],
        }],
      },
    });
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:writer",
        realmId: REALM_ID,
        subjectId: "subject:writer",
        roleId: editor.id,
        resourceId: collectionResourceId("posts"),
        propagation: "self-and-children",
      },
    });
    const writer = { subjectId: "subject:writer", realmId: REALM_ID };

    await expect(service.filterReadableData(writer, {
      resourceId: collectionResourceId("posts"),
      data: { title: "Hello", body: "Visible", secret: "hidden" },
    })).resolves.toEqual({ title: "Hello", body: "Visible" });
    await expect(service.assertWritableData(writer, {
      resourceId: collectionResourceId("posts"),
      data: { title: "Updated" },
    })).resolves.toBeUndefined();

    const viewer = roleNamed(store, "Viewer");
    const reader = await service.createRole(OWNER, {
      expectedRevision: current(store).revision,
      role: {
        id: "role:unrestricted-reader",
        realmId: REALM_ID,
        levelId: viewer.levelId,
        name: "Unrestricted Reader",
        permissions: ["content.read"],
        delegatablePermissions: [],
      },
    });
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:unrestricted-reader",
        realmId: REALM_ID,
        subjectId: "subject:writer",
        roleId: reader.value.id,
        resourceId: collectionResourceId("posts"),
        propagation: "self-and-children",
      },
    });
    await expect(service.filterReadableData(writer, {
      resourceId: collectionResourceId("posts"),
      data: { title: "Hello", secret: "visible through the unrestricted read grant" },
    })).resolves.toEqual({
      title: "Hello",
      secret: "visible through the unrestricted read grant",
    });
    // The read-only role is irrelevant to content.update and cannot broaden writes.
    await expect(service.assertWritableData(writer, {
      resourceId: collectionResourceId("posts"),
      data: { secret: "leak" },
    })).rejects.toMatchObject({ code: "FIELD_WRITE_FORBIDDEN" });

    const audit = store.audits.find(({ revision }) => revision === update.revision)!;
    expect(audit.action).toBe("role.update");
    expect(audit.before).toMatchObject({ id: editor.id });
    expect(audit.before).not.toHaveProperty("fieldAccess");
    expect(audit.after).toMatchObject({
      id: editor.id,
      fieldAccess: [{ readableFields: ["title", "body"], writableFields: ["title"] }],
    });
    expect(audit.decision).toMatchObject({
      allowed: true,
      reasonCode: "ALLOW_MANAGEMENT",
      matchedGrants: [{ sourceRoleId: expect.any(String), sourceRank: 100 }],
    });
  });

  it("uses the production evaluator for constrained, point-in-time simulations without requester bypass", async () => {
    const { store, service } = await setup();
    await service.syncCollectionResource(OWNER, {
      expectedRevision: current(store).revision,
      collectionId: "posts",
      collectionName: "Posts",
    });
    await createSubject(service, store, "subject:author", "Author");
    await service.createBinding(OWNER, {
      expectedRevision: current(store).revision,
      binding: {
        id: "binding:constrained-editor",
        realmId: REALM_ID,
        subjectId: "subject:author",
        roleId: roleNamed(store, "Editor").id,
        resourceId: collectionResourceId("posts"),
        propagation: "self-and-children",
        validFrom: "2026-07-15T10:00:00.000Z",
        validUntil: "2026-07-15T14:00:00.000Z",
        constraints: { ownerSubjectId: "subject:author", statuses: ["draft"] },
      },
    });
    const request = {
      subjectId: "subject:author",
      action: "content.update",
      resourceId: collectionResourceId("posts"),
      context: { ownerSubjectId: "subject:author", status: "draft" },
    } as const;

    expect((await service.simulate(OWNER, {
      ...request,
      at: "2026-07-15T09:00:00.000Z",
    })).reasonCode).toBe("INACTIVE_BINDING");
    expect((await service.simulate(OWNER, {
      ...request,
      context: { ownerSubjectId: "subject:someone-else", status: "draft" },
      at: NOW,
    })).reasonCode).toBe("CONSTRAINT_NOT_SATISFIED");
    const simulated = await service.simulate(OWNER, { ...request, at: NOW });
    const actual = await service.authorize(
      { subjectId: "subject:author", realmId: REALM_ID },
      request,
    );
    expect(simulated).toEqual(actual);

    await expect(service.simulate(
      { subjectId: SYSTEM_PUBLIC_SUBJECT_ID, realmId: REALM_ID },
      request,
    )).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("rejects owner-rank escalation and group cycles before persistence", async () => {
    const { store, service } = await setup();
    await createSubject(service, store, "group:a", "Group A", "group");
    await createSubject(service, store, "group:b", "Group B", "group");
    await service.createGroupMembership(OWNER, {
      expectedRevision: current(store).revision,
      membership: {
        id: "membership:a-b",
        realmId: REALM_ID,
        memberSubjectId: "group:a",
        groupSubjectId: "group:b",
      },
    });
    const revision = current(store).revision;

    await expect(service.createGroupMembership(OWNER, {
      expectedRevision: revision,
      membership: {
        id: "membership:b-a",
        realmId: REALM_ID,
        memberSubjectId: "group:b",
        groupSubjectId: "group:a",
      },
    })).rejects.toMatchObject({ code: "GROUP_MEMBERSHIP_CYCLE" });
    await expect(service.createLevel(OWNER, {
      expectedRevision: revision,
      level: { id: "level:escalated", realmId: REALM_ID, name: "Escalated", rank: 100 },
    })).rejects.toMatchObject({ code: "AUTHORITY_LEVEL_RANK_NOT_LOWER" });
    expect(current(store).revision).toBe(revision);
    expect(store.audits.at(-1)?.revision).toBe(revision);
  });
});

describe("Collection entitlement gate (enforced)", () => {
  const WORKSPACE = "wrk_default";
  const NOW_ISO = NOW;

  async function gateSetup(): Promise<{
    readonly service: AuthorizationApplicationService;
    readonly entitlements: InMemoryRealmCollectionEntitlementStore;
    readonly owner: AuthorizationActor;
    readonly posts: string;
  }> {
    const store = new MultiRealmMemoryAuthorizationStore();
    const entitlements = new InMemoryRealmCollectionEntitlementStore();
    const service = new AuthorizationApplicationService(store, runtime(), entitlements);
    // Content realm whose owner has full content access to a "posts" collection.
    const owner = await initializeRealm(service, "rlm_community", "subject:community-owner");
    await service.syncCoreResources(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      collections: [{ id: "posts", name: "Posts" }],
    });
    const posts = realmCollectionResourceId(owner.realmId, "posts");
    return { service, entitlements, owner, posts };
  }

  it("skips the gate while enforcement is disabled (default)", async () => {
    const { service, owner, posts } = await gateSetup();
    // No enforcement row → gate skipped → realm policy stands.
    await expect(service.authorize(owner, { action: "content.read", resourceId: posts }))
      .resolves.toMatchObject({ allowed: true });
  });

  it("denies with DENY_ENTITLEMENT_GATE when the ceiling is absent under enforcement", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced");
    // Enforced but no entitlement for this collection = access ceiling absent.
    await expect(service.authorize(owner, { action: "content.read", resourceId: posts }))
      .resolves.toMatchObject({ allowed: false, reasonCode: "DENY_ENTITLEMENT_GATE" });
  });

  it("allows only the actions the ceiling grants", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced");
    entitlements.seed({
      workspaceId: WORKSPACE, realmId: owner.realmId, collectionId: "posts",
      actions: ["read"], revision: 1, updatedAt: NOW_ISO, updatedBy: "cms",
    });
    await expect(service.authorize(owner, { action: "content.read", resourceId: posts }))
      .resolves.toMatchObject({ allowed: true });
    await expect(service.authorize(owner, { action: "content.update", resourceId: posts }))
      .resolves.toMatchObject({ allowed: false, reasonCode: "DENY_ENTITLEMENT_GATE" });
  });

  it("intersects readable fields with the ceiling", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced");
    entitlements.seed({
      workspaceId: WORKSPACE, realmId: owner.realmId, collectionId: "posts",
      actions: ["read"], readableFields: ["title"], revision: 1, updatedAt: NOW_ISO, updatedBy: "cms",
    });
    const filtered = await service.filterReadableData(owner, {
      resourceId: posts, data: { title: "Visible", secret: "Hidden" },
    });
    expect(filtered).toEqual({ title: "Visible" });
  });

  it("rejects writes to fields outside the ceiling", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced");
    entitlements.seed({
      workspaceId: WORKSPACE, realmId: owner.realmId, collectionId: "posts",
      actions: ["update"], readableFields: ["title"], writableFields: ["title"], revision: 1, updatedAt: NOW_ISO, updatedBy: "cms",
    });
    await expect(service.assertWritableData(owner, { resourceId: posts, data: { title: "ok" } }))
      .resolves.toBeUndefined();
    await expect(service.assertWritableData(owner, { resourceId: posts, data: { secret: "no" } }))
      .rejects.toMatchObject({ code: "FIELD_WRITE_FORBIDDEN", status: 403 });
  });

  it("enforces ownerOnly and status conditions", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced");
    entitlements.seed({
      workspaceId: WORKSPACE, realmId: owner.realmId, collectionId: "posts",
      actions: ["read"], constraint: { ownerOnly: true, statuses: ["published"] },
      revision: 1, updatedAt: NOW_ISO, updatedBy: "cms",
    });
    // Own + published → allowed.
    await expect(service.authorize(owner, {
      action: "content.read", resourceId: posts,
      context: { ownerSubjectId: owner.subjectId, status: "published" },
    })).resolves.toMatchObject({ allowed: true });
    // Someone else's document → denied.
    await expect(service.authorize(owner, {
      action: "content.read", resourceId: posts,
      context: { ownerSubjectId: "subject:other", status: "published" },
    })).resolves.toMatchObject({ allowed: false, reasonCode: "DENY_ENTITLEMENT_GATE" });
    // Wrong status → denied.
    await expect(service.authorize(owner, {
      action: "content.read", resourceId: posts,
      context: { ownerSubjectId: owner.subjectId, status: "draft" },
    })).resolves.toMatchObject({ allowed: false, reasonCode: "DENY_ENTITLEMENT_GATE" });
  });

  it("applies ownerOnly to filterReadableData (basis for list post-filtering)", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced");
    entitlements.seed({
      workspaceId: WORKSPACE, realmId: owner.realmId, collectionId: "posts",
      actions: ["read"], constraint: { ownerOnly: true }, revision: 1, updatedAt: NOW_ISO, updatedBy: "cms",
    });
    // Own document → data returned.
    await expect(service.filterReadableData(owner, {
      resourceId: posts, data: { title: "Mine" }, context: { ownerSubjectId: owner.subjectId },
    })).resolves.toEqual({ title: "Mine" });
    // Someone else's document → gate denies; list post-filter treats this as "not visible".
    await expect(service.filterReadableData(owner, {
      resourceId: posts, data: { title: "Theirs" }, context: { ownerSubjectId: "subject:other" },
    })).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED", status: 403 });
  });

  it("does not gate the System realm", async () => {
    const store = new MemoryAuthorizationStore();
    const entitlements = new InMemoryRealmCollectionEntitlementStore();
    const service = new AuthorizationApplicationService(store, runtime(), entitlements);
    await service.initialize({
      realmId: REALM_ID, realmName: "System", rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace", ownerSubjectId: OWNER_ID, ownerSubjectName: "Owner",
    });
    await service.syncCoreResources(OWNER, {
      expectedRevision: current(store).revision, collections: [{ id: "posts", name: "Posts" }],
    });
    // Even if we "enforce" the system realm, the gate skips it.
    entitlements.setEnforcement(REALM_ID, WORKSPACE, "enforced");
    await expect(service.authorize(OWNER, { action: "content.read", resourceId: collectionResourceId("posts") }))
      .resolves.toMatchObject({ allowed: true });
  });

  it("always allows the realm's own Auth collection, even with no ceiling under enforcement", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    // Mark "posts" as this realm's guaranteed Auth (profile) collection.
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced", "posts");
    // No entitlement seeded — for any other collection this would deny, but the
    // guaranteed collection is structurally exempt from the ceiling.
    await expect(service.authorize(owner, { action: "content.read", resourceId: posts }))
      .resolves.toMatchObject({ allowed: true });
    await expect(service.authorize(owner, { action: "content.update", resourceId: posts }))
      .resolves.toMatchObject({ allowed: true });
  });

  it("does not restrict fields on the guaranteed Auth collection", async () => {
    const { service, entitlements, owner, posts } = await gateSetup();
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced", "posts");
    // No readableFields ceiling applies to the guaranteed collection.
    await expect(service.filterReadableData(owner, {
      resourceId: posts, data: { title: "Visible", secret: "AlsoVisible" },
    })).resolves.toEqual({ title: "Visible", secret: "AlsoVisible" });
    await expect(service.assertWritableData(owner, { resourceId: posts, data: { secret: "ok" } }))
      .resolves.toBeUndefined();
  });

  it("still gates other collections when one is guaranteed", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const entitlements = new InMemoryRealmCollectionEntitlementStore();
    const service = new AuthorizationApplicationService(store, runtime(), entitlements);
    const owner = await initializeRealm(service, "rlm_community", "subject:community-owner");
    await service.syncCoreResources(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      collections: [{ id: "members", name: "Members" }, { id: "posts", name: "Posts" }],
    });
    // "members" is the Auth collection (guaranteed); "posts" is ordinary content.
    entitlements.setEnforcement(owner.realmId, WORKSPACE, "enforced", "members");
    const members = realmCollectionResourceId(owner.realmId, "members");
    const posts = realmCollectionResourceId(owner.realmId, "posts");
    await expect(service.authorize(owner, { action: "content.read", resourceId: members }))
      .resolves.toMatchObject({ allowed: true });
    // No ceiling for "posts" → denied, proving the guarantee is scoped to the Auth collection.
    await expect(service.authorize(owner, { action: "content.read", resourceId: posts }))
      .resolves.toMatchObject({ allowed: false, reasonCode: "DENY_ENTITLEMENT_GATE" });
  });
});
