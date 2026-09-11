import {
  asPermissionKey,
  asRoleBindingId,
  asRoleId,
  asSubjectId,
  authorizeRoleBindingCreate,
  authorizeRoleBindingRemove,
  authorizeRoleBindingUpdate,
  authorizeRoleCreate,
  authorizeRoleDelete,
  authorizeRoleUpdate,
} from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import {
  realmFullAccessManagementDecision,
  realmPolicyActor,
  assertRoleMutationUnprotected,
  assertBindingMutationUnprotected,
} from "./actor-guards.js";
import type { AuthorizationPolicyContext } from "./policy-context.js";
import { toKernelRole, toKernelBinding, plainDecision } from "./policy-kernel.js";
import type {
  AuthorizationRoleRecord,
  AuthorizationBindingRecord,
  AuthorizationPolicyManagementActor,
  AuthorizationMutationResult,
  NewAuthorizationRoleRecord,
  NewAuthorizationBindingRecord,
} from "./types.js";
import {
  validateRoleRecord,
  validateBindingRecord,
  assertResourceAcceptsPolicy,
  requireRecord,
  identityChange,
  authorizationDenied,
} from "./validation.js";

type AuthorizationRoleBindingManagementDependencies = Pick<AuthorizationPolicyContext,
  "commit" | "loadForMutation" | "runtime"
>;

export class AuthorizationRoleBindingManagement {
  public constructor(
    private readonly context: AuthorizationRoleBindingManagementDependencies,
  ) {}

