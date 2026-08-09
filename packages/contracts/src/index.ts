import type { SchemaChange, SchemaIrV1 } from "@xecms/schema";
import type { AdminAppManifest, AdminAppManifestDiff } from "@xecms/admin-apps";

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

export interface SystemDiagnosticsDto {
  readonly environment: "development" | "test" | "production";
  readonly xecmsVersion: string;
  readonly nodeVersion: string;
  readonly postgresVersion: string;
  readonly schemaMode: "editable" | "locked" | "manifest-only";
  readonly workerEnabled: boolean;
  readonly uploadLimitBytes: number;
  readonly allowedMimeTypes: readonly string[];
  readonly adminOriginCount: number;
  readonly contentOriginCount: number;
  readonly storageAdapter: "local";
}

export interface WorkspaceSettingsDto {
  readonly workspaceId: string; readonly displayName: string; readonly defaultTimezone: string;
  readonly adminLocale: string; readonly revision: number; readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface UpdateWorkspaceSettingsRequest {
  readonly expectedRevision: number; readonly displayName: string; readonly defaultTimezone: string;
  readonly adminLocale: string; readonly currentPassword: string;
}

export interface SiteDto {
  readonly siteId:string; readonly workspaceId:string; readonly key:string; readonly name:string;
  readonly canonicalUrl?:string; readonly status:"active"|"archived"; readonly isDefault:boolean;
  readonly revision:number; readonly createdAt:string; readonly createdBy:string;
  readonly updatedAt:string; readonly updatedBy:string; readonly archivedAt?:string;
  readonly collectionIds:readonly string[];
}
export interface SiteListDto { readonly items:readonly SiteDto[]; }
export interface CreateSiteRequest { readonly key:string; readonly name:string; readonly canonicalUrl?:string; }
export interface UpdateSiteRequest { readonly expectedRevision:number; readonly name:string; readonly canonicalUrl?:string; }
export interface SiteStatusRequest { readonly expectedRevision:number; readonly currentPassword:string; readonly replacementDefaultSiteId?:string; }
export interface SetDefaultSiteRequest { readonly expectedRevision:number; readonly currentPassword:string; }
export interface SiteCollectionBindingRequest { readonly expectedSiteRevision:number; readonly expectedPolicyRevision:number; readonly currentPassword:string; }

export type UnifiedAuditSourceDto = "system" | "document" | "authorization" | "delivery";
export type UnifiedAuditCategoryDto = "security" | "identity" | "content" | "schema"
  | "authorization" | "settings" | "site" | "worker" | "media" | "retention" | "plugin";
export type UnifiedAuditOutcomeDto = "succeeded" | "failed" | "denied" | "informational";
export interface UnifiedAuditEntryDto {
  readonly id:string; readonly source:UnifiedAuditSourceDto; readonly sourceId:string;
  readonly category:UnifiedAuditCategoryDto; readonly action:string; readonly outcome:UnifiedAuditOutcomeDto;
  readonly workspaceId:string; readonly realmId?:string; readonly siteId?:string;
  readonly actorIdentityId?:string; readonly actorSubjectId?:string; readonly actorLabel?:string;
  readonly targetType:string; readonly targetId?:string; readonly summary:string;
  readonly before?:unknown; readonly after?:unknown; readonly metadata?:Readonly<Record<string,unknown>>;
  readonly requestId?:string; readonly occurredAt:string;
}
export interface UnifiedAuditListDto { readonly items:readonly UnifiedAuditEntryDto[]; readonly nextCursor?:string; }
export interface UnifiedAuditQueryDto {
  readonly category?:UnifiedAuditCategoryDto; readonly source?:UnifiedAuditSourceDto;
  readonly action?:string; readonly actorId?:string; readonly targetId?:string;
  readonly realmId?:string; readonly siteId?:string; readonly outcome?:UnifiedAuditOutcomeDto;
  readonly from?:string; readonly to?:string; readonly cursor?:string; readonly limit?:number;
}
export interface RetentionPolicyDto {
  readonly workspaceId:string; readonly auditDays:number|null; readonly dispatchedOutboxDays:number|null;
  readonly succeededDeliveryDays:number|null; readonly deadDeliveryDays:number|null;
  readonly expiredSessionDays:number|null; readonly softDeletedDocumentDays:number|null;
  readonly revision:number; readonly updatedAt:string; readonly updatedBy:string;
}
export interface UpdateRetentionPolicyRequest {
  readonly expectedRevision:number; readonly auditDays:number|null; readonly dispatchedOutboxDays:number|null;
  readonly succeededDeliveryDays:number|null; readonly deadDeliveryDays:number|null;
  readonly expiredSessionDays:number|null; readonly softDeletedDocumentDays:number|null;
  readonly currentPassword:string;
}
export interface RetentionCountsDto {
  readonly systemAudit:number; readonly documentAudit:number; readonly authorizationAudit:number;
  readonly dispatchedOutbox:number; readonly succeededDeliveries:number; readonly deadDeliveries:number;
  readonly expiredSessions:number; readonly softDeletedDocuments:number;
}
export interface RetentionCutoffsDto {
  readonly audit:string|null; readonly dispatchedOutbox:string|null;
  readonly succeededDelivery:string|null; readonly deadDelivery:string|null;
  readonly expiredSession:string|null; readonly softDeletedDocument:string|null;
}
export interface RetentionPlanDto {
  readonly id:string; readonly workspaceId:string; readonly policyRevision:number;
  readonly status:"previewed"|"applied"|"expired"; readonly referenceAt:string;
  readonly cutoffs:RetentionCutoffsDto; readonly counts:RetentionCountsDto;
  readonly estimatedBytes:Readonly<Record<string,number>>; readonly digest:string;
  readonly createdAt:string; readonly createdBy:string; readonly expiresAt:string;
  readonly appliedAt?:string; readonly appliedBy?:string; readonly results?:RetentionCountsDto;
}
export interface PreviewRetentionRequest { readonly expectedPolicyRevision:number; }
export interface ApplyRetentionRequest { readonly expectedPolicyRevision:number; readonly currentPassword:string; }

export type PluginDesiredStateDto="installed"|"enabled"|"disabled";
export type PluginPlanActionDto="install"|"enable"|"disable"|"uninstall";
export type PluginDataActionDto="preserve"|"export"|"purge";
export interface PluginRecordDto{readonly workspaceId:string;readonly pluginId:string;readonly packageName:string;readonly version:string;readonly manifest:Readonly<Record<string,unknown>>;readonly manifestDigest:string;readonly desiredState:PluginDesiredStateDto;readonly config:Readonly<Record<string,unknown>>;readonly revision:number;readonly restartRequired:boolean;readonly installedAt:string;readonly installedBy:string;readonly updatedAt:string;readonly updatedBy:string}
export interface PluginCatalogRecordDto{readonly pluginId:string;readonly packageName:string;readonly version:string;readonly displayName:string;readonly description?:string;readonly manifest:Readonly<Record<string,unknown>>;readonly manifestDigest:string;readonly installed:PluginRecordDto|null;readonly runtimeLoaded:boolean;readonly restartRequired:boolean}
export interface PluginCatalogListDto{readonly items:readonly PluginCatalogRecordDto[]}
export interface PluginListDto{readonly items:readonly PluginRecordDto[]}
export interface PluginBlockerDto{readonly code:string;readonly message:string;readonly details?:Readonly<Record<string,unknown>>}
export interface PluginPlanDto{readonly id:string;readonly workspaceId:string;readonly pluginId:string;readonly action:PluginPlanActionDto;readonly dataAction?:PluginDataActionDto;readonly expectedPluginRevision:number|null;readonly manifestDigest:string;readonly status:"previewed"|"applied";readonly blockers:readonly PluginBlockerDto[];readonly dependencyIds:readonly string[];readonly schemaReferences:readonly string[];readonly dataCounts:Readonly<Record<string,number>>;readonly migrationIds:readonly string[];readonly digest:string;readonly createdAt:string;readonly createdBy:string;readonly expiresAt:string;readonly appliedAt?:string;readonly appliedBy?:string;readonly result?:PluginRecordDto|null;readonly exportId?:string}
export interface PreviewPluginPlanRequest{readonly pluginId:string;readonly action:PluginPlanActionDto;readonly dataAction?:PluginDataActionDto;readonly expectedPluginRevision:number|null}
export interface ApplyPluginPlanRequest{readonly pluginId:string;readonly expectedPluginRevision:number|null;readonly currentPassword:string}
export interface UpdatePluginConfigRequest{readonly expectedRevision:number;readonly config:Readonly<Record<string,unknown>>;readonly currentPassword:string}
export interface PluginExportDto{readonly id:string;readonly pluginId:string;readonly createdAt:string;readonly data:unknown}
export interface AdminPluginCardDto{readonly pluginId:string;readonly pluginName:string;readonly id:string;readonly slot:"dashboard.main"|"operations.overview"|"settings.after";readonly title:string;readonly description:string;readonly status?:string;readonly link?:{readonly label:string;readonly href:string}}
export interface AdminPluginExtensionListDto{readonly cards:readonly AdminPluginCardDto[]}

export interface AdminAppDto {
  readonly id:string; readonly workspaceId:string; readonly manifestId:string;
  readonly key:string; readonly name:string;
  readonly audience:{readonly type:"system"}|{readonly type:"content-realm";readonly realmId:string};
  readonly status:"active"|"archived"; readonly activeRevisionId:string|null;
  readonly routeVersion:number; readonly createdAt:string;
  readonly createdByIdentityId:string; readonly createdBySubjectId:string;
  readonly updatedAt:string; readonly updatedByIdentityId:string; readonly updatedBySubjectId:string;
  readonly archivedAt?:string; readonly archivedByIdentityId?:string;
  readonly archivedBySubjectId?:string;
}
export interface AdminAppDraftDto {
  readonly appId:string; readonly workspaceId:string; readonly baseRevisionId:string|null;
  readonly draftVersion:number; readonly desiredKey:string; readonly manifest:AdminAppManifest;
  readonly manifestHash:string; readonly createdAt:string; readonly createdByIdentityId:string;
  readonly createdBySubjectId:string; readonly updatedAt:string;
  readonly updatedByIdentityId:string; readonly updatedBySubjectId:string;
}
export interface AdminAppDependencyDto {
  readonly kind:string; readonly id:string; readonly fingerprint?:string;
  readonly metadata?:Readonly<Record<string,unknown>>;
}
export interface AdminAppRevisionDto {
  readonly id:string; readonly appId:string; readonly workspaceId:string; readonly sequence:number;
  readonly parentRevisionId:string|null; readonly manifest:AdminAppManifest;
  readonly manifestHash:string; readonly dependencies:readonly AdminAppDependencyDto[];
  readonly createdAt:string; readonly createdByIdentityId:string; readonly createdBySubjectId:string;
}
export interface AdminAppListDto { readonly items:readonly AdminAppDto[]; }
export interface AdminAppRevisionListDto { readonly items:readonly AdminAppRevisionDto[]; }
export interface AdminAppDraftEnvelopeDto { readonly app:AdminAppDto; readonly draft:AdminAppDraftDto; }
export interface AdminAppPreviewBlockerDto { readonly code:string; readonly message:string;
  readonly path?:readonly (string|number)[]; readonly details?:Readonly<Record<string,unknown>>; }
export interface AdminAppPreviewDto {
  readonly appId:string; readonly activeRevisionId:string|null; readonly routeVersion:number;
  readonly draftVersion:number; readonly manifestHash:string; readonly planId:string;
  readonly diff:AdminAppManifestDiff|null; readonly dependencies:readonly AdminAppDependencyDto[];
  readonly blockers:readonly AdminAppPreviewBlockerDto[];
}
export interface AdminAppHealthDto {
  readonly activeRevisionId:string|null;
  readonly state:"not-applied"|"healthy"|"degraded";
  readonly checkedAt:string;
  readonly blockers:readonly AdminAppPreviewBlockerDto[];
}
export interface AdminAppActivationDto { readonly app:AdminAppDto; readonly revision:AdminAppRevisionDto; }
export interface AdminAppManifestArtifactDto { readonly format:"xecms.admin-app-export";
  readonly formatVersion:1; readonly appId:string; readonly revisionId:string|null;
  readonly manifest:AdminAppManifest; readonly serialized:string; readonly hash:string; }
export interface CreateAdminAppRequest { readonly manifest:unknown; }
export interface CreateAdminAppDraftRequest { readonly expectedRouteVersion:number; }
export interface SaveAdminAppDraftRequest { readonly expectedDraftVersion:number;
  readonly expectedBaseRevisionId:string|null; readonly manifest:unknown; }
export interface AdminAppPreviewRequest { readonly expectedActiveRevisionId:string|null;
  readonly expectedRouteVersion:number; readonly expectedDraftVersion:number; }
export interface ApplyAdminAppRequest extends AdminAppPreviewRequest { readonly planId:string; }
export interface RollbackAdminAppRequest { readonly targetRevisionId:string;
  readonly expectedActiveRevisionId:string; readonly expectedRouteVersion:number; }
export interface SetAdminAppStatusRequest { readonly expectedRouteVersion:number;
  readonly currentPassword:string; }
export interface DeleteAdminAppRequest { readonly expectedRouteVersion:number;
  readonly currentPassword:string; }
export interface ImportAdminAppRequest { readonly appId?:string; readonly expectedRouteVersion?:number;
  readonly expectedDraftVersion?:number|null; readonly expectedBaseRevisionId?:string|null;
  readonly manifest:unknown; }

export interface AdminAppRuntimeAccessProfileDto {
  readonly appAllowed:boolean;
  readonly pages:Readonly<Record<string,boolean>>;
  readonly pageUnmasked:Readonly<Record<string,boolean>>;
  readonly actions:Readonly<Record<string,boolean>>;
  readonly permissions:Readonly<Record<string,boolean>>;
  readonly readableFields:Readonly<Record<string,readonly string[]|null>>;
  readonly writableFields:Readonly<Record<string,readonly string[]|null>>;
  readonly policyRevision:number;
}
export interface AdminAppRuntimeSchemaDto {
  readonly revisionId:string;
  readonly collections:readonly CollectionSummaryDto[];
}
export interface AdminAppRuntimeUserDto {
  readonly identityId:string;
  readonly subjectId:string;
  readonly displayName:string;
  readonly realmId:string;
  readonly realmKey?:string;
}
export interface AdminAppRuntimeDependencyHealthDto {
  readonly healthy:boolean;
  readonly checkedAt:string;
  readonly blockers:readonly AdminAppPreviewBlockerDto[];
}
export interface AdminAppRuntimeDto {
  readonly app:AdminAppDto;
  readonly revisionId:string;
  readonly manifest:AdminAppManifest;
  readonly schema:AdminAppRuntimeSchemaDto;
  readonly user:AdminAppRuntimeUserDto;
  readonly access:AdminAppRuntimeAccessProfileDto;
  readonly dependencyHealth:AdminAppRuntimeDependencyHealthDto;
}

export interface ComposedQueryRequest {
  /** Page State values bound to the Data Source parameters (parameterId -> value). */
  readonly parameters?: Readonly<Record<string, JsonValue>>;
  readonly cursor?: string;
}
export interface ComposedQueryRowDto {
  readonly id: string;
  /** Masked, access-filtered Field values (fieldName -> value). */
  readonly data: Readonly<Record<string, unknown>>;
}
export interface ComposedQueryResultDto {
  readonly items: readonly ComposedQueryRowDto[];
  readonly hasNextPage: boolean;
  readonly nextCursor?: string;
}
export interface ComposedAggregateRequest {
  /** Page State values bound to the Data Source parameters (parameterId -> value). */
  readonly parameters?: Readonly<Record<string, JsonValue>>;
}
export interface ComposedAggregateGroupDto {
  /** The group key value (Field/system value the rows were grouped by). */
  readonly group: string | number | boolean | null;
  /** The measure result for the group (count / sum / avg). */
  readonly value: number;
}
export interface ComposedAggregateResultDto {
  readonly groups: readonly ComposedAggregateGroupDto[];
  /** True when the authorized scan hit its bound before aggregating every match. */
  readonly truncated: boolean;
}
export interface ComposedDocumentRequest {
  readonly documentId: string;
  readonly collectionId: string;
}
export interface ComposedDocumentDto {
  readonly id: string;
  /** Masked, access-filtered Field values (fieldName -> value). */
  readonly data: Readonly<Record<string, unknown>>;
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
  readonly passwordChangeRequired?: boolean;
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
  readonly passwordChangeRequired: boolean;
}

export interface BootstrapStatusDto {
  readonly required: boolean;
  readonly sensitivity?: {
    readonly classification: "sensitive";
    readonly defaultMaskPolicyId: string;
  };
  readonly templateRequired: boolean;
}

export interface BootstrapRequest {
  readonly username: string;
  readonly password: string;
}

export interface ApplySetupTemplateRequest {
  readonly starter: "minimal" | "blog" | "community";
  readonly enabledModuleIds: readonly string[];
  readonly collectionLabels: Readonly<Record<string, string>>;
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
  readonly options?: readonly { readonly label: string; readonly value: string }[];
  readonly multiple?: boolean;
  readonly targetCollectionId?: string;
  readonly relationCardinality?: "one" | "many";
  readonly acceptedMimeTypes?: readonly string[];
  readonly sensitivity?: {
    readonly classification: "sensitive";
    readonly defaultMaskPolicyId: string;
  };
}

export interface CollectionSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  /** Present only for the profile Collection owned by a Content Realm. */
  readonly authRealmKey?: string;
  readonly kind?: "collection" | "singleton";
  readonly hierarchy?: {
    readonly enabled: boolean;
    readonly ordering: "manual" | "created-at" | "field";
    readonly permissionInheritance: boolean;
  };
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

export type DocumentQuerySystemFieldDto = "id" | "createdAt" | "updatedAt" | "version";
export type DocumentQueryScalarDto = string | number | boolean | null;
export type DocumentQueryOperatorDto =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "startsWith"
  | "in"
  | "isNull"
  | "isNotNull";

export type DocumentQueryFieldReferenceDto =
  | { readonly kind: "system"; readonly field: DocumentQuerySystemFieldDto }
  | { readonly kind: "data"; readonly fieldId: string };

export type DocumentQueryFilterDto =
  | {
      readonly type: "condition";
      readonly field: DocumentQueryFieldReferenceDto;
      readonly operator: DocumentQueryOperatorDto;
      readonly value?: DocumentQueryScalarDto | readonly DocumentQueryScalarDto[];
    }
  | {
      readonly type: "group";
      readonly operator: "and" | "or";
      readonly filters: readonly DocumentQueryFilterDto[];
    };

export interface DocumentQuerySortDto {
  readonly field: DocumentQueryFieldReferenceDto;
  readonly direction: "asc" | "desc";
}

export interface DocumentQueryRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly state?: DocumentListState;
  readonly fields?: readonly string[];
  readonly filter?: DocumentQueryFilterDto;
  readonly sort?: readonly DocumentQuerySortDto[];
}

