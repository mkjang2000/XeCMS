import { createHash } from "node:crypto";

import {
  AuthorizationApplicationService,
  type AuthorizationActor,
  type AuthorizationBindingRecord,
  type AuthorizationPolicyState,
  type RealmOwnerCommandActor,
  type RealmPrimaryOwnerStatus,
  authorizationOwnerLevelId,
  authorizationOwnerRoleId,
  authorizationPrimaryOwnerBindingId,
  authorizationSystemPolicyRootBindingId,
  authorizationSystemPolicyRootLevelId,
  authorizationSystemPolicyRootRoleId,
} from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type {
  GlobalIdentityRecord,
  IdentityRealmRecord,
  RealmAuthorizationSubjectProvisioner,
} from "./identity-realms.js";

const PROVISIONING_RETRY_LIMIT = 4;

/** Stable protected principal used only to converge a Content Realm policy. */
export function realmAuthorizationBootstrapSubjectId(realmId: string): string {
  return `authorization:${realmId}:subject:provisioner`;
}

/** Stable root. Content resources and default grants are always descendants of it. */
export function realmAuthorizationRootResourceId(realmId: string): string {
  return `authorization:${realmId}:resource:workspace`;
}

/** Stable without embedding potentially long or sensitive Identity/Subject values. */
export function realmDefaultRoleBindingId(
  realmId: string,
  subjectId: string,
  roleId: string,
): string {
  const digest = createHash("sha256")
    .update(realmId)
    .update("\0")
    .update(subjectId)
    .update("\0")
    .update(roleId)
    .digest("hex")
    .slice(0, 32);
  return `authorization:${realmId}:binding:default:${digest}`;
}

/**
 * Bridges M4 Identity provisioning into an isolated M3 policy.
 *
 * No System Role/Binding is copied: every operation loads the target Realm's
 * own policy and acts as its deterministic protected bootstrap Subject.
 */
