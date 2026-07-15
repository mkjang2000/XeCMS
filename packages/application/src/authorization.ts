import {
  asAuthorityLevelId,
  asGroupMembershipId,
  asPermissionKey,
  asRealmId,
  asResourceId,
  asRoleBindingId,
  asRoleId,
  asSubjectId,
  authorizeRoleBindingCreate,
  authorizeRoleBindingRemove,
  authorizeRoleBindingUpdate,
  authorizeRoleCreate,
  authorizeRoleDelete,
  authorizeRoleUpdate,
  createPolicySnapshot,
  evaluateAccess,
  evaluateFieldAccess,
  scopeAppliesToResource,
  PolicyValidationError,
  type AccessDecision,
  type AccessEvaluationContext,
  type FieldAccessDecision,
  type FieldAccessMode,
  type HierarchyGuard,
  type PolicySnapshot,
  type Role,
  type RoleBinding,
  type ScopePropagation,
  type SubjectType,
} from "@xecms/authorization";
import { ApplicationError } from "./errors.js";

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
  readonly actorSubjectId: string;
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

export type RealmFullAccessUseOperation =
  | "authorize"
  | "simulate"
  | "evaluate-field"
  | "filter-readable-data"
  | "assert-writable-data";

/**
 * Audit payload emitted only when Realm Full Access actually authorizes an
 * operation. The resolver owns durable grant/use storage; the authorization
 * application layer owns the policy-boundary checks that precede this call.
 */
export interface RealmFullAccessUse {
  readonly realmId: string;
  readonly subjectId: string;
  readonly action: string;
  readonly resourceId: string;
  readonly at: string;
  readonly operation: RealmFullAccessUseOperation;
  readonly field?: string;
  readonly fields?: readonly string[];
}

/** Optional M4 bridge. Omitting it preserves the M3 RBAC-only evaluator. */
export interface RealmFullAccessResolver {
  hasActiveFullAccess(realmId: string, subjectId: string, at: string): Promise<boolean>;
  recordUse(input: RealmFullAccessUse): Promise<void>;
}

export interface AuthorizationActor {
  readonly subjectId: string;
  readonly realmId: string;
}

export interface AuthorizationEvaluationContext {
  readonly ownerSubjectId?: string;
  readonly status?: string;
}

export interface AuthorizationGrantRecord {
  /** Omitted means the legacy RBAC role provenance used by M3. */
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
  readonly reasonCode: AccessDecision["reasonCode"] | "ALLOW_REALM_FULL_ACCESS";
  readonly matchedGrants: readonly AuthorizationGrantRecord[];
  readonly evaluatedScope?: {
    readonly resourceId: string;
    readonly propagation: ScopePropagation;
  };
  readonly actorLevel?: number;
  readonly targetLevel?: number;
}

export interface AuthorizationFieldGrantRecord {
  /** Omitted means the legacy RBAC role provenance used by M3. */
  readonly sourceKind?: "role" | "realm-full-access";
  readonly sourceRealmId?: string;
  readonly sourceSubjectId?: string;
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
  readonly reasonCode: FieldAccessDecision["reasonCode"] | "ALLOW_REALM_FULL_ACCESS";
  readonly matchedGrants: readonly AuthorizationFieldGrantRecord[];
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

export const AUTHORIZATION_MANAGE_PERMISSION = "authorization.manage";
export const SYSTEM_AUTHORIZATION_REALM_ID = "rlm_system";
export const SYSTEM_WORKSPACE_RESOURCE_ID = "resource:workspace";
export const SYSTEM_SCHEMA_RESOURCE_ID = "resource:schema";
export const SYSTEM_CONTENT_RESOURCE_ID = "resource:content";
export const SYSTEM_AUTHORIZATION_RESOURCE_ID = "resource:authorization";
export const SYSTEM_AUDIT_RESOURCE_ID = "resource:audit";
export const SYSTEM_PUBLIC_SUBJECT_ID = "subject:public";

const PERMISSION_CATALOG_SOURCE = [
  ["authorization.read", "none", true],
  [AUTHORIZATION_MANAGE_PERMISSION, "none", false, true],
  ["content.list", "none", true],
  ["content.read", "none", true],
  ["content.create", "none", true],
  ["content.update", "none", true],
  ["content.delete", "none", true],
  ["content.purge", "none", true],
  ["content.publish", "none", true],
  ["content.unpublish", "none", true],
  ["content.archive", "none", true],
  ["content.restore", "none", true],
  ["content.revision.read", "none", true],
  ["content.revision.restore", "none", true],
  ["schema.read", "none", true],
  ["schema.create", "none", true],
  ["schema.update", "none", true],
  ["schema.delete", "none", true],
  ["schema.apply", "none", true],
  ["schema.rollback", "none", true],
  ["schema.export", "none", true],
  ["identity.read", "none", true],
  ["identity.invite", "none", true],
  ["identity.update", "target-subject", true],
  ["identity.disable", "target-subject", true],
  ["identity.credentials.reset", "target-subject", true],
  ["identity.session.revoke", "target-subject", true],
  ["group.read", "none", true],
  ["group.create", "none", true],
  ["group.update", "none", true],
  ["group.member.manage", "none", true],
  ["role.read", "none", true],
  ["role.create", "target-role", true],
  ["role.update", "target-role", true],
  ["role.delete", "target-role", true],
  ["role.assign", "target-binding", true],
  ["role.reorder", "target-role", true],
  ["authority-level.read", "none", true],
  ["authority-level.create", "none", true],
  ["authority-level.update", "none", true],
  ["authority-level.delete", "none", true],
  ["media.read", "none", true],
  ["media.upload", "none", true],
  ["media.delete", "none", true],
  ["plugin.read", "none", true],
  ["plugin.install", "none", true],
  ["plugin.configure", "none", true],
  ["job.read", "none", true],
  ["job.retry", "none", true],
  ["audit.read", "none", true],
  ["api-key.create", "none", true],
  ["api-key.revoke", "none", true],
  ["system.settings.update", "none", true],
] as const satisfies readonly (readonly [string, HierarchyGuard, boolean, boolean?])[];

export const DEFAULT_PERMISSION_CATALOG: readonly AuthorizationPermissionRecord[] = Object.freeze(
  PERMISSION_CATALOG_SOURCE.map(([key, hierarchyGuard, delegatable, isProtected]) => Object.freeze({
    key,
    hierarchyGuard,
    delegatable,
    ...(isProtected === undefined ? {} : { protected: isProtected }),
  })),
);

const CONTENT_PERMISSIONS = Object.freeze([
  "content.list",
  "content.read",
  "content.create",
  "content.update",
  "content.delete",
  "content.purge",
  "content.publish",
  "content.unpublish",
  "content.archive",
  "content.restore",
  "content.revision.read",
  "content.revision.restore",
]);
const ROLE_MANAGEMENT_PERMISSIONS = Object.freeze([
  "role.read",
  "role.create",
  "role.update",
  "role.delete",
  "role.assign",
  "role.reorder",
]);
const IDENTITY_PERMISSIONS = Object.freeze([
  "identity.read",
  "identity.invite",
  "identity.update",
  "identity.disable",
  "identity.credentials.reset",
  "identity.session.revoke",
  "group.read",
  "group.create",
  "group.update",
  "group.member.manage",
]);

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
}