export interface DocumentQueryResultDto {
  readonly items: readonly DocumentRecordDto[];
  readonly hasNextPage: boolean;
  readonly nextCursor?: string;
}

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
  /** Present on Content Realm administration routes; omitted on legacy/System policy routes. */
  readonly administration?: {
    readonly accessMode: "realm-actor" | "cms-owner-readonly" | "realm-full-access";
    readonly systemIdentityId?: string;
    readonly realmSubjectId?: string;
    readonly fullAccessBindingId?: string;
    readonly fullAccessValidUntil?: string;
  };
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

export interface AccessEvaluationContextDto {
  readonly ownerSubjectId?: string;
  readonly status?: string;
}

export type AccessEvaluationCheckDto =
  | {
      readonly id: string;
      readonly type: "permission";
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AccessEvaluationContextDto;
    }
  | {
      readonly id: string;
      readonly type: "field";
      readonly action: string;
      readonly resourceId: string;
      readonly field: string;
      readonly access: "read" | "write";
      readonly context?: AccessEvaluationContextDto;
    };

export interface EvaluateAccessBatchRequest {
  readonly checks: readonly AccessEvaluationCheckDto[];
}

export interface AuthorizationFieldMatchedGrantDto {
  readonly sourceRoleId: string;
  readonly sourceBindingId: string;
  readonly sourceResourceId: string;
  readonly membershipPath: readonly string[];
}

