import { ApplicationError } from "../errors.js";
import {
  isControlPlaneAdministrationActor,
  realmPolicyActor,
  assertSubjectMutationUnprotected,
  assertManageableLevel,
} from "./actor-guards.js";
import type { AuthorizationPolicyContext } from "./policy-context.js";
import type {
  AuthorizationSubjectRecord,
  AuthorizationLevelRecord,
  AuthorizationGroupMembershipRecord,
  AuthorizationActor,
  AuthorizationPolicyManagementActor,
  AuthorizationMutationResult,
  NewAuthorizationSubjectRecord,
  NewAuthorizationLevelRecord,
  NewAuthorizationGroupMembershipRecord,
} from "./types.js";
import {
  validateLevelRecord,
  validateSubjectRecord,
  validateGroupMembershipRecord,
  assertValidGroupMembership,
  requireRecord,
  identityChange,
  protectedTarget,
  protectedInput,
} from "./validation.js";

type AuthorizationSubjectManagementDependencies = Pick<AuthorizationPolicyContext,
  "commit" | "loadForMutation" | "requireOwnerManagement" | "runtime"
>;

export class AuthorizationSubjectManagement {
  public constructor(
    private readonly context: AuthorizationSubjectManagementDependencies,
  ) {}

  public async createLevel(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly level: NewAuthorizationLevelRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationLevelRecord>> {
    const level: AuthorizationLevelRecord = {
      ...input.level,
      id: input.level.id ?? this.context.runtime.newId("level"),
    };
    validateLevelRecord(level, actor.realmId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    assertManageableLevel(entry.state, level, undefined);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "authority-level.create", value: level },
      "authority-level",
      level.id,
      null,
      level,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.authorityLevels, level.id, "authority level"),
    };
  }

  public async updateLevel(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly levelId: string;
      readonly level: AuthorizationLevelRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationLevelRecord>> {
    validateLevelRecord(input.level, actor.realmId);
    if (input.level.id !== input.levelId) identityChange("authority level", input.levelId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.authorityLevels, input.levelId, "authority level");
    if (before.protected === true || input.level.protected === true) protectedTarget("authority level", input.levelId);
    assertManageableLevel(entry.state, input.level, input.levelId);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "authority-level.update", value: input.level },
      "authority-level",
      input.levelId,
      before,
      input.level,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.authorityLevels, input.levelId, "authority level"),
    };
  }

  public async deleteLevel(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly levelId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.authorityLevels, input.levelId, "authority level");
    if (before.protected === true) protectedTarget("authority level", input.levelId);
    if (entry.state.roles.some(({ levelId }) => levelId === input.levelId)) {
      throw new ApplicationError(
        "AUTHORITY_LEVEL_IN_USE",
        409,
        `Authority level '${input.levelId}' cannot be deleted while roles reference it.`,
      );
    }
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "authority-level.delete", id: input.levelId },
      "authority-level",
      input.levelId,
      before,
      null,
      decision,
    );
    return { revision: persisted.revision, value: { id: input.levelId } };
  }

  public async createSubject(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly subject: NewAuthorizationSubjectRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationSubjectRecord>> {
    if ("identityId" in input.subject) {
      throw new ApplicationError(
        "SUBJECT_IDENTITY_LINK_NOT_ALLOWED",
        422,
        "Global Identity linkage is managed by the internal Realm provisioning workflow.",
      );
    }
    const subject: AuthorizationSubjectRecord = {
      ...input.subject,
      id: input.subject.id ?? this.context.runtime.newId("subject"),
    };
    validateSubjectRecord(subject, actor.realmId);
    if (subject.protected === true) protectedInput("subject");
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "subject.create", value: subject },
      "subject",
      subject.id,
      null,
      subject,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.subjects, subject.id, "subject"),
    };
  }

  /**
   * Trusted Realm provisioning path for the Identity → Subject projection.
   * Unlike ordinary Subject creation it accepts an internal identityId, while
   * retaining the protected Owner authorization decision and normal audit/CAS
   * commit. Existing links are verified rather than rewritten.
   */
  public async ensureProvisionedIdentitySubject(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly subjectId: string;
      readonly identityId: string;
      readonly name: string;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationSubjectRecord>> {
    const subject: AuthorizationSubjectRecord = {
      id: input.subjectId,
      realmId: actor.realmId,
      identityId: input.identityId,
      name: input.name,
      type: "user",
    };
    validateSubjectRecord(subject, actor.realmId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const linked = entry.state.subjects.find(({ identityId }) => identityId === input.identityId);
    const existing = entry.state.subjects.find(({ id }) => id === input.subjectId);
    if (existing !== undefined) {
      if (
        existing.identityId !== input.identityId
        || existing.type !== "user"
        || existing.protected === true
        || existing.disabled === true
        || (linked !== undefined && linked.id !== existing.id)
      ) {
        throw new ApplicationError(
          "REALM_SUBJECT_IDENTITY_MISMATCH",
          409,
          `Subject '${input.subjectId}' is not the active Realm user linked to Identity '${input.identityId}'.`,
        );
      }
      return { revision: entry.state.revision, value: existing };
    }
    if (linked !== undefined) {
      throw new ApplicationError(
        "REALM_IDENTITY_SUBJECT_CONFLICT",
        409,
        `Identity '${input.identityId}' is already linked to Subject '${linked.id}' in this Realm.`,
      );
    }
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "subject.create", value: subject },
      "subject",
      subject.id,
      null,
      subject,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.subjects, subject.id, "subject"),
    };
  }

  public async updateSubject(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly subjectId: string;
      /** Identity linkage is maintained by the internal provisioning path. */
      readonly subject: Omit<AuthorizationSubjectRecord, "identityId">;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationSubjectRecord>> {
    if ("identityId" in input.subject) {
      throw new ApplicationError(
        "SUBJECT_IDENTITY_LINK_NOT_ALLOWED",
        422,
        "Global Identity linkage is managed by the internal Realm provisioning workflow.",
      );
    }
    validateSubjectRecord(input.subject, actor.realmId);
    if (input.subject.id !== input.subjectId) identityChange("subject", input.subjectId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.subjects, input.subjectId, "subject");
    assertSubjectMutationUnprotected(entry.state, input.subjectId);
    if (before.protected === true || input.subject.protected === true) protectedTarget("subject", input.subjectId);
    if (before.type !== input.subject.type) identityChange("subject type", input.subjectId);
    const subject: AuthorizationSubjectRecord = {
      ...input.subject,
      ...(before.identityId === undefined ? {} : { identityId: before.identityId }),
    };
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "subject.update", value: subject },
      "subject",
      input.subjectId,
      before,
      subject,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.subjects, input.subjectId, "subject"),
    };
  }

  public async deleteSubject(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly subjectId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.subjects, input.subjectId, "subject");
    assertSubjectMutationUnprotected(entry.state, input.subjectId);
    if (before.protected === true) protectedTarget("subject", input.subjectId);
    if (!isControlPlaneAdministrationActor(actor) && input.subjectId === realmPolicyActor(actor).subjectId) {
      throw new ApplicationError("SELF_SUBJECT_MUTATION", 403, "An actor cannot delete its own subject.");
    }
    if (entry.state.bindings.some(({ subjectId }) => subjectId === input.subjectId)) {
      throw new ApplicationError("SUBJECT_IN_USE", 409, `Subject '${input.subjectId}' has role bindings.`);
    }
    if (entry.state.groupMemberships.some(({ memberSubjectId, groupSubjectId }) =>
      memberSubjectId === input.subjectId || groupSubjectId === input.subjectId)) {
      throw new ApplicationError("SUBJECT_IN_USE", 409, `Subject '${input.subjectId}' has group memberships.`);
    }
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "subject.delete", id: input.subjectId },
      "subject",
      input.subjectId,
      before,
      null,
      decision,
    );
    return { revision: persisted.revision, value: { id: input.subjectId } };
  }

  public async createGroupMembership(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly membership: NewAuthorizationGroupMembershipRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationGroupMembershipRecord>> {
    const membership: AuthorizationGroupMembershipRecord = {
      ...input.membership,
      id: input.membership.id ?? this.context.runtime.newId("membership"),
    };
    validateGroupMembershipRecord(membership, actor.realmId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    assertSubjectMutationUnprotected(entry.state, membership.memberSubjectId);
    assertSubjectMutationUnprotected(entry.state, membership.groupSubjectId);
    assertValidGroupMembership(entry.state, membership, undefined);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "group-membership.create", value: membership },
      "group-membership",
      membership.id,
      null,
      membership,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.groupMemberships, membership.id, "group membership"),
    };
  }

  public async updateGroupMembership(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly membershipId: string;
      readonly membership: AuthorizationGroupMembershipRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationGroupMembershipRecord>> {
    validateGroupMembershipRecord(input.membership, actor.realmId);
    if (input.membership.id !== input.membershipId) identityChange("group membership", input.membershipId);
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.groupMemberships, input.membershipId, "group membership");
    assertSubjectMutationUnprotected(entry.state, before.memberSubjectId);
    assertSubjectMutationUnprotected(entry.state, before.groupSubjectId);
    assertSubjectMutationUnprotected(entry.state, input.membership.memberSubjectId);
    assertSubjectMutationUnprotected(entry.state, input.membership.groupSubjectId);
    assertValidGroupMembership(entry.state, input.membership, input.membershipId);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "group-membership.update", value: input.membership },
      "group-membership",
      input.membershipId,
      before,
      input.membership,
      decision,
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.groupMemberships, input.membershipId, "group membership"),
    };
  }

  public async deleteGroupMembership(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly membershipId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const decision = this.context.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.groupMemberships, input.membershipId, "group membership");
    assertSubjectMutationUnprotected(entry.state, before.memberSubjectId);
    assertSubjectMutationUnprotected(entry.state, before.groupSubjectId);
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "group-membership.delete", id: input.membershipId },
      "group-membership",
      input.membershipId,
      before,
      null,
      decision,
    );
    return { revision: persisted.revision, value: { id: input.membershipId } };
  }
}
