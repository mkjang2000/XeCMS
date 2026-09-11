import type {
  AccessDecision,
  FieldAccessDecision,
  FieldAccessMode,
  HierarchyGuard,
  PolicySnapshot,
  ScopePropagation,
  SubjectType,
} from "@xecms/authorization";

/** Plain records form the stable HTTP/UI and normalized-storage boundary. */
export interface AuthorizationRealmRecord {
  readonly id: string;
  readonly name: string;
  readonly rootResourceId: string;
}

export interface AuthorizationSubjectRecord {
  readonly id: string;
  readonly realmId: string;
  /** Internal Global Identity projection; never accepted by ordinary Subject creation DTOs. */
  readonly identityId?: string;
  readonly name: string;
  readonly type: SubjectType;
  readonly protected?: boolean;
  readonly disabled?: boolean;
}

export interface AuthorizationResourceRecord {
  readonly id: string;
  readonly realmId: string;
  readonly name: string;
  readonly type: string;
  readonly parentId?: string;
  readonly protected?: boolean;
}

export interface AuthorizationLevelRecord {
  readonly id: string;
  readonly realmId: string;
  readonly name: string;
  readonly rank: number;
  readonly protected?: boolean;
}

export interface AuthorizationFieldAccessRecord {
  /** Applies to this resource and every descendant of it. */
  readonly resourceId: string;
  readonly readableFields: readonly string[];
  readonly writableFields: readonly string[];
}

export interface AuthorizationRoleRecord {
  readonly id: string;
  readonly realmId: string;
  readonly levelId: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly delegatablePermissions: readonly string[];
  /** Undefined/empty means unrestricted; empty field lists inside a scoped rule deny all there. */
  readonly fieldAccess?: readonly AuthorizationFieldAccessRecord[];
  readonly protected?: boolean;
}

export interface AuthorizationBindingConstraintsRecord {
  readonly ownerSubjectId?: string;
  readonly statuses?: readonly string[];
}

export interface AuthorizationBindingRecord {
  readonly id: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly roleId: string;
  readonly resourceId: string;
  readonly propagation: ScopePropagation;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: AuthorizationBindingConstraintsRecord;
  readonly protected?: boolean;
}

export interface AuthorizationGroupMembershipRecord {
  readonly id: string;
  readonly realmId: string;
  readonly memberSubjectId: string;
  readonly groupSubjectId: string;
}

export interface AuthorizationPermissionRecord {
  readonly key: string;
  readonly hierarchyGuard: HierarchyGuard;
  readonly delegatable: boolean;
  readonly protected?: boolean;
}

export interface AuthorizationPolicySeed {
  readonly realm: AuthorizationRealmRecord;
  readonly subjects: readonly AuthorizationSubjectRecord[];
  readonly resources: readonly AuthorizationResourceRecord[];
  readonly authorityLevels: readonly AuthorizationLevelRecord[];
  readonly permissions: readonly AuthorizationPermissionRecord[];
  readonly roles: readonly AuthorizationRoleRecord[];
  readonly bindings: readonly AuthorizationBindingRecord[];
  readonly groupMemberships: readonly AuthorizationGroupMembershipRecord[];
}

export interface AuthorizationPolicyState extends AuthorizationPolicySeed {
  readonly revision: number;
}

export interface RealmPrimaryOwnerStatus {
  readonly state: "unassigned" | "assigned" | "invalid";
  readonly realmId: string;
  readonly policyRevision: number;
  readonly bindingId: string;
  readonly subjectId?: string;
  readonly identityId?: string;
  readonly issues: readonly string[];
}

export type AuthorizationAuditTargetType =
  | "policy"
  | "subject"
  | "resource"
  | "authority-level"
  | "role"
  | "binding"
  | "group-membership";

