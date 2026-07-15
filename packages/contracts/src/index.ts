import type { SchemaChange, SchemaIrV1 } from "@xecms/schema";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ApiIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** RFC 9457-shaped error body with stable XeCMS machine-readable fields. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly requestId: string;
  readonly issues?: readonly ApiIssue[];
  readonly details?: unknown;
}

export interface HealthResponse {
  readonly status: "ok";
  readonly database: "connected";
  readonly version: string;
}

export interface UserDto {
  readonly id: string;
  readonly username: string;
}

export interface WorkspaceDto {
  readonly id: string;
  readonly name: string;
}

export type AdminCapability =
  | "schema:read"
  | "schema:write"
  | "schema:apply"
  | "document:read"
  | "document:create"
  | "document:update"
  | "document:delete"
  | "document:publish"
  | "document:purge";

export interface SchemaRevisionSummaryDto {
  readonly revisionId: string | null;
}

export interface SessionDto {
  readonly user: UserDto | null;
  readonly csrfToken?: string;
  readonly workspace?: WorkspaceDto;
  readonly capabilities?: readonly AdminCapability[];
  readonly schema?: SchemaRevisionSummaryDto;
  readonly expiresAt?: string;
}

export interface AuthenticatedSessionDto extends SessionDto {
  readonly user: UserDto;
  readonly csrfToken: string;
  readonly workspace: WorkspaceDto;
  readonly capabilities: readonly AdminCapability[];
  readonly schema: SchemaRevisionSummaryDto;
}

export interface BootstrapStatusDto {
  readonly required: boolean;
  readonly developmentSeeded?: boolean;
}

export interface BootstrapRequest {
  readonly username: string;
  readonly password: string;
}

export type LoginRequest = BootstrapRequest;

export interface SchemaRevisionEnvelopeDto {
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly schema: SchemaIrV1;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface SchemaDraftEnvelopeDto {
  readonly baseRevisionId: string | null;
  readonly draftVersion: string;
  readonly schema: SchemaIrV1;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface SaveSchemaDraftRequest {
  readonly baseRevisionId: string | null;
  /** Null creates a draft; otherwise the currently observed opaque token. */
  readonly expectedDraftVersion: string | null;
  readonly schema: SchemaIrV1;
}

export type IssuableSchemaObjectKind = "collection" | "field" | "relation" | "component";

export interface IssueSchemaIdsRequest {
  readonly kind: IssuableSchemaObjectKind;
  readonly count: number;
}

export interface IssueSchemaIdsResponse {
  readonly ids: readonly string[];
}

export type MigrationOperationKind =
  | "create-table"
  | "drop-table"
  | "rename-table"
  | "add-column"
  | "drop-column"
  | "rename-column"
  | "alter-column"
  | "drop-hierarchy"
  | "configure-collection-auth";

export interface MigrationOperationDto {
  readonly id: string;
  readonly kind: MigrationOperationKind;
  readonly summary: string;
  readonly severity: "safe" | "risky" | "destructive";
  readonly sql?: string;
}

export interface SchemaPreviewDto {
  readonly planId: string;
  readonly baseRevisionId: string | null;
  readonly draftVersion: string;
  readonly schema: SchemaIrV1;
  readonly changes: readonly SchemaChange[];
  readonly operations: readonly MigrationOperationDto[];
  readonly requiresDestructiveApproval: boolean;
}

export interface PreviewSchemaRequest {
  readonly expectedDraftVersion: string;
}

export interface ApplySchemaRequest {
  readonly planId: string;
  readonly expectedRevisionId: string | null;
  readonly expectedDraftVersion: string;
  readonly approveDestructive: boolean;
}

export interface SchemaManifestDto {
  readonly schema: SchemaIrV1;
  readonly serialized: string;
  readonly hash: string;
}

export interface ImportSchemaManifestRequest {
  readonly baseRevisionId: string | null;
  readonly expectedDraftVersion: string | null;
  readonly schema: SchemaIrV1;
}

export interface GeneratedTypesDto {
  readonly fileName: string;
  readonly source: string;
  readonly hash: string;
}

export type ContentFieldType = SchemaIrV1["collections"][number]["fields"][number]["type"];
/** @deprecated Use ContentFieldType. */
export type M1FieldType = ContentFieldType;

export interface FieldSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly type: ContentFieldType;
  readonly required: boolean;
}

export interface CollectionSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly fields: readonly FieldSummaryDto[];
  readonly status: "draft" | "applied";
  /** True when an applied collection has unapplied changes in the global Schema draft. */
  readonly hasPendingChanges: boolean;
  readonly revisionId: string | null;
}