  public async createRole(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly role: NewAuthorizationRoleRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationRoleRecord>> {
    const role: AuthorizationRoleRecord = {
      ...input.role,
      id: input.role.id ?? this.context.runtime.newId("role"),
    };
    validateRoleRecord(role, actor.realmId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    (role.fieldAccess ?? []).forEach(({ resourceId }) => assertResourceAcceptsPolicy(entry.state, resourceId));
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      "role.create",
      entry.state.realm.rootResourceId,
    );
    assertRoleMutationUnprotected(entry.state, role);
    const decision = fullAccessDecision ?? plainDecision(authorizeRoleCreate(entry.snapshot, {
      actorSubjectId: asSubjectId(realmPolicyActor(actor).subjectId),
      role: toKernelRole(role),
      action: asPermissionKey("role.create"),
      now: this.context.runtime.now(),
    }));
    if (fullAccessDecision === null && !decision.allowed) authorizationDenied(decision);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "role.create", value: role },
      "role",
      role.id,
      null,
      role,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.roles, role.id, "role"),
    };
  }

  public async updateRole(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly roleId: string;
      readonly role: AuthorizationRoleRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationRoleRecord>> {
    validateRoleRecord(input.role, actor.realmId);
    if (input.role.id !== input.roleId) identityChange("role", input.roleId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    (input.role.fieldAccess ?? []).forEach(({ resourceId }) =>
      assertResourceAcceptsPolicy(entry.state, resourceId));
    const before = requireRecord(entry.state.roles, input.roleId, "role");
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      "role.update",
      entry.state.realm.rootResourceId,
    );
    assertRoleMutationUnprotected(entry.state, before);
    assertRoleMutationUnprotected(entry.state, input.role);
    const decision = fullAccessDecision ?? plainDecision(authorizeRoleUpdate(entry.snapshot, {
      actorSubjectId: asSubjectId(realmPolicyActor(actor).subjectId),
      roleId: asRoleId(input.roleId),
      nextRole: toKernelRole(input.role),
      action: asPermissionKey("role.update"),
      now: this.context.runtime.now(),
    }));
    if (fullAccessDecision === null && !decision.allowed) authorizationDenied(decision);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "role.update", value: input.role },
      "role",
      input.roleId,
      before,
      input.role,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.roles, input.roleId, "role"),
    };
  }

  public async deleteRole(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly roleId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const before = requireRecord(entry.state.roles, input.roleId, "role");
    if (entry.state.bindings.some(({ roleId }) => roleId === input.roleId)) {
      throw new ApplicationError(
        "ROLE_IN_USE",
        409,
        `Role '${input.roleId}' cannot be deleted while bindings reference it.`,
      );
    }
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      "role.delete",
      entry.state.realm.rootResourceId,
    );
    assertRoleMutationUnprotected(entry.state, before);
    const decision = fullAccessDecision ?? plainDecision(authorizeRoleDelete(entry.snapshot, {
      actorSubjectId: asSubjectId(realmPolicyActor(actor).subjectId),
      roleId: asRoleId(input.roleId),
      action: asPermissionKey("role.delete"),
      now: this.context.runtime.now(),
    }));
    if (fullAccessDecision === null && !decision.allowed) authorizationDenied(decision);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "role.delete", id: input.roleId },
      "role",
      input.roleId,
      before,
      null,
      decision,
    );
    return { revision: persisted.revision, value: { id: input.roleId } };
  }

  public async createBinding(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly binding: NewAuthorizationBindingRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationBindingRecord>> {
    const binding: AuthorizationBindingRecord = {
      ...input.binding,
      id: input.binding.id ?? this.context.runtime.newId("binding"),
    };
    validateBindingRecord(binding, actor.realmId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    assertResourceAcceptsPolicy(entry.state, binding.resourceId);
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      "role.assign",
      binding.resourceId,
    );
    assertBindingMutationUnprotected(entry.state, binding);
    const decision = fullAccessDecision ?? plainDecision(authorizeRoleBindingCreate(entry.snapshot, {
      actorSubjectId: asSubjectId(realmPolicyActor(actor).subjectId),
      binding: toKernelBinding(binding),
      action: asPermissionKey("role.assign"),
      now: this.context.runtime.now(),
    }));
    if (fullAccessDecision === null && !decision.allowed) authorizationDenied(decision);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "binding.create", value: binding },
      "binding",
      binding.id,
      null,
      binding,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.bindings, binding.id, "binding"),
    };
  }

  public async updateBinding(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly bindingId: string;
      readonly binding: AuthorizationBindingRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationBindingRecord>> {
    validateBindingRecord(input.binding, actor.realmId);
    if (input.binding.id !== input.bindingId) identityChange("binding", input.bindingId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    assertResourceAcceptsPolicy(entry.state, input.binding.resourceId);
    const before = requireRecord(entry.state.bindings, input.bindingId, "binding");
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      "role.assign",
      input.binding.resourceId,
    );
    assertBindingMutationUnprotected(entry.state, before);
    assertBindingMutationUnprotected(entry.state, input.binding);
    const decision = fullAccessDecision ?? plainDecision(authorizeRoleBindingUpdate(entry.snapshot, {
      actorSubjectId: asSubjectId(realmPolicyActor(actor).subjectId),
      bindingId: asRoleBindingId(input.bindingId),
      nextBinding: toKernelBinding(input.binding),
      action: asPermissionKey("role.assign"),
      now: this.context.runtime.now(),
    }));
    if (fullAccessDecision === null && !decision.allowed) authorizationDenied(decision);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "binding.update", value: input.binding },
      "binding",
      input.bindingId,
      before,
      input.binding,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.bindings, input.bindingId, "binding"),
    };
  }

  public async deleteBinding(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly bindingId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const before = requireRecord(entry.state.bindings, input.bindingId, "binding");
    const fullAccessDecision = realmFullAccessManagementDecision(
      actor,
      "role.assign",
      before.resourceId,
    );
    assertBindingMutationUnprotected(entry.state, before);
    const decision = fullAccessDecision ?? plainDecision(authorizeRoleBindingRemove(entry.snapshot, {
      actorSubjectId: asSubjectId(realmPolicyActor(actor).subjectId),
      bindingId: asRoleBindingId(input.bindingId),
      action: asPermissionKey("role.assign"),
      now: this.context.runtime.now(),
    }));
    if (fullAccessDecision === null && !decision.allowed) authorizationDenied(decision);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "binding.delete", id: input.bindingId },
      "binding",
      input.bindingId,
      before,
      null,
      decision,
    );
    return { revision: persisted.revision, value: { id: input.bindingId } };
  }
}