export interface AuthorizationFieldDecisionDto {
  readonly allowed: boolean;
  readonly access: "read" | "write";
  readonly field: string;
  readonly resourceId: string;
  readonly reasonCode: string;
  readonly policyRevision: number;
  readonly matchedGrants: readonly AuthorizationFieldMatchedGrantDto[];
}

export type AccessEvaluationResultItemDto =
  | {
      readonly id: string;
      readonly type: "permission";
      readonly supported: boolean;
      readonly decision: AuthorizationDecisionDto;
    }
  | {
      readonly id: string;
      readonly type: "field";
      readonly action: string;
      readonly supported: boolean;
      readonly decision: AuthorizationFieldDecisionDto;
    };

export interface EvaluateAccessBatchResponse {
  readonly policyRevision: number;
  readonly items: readonly AccessEvaluationResultItemDto[];
}

export interface AuthorizationAuditEntryDto {
  readonly id: string;
  readonly realmId: string;
  readonly policyRevision: number;
  readonly actorSubjectId?: string;
  readonly actorIdentityId?: string;
  readonly accessMode?: "realm-actor" | "cms-owner-readonly" | "realm-full-access" | "cms-owner-control-plane" | "system-provisioner";
  readonly fullAccessBindingId?: string;
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
  readonly kind: "human" | "service";
  readonly isOwner?: boolean;
  readonly primaryIdentifier: string;
  readonly originRealmId: string;
  readonly credentialVersion: number;
  readonly disabledAt?: string;
}