export interface CollectionListDto {
  readonly items: readonly CollectionSummaryDto[];
}

export interface DocumentRecordDto {
  readonly id: string;
  readonly collectionId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly displayState: DocumentDisplayStateDto;
  readonly draftRevisionId: string | null;
  readonly publication: DocumentPublicationDto | null;
  readonly deletion: DocumentDeletionDto | null;
}

export interface DocumentTreeNodeDto {
  readonly document: DocumentRecordDto;
  readonly parentId: string | null;
  readonly position: number;
  readonly depth: number;
  readonly path: readonly string[];
  readonly hasChildren: boolean;
}

export interface DocumentTreeDto {
  /** Optimistic version of the collection tree, independent from document versions. */
  readonly version: number;
  readonly items: readonly DocumentTreeNodeDto[];
}

export interface MoveDocumentPreviewRequest {
  readonly newParentId: string | null;
  readonly position: number;
  readonly expectedVersion: number;
}

export interface MoveDocumentRequest extends MoveDocumentPreviewRequest {
  /** Required CAS token returned by the immediately preceding move preview. */
  readonly expectedPolicyRevision: number;
}

export interface MoveDocumentEffectivePermissionChangeDto {
  readonly subjectId: string;
  readonly resourceId: string;
  readonly permission: string;
  readonly beforeAllowed: boolean;
  readonly afterAllowed: boolean;
  readonly change: "granted" | "revoked";
}

export interface MoveDocumentEffectiveFieldAccessChangeDto {
  readonly subjectId: string;
  readonly resourceId: string;
  readonly operation: "read" | "write";
  readonly beforeFields: readonly string[] | null;
  readonly afterFields: readonly string[] | null;
  readonly change: "broadened" | "narrowed" | "changed";
}

export interface MoveDocumentPermissionImpactDto {
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
  readonly effectivePermissionChanges?: readonly MoveDocumentEffectivePermissionChangeDto[];
  readonly effectiveFieldAccessChanges?: readonly MoveDocumentEffectiveFieldAccessChangeDto[];
  readonly effectivePermissionChangesTruncated?: boolean;
}

export interface MoveDocumentPreviewDto {
  readonly previousParentId: string | null;
  readonly previousPosition: number;
  readonly affectedDocumentIds: readonly string[];
  readonly policyRevision: number;
  readonly permissionImpact: MoveDocumentPermissionImpactDto | null;
}

export interface MoveDocumentResultDto extends MoveDocumentPreviewDto {
  readonly version: number;
  readonly node: DocumentTreeNodeDto;
}

export type DocumentDisplayStateDto =
  | "draft"
  | "published"
  | "published-with-draft"
  | "archived"
  | "deleted";

