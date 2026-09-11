import { ApplicationError } from "../errors.js";
import type { AuthorizationPolicyState, AuthorizationPolicyMutation } from "./types.js";

export function applyPolicyMutation(
  state: AuthorizationPolicyState,
  mutation: AuthorizationPolicyMutation,
): AuthorizationPolicyState {
  const nextRevision = state.revision + 1;
  switch (mutation.type) {
    case "subject.create":
      return { ...state, revision: nextRevision, subjects: [...state.subjects, mutation.value] };
    case "subject.update":
      return { ...state, revision: nextRevision, subjects: replaceRecord(state.subjects, mutation.value) };
    case "subject.delete":
      return { ...state, revision: nextRevision, subjects: removeRecord(state.subjects, mutation.id) };
    case "resource.upsert":
      return {
        ...state,
        revision: nextRevision,
        resources: state.resources.some(({ id }) => id === mutation.value.id)
          ? replaceRecord(state.resources, mutation.value)
          : [...state.resources, mutation.value],
      };
    case "resource.delete":
      return { ...state, revision: nextRevision, resources: removeRecord(state.resources, mutation.id) };
    case "resource.reconcile": {
      const deleteIds = new Set(mutation.deleteIds);
      const upsertIds = new Set(mutation.upserts.map(({ id }) => id));
      if ([...deleteIds].some((id) => upsertIds.has(id))) {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_RECONCILE_INVALID",
          422,
          "A reconciled resource cannot be upserted and deleted in the same mutation.",
        );
      }
      const retained = state.resources.filter(({ id }) => !deleteIds.has(id) && !upsertIds.has(id));
      return {
        ...state,
        revision: nextRevision,
        resources: [...retained, ...mutation.upserts],
      };
    }
    case "authority-level.create":
      return { ...state, revision: nextRevision, authorityLevels: [...state.authorityLevels, mutation.value] };
    case "authority-level.update":
      return {
        ...state,
        revision: nextRevision,
        authorityLevels: replaceRecord(state.authorityLevels, mutation.value),
      };
    case "authority-level.delete":
      return {
        ...state,
        revision: nextRevision,
        authorityLevels: removeRecord(state.authorityLevels, mutation.id),
      };
    case "role.create":
      return { ...state, revision: nextRevision, roles: [...state.roles, mutation.value] };
    case "role.update":
      return { ...state, revision: nextRevision, roles: replaceRecord(state.roles, mutation.value) };
    case "role.delete":
      return { ...state, revision: nextRevision, roles: removeRecord(state.roles, mutation.id) };
    case "binding.create":
      return { ...state, revision: nextRevision, bindings: [...state.bindings, mutation.value] };
    case "binding.update":
      return { ...state, revision: nextRevision, bindings: replaceRecord(state.bindings, mutation.value) };
    case "binding.delete":
      return { ...state, revision: nextRevision, bindings: removeRecord(state.bindings, mutation.id) };
    case "binding.replace-primary-owner":
      return {
        ...state,
        revision: nextRevision,
        bindings: [
          ...state.bindings.filter(({ roleId }) => roleId !== mutation.value.roleId),
          mutation.value,
        ],
      };
    case "group-membership.create":
      return {
        ...state,
        revision: nextRevision,
        groupMemberships: [...state.groupMemberships, mutation.value],
      };
    case "group-membership.update":
      return {
        ...state,
        revision: nextRevision,
        groupMemberships: replaceRecord(state.groupMemberships, mutation.value),
      };
    case "group-membership.delete":
      return {
        ...state,
        revision: nextRevision,
        groupMemberships: removeRecord(state.groupMemberships, mutation.id),
      };
  }
}

function replaceRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  value: TRecord,
): readonly TRecord[] {
  let replaced = false;
  const result = records.map((record) => {
    if (record.id !== value.id) return record;
    replaced = true;
    return value;
  });
  if (!replaced) {
    throw new ApplicationError("AUTHORIZATION_OBJECT_NOT_FOUND", 404, `Object '${value.id}' was not found.`);
  }
  return result;
}

function removeRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  id: string,
): readonly TRecord[] {
  const result = records.filter((record) => record.id !== id);
  if (result.length === records.length) {
    throw new ApplicationError("AUTHORIZATION_OBJECT_NOT_FOUND", 404, `Object '${id}' was not found.`);
  }
  return result;
}