export interface GlobalIdentityListDto {
  readonly items: readonly GlobalIdentityDto[];
}

export type ManagedIdentityKindDto = "human" | "service";
export type ManagedIdentityStatusDto = "active" | "disabled";

export interface ManagedIdentityMembershipDto {
  readonly membershipId: string;
  readonly realmId: string;
  readonly realmKey: string;
  readonly realmName: string;
  readonly realmKind: "system" | "content";
  readonly subjectId: string;
  readonly status: RealmMembershipStatusDto;
  readonly profileDocumentId?: string;
}

export interface ManagedIdentityDto {
  readonly identityId: string;
  readonly workspaceId: string;
  readonly kind: ManagedIdentityKindDto;
  readonly primaryIdentifier: string;
  readonly originRealmId: string;
  readonly isOwner: boolean;
  readonly status: ManagedIdentityStatusDto;
  readonly credentialVersion: number;
  readonly passwordChangeRequired: boolean;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly disabledAt?: string;
  readonly memberships: readonly ManagedIdentityMembershipDto[];
}

export interface ManagedIdentityListDto {
  readonly items: readonly ManagedIdentityDto[];
  readonly nextCursor?: string;
}

export interface CreateManagedIdentityRequest {
  readonly primaryIdentifier: string;
  readonly temporaryPassword: string;
}