export interface DocumentPublicationDto {
  readonly revisionId: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface DocumentDeletionDto {
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly reason?: string;
}

export interface DocumentListDto {
  readonly items: readonly DocumentRecordDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type DocumentListState = "active" | "deleted";

export type DocumentRevisionOriginDto =
  | { readonly kind: "create" | "edit" }
  | { readonly kind: "restore"; readonly restoredFromRevisionId: string };

export interface DocumentRevisionSummaryDto {
  readonly id: string;
  readonly sequence: number;
  readonly schemaRevisionId: string;
  readonly origin: DocumentRevisionOriginDto;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly isCurrentDraft: boolean;
  readonly isPublished: boolean;
}

export interface DocumentRevisionDetailDto extends DocumentRevisionSummaryDto {
  readonly data: Readonly<Record<string, unknown>>;
}

export interface DocumentRevisionListDto {
  readonly items: readonly DocumentRevisionSummaryDto[];
  readonly documentVersion: number;
}

export interface PublishedDocumentRecordDto {
  readonly id: string;
  readonly collectionId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly revisionId: string;
  readonly schemaRevisionId: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublishedDocumentListDto {
  readonly items: readonly PublishedDocumentRecordDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface CreateDocumentRequest {
  readonly data: Readonly<Record<string, unknown>>;
  readonly hierarchy?: {
    readonly parentId: string | null;
    readonly position: number;
    readonly expectedVersion: number;
  };
}

export interface UpdateDocumentRequest extends CreateDocumentRequest {
  readonly expectedVersion: number;
}

export interface DeleteDocumentRequest {
  readonly expectedVersion: number;
}

export type PublishDocumentRequest = DeleteDocumentRequest;
export type UnpublishDocumentRequest = DeleteDocumentRequest;
export type RestoreDocumentRequest = DeleteDocumentRequest;
export type RestoreRevisionRequest = DeleteDocumentRequest;
export type PurgeDocumentRequest = DeleteDocumentRequest;

export interface MediaRecordDto {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly checksum: string;
  readonly storageKey: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly status: "available" | "missing";
}

export interface MediaListDto {
  readonly items: readonly MediaRecordDto[];
}

export interface IncompleteMediaRecordDto {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly status: "pending" | "failed";
  readonly failureReason?: string;
}

export interface MediaConsistencyReportDto {
  readonly missing: readonly MediaRecordDto[];
  readonly orphanStorageKeys: readonly string[];
  readonly incomplete: readonly IncompleteMediaRecordDto[];
  readonly healthyCount: number;
}

export type AuthorizationSubjectTypeDto = "user" | "group" | "service-account";
export type AuthorizationScopePropagationDto = "self" | "children" | "self-and-children";

export interface AuthorizationSubjectDto {
  readonly id: string;
  readonly realmId: string;
  readonly type: AuthorizationSubjectTypeDto;
  readonly name: string;
  readonly protected: boolean;
  readonly disabled: boolean;
}

export interface AuthorizationGroupMembershipDto {
  readonly memberSubjectId: string;
  readonly groupSubjectId: string;
}

export interface AuthorizationResourceDto {
  readonly id: string;
  readonly realmId: string;
  readonly type: string;
  readonly name: string;
  readonly parentId?: string;
  readonly protected: boolean;
}

export interface AuthorizationLevelDto {
  readonly id: string;
  readonly realmId: string;
  readonly name: string;
  readonly rank: number;
  readonly protected: boolean;
}

export interface AuthorizationPermissionDto {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly hierarchyGuard: "none" | "target-role" | "target-binding" | "target-subject";
  readonly delegatable: boolean;
  readonly protected: boolean;
}

export interface AuthorizationFieldAccessDto {
  readonly resourceId: string;
  readonly readableFields: readonly string[];
  readonly writableFields: readonly string[];
}

export interface AuthorizationRoleDto {
  readonly id: string;
  readonly realmId: string;
  readonly levelId: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly delegatablePermissions: readonly string[];
  readonly fieldAccess: readonly AuthorizationFieldAccessDto[];
  readonly protected: boolean;
}

export interface AuthorizationBindingConstraintsDto {
  readonly ownerSubjectId?: string;
  readonly statuses?: readonly string[];
}

export interface AuthorizationRoleBindingDto {
  readonly id: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly roleId: string;
  readonly resourceId: string;
  readonly propagation: AuthorizationScopePropagationDto;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: AuthorizationBindingConstraintsDto;
  readonly protected: boolean;
}

export interface AuthorizationPolicyDto {
  readonly realmId: string;
  readonly revision: number;
  readonly subjects: readonly AuthorizationSubjectDto[];
  readonly groupMemberships: readonly AuthorizationGroupMembershipDto[];
  readonly resources: readonly AuthorizationResourceDto[];
  readonly levels: readonly AuthorizationLevelDto[];
  readonly permissions: readonly AuthorizationPermissionDto[];
  readonly roles: readonly AuthorizationRoleDto[];
  readonly bindings: readonly AuthorizationRoleBindingDto[];
}

export interface AuthorizationMatchedGrantDto {
  readonly permission: string;
  readonly sourceRoleId: string;
  readonly sourceLevelId: string;
  readonly sourceRank: number;
  readonly sourceBindingId: string;
  readonly sourceResourceId: string;
  readonly sourcePropagation: AuthorizationScopePropagationDto;
  readonly membershipPath: readonly string[];
}

export interface AuthorizationDecisionDto {
  readonly allowed: boolean;
  readonly action: string;
  readonly reasonCode: string;
  readonly resourceId: string;
  readonly actorLevel?: number;
  readonly targetLevel?: number;
  readonly policyRevision: number;
  readonly matchedGrants: readonly AuthorizationMatchedGrantDto[];
}

export interface AuthorizationAuditEntryDto {
  readonly id: string;
  readonly realmId: string;
  readonly policyRevision: number;
  readonly actorSubjectId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
  /** Policy initialization has no pre-existing policy with which to authorize itself. */
  readonly decision: AuthorizationDecisionDto | null;
  readonly occurredAt: string;
}

export interface AuthorizationAuditListDto {
  readonly items: readonly AuthorizationAuditEntryDto[];
}

export interface CreateAuthorizationSubjectRequest {
  readonly expectedPolicyRevision: number;
  readonly type: AuthorizationSubjectTypeDto;
  readonly name: string;
}

export interface CreateAuthorizationGroupMembershipRequest {
  readonly expectedPolicyRevision: number;
  readonly memberSubjectId: string;
  readonly groupSubjectId: string;
}

export interface CreateAuthorizationLevelRequest {
  readonly expectedPolicyRevision: number;
  readonly name: string;
  readonly rank: number;
}

export interface UpdateAuthorizationLevelRequest extends CreateAuthorizationLevelRequest {}

export interface AuthorizationRoleInput {
  readonly name: string;
  readonly description?: string;
  readonly levelId: string;
  readonly permissions: readonly string[];
  readonly delegatablePermissions: readonly string[];
  readonly fieldAccess?: readonly AuthorizationFieldAccessDto[];
}

export interface CreateAuthorizationRoleRequest extends AuthorizationRoleInput {
  readonly expectedPolicyRevision: number;
}

export interface UpdateAuthorizationRoleRequest extends AuthorizationRoleInput {
  readonly expectedPolicyRevision: number;
}

export interface CreateAuthorizationBindingRequest {
  readonly expectedPolicyRevision: number;
  readonly subjectId: string;
  readonly roleId: string;
  readonly resourceId: string;
  readonly propagation: AuthorizationScopePropagationDto;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: AuthorizationBindingConstraintsDto;
}

export interface UpdateAuthorizationBindingRequest extends CreateAuthorizationBindingRequest {}

export interface DeleteAuthorizationObjectRequest {
  readonly expectedPolicyRevision: number;
}

export interface SimulateAuthorizationRequest {
  readonly subjectId: string;
  readonly action: string;
  readonly resourceId: string;
  readonly at?: string;
  readonly context?: {
    readonly ownerSubjectId?: string;
    readonly status?: string;
  };
}

export type IdentityRealmKindDto = "system" | "content";
export type IdentityRealmStatusDto = "provisioning" | "active" | "disabled";
export type RealmProvisioningModeDto = "explicit" | "jit";
export type RealmRegistrationModeDto = "closed" | "open";
export type RealmMembershipStatusDto = "pending" | "active" | "suspended";
export type RealmMembershipProvisionedByDto =
  | "explicit"
  | "invitation"
  | "jit"
  | "account-link"
  | "signup";

export interface RealmAuthenticationPolicyDto {
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: RealmProvisioningModeDto;
  readonly registration: RealmRegistrationModeDto;
  readonly defaultRoleIds: readonly string[];
}

/** Public-safe Global Identity information used by Realm administration. */
export interface GlobalIdentityDto {
  readonly globalIdentityId: string;
  readonly primaryIdentifier: string;
  readonly originRealmId: string;
  readonly credentialVersion: number;
  readonly disabledAt?: string;
}

export interface GlobalIdentityListDto {
  readonly items: readonly GlobalIdentityDto[];
}

export interface IdentityRealmDto {
  readonly realmId: string;
  readonly realmKey: string;
  readonly name: string;
  readonly kind: IdentityRealmKindDto;
  readonly status: IdentityRealmStatusDto;
  readonly profileCollectionId?: string;
  readonly authentication: RealmAuthenticationPolicyDto;
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface IdentityRealmListDto {
  readonly items: readonly IdentityRealmDto[];
}

export interface RealmMembershipDto {
  readonly membershipId: string;
  readonly globalIdentityId: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly profileCollectionId?: string;
  readonly profileDocumentId?: string;
  readonly status: RealmMembershipStatusDto;
  readonly provisionedBy: RealmMembershipProvisionedByDto;
  readonly revision: number;
  readonly createdAt: string;
  readonly activatedAt?: string;
  readonly suspendedAt?: string;
  readonly identity?: GlobalIdentityDto;
}

export interface RealmMembershipListDto {
  readonly items: readonly RealmMembershipDto[];
}

export interface RealmFullAccessBindingDto {
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

export interface RealmFullAccessListDto {
  readonly items: readonly RealmFullAccessBindingDto[];
}

export interface CreateIdentityRealmRequest {
  readonly key: string;
  readonly name: string;
  readonly acceptSystemIdentities?: boolean;
  readonly provisioning?: RealmProvisioningModeDto;
  readonly registration?: RealmRegistrationModeDto;
  readonly defaultRoleIds?: readonly string[];
}

export interface UpdateIdentityRealmRequest {
  readonly expectedRevision: number;
  readonly name: string;
  readonly status: Exclude<IdentityRealmStatusDto, "provisioning">;
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: RealmProvisioningModeDto;
  readonly registration: RealmRegistrationModeDto;
  readonly defaultRoleIds: readonly string[];
}

export interface UpdateRealmMembershipRequest {
  readonly expectedRevision: number;
  readonly status: Extract<RealmMembershipStatusDto, "active" | "suspended">;
}

export interface RealmMembershipRevisionRequest {
  readonly expectedRevision: number;
}

export interface ProvisionRealmMembershipRequest {
  readonly globalIdentityId: string;
  readonly profile: Readonly<Record<string, unknown>>;
  /** Current System account password used for this protected account-link operation. */
  readonly password: string;
}

export interface GrantRealmFullAccessRequest {
  readonly subjectId: string;
  readonly reason: string;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
  readonly validUntil?: string;
}

export interface RevokeRealmFullAccessRequest {
  /** Current System account password; never persisted or returned. */
  readonly password: string;
}

/** Public metadata required to render a Realm login or signup surface. */
export interface ContentRealmMetadataDto {
  readonly realmId: string;
  readonly realmKey: string;
  readonly name: string;
  readonly profileCollectionId: string;
  readonly identifierFieldIds: readonly string[];
  readonly acceptSystemIdentities: boolean;
  readonly provisioning: RealmProvisioningModeDto;
  readonly registration: RealmRegistrationModeDto;
  readonly revision: number;
}

export interface ContentRealmSignupRequest {
  readonly identifier: string;
  readonly password: string;
  readonly profile: Readonly<Record<string, unknown>>;
}

export interface ContentRealmLoginRequest {
  readonly identifier: string;
  readonly password: string;
  readonly jitProfile?: Readonly<Record<string, unknown>>;
}

/**
 * A Content Realm session deliberately carries its own CSRF token. It must
 * never be treated as the System Admin session token.
 */
export interface ContentAuthenticatedSessionDto {
  readonly authenticated: true;
  readonly globalIdentityId: string;
  readonly realmId: string;
  readonly realmKey: string;
  readonly membershipId: string;
  readonly subjectId: string;
  readonly profileDocumentId?: string;
  readonly realmRevision: number;
  readonly membershipRevision: number;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface ContentAnonymousSessionDto {
  readonly authenticated: false;
  readonly realmId: string;
  readonly realmKey: string;
  readonly realmRevision: number;
}

export type ContentSessionDto = ContentAuthenticatedSessionDto | ContentAnonymousSessionDto;

export interface ContentRealmProfileDto {
  readonly realmId: string;
  readonly realmKey: string;
  readonly membershipId: string;
  readonly subjectId: string;
  readonly profileDocumentId: string;
  readonly data: Readonly<Record<string, unknown>>;
  /** Profile Document revision used for optimistic concurrency. */
  readonly revision: number;
}

export interface UpdateContentRealmProfileRequest {
  readonly expectedRevision: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export type EventDeliveryStatusDto = "pending" | "processing" | "succeeded" | "dead";

export interface DurableEventDto {
  readonly specVersion: "1.0";
  readonly id: string;
  readonly topic: string;
  readonly workspaceId: string;
  readonly realmId?: string;
  readonly aggregate: {
    readonly type: "document" | "identity" | "realm" | "authorization" | "media";
    readonly id: string;
    readonly version?: number;
  };
  readonly actor: { readonly subjectId?: string; readonly identityId?: string };
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventDeliveryDto {
  readonly id: string;
  readonly eventId: string;
  readonly topic: string;
  readonly handlerId: string;
  readonly status: EventDeliveryStatusDto;
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
  readonly event: DurableEventDto;
}

export interface EventDeliveryListDto {
  readonly items: readonly EventDeliveryDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly counts: Readonly<Record<EventDeliveryStatusDto, number>>;
}

export interface EventWorkerCycleDto {
  readonly fannedOut: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly dead: number;
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate["type"] === "string" &&
    typeof candidate["title"] === "string" &&
    typeof candidate["status"] === "number" &&
    typeof candidate["detail"] === "string" &&
    typeof candidate["code"] === "string" &&
    typeof candidate["requestId"] === "string"
  );
}
