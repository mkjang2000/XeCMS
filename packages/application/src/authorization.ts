import { AuthorizationPolicyContext } from "./authorization/policy-context.js";
import { AuthorizationEntitlementCeiling } from "./authorization/entitlement-ceiling.js";
import { AuthorizationAccessEvaluation } from "./authorization/access-evaluation.js";
import { AuthorizationOwnerCommands } from "./authorization/owner-commands.js";
import { AuthorizationResourceProjection } from "./authorization/resource-projection.js";
import { AuthorizationResourceImpact } from "./authorization/resource-impact.js";
import { AuthorizationRoleBindingManagement } from "./authorization/role-binding-management.js";
import { AuthorizationSubjectManagement } from "./authorization/subject-management.js";
import type { FieldAccessMode } from "@xecms/authorization";
import type { RealmCollectionEntitlementStore } from "./realm-collection-entitlements.js";
import type {
  AuthorizationSubjectRecord,
  AuthorizationResourceRecord,
  AuthorizationLevelRecord,
  AuthorizationRoleRecord,
  AuthorizationBindingRecord,
  AuthorizationGroupMembershipRecord,
  AuthorizationPolicyState,
  RealmPrimaryOwnerStatus,
  AuthorizationAuditPage,
  AuthorizationStore,
  AuthorizationRuntime,
  AuthorizationActor,
  AuthorizationPolicyManagementActor,
  RealmOwnerCommandActor,
  AuthorizationEvaluationContext,
  AuthorizationDecisionRecord,
  AuthorizationFieldDecisionRecord,
  AuthorizationBatchCheck,
  AuthorizationBatchEvaluation,
  AuthorizationMutationResult,
  ContentResourceProjectionInput,
  ContentResourceProjectionReconcileResult,
  ResourceParentChangePreview,
  NewAuthorizationSubjectRecord,
  NewAuthorizationLevelRecord,
  NewAuthorizationRoleRecord,
  NewAuthorizationBindingRecord,
  NewAuthorizationGroupMembershipRecord,
  InitialAuthorizationPolicyInput,
} from "./authorization/types.js";

export type {
  AuthorizationRealmRecord,
  AuthorizationSubjectRecord,
  AuthorizationResourceRecord,
  AuthorizationLevelRecord,
  AuthorizationFieldAccessRecord,
  AuthorizationRoleRecord,
  AuthorizationBindingConstraintsRecord,
  AuthorizationBindingRecord,
  AuthorizationGroupMembershipRecord,
  AuthorizationPermissionRecord,
  AuthorizationPolicySeed,
  AuthorizationPolicyState,
  RealmPrimaryOwnerStatus,
  AuthorizationAuditTargetType,
  AuthorizationAuditDraft,
  AuthorizationAuditRecord,
  AuthorizationAuditPage,
  AuthorizationPolicyMutation,
  AuthorizationStore,
  AuthorizationRuntime,
  AuthorizationActor,
  RealmAdministrationActor,
  AuthorizationPolicyManagementActor,
  AuthorizationAuditAccessMode,
  RealmOwnerCommandActor,
  AuthorizationEvaluationContext,
  AuthorizationGrantRecord,
  AuthorizationDecisionRecord,
  AuthorizationFieldGrantRecord,
  AuthorizationFieldDecisionRecord,
  AuthorizationBatchCheck,
  AuthorizationBatchResultItem,
  AuthorizationBatchEvaluation,
  AuthorizationMutationResult,
  ContentResourceProjectionInput,
  ContentResourceProjectionReconcileResult,
  EffectivePermissionChangeRecord,
  EffectiveFieldAccessChangeRecord,
  ResourceParentChangePreview,
  NewAuthorizationSubjectRecord,
  NewAuthorizationLevelRecord,
  NewAuthorizationRoleRecord,
  NewAuthorizationBindingRecord,
  NewAuthorizationGroupMembershipRecord,
  InitialAuthorizationPolicyInput,
} from "./authorization/types.js";
export { DEFAULT_PERMISSION_CATALOG } from "./authorization/permission-catalog.js";
export {
  AUTHORIZATION_MANAGE_PERMISSION,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  SYSTEM_SCHEMA_RESOURCE_ID,
  SYSTEM_CONTENT_RESOURCE_ID,
  SYSTEM_AUTHORIZATION_RESOURCE_ID,
  SYSTEM_AUDIT_RESOURCE_ID,
  SYSTEM_PUBLIC_SUBJECT_ID,
  authorizationOwnerLevelId,
  authorizationOwnerRoleId,
  authorizationPrimaryOwnerBindingId,
  authorizationSystemPolicyRootLevelId,
  authorizationSystemPolicyRootRoleId,
  authorizationSystemPolicyRootBindingId,
  collectionResourceId,
  documentResourceId,
  realmCollectionResourceId,
  realmDocumentResourceId,
  collectionAuthorizationResourceId,
  realmCollectionResourcePrefix,
  realmDocumentResourcePrefix,
} from "./authorization/identifiers.js";
export { createInitialAuthorizationPolicy } from "./authorization/initial-policy.js";
export { applyPolicyMutation } from "./authorization/policy-mutation.js";