export interface UpdateManagedIdentityRequest {
  readonly expectedRevision: number;
  readonly primaryIdentifier: string;
}

export interface ManagedIdentityRevisionRequest {
  readonly expectedRevision: number;
}

export interface ResetManagedIdentityCredentialsRequest extends ManagedIdentityRevisionRequest {
  readonly temporaryPassword: string;
  readonly currentPassword: string;
  readonly revokeApiKeys?: boolean;
}

export type CredentialTokenPurposeDto = "invitation" | "password-reset";

export interface CreateCredentialTokenRequest extends ManagedIdentityRevisionRequest {
  readonly currentPassword: string;
}

export interface CreatedCredentialTokenDto {
  readonly purpose: CredentialTokenPurposeDto;
  readonly identityId: string;
  readonly secret: string;
  readonly expiresAt: string;
}

export interface CompleteCredentialTokenRequest {
  readonly token: string;
  readonly newPassword: string;
}

export interface ChangeOwnPasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ManagedSessionDto {
  readonly sessionId: string;
  readonly audience: "admin" | "content";
  readonly identityId: string;
  readonly realmId: string;
  readonly realmName: string;
  readonly membershipId: string;
  readonly createdAt: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly revokedByIdentityId?: string;
  readonly revokeReason?: string;
  readonly current: boolean;
}