export interface AuthorizationAuditDraft {
  readonly id: string;
  /** Realm-local Subject when the operation was authorized by Realm policy. */
  readonly actorSubjectId?: string;
  /** System Identity for audited control-plane/Full Access operations. */
  readonly actorIdentityId?: string;
  readonly accessMode?: AuthorizationAuditAccessMode;
  readonly fullAccessBindingId?: string;
  readonly action: string;
  readonly targetType: AuthorizationAuditTargetType;
  readonly targetId: string;
  readonly before: unknown | null;
  readonly after: unknown | null;
  /** The exact production-kernel decision that authorized the change. */
  readonly decision: AuthorizationDecisionRecord | null;
  readonly occurredAt: string;
}

export interface AuthorizationAuditRecord extends AuthorizationAuditDraft {
  readonly realmId: string;
  readonly revision: number;
}

export interface AuthorizationAuditPage {
  readonly items: readonly AuthorizationAuditRecord[];
  readonly nextCursor?: string;
}

export type AuthorizationPolicyMutation =
  | { readonly type: "subject.create"; readonly value: AuthorizationSubjectRecord }
  | { readonly type: "subject.update"; readonly value: AuthorizationSubjectRecord }
  | { readonly type: "subject.delete"; readonly id: string }
  | { readonly type: "resource.upsert"; readonly value: AuthorizationResourceRecord }
  | { readonly type: "resource.delete"; readonly id: string }
  | {
      /** System-maintained resource projections are reconciled as one policy revision. */
      readonly type: "resource.reconcile";
      readonly upserts: readonly AuthorizationResourceRecord[];
      readonly deleteIds: readonly string[];
    }
  | { readonly type: "authority-level.create"; readonly value: AuthorizationLevelRecord }
  | { readonly type: "authority-level.update"; readonly value: AuthorizationLevelRecord }
  | { readonly type: "authority-level.delete"; readonly id: string }
  | { readonly type: "role.create"; readonly value: AuthorizationRoleRecord }
  | { readonly type: "role.update"; readonly value: AuthorizationRoleRecord }
  | { readonly type: "role.delete"; readonly id: string }
  | { readonly type: "binding.create"; readonly value: AuthorizationBindingRecord }
  | { readonly type: "binding.update"; readonly value: AuthorizationBindingRecord }
  | { readonly type: "binding.delete"; readonly id: string }
  | {
      /** Trusted, atomic repair/switch of the single human Primary Owner Binding. */
      readonly type: "binding.replace-primary-owner";
      readonly value: AuthorizationBindingRecord;
    }
  | { readonly type: "group-membership.create"; readonly value: AuthorizationGroupMembershipRecord }
  | { readonly type: "group-membership.update"; readonly value: AuthorizationGroupMembershipRecord }
  | { readonly type: "group-membership.delete"; readonly id: string };