export class ContentRealmAuthorizationProvisioner
implements RealmAuthorizationSubjectProvisioner {
  public constructor(private readonly authorization: AuthorizationApplicationService) {}

  public async ensureRealmPolicy(
    realm: IdentityRealmRecord,
  ): Promise<AuthorizationPolicyState> {
    assertProvisionableContentRealm(realm);
    let state = await this.authorization.loadTrustedProvisioningPolicy(realm.id);
    if (state === null) {
      let initializationError: unknown;
      try {
        state = await this.authorization.initialize({
          realmId: realm.id,
          realmName: realm.name,
          rootResourceId: realmAuthorizationRootResourceId(realm.id),
          rootResourceName: `${realm.name} workspace`,
          ownerSubjectId: realmAuthorizationBootstrapSubjectId(realm.id),
          ownerSubjectType: "service-account",
          ownerSubjectName: "Realm authorization provisioner",
          ownerIsSystemPolicyRoot: true,
        });
      } catch (error: unknown) {
        initializationError = error;
      }
      if (state === null) {
        state = await this.authorization.loadTrustedProvisioningPolicy(realm.id);
      }
      // A concurrent deterministic initializer is success after validation.
      if (state === null) throw initializationError;
    }
    assertProvisioningPolicy(state, realm.id);
    return state;
  }

  public async getPrimaryOwner(realm: IdentityRealmRecord): Promise<RealmPrimaryOwnerStatus> {
    assertProvisionableContentRealm(realm);
    const existing = await this.authorization.loadTrustedProvisioningPolicy(realm.id);
    if (existing === null) {
      await this.ensureRealmPolicy(realm);
    } else {
      // Status inspection must remain available when only the human Owner
      // projection is damaged, otherwise the recovery UI deadlocks.
      assertProvisioningPolicy(existing, realm.id, true);
    }
    return this.authorization.getTrustedPrimaryRealmOwner(realm.id);
  }

  public async setPrimaryOwner(input: {
    readonly realm: IdentityRealmRecord;
    readonly actor: RealmOwnerCommandActor;
    readonly expectedRevision: number;
    readonly subjectId: string;
    readonly operation: "assign" | "transfer" | "recover";
  }): Promise<RealmPrimaryOwnerStatus> {
    assertActiveContentRealm(input.realm);
    if (input.actor.realmId !== input.realm.id) {
      throw new ApplicationError(
        "AUTHORIZATION_REALM_MISMATCH",
        409,
        "The Owner command actor belongs to another Realm.",
      );
    }
    if (input.operation === "recover") {
      const existing = await this.authorization.loadTrustedProvisioningPolicy(input.realm.id);
      if (existing === null) {
        await this.ensureRealmPolicy(input.realm);
      } else {
        // Recovery may replace malformed/multiple human Owner Bindings, but the
        // provisioner/System Policy Root foundation must still be intact.
        assertProvisioningPolicy(existing, input.realm.id, true);
      }
    } else {
      await this.ensureRealmPolicy(input.realm);
    }
    return this.authorization.setTrustedPrimaryRealmOwner(input.actor, {
      expectedRevision: input.expectedRevision,
      subjectId: input.subjectId,
      operation: input.operation,
    });
  }

  public async ensureIdentitySubject(input: {
    readonly realm: IdentityRealmRecord;
    readonly identity: GlobalIdentityRecord;
    readonly subjectId: string;
    readonly displayName: string;
  }): Promise<void> {
    assertActiveContentRealm(input.realm);
    if (input.identity.workspaceId !== input.realm.workspaceId) {
      throw new ApplicationError(
        "REALM_IDENTITY_WORKSPACE_MISMATCH",
        409,
        "The Global Identity and Content Realm belong to different Workspaces.",
      );
    }
    if (input.identity.disabledAt !== undefined) {
      throw new ApplicationError("GLOBAL_IDENTITY_DISABLED", 403, "The Global Identity is disabled.");
    }
    await this.withPolicyRetry(input.realm, async (state, actor) => {
      await this.authorization.ensureProvisionedIdentitySubject(actor, {
        expectedRevision: state.revision,
        subjectId: input.subjectId,
        identityId: input.identity.id,
        name: input.displayName,
      });
    });
  }

  public async ensureDefaultRoles(input: {
    readonly realm: IdentityRealmRecord;
    readonly subjectId: string;
  }): Promise<void> {
    assertActiveContentRealm(input.realm);
    for (const roleId of [...new Set(input.realm.authentication.defaultRoleIds)]) {
      await this.withPolicyRetry(input.realm, async (state, actor) => {
        const subject = state.subjects.find(({ id }) => id === input.subjectId);
        if (
          subject === undefined
          || subject.realmId !== input.realm.id
          || subject.type !== "user"
          || subject.identityId === undefined
          || subject.disabled === true
        ) {
          throw new ApplicationError(
            "REALM_SUBJECT_NOT_PROVISIONED",
            409,
            `Subject '${input.subjectId}' is not an active identity-linked user in this Realm.`,
          );
        }
        const role = state.roles.find(({ id }) => id === roleId);
        if (role === undefined || role.realmId !== input.realm.id || role.protected === true) {
          throw new ApplicationError(
            "REALM_DEFAULT_ROLE_INVALID",
            409,
            `Default Role '${roleId}' is not an assignable Role in Realm '${input.realm.id}'.`,
          );
        }
        const binding: AuthorizationBindingRecord = {
          id: realmDefaultRoleBindingId(input.realm.id, input.subjectId, roleId),
          realmId: input.realm.id,
          subjectId: input.subjectId,
          roleId,
          resourceId: state.realm.rootResourceId,
          propagation: "self-and-children",
        };
        const existing = state.bindings.find(({ id }) => id === binding.id);
        if (existing !== undefined) {
          if (!defaultBindingMatches(existing, binding)) {
            throw new ApplicationError(
              "REALM_DEFAULT_BINDING_CONFLICT",
              409,
              `Default binding '${binding.id}' already exists with different semantics.`,
            );
          }
          return;
        }
        const equivalent = state.bindings.find((candidate) => defaultBindingMatches(candidate, binding));
        if (equivalent !== undefined) return;
        await this.authorization.createBinding(actor, {
          expectedRevision: state.revision,
          binding,
        });
      });
    }
  }

  /**
   * Grants the realm Content Administrator Role to an existing member Subject
   * through the trusted provisioner path, breaking the bootstrap deadlock: a
   * human operator holds no policy permission in a freshly bootstrapped Realm,
   * so they cannot bind anything themselves. This runs as the protected
   * provisioner Subject (which owns the Realm). The Content Administrator Role
   * carries authorization.read (policy screen access) plus role.assign/create/
   * update (policy management), and unlike the protected Owner Role it is an
   * assignable target. Idempotent.
   */
  public async grantRealmAdministrator(input: {
    readonly realm: IdentityRealmRecord;
    readonly subjectId: string;
  }): Promise<void> {
    assertActiveContentRealm(input.realm);
    const adminRoleId = `authorization:${input.realm.id}:role:content-administrator`;
    await this.withPolicyRetry(input.realm, async (state, actor) => {
      const subject = state.subjects.find(({ id }) => id === input.subjectId);
      if (
        subject === undefined
        || subject.realmId !== input.realm.id
        || subject.type !== "user"
        || subject.identityId === undefined
        || subject.disabled === true
      ) {
        throw new ApplicationError(
          "REALM_SUBJECT_NOT_PROVISIONED",
          409,
          `Subject '${input.subjectId}' is not an active identity-linked user in this Realm.`,
        );
      }
      const adminRole = state.roles.find(({ id }) => id === adminRoleId);
      if (adminRole === undefined || adminRole.realmId !== input.realm.id) {
        throw new ApplicationError(
          "REALM_ADMIN_ROLE_MISSING",
          409,
          `Realm '${input.realm.id}' has no Content Administrator Role to grant.`,
        );
      }
      const binding = realmAdministratorBinding(state, input.realm.id, input.subjectId);
      const existing = state.bindings.find(({ id }) => id === binding.id);
      if (existing !== undefined) {
        if (!defaultBindingMatches(existing, binding)) {
          throw new ApplicationError(
            "REALM_DEFAULT_BINDING_CONFLICT",
            409,
            `Administrator binding '${binding.id}' already exists with different semantics.`,
          );
        }
        return;
      }
      const equivalent = state.bindings.find(
        (candidate) => candidate.subjectId === binding.subjectId
          && candidate.roleId === binding.roleId
          && defaultBindingMatches(candidate, binding),
      );
      if (equivalent !== undefined) return;
      await this.authorization.createBinding(actor, {
        expectedRevision: state.revision,
        binding,
      });
    });
  }

  /**
   * Returns only Subjects holding the deterministic administrator Binding
   * created by this trusted boundary. Arbitrary policy bindings to the same
   * Role remain ordinary Realm policy and are intentionally not represented as
   * lifecycle-managed administrator appointments.
   */
  public async listRealmAdministratorSubjectIds(
    realm: IdentityRealmRecord,
  ): Promise<readonly string[]> {
    if (realm.kind !== "content") {
      throw new ApplicationError(
        "CONTENT_REALM_REQUIRED",
        409,
        "Realm administrator inspection requires a Content Realm.",
      );
    }
    const state = await this.authorization.loadTrustedProvisioningPolicy(realm.id);
    if (state === null) return [];
    assertProvisioningPolicy(state, realm.id);
    const administratorRoleId = `authorization:${realm.id}:role:content-administrator`;
    const subjects: string[] = [];
    for (const binding of state.bindings) {
      if (binding.roleId !== administratorRoleId) continue;
      const expected = realmAdministratorBinding(state, realm.id, binding.subjectId);
      if (binding.id !== expected.id) continue;
      if (!defaultBindingMatches(binding, expected)) {
        throw new ApplicationError(
          "REALM_DEFAULT_BINDING_CONFLICT",
          409,
          `Administrator binding '${binding.id}' has incompatible semantics.`,
        );
      }
      subjects.push(binding.subjectId);
    }
    return subjects;
  }

  /**
   * Removes only the trusted canonical Content Administrator Binding. The
   * protected System Policy Root and Primary Owner Bindings have unrelated
   * deterministic IDs and cannot be selected through this operation. The
   * underlying authorization commit keeps revision CAS and audit insertion in
   * the same store transaction. Idempotent when no appointment exists.
   */
  public async revokeRealmAdministrator(input: {
    readonly realm: IdentityRealmRecord;
    readonly subjectId: string;
  }): Promise<void> {
    assertActiveContentRealm(input.realm);
    await this.withPolicyRetry(input.realm, async (state, actor) => {
      const expected = realmAdministratorBinding(state, input.realm.id, input.subjectId);
      const existing = state.bindings.find(({ id }) => id === expected.id);
      if (existing === undefined) return;
      if (!defaultBindingMatches(existing, expected)) {
        throw new ApplicationError(
          "REALM_DEFAULT_BINDING_CONFLICT",
          409,
          `Administrator binding '${existing.id}' has incompatible semantics.`,
        );
      }
      await this.authorization.deleteBinding(actor, {
        expectedRevision: state.revision,
        bindingId: expected.id,
      });
    });
  }

  /** Reconciles the complete desired Collection projection for this Realm. */
  public async syncCollectionResources(input: {
    readonly realm: IdentityRealmRecord;
    readonly collections: readonly { readonly id: string; readonly name: string }[];
  }): Promise<AuthorizationPolicyState> {
    assertProvisionableContentRealm(input.realm);
    let result: AuthorizationPolicyState | undefined;
    await this.withPolicyRetry(input.realm, async (state, actor) => {
      result = await this.authorization.syncCoreResources(actor, {
        expectedRevision: state.revision,
        collections: input.collections,
      });
    });
    if (result === undefined) {
      throw new Error("Collection authorization projection produced no policy state.");
    }
    return result;
  }

  private async withPolicyRetry(
    realm: IdentityRealmRecord,
    operation: (
      state: AuthorizationPolicyState,
      actor: AuthorizationActor,
    ) => Promise<void>,
  ): Promise<void> {
    let conflict: unknown;
    for (let attempt = 0; attempt < PROVISIONING_RETRY_LIMIT; attempt += 1) {
      const state = await this.ensureRealmPolicy(realm);
      try {
        await operation(state, provisioningActor(realm.id));
        return;
      } catch (error: unknown) {
        if (!isRevisionConflict(error)) throw error;
        conflict = error;
      }
    }
    throw conflict ?? new ApplicationError(
      "REALM_AUTHORIZATION_PROVISIONING_CONFLICT",
      409,
      "The Realm authorization policy changed repeatedly during provisioning.",
    );
  }
}

