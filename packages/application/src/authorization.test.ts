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
  type RealmFullAccessResolver,
  type RealmFullAccessUse,
} from "./authorization.js";

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

class MemoryRealmFullAccessResolver implements RealmFullAccessResolver {
  readonly #active = new Set<string>();
  public readonly checks: {
    readonly realmId: string;
    readonly subjectId: string;
    readonly at: string;
  }[] = [];
  public readonly uses: RealmFullAccessUse[] = [];

  public grant(realmId: string, subjectId: string): void {
    this.#active.add(this.key(realmId, subjectId));
  }

  public async hasActiveFullAccess(
    realmId: string,
    subjectId: string,
    at: string,
  ): Promise<boolean> {
    this.checks.push({ realmId, subjectId, at });
    return this.#active.has(this.key(realmId, subjectId));
  }

  public async recordUse(input: RealmFullAccessUse): Promise<void> {
    this.uses.push(input);
  }

  private key(realmId: string, subjectId: string): string {
    return `${realmId}\u0000${subjectId}`;
  }
}

async function setup(): Promise<{
  readonly store: MemoryAuthorizationStore;
  readonly service: AuthorizationApplicationService;
}> {
  const store = new MemoryAuthorizationStore();
  const service = new AuthorizationApplicationService(store, runtime());
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
    const service = new AuthorizationApplicationService(store, runtime());
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
    const service = new AuthorizationApplicationService(store, runtime());
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
    const service = new AuthorizationApplicationService(store, runtime());
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
    const service = new AuthorizationApplicationService(store, runtime());
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

  it("applies active Full Access only in its target Realm with explicit provenance and use audit", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const resolver = new MemoryRealmFullAccessResolver();
    const service = new AuthorizationApplicationService(store, runtime(), resolver);
    const community = await initializeRealm(service, "rlm_full_community", "subject:community-owner");
    const commerce = await initializeRealm(service, "rlm_full_commerce", "subject:commerce-owner");

    for (const owner of [community, commerce]) {
      await service.syncCoreResources(owner, {
        expectedRevision: realmState(store, owner.realmId).revision,
        collections: [{ id: "posts", name: "Posts" }],
      });
      await service.createSubject(owner, {
        expectedRevision: realmState(store, owner.realmId).revision,
        subject: {
          id: "subject:realm-operator",
          realmId: owner.realmId,
          name: "Realm operator",
          type: "user",
        },
      });
    }

    resolver.grant(community.realmId, "subject:realm-operator");
    const communityActor = { ...community, subjectId: "subject:realm-operator" };
    const commerceActor = { ...commerce, subjectId: "subject:realm-operator" };
    const communityPosts = realmCollectionResourceId(community.realmId, "posts");
    const commercePosts = realmCollectionResourceId(commerce.realmId, "posts");

    const authorized = await service.authorize(communityActor, {
      action: "content.update",
      resourceId: communityPosts,
    });
    expect(authorized).toMatchObject({
      allowed: true,
      reasonCode: "ALLOW_REALM_FULL_ACCESS",
      matchedGrants: [{
        sourceKind: "realm-full-access",
        sourceRealmId: community.realmId,
        sourceSubjectId: communityActor.subjectId,
        permission: "content.update",
      }],
      evaluatedScope: { resourceId: communityPosts, propagation: "self" },
    });
    expect(authorized).not.toHaveProperty("actorLevel");
    await expect(service.require(communityActor, {
      action: "content.delete",
      resourceId: communityPosts,
    })).resolves.toMatchObject({ reasonCode: "ALLOW_REALM_FULL_ACCESS" });
    await expect(service.simulate(community, {
      subjectId: communityActor.subjectId,
      action: "content.publish",
      resourceId: communityPosts,
      at: NOW,
    })).resolves.toMatchObject({ reasonCode: "ALLOW_REALM_FULL_ACCESS" });

    // The resolver is keyed by (Realm, subject): an equal subject ID in a
    // different Realm receives no capability.
    await expect(service.authorize(commerceActor, {
      action: "content.update",
      resourceId: commercePosts,
    })).resolves.toMatchObject({ allowed: false, reasonCode: "NO_PERMISSION" });
    expect(resolver.uses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        realmId: community.realmId,
        subjectId: communityActor.subjectId,
        action: "content.update",
        resourceId: communityPosts,
        at: NOW,
        operation: "authorize",
      }),
      expect.objectContaining({ action: "content.delete", operation: "authorize" }),
      expect.objectContaining({ action: "content.publish", operation: "simulate" }),
    ]));
    expect(resolver.uses).toHaveLength(3);
  });

  it("keeps System, invalid policy boundaries, projection failures, and Owner management fail-closed", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const resolver = new MemoryRealmFullAccessResolver();
    const service = new AuthorizationApplicationService(store, runtime(), resolver);
    const owner = await initializeRealm(service, "rlm_full_boundaries", "subject:boundary-owner");
    await service.syncCoreResources(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      collections: [{ id: "posts", name: "Posts" }],
    });
    for (const subject of [
      { id: "subject:active-full", name: "Active full" },
      { id: "subject:disabled-full", name: "Disabled full", disabled: true },
    ] as const) {
      await service.createSubject(owner, {
        expectedRevision: realmState(store, owner.realmId).revision,
        subject: { ...subject, realmId: owner.realmId, type: "user" },
      });
      resolver.grant(owner.realmId, subject.id);
    }
    const fullActor = { realmId: owner.realmId, subjectId: "subject:active-full" };
    const disabledActor = { realmId: owner.realmId, subjectId: "subject:disabled-full" };
    const posts = realmCollectionResourceId(owner.realmId, "posts");

    const checksBeforeInvalidRequests = resolver.checks.length;
    await expect(service.authorize(fullActor, {
      action: "content.unknown",
      resourceId: posts,
    })).resolves.toMatchObject({ allowed: false, reasonCode: "UNKNOWN_PERMISSION" });
    await expect(service.authorize(fullActor, {
      action: "content.update",
      resourceId: "authorization:another-realm:resource:collection:posts",
    })).resolves.toMatchObject({ allowed: false, reasonCode: "UNKNOWN_RESOURCE" });
    await expect(service.authorize(disabledActor, {
      action: "content.update",
      resourceId: posts,
    })).resolves.toMatchObject({ allowed: false, reasonCode: "SUBJECT_DISABLED" });
    expect(resolver.checks).toHaveLength(checksBeforeInvalidRequests);
    expect(resolver.uses).toHaveLength(0);

    // Full Access is intentionally absent from protected Owner management.
    await expect(service.createSubject(fullActor, {
      expectedRevision: realmState(store, owner.realmId).revision,
      subject: {
        id: "subject:must-not-be-created",
        realmId: owner.realmId,
        name: "Must not be created",
        type: "user",
      },
    })).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED", status: 403 });
    expect(resolver.checks).toHaveLength(checksBeforeInvalidRequests);

    await service.quarantineContentResources(owner, [posts]);
    await expect(service.authorize(fullActor, {
      action: "content.update",
      resourceId: posts,
    })).rejects.toMatchObject({ code: "AUTHORIZATION_PROJECTION_UNAVAILABLE", status: 503 });
    expect(resolver.checks).toHaveLength(checksBeforeInvalidRequests);

    const systemStore = new MemoryAuthorizationStore();
    const systemResolver = new MemoryRealmFullAccessResolver();
    const systemService = new AuthorizationApplicationService(systemStore, runtime(), systemResolver);
    await systemService.initialize({
      realmId: REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: OWNER_ID,
      ownerSubjectName: "Owner",
    });
    await systemService.syncCoreResources(OWNER, {
      expectedRevision: current(systemStore).revision,
      collections: [{ id: "posts", name: "Posts" }],
    });
    await createSubject(systemService, systemStore, "subject:system-full", "System full");
    systemResolver.grant(REALM_ID, "subject:system-full");
    await expect(systemService.authorize(
      { realmId: REALM_ID, subjectId: "subject:system-full" },
      { action: "content.update", resourceId: collectionResourceId("posts") },
    )).resolves.toMatchObject({ allowed: false, reasonCode: "NO_PERMISSION" });
    expect(systemResolver.checks).toHaveLength(0);
    expect(systemResolver.uses).toHaveLength(0);
  });

  it("treats active Realm Full Access as unrestricted across every field API and audits each use", async () => {
    const store = new MultiRealmMemoryAuthorizationStore();
    const resolver = new MemoryRealmFullAccessResolver();
    const service = new AuthorizationApplicationService(store, runtime(), resolver);
    const owner = await initializeRealm(service, "rlm_full_fields", "subject:fields-owner");
    await service.syncCoreResources(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      collections: [{ id: "posts", name: "Posts" }],
    });
    await service.createSubject(owner, {
      expectedRevision: realmState(store, owner.realmId).revision,
      subject: {
        id: "subject:field-full",
        realmId: owner.realmId,
        name: "Field full",
        type: "user",
      },
    });
    resolver.grant(owner.realmId, "subject:field-full");
    const actor = { realmId: owner.realmId, subjectId: "subject:field-full" };
    const posts = realmCollectionResourceId(owner.realmId, "posts");

    await expect(service.evaluateField(actor, {
      resourceId: posts,
      field: "privateNotes",
      access: "read",
    })).resolves.toMatchObject({
      allowed: true,
      reasonCode: "ALLOW_REALM_FULL_ACCESS",
      matchedGrants: [{
        sourceKind: "realm-full-access",
        sourceRealmId: owner.realmId,
        sourceSubjectId: actor.subjectId,
      }],
    });
    await expect(service.evaluateField(actor, {
      resourceId: posts,
      field: "privateNotes",
      access: "write",
      action: "content.update",
    })).resolves.toMatchObject({ allowed: true, reasonCode: "ALLOW_REALM_FULL_ACCESS" });
    await expect(service.filterReadableData(actor, {
      resourceId: posts,
      data: { title: "Visible", secret: "Also visible" },
    })).resolves.toEqual({ title: "Visible", secret: "Also visible" });
    await expect(service.assertWritableData(actor, {
      resourceId: posts,
      data: { title: "Updated", secret: "Allowed" },
    })).resolves.toBeUndefined();

    expect(resolver.uses).toEqual([
      expect.objectContaining({
        action: "content.read",
        operation: "evaluate-field",
        field: "privateNotes",
      }),
      expect.objectContaining({
        action: "content.update",
        operation: "evaluate-field",
        field: "privateNotes",
      }),
      expect.objectContaining({
        action: "content.read",
        operation: "filter-readable-data",
        fields: ["title", "secret"],
      }),
      expect.objectContaining({
        action: "content.update",
        operation: "assert-writable-data",
        fields: ["title", "secret"],
      }),
    ]);
    const auditedUses = resolver.uses.length;
    await expect(service.filterReadableData(actor, {
      resourceId: posts,
      data: { "": "invalid field" },
    })).rejects.toMatchObject({ code: "FIELD_NAME_INVALID", status: 422 });
    expect(resolver.uses).toHaveLength(auditedUses);
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
    const freshService = new AuthorizationApplicationService(store, runtime());
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