export interface AuthorizationStore {
  /** Cheap revision read used as the cache key. Null means the realm is not initialized. */
  getPolicyRevision(realmId: string): Promise<number | null>;
  /** Loads a transactionally consistent, normalized policy projection. */
  loadPolicy(realmId: string): Promise<AuthorizationPolicyState | null>;
  initialize(input: {
    readonly realmId: string;
    readonly expectedRevision: null;
    readonly state: AuthorizationPolicySeed;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState>;
  /** Mutation, CAS revision increment, and audit insert must be one transaction. */
  mutatePolicy<TMutation extends AuthorizationPolicyMutation>(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly mutation: TMutation;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState>;
  listAudit(input: {
    readonly realmId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<AuthorizationAuditPage>;
  isResourceQuarantined(realmId: string, resourceId: string): Promise<boolean>;
  quarantineResources(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
    readonly reason: string;
    readonly actorSubjectId: string;
    readonly occurredAt: string;
  }): Promise<void>;
  releaseResourceQuarantine(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void>;
}

export interface AuthorizationRuntime {
  readonly now: () => string;
  readonly newAuditId: () => string;
  readonly newId: (
    prefix: "subject" | "level" | "role" | "binding" | "membership",
  ) => string;
}

export interface AuthorizationActor {
  readonly subjectId: string;
  readonly realmId: string;
}

/** Explicit Admin Studio boundary. Control-plane actors never impersonate a Realm Subject. */
export type RealmAdministrationActor =
  | {
      readonly accessMode: "realm-actor";
      readonly realmId: string;
      readonly subjectId: string;
      readonly systemIdentityId: string;
    }
  | {
      readonly accessMode: "cms-owner-readonly";
      readonly realmId: string;
      readonly systemIdentityId: string;
    }
  | {
      readonly accessMode: "realm-full-access";
      readonly realmId: string;
      readonly systemIdentityId: string;
      readonly fullAccessBindingId: string;
      readonly fullAccessValidUntil?: string;
    };

export type AuthorizationPolicyManagementActor = AuthorizationActor | RealmAdministrationActor;

export type AuthorizationAuditAccessMode =
  | RealmAdministrationActor["accessMode"]
  | "cms-owner-control-plane"
  | "system-provisioner";

export type RealmOwnerCommandActor =
  | Extract<RealmAdministrationActor, { readonly accessMode: "realm-actor" }>
  | {
      readonly accessMode: "cms-owner-control-plane";
      readonly realmId: string;
      readonly systemIdentityId: string;
      readonly systemSubjectId?: string;
    };

export interface AuthorizationEvaluationContext {
  readonly ownerSubjectId?: string;
  readonly status?: string;
}

export interface AuthorizationGrantRecord {
  /** Omitted means ordinary Realm Role provenance. Full Access is management-only. */
  readonly sourceKind?: "role" | "realm-full-access";
  readonly sourceRealmId?: string;
  readonly sourceSubjectId?: string;
  readonly permission: string;
  readonly sourceRoleId: string;
  readonly sourceLevelId: string;
  readonly sourceRank: number;
  readonly sourceBindingId: string;
  readonly sourceScope: {
    readonly resourceId: string;
    readonly propagation: ScopePropagation;
  };
  readonly membershipPath: readonly string[];
}

export interface AuthorizationDecisionRecord {
  readonly allowed: boolean;
  readonly action: string;
  readonly reasonCode: AccessDecision["reasonCode"] | "ALLOW_REALM_FULL_ACCESS" | "DENY_ENTITLEMENT_GATE";
  readonly matchedGrants: readonly AuthorizationGrantRecord[];
  readonly evaluatedScope?: {
    readonly resourceId: string;
    readonly propagation: ScopePropagation;
  };
  readonly actorLevel?: number;
  readonly targetLevel?: number;
}

export interface AuthorizationFieldGrantRecord {
  readonly sourceKind?: "role";
  readonly sourceRoleId: string;
  readonly sourceBindingId: string;
  readonly sourceResourceId: string;
  readonly membershipPath: readonly string[];
}

export interface AuthorizationFieldDecisionRecord {
  readonly allowed: boolean;
  readonly access: FieldAccessMode;
  readonly field: string;
  readonly resourceId: string;
  readonly reasonCode: FieldAccessDecision["reasonCode"];
  readonly matchedGrants: readonly AuthorizationFieldGrantRecord[];
}

export type AuthorizationBatchCheck =
  | {
      readonly id: string;
      readonly type: "permission";
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    }
  | {
      readonly id: string;
      readonly type: "field";
      readonly action: string;
      readonly resourceId: string;
      readonly field: string;
      readonly access: FieldAccessMode;
      readonly context?: AuthorizationEvaluationContext;
    };

export type AuthorizationBatchResultItem =
  | {
      readonly id: string;
      readonly type: "permission";
      readonly resourceId: string;
      /**
       * False means the generic access-profile endpoint cannot safely model
       * this permission (unknown key or a hierarchy-aware management guard).
       */
      readonly supported: boolean;
      readonly decision: AuthorizationDecisionRecord;
    }
  | {
      readonly id: string;
      readonly type: "field";
      readonly action: string;
      readonly supported: boolean;
      readonly decision: AuthorizationFieldDecisionRecord;
    };

export interface AuthorizationBatchEvaluation {
  /** Every item was evaluated against this exact immutable policy revision. */
  readonly policyRevision: number;
  readonly items: readonly AuthorizationBatchResultItem[];
}

export interface AuthorizationMutationResult<TValue> {
  readonly revision: number;
  readonly value: TValue;
}

export interface ContentResourceProjectionInput {
  readonly documentId: string;
  readonly collectionId: string;
  readonly parentDocumentId: string | null;
}

export interface ContentResourceProjectionReconcileResult {
  readonly revision: number;
  readonly changed: boolean;
  readonly upsertedResourceIds: readonly string[];
  readonly deletedResourceIds: readonly string[];
  /** Stale resources kept as inert leaves because policy records still reference them. */
  readonly retiredResourceIds: readonly string[];
  readonly removedBindingIds: readonly string[];
  readonly removedFieldAccess: readonly {
    readonly roleId: string;
    readonly resourceId: string;
  }[];
}

export interface EffectivePermissionChangeRecord {
  readonly subjectId: string;
  readonly resourceId: string;
  readonly permission: string;
  readonly beforeAllowed: boolean;
  readonly afterAllowed: boolean;
  readonly change: "granted" | "revoked";
}

export interface EffectiveFieldAccessChangeRecord {
  readonly subjectId: string;
  readonly resourceId: string;
  readonly operation: "read" | "write";
  /** null means unrestricted; otherwise this is the effective named-field allowlist. */
  readonly beforeFields: readonly string[] | null;
  readonly afterFields: readonly string[] | null;
  readonly change: "broadened" | "narrowed" | "changed";
}

export interface ResourceParentChangePreview {
  readonly policyRevision: number;
  readonly requiresAuthorizationManagement: boolean;
  readonly effectivePermissionChanges: readonly EffectivePermissionChangeRecord[];
  readonly effectiveFieldAccessChanges: readonly EffectiveFieldAccessChangeRecord[];
  readonly effectivePermissionChangesTruncated: boolean;
}

export type NewAuthorizationSubjectRecord = Omit<AuthorizationSubjectRecord, "id" | "identityId"> & {
  readonly id?: string;
};

export type NewAuthorizationLevelRecord = Omit<AuthorizationLevelRecord, "id"> & {
  readonly id?: string;
};

export type NewAuthorizationRoleRecord = Omit<AuthorizationRoleRecord, "id"> & {
  readonly id?: string;
};

export type NewAuthorizationBindingRecord = Omit<AuthorizationBindingRecord, "id"> & {
  readonly id?: string;
};

export type NewAuthorizationGroupMembershipRecord = Omit<AuthorizationGroupMembershipRecord, "id"> & {
  readonly id?: string;
};

export interface InitialAuthorizationPolicyInput {
  readonly realmId: string;
  readonly realmName: string;
  readonly rootResourceId: string;
  readonly rootResourceName: string;
  readonly ownerSubjectId: string;
  /** Internal bootstrap link. Subject and Global Identity IDs need not be equal. */
  readonly ownerIdentityId?: string;
  /** Internal Realm bootstrap may use a protected service account. Defaults to user. */
  readonly ownerSubjectType?: SubjectType;
  readonly ownerSubjectName: string;
  /**
   * Content Realm bootstrap only. The supplied principal becomes an invisible
   * System Policy Root while the protected human Owner Role remains unassigned.
   * System Realm initialization deliberately keeps the legacy human Owner seed.
   */
  readonly ownerIsSystemPolicyRoot?: boolean;
}

export interface PolicyCacheEntry {
  readonly state: AuthorizationPolicyState;
  readonly snapshot: PolicySnapshot;
}