/** Stable application API; internal modules share one policy cache and CAS/audit context. */
export class AuthorizationApplicationService {
  private readonly accessEvaluation: AuthorizationAccessEvaluation;
  private readonly ownerCommands: AuthorizationOwnerCommands;
  private readonly resourceProjection: AuthorizationResourceProjection;
  private readonly resourceImpact: AuthorizationResourceImpact;
  private readonly roleBindingManagement: AuthorizationRoleBindingManagement;
  private readonly subjectManagement: AuthorizationSubjectManagement;

  public constructor(
    store: AuthorizationStore,
    runtime: AuthorizationRuntime,
    // Required: the collection-entitlement ceiling is read on the judgement path.
    // A missing store is a wiring error, never a reason to skip the gate.
    entitlementStore: RealmCollectionEntitlementStore,
  ) {
    const context = new AuthorizationPolicyContext(store, runtime);
    const ceiling = new AuthorizationEntitlementCeiling(entitlementStore);
    this.accessEvaluation = new AuthorizationAccessEvaluation(context, ceiling);
    this.ownerCommands = new AuthorizationOwnerCommands(context);
    this.resourceProjection = new AuthorizationResourceProjection(context, this.accessEvaluation);
    this.resourceImpact = new AuthorizationResourceImpact(context);
    this.roleBindingManagement = new AuthorizationRoleBindingManagement(context);
    this.subjectManagement = new AuthorizationSubjectManagement(context);
  }

  public async initialize(
    input: InitialAuthorizationPolicyInput,
  ): Promise<AuthorizationPolicyState> {
    return this.ownerCommands.initialize(input);
  }

  public async getPolicy(actor: AuthorizationPolicyManagementActor): Promise<AuthorizationPolicyState> {
    return this.accessEvaluation.getPolicy(actor);
  }

  /** Internal CAS key for system-maintained projections; does not expose policy data. */
  public async currentPolicyRevision(realmId: string): Promise<number> {
    return this.ownerCommands.currentPolicyRevision(realmId);
  }

  /**
   * Trusted provisioning read. It is intentionally not wired to HTTP routes;
   * Realm bootstrap needs to distinguish an uninitialized revision-0 policy
   * from an initialized policy before a protected Subject exists.
   */
  public async loadTrustedProvisioningPolicy(
    realmId: string,
  ): Promise<AuthorizationPolicyState | null> {
    return this.ownerCommands.loadTrustedProvisioningPolicy(realmId);
  }

  /** Trusted control-plane read; caller must authenticate the CMS Owner boundary. */
  public async getTrustedPrimaryRealmOwner(realmId: string): Promise<RealmPrimaryOwnerStatus> {
    return this.ownerCommands.getTrustedPrimaryRealmOwner(realmId);
  }

