import { describe, expect, it } from "vitest";

import {
  AuthorizationApplicationService,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  applyPolicyMutation,
  realmCollectionResourceId,
  type AuthorizationAuditDraft,
  type AuthorizationAuditPage,
  type AuthorizationAuditRecord,
  type AuthorizationPolicyMutation,
  type AuthorizationPolicySeed,
  type AuthorizationPolicyState,
  type AuthorizationRuntime,
  type AuthorizationStore,
} from "./authorization.js";
import type { GlobalIdentityRecord, IdentityRealmRecord } from "./identity-realms.js";
import { ApplicationError } from "./errors.js";
import {
  ContentRealmAuthorizationProvisioner,
  realmAuthorizationBootstrapSubjectId,
  realmAuthorizationRootResourceId,
  realmDefaultRoleBindingId,
} from "./realm-authorization-provisioning.js";

const NOW = "2026-07-15T12:00:00.000Z";

class MemoryMultiRealmAuthorizationStore implements AuthorizationStore {
  public readonly states = new Map<string, AuthorizationPolicyState>();
  public readonly audits: AuthorizationAuditRecord[] = [];
  public readonly quarantined = new Set<string>();
  public failNextMutationWithRevisionConflict = false;

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
    if (this.states.has(input.realmId)) throw new Error("initialization conflict");
    const state = { ...input.state, revision: 1 };
    this.states.set(input.realmId, state);
    this.audits.push({ ...input.audit, realmId: input.realmId, revision: 1 });
    return state;
  }

  public async mutatePolicy<TMutation extends AuthorizationPolicyMutation>(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly mutation: TMutation;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    if (this.failNextMutationWithRevisionConflict) {
      this.failNextMutationWithRevisionConflict = false;
      throw new ApplicationError(
        "AUTHORIZATION_POLICY_REVISION_CONFLICT",
        409,
        "Injected concurrent policy mutation.",
      );
    }
    const state = this.states.get(input.realmId);
    if (state === undefined) throw new Error("missing policy");
    if (state.revision !== input.expectedRevision) throw new Error("revision conflict");
    const updated = applyPolicyMutation(state, input.mutation);
    this.states.set(input.realmId, updated);
    this.audits.push({ ...input.audit, realmId: input.realmId, revision: updated.revision });
    return updated;
  }

  public async listAudit(input: {
    readonly realmId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<AuthorizationAuditPage> {
    const offset = input.cursor === undefined ? 0 : Number(input.cursor);
    const items = this.audits
      .filter(({ realmId }) => realmId === input.realmId)
      .slice(offset, offset + input.limit);
    return { items };
  }

  public async isResourceQuarantined(realmId: string, resourceId: string): Promise<boolean> {
    return this.quarantined.has(`${realmId}\0${resourceId}`);
  }

  public async quarantineResources(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    input.resourceIds.forEach((resourceId) => this.quarantined.add(`${input.realmId}\0${resourceId}`));
  }

  public async releaseResourceQuarantine(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    input.resourceIds.forEach((resourceId) => this.quarantined.delete(`${input.realmId}\0${resourceId}`));
  }
}

function runtime(): AuthorizationRuntime {
  let sequence = 0;
  return {
    now: () => NOW,
    newAuditId: () => `audit:provisioning:${++sequence}`,
    newId: (prefix) => `${prefix}:provisioning:${++sequence}`,
  };
}

function contentRealm(input: {
  readonly id?: string;
  readonly status?: IdentityRealmRecord["status"];
  readonly defaultRoleIds?: readonly string[];
} = {}): IdentityRealmRecord {
  const id = input.id ?? "rlm_community";
  return {
    id,
    workspaceId: "wrk_default",
    key: id.replace(/^rlm_/, ""),
    name: "Community",
    kind: "content",
    status: input.status ?? "active",
    profileCollectionId: "col_members",
    authentication: {
      acceptSystemIdentities: true,
      provisioning: "jit",
      registration: "open",
      defaultRoleIds: input.defaultRoleIds ?? [],
    },
    revision: 2,
    createdAt: NOW,
    createdBy: "identity:system-owner",
    updatedAt: NOW,
    updatedBy: "identity:system-owner",
  };
}

function identity(id = "identity:global-member"): GlobalIdentityRecord {
  return {
    id,
    workspaceId: "wrk_default",
    primaryIdentifier: "member@example.test",
    originRealmId: SYSTEM_AUTHORIZATION_REALM_ID,
    credentialVersion: 1,
  };
}

async function setup(): Promise<{
  readonly store: MemoryMultiRealmAuthorizationStore;
  readonly authorization: AuthorizationApplicationService;
  readonly provisioner: ContentRealmAuthorizationProvisioner;
}> {
  const store = new MemoryMultiRealmAuthorizationStore();
  const authorization = new AuthorizationApplicationService(store, runtime());
  return {
    store,
    authorization,
    provisioner: new ContentRealmAuthorizationProvisioner(authorization),
  };
}

function policy(
  store: MemoryMultiRealmAuthorizationStore,
  realmId: string,
): AuthorizationPolicyState {
  const state = store.states.get(realmId);
  if (state === undefined) throw new Error(`missing policy '${realmId}'`);
  return state;
}

function audit(action: string, actorSubjectId: string): AuthorizationAuditDraft {
  return {
    id: `audit:fixture:${action}`,
    actorSubjectId,
    action,
    targetType: "subject",
    targetId: "subject:fixture",
    before: null,
    after: null,
    decision: null,
    occurredAt: NOW,
  };
}

describe("ContentRealmAuthorizationProvisioner", () => {
  it("idempotently initializes an isolated protected Realm policy and collection projection", async () => {
    const { store, authorization, provisioner } = await setup();
    await authorization.initialize({
      realmId: SYSTEM_AUTHORIZATION_REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: "subject:system-owner",
      ownerSubjectName: "System owner",
    });
    const realm = contentRealm({ status: "provisioning" });

    const initialized = await provisioner.ensureRealmPolicy(realm);
    const retried = await provisioner.ensureRealmPolicy(realm);
    expect(retried.revision).toBe(initialized.revision);
    expect(initialized).toMatchObject({
      revision: 1,
      realm: {
        id: realm.id,
        rootResourceId: realmAuthorizationRootResourceId(realm.id),
      },
    });
    expect(initialized.subjects).toContainEqual(expect.objectContaining({
      id: realmAuthorizationBootstrapSubjectId(realm.id),
      realmId: realm.id,
      type: "service-account",
      protected: true,
    }));
    expect(initialized.subjects.find(
      ({ id }) => id === realmAuthorizationBootstrapSubjectId(realm.id),
    )).not.toHaveProperty("identityId");
    expect(initialized.roles.every(({ id, realmId }) =>
      id.startsWith(`authorization:${realm.id}:`) && realmId === realm.id)).toBe(true);
    expect(initialized.bindings.some(({ realmId }) => realmId === SYSTEM_AUTHORIZATION_REALM_ID))
      .toBe(false);
    expect(store.audits.filter(({ realmId }) => realmId === realm.id)).toHaveLength(1);

    const projected = await provisioner.syncCollectionResources({
      realm,
      collections: [{ id: "posts", name: "Posts" }],
    });
    const projectionRetry = await provisioner.syncCollectionResources({
      realm,
      collections: [{ id: "posts", name: "Posts" }],
    });
    expect(projectionRetry.revision).toBe(projected.revision);
    expect(projected.resources).toContainEqual(expect.objectContaining({
      id: realmCollectionResourceId(realm.id, "posts"),
      realmId: realm.id,
      parentId: `authorization:${realm.id}:resource:content`,
    }));
  });

  it("creates one identity-linked user and deterministic root default grants across retries", async () => {
    const { store, authorization, provisioner } = await setup();
    const subjectId = "subject:community-member";
    // Equal Subject IDs across Realms deliberately do not bridge grants.
    await authorization.initialize({
      realmId: SYSTEM_AUTHORIZATION_REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: subjectId,
      ownerSubjectName: "System owner",
    });
    const realmId = "rlm_community";
    const viewerRoleId = `authorization:${realmId}:role:viewer`;
    const realm = contentRealm({ id: realmId, defaultRoleIds: [viewerRoleId, viewerRoleId] });
    const globalIdentity = identity();

    store.failNextMutationWithRevisionConflict = true;
    await provisioner.ensureIdentitySubject({
      realm,
      identity: globalIdentity,
      subjectId,
      displayName: "Community member",
    });
    const revisionAfterSubject = policy(store, realm.id).revision;
    await provisioner.ensureIdentitySubject({
      realm,
      identity: globalIdentity,
      subjectId,
      displayName: "A harmless later display value",
    });
    expect(policy(store, realm.id).revision).toBe(revisionAfterSubject);
    expect(policy(store, realm.id).subjects).toContainEqual(expect.objectContaining({
      id: subjectId,
      identityId: globalIdentity.id,
      realmId: realm.id,
      type: "user",
    }));
    expect(subjectId).not.toBe(globalIdentity.id);

    await provisioner.ensureDefaultRoles({ realm, subjectId });
    const revisionAfterDefaults = policy(store, realm.id).revision;
    await provisioner.ensureDefaultRoles({ realm, subjectId });
    expect(policy(store, realm.id).revision).toBe(revisionAfterDefaults);
    const bindingId = realmDefaultRoleBindingId(realm.id, subjectId, viewerRoleId);
    expect(realmDefaultRoleBindingId(realm.id, subjectId, viewerRoleId)).toBe(bindingId);
    expect(policy(store, realm.id).bindings).toContainEqual(expect.objectContaining({
      id: bindingId,
      realmId: realm.id,
      subjectId,
      roleId: viewerRoleId,
      resourceId: realmAuthorizationRootResourceId(realm.id),
      propagation: "self-and-children",
    }));
    expect(policy(store, realm.id).bindings.filter(({ id }) => id === bindingId)).toHaveLength(1);

    await expect(authorization.authorize(
      { realmId: realm.id, subjectId },
      { action: "content.read", resourceId: realmAuthorizationRootResourceId(realm.id) },
    )).resolves.toMatchObject({ allowed: true, reasonCode: "ALLOW_PERMISSION" });
    await expect(authorization.authorize(
      { realmId: realm.id, subjectId },
      { action: "authorization.manage", resourceId: realmAuthorizationRootResourceId(realm.id) },
    )).resolves.toMatchObject({ allowed: false, reasonCode: "NO_PERMISSION" });
    await expect(authorization.authorize(
      { realmId: SYSTEM_AUTHORIZATION_REALM_ID, subjectId },
      { action: "authorization.manage", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID },
    )).resolves.toMatchObject({ allowed: true });

    const subjectAudit = store.audits.find(
      ({ realmId, action }) => realmId === realm.id && action === "subject.create",
    );
    const bindingAudit = store.audits.find(
      ({ realmId, action }) => realmId === realm.id && action === "binding.create",
    );
    expect(subjectAudit?.decision).toMatchObject({ allowed: true, reasonCode: "ALLOW_PERMISSION" });
    expect(bindingAudit?.decision).toMatchObject({ allowed: true, reasonCode: "ALLOW_MANAGEMENT" });
  });

  it("fails closed when a deterministic Subject ID has a different Identity link", async () => {
    const { store, provisioner } = await setup();
    const realm = contentRealm();
    const initialized = await provisioner.ensureRealmPolicy(realm);
    const subjectId = "subject:stable-member";
    await store.mutatePolicy({
      realmId: realm.id,
      expectedRevision: initialized.revision,
      mutation: {
        type: "subject.create",
        value: {
          id: subjectId,
          realmId: realm.id,
          identityId: "identity:wrong-link",
          name: "Conflicting user",
          type: "user",
        },
      },
      audit: audit("subject.fixture", realmAuthorizationBootstrapSubjectId(realm.id)),
    });
    const revision = policy(store, realm.id).revision;

    await expect(provisioner.ensureIdentitySubject({
      realm,
      identity: identity("identity:expected-link"),
      subjectId,
      displayName: "Expected user",
    })).rejects.toMatchObject({ code: "REALM_SUBJECT_IDENTITY_MISMATCH", status: 409 });
    expect(policy(store, realm.id).revision).toBe(revision);
    expect(policy(store, realm.id).subjects.find(({ id }) => id === subjectId)).toMatchObject({
      identityId: "identity:wrong-link",
    });
  });

  it("rejects a System Role ID as a Content Realm default instead of inheriting it", async () => {
    const { store, authorization, provisioner } = await setup();
    await authorization.initialize({
      realmId: SYSTEM_AUTHORIZATION_REALM_ID,
      realmName: "System",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: "Workspace",
      ownerSubjectId: "subject:system-owner",
      ownerSubjectName: "System owner",
    });
    const realm = contentRealm({
      defaultRoleIds: [`authorization:${SYSTEM_AUTHORIZATION_REALM_ID}:role:viewer`],
    });
    const subjectId = "subject:content-only";
    await provisioner.ensureIdentitySubject({
      realm,
      identity: identity(),
      subjectId,
      displayName: "Content only",
    });
    const revision = policy(store, realm.id).revision;

    await expect(provisioner.ensureDefaultRoles({ realm, subjectId })).rejects.toMatchObject({
      code: "REALM_DEFAULT_ROLE_INVALID",
      status: 409,
    });
    expect(policy(store, realm.id).revision).toBe(revision);
    expect(policy(store, realm.id).bindings.some(
      ({ subjectId: bindingSubjectId }) => bindingSubjectId === subjectId,
    )).toBe(false);
  });
});