/** Deterministic seed IDs make bootstrap idempotency and adapter fixtures reproducible. */
export function createInitialAuthorizationPolicy(
  input: InitialAuthorizationPolicyInput,
): AuthorizationPolicySeed {
  validateIdentifier(input.realmId, "realmId");
  validateIdentifier(input.rootResourceId, "rootResourceId");
  validateIdentifier(input.ownerSubjectId, "ownerSubjectId");
  if (input.ownerIdentityId !== undefined) {
    validateIdentifier(input.ownerIdentityId, "ownerIdentityId");
  }
  if (
    input.ownerSubjectType !== undefined
    && !new Set<SubjectType>(["user", "group", "service-account"]).has(input.ownerSubjectType)
  ) {
    throw new ApplicationError("SUBJECT_TYPE_INVALID", 422, "Owner Subject type is invalid.");
  }
  validateDisplayName(input.realmName, "realmName");
  validateDisplayName(input.rootResourceName, "rootResourceName");
  validateDisplayName(input.ownerSubjectName, "ownerSubjectName");

  const prefix = `authorization:${input.realmId}`;
  const levelIds = {
    owner: `${prefix}:level:owner`,
    administrator: `${prefix}:level:administrator`,
    editor: `${prefix}:level:editor`,
    viewer: `${prefix}:level:viewer`,
    public: `${prefix}:level:public`,
  } as const;
  const roleIds = {
    owner: `${prefix}:role:owner`,
    contentAdministrator: `${prefix}:role:content-administrator`,
    securityAdministrator: `${prefix}:role:security-administrator`,
    editor: `${prefix}:role:editor`,
    viewer: `${prefix}:role:viewer`,
    public: `${prefix}:role:public`,
  } as const;
  const publicSubjectId = input.realmId === SYSTEM_AUTHORIZATION_REALM_ID
    ? SYSTEM_PUBLIC_SUBJECT_ID
    : `${prefix}:subject:public`;
  const allPermissions = DEFAULT_PERMISSION_CATALOG.map(({ key }) => key);
  const ownerDelegations = DEFAULT_PERMISSION_CATALOG
    .filter(({ delegatable, protected: isProtected }) => delegatable && isProtected !== true)
    .map(({ key }) => key);
  const contentAdministratorPermissions = uniqueStrings([
    "authorization.read",
    ...CONTENT_PERMISSIONS,
    "schema.read",
    "schema.create",
    "schema.update",
    "schema.apply",
    "schema.export",
    ...ROLE_MANAGEMENT_PERMISSIONS,
    "authority-level.read",
    "identity.read",
    "group.read",
    "media.read",
    "media.upload",
    "media.delete",
    "audit.read",
  ]);
  const contentAdministratorDelegations = uniqueStrings([
    ...CONTENT_PERMISSIONS,
    "schema.read",
    "role.read",
    "media.read",
    "media.upload",
    "media.delete",
  ]);
  const securityAdministratorPermissions = uniqueStrings([
    "authorization.read",
    ...IDENTITY_PERMISSIONS,
    ...ROLE_MANAGEMENT_PERMISSIONS,
    "authority-level.read",
    "audit.read",
  ]);
  const securityAdministratorDelegations = uniqueStrings([
    ...IDENTITY_PERMISSIONS,
    "role.read",
  ]);
  const editorPermissions = uniqueStrings([
    ...CONTENT_PERMISSIONS,
    "schema.read",
    "media.read",
    "media.upload",
  ]);
  const viewerPermissions = [
    "content.list",
    "content.read",
    "content.revision.read",
    "schema.read",
    "media.read",
  ] as const;
  const publicPermissions = ["content.list", "content.read", "media.read"] as const;

  const state: AuthorizationPolicySeed = {
    realm: {
      id: input.realmId,
      name: input.realmName,
      rootResourceId: input.rootResourceId,
    },
    subjects: [
      {
        id: input.ownerSubjectId,
        realmId: input.realmId,
        ...(input.ownerIdentityId === undefined ? {} : { identityId: input.ownerIdentityId }),
        name: input.ownerSubjectName,
        type: input.ownerSubjectType ?? "user",
        protected: true,
      },
      {
        id: publicSubjectId,
        realmId: input.realmId,
        name: "Public",
        type: "service-account",
        protected: true,
      },
    ],
    resources: [
      {
        id: input.rootResourceId,
        realmId: input.realmId,
        name: input.rootResourceName,
        type: "workspace",
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "schema"),
        realmId: input.realmId,
        name: "Schema",
        type: "schema",
        parentId: input.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "content"),
        realmId: input.realmId,
        name: "Content",
        type: "content-root",
        parentId: input.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "authorization"),
        realmId: input.realmId,
        name: "Access control",
        type: "authorization",
        parentId: input.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(input.realmId, "audit"),
        realmId: input.realmId,
        name: "Audit",
        type: "audit",
        parentId: input.rootResourceId,
        protected: true,
      },
    ],
    authorityLevels: [
      { id: levelIds.owner, realmId: input.realmId, name: "Owner", rank: 100, protected: true },
      { id: levelIds.administrator, realmId: input.realmId, name: "Administrators", rank: 80 },
      { id: levelIds.editor, realmId: input.realmId, name: "Editors", rank: 40 },
      { id: levelIds.viewer, realmId: input.realmId, name: "Viewers", rank: 10 },
      { id: levelIds.public, realmId: input.realmId, name: "Public", rank: 0, protected: true },
    ],
    permissions: DEFAULT_PERMISSION_CATALOG,
    roles: [
      {
        id: roleIds.owner,
        realmId: input.realmId,
        levelId: levelIds.owner,
        name: "Owner",
        permissions: allPermissions,
        delegatablePermissions: ownerDelegations,
        protected: true,
      },
      {
        id: roleIds.contentAdministrator,
        realmId: input.realmId,
        levelId: levelIds.administrator,
        name: "Content Administrator",
        permissions: contentAdministratorPermissions,
        delegatablePermissions: contentAdministratorDelegations,
      },
      {
        id: roleIds.securityAdministrator,
        realmId: input.realmId,
        levelId: levelIds.administrator,
        name: "Security Administrator",
        permissions: securityAdministratorPermissions,
        delegatablePermissions: securityAdministratorDelegations,
      },
      {
        id: roleIds.editor,
        realmId: input.realmId,
        levelId: levelIds.editor,
        name: "Editor",
        permissions: editorPermissions,
        delegatablePermissions: [],
      },
      {
        id: roleIds.viewer,
        realmId: input.realmId,
        levelId: levelIds.viewer,
        name: "Viewer",
        permissions: viewerPermissions,
        delegatablePermissions: [],
      },
      {
        id: roleIds.public,
        realmId: input.realmId,
        levelId: levelIds.public,
        name: "Public",
        permissions: publicPermissions,
        delegatablePermissions: [],
        protected: true,
      },
    ],
    bindings: [
      {
        id: `${prefix}:binding:owner`,
        realmId: input.realmId,
        subjectId: input.ownerSubjectId,
        roleId: roleIds.owner,
        resourceId: input.rootResourceId,
        propagation: "self-and-children",
        protected: true,
      },
      {
        id: `${prefix}:binding:public`,
        realmId: input.realmId,
        subjectId: publicSubjectId,
        roleId: roleIds.public,
        resourceId: input.rootResourceId,
        propagation: "self-and-children",
        protected: true,
      },
    ],
    groupMemberships: [],
  };
  createKernelSnapshot({ ...state, revision: 0 });
  return deepFreezePolicySeed(state);
}

interface PolicyCacheEntry {
  readonly state: AuthorizationPolicyState;
  readonly snapshot: PolicySnapshot;
}

export class AuthorizationApplicationService {
  readonly #cache = new Map<string, PolicyCacheEntry>();
  /**
   * The durable store already keys quarantine rows by (realmId, resourceId).
   * Keep the process-local fast path equally scoped: content resources may be
   * projected into more than one realm, and resource IDs are not an actor
   * identity boundary by themselves.
   */
  readonly #quarantinedResources = new Set<string>();

  public constructor(
    private readonly store: AuthorizationStore,
    private readonly runtime: AuthorizationRuntime,
    private readonly realmFullAccessResolver?: RealmFullAccessResolver,
  ) {}

  public async initialize(
    input: InitialAuthorizationPolicyInput,
  ): Promise<AuthorizationPolicyState> {
    if (await this.store.getPolicyRevision(input.realmId) !== null) {
      throw new ApplicationError(
        "AUTHORIZATION_ALREADY_INITIALIZED",
        409,
        `Authorization policy for realm '${input.realmId}' is already initialized.`,
      );
    }
    const state = createInitialAuthorizationPolicy(input);
    const persisted = await this.store.initialize({
      realmId: input.realmId,
      expectedRevision: null,
      state,
      audit: this.audit(
        input.ownerSubjectId,
        "policy.initialize",
        "policy",
        input.realmId,
        null,
        {
          realmId: input.realmId,
          rootResourceId: input.rootResourceId,
          ownerSubjectId: input.ownerSubjectId,
        },
        null,
      ),
    });
    this.cachePersistedState(input.realmId, persisted, null);
    return persisted;
  }

  public async getPolicy(actor: AuthorizationActor): Promise<AuthorizationPolicyState> {
    const entry = await this.load(actor.realmId);
    this.requireDecision(
      evaluateAccess(entry.snapshot, {
        actorSubjectId: asSubjectId(actor.subjectId),
        action: asPermissionKey("authorization.read"),
        resourceId: asResourceId(coreResourceId(actor.realmId, "authorization")),
        now: this.runtime.now(),
      }),
    );
    return entry.state;
  }

  /** Internal CAS key for system-maintained projections; does not expose policy data. */
  public async currentPolicyRevision(realmId: string): Promise<number> {
    return (await this.load(realmId)).state.revision;
  }

  /**
   * Trusted provisioning read. It is intentionally not wired to HTTP routes;
   * Realm bootstrap needs to distinguish an uninitialized revision-0 policy
   * from an initialized policy before a protected Subject exists.
   */
  public async loadTrustedProvisioningPolicy(
    realmId: string,
  ): Promise<AuthorizationPolicyState | null> {
    validateIdentifier(realmId, "realmId");
    if (await this.store.getPolicyRevision(realmId) === null) return null;
    return (await this.load(realmId)).state;
  }

  /**
   * Parent-changing hierarchy moves can change Binding/FieldAccess applicability.
   * M3 deliberately uses the protected Owner guard until a rank/delegation-aware
   * move-management command is introduced.
   */
  public async requireHierarchyPolicyManagement(actor: AuthorizationActor): Promise<void> {
    const entry = await this.load(actor.realmId);
    this.requireOwnerManagement(actor, entry);
  }