export interface ManagedSessionListDto {
  readonly items: readonly ManagedSessionDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface SessionRevocationResultDto {
  readonly revokedCount: number;
}

export interface TransferOwnerRequest {
  readonly targetIdentityId: string;
  readonly reason: string;
  readonly currentPassword: string;
}

export interface CreateServiceIdentityRequest {
  readonly primaryIdentifier: string;
}

export interface ApiKeyDto {
  readonly apiKeyId: string;
  readonly identityId: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  readonly secret: string;
}

export interface ApiKeyListDto {
  readonly items: readonly ApiKeyDto[];
}

export interface CreateApiKeyRequest {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
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
  /** True only for the trusted canonical content-administrator binding. */
  readonly realmAdministrator?: boolean;
}

export interface RealmMembershipListDto {
  readonly items: readonly RealmMembershipDto[];
}

export interface RealmFullAccessBindingDto {
  readonly bindingId: string;
  readonly realmId: string;
  readonly systemIdentityId: string;
  readonly grantedByGlobalIdentityId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly validUntil: string;
  readonly revokedAt?: string;
  readonly revokedByGlobalIdentityId?: string;
  readonly terminationReason?: "revoked" | "expired";
}

export interface RealmFullAccessListDto {
  readonly items: readonly RealmFullAccessBindingDto[];
  /** The current System Identity's active grant, when one exists. */
  readonly activeBinding?: RealmFullAccessBindingDto;
}

export type CollectionActionDto =
  | "list"
  | "read"
  | "create"
  | "update"
  | "delete"
  | "publish"
  | "unpublish"
  | "purge"
  | "restore"
  | "revision.read"
  | "revision.restore";

export type RealmEntitlementEnforcementDto = "disabled" | "enforced";

export interface CollectionEntitlementConstraintDto {
  readonly ownerOnly?: boolean;
  readonly statuses?: readonly string[];
}

export interface RealmCollectionEntitlementDto {
  readonly workspaceId: string;
  readonly realmId: string;
  readonly collectionId: string;
  readonly actions: readonly CollectionActionDto[];
  readonly readableFields?: readonly string[];
  readonly writableFields?: readonly string[];
  readonly constraint?: CollectionEntitlementConstraintDto;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface RealmEntitlementStatusDto {
  readonly realmId: string;
  readonly workspaceId: string;
  readonly state: RealmEntitlementEnforcementDto;
  readonly version: number;
}

/** Per-realm view: enforcement state + every collection ceiling for that realm. */
export interface RealmCollectionEntitlementListDto {
  readonly status: RealmEntitlementStatusDto | null;
  readonly items: readonly RealmCollectionEntitlementDto[];
}

/** Reverse view: every realm holding a ceiling on one collection. */
export interface CollectionEntitlementListDto {
  readonly collectionId: string;
  readonly items: readonly RealmCollectionEntitlementDto[];
}

export interface PutRealmCollectionEntitlementRequest {
  readonly actions: readonly CollectionActionDto[];
  readonly readableFields?: readonly string[];
  readonly writableFields?: readonly string[];
  readonly constraint?: CollectionEntitlementConstraintDto;
  /** `null` to create; a positive revision to update (CAS). */
  readonly expectedRevision: number | null;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
}

export interface DeleteRealmCollectionEntitlementRequest {
  readonly expectedRevision: number;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
}

export type ManagementActionDto =
  | "identity.credentials.reset"
  | "identity.disable"
  | "identity.update"
  | "identity.session.revoke"
  | "membership.suspend"
  | "membership.reactivate"
  | "membership.provision";

export type DelegationScopeRuleDto = "any" | "all";

export interface RealmManagementDelegationDto {
  readonly workspaceId: string;
  readonly managingRealmId: string;
  readonly managedRealmId: string;
  readonly actions: readonly ManagementActionDto[];
  readonly scopeByAction: Readonly<Partial<Record<ManagementActionDto, DelegationScopeRuleDto>>>;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** Delegations where a given realm is the managing realm. */
export interface RealmManagementDelegationListDto {
  readonly managingRealmId: string;
  readonly items: readonly RealmManagementDelegationDto[];
}

/** Reverse view: delegations where a given realm is the managed realm. */
export interface ManagedRealmDelegationListDto {
  readonly managedRealmId: string;
  readonly items: readonly RealmManagementDelegationDto[];
}

export interface PutRealmManagementDelegationRequest {
  readonly actions: readonly ManagementActionDto[];
  readonly scopeByAction: Readonly<Partial<Record<ManagementActionDto, DelegationScopeRuleDto>>>;
  /** `null` to create; a positive revision to update (CAS). */
  readonly expectedRevision: number | null;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
}

export interface DeleteRealmManagementDelegationRequest {
  readonly expectedRevision: number;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
}

export interface RealmOwnerStatusDto {
  readonly realmId: string;
  readonly status: "healthy" | "ownerless" | "invalid";
  readonly policyRevision: number;
  readonly owner?: {
    readonly globalIdentityId: string;
    readonly membershipId: string;
    readonly subjectId: string;
    readonly primaryIdentifier: string;
    readonly identityActive: boolean;
    readonly membershipStatus: RealmMembershipStatusDto;
  };
  readonly issueCode?: string;
}

export interface RealmOwnerCommandRequest {
  readonly targetMembershipId: string;
  readonly expectedPolicyRevision: number;
  readonly reason: string;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
}

export type AssignRealmOwnerRequest = RealmOwnerCommandRequest;
export type RecoverRealmOwnerRequest = RealmOwnerCommandRequest;

export interface TransferRealmOwnerRequest extends RealmOwnerCommandRequest {
  readonly revokePreviousSessions?: boolean;
  readonly suspendPreviousMembership?: boolean;
}

export interface CreateIdentityRealmRequest {
  readonly key: string;
  readonly name: string;
  readonly acceptSystemIdentities?: boolean;
  readonly provisioning?: RealmProvisioningModeDto;
  readonly registration?: RealmRegistrationModeDto;
  readonly defaultRoleIds?: readonly string[];
}

export interface CreateRealmProfileSchemaRequest {
  readonly collectionName: string;
  readonly collectionLabel: string;
  readonly identifierFieldName: string;
  readonly includeDisplayName: boolean;
}

export interface CreateRealmProfileFieldRequest {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "textarea";
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

export interface RegisterRealmMembershipRequest {
  /** Login identifier for the brand-new content user being created. */
  readonly identifier: string;
  /** Initial credential for the new user (not the operator's password). */
  readonly password: string;
  readonly profile: Readonly<Record<string, unknown>>;
  /** Operator's own current System password, used to re-authenticate this action. */
  readonly reauthPassword: string;
}

export interface GrantRealmAdministratorRequest {
  /** Operator's own current System password, used to re-authenticate this action. */
  readonly reauthPassword: string;
}

export interface RevokeRealmAdministratorRequest {
  /** Operator's own current System password, used to re-authenticate this action. */
  readonly reauthPassword: string;
}

export interface GrantRealmFullAccessRequest {
  readonly reason: string;
  /** Current System account password; never persisted or returned. */
  readonly password: string;
  readonly validUntil: string;
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
    readonly type: "document" | "identity" | "realm" | "authorization" | "media"
      | "workspace" | "site" | "retention";
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