function provisioningActor(realmId: string): AuthorizationActor {
  return { realmId, subjectId: realmAuthorizationBootstrapSubjectId(realmId) };
}

function assertProvisionableContentRealm(realm: IdentityRealmRecord): void {
  if (realm.kind !== "content") {
    throw new ApplicationError(
      "CONTENT_REALM_REQUIRED",
      409,
      "Authorization provisioning requires a Content Realm.",
    );
  }
  if (realm.status === "disabled") {
    throw new ApplicationError("CONTENT_REALM_UNAVAILABLE", 409, "The Content Realm is disabled.");
  }
}

function assertActiveContentRealm(realm: IdentityRealmRecord): void {
  assertProvisionableContentRealm(realm);
  if (realm.status !== "active") {
    throw new ApplicationError("CONTENT_REALM_UNAVAILABLE", 409, "The Content Realm is not active.");
  }
}

function assertProvisioningPolicy(
  state: AuthorizationPolicyState,
  realmId: string,
  allowPrimaryOwnerRepair = false,
): void {
  const rootId = realmAuthorizationRootResourceId(realmId);
  const bootstrapId = realmAuthorizationBootstrapSubjectId(realmId);
  const root = state.resources.find(({ id }) => id === rootId);
  const bootstrap = state.subjects.find(({ id }) => id === bootstrapId);
  const ownerRoleId = authorizationOwnerRoleId(realmId);
  const ownerRole = state.roles.find(({ id }) => id === ownerRoleId);
  const ownerLevel = ownerRole === undefined
    ? undefined
    : state.authorityLevels.find(({ id }) => id === ownerRole.levelId);
  const rootRoleId = authorizationSystemPolicyRootRoleId(realmId);
  const rootRole = state.roles.find(({ id }) => id === rootRoleId);
  const rootLevel = state.authorityLevels.find(
    ({ id }) => id === authorizationSystemPolicyRootLevelId(realmId),
  );
  const rootBinding = state.bindings.find(
    ({ id }) => id === authorizationSystemPolicyRootBindingId(realmId),
  );
  const ownerBindings = state.bindings.filter(({ roleId }) => roleId === ownerRoleId);
  const primaryOwnerBinding = ownerBindings[0];
  const primaryOwnerSubject = primaryOwnerBinding === undefined
    ? undefined
    : state.subjects.find(({ id }) => id === primaryOwnerBinding.subjectId);
  const primaryOwnerValid = ownerBindings.length === 0 || (
    ownerBindings.length === 1
    && primaryOwnerBinding?.id === authorizationPrimaryOwnerBindingId(realmId)
    && primaryOwnerBinding.resourceId === rootId
    && primaryOwnerBinding.propagation === "self-and-children"
    && primaryOwnerBinding.protected === true
    && primaryOwnerBinding.validFrom === undefined
    && primaryOwnerBinding.validUntil === undefined
    && primaryOwnerBinding.constraints === undefined
    && primaryOwnerSubject?.type === "user"
    && primaryOwnerSubject.identityId !== undefined
    && primaryOwnerSubject.protected !== true
    && primaryOwnerSubject.disabled !== true
  );
  const valid = state.realm.id === realmId
    && state.realm.rootResourceId === rootId
    && root?.realmId === realmId
    && root.type === "workspace"
    && root.protected === true
    && root.parentId === undefined
    && bootstrap?.realmId === realmId
    && bootstrap.type === "service-account"
    && bootstrap.protected === true
    && bootstrap.disabled !== true
    && bootstrap.identityId === undefined
    && ownerRole?.realmId === realmId
    && ownerRole.protected === true
    && ownerRole.permissions.includes("authorization.manage")
    && ownerRole.permissions.includes("schema.apply")
    && ownerRole.permissions.includes("role.assign")
    && ownerLevel?.realmId === realmId
    && ownerLevel.protected === true
    && ownerLevel.rank === 100
    && rootRole?.realmId === realmId
    && rootRole.protected === true
    && rootRole.permissions.includes("authorization.manage")
    && rootLevel?.realmId === realmId
    && rootLevel.protected === true
    && rootLevel.rank > ownerLevel.rank
    && rootBinding?.realmId === realmId
    && rootBinding.subjectId === bootstrapId
    && rootBinding.roleId === rootRoleId
    && rootBinding.resourceId === rootId
    && rootBinding.propagation === "self-and-children"
    && rootBinding.protected === true
    && (primaryOwnerValid || allowPrimaryOwnerRepair);
  if (!valid) {
    throw new ApplicationError(
      "REALM_AUTHORIZATION_POLICY_CONFLICT",
      409,
      `Realm '${realmId}' has an incompatible authorization bootstrap policy.`,
    );
  }
  if (
    state.subjects.some(({ realmId: recordRealmId }) => recordRealmId !== realmId)
    || state.resources.some(({ realmId: recordRealmId }) => recordRealmId !== realmId)
    || state.authorityLevels.some(({ realmId: recordRealmId }) => recordRealmId !== realmId)
    || state.roles.some(({ realmId: recordRealmId }) => recordRealmId !== realmId)
    || state.bindings.some(({ realmId: recordRealmId }) => recordRealmId !== realmId)
    || state.groupMemberships.some(({ realmId: recordRealmId }) => recordRealmId !== realmId)
  ) {
    throw new ApplicationError(
      "REALM_AUTHORIZATION_POLICY_CONFLICT",
      409,
      `Realm '${realmId}' authorization policy contains cross-Realm records.`,
    );
  }
}

function defaultBindingMatches(
  actual: AuthorizationBindingRecord,
  expected: AuthorizationBindingRecord,
): boolean {
  return actual.realmId === expected.realmId
    && actual.subjectId === expected.subjectId
    && actual.roleId === expected.roleId
    && actual.resourceId === expected.resourceId
    && actual.propagation === expected.propagation
    && actual.validFrom === undefined
    && actual.validUntil === undefined
    && actual.constraints === undefined
    && actual.protected !== true;
}

function realmAdministratorBinding(
  state: AuthorizationPolicyState,
  realmId: string,
  subjectId: string,
): AuthorizationBindingRecord {
  const roleId = `authorization:${realmId}:role:content-administrator`;
  return {
    id: realmDefaultRoleBindingId(realmId, subjectId, roleId),
    realmId,
    subjectId,
    roleId,
    resourceId: state.realm.rootResourceId,
    propagation: "self-and-children",
  };
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof ApplicationError && (
    error.code === "POLICY_REVISION_CONFLICT"
    || error.code === "AUTHORIZATION_POLICY_REVISION_CONFLICT"
  );
}