  public async authorize(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationDecisionRecord> {
    return this.authorizeAt(actor, input, this.runtime.now());
  }

  public async require(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationDecisionRecord> {
    const decision = await this.authorize(actor, input);
    if (!decision.allowed) {
      authorizationDenied(decision);
    }
    return decision;
  }

  /** Simulation deliberately calls the same production path and uses the same cache. */
  public async simulate(
    requestingActor: AuthorizationActor,
    input: {
      readonly subjectId: string;
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
      readonly at?: string;
    },
  ): Promise<AuthorizationDecisionRecord> {
    validateIdentifier(input.subjectId, "simulate.subjectId");
    await this.load(requestingActor.realmId);
    await this.require(requestingActor, {
      action: "authorization.read",
      resourceId: coreResourceId(requestingActor.realmId, "authorization"),
    });
    const at = input.at ?? this.runtime.now();
    validateOptionalInstant(at, "simulate.at");
    // Only the evaluated identity changes. The requester's separate permission
    // check above prevents the simulator from becoming an authorization proxy.
    return this.authorizeAt(
      { subjectId: input.subjectId, realmId: requestingActor.realmId },
      input,
      at,
      "simulate",
    );
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
    validateFieldName(input.field);
    await this.assertProjectionAvailable(actor.realmId, input.resourceId);
    if (input.action !== undefined) assertCanonicalPermission(input.action);
    const entry = await this.load(actor.realmId);
    const now = this.runtime.now();
    const decision = evaluateFieldAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      resourceId: asResourceId(input.resourceId),
      field: input.field,
      access: input.access,
      now,
      ...(input.action === undefined ? {} : { permission: asPermissionKey(input.action) }),
      ...toKernelContextProperty(input.context),
    });
    const fullAccessAction = input.action
      ?? (input.access === "read" ? "content.read" : "content.update");
    if (await this.useRealmFullAccess(entry, actor, {
      action: fullAccessAction,
      resourceId: input.resourceId,
      at: now,
      operation: "evaluate-field",
      field: input.field,
    })) {
      return realmFullAccessFieldDecision(
        actor,
        input.resourceId,
        input.field,
        input.access,
        entry.state.realm.rootResourceId,
      );
    }
    return plainFieldDecision(decision);
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
    const action = input.action ?? "content.read";
    await this.assertProjectionAvailable(actor.realmId, input.resourceId);
    assertCanonicalPermission(action);
    const entry = await this.load(actor.realmId);
    const now = this.runtime.now();
    const enclosingDecision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(action),
      resourceId: asResourceId(input.resourceId),
      now,
      ...toKernelContextProperty(input.context),
    });
    const fields = Object.keys(input.data);
    if (await this.useRealmFullAccess(entry, actor, {
      action,
      resourceId: input.resourceId,
      at: now,
      operation: "filter-readable-data",
      fields,
    }, () => fields.forEach(validateFieldName))) {
      return { ...input.data };
    }
    this.requireDecision(enclosingDecision);
    const output: [string, unknown][] = [];
    for (const [field, value] of Object.entries(input.data)) {
      validateFieldName(field);
      const decision = evaluateFieldAccess(entry.snapshot, {
        actorSubjectId: asSubjectId(actor.subjectId),
        resourceId: asResourceId(input.resourceId),
        field,
        access: "read",
        permission: asPermissionKey(action),
        now,
        ...toKernelContextProperty(input.context),
      });
      if (decision.allowed) {
        output.push([field, value]);
      }
    }
    return Object.fromEntries(output) as Partial<TData>;
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
    const action = input.action ?? "content.update";
    await this.assertProjectionAvailable(actor.realmId, input.resourceId);
    assertCanonicalPermission(action);
    const entry = await this.load(actor.realmId);
    const now = this.runtime.now();
    const enclosingDecision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(action),
      resourceId: asResourceId(input.resourceId),
      now,
      ...toKernelContextProperty(input.context),
    });
    const fields = Object.keys(input.data);
    if (await this.useRealmFullAccess(entry, actor, {
      action,
      resourceId: input.resourceId,
      at: now,
      operation: "assert-writable-data",
      fields,
    }, () => fields.forEach(validateFieldName))) {
      return;
    }
    this.requireDecision(enclosingDecision);
    const decisions = fields.map((field) => {
      validateFieldName(field);
      return plainFieldDecision(evaluateFieldAccess(entry.snapshot, {
        actorSubjectId: asSubjectId(actor.subjectId),
        resourceId: asResourceId(input.resourceId),
        field,
        access: "write",
        permission: asPermissionKey(action),
        now,
        ...toKernelContextProperty(input.context),
      }));
    });
    const denied = decisions.filter(({ allowed }) => !allowed);
    if (denied.length > 0) {
      throw new ApplicationError(
        "FIELD_WRITE_FORBIDDEN",
        403,
        `Write access was denied for field${denied.length === 1 ? "" : "s"}: ${denied.map(({ field }) => field).join(", ")}.`,
        { details: { decisions: denied } },
      );
    }
  }

  public async listAudit(
    actor: AuthorizationActor,
    input: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<AuthorizationAuditPage> {
    const state = (await this.load(actor.realmId)).state;
    await this.require(actor, {
      action: "audit.read",
      resourceId: coreResourceId(actor.realmId, "audit"),
    });
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ApplicationError("AUDIT_LIMIT_INVALID", 400, "Audit limit must be an integer from 1 to 200.");
    }
    return this.store.listAudit({
      realmId: actor.realmId,
      limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
  }

  public async syncCollectionResource(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly collectionId: string;
      readonly collectionName: string;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationResourceRecord>> {
    validateIdentifier(input.collectionId, "collectionId");
    validateDisplayName(input.collectionName, "collectionName");
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const authorizationDecision = await this.require(actor, {
      action: "schema.apply",
      resourceId: coreResourceId(actor.realmId, "schema"),
    });
    const id = realmCollectionResourceId(actor.realmId, input.collectionId);
    const before = entry.state.resources.find((resource) => resource.id === id) ?? null;
    if (before !== null &&
      (before.type !== "collection" || before.parentId !== coreResourceId(actor.realmId, "content"))) {
      throw new ApplicationError(
        "AUTHORIZATION_RESOURCE_ID_CONFLICT",
        409,
        `Resource '${id}' is not the expected collection resource.`,
      );
    }
    const value: AuthorizationResourceRecord = {
      id,
      realmId: actor.realmId,
      name: input.collectionName,
      type: "collection",
      parentId: coreResourceId(actor.realmId, "content"),
    };
    if (before !== null && recordsEqual(before, value)) {
      return { revision: entry.state.revision, value: before };
    }
    const persisted = await this.commit(
      actor,
      entry,
      { type: "resource.upsert", value },
      "resource",
      id,
      before,
      value,
      authorizationDecision,
    );
    return { revision: persisted.revision, value: requireRecord(persisted.resources, id, "resource") };
  }

  public async syncCoreResources(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly collections: readonly {
        readonly id: string;
        readonly name: string;
      }[];
    },
  ): Promise<AuthorizationPolicyState> {
    let entry = await this.loadForMutation(actor, input.expectedRevision);
    const authorizationDecision = await this.require(actor, {
      action: "schema.apply",
      resourceId: coreResourceId(actor.realmId, "schema"),
    });
    const coreResources: readonly AuthorizationResourceRecord[] = [
      {
        id: coreResourceId(actor.realmId, "schema"),
        realmId: actor.realmId,
        name: "Schema",
        type: "schema",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(actor.realmId, "content"),
        realmId: actor.realmId,
        name: "Content",
        type: "content-root",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(actor.realmId, "authorization"),
        realmId: actor.realmId,
        name: "Access control",
        type: "authorization",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(actor.realmId, "audit"),
        realmId: actor.realmId,
        name: "Audit",
        type: "audit",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
    ];
    const collectionResources = input.collections.map(({ id, name }) => {
      validateIdentifier(id, "collection.id");
      validateDisplayName(name, "collection.name");
      return {
        id: realmCollectionResourceId(actor.realmId, id),
        realmId: actor.realmId,
        name,
        type: "collection",
        parentId: coreResourceId(actor.realmId, "content"),
      } satisfies AuthorizationResourceRecord;
    });
    const duplicateIds = findDuplicate([...coreResources, ...collectionResources].map(({ id }) => id));
    if (duplicateIds !== undefined) {
      throw new ApplicationError(
        "DUPLICATE_AUTHORIZATION_RESOURCE",
        409,
        `Authorization resource '${duplicateIds}' is duplicated.`,
      );
    }
    const desiredCollectionIds = new Set(collectionResources.map(({ id }) => id));
    const collectionPrefix = realmCollectionResourcePrefix(actor.realmId);
    const staleCollections = entry.state.resources.filter((resource) =>
      (resource.type === "collection" || resource.type === "retired-collection") &&
      resource.id.startsWith(collectionPrefix) &&
      !desiredCollectionIds.has(resource.id));
    for (const resource of staleCollections) {
      const retired: AuthorizationResourceRecord = {
        ...resource,
        name: `Retired collection ${resource.id.slice(collectionPrefix.length)}`,
        type: "retired-collection",
        parentId: coreResourceId(actor.realmId, "content"),
      };
      if (recordsEqual(resource, retired)) continue;
      const persisted = await this.commit(
        actor,
        entry,
        { type: "resource.upsert", value: retired },
        "resource",
        retired.id,
        resource,
        retired,
        authorizationDecision,
      );
      entry = { state: persisted, snapshot: createKernelSnapshot(persisted) };
    }
    for (const value of [...coreResources, ...collectionResources]) {
      const before = entry.state.resources.find(({ id }) => id === value.id) ?? null;
      if (before?.type === "retired-collection" && policyReferencesResource(entry.state, before.id)) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Retired collection resource '${before.id}' still has policy references.`,
        );
      }
      if (before !== null && recordsEqual(before, value)) continue;
      const persisted = await this.commit(
        actor,
        entry,
        { type: "resource.upsert", value },
        "resource",
        value.id,
        before,
        value,
        authorizationDecision,
      );
      entry = { state: persisted, snapshot: createKernelSnapshot(persisted) };
    }
    return entry.state;
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
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const managedCollectionResourceIds = new Set(input.managedCollectionIds.map((id) => {
      validateIdentifier(id, "managedCollectionId");
      return realmCollectionResourceId(actor.realmId, id);
    }));
    const duplicateDocument = findDuplicate(input.projections.map(({ documentId }) => documentId));
    if (duplicateDocument !== undefined) {
      throw new ApplicationError(
        "DUPLICATE_CONTENT_RESOURCE_PROJECTION",
        422,
        `Document resource '${duplicateDocument}' is duplicated in the hierarchy projection.`,
      );
    }
    const desired = input.projections.map((projection): AuthorizationResourceRecord => {
      validateIdentifier(projection.documentId, "projection.documentId");
      validateIdentifier(projection.collectionId, "projection.collectionId");
      if (!managedCollectionResourceIds.has(
        realmCollectionResourceId(actor.realmId, projection.collectionId),
      )) {
        throw new ApplicationError(
          "CONTENT_RESOURCE_COLLECTION_UNMANAGED",
          422,
          `Collection '${projection.collectionId}' is outside the managed projection boundary.`,
        );
      }
      if (projection.parentDocumentId !== null) {
        validateIdentifier(projection.parentDocumentId, "projection.parentDocumentId");
      }
      return {
        id: realmDocumentResourceId(actor.realmId, projection.documentId),
        realmId: actor.realmId,
        // Authorization metadata must never disclose draft content such as a
        // title or slug. The opaque immutable ID is the only document label.
        name: `Document ${projection.documentId}`,
        type: "document",
        parentId: projection.parentDocumentId === null
          ? realmCollectionResourceId(actor.realmId, projection.collectionId)
          : realmDocumentResourceId(actor.realmId, projection.parentDocumentId),
      };
    });
    const desiredIds = new Set(desired.map(({ id }) => id));
    const resourceById = new Map(entry.state.resources.map((resource) => [resource.id, resource]));
    const documentPrefix = realmDocumentResourcePrefix(actor.realmId);
    // Each realm owns only its document namespace. This also removes
    // projections whose collection disappeared from the schema, which can no
    // longer be discovered by walking active collection roots.
    const isManagedDocument = (resource: AuthorizationResourceRecord): boolean =>
      (resource.type === "document" || resource.type === "retired-document") &&
      resource.id.startsWith(documentPrefix);
    const stale = entry.state.resources
      .filter((resource) => isManagedDocument(resource) && !desiredIds.has(resource.id));
    const referencedResourceIds = new Set([
      ...entry.state.bindings.map(({ resourceId }) => resourceId),
      ...entry.state.roles.flatMap((role) => (role.fieldAccess ?? []).map(({ resourceId }) => resourceId)),
    ]);
    const retired = stale
      .filter(({ id }) => referencedResourceIds.has(id))
      .map((resource): AuthorizationResourceRecord => ({
        ...resource,
        name: `Retired document ${resource.id.slice(documentPrefix.length)}`,
        type: "retired-document",
        parentId: coreResourceId(actor.realmId, "content"),
      }));
    const retiredResourceIds = retired.map(({ id }) => id);
    const deleteIds = stale
      .filter(({ id }) => !referencedResourceIds.has(id))
      .map(({ id }) => id);
    const deleteSet = new Set(deleteIds);
    const upserts = [...desired, ...retired].filter((value) => {
      const before = resourceById.get(value.id);
      if (before !== undefined && before.type !== "document" && before.type !== "retired-document") {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_ID_CONFLICT",
          409,
          `Resource '${value.id}' is not a document projection.`,
        );
      }
      return before === undefined || !recordsEqual(before, value);
    });
    // Referenced resources are retired instead of deleting security policy as
    // a side effect of content lifecycle reconciliation.
    const removedBindingIds: string[] = [];
    const removedFieldAccess: { roleId: string; resourceId: string }[] = [];
    if (upserts.length === 0 && deleteIds.length === 0) {
      await this.releaseContentResourceQuarantine(actor, [...desiredIds, ...retiredResourceIds]);
      return {
        revision: entry.state.revision,
        changed: false,
        upsertedResourceIds: [],
        deletedResourceIds: [],
        retiredResourceIds,
        removedBindingIds: [],
        removedFieldAccess: [],
      };
    }
    const mutation: AuthorizationPolicyMutation = {
      type: "resource.reconcile",
      upserts,
      deleteIds,
    };
    const projected = applyPolicyMutation(entry.state, mutation);
    createKernelSnapshot(projected);
    const before = {
      resources: entry.state.resources.filter(({ id }) =>
        deleteSet.has(id) || upserts.some((value) => value.id === id)),
      bindings: entry.state.bindings.filter(({ id }) => removedBindingIds.includes(id)),
      fieldAccess: removedFieldAccess,
    };
    const after = {
      reason: input.reason,
      resources: upserts,
      deletedResourceIds: deleteIds,
      removedBindingIds,
      removedFieldAccess,
    };
    const persisted = await this.store.mutatePolicy({
      realmId: actor.realmId,
      expectedRevision: entry.state.revision,
      mutation,
      audit: this.audit(
        actor.subjectId,
        "resource.reconcile",
        "policy",
        "content-hierarchy-resources",
        before,
        after,
        null,
      ),
    });
    this.cachePersistedState(actor.realmId, persisted, entry.state.revision);
    await this.releaseContentResourceQuarantine(actor, [...desiredIds, ...retiredResourceIds]);
    return {
      revision: persisted.revision,
      changed: true,
      upsertedResourceIds: upserts.map(({ id }) => id),
      deletedResourceIds: deleteIds,
      retiredResourceIds,
      removedBindingIds,
      removedFieldAccess,
    };
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
    const entry = await this.load(actor.realmId);
    const mayInspectEffectivePermissions = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey("authorization.read"),
      resourceId: asResourceId(coreResourceId(actor.realmId, "authorization")),
      now: this.runtime.now(),
    }).allowed;
    const current = requireRecord(entry.state.resources, input.resourceId, "resource");
    if (!entry.state.resources.some(({ id }) => id === input.newParentResourceId)) {
      throw new ApplicationError(
        "AUTHORIZATION_RESOURCE_PARENT_NOT_FOUND",
        409,
        `Resource parent '${input.newParentResourceId}' does not exist.`,
      );
    }
    const nextResource = { ...current, parentId: input.newParentResourceId };
    const nextState = applyPolicyMutation(entry.state, { type: "resource.upsert", value: nextResource });
    const nextSnapshot = createKernelSnapshot(nextState);
    const affected = [...new Set(input.affectedResourceIds)];
    if (affected.length > 500) {
      throw new ApplicationError(
        "AUTHORIZATION_IMPACT_TOO_LARGE",
        413,
        "Synchronous hierarchy authorization impact is limited to 500 resources.",
        { details: { limit: 500, actual: affected.length } },
      );
    }
    affected.forEach((resourceId) => {
      if (!entry.state.resources.some(({ id }) => id === resourceId)) {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_NOT_FOUND",
          409,
          `Affected resource '${resourceId}' does not exist.`,
        );
      }
    });
    const affectedSet = new Set(affected);
    const parentChanges = current.parentId !== input.newParentResourceId;
    const coverageChanges = parentChanges && (
      entry.state.bindings.some((binding) => affectedSet.has(binding.resourceId) ||
        scopeAppliesToResource(entry.snapshot, {
          resourceId: asResourceId(binding.resourceId),
          propagation: binding.propagation,
        }, asResourceId(input.resourceId)) !==
        scopeAppliesToResource(nextSnapshot, {
          resourceId: asResourceId(binding.resourceId),
          propagation: binding.propagation,
        }, asResourceId(input.resourceId))) || entry.state.roles.some((role) =>
        (role.fieldAccess ?? []).some((rule) => affectedSet.has(rule.resourceId) ||
          scopeAppliesToResource(entry.snapshot, {
            resourceId: asResourceId(rule.resourceId),
            propagation: "self-and-children",
          }, asResourceId(input.resourceId)) !==
          scopeAppliesToResource(nextSnapshot, {
            resourceId: asResourceId(rule.resourceId),
            propagation: "self-and-children",
          }, asResourceId(input.resourceId))))
    );
    if (!mayInspectEffectivePermissions) {
      return {
        policyRevision: entry.state.revision,
        requiresAuthorizationManagement: coverageChanges,
        effectivePermissionChanges: [],
        effectiveFieldAccessChanges: [],
        effectivePermissionChangesTruncated: false,
      };
    }
    const now = this.runtime.now();
    const changes: EffectivePermissionChangeRecord[] = [];
    const fieldChanges: EffectiveFieldAccessChangeRecord[] = [];
    const maxEvaluations = 20_000;
    const maxChanges = 500;
    let evaluations = 0;
    let truncated = false;
    permissionLoop: for (const subject of entry.state.subjects) {
      for (const permission of entry.state.permissions) {
        for (const resourceId of affected) {
          if (evaluations + 2 > maxEvaluations || changes.length + fieldChanges.length >= maxChanges) {
            truncated = true;
            break permissionLoop;
          }
          const request = {
            actorSubjectId: asSubjectId(subject.id),
            action: asPermissionKey(permission.key),
            resourceId: asResourceId(resourceId),
            now,
            ...toKernelContextProperty(input.contextsByResourceId?.[resourceId]),
          } as const;
          evaluations += 2;
          const before = evaluateAccess(entry.snapshot, request);
          const after = evaluateAccess(nextSnapshot, request);
          if (before.allowed === after.allowed) continue;
          changes.push({
            subjectId: subject.id,
            resourceId,
            permission: permission.key,
            beforeAllowed: before.allowed,
            afterAllowed: after.allowed,
            change: after.allowed ? "granted" : "revoked",
          });
        }
      }
    }
    const namedFields = {
      read: [...new Set(entry.state.roles.flatMap((role) =>
        (role.fieldAccess ?? []).flatMap(({ readableFields }) => readableFields)))].sort(),
      write: [...new Set(entry.state.roles.flatMap((role) =>
        (role.fieldAccess ?? []).flatMap(({ writableFields }) => writableFields)))].sort(),
    } as const;
    const evaluateFields = (
      snapshot: PolicySnapshot,
      subjectId: string,
      resourceId: string,
      operation: "read" | "write",
    ): readonly string[] | null | undefined => {
      const candidates = namedFields[operation];
      if (evaluations + candidates.length + 1 > maxEvaluations) return undefined;
      const action = operation === "read" ? "content.read" : "content.update";
      const base = {
        actorSubjectId: asSubjectId(subjectId),
        resourceId: asResourceId(resourceId),
        access: operation,
        permission: asPermissionKey(action),
        now,
        ...toKernelContextProperty(input.contextsByResourceId?.[resourceId]),
      } as const;
      evaluations += 1;
      if (evaluateFieldAccess(snapshot, { ...base, field: "__xecms_unlisted_field_probe__" }).allowed) {
        return null;
      }
      const allowed: string[] = [];
      for (const field of candidates) {
        evaluations += 1;
        if (evaluateFieldAccess(snapshot, { ...base, field }).allowed) allowed.push(field);
      }
      return allowed;
    };
    fieldLoop: for (const subject of entry.state.subjects) {
      for (const resourceId of affected) {
        for (const operation of ["read", "write"] as const) {
          if (changes.length + fieldChanges.length >= maxChanges) {
            truncated = true;
            break fieldLoop;
          }
          const beforeFields = evaluateFields(entry.snapshot, subject.id, resourceId, operation);
          const afterFields = evaluateFields(nextSnapshot, subject.id, resourceId, operation);
          if (beforeFields === undefined || afterFields === undefined) {
            truncated = true;
            break fieldLoop;
          }
          if (fieldAllowlistsEqual(beforeFields, afterFields)) continue;
          fieldChanges.push({
            subjectId: subject.id,
            resourceId,
            operation,
            beforeFields,
            afterFields,
            change: classifyFieldAllowlistChange(beforeFields, afterFields),
          });
        }
      }
    }
    return {
      policyRevision: entry.state.revision,
      requiresAuthorizationManagement: coverageChanges,
      effectivePermissionChanges: changes,
      effectiveFieldAccessChanges: fieldChanges,
      effectivePermissionChangesTruncated: truncated,
    };
  }

  /** Makes a stale content projection fail closed until a successful reconcile. */
  public async quarantineContentResources(
    actor: AuthorizationActor,
    resourceIds: readonly string[],
    reason = "hierarchy-projection-pending",
  ): Promise<void> {
    const unique = [...new Set(resourceIds)];
    await this.store.quarantineResources({
      realmId: actor.realmId,
      resourceIds: unique,
      reason,
      actorSubjectId: actor.subjectId,
      occurredAt: this.runtime.now(),
    });
    unique.forEach((resourceId) => this.#quarantinedResources.add(
      projectionQuarantineKey(actor.realmId, resourceId),
    ));
  }

  public async releaseContentResourceQuarantine(
    actor: AuthorizationActor,
    resourceIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(resourceIds)];
    await this.store.releaseResourceQuarantine({ realmId: actor.realmId, resourceIds: unique });
    unique.forEach((resourceId) => this.#quarantinedResources.delete(
      projectionQuarantineKey(actor.realmId, resourceId),
    ));
  }

  public async quarantineAllContentResources(actor: AuthorizationActor): Promise<readonly string[]> {
    const realmId = actor.realmId;
    const entry = await this.load(realmId);
    const resourceIds = entry.state.resources
      .filter(({ type }) => type === "document")
      .map(({ id }) => id);
    await this.quarantineContentResources(actor, resourceIds, "content-projection-reconcile");
    return resourceIds;
  }

  public async createRole(
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly role: NewAuthorizationRoleRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationRoleRecord>> {
    const role: AuthorizationRoleRecord = {
      ...input.role,
      id: input.role.id ?? this.runtime.newId("role"),
    };
    validateRoleRecord(role, actor.realmId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    (role.fieldAccess ?? []).forEach(({ resourceId }) => assertResourceAcceptsPolicy(entry.state, resourceId));
    const decision = authorizeRoleCreate(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      role: toKernelRole(role),
      action: asPermissionKey("role.create"),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const persisted = await this.commit(
      actor,
      entry,
      { type: "role.create", value: role },
      "role",
      role.id,
      null,
      role,
      plainDecision(decision),
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.roles, role.id, "role"),
    };
  }

  public async updateRole(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly roleId: string;
      readonly role: AuthorizationRoleRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationRoleRecord>> {
    validateRoleRecord(input.role, actor.realmId);
    if (input.role.id !== input.roleId) identityChange("role", input.roleId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    (input.role.fieldAccess ?? []).forEach(({ resourceId }) =>
      assertResourceAcceptsPolicy(entry.state, resourceId));
    const before = requireRecord(entry.state.roles, input.roleId, "role");
    const decision = authorizeRoleUpdate(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      roleId: asRoleId(input.roleId),
      nextRole: toKernelRole(input.role),
      action: asPermissionKey("role.update"),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const persisted = await this.commit(
      actor,
      entry,
      { type: "role.update", value: input.role },
      "role",
      input.roleId,
      before,
      input.role,
      plainDecision(decision),
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.roles, input.roleId, "role"),
    };
  }

  public async deleteRole(
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly roleId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const before = requireRecord(entry.state.roles, input.roleId, "role");
    if (entry.state.bindings.some(({ roleId }) => roleId === input.roleId)) {
      throw new ApplicationError(
        "ROLE_IN_USE",
        409,
        `Role '${input.roleId}' cannot be deleted while bindings reference it.`,
      );
    }
    const decision = authorizeRoleDelete(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      roleId: asRoleId(input.roleId),
      action: asPermissionKey("role.delete"),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const persisted = await this.commit(
      actor,
      entry,
      { type: "role.delete", id: input.roleId },
      "role",
      input.roleId,
      before,
      null,
      plainDecision(decision),
    );
    return { revision: persisted.revision, value: { id: input.roleId } };
  }

  public async createBinding(
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly binding: NewAuthorizationBindingRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationBindingRecord>> {
    const binding: AuthorizationBindingRecord = {
      ...input.binding,
      id: input.binding.id ?? this.runtime.newId("binding"),
    };
    validateBindingRecord(binding, actor.realmId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    assertResourceAcceptsPolicy(entry.state, binding.resourceId);
    const decision = authorizeRoleBindingCreate(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      binding: toKernelBinding(binding),
      action: asPermissionKey("role.assign"),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const persisted = await this.commit(
      actor,
      entry,
      { type: "binding.create", value: binding },
      "binding",
      binding.id,
      null,
      binding,
      plainDecision(decision),
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.bindings, binding.id, "binding"),
    };
  }

  public async updateBinding(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly bindingId: string;
      readonly binding: AuthorizationBindingRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationBindingRecord>> {
    validateBindingRecord(input.binding, actor.realmId);
    if (input.binding.id !== input.bindingId) identityChange("binding", input.bindingId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    assertResourceAcceptsPolicy(entry.state, input.binding.resourceId);
    const before = requireRecord(entry.state.bindings, input.bindingId, "binding");
    const decision = authorizeRoleBindingUpdate(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      bindingId: asRoleBindingId(input.bindingId),
      nextBinding: toKernelBinding(input.binding),
      action: asPermissionKey("role.assign"),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const persisted = await this.commit(
      actor,
      entry,
      { type: "binding.update", value: input.binding },
      "binding",
      input.bindingId,
      before,
      input.binding,
      plainDecision(decision),
    );
    return {
      revision: persisted.revision,
      value: requireRecord(persisted.bindings, input.bindingId, "binding"),
    };
  }

  public async deleteBinding(
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly bindingId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const before = requireRecord(entry.state.bindings, input.bindingId, "binding");
    const decision = authorizeRoleBindingRemove(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      bindingId: asRoleBindingId(input.bindingId),
      action: asPermissionKey("role.assign"),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const persisted = await this.commit(
      actor,
      entry,
      { type: "binding.delete", id: input.bindingId },
      "binding",
      input.bindingId,
      before,
      null,
      plainDecision(decision),
    );
    return { revision: persisted.revision, value: { id: input.bindingId } };
  }

  public async createLevel(
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly level: NewAuthorizationLevelRecord },
  ): Promise<AuthorizationMutationResult<AuthorizationLevelRecord>> {
    const level: AuthorizationLevelRecord = {
      ...input.level,
      id: input.level.id ?? this.runtime.newId("level"),
    };
    validateLevelRecord(level, actor.realmId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    assertManageableLevel(entry.state, level, undefined);
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly levelId: string;
      readonly level: AuthorizationLevelRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationLevelRecord>> {
    validateLevelRecord(input.level, actor.realmId);
    if (input.level.id !== input.levelId) identityChange("authority level", input.levelId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.authorityLevels, input.levelId, "authority level");
    if (before.protected === true || input.level.protected === true) protectedTarget("authority level", input.levelId);
    assertManageableLevel(entry.state, input.level, input.levelId);
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly levelId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.authorityLevels, input.levelId, "authority level");
    if (before.protected === true) protectedTarget("authority level", input.levelId);
    if (entry.state.roles.some(({ levelId }) => levelId === input.levelId)) {
      throw new ApplicationError(
        "AUTHORITY_LEVEL_IN_USE",
        409,
        `Authority level '${input.levelId}' cannot be deleted while roles reference it.`,
      );
    }
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
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
      id: input.subject.id ?? this.runtime.newId("subject"),
    };
    validateSubjectRecord(subject, actor.realmId);
    if (subject.protected === true) protectedInput("subject");
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const persisted = await this.commit(
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
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
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
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
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
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.subjects, input.subjectId, "subject");
    if (before.protected === true || input.subject.protected === true) protectedTarget("subject", input.subjectId);
    if (before.type !== input.subject.type) identityChange("subject type", input.subjectId);
    const subject: AuthorizationSubjectRecord = {
      ...input.subject,
      ...(before.identityId === undefined ? {} : { identityId: before.identityId }),
    };
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly subjectId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.subjects, input.subjectId, "subject");
    if (before.protected === true) protectedTarget("subject", input.subjectId);
    if (input.subjectId === actor.subjectId) {
      throw new ApplicationError("SELF_SUBJECT_MUTATION", 403, "An actor cannot delete its own subject.");
    }
    if (entry.state.bindings.some(({ subjectId }) => subjectId === input.subjectId)) {
      throw new ApplicationError("SUBJECT_IN_USE", 409, `Subject '${input.subjectId}' has role bindings.`);
    }
    if (entry.state.groupMemberships.some(({ memberSubjectId, groupSubjectId }) =>
      memberSubjectId === input.subjectId || groupSubjectId === input.subjectId)) {
      throw new ApplicationError("SUBJECT_IN_USE", 409, `Subject '${input.subjectId}' has group memberships.`);
    }
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly membership: NewAuthorizationGroupMembershipRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationGroupMembershipRecord>> {
    const membership: AuthorizationGroupMembershipRecord = {
      ...input.membership,
      id: input.membership.id ?? this.runtime.newId("membership"),
    };
    validateGroupMembershipRecord(membership, actor.realmId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    assertValidGroupMembership(entry.state, membership, undefined);
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly membershipId: string;
      readonly membership: AuthorizationGroupMembershipRecord;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationGroupMembershipRecord>> {
    validateGroupMembershipRecord(input.membership, actor.realmId);
    if (input.membership.id !== input.membershipId) identityChange("group membership", input.membershipId);
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.groupMemberships, input.membershipId, "group membership");
    assertValidGroupMembership(entry.state, input.membership, input.membershipId);
    const persisted = await this.commit(
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
    actor: AuthorizationActor,
    input: { readonly expectedRevision: number; readonly membershipId: string },
  ): Promise<AuthorizationMutationResult<{ readonly id: string }>> {
    const entry = await this.loadForMutation(actor, input.expectedRevision);
    const decision = this.requireOwnerManagement(actor, entry);
    const before = requireRecord(entry.state.groupMemberships, input.membershipId, "group membership");
    const persisted = await this.commit(
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

  private async load(realmId: string): Promise<PolicyCacheEntry> {
    validateIdentifier(realmId, "realmId");
    const revision = await this.store.getPolicyRevision(realmId);
    if (revision === null) {
      throw new ApplicationError(
        "AUTHORIZATION_NOT_INITIALIZED",
        503,
        `Authorization policy for realm '${realmId}' is not initialized.`,
      );
    }
    const cached = this.#cache.get(realmId);
    if (cached?.state.revision === revision) return cached;
    const state = await this.store.loadPolicy(realmId);
    if (state === null) {
      throw new ApplicationError(
        "AUTHORIZATION_POLICY_UNAVAILABLE",
        503,
        `Authorization policy revision '${revision}' could not be loaded.`,
      );
    }
    if (state.realm.id !== realmId) {
      throw new ApplicationError("AUTHORIZATION_REALM_MISMATCH", 500, "The stored policy belongs to another realm.");
    }
    const entry = { state, snapshot: createKernelSnapshot(state) };
    this.#cache.set(realmId, entry);
    return entry;
  }

  private async authorizeAt(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
    now: string,
    operation: "authorize" | "simulate" = "authorize",
  ): Promise<AuthorizationDecisionRecord> {
    assertCanonicalPermission(input.action);
    await this.assertProjectionAvailable(actor.realmId, input.resourceId);
    const entry = await this.load(actor.realmId);
    const decision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(input.action),
      resourceId: asResourceId(input.resourceId),
      now,
      ...toKernelContextProperty(input.context),
    });
    if (await this.useRealmFullAccess(entry, actor, {
      action: input.action,
      resourceId: input.resourceId,
      at: now,
      operation,
    })) {
      return realmFullAccessDecision(
        actor,
        input.action,
        input.resourceId,
        entry.state.realm.rootResourceId,
      );
    }
    return plainDecision(decision);
  }

  /**
   * Full Access is an additive Realm-local capability, never an alternative
   * identity/resource validator. It intentionally does not participate in the
   * protected Owner and hierarchy-management mutation paths below.
   */
  private async useRealmFullAccess(
    entry: PolicyCacheEntry,
    actor: AuthorizationActor,
    input: Omit<RealmFullAccessUse, "realmId" | "subjectId">,
    validateUse?: () => void,
  ): Promise<boolean> {
    const resolver = this.realmFullAccessResolver;
    if (resolver === undefined || actor.realmId === SYSTEM_AUTHORIZATION_REALM_ID) return false;
    if (entry.state.realm.id !== actor.realmId) return false;

    const permission = entry.state.permissions.find(({ key }) => key === input.action);
    if (permission === undefined || permission.hierarchyGuard !== "none") return false;
    const subject = entry.state.subjects.find(({ id }) => id === actor.subjectId);
    const resource = entry.state.resources.find(({ id }) => id === input.resourceId);
    if (
      subject === undefined
      || subject.disabled === true
      || subject.realmId !== actor.realmId
      || resource === undefined
      || resource.realmId !== actor.realmId
    ) {
      return false;
    }

    if (!await resolver.hasActiveFullAccess(actor.realmId, actor.subjectId, input.at)) return false;
    // Validation that historically followed the enclosing RBAC decision runs
    // only after Full Access is known to be active, but before a successful-use
    // audit is emitted. This preserves M3 error precedence when no resolver is
    // configured and avoids auditing rejected field payloads as successful use.
    validateUse?.();
    await resolver.recordUse({
      realmId: actor.realmId,
      subjectId: actor.subjectId,
      action: input.action,
      resourceId: input.resourceId,
      at: input.at,
      operation: input.operation,
      ...(input.field === undefined ? {} : { field: input.field }),
      ...(input.fields === undefined ? {} : { fields: [...input.fields] }),
    });
    return true;
  }

  private async loadForMutation(
    actor: AuthorizationActor,
    expectedRevision: number,
  ): Promise<PolicyCacheEntry> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ApplicationError("POLICY_REVISION_INVALID", 400, "expectedRevision must be a positive integer.");
    }
    const entry = await this.load(actor.realmId);
    const actorSubject = entry.state.subjects.find(({ id }) => id === actor.subjectId);
    if (actorSubject === undefined || actorSubject.realmId !== actor.realmId) {
      throw new ApplicationError("AUTHORIZATION_ACTOR_UNKNOWN", 403, "The actor does not belong to this realm.");
    }
    if (entry.state.revision !== expectedRevision) {
      throw new ApplicationError(
        "POLICY_REVISION_CONFLICT",
        409,
        `Expected policy revision '${expectedRevision}', but current revision is '${entry.state.revision}'.`,
        { details: { expectedRevision, actualRevision: entry.state.revision } },
      );
    }
    return entry;
  }

  private requireOwnerManagement(
    actor: AuthorizationActor,
    entry: PolicyCacheEntry,
  ): AuthorizationDecisionRecord {
    const decision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(AUTHORIZATION_MANAGE_PERMISSION),
      resourceId: asResourceId(entry.state.realm.rootResourceId),
      now: this.runtime.now(),
    });
    this.requireDecision(decision);
    const actorSubject = entry.state.subjects.find(({ id }) => id === actor.subjectId);
    const hasProtectedOwnerGrant = actorSubject?.protected === true && decision.matchedGrants.some((grant) => {
      const role = entry.state.roles.find(({ id }) => id === grant.sourceRoleId);
      const level = role === undefined
        ? undefined
        : entry.state.authorityLevels.find(({ id }) => id === role.levelId);
      return role?.protected === true && level?.protected === true;
    });
    if (!hasProtectedOwnerGrant) {
      throw new ApplicationError(
        "OWNER_AUTHORIZATION_REQUIRED",
        403,
        `The protected '${AUTHORIZATION_MANAGE_PERMISSION}' owner grant is required.`,
      );
    }
    return plainDecision(decision);
  }

  private async commit<TMutation extends AuthorizationPolicyMutation>(
    actor: AuthorizationActor,
    entry: PolicyCacheEntry,
    mutation: TMutation,
    targetType: AuthorizationAuditTargetType,
    targetId: string,
    before: unknown | null,
    after: unknown | null,
    decision: AuthorizationDecisionRecord | null = null,
  ): Promise<AuthorizationPolicyState> {
    const projected = applyPolicyMutation(entry.state, mutation);
    createKernelSnapshot(projected);
    const persisted = await this.store.mutatePolicy({
      realmId: actor.realmId,
      expectedRevision: entry.state.revision,
      mutation,
      audit: this.audit(actor.subjectId, mutation.type, targetType, targetId, before, after, decision),
    });
    this.cachePersistedState(actor.realmId, persisted, entry.state.revision);
    return persisted;
  }

  private audit(
    actorSubjectId: string,
    action: string,
    targetType: AuthorizationAuditTargetType,
    targetId: string,
    before: unknown | null,
    after: unknown | null,
    decision: AuthorizationDecisionRecord | null,
  ): AuthorizationAuditDraft {
    return {
      id: this.runtime.newAuditId(),
      actorSubjectId,
      action,
      targetType,
      targetId,
      before,
      after,
      decision,
      occurredAt: this.runtime.now(),
    };
  }

  private cachePersistedState(
    realmId: string,
    state: AuthorizationPolicyState,
    previousRevision: number | null,
  ): void {
    if (state.realm.id !== realmId) {
      throw new ApplicationError("AUTHORIZATION_REALM_MISMATCH", 500, "The persisted policy belongs to another realm.");
    }
    if (!Number.isSafeInteger(state.revision) || state.revision < 1 ||
      (previousRevision !== null && state.revision <= previousRevision)) {
      this.#cache.delete(realmId);
      throw new ApplicationError(
        "POLICY_REVISION_NOT_ADVANCED",
        500,
        "The authorization store did not advance the policy revision.",
      );
    }
    this.#cache.set(realmId, { state, snapshot: createKernelSnapshot(state) });
  }

  private requireDecision(decision: AccessDecision): void {
    if (!decision.allowed) authorizationDenied(plainDecision(decision));
  }

  private async assertProjectionAvailable(realmId: string, resourceId: string): Promise<void> {
    if (!this.#quarantinedResources.has(projectionQuarantineKey(realmId, resourceId)) &&
      !(await this.store.isResourceQuarantined(realmId, resourceId))) return;
    throw new ApplicationError(
      "AUTHORIZATION_PROJECTION_UNAVAILABLE",
      503,
      `Authorization projection for resource '${resourceId}' is being reconciled.`,
    );
  }
}

export function collectionResourceId(collectionId: string): string {
  validateIdentifier(collectionId, "collectionId");
  return `resource:collection:${collectionId}`;
}

export function documentResourceId(documentId: string): string {
  validateIdentifier(documentId, "documentId");
  return `resource:document:${documentId}`;
}

/**
 * Realm-aware collection projection ID. System Realm keeps its M3 identifier
 * for backwards compatibility; every other realm gets an isolated namespace.
 */
export function realmCollectionResourceId(realmId: string, collectionId: string): string {
  validateIdentifier(realmId, "realmId");
  validateIdentifier(collectionId, "collectionId");
  return `${realmCollectionResourcePrefix(realmId)}${collectionId}`;
}

/**
 * Realm-aware document projection ID. System Realm keeps its M3 identifier
 * for backwards compatibility; every other realm gets an isolated namespace.
 */
export function realmDocumentResourceId(realmId: string, documentId: string): string {
  validateIdentifier(realmId, "realmId");
  validateIdentifier(documentId, "documentId");
  return `${realmDocumentResourcePrefix(realmId)}${documentId}`;
}

/** @deprecated Use realmCollectionResourceId. Kept for early M3 adapters. */
export function collectionAuthorizationResourceId(realmId: string, collectionId: string): string {
  return realmCollectionResourceId(realmId, collectionId);
}

function realmCollectionResourcePrefix(realmId: string): string {
  return realmId === SYSTEM_AUTHORIZATION_REALM_ID
    ? "resource:collection:"
    : `authorization:${realmId}:resource:collection:`;
}

function realmDocumentResourcePrefix(realmId: string): string {
  return realmId === SYSTEM_AUTHORIZATION_REALM_ID
    ? "resource:document:"
    : `authorization:${realmId}:resource:document:`;
}

function projectionQuarantineKey(realmId: string, resourceId: string): string {
  return `${realmId}\u0000${resourceId}`;
}

function coreResourceId(
  realmId: string,
  kind: "schema" | "content" | "authorization" | "audit",
): string {
  if (realmId === SYSTEM_AUTHORIZATION_REALM_ID) {
    switch (kind) {
      case "schema": return SYSTEM_SCHEMA_RESOURCE_ID;
      case "content": return SYSTEM_CONTENT_RESOURCE_ID;
      case "authorization": return SYSTEM_AUTHORIZATION_RESOURCE_ID;
      case "audit": return SYSTEM_AUDIT_RESOURCE_ID;
    }
  }
  return `authorization:${realmId}:resource:${kind}`;
}

function createKernelSnapshot(state: AuthorizationPolicyState): PolicySnapshot {
  try {
    return createPolicySnapshot({
      realms: [{
        id: asRealmId(state.realm.id),
        rootResourceId: asResourceId(state.realm.rootResourceId),
      }],
      subjects: state.subjects.map((subject) => ({
        id: asSubjectId(subject.id),
        realmId: asRealmId(subject.realmId),
        type: subject.type,
        ...(subject.protected === undefined ? {} : { protected: subject.protected }),
        ...(subject.disabled === undefined ? {} : { disabled: subject.disabled }),
      })),
      resources: state.resources.map((resource) => ({
        id: asResourceId(resource.id),
        realmId: asRealmId(resource.realmId),
        ...(resource.parentId === undefined ? {} : { parentId: asResourceId(resource.parentId) }),
        ...(resource.protected === undefined ? {} : { protected: resource.protected }),
      })),
      authorityLevels: state.authorityLevels.map((level) => ({
        id: asAuthorityLevelId(level.id),
        realmId: asRealmId(level.realmId),
        name: level.name,
        rank: level.rank,
        ...(level.protected === undefined ? {} : { protected: level.protected }),
      })),
      permissions: state.permissions.map((permission) => ({
        key: asPermissionKey(permission.key),
        hierarchyGuard: permission.hierarchyGuard,
        delegatable: permission.delegatable,
        ...(permission.protected === undefined ? {} : { protected: permission.protected }),
      })),
      roles: state.roles.map(toKernelRole),
      bindings: state.bindings.map(toKernelBinding),
      groupMemberships: state.groupMemberships.map((membership) => ({
        id: asGroupMembershipId(membership.id),
        realmId: asRealmId(membership.realmId),
        memberSubjectId: asSubjectId(membership.memberSubjectId),
        groupSubjectId: asSubjectId(membership.groupSubjectId),
      })),
    });
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      throw new ApplicationError(
        "AUTHORIZATION_POLICY_INVALID",
        422,
        "The authorization policy graph is invalid.",
        {
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path,
          })),
        },
      );
    }
    throw error;
  }
}

function toKernelRole(role: AuthorizationRoleRecord): Role {
  return {
    id: asRoleId(role.id),
    realmId: asRealmId(role.realmId),
    levelId: asAuthorityLevelId(role.levelId),
    name: role.name,
    permissions: role.permissions.map(asPermissionKey),
    delegatablePermissions: role.delegatablePermissions.map(asPermissionKey),
    ...(role.fieldAccess === undefined ? {} : {
      fieldAccess: role.fieldAccess.map((rule) => ({
        resourceId: asResourceId(rule.resourceId),
        readableFields: [...rule.readableFields],
        writableFields: [...rule.writableFields],
      })),
    }),
    ...(role.protected === undefined ? {} : { protected: role.protected }),
  };
}

function toKernelBinding(binding: AuthorizationBindingRecord): RoleBinding {
  return {
    id: asRoleBindingId(binding.id),
    realmId: asRealmId(binding.realmId),
    subjectId: asSubjectId(binding.subjectId),
    roleId: asRoleId(binding.roleId),
    scope: {
      resourceId: asResourceId(binding.resourceId),
      propagation: binding.propagation,
    },
    ...(binding.validFrom === undefined ? {} : { validFrom: binding.validFrom }),
    ...(binding.validUntil === undefined ? {} : { validUntil: binding.validUntil }),
    ...(binding.constraints === undefined ? {} : {
      constraints: {
        ...(binding.constraints.ownerSubjectId === undefined
          ? {}
          : { ownerSubjectId: asSubjectId(binding.constraints.ownerSubjectId) }),
        ...(binding.constraints.statuses === undefined
          ? {}
          : { statuses: [...binding.constraints.statuses] }),
      },
    }),
    ...(binding.protected === undefined ? {} : { protected: binding.protected }),
  };
}

function toKernelContextProperty(
  context: AuthorizationEvaluationContext | undefined,
): { readonly context?: AccessEvaluationContext } {
  if (context === undefined) return {};
  return {
    context: {
      ...(context.ownerSubjectId === undefined
        ? {}
        : { ownerSubjectId: asSubjectId(context.ownerSubjectId) }),
      ...(context.status === undefined ? {} : { status: context.status }),
    },
  };
}

function optionalContext(
  context: AuthorizationEvaluationContext | undefined,
): { readonly context?: AuthorizationEvaluationContext } {
  return context === undefined ? {} : { context };
}

function plainDecision(decision: AccessDecision): AuthorizationDecisionRecord {
  return {
    allowed: decision.allowed,
    action: decision.action,
    reasonCode: decision.reasonCode,
    matchedGrants: decision.matchedGrants.map((grant) => ({
      permission: grant.permission,
      sourceRoleId: grant.sourceRoleId,
      sourceLevelId: grant.sourceLevelId,
      sourceRank: grant.sourceRank,
      sourceBindingId: grant.sourceBindingId,
      sourceScope: {
        resourceId: grant.sourceScope.resourceId,
        propagation: grant.sourceScope.propagation,
      },
      membershipPath: [...grant.membershipPath],
    })),
    ...(decision.evaluatedScope === undefined ? {} : {
      evaluatedScope: {
        resourceId: decision.evaluatedScope.resourceId,
        propagation: decision.evaluatedScope.propagation,
      },
    }),
    ...(decision.actorLevel === undefined ? {} : { actorLevel: decision.actorLevel }),
    ...(decision.targetLevel === undefined ? {} : { targetLevel: decision.targetLevel }),
  };
}

function plainFieldDecision(decision: FieldAccessDecision): AuthorizationFieldDecisionRecord {
  return {
    allowed: decision.allowed,
    access: decision.access,
    field: decision.field,
    resourceId: decision.resourceId,
    reasonCode: decision.reasonCode,
    matchedGrants: decision.matchedGrants.map((grant) => ({
      sourceRoleId: grant.sourceRoleId,
      sourceBindingId: grant.sourceBindingId,
      sourceResourceId: grant.sourceResourceId,
      membershipPath: [...grant.membershipPath],
    })),
  };
}

function realmFullAccessDecision(
  actor: AuthorizationActor,
  action: string,
  resourceId: string,
  rootResourceId: string,
): AuthorizationDecisionRecord {
  const sourceId = realmFullAccessSourceId(actor.realmId);
  return {
    allowed: true,
    action,
    reasonCode: "ALLOW_REALM_FULL_ACCESS",
    matchedGrants: [{
      sourceKind: "realm-full-access",
      sourceRealmId: actor.realmId,
      sourceSubjectId: actor.subjectId,
      permission: action,
      // Compatibility-shaped provenance fields. sourceKind distinguishes these
      // synthetic IDs from policy Role/Level/Binding records.
      sourceRoleId: `${sourceId}:role`,
      sourceLevelId: `${sourceId}:level`,
      sourceRank: 0,
      sourceBindingId: `${sourceId}:subject:${actor.subjectId}`,
      sourceScope: { resourceId: rootResourceId, propagation: "self-and-children" },
      membershipPath: [],
    }],
    evaluatedScope: { resourceId, propagation: "self" },
  };
}

function realmFullAccessFieldDecision(
  actor: AuthorizationActor,
  resourceId: string,
  field: string,
  access: FieldAccessMode,
  rootResourceId: string,
): AuthorizationFieldDecisionRecord {
  const sourceId = realmFullAccessSourceId(actor.realmId);
  return {
    allowed: true,
    access,
    field,
    resourceId,
    reasonCode: "ALLOW_REALM_FULL_ACCESS",
    matchedGrants: [{
      sourceKind: "realm-full-access",
      sourceRealmId: actor.realmId,
      sourceSubjectId: actor.subjectId,
      sourceRoleId: `${sourceId}:role`,
      sourceBindingId: `${sourceId}:subject:${actor.subjectId}`,
      sourceResourceId: rootResourceId,
      membershipPath: [],
    }],
  };
}

function realmFullAccessSourceId(realmId: string): string {
  return `authorization:${realmId}:realm-full-access`;
}

function fieldAllowlistsEqual(
  left: readonly string[] | null,
  right: readonly string[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function classifyFieldAllowlistChange(
  before: readonly string[] | null,
  after: readonly string[] | null,
): "broadened" | "narrowed" | "changed" {
  if (before === null) return "narrowed";
  if (after === null) return "broadened";
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  if (before.every((field) => afterSet.has(field))) return "broadened";
  if (after.every((field) => beforeSet.has(field))) return "narrowed";
  return "changed";
}

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

function validateRoleRecord(role: AuthorizationRoleRecord, realmId: string): void {
  validateIdentifier(role.id, "role.id");
  validateRealm(role.realmId, realmId, "role");
  validateIdentifier(role.levelId, "role.levelId");
  validateDisplayName(role.name, "role.name");
  if (role.description !== undefined && role.description.length > 1_000) {
    throw new ApplicationError("ROLE_DESCRIPTION_INVALID", 422, "Role description cannot exceed 1000 characters.");
  }
  assertUniqueCanonicalPermissions(role.permissions, "role.permissions");
  assertUniqueCanonicalPermissions(role.delegatablePermissions, "role.delegatablePermissions");
  for (const permission of role.delegatablePermissions) {
    if (!role.permissions.includes(permission)) {
      throw new ApplicationError(
        "INVALID_ROLE_DELEGATION",
        422,
        `Delegatable permission '${permission}' is not assigned to the role.`,
      );
    }
  }
  if (role.fieldAccess !== undefined) {
    const duplicateResource = findDuplicate(role.fieldAccess.map(({ resourceId }) => resourceId));
    if (duplicateResource !== undefined) {
      throw new ApplicationError(
        "DUPLICATE_FIELD_ACCESS_RESOURCE",
        422,
        `Role field access contains duplicate resource '${duplicateResource}'.`,
      );
    }
    role.fieldAccess.forEach((rule) => {
      validateIdentifier(rule.resourceId, "role.fieldAccess.resourceId");
      assertUniqueFields(rule.readableFields, "readableFields");
      assertUniqueFields(rule.writableFields, "writableFields");
    });
  }
}

function validateBindingRecord(binding: AuthorizationBindingRecord, realmId: string): void {
  validateIdentifier(binding.id, "binding.id");
  validateRealm(binding.realmId, realmId, "binding");
  validateIdentifier(binding.subjectId, "binding.subjectId");
  validateIdentifier(binding.roleId, "binding.roleId");
  validateIdentifier(binding.resourceId, "binding.resourceId");
  if (!new Set<ScopePropagation>(["self", "children", "self-and-children"]).has(binding.propagation)) {
    throw new ApplicationError("BINDING_PROPAGATION_INVALID", 422, "Binding propagation is invalid.");
  }
  validateOptionalInstant(binding.validFrom, "binding.validFrom");
  validateOptionalInstant(binding.validUntil, "binding.validUntil");
  if (binding.validFrom !== undefined && binding.validUntil !== undefined &&
    Date.parse(binding.validFrom) >= Date.parse(binding.validUntil)) {
    throw new ApplicationError("BINDING_PERIOD_INVALID", 422, "Binding validFrom must precede validUntil.");
  }
  if (binding.constraints?.ownerSubjectId !== undefined) {
    validateIdentifier(binding.constraints.ownerSubjectId, "binding.constraints.ownerSubjectId");
  }
  if (binding.constraints?.statuses !== undefined) {
    if (binding.constraints.statuses.length === 0) {
      throw new ApplicationError("BINDING_CONSTRAINT_INVALID", 422, "Binding statuses cannot be empty.");
    }
    const duplicateStatus = findDuplicate(binding.constraints.statuses);
    if (duplicateStatus !== undefined || binding.constraints.statuses.some((status) => status.trim().length === 0)) {
      throw new ApplicationError("BINDING_CONSTRAINT_INVALID", 422, "Binding statuses must be unique and non-empty.");
    }
  }
}

function policyReferencesResource(state: AuthorizationPolicyState, resourceId: string): boolean {
  return state.bindings.some((binding) => binding.resourceId === resourceId) ||
    state.roles.some((role) => (role.fieldAccess ?? []).some((rule) => rule.resourceId === resourceId));
}

function assertResourceAcceptsPolicy(state: AuthorizationPolicyState, resourceId: string): void {
  const resource = state.resources.find(({ id }) => id === resourceId);
  if (resource?.type === "retired-document" || resource?.type === "retired-collection") {
    throw new ApplicationError(
      "AUTHORIZATION_RESOURCE_RETIRED",
      409,
      `Retired resource '${resourceId}' cannot receive new policy references.`,
    );
  }
}

function validateLevelRecord(level: AuthorizationLevelRecord, realmId: string): void {
  validateIdentifier(level.id, "level.id");
  validateRealm(level.realmId, realmId, "authority level");
  validateDisplayName(level.name, "level.name");
  if (!Number.isSafeInteger(level.rank)) {
    throw new ApplicationError("AUTHORITY_LEVEL_RANK_INVALID", 422, "Authority level rank must be a safe integer.");
  }
}

function validateSubjectRecord(subject: AuthorizationSubjectRecord, realmId: string): void {
  validateIdentifier(subject.id, "subject.id");
  validateRealm(subject.realmId, realmId, "subject");
  if (subject.identityId !== undefined) validateIdentifier(subject.identityId, "subject.identityId");
  validateDisplayName(subject.name, "subject.name");
  if (!new Set<SubjectType>(["user", "group", "service-account"]).has(subject.type)) {
    throw new ApplicationError("SUBJECT_TYPE_INVALID", 422, "Subject type is invalid.");
  }
}

function validateGroupMembershipRecord(
  membership: AuthorizationGroupMembershipRecord,
  realmId: string,
): void {
  validateIdentifier(membership.id, "membership.id");
  validateRealm(membership.realmId, realmId, "group membership");
  validateIdentifier(membership.memberSubjectId, "membership.memberSubjectId");
  validateIdentifier(membership.groupSubjectId, "membership.groupSubjectId");
}

function assertManageableLevel(
  state: AuthorizationPolicyState,
  level: AuthorizationLevelRecord,
  replacedId: string | undefined,
): void {
  if (level.protected === true) protectedInput("authority level");
  const protectedRanks = state.authorityLevels
    .filter(({ protected: isProtected }) => isProtected === true)
    .map(({ rank }) => rank);
  const ownerRank = protectedRanks.length === 0 ? undefined : Math.max(...protectedRanks);
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

function assertValidGroupMembership(
  state: AuthorizationPolicyState,
  membership: AuthorizationGroupMembershipRecord,
  replacedId: string | undefined,
): void {
  const member = requireRecord(state.subjects, membership.memberSubjectId, "member subject");
  const group = requireRecord(state.subjects, membership.groupSubjectId, "group subject");
  if (group.type !== "group") {
    throw new ApplicationError(
      "GROUP_MEMBERSHIP_TARGET_NOT_GROUP",
      422,
      `Subject '${group.id}' is not a group.`,
    );
  }
  if (member.realmId !== membership.realmId || group.realmId !== membership.realmId) {
    throw new ApplicationError("AUTHORIZATION_REALM_MISMATCH", 422, "Group membership crosses realms.");
  }
  if (membership.memberSubjectId === membership.groupSubjectId) {
    throw new ApplicationError("GROUP_MEMBERSHIP_CYCLE", 422, "A group cannot contain itself.");
  }
  if (state.groupMemberships.some((candidate) =>
    candidate.id !== replacedId &&
    candidate.memberSubjectId === membership.memberSubjectId &&
    candidate.groupSubjectId === membership.groupSubjectId)) {
    throw new ApplicationError("DUPLICATE_GROUP_MEMBERSHIP", 409, "The group membership already exists.");
  }
  if (member.type === "group") {
    const memberships = state.groupMemberships
      .filter(({ id }) => id !== replacedId)
      .concat(membership);
    const pending = [membership.groupSubjectId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === membership.memberSubjectId) {
        throw new ApplicationError("GROUP_MEMBERSHIP_CYCLE", 422, "The group membership creates a cycle.");
      }
      if (visited.has(current)) continue;
      visited.add(current);
      memberships
        .filter(({ memberSubjectId }) => memberSubjectId === current)
        .forEach(({ groupSubjectId }) => pending.push(groupSubjectId));
    }
  }
}

function validateRealm(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new ApplicationError(
      "AUTHORIZATION_REALM_MISMATCH",
      422,
      `The ${label} belongs to realm '${actual}', not '${expected}'.`,
    );
  }
}

function validateIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 255) {
    throw new ApplicationError("AUTHORIZATION_ID_INVALID", 422, `${label} must be a non-empty identifier.`);
  }
}

function validateDisplayName(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 120) {
    throw new ApplicationError("AUTHORIZATION_NAME_INVALID", 422, `${label} must contain 1-120 characters.`);
  }
}

function validateOptionalInstant(value: string | undefined, label: string): void {
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new ApplicationError("AUTHORIZATION_INSTANT_INVALID", 422, `${label} must be an ISO timestamp.`);
  }
}

function assertCanonicalPermission(permission: string): void {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(permission)) {
    throw new ApplicationError(
      "PERMISSION_KEY_INVALID",
      422,
      `Permission '${permission}' must be a canonical dot-delimited key.`,
    );
  }
}

function assertUniqueCanonicalPermissions(permissions: readonly string[], label: string): void {
  const duplicate = findDuplicate(permissions);
  if (duplicate !== undefined) {
    throw new ApplicationError("DUPLICATE_PERMISSION", 422, `${label} contains duplicate '${duplicate}'.`);
  }
  permissions.forEach(assertCanonicalPermission);
}

function assertUniqueFields(fields: readonly string[], label: string): void {
  const duplicate = findDuplicate(fields);
  if (duplicate !== undefined) {
    throw new ApplicationError("DUPLICATE_FIELD_ACCESS", 422, `${label} contains duplicate '${duplicate}'.`);
  }
  fields.forEach(validateFieldName);
}

function validateFieldName(field: string): void {
  if (typeof field !== "string" || field.trim().length === 0 || field.length > 255) {
    throw new ApplicationError("FIELD_NAME_INVALID", 422, "Field name must contain 1-255 characters.");
  }
}

function requireRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  id: string,
  label: string,
): TRecord {
  const record = records.find((candidate) => candidate.id === id);
  if (record === undefined) {
    throw new ApplicationError(
      "AUTHORIZATION_OBJECT_NOT_FOUND",
      404,
      `${label[0]?.toUpperCase() ?? "O"}${label.slice(1)} '${id}' was not found.`,
    );
  }
  return record;
}

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function identityChange(label: string, id: string): never {
  throw new ApplicationError(
    "AUTHORIZATION_IDENTITY_CHANGE_NOT_ALLOWED",
    422,
    `The ${label} identity '${id}' cannot be changed.`,
  );
}

function protectedTarget(label: string, id: string): never {
  throw new ApplicationError(
    "AUTHORIZATION_PROTECTED_TARGET",
    403,
    `Protected ${label} '${id}' cannot be changed.`,
  );
}

function protectedInput(label: string): never {
  throw new ApplicationError(
    "AUTHORIZATION_PROTECTED_INPUT_NOT_ALLOWED",
    403,
    `A protected ${label} can only be created during policy initialization.`,
  );
}

function authorizationDenied(decision: AuthorizationDecisionRecord): never {
  throw new ApplicationError(
    "AUTHORIZATION_DENIED",
    403,
    `Authorization denied: ${decision.reasonCode}.`,
    { details: { decision } },
  );
}

function deepFreezePolicySeed(state: AuthorizationPolicySeed): AuthorizationPolicySeed {
  const freezeArray = <T>(values: readonly T[]): readonly T[] => Object.freeze([...values]);
  return Object.freeze({
    realm: Object.freeze({ ...state.realm }),
    subjects: freezeArray(state.subjects.map((subject) => Object.freeze({ ...subject }))),
    resources: freezeArray(state.resources.map((resource) => Object.freeze({ ...resource }))),
    authorityLevels: freezeArray(state.authorityLevels.map((level) => Object.freeze({ ...level }))),
    permissions: freezeArray(state.permissions.map((permission) => Object.freeze({ ...permission }))),
    roles: freezeArray(state.roles.map((role) => Object.freeze({
      ...role,
      permissions: freezeArray(role.permissions),
      delegatablePermissions: freezeArray(role.delegatablePermissions),
      ...(role.fieldAccess === undefined ? {} : {
        fieldAccess: freezeArray(role.fieldAccess.map((rule) => Object.freeze({
          ...rule,
          readableFields: freezeArray(rule.readableFields),
          writableFields: freezeArray(rule.writableFields),
        }))),
      }),
    }))),
    bindings: freezeArray(state.bindings.map((binding) => Object.freeze({
      ...binding,
      ...(binding.constraints === undefined ? {} : {
        constraints: Object.freeze({
          ...binding.constraints,
          ...(binding.constraints.statuses === undefined
            ? {}
            : { statuses: freezeArray(binding.constraints.statuses) }),
        }),
      }),
    }))),
    groupMemberships: freezeArray(
      state.groupMemberships.map((membership) => Object.freeze({ ...membership })),
    ),
  });
}
