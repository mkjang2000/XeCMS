export type ContentFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "enum"
  | "json"
  | "object"
  | "array"
  | "component"
  | "blocks"
  | "rich-text"
  | "relation"
  | "upload";

/** @deprecated M2 Admin supports every content field type. */
export type BasicFieldType = ContentFieldType;

export interface CollectionSelectOption {
  readonly label: string;
  readonly value: string;
}

export interface CollectionHierarchy {
  readonly enabled: true;
  readonly maxDepth?: number;
  readonly ordering?: "manual" | "created-at" | "field";
  readonly orderingFieldId?: string;
  readonly slugPath?: boolean;
  readonly permissionInheritance?: boolean;
}

export interface CollectionAuth {
  readonly enabled: true;
  readonly realmKey: string;
  readonly identifierFieldIds: readonly string[];
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: "explicit" | "jit";
  readonly defaultRoleIds: readonly string[];
}

export interface AdminUser {
  readonly id: string;
  readonly username: string;
}

export interface SessionResult {
  readonly user: AdminUser | null;
}

export interface BootstrapStatus {
  readonly required: boolean;
}

export interface AuthCredentials {
  readonly username: string;
  readonly password: string;
}

export type IdentityRealmStatus = "provisioning" | "active" | "disabled";
export type RealmProvisioningMode = "explicit" | "jit";
export type RealmRegistrationMode = "closed" | "open";
export type RealmMembershipStatus = "pending" | "active" | "suspended";

export interface GlobalIdentity {
  readonly globalIdentityId: string;
  readonly primaryIdentifier: string;
  readonly originRealmId: string;
  readonly credentialVersion: number;
  readonly disabledAt?: string;
}

export interface IdentityRealm {
  readonly realmId: string;
  readonly realmKey: string;
  readonly name: string;
  readonly kind: "system" | "content";
  readonly status: IdentityRealmStatus;
  readonly profileCollectionId?: string;
  readonly authentication: {
    readonly acceptSystemIdentities: boolean;
    readonly provisioning: RealmProvisioningMode;
    readonly registration: RealmRegistrationMode;
    readonly defaultRoleIds: readonly string[];
  };
  readonly revision: number;
  readonly createdAt?: string;
  readonly createdBy?: string;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
}

export interface RealmMembership {
  readonly membershipId: string;
  readonly globalIdentityId: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly profileCollectionId?: string;
  readonly profileDocumentId?: string;
  readonly status: RealmMembershipStatus;
  readonly provisionedBy: "explicit" | "invitation" | "jit" | "account-link" | "signup";
  readonly revision: number;
  readonly createdAt: string;
  readonly activatedAt?: string;
  readonly suspendedAt?: string;
  readonly identity?: GlobalIdentity;
}

export interface RealmFullAccessBinding {
  readonly bindingId: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly grantedByGlobalIdentityId: string;
  readonly grantedBySubjectId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly validUntil?: string;
  readonly revokedAt?: string;
  readonly revokedByGlobalIdentityId?: string;
}

export interface CreateIdentityRealmInput {
  readonly key: string;
  readonly name: string;
  readonly acceptSystemIdentities?: boolean;
  readonly provisioning?: RealmProvisioningMode;
  readonly registration?: RealmRegistrationMode;
  readonly defaultRoleIds?: readonly string[];
}

export interface UpdateIdentityRealmInput {
  readonly expectedRevision: number;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: RealmProvisioningMode;
  readonly registration: RealmRegistrationMode;
  readonly defaultRoleIds: readonly string[];
}

export interface ProvisionRealmMembershipInput {
  readonly globalIdentityId: string;
  readonly profile: Readonly<Record<string, unknown>>;
  readonly password: string;
}

export interface GrantRealmFullAccessInput {
  readonly subjectId: string;
  readonly reason: string;
  readonly password: string;
  readonly validUntil?: string;
}