  /**
   * Assigns, transfers, or repairs the single human Primary Owner Binding.
   * This is deliberately outside ordinary Role Binding authorization: the Owner
   * Role is protected and non-assignable there. The deterministic Binding is
   * created or retargeted by one policy CAS mutation, so transfer never exposes
   * an intermediate ownerless revision. Membership/Identity eligibility beyond
   * the policy projection must be checked transactionally by the caller/store.
   */
  public async setTrustedPrimaryRealmOwner(
    actor: RealmOwnerCommandActor,
    input: {
      readonly expectedRevision: number;
      readonly subjectId: string;
      readonly operation: "assign" | "transfer" | "recover";
    },
  ): Promise<RealmPrimaryOwnerStatus> {
    return this.ownerCommands.setTrustedPrimaryRealmOwner(actor, input);
  }

  /**
   * Parent-changing hierarchy moves can change Binding/FieldAccess applicability.
   * M3 deliberately uses the protected Owner guard until a rank/delegation-aware
   * move-management command is introduced.
   */
  public async requireHierarchyPolicyManagement(actor: AuthorizationActor): Promise<void> {
    return this.ownerCommands.requireHierarchyPolicyManagement(actor);
  }

  public async authorize(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationDecisionRecord> {
    return this.accessEvaluation.authorize(actor, input);
  }

  public async require(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationDecisionRecord> {
    return this.accessEvaluation.require(actor, input);
  }

  /**
   * Evaluates a target-subject management permission with the same rank and
   * protected-target rules used by authorization policy mutations.
   */
  public async requireSubjectManagement(
    actor: AuthorizationActor,
    input: { readonly action: string; readonly targetSubjectId: string },
  ): Promise<AuthorizationDecisionRecord> {
    return this.accessEvaluation.requireSubjectManagement(actor, input);
  }

  /** Simulation deliberately calls the same production path and uses the same cache. */
  public async simulate(
    requestingActor: AuthorizationPolicyManagementActor,
    input: {
      readonly subjectId: string;
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
      readonly at?: string;
    },
  ): Promise<AuthorizationDecisionRecord> {
    return this.accessEvaluation.simulate(requestingActor, input);
  }

  public async evaluateField(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly field: string;
      readonly access: FieldAccessMode;
      /** Permission whose granting roles participate in the field decision. */
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationFieldDecisionRecord> {
    return this.accessEvaluation.evaluateField(actor, input);
  }

  /**
   * Evaluates the authenticated Subject's UI access profile in one immutable
   * policy snapshot. It intentionally cannot proxy evaluation for another
   * Subject; administrators already have the separately authorized simulator.
   */
  public async evaluateBatch(
    actor: AuthorizationActor,
    input: { readonly checks: readonly AuthorizationBatchCheck[] },
  ): Promise<AuthorizationBatchEvaluation> {
    return this.accessEvaluation.evaluateBatch(actor, input);
  }

  public async filterReadableData<TData extends Readonly<Record<string, unknown>>>(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly data: TData;
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<Partial<TData>> {
    return this.accessEvaluation.filterReadableData(actor, input);
  }

  public async assertWritableData(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly data: Readonly<Record<string, unknown>>;
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<void> {
    return this.accessEvaluation.assertWritableData(actor, input);
  }

  public async listAudit(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<AuthorizationAuditPage> {
    return this.accessEvaluation.listAudit(actor, input);
  }

  public async syncCollectionResource(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly collectionId: string;
      readonly collectionName: string;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationResourceRecord>> {
    return this.resourceProjection.syncCollectionResource(actor, input);
  }

  public async syncCoreResources(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly collections: readonly {
        readonly id: string;
        readonly name: string;
        readonly parentResourceId?: string;
      }[];
    },
  ): Promise<AuthorizationPolicyState> {
    return this.resourceProjection.syncCoreResources(actor, input);
  }

  /**
   * Reconciles the materialized content hierarchy with the authorization graph.
   * The store commits every upsert/delete, dependent-policy cleanup, closure
   * rebuild, revision increment and audit row in one transaction.
   */
  public async reconcileContentHierarchyResources(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      /** Collections owned by this projection, including disabled hierarchy collections. */
      readonly managedCollectionIds: readonly string[];
      readonly projections: readonly ContentResourceProjectionInput[];
      readonly reason: "startup" | "schema.apply" | "hierarchy.create" | "hierarchy.update" | "hierarchy.move" | "hierarchy.purge";
    },
  ): Promise<ContentResourceProjectionReconcileResult> {
    return this.resourceProjection.reconcileContentHierarchyResources(actor, input);
  }

  /** Computes a no-write effective allow delta against a hypothetical parent edge. */
  public async previewResourceParentChange(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly newParentResourceId: string;
      readonly affectedResourceIds: readonly string[];
      readonly contextsByResourceId?: Readonly<Record<string, AuthorizationEvaluationContext>>;
    },
  ): Promise<ResourceParentChangePreview> {
    return this.resourceImpact.previewResourceParentChange(actor, input);
  }

  /** Makes a stale content projection fail closed until a successful reconcile. */
  public async quarantineContentResources(
    actor: AuthorizationActor,
    resourceIds: readonly string[],
    reason = "hierarchy-projection-pending",
  ): Promise<void> {
    return this.resourceProjection.quarantineContentResources(actor, resourceIds, reason);
  }

  public async releaseContentResourceQuarantine(
    actor: AuthorizationActor,
    resourceIds: readonly string[],
  ): Promise<void> {
    return this.resourceProjection.releaseContentResourceQuarantine(actor, resourceIds);
  }

  public async quarantineAllContentResources(actor: AuthorizationActor): Promise<readonly string[]> {
    return this.resourceProjection.quarantineAllContentResources(actor);
  }

  public async createRole(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly role: NewAuthorizationRoleRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationRoleRecord>> {
    return this.roleBindingManagement.createRole(actor, input);
  }

  public async updateRole(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly roleId: string;
      readonly role: AuthorizationRoleRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationRoleRecord>> {
    return this.roleBindingManagement.updateRole(actor, input);
  }

  public async deleteRole(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly roleId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    return this.roleBindingManagement.deleteRole(actor, input);
  }

  public async createBinding(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly binding: NewAuthorizationBindingRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationBindingRecord>> {
    return this.roleBindingManagement.createBinding(actor, input);
  }

  public async updateBinding(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly bindingId: string;
      readonly binding: AuthorizationBindingRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationBindingRecord>> {
    return this.roleBindingManagement.updateBinding(actor, input);
  }

  public async deleteBinding(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly bindingId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    return this.roleBindingManagement.deleteBinding(actor, input);
  }

  public async createLevel(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly level: NewAuthorizationLevelRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationLevelRecord>> {
    return this.subjectManagement.createLevel(actor, input);
  }

  public async updateLevel(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly levelId: string;
      readonly level: AuthorizationLevelRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationLevelRecord>> {
    return this.subjectManagement.updateLevel(actor, input);
  }

  public async deleteLevel(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly levelId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    return this.subjectManagement.deleteLevel(actor, input);
  }

  public async createSubject(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly subject: NewAuthorizationSubjectRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationSubjectRecord>> {
    return this.subjectManagement.createSubject(actor, input);
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
    return this.subjectManagement.ensureProvisionedIdentitySubject(actor, input);
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
    return this.subjectManagement.updateSubject(actor, input);
  }

  public async deleteSubject(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly subjectId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    return this.subjectManagement.deleteSubject(actor, input);
  }

  public async createGroupMembership(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly membership: NewAuthorizationGroupMembershipRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationGroupMembershipRecord>> {
    return this.subjectManagement.createGroupMembership(actor, input);
  }

  public async updateGroupMembership(
    actor: AuthorizationPolicyManagementActor,
    input: {
      readonly expectedRevision: number;
      readonly membershipId: string;
      readonly membership: AuthorizationGroupMembershipRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationGroupMembershipRecord>> {
    return this.subjectManagement.updateGroupMembership(actor, input);
  }

  public async deleteGroupMembership(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly expectedRevision: number; readonly membershipId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    return this.subjectManagement.deleteGroupMembership(actor, input);
  }
}
