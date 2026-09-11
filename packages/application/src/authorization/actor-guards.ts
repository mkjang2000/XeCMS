import { ApplicationError } from "../errors.js";
import { SYSTEM_AUTHORIZATION_REALM_ID, authorizationOwnerLevelId } from "./identifiers.js";
import type {
  AuthorizationLevelRecord,
  AuthorizationRoleRecord,
  AuthorizationBindingRecord,
  AuthorizationPolicyState,
  AuthorizationActor,
  RealmAdministrationActor,
  AuthorizationPolicyManagementActor,
  AuthorizationDecisionRecord,
} from "./types.js";
import { protectedTarget, protectedInput } from "./validation.js";

export function realmFullAccessManagementDecision(
  actor: AuthorizationPolicyManagementActor,
  action: string,
  resourceId: string,
): AuthorizationDecisionRecord | null {
  if (!isRealmFullAccessActor(actor)) return null;
  assertContentRealmAdministration(actor);
  const sourceId = `authorization:${actor.realmId}:realm-full-access`;
  return {
    allowed: true,
    action,
    reasonCode: "ALLOW_REALM_FULL_ACCESS",
    matchedGrants: [{
      sourceKind: "realm-full-access",
      sourceRealmId: actor.realmId,
      permission: action,
      sourceRoleId: `${sourceId}:role`,
      sourceLevelId: `${sourceId}:level`,
      sourceRank: 0,
      sourceBindingId: actor.fullAccessBindingId,
      sourceScope: { resourceId, propagation: "self-and-children" },
      membershipPath: [],
    }],
    evaluatedScope: { resourceId, propagation: "self" },
  };
}

export function isRealmAdministrationActor(
  actor: AuthorizationPolicyManagementActor,
): actor is RealmAdministrationActor {
  return "accessMode" in actor;
}

export function isControlPlaneAdministrationActor(
  actor: AuthorizationPolicyManagementActor,
): actor is Exclude<RealmAdministrationActor, { readonly accessMode: "realm-actor" }> {
  return isRealmAdministrationActor(actor) && actor.accessMode !== "realm-actor";
}

function isRealmFullAccessActor(
  actor: AuthorizationPolicyManagementActor,
): actor is Extract<RealmAdministrationActor, { readonly accessMode: "realm-full-access" }> {
  return isRealmAdministrationActor(actor) && actor.accessMode === "realm-full-access";
}

export function realmPolicyActor(actor: AuthorizationPolicyManagementActor): AuthorizationActor {
  if (!isRealmAdministrationActor(actor)) return actor;
  if (actor.accessMode === "realm-actor") {
    return { realmId: actor.realmId, subjectId: actor.subjectId };
  }
  throw new ApplicationError(
    "REALM_SUBJECT_ACTOR_REQUIRED",
    403,
    "This operation requires a Realm-local authorization Subject.",
  );
}

export function assertContentRealmAdministration(actor: RealmAdministrationActor): void {
  if (actor.realmId === SYSTEM_AUTHORIZATION_REALM_ID) {
    throw new ApplicationError(
      "REALM_ADMINISTRATION_CONTENT_REALM_REQUIRED",
      403,
      "Control-plane Realm administration cannot target the System Realm.",
    );
  }
}

export function assertRoleMutationUnprotected(
  state: AuthorizationPolicyState,
  role: AuthorizationRoleRecord,
): void {
  const level = state.authorityLevels.find(({ id }) => id === role.levelId);
  if (role.protected === true || level?.protected === true) protectedTarget("role", role.id);
}

export function assertBindingMutationUnprotected(
  state: AuthorizationPolicyState,
  binding: AuthorizationBindingRecord,
): void {
  const subject = state.subjects.find(({ id }) => id === binding.subjectId);
  const role = state.roles.find(({ id }) => id === binding.roleId);
  const level = role === undefined
    ? undefined
    : state.authorityLevels.find(({ id }) => id === role.levelId);
  if (
    binding.protected === true
    || subject?.protected === true
    || role?.protected === true
    || level?.protected === true
  ) protectedTarget("binding", binding.id);
}

export function assertSubjectMutationUnprotected(state: AuthorizationPolicyState, subjectId: string): void {
  const subject = state.subjects.find(({ id }) => id === subjectId);
  const protectedGrant = state.bindings.some((binding) => {
    if (binding.subjectId !== subjectId) return false;
    const role = state.roles.find(({ id }) => id === binding.roleId);
    const level = role === undefined
      ? undefined
      : state.authorityLevels.find(({ id }) => id === role.levelId);
    return binding.protected === true || role?.protected === true || level?.protected === true;
  });
  if (subject?.protected === true || protectedGrant) protectedTarget("subject", subjectId);
}

export function assertManageableLevel(
  state: AuthorizationPolicyState,
  level: AuthorizationLevelRecord,
  replacedId: string | undefined,
): void {
  if (level.protected === true) protectedInput("authority level");
  const ownerRank = state.authorityLevels.find(
    ({ id }) => id === authorizationOwnerLevelId(state.realm.id),
  )?.rank;
  if (ownerRank !== undefined && level.rank >= ownerRank) {
    throw new ApplicationError(
      "AUTHORITY_LEVEL_RANK_NOT_LOWER",
      403,
      `Managed authority levels must remain below the protected owner rank '${ownerRank}'.`,
    );
  }
  if (state.authorityLevels.some((candidate) =>
    candidate.id !== replacedId && candidate.rank === level.rank)) {
    throw new ApplicationError(
      "DUPLICATE_AUTHORITY_LEVEL_RANK",
      409,
      `Authority level rank '${level.rank}' is already in use.`,
    );
  }
}