export interface CollectionField {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly type: ContentFieldType;
  readonly required: boolean;
  readonly unique?: boolean;
  readonly localized?: boolean;
  readonly readOnly?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer?: boolean;
  readonly options?: readonly CollectionSelectOption[];
  readonly multiple?: boolean;
  readonly relationId?: string;
  readonly targetCollectionId?: string;
  readonly cardinality?: "one" | "many";
  readonly onDelete?: "restrict" | "nullify" | "cascade";
  readonly componentId?: string;
  readonly allowedComponentIds?: readonly string[];
  readonly acceptedMimeTypes?: readonly string[];
  readonly editor?: string;
  readonly fields?: readonly CollectionField[];
  readonly defaultValue?: unknown;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface CollectionFieldDraft {
  readonly id?: string;
  readonly name: string;
  readonly label?: string;
  readonly type: ContentFieldType;
  readonly required: boolean;
  readonly unique?: boolean;
  readonly localized?: boolean;
  readonly readOnly?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer?: boolean;
  readonly options?: readonly CollectionSelectOption[];
  readonly multiple?: boolean;
  readonly relationId?: string;
  readonly targetCollectionId?: string;
  readonly cardinality?: "one" | "many";
  readonly onDelete?: "restrict" | "nullify" | "cascade";
  readonly componentId?: string;
  readonly allowedComponentIds?: readonly string[];
  readonly acceptedMimeTypes?: readonly string[];
  readonly editor?: string;
  readonly fields?: readonly CollectionFieldDraft[];
  readonly defaultValue?: unknown;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface CollectionDraftInput {
  readonly name: string;
  readonly label?: string;
  readonly kind?: "collection" | "singleton";
  readonly hierarchy?: CollectionHierarchy;
  readonly auth?: CollectionAuth;
  readonly fields: readonly CollectionFieldDraft[];
}

export interface CollectionSummary {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly status: "draft" | "applied";
  readonly hasPendingChanges: boolean;
  readonly fieldCount: number;
  readonly revisionId: string | null;
}

export interface CollectionDetail extends Omit<CollectionSummary, "fieldCount"> {
  readonly kind?: "collection" | "singleton";
  readonly hierarchy?: CollectionHierarchy;
  readonly auth?: CollectionAuth;
  readonly fields: readonly CollectionField[];
  /** Opaque optimistic-concurrency token for the complete Schema draft. */
  readonly draftVersion: string;
}

export interface DocumentTreeNode {
  readonly document: DocumentRecord;
  readonly parentId: string | null;
  readonly position: number;
  readonly depth: number;
  readonly path: readonly string[];
  readonly hasChildren: boolean;
}

export interface DocumentTree {
  readonly items: readonly DocumentTreeNode[];
  readonly version: number;
}

export interface MoveDocumentEffectivePermissionChange {
  readonly subjectId: string;
  readonly resourceId: string;
  readonly permission: string;
  readonly beforeAllowed: boolean;
  readonly afterAllowed: boolean;
  readonly change: "granted" | "revoked";
}

export interface MoveDocumentEffectiveFieldAccessChange {
  readonly subjectId: string;
  readonly resourceId: string;
  readonly operation: "read" | "write";
  /** null means unrestricted; an empty array means no named fields are allowed. */
  readonly beforeFields: readonly string[] | null;
  readonly afterFields: readonly string[] | null;
  readonly change: "broadened" | "narrowed" | "changed";
}

export interface MoveDocumentPermissionImpact {
  readonly documentId: string;
  readonly documentResourceId: string;
  readonly beforeParentResourceId: string;
  readonly afterParentResourceId: string;
  readonly beforeDocumentPath: readonly string[];
  readonly afterDocumentPath: readonly string[];
  readonly beforeResourcePath: readonly string[];
  readonly afterResourcePath: readonly string[];
  readonly affectedDocumentIds: readonly string[];
  readonly affectedResourceIds: readonly string[];
  readonly requiresAuthorizationManagement?: boolean;
  readonly effectivePermissionChanges?: readonly MoveDocumentEffectivePermissionChange[];
  readonly effectiveFieldAccessChanges?: readonly MoveDocumentEffectiveFieldAccessChange[];
  readonly effectivePermissionChangesTruncated?: boolean;
}

export interface MoveDocumentPreview {
  readonly previousParentId: string | null;
  readonly previousPosition: number;
  readonly affectedDocumentIds: readonly string[];
  /** Policy revision used to calculate the preview; required again by move CAS. */
  readonly policyRevision: number;
  readonly permissionImpact: MoveDocumentPermissionImpact | null;
}

export interface MoveDocumentResult extends MoveDocumentPreview {
  readonly node: DocumentTreeNode;
  readonly version: number;
}

export interface MediaRecord {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly checksum: string;
  readonly storageKey: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly status: "available" | "missing";
  readonly contentUrl: string;
}

export interface MediaConsistencyReport {
  readonly missing: readonly MediaRecord[];
  readonly orphanStorageKeys: readonly string[];
  readonly incomplete: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly status: "pending" | "failed";
    readonly failureReason?: string;
  }[];
  readonly healthyCount: number;
}

export interface SchemaManifest {
  readonly schema: unknown;
  readonly serialized: string;
  readonly hash: string;
}

export interface GeneratedTypes {
  readonly fileName: string;
  readonly source: string;
  readonly hash: string;
}

export interface MigrationChange {
  readonly id: string;
  readonly kind: string;
  readonly path: readonly string[];
  readonly description: string;
  readonly severity: "safe" | "risky" | "destructive";
}

export interface MigrationOperation {
  readonly id: string;
  readonly description: string;
  readonly sql?: string;
}

export interface MigrationPreview {
  readonly planId: string;
  readonly collectionId: string;
  readonly draftVersion: string;
  readonly baseRevisionId: string | null;
  readonly changes: readonly MigrationChange[];
  readonly operations: readonly MigrationOperation[];
  readonly destructive: boolean;
}

export type DocumentData = Readonly<Record<string, unknown>>;

export type DocumentDisplayState =
  | "draft"
  | "published"
  | "published-with-draft"
  | "archived"
  | "deleted";

export interface DocumentPublication {
  readonly revisionId: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface DocumentDeletion {
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly reason?: string;
}

export interface DocumentRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly data: DocumentData;
  readonly version: number;
  readonly displayState: DocumentDisplayState;
  readonly draftRevisionId: string | null;
  readonly publication: DocumentPublication | null;
  readonly deletion: DocumentDeletion | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DocumentRevisionOrigin =
  | { readonly kind: "create" }
  | { readonly kind: "edit" }
  | { readonly kind: "restore"; readonly restoredFromRevisionId: string };

export interface DocumentRevisionSummary {
  readonly id: string;
  readonly sequence: number;
  readonly schemaRevisionId: string;
  readonly origin: DocumentRevisionOrigin;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly isCurrentDraft: boolean;
  readonly isPublished: boolean;
}

export interface DocumentRevisionDetail extends DocumentRevisionSummary {
  readonly data: DocumentData;
}

export interface DocumentRevisionList extends PageResult<DocumentRevisionSummary> {
  readonly documentVersion: number;
}

export type AuthorizationSubjectType = "user" | "group" | "service-account";
export type AuthorizationScopePropagation = "self" | "children" | "self-and-children";

export interface AuthorizationSubject {
  readonly id: string;
  readonly realmId: string;
  readonly type: AuthorizationSubjectType;
  readonly name: string;
  readonly protected: boolean;
  readonly disabled: boolean;
}

export interface AuthorizationGroupMembership {
  readonly memberSubjectId: string;
  readonly groupSubjectId: string;
}

export interface AuthorizationResource {
  readonly id: string;
  readonly realmId: string;
  readonly type: string;
  readonly name: string;
  readonly parentId?: string;
  readonly protected: boolean;
}

export interface AuthorizationLevel {
  readonly id: string;
  readonly realmId: string;
  readonly name: string;
  readonly rank: number;
  readonly protected: boolean;
}

export interface AuthorizationPermission {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly hierarchyGuard: "none" | "target-role" | "target-binding" | "target-subject";
  readonly delegatable: boolean;
  readonly protected: boolean;
}

export interface AuthorizationFieldAccess {
  readonly resourceId: string;
  readonly readableFields: readonly string[];
  readonly writableFields: readonly string[];
}

export interface AuthorizationRole {
  readonly id: string;
  readonly realmId: string;
  readonly levelId: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly delegatablePermissions: readonly string[];
  readonly fieldAccess: readonly AuthorizationFieldAccess[];
  readonly protected: boolean;
}

export interface AuthorizationBindingConstraints {
  readonly ownerSubjectId?: string;
  readonly statuses?: readonly string[];
}

export interface AuthorizationRoleBinding {
  readonly id: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly roleId: string;
  readonly resourceId: string;
  readonly propagation: AuthorizationScopePropagation;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: AuthorizationBindingConstraints;
  readonly protected: boolean;
}

export interface AuthorizationPolicy {
  readonly realmId: string;
  readonly revision: number;
  readonly subjects: readonly AuthorizationSubject[];
  readonly groupMemberships: readonly AuthorizationGroupMembership[];
  readonly resources: readonly AuthorizationResource[];
  readonly levels: readonly AuthorizationLevel[];
  readonly permissions: readonly AuthorizationPermission[];
  readonly roles: readonly AuthorizationRole[];
  readonly bindings: readonly AuthorizationRoleBinding[];
}

export interface AuthorizationMatchedGrant {
  readonly permission: string;
  readonly sourceRoleId: string;
  readonly sourceLevelId: string;
  readonly sourceRank: number;
  readonly sourceBindingId: string;
  readonly sourceResourceId: string;
  readonly sourcePropagation: AuthorizationScopePropagation;
  readonly membershipPath: readonly string[];
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly action: string;
  readonly reasonCode: string;
  readonly resourceId: string;
  readonly actorLevel?: number;
  readonly targetLevel?: number;
  readonly policyRevision: number;
  readonly matchedGrants: readonly AuthorizationMatchedGrant[];
}

export interface AuthorizationAuditEntry {
  readonly id: string;
  readonly realmId: string;
  readonly policyRevision: number;
  readonly actorSubjectId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly decision: AuthorizationDecision | null;
  readonly occurredAt: string;
}

export interface AuthorizationRoleInput {
  readonly name: string;
  readonly description?: string;
  readonly levelId: string;
  readonly permissions: readonly string[];
  readonly delegatablePermissions: readonly string[];
  readonly fieldAccess?: readonly AuthorizationFieldAccess[];
}

export interface AuthorizationBindingInput {
  readonly subjectId: string;
  readonly roleId: string;
  readonly resourceId: string;
  readonly propagation: AuthorizationScopePropagation;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: AuthorizationBindingConstraints;
}

export interface PageResult<TItem> {
  readonly items: readonly TItem[];
}

export interface PaginatedPageResult<TItem> extends PageResult<TItem> {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type EventDeliveryStatus = "pending" | "processing" | "succeeded" | "dead";

export interface EventDeliveryRecord {
  readonly id: string;
  readonly eventId: string;
  readonly topic: string;
  readonly handlerId: string;
  readonly status: EventDeliveryStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly lockedBy?: string;
  readonly lockedUntil?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly event: {
    readonly specVersion: "1.0";
    readonly id: string;
    readonly topic: string;
    readonly workspaceId: string;
    readonly realmId?: string;
    readonly aggregate: { readonly type: string; readonly id: string; readonly version?: number };
    readonly actor: { readonly subjectId?: string; readonly identityId?: string };
    readonly occurredAt: string;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

export interface EventDeliveryPage extends PaginatedPageResult<EventDeliveryRecord> {
  readonly counts: Readonly<Record<EventDeliveryStatus, number>>;
}

export interface EventWorkerCycleResult {
  readonly fannedOut: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly dead: number;
}

export interface AuthorizationAdminApi {
  getPolicy(): Promise<AuthorizationPolicy>;
  createSubject(input: {
    readonly expectedPolicyRevision: number;
    readonly type: AuthorizationSubjectType;
    readonly name: string;
  }): Promise<AuthorizationPolicy>;
  addGroupMembership(input: {
    readonly expectedPolicyRevision: number;
    readonly memberSubjectId: string;
    readonly groupSubjectId: string;
  }): Promise<AuthorizationPolicy>;
  removeGroupMembership(
    memberSubjectId: string,
    groupSubjectId: string,
    expectedPolicyRevision: number,
  ): Promise<AuthorizationPolicy>;
  createLevel(input: {
    readonly expectedPolicyRevision: number;
    readonly name: string;
    readonly rank: number;
  }): Promise<AuthorizationPolicy>;
  updateLevel(levelId: string, input: {
    readonly expectedPolicyRevision: number;
    readonly name: string;
    readonly rank: number;
  }): Promise<AuthorizationPolicy>;
  deleteLevel(levelId: string, expectedPolicyRevision: number): Promise<AuthorizationPolicy>;
  createRole(input: AuthorizationRoleInput & {
    readonly expectedPolicyRevision: number;
  }): Promise<AuthorizationPolicy>;
  updateRole(roleId: string, input: AuthorizationRoleInput & {
    readonly expectedPolicyRevision: number;
  }): Promise<AuthorizationPolicy>;
  deleteRole(roleId: string, expectedPolicyRevision: number): Promise<AuthorizationPolicy>;
  createBinding(input: AuthorizationBindingInput & {
    readonly expectedPolicyRevision: number;
  }): Promise<AuthorizationPolicy>;
  updateBinding(bindingId: string, input: AuthorizationBindingInput & {
    readonly expectedPolicyRevision: number;
  }): Promise<AuthorizationPolicy>;
  deleteBinding(bindingId: string, expectedPolicyRevision: number): Promise<AuthorizationPolicy>;
  simulate(input: {
    readonly subjectId: string;
    readonly action: string;
    readonly resourceId: string;
    readonly at?: string;
    readonly context?: { readonly ownerSubjectId?: string; readonly status?: string };
  }): Promise<AuthorizationDecision>;
  listAudit(): Promise<PageResult<AuthorizationAuditEntry>>;
}

export interface AdminApi {
  readonly auth: {
    getBootstrapStatus(): Promise<BootstrapStatus>;
    bootstrap(credentials: AuthCredentials): Promise<{ readonly user: AdminUser }>;
    getSession(): Promise<SessionResult>;
    login(credentials: AuthCredentials): Promise<{ readonly user: AdminUser }>;
    logout(): Promise<void>;
  };
  readonly jobs: {
    list(options?: {
      readonly page?: number;
      readonly pageSize?: number;
      readonly status?: EventDeliveryStatus;
      readonly topic?: string;
      readonly handlerId?: string;
    }): Promise<EventDeliveryPage>;
    get(deliveryId: string): Promise<EventDeliveryRecord>;
    retry(deliveryId: string): Promise<EventDeliveryRecord>;
    run(): Promise<EventWorkerCycleResult>;
  };
  readonly collections: {
    list(): Promise<PageResult<CollectionSummary>>;
    get(collectionId: string): Promise<CollectionDetail>;
    getApplied(collectionId: string): Promise<CollectionDetail>;
    create(input: CollectionDraftInput): Promise<CollectionDetail>;
    updateDraft(
      collectionId: string,
      input: { readonly draft: CollectionDraftInput; readonly expectedDraftVersion: string },
    ): Promise<CollectionDetail>;
    preview(
      collectionId: string,
      input: { readonly expectedDraftVersion: string },
    ): Promise<MigrationPreview>;
    apply(
      collectionId: string,
      input: {
        readonly planId: string;
        readonly expectedDraftVersion: string;
        readonly approveDestructive: boolean;
      },
    ): Promise<CollectionDetail>;
  };
  readonly documents: {
    list(
      collectionId: string,
      options?: {
        readonly page?: number;
        readonly pageSize?: number;
        readonly state?: "active" | "deleted";
      },
    ): Promise<PaginatedPageResult<DocumentRecord>>;
    get(collectionId: string, documentId: string): Promise<DocumentRecord>;
    create(collectionId: string, input: {
      readonly data: DocumentData;
      readonly parentId?: string | null;
      readonly position?: number;
    }): Promise<DocumentRecord>;
    update(
      collectionId: string,
      documentId: string,
      input: { readonly data: DocumentData; readonly expectedVersion: number },
    ): Promise<DocumentRecord>;
    delete(
      collectionId: string,
      documentId: string,
      input: { readonly expectedVersion: number },
    ): Promise<void>;
    publish(
      collectionId: string,
      documentId: string,
      input: { readonly expectedVersion: number },
    ): Promise<DocumentRecord>;
    unpublish(
      collectionId: string,
      documentId: string,
      input: { readonly expectedVersion: number },
    ): Promise<DocumentRecord>;
    restoreDeleted(
      collectionId: string,
      documentId: string,
      input: { readonly expectedVersion: number },
    ): Promise<DocumentRecord>;
    purge(
      collectionId: string,
      documentId: string,
      input: { readonly expectedVersion: number },
    ): Promise<void>;
    tree(collectionId: string, parentId?: string | null): Promise<DocumentTree>;
    previewMove(
      collectionId: string,
      documentId: string,
      input: { readonly newParentId: string | null; readonly position: number; readonly expectedVersion: number },
    ): Promise<MoveDocumentPreview>;
    move(
      collectionId: string,
      documentId: string,
      input: {
        readonly newParentId: string | null;
        readonly position: number;
        readonly expectedVersion: number;
        readonly expectedPolicyRevision: number;
      },
    ): Promise<MoveDocumentResult>;
  };
  readonly schemaArtifacts: {
    exportManifest(): Promise<SchemaManifest>;
    importManifest(input: { readonly schema: unknown }): Promise<void>;
    generateTypes(): Promise<GeneratedTypes>;
  };
  readonly media: {
    list(): Promise<PageResult<MediaRecord>>;
    upload(file: File): Promise<MediaRecord>;
    delete(mediaId: string): Promise<void>;
    checkConsistency(): Promise<MediaConsistencyReport>;
  };
  readonly revisions: {
    list(
      collectionId: string,
      documentId: string,
    ): Promise<DocumentRevisionList>;
    get(
      collectionId: string,
      documentId: string,
      revisionId: string,
    ): Promise<DocumentRevisionDetail>;
    restore(
      collectionId: string,
      documentId: string,
      revisionId: string,
      input: { readonly expectedVersion: number },
    ): Promise<DocumentRecord>;
  };
  readonly identityRealms: {
    listGlobalIdentities(): Promise<PageResult<GlobalIdentity>>;
    list(): Promise<PageResult<IdentityRealm>>;
    get(realmId: string): Promise<IdentityRealm>;
    create(input: CreateIdentityRealmInput): Promise<IdentityRealm>;
    update(realmId: string, input: UpdateIdentityRealmInput): Promise<IdentityRealm>;
    listMemberships(realmId: string): Promise<PageResult<RealmMembership>>;
    provisionMembership(
      realmId: string,
      input: ProvisionRealmMembershipInput,
    ): Promise<RealmMembership>;
    suspendMembership(
      realmId: string,
      membershipId: string,
      expectedRevision: number,
    ): Promise<RealmMembership>;
    reactivateMembership(
      realmId: string,
      membershipId: string,
      expectedRevision: number,
    ): Promise<RealmMembership>;
    listFullAccess(realmId: string): Promise<PageResult<RealmFullAccessBinding>>;
    grantFullAccess(
      realmId: string,
      input: GrantRealmFullAccessInput,
    ): Promise<RealmFullAccessBinding>;
    revokeFullAccess(
      realmId: string,
      bindingId: string,
      password: string,
    ): Promise<RealmFullAccessBinding>;
    authorizationFor(realmId: string): AuthorizationAdminApi;
  };
  readonly authorization: AuthorizationAdminApi;
}

export interface AdminApiErrorOptions {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly details?: unknown;
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly details: unknown;

  constructor(options: AdminApiErrorOptions) {
    super(options.message);
    this.name = "AdminApiError";
    this.status = options.status;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors ?? {};
    this.details = options.details;
  }
}

export function toAdminApiError(error: unknown): AdminApiError {
  if (error instanceof AdminApiError) return error;
  if (error instanceof Error) {
    return new AdminApiError({ status: 0, code: "NETWORK_ERROR", message: error.message });
  }
  return new AdminApiError({
    status: 0,
    code: "UNKNOWN_ERROR",
    message: "알 수 없는 오류가 발생했습니다.",
  });
}
