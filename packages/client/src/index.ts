import {
  isProblemDetails,
  type ApplySchemaRequest,
  type AuthorizationAuditListDto,
  type AuthorizationDecisionDto,
  type AuthorizationPolicyDto,
  type EvaluateAccessBatchRequest,
  type EvaluateAccessBatchResponse,
  type AuthenticatedSessionDto,
  type BootstrapRequest,
  type BootstrapStatusDto,
  type ChangeOwnPasswordRequest,
  type CollectionListDto,
  type ContentAuthenticatedSessionDto,
  type ContentRealmLoginRequest,
  type ContentRealmMetadataDto,
  type ContentRealmProfileDto,
  type ContentRealmSignupRequest,
  type ContentSessionDto,
  type CreateAuthorizationBindingRequest,
  type CreateAuthorizationGroupMembershipRequest,
  type CreateAuthorizationLevelRequest,
  type CreateAuthorizationRoleRequest,
  type CreateAuthorizationSubjectRequest,
  type CreateDocumentRequest,
  type CreateIdentityRealmRequest,
  type CreateRealmProfileFieldRequest,
  type CreateRealmProfileSchemaRequest,
  type DeleteDocumentRequest,
  type DeleteAuthorizationObjectRequest,
  type DocumentListState,
  type DocumentListDto,
  type DocumentQueryRequest,
  type DocumentQueryResultDto,
  type DocumentRecordDto,
  type DocumentRevisionDetailDto,
  type DocumentRevisionListDto,
  type DocumentTreeDto,
  type GeneratedTypesDto,
  type HealthResponse,
  type GrantRealmFullAccessRequest,
  type GlobalIdentityListDto,
  type IdentityRealmDto,
  type IdentityRealmListDto,
  type IssueSchemaIdsRequest,
  type IssueSchemaIdsResponse,
  type LoginRequest,
  type MediaConsistencyReportDto,
  type MediaListDto,
  type MediaRecordDto,
  type ManagedIdentityDto,
  type ManagedIdentityKindDto,
  type ManagedIdentityListDto,
  type ManagedIdentityStatusDto,
  type CreateManagedIdentityRequest,
  type UpdateManagedIdentityRequest,
  type ManagedIdentityRevisionRequest,
  type ManagedSessionDto,
  type ManagedSessionListDto,
  type ResetManagedIdentityCredentialsRequest,
  type SessionRevocationResultDto,
  type TransferOwnerRequest,
  type ApiKeyDto,
  type ApiKeyListDto,
  type CreateApiKeyRequest,
  type CreatedApiKeyDto,
  type CreateServiceIdentityRequest,
  type CreateCredentialTokenRequest,
  type CreatedCredentialTokenDto,
  type CompleteCredentialTokenRequest,
  type MoveDocumentRequest,
  type MoveDocumentPreviewRequest,
  type MoveDocumentPreviewDto,
  type MoveDocumentResultDto,
  type PublishedDocumentListDto,
  type PublishedDocumentRecordDto,
  type PublishDocumentRequest,
  type PurgeDocumentRequest,
  type ProblemDetails,
  type PreviewSchemaRequest,
  type SaveSchemaDraftRequest,
  type SchemaDraftEnvelopeDto,
  type SchemaManifestDto,
  type SchemaPreviewDto,
  type SchemaRevisionEnvelopeDto,
  type SessionDto,
  type SimulateAuthorizationRequest,
  type RestoreDocumentRequest,
  type RestoreRevisionRequest,
  type RealmFullAccessBindingDto,
  type RealmFullAccessListDto,
  type RealmMembershipDto,
  type RealmMembershipListDto,
  type RealmMembershipRevisionRequest,
  type ProvisionRealmMembershipRequest,
  type RegisterRealmMembershipRequest,
  type GrantRealmAdministratorRequest,
  type RevokeRealmFullAccessRequest,
  type UnpublishDocumentRequest,
  type UpdateAuthorizationBindingRequest,
  type UpdateAuthorizationLevelRequest,
  type UpdateAuthorizationRoleRequest,
  type UpdateContentRealmProfileRequest,
  type UpdateDocumentRequest,
  type UpdateIdentityRealmRequest,
  type EventDeliveryDto,
  type EventDeliveryListDto,
  type EventDeliveryStatusDto,
  type EventWorkerCycleDto,
  type SystemDiagnosticsDto,
  type WorkspaceSettingsDto,
  type UpdateWorkspaceSettingsRequest,
  type SiteDto,
  type SiteListDto,
  type CreateSiteRequest,
  type UpdateSiteRequest,
  type SiteStatusRequest,
  type SetDefaultSiteRequest,
  type SiteCollectionBindingRequest,
  type UnifiedAuditEntryDto,
  type UnifiedAuditListDto,
  type UnifiedAuditQueryDto,
  type RetentionPolicyDto,
  type RetentionPlanDto,
  type UpdateRetentionPolicyRequest,
  type PreviewRetentionRequest,
  type ApplyRetentionRequest,
  type PluginCatalogListDto,
  type PluginListDto,
  type PluginRecordDto,
  type PluginPlanDto,
  type PreviewPluginPlanRequest,
  type ApplyPluginPlanRequest,
  type UpdatePluginConfigRequest,
  type PluginExportDto,
  type AdminPluginExtensionListDto,
} from "@xecms/contracts";

export * from "@xecms/contracts";

export class XeCmsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly problem: ProblemDetails;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(problem: ProblemDetails) {
    super(problem.detail, { cause: problem });
    this.name = "XeCmsApiError";
    this.status = problem.status;
    this.code = problem.code;
    this.requestId = problem.requestId;
    this.problem = problem;
    this.fieldErrors = Object.freeze(
      Object.fromEntries(
        (problem.issues ?? []).map((issue) => [issue.path.map(String).join("."), issue.message]),
      ),
    );
  }
}

export interface XeCmsClientOptions {
  /** Defaults to `/api`, keeping Admin and API on the same origin. */
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ListDocumentsOptions {
  readonly page?: number;
  readonly pageSize?: number;
  readonly state?: DocumentListState;
}

export interface ContentRealmClient {
  getMetadata(): Promise<ContentRealmMetadataDto>;
  signup(input: ContentRealmSignupRequest): Promise<ContentAuthenticatedSessionDto>;
  login(input: ContentRealmLoginRequest): Promise<ContentAuthenticatedSessionDto>;
  getSession(): Promise<ContentSessionDto>;
  logout(): Promise<void>;
  getProfile(): Promise<ContentRealmProfileDto>;
  updateProfile(input: UpdateContentRealmProfileRequest): Promise<ContentRealmProfileDto>;
  listCollections(): Promise<CollectionListDto>;
  listDocuments(
    collectionId: string,
    options?: Omit<ListDocumentsOptions, "state">,
  ): Promise<DocumentListDto>;
  queryDocuments(
    collectionId: string,
    input: DocumentQueryRequest,
  ): Promise<DocumentQueryResultDto>;
  getDocument(collectionId: string, documentId: string): Promise<DocumentRecordDto>;
  createDocument(collectionId: string, input: CreateDocumentRequest): Promise<DocumentRecordDto>;
  updateDocument(
    collectionId: string,
    documentId: string,
    input: UpdateDocumentRequest,
  ): Promise<DocumentRecordDto>;
}

export interface AuthorizationClient {
  getPolicy(): Promise<AuthorizationPolicyDto>;
  createSubject(input: CreateAuthorizationSubjectRequest): Promise<AuthorizationPolicyDto>;
  addGroupMembership(input: CreateAuthorizationGroupMembershipRequest): Promise<AuthorizationPolicyDto>;
  removeGroupMembership(
    memberSubjectId: string,
    groupSubjectId: string,
    input: DeleteAuthorizationObjectRequest,
  ): Promise<AuthorizationPolicyDto>;
  createLevel(input: CreateAuthorizationLevelRequest): Promise<AuthorizationPolicyDto>;
  updateLevel(levelId: string, input: UpdateAuthorizationLevelRequest): Promise<AuthorizationPolicyDto>;
  deleteLevel(levelId: string, input: DeleteAuthorizationObjectRequest): Promise<AuthorizationPolicyDto>;
  createRole(input: CreateAuthorizationRoleRequest): Promise<AuthorizationPolicyDto>;
  updateRole(roleId: string, input: UpdateAuthorizationRoleRequest): Promise<AuthorizationPolicyDto>;
  deleteRole(roleId: string, input: DeleteAuthorizationObjectRequest): Promise<AuthorizationPolicyDto>;
  createBinding(input: CreateAuthorizationBindingRequest): Promise<AuthorizationPolicyDto>;
  updateBinding(bindingId: string, input: UpdateAuthorizationBindingRequest): Promise<AuthorizationPolicyDto>;
  deleteBinding(bindingId: string, input: DeleteAuthorizationObjectRequest): Promise<AuthorizationPolicyDto>;
  simulate(input: SimulateAuthorizationRequest): Promise<AuthorizationDecisionDto>;
  listAudit(): Promise<AuthorizationAuditListDto>;
}

export interface XeCmsClient {
  readonly health: {
    get(): Promise<HealthResponse>;
  };
  readonly access: {
    evaluateBatch(input: EvaluateAccessBatchRequest): Promise<EvaluateAccessBatchResponse>;
  };
  readonly auth: {
    getBootstrapStatus(): Promise<BootstrapStatusDto>;
    bootstrap(input: BootstrapRequest): Promise<AuthenticatedSessionDto>;
    getSession(): Promise<SessionDto>;
    login(input: LoginRequest): Promise<AuthenticatedSessionDto>;
    logout(): Promise<void>;
    changePassword(input: ChangeOwnPasswordRequest): Promise<void>;
  };
  readonly settings: {
    diagnostics(): Promise<SystemDiagnosticsDto>;
    getWorkspace(): Promise<WorkspaceSettingsDto>;
    updateWorkspace(input: UpdateWorkspaceSettingsRequest): Promise<WorkspaceSettingsDto>;
  };
  readonly sites: {
    list(): Promise<SiteListDto>; get(siteId:string):Promise<SiteDto>;
    create(input:CreateSiteRequest):Promise<SiteDto>; update(siteId:string,input:UpdateSiteRequest):Promise<SiteDto>;
    archive(siteId:string,input:SiteStatusRequest):Promise<SiteDto>; reactivate(siteId:string,input:SiteStatusRequest):Promise<SiteDto>;
    setDefault(siteId:string,input:SetDefaultSiteRequest):Promise<SiteDto>;
    bindCollection(siteId:string,collectionId:string,input:SiteCollectionBindingRequest):Promise<SiteDto>;
    unbindCollection(siteId:string,collectionId:string,input:SiteCollectionBindingRequest):Promise<SiteDto>;
  };
  readonly operations: {
    listAudit(query?:UnifiedAuditQueryDto):Promise<UnifiedAuditListDto>;
    getAudit(entryId:string):Promise<UnifiedAuditEntryDto>;
    exportAudit(query:UnifiedAuditQueryDto & {readonly from:string;readonly to:string}):Promise<string>;
    getRetentionPolicy():Promise<RetentionPolicyDto>;
    updateRetentionPolicy(input:UpdateRetentionPolicyRequest):Promise<RetentionPolicyDto>;
    previewRetention(input:PreviewRetentionRequest):Promise<RetentionPlanDto>;
    getRetentionPlan(planId:string):Promise<RetentionPlanDto>;
    applyRetention(planId:string,input:ApplyRetentionRequest):Promise<RetentionPlanDto>;
    checkMediaConsistency():Promise<MediaConsistencyReportDto>;
  };
  readonly plugins:{
    catalog():Promise<PluginCatalogListDto>;list():Promise<PluginListDto>;get(pluginId:string):Promise<PluginRecordDto>;
    updateConfig(pluginId:string,input:UpdatePluginConfigRequest):Promise<PluginRecordDto>;
    preview(input:PreviewPluginPlanRequest):Promise<PluginPlanDto>;getPlan(planId:string):Promise<PluginPlanDto>;
    apply(planId:string,input:ApplyPluginPlanRequest):Promise<PluginPlanDto>;
    getExport(exportId:string):Promise<PluginExportDto>;adminExtensions():Promise<AdminPluginExtensionListDto>;
  };
  readonly jobs: {
    list(options?: {
      readonly page?: number;
      readonly pageSize?: number;
      readonly status?: EventDeliveryStatusDto;
      readonly topic?: string;
      readonly handlerId?: string;
    }): Promise<EventDeliveryListDto>;
    get(deliveryId: string): Promise<EventDeliveryDto>;
    retry(deliveryId: string): Promise<EventDeliveryDto>;
    run(): Promise<EventWorkerCycleDto>;
  };
  readonly schema: {
    issueIds(input: IssueSchemaIdsRequest): Promise<IssueSchemaIdsResponse>;
    getCurrent(): Promise<SchemaRevisionEnvelopeDto | null>;
    getDraft(): Promise<SchemaDraftEnvelopeDto | null>;
    saveDraft(input: SaveSchemaDraftRequest): Promise<SchemaDraftEnvelopeDto>;
    preview(input: PreviewSchemaRequest): Promise<SchemaPreviewDto>;
    apply(input: ApplySchemaRequest): Promise<SchemaRevisionEnvelopeDto>;
    exportManifest(): Promise<SchemaManifestDto>;
    importManifest(input: SaveSchemaDraftRequest): Promise<SchemaDraftEnvelopeDto>;
    generateTypes(): Promise<GeneratedTypesDto>;
  };
  readonly collections: {
    list(): Promise<CollectionListDto>;
  };
  readonly documents: {
    list(collectionId: string, options?: ListDocumentsOptions): Promise<DocumentListDto>;
    query(collectionId: string, input: DocumentQueryRequest): Promise<DocumentQueryResultDto>;
    get(collectionId: string, documentId: string): Promise<DocumentRecordDto>;
    create(collectionId: string, input: CreateDocumentRequest): Promise<DocumentRecordDto>;
    update(
      collectionId: string,
      documentId: string,
      input: UpdateDocumentRequest,
    ): Promise<DocumentRecordDto>;
    delete(collectionId: string, documentId: string, input: DeleteDocumentRequest): Promise<void>;
    publish(
      collectionId: string,
      documentId: string,
      input: PublishDocumentRequest,
    ): Promise<DocumentRecordDto>;
    unpublish(
      collectionId: string,
      documentId: string,
      input: UnpublishDocumentRequest,
    ): Promise<DocumentRecordDto>;
    restore(
      collectionId: string,
      documentId: string,
      input: RestoreDocumentRequest,
    ): Promise<DocumentRecordDto>;
    purge(collectionId: string, documentId: string, input: PurgeDocumentRequest): Promise<void>;
    tree(collectionId: string, parentId?: string | null): Promise<DocumentTreeDto>;
    move(
      collectionId: string,
      documentId: string,
      input: MoveDocumentRequest,
    ): Promise<MoveDocumentResultDto>;
    previewMove(
      collectionId: string,
      documentId: string,
      input: MoveDocumentPreviewRequest,
    ): Promise<MoveDocumentPreviewDto>;
  };
  readonly revisions: {
    list(collectionId: string, documentId: string): Promise<DocumentRevisionListDto>;
    get(
      collectionId: string,
      documentId: string,
      revisionId: string,
    ): Promise<DocumentRevisionDetailDto>;
    restore(
      collectionId: string,
      documentId: string,
      revisionId: string,
      input: RestoreRevisionRequest,
    ): Promise<DocumentRecordDto>;
  };
  readonly content: {
    list(
      collectionId: string,
      options?: Omit<ListDocumentsOptions, "state">,
    ): Promise<PublishedDocumentListDto>;
    get(collectionId: string, documentId: string): Promise<PublishedDocumentRecordDto>;
  };
  readonly media: {
    list(): Promise<MediaListDto>;
    upload(input: { readonly file: Blob; readonly fileName: string }): Promise<MediaRecordDto>;
    delete(mediaId: string): Promise<void>;
    checkConsistency(): Promise<MediaConsistencyReportDto>;
    contentUrl(mediaId: string): string;
  };
  readonly authorization: AuthorizationClient;
  readonly identities: {
    list(options?: {
      readonly limit?: number;
      readonly cursor?: string;
      readonly query?: string;
      readonly kind?: ManagedIdentityKindDto;
      readonly status?: ManagedIdentityStatusDto;
      readonly originRealmId?: string;
      readonly realmId?: string;
    }): Promise<ManagedIdentityListDto>;
    get(identityId: string): Promise<ManagedIdentityDto>;
    create(input: CreateManagedIdentityRequest): Promise<ManagedIdentityDto>;
    update(identityId: string, input: UpdateManagedIdentityRequest): Promise<ManagedIdentityDto>;
    disable(identityId: string, input: ManagedIdentityRevisionRequest): Promise<ManagedIdentityDto>;
    reactivate(identityId: string, input: ManagedIdentityRevisionRequest): Promise<ManagedIdentityDto>;
    resetCredentials(identityId: string, input: ResetManagedIdentityCredentialsRequest): Promise<ManagedIdentityDto>;
    createInvitation(identityId: string, input: CreateCredentialTokenRequest): Promise<CreatedCredentialTokenDto>;
    createResetToken(identityId: string, input: CreateCredentialTokenRequest): Promise<CreatedCredentialTokenDto>;
    createSystemMembership(identityId: string, input: ManagedIdentityRevisionRequest): Promise<ManagedIdentityDto>;
    completeInvitation(input: CompleteCredentialTokenRequest): Promise<void>;
    completeReset(input: CompleteCredentialTokenRequest): Promise<void>;
    listSessions(identityId: string, options?: {
      readonly status?: "active" | "history";
      readonly page?: number;
      readonly pageSize?: number;
    }): Promise<ManagedSessionListDto>;
    revokeSession(sessionId: string): Promise<ManagedSessionDto>;
    revokeAllSessions(identityId: string): Promise<SessionRevocationResultDto>;
    transferOwner(input: TransferOwnerRequest): Promise<ManagedIdentityDto>;
    createService(input: CreateServiceIdentityRequest): Promise<ManagedIdentityDto>;
    listApiKeys(identityId: string): Promise<ApiKeyListDto>;
    createApiKey(identityId: string, input: CreateApiKeyRequest): Promise<CreatedApiKeyDto>;
    revokeApiKey(apiKeyId: string): Promise<ApiKeyDto>;
  };
  readonly identityRealms: {
    listGlobalIdentities(): Promise<GlobalIdentityListDto>;
    list(): Promise<IdentityRealmListDto>;
    get(realmId: string): Promise<IdentityRealmDto>;
    create(input: CreateIdentityRealmRequest): Promise<IdentityRealmDto>;
    createProfileSchema(realmId: string, input: CreateRealmProfileSchemaRequest): Promise<IdentityRealmDto>;
    createProfileField(realmId: string, input: CreateRealmProfileFieldRequest): Promise<IdentityRealmDto>;
    update(realmId: string, input: UpdateIdentityRealmRequest): Promise<IdentityRealmDto>;
    listMemberships(realmId: string): Promise<RealmMembershipListDto>;
    provisionMembership(
      realmId: string,
      input: ProvisionRealmMembershipRequest,
    ): Promise<RealmMembershipDto>;
    registerMembership(
      realmId: string,
      input: RegisterRealmMembershipRequest,
    ): Promise<RealmMembershipDto>;
    grantRealmAdministrator(
      realmId: string,
      membershipId: string,
      input: GrantRealmAdministratorRequest,
    ): Promise<RealmMembershipDto>;
    suspendMembership(
      realmId: string,
      membershipId: string,
      input: RealmMembershipRevisionRequest,
    ): Promise<RealmMembershipDto>;
    reactivateMembership(
      realmId: string,
      membershipId: string,
      input: RealmMembershipRevisionRequest,
    ): Promise<RealmMembershipDto>;
    listFullAccess(realmId: string): Promise<RealmFullAccessListDto>;
    grantFullAccess(
      realmId: string,
      input: GrantRealmFullAccessRequest,
    ): Promise<RealmFullAccessBindingDto>;
    revokeFullAccess(
      realmId: string,
      bindingId: string,
      input: RevokeRealmFullAccessRequest,
    ): Promise<RealmFullAccessBindingDto>;
    authorizationFor(realmId: string): AuthorizationClient;
  };
  readonly contentRealms: {
    forRealm(realmKey: string): ContentRealmClient;
  };
}

interface RequestOptions extends RequestInit {
  readonly csrf?: boolean;
  /** Selects the isolated Content Realm CSRF store for this request. */
  readonly contentRealmKey?: string;
}

export function createXeCmsClient(options: XeCmsClientOptions = {}): XeCmsClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "/api");
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  let adminCsrfToken: string | undefined;
  const contentRealmCsrfTokens = new Map<string, string>();

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { csrf, contentRealmKey, ...requestInit } = options;
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (csrf === true) {
      const token = contentRealmKey === undefined
        ? adminCsrfToken
        : contentRealmCsrfTokens.get(contentRealmKey);
      if (token === undefined) {
        throw new Error(
          contentRealmKey === undefined
            ? "A session must be loaded before making a CSRF-protected request."
            : `A Content Realm session for '${contentRealmKey}' must be loaded before making a CSRF-protected request.`,
        );
      }
      headers.set("x-csrf-token", token);
    }

    const response = await fetchImplementation(`${baseUrl}${path}`, {
      ...requestInit,
      headers,
      credentials: "same-origin",
    });

    if (!response.ok) {
      const payload = await parseJson(response);
      const problem = isProblemDetails(payload)
        ? payload
        : fallbackProblem(response, payload);
      if (response.status === 401) {
        if (contentRealmKey === undefined) {
          adminCsrfToken = undefined;
        } else {
          contentRealmCsrfTokens.delete(contentRealmKey);
        }
      }
      throw new XeCmsApiError(problem);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = (await parseJson(response)) as T;
    if (hasCsrfToken(payload)) {
      if (contentRealmKey === undefined) {
        adminCsrfToken = payload.csrfToken;
      } else {
        contentRealmCsrfTokens.set(contentRealmKey, payload.csrfToken);
      }
    }
    return payload;
  }

  async function requestText(path: string): Promise<string> {
    const response = await fetchImplementation(`${baseUrl}${path}`, { credentials: "same-origin" });
    if (!response.ok) {
      const payload = await parseJson(response);
      throw new XeCmsApiError(isProblemDetails(payload) ? payload : fallbackProblem(response, payload));
    }
    return response.text();
  }

  const json = (value: unknown): string => JSON.stringify(value);
  const documentPath = (collectionId: string, documentId?: string): string =>
    `/collections/${encodeURIComponent(collectionId)}/documents${
      documentId === undefined ? "" : `/${encodeURIComponent(documentId)}`
    }`;
  const revisionPath = (collectionId: string, documentId: string, revisionId?: string): string =>
    `${documentPath(collectionId, documentId)}/revisions${
      revisionId === undefined ? "" : `/${encodeURIComponent(revisionId)}`
    }`;
  const contentPath = (collectionId: string, documentId?: string): string =>
    `/content/${encodeURIComponent(collectionId)}/documents${
      documentId === undefined ? "" : `/${encodeURIComponent(documentId)}`
    }`;
  const authorizationPath = (kind?: string, id?: string): string =>
    `/authorization${kind === undefined ? "" : `/${kind}`}${
      id === undefined ? "" : `/${encodeURIComponent(id)}`
    }`;
  const identityRealmPath = (realmId?: string): string =>
    `/identity-realms${realmId === undefined ? "" : `/${encodeURIComponent(realmId)}`}`;
  const contentRealmPath = (realmKey: string, suffix = ""): string =>
    `/content-realms/${encodeURIComponent(realmKey)}${suffix}`;

  const createContentRealmClient = (realmKey: string): ContentRealmClient => ({
    getMetadata: () =>
      request<ContentRealmMetadataDto>(contentRealmPath(realmKey), {
        contentRealmKey: realmKey,
      }),
    signup: (input) =>
      request<ContentAuthenticatedSessionDto>(contentRealmPath(realmKey, "/signup"), {
        method: "POST",
        body: json(input),
        contentRealmKey: realmKey,
      }),
    login: (input) =>
      request<ContentAuthenticatedSessionDto>(contentRealmPath(realmKey, "/login"), {
        method: "POST",
        body: json(input),
        contentRealmKey: realmKey,
      }),
    getSession: () =>
      request<ContentSessionDto>(contentRealmPath(realmKey, "/session"), {
        contentRealmKey: realmKey,
      }),
    logout: async () => {
      await request<void>(contentRealmPath(realmKey, "/logout"), {
        method: "POST",
        csrf: true,
        contentRealmKey: realmKey,
      });
      contentRealmCsrfTokens.delete(realmKey);
    },
    getProfile: () =>
      request<ContentRealmProfileDto>(contentRealmPath(realmKey, "/profile"), {
        contentRealmKey: realmKey,
      }),
    updateProfile: (input) =>
      request<ContentRealmProfileDto>(contentRealmPath(realmKey, "/profile"), {
        method: "PATCH",
        body: json(input),
        csrf: true,
        contentRealmKey: realmKey,
      }),
    listCollections: () =>
      request<CollectionListDto>(contentRealmPath(realmKey, "/collections"), {
        contentRealmKey: realmKey,
      }),
    listDocuments: (collectionId, listOptions = {}) => {
      const search = new URLSearchParams();
      if (listOptions.page !== undefined) search.set("page", String(listOptions.page));
      if (listOptions.pageSize !== undefined) search.set("pageSize", String(listOptions.pageSize));
      const query = search.size === 0 ? "" : `?${search.toString()}`;
      return request<DocumentListDto>(
        contentRealmPath(
          realmKey,
          `/collections/${encodeURIComponent(collectionId)}/documents${query}`,
        ),
        { contentRealmKey: realmKey },
      );
    },
    queryDocuments: (collectionId, input) =>
      request<DocumentQueryResultDto>(
        contentRealmPath(
          realmKey,
          `/collections/${encodeURIComponent(collectionId)}/documents/query`,
        ),
        {
          method: "POST",
          body: json(input),
          contentRealmKey: realmKey,
        },
      ),
    getDocument: (collectionId, documentId) =>
      request<DocumentRecordDto>(contentRealmPath(
        realmKey,
        `/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
      ), { contentRealmKey: realmKey }),
    createDocument: (collectionId, input) =>
      request<DocumentRecordDto>(contentRealmPath(
        realmKey,
        `/collections/${encodeURIComponent(collectionId)}/documents`,
      ), {
        method: "POST",
        body: json(input),
        csrf: true,
        contentRealmKey: realmKey,
      }),
    updateDocument: (collectionId, documentId, input) =>
      request<DocumentRecordDto>(contentRealmPath(
        realmKey,
        `/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
      ), {
        method: "PATCH",
        body: json(input),
        csrf: true,
        contentRealmKey: realmKey,
      }),
  });

  const createAuthorizationClient = (
    path: (kind?: string, id?: string) => string,
  ): AuthorizationClient => ({
    getPolicy: () => request<AuthorizationPolicyDto>(path("policy")),
    createSubject: (input) => request<AuthorizationPolicyDto>(path("subjects"), {
      method: "POST", body: json(input), csrf: true,
    }),
    addGroupMembership: (input) => request<AuthorizationPolicyDto>(path("group-memberships"), {
      method: "POST", body: json(input), csrf: true,
    }),
    removeGroupMembership: (memberSubjectId, groupSubjectId, input) =>
      request<AuthorizationPolicyDto>(
        `${path("group-memberships", memberSubjectId)}/${encodeURIComponent(groupSubjectId)}`,
        { method: "DELETE", body: json(input), csrf: true },
      ),
    createLevel: (input) => request<AuthorizationPolicyDto>(path("levels"), {
      method: "POST", body: json(input), csrf: true,
    }),
    updateLevel: (levelId, input) => request<AuthorizationPolicyDto>(path("levels", levelId), {
      method: "PATCH", body: json(input), csrf: true,
    }),
    deleteLevel: (levelId, input) => request<AuthorizationPolicyDto>(path("levels", levelId), {
      method: "DELETE", body: json(input), csrf: true,
    }),
    createRole: (input) => request<AuthorizationPolicyDto>(path("roles"), {
      method: "POST", body: json(input), csrf: true,
    }),
    updateRole: (roleId, input) => request<AuthorizationPolicyDto>(path("roles", roleId), {
      method: "PATCH", body: json(input), csrf: true,
    }),
    deleteRole: (roleId, input) => request<AuthorizationPolicyDto>(path("roles", roleId), {
      method: "DELETE", body: json(input), csrf: true,
    }),
    createBinding: (input) => request<AuthorizationPolicyDto>(path("bindings"), {
      method: "POST", body: json(input), csrf: true,
    }),
    updateBinding: (bindingId, input) => request<AuthorizationPolicyDto>(path("bindings", bindingId), {
      method: "PATCH", body: json(input), csrf: true,
    }),
    deleteBinding: (bindingId, input) => request<AuthorizationPolicyDto>(path("bindings", bindingId), {
      method: "DELETE", body: json(input), csrf: true,
    }),
    simulate: (input) => request<AuthorizationDecisionDto>(path("simulate"), {
      method: "POST", body: json(input), csrf: true,
    }),
    listAudit: () => request<AuthorizationAuditListDto>(path("audit")),
  });

  return {
    health: {
      get: () => request<HealthResponse>("/health"),
    },
    access: {
      evaluateBatch: (input) => request<EvaluateAccessBatchResponse>("/access/evaluate-batch", {
        method: "POST",
        body: json(input),
      }),
    },
    auth: {
      getBootstrapStatus: () => request<BootstrapStatusDto>("/bootstrap/status"),
      bootstrap: (input) =>
        request<AuthenticatedSessionDto>("/bootstrap", {
          method: "POST",
          body: json(input),
        }),
      getSession: () => request<SessionDto>("/auth/session"),
      login: (input) =>
        request<AuthenticatedSessionDto>("/auth/login", {
          method: "POST",
          body: json(input),
        }),
      logout: async () => {
        await request<void>("/auth/logout", { method: "POST", csrf: true });
        adminCsrfToken = undefined;
      },
      changePassword: async (input) => {
        await request<void>("/credentials/password", {
          method: "POST", body: json(input), csrf: true,
        });
        adminCsrfToken = undefined;
      },
    },
    settings: {
      diagnostics: () => request<SystemDiagnosticsDto>("/system/diagnostics"),
      getWorkspace: () => request<WorkspaceSettingsDto>("/workspace/settings"),
      updateWorkspace: (input) => request<WorkspaceSettingsDto>("/workspace/settings", { method:"PATCH",body:json(input),csrf:true }),
    },
    sites: {
      list:()=>request<SiteListDto>("/sites"),get:(id)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}`),
      create:(input)=>request<SiteDto>("/sites",{method:"POST",body:json(input),csrf:true}),
      update:(id,input)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}`,{method:"PATCH",body:json(input),csrf:true}),
      archive:(id,input)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}/archive`,{method:"POST",body:json(input),csrf:true}),
      reactivate:(id,input)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}/reactivate`,{method:"POST",body:json(input),csrf:true}),
      setDefault:(id,input)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}/default`,{method:"POST",body:json(input),csrf:true}),
      bindCollection:(id,c,input)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}/collections/${encodeURIComponent(c)}`,{method:"PUT",body:json(input),csrf:true}),
      unbindCollection:(id,c,input)=>request<SiteDto>(`/sites/${encodeURIComponent(id)}/collections/${encodeURIComponent(c)}`,{method:"DELETE",body:json(input),csrf:true}),
    },
    operations: {
      listAudit:(query={})=>request<UnifiedAuditListDto>(`/audit${queryString(query)}`),
      getAudit:(entryId)=>request<UnifiedAuditEntryDto>(`/audit/${encodeURIComponent(entryId)}`),
      exportAudit:(query)=>requestText(`/audit/export${queryString(query)}`),
      getRetentionPolicy:()=>request<RetentionPolicyDto>("/retention/policy"),
      updateRetentionPolicy:(input)=>request<RetentionPolicyDto>("/retention/policy",{method:"PATCH",body:json(input),csrf:true}),
      previewRetention:(input)=>request<RetentionPlanDto>("/retention/preview",{method:"POST",body:json(input),csrf:true}),
      getRetentionPlan:(planId)=>request<RetentionPlanDto>(`/retention/plans/${encodeURIComponent(planId)}`),
      applyRetention:(planId,input)=>request<RetentionPlanDto>(`/retention/plans/${encodeURIComponent(planId)}/apply`,{method:"POST",body:json(input),csrf:true}),
      checkMediaConsistency:()=>request<MediaConsistencyReportDto>("/media/consistency"),
    },
    plugins:{
      catalog:()=>request<PluginCatalogListDto>("/plugins/catalog"),list:()=>request<PluginListDto>("/plugins"),
      get:(id)=>request<PluginRecordDto>(`/plugins/${encodeURIComponent(id)}`),
      updateConfig:(id,input)=>request<PluginRecordDto>(`/plugins/${encodeURIComponent(id)}/config`,{method:"PATCH",body:json(input),csrf:true}),
      preview:(input)=>request<PluginPlanDto>("/plugins/plans",{method:"POST",body:json(input),csrf:true}),
      getPlan:(id)=>request<PluginPlanDto>(`/plugins/plans/${encodeURIComponent(id)}`),
      apply:(id,input)=>request<PluginPlanDto>(`/plugins/plans/${encodeURIComponent(id)}/apply`,{method:"POST",body:json(input),csrf:true}),
      getExport:(id)=>request<PluginExportDto>(`/plugins/exports/${encodeURIComponent(id)}`),
      adminExtensions:()=>request<AdminPluginExtensionListDto>("/admin/extensions"),
    },
    jobs: {
      list: (options = {}) => {
        const search = new URLSearchParams();
        if (options.page !== undefined) search.set("page", String(options.page));
        if (options.pageSize !== undefined) search.set("pageSize", String(options.pageSize));
        if (options.status !== undefined) search.set("status", options.status);
        if (options.topic !== undefined) search.set("topic", options.topic);
        if (options.handlerId !== undefined) search.set("handlerId", options.handlerId);
        const query = search.size === 0 ? "" : `?${search.toString()}`;
        return request<EventDeliveryListDto>(`/jobs${query}`);
      },
      get: (deliveryId) => request<EventDeliveryDto>(`/jobs/${encodeURIComponent(deliveryId)}`),
      retry: (deliveryId) => request<EventDeliveryDto>(`/jobs/${encodeURIComponent(deliveryId)}/retry`, {
        method: "POST", body: json({}), csrf: true,
      }),
      run: () => request<EventWorkerCycleDto>("/jobs/run", { method: "POST", body: json({}), csrf: true }),
    },
    schema: {
      issueIds: (input) =>
        request<IssueSchemaIdsResponse>("/schema/ids", {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      getCurrent: () => request<SchemaRevisionEnvelopeDto | null>("/schema"),
      getDraft: () => request<SchemaDraftEnvelopeDto | null>("/schema/draft"),
      saveDraft: (input) =>
        request<SchemaDraftEnvelopeDto>("/schema/draft", {
          method: "PUT",
          body: json(input),
          csrf: true,
        }),
      preview: (input) =>
        request<SchemaPreviewDto>("/schema/preview", {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      apply: (input) =>
        request<SchemaRevisionEnvelopeDto>("/schema/apply", {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      exportManifest: () => request<SchemaManifestDto>("/schema/manifest"),
      importManifest: (input) =>
        request<SchemaDraftEnvelopeDto>("/schema/manifest", {
          method: "PUT",
          body: json(input),
          csrf: true,
        }),
      generateTypes: () => request<GeneratedTypesDto>("/schema/types"),
    },
    collections: {
      list: () => request<CollectionListDto>("/collections"),
    },
    documents: {
      list: (collectionId, listOptions = {}) => {
        const search = new URLSearchParams();
        if (listOptions.page !== undefined) {
          search.set("page", String(listOptions.page));
        }
        if (listOptions.pageSize !== undefined) {
          search.set("pageSize", String(listOptions.pageSize));
        }
        if (listOptions.state !== undefined) {
          search.set("state", listOptions.state);
        }
        const query = search.size === 0 ? "" : `?${search.toString()}`;
        return request<DocumentListDto>(`${documentPath(collectionId)}${query}`);
      },
      query: (collectionId, input) =>
        request<DocumentQueryResultDto>(`${documentPath(collectionId)}/query`, {
          method: "POST",
          body: json(input),
        }),
      get: (collectionId, documentId) =>
        request<DocumentRecordDto>(documentPath(collectionId, documentId)),
      create: (collectionId, input) =>
        request<DocumentRecordDto>(documentPath(collectionId), {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      update: (collectionId, documentId, input) =>
        request<DocumentRecordDto>(documentPath(collectionId, documentId), {
          method: "PATCH",
          body: json(input),
          csrf: true,
        }),
      delete: (collectionId, documentId, input) =>
        request<void>(documentPath(collectionId, documentId), {
          method: "DELETE",
          body: json(input),
          csrf: true,
        }),
      publish: (collectionId, documentId, input) =>
        request<DocumentRecordDto>(`${documentPath(collectionId, documentId)}/publish`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      unpublish: (collectionId, documentId, input) =>
        request<DocumentRecordDto>(`${documentPath(collectionId, documentId)}/unpublish`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      restore: (collectionId, documentId, input) =>
        request<DocumentRecordDto>(`${documentPath(collectionId, documentId)}/restore`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      purge: (collectionId, documentId, input) =>
        request<void>(`${documentPath(collectionId, documentId)}/purge`, {
          method: "DELETE",
          body: json(input),
          csrf: true,
        }),
      tree: (collectionId, parentId) => {
        const search = new URLSearchParams();
        if (parentId !== undefined) search.set("parentId", parentId ?? "");
        const query = search.size === 0 ? "" : `?${search.toString()}`;
        return request<DocumentTreeDto>(
          `/collections/${encodeURIComponent(collectionId)}/tree${query}`,
        );
      },
      move: (collectionId, documentId, input) =>
        request<MoveDocumentResultDto>(
          `${documentPath(collectionId, documentId)}/move`,
          { method: "POST", body: json(input), csrf: true },
        ),
      previewMove: (collectionId, documentId, input) =>
        request<MoveDocumentPreviewDto>(
          `${documentPath(collectionId, documentId)}/move/preview`,
          { method: "POST", body: json(input), csrf: true },
        ),
    },
    revisions: {
      list: (collectionId, documentId) =>
        request<DocumentRevisionListDto>(revisionPath(collectionId, documentId)),
      get: (collectionId, documentId, revisionId) =>
        request<DocumentRevisionDetailDto>(revisionPath(collectionId, documentId, revisionId)),
      restore: (collectionId, documentId, revisionId, input) =>
        request<DocumentRecordDto>(`${revisionPath(collectionId, documentId, revisionId)}/restore`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
    },
    content: {
      list: (collectionId, listOptions = {}) => {
        const search = new URLSearchParams();
        if (listOptions.page !== undefined) {
          search.set("page", String(listOptions.page));
        }
        if (listOptions.pageSize !== undefined) {
          search.set("pageSize", String(listOptions.pageSize));
        }
        const query = search.size === 0 ? "" : `?${search.toString()}`;
        return request<PublishedDocumentListDto>(`${contentPath(collectionId)}${query}`);
      },
      get: (collectionId, documentId) =>
        request<PublishedDocumentRecordDto>(contentPath(collectionId, documentId)),
    },
    media: {
      list: () => request<MediaListDto>("/media"),
      upload: (input) => request<MediaRecordDto>("/media", {
        method: "POST",
        body: input.file,
        headers: {
          "content-type": input.file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(input.fileName),
        },
        csrf: true,
      }),
      delete: (mediaId) => request<void>(`/media/${encodeURIComponent(mediaId)}`, {
        method: "DELETE",
        csrf: true,
      }),
      checkConsistency: () => request<MediaConsistencyReportDto>("/media/consistency", {
        method: "POST",
        csrf: true,
      }),
      contentUrl: (mediaId) => `${baseUrl}/media/${encodeURIComponent(mediaId)}/content`,
    },
    authorization: createAuthorizationClient(authorizationPath),
    identities: {
      list: (options = {}) => {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(options)) {
          if (value !== undefined) search.set(key, String(value));
        }
        const query = search.size === 0 ? "" : `?${search.toString()}`;
        return request<ManagedIdentityListDto>(`/identities${query}`);
      },
      get: (identityId) =>
        request<ManagedIdentityDto>(`/identities/${encodeURIComponent(identityId)}`),
      create: (input) => request<ManagedIdentityDto>("/identities", {
        method: "POST", body: json(input), csrf: true,
      }),
      update: (identityId, input) =>
        request<ManagedIdentityDto>(`/identities/${encodeURIComponent(identityId)}`, {
          method: "PATCH", body: json(input), csrf: true,
        }),
      disable: (identityId, input) =>
        request<ManagedIdentityDto>(`/identities/${encodeURIComponent(identityId)}/disable`, {
          method: "POST", body: json(input), csrf: true,
        }),
      reactivate: (identityId, input) =>
        request<ManagedIdentityDto>(`/identities/${encodeURIComponent(identityId)}/reactivate`, {
          method: "POST", body: json(input), csrf: true,
        }),
      resetCredentials: (identityId, input) =>
        request<ManagedIdentityDto>(`/identities/${encodeURIComponent(identityId)}/credentials/reset`, {
          method: "POST", body: json(input), csrf: true,
        }),
      createInvitation: (identityId, input) => request<CreatedCredentialTokenDto>(
        `/identities/${encodeURIComponent(identityId)}/invitations`,
        { method: "POST", body: json(input), csrf: true },
      ),
      createResetToken: (identityId, input) => request<CreatedCredentialTokenDto>(
        `/identities/${encodeURIComponent(identityId)}/credentials/reset-token`,
        { method: "POST", body: json(input), csrf: true },
      ),
      createSystemMembership: (identityId, input) => request<ManagedIdentityDto>(
        `/identities/${encodeURIComponent(identityId)}/system-membership`,
        { method: "POST", body: json(input), csrf: true },
      ),
      completeInvitation: (input) => request<void>("/credentials/setup", {
        method: "POST", body: json(input),
      }),
      completeReset: (input) => request<void>("/credentials/reset/complete", {
        method: "POST", body: json(input),
      }),
      listSessions: (identityId, options = {}) => {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(options)) {
          if (value !== undefined) search.set(key, String(value));
        }
        const query = search.size === 0 ? "" : `?${search.toString()}`;
        return request<ManagedSessionListDto>(
          `/identities/${encodeURIComponent(identityId)}/sessions${query}`,
        );
      },
      revokeSession: (sessionId) =>
        request<ManagedSessionDto>(`/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE", csrf: true,
        }),
      revokeAllSessions: (identityId) =>
        request<SessionRevocationResultDto>(`/identities/${encodeURIComponent(identityId)}/sessions/revoke`, {
          method: "POST", body: json({}), csrf: true,
        }),
      transferOwner: (input) => request<ManagedIdentityDto>("/owner/transfer", {
        method: "POST", body: json(input), csrf: true,
      }),
      createService: (input) => request<ManagedIdentityDto>("/service-identities", {
        method: "POST", body: json(input), csrf: true,
      }),
      listApiKeys: (identityId) => request<ApiKeyListDto>(
        `/service-identities/${encodeURIComponent(identityId)}/api-keys`,
      ),
      createApiKey: (identityId, input) => request<CreatedApiKeyDto>(
        `/service-identities/${encodeURIComponent(identityId)}/api-keys`,
        { method: "POST", body: json(input), csrf: true },
      ),
      revokeApiKey: (apiKeyId) => request<ApiKeyDto>(`/api-keys/${encodeURIComponent(apiKeyId)}`, {
        method: "DELETE", csrf: true,
      }),
    },
    identityRealms: {
      listGlobalIdentities: () => request<GlobalIdentityListDto>("/global-identities"),
      list: () => request<IdentityRealmListDto>(identityRealmPath()),
      get: (realmId) => request<IdentityRealmDto>(identityRealmPath(realmId)),
      create: (input) => request<IdentityRealmDto>(identityRealmPath(), {
        method: "POST",
        body: json(input),
        csrf: true,
      }),
      createProfileSchema: (realmId, input) => request<IdentityRealmDto>(
        `${identityRealmPath(realmId)}/profile-schema`,
        { method: "POST", body: json(input), csrf: true },
      ),
      createProfileField: (realmId, input) => request<IdentityRealmDto>(
        `${identityRealmPath(realmId)}/profile-fields`,
        { method: "POST", body: json(input), csrf: true },
      ),
      update: (realmId, input) => request<IdentityRealmDto>(identityRealmPath(realmId), {
        method: "PATCH",
        body: json(input),
        csrf: true,
      }),
      listMemberships: (realmId) =>
        request<RealmMembershipListDto>(`${identityRealmPath(realmId)}/memberships`),
      provisionMembership: (realmId, input) =>
        request<RealmMembershipDto>(`${identityRealmPath(realmId)}/memberships`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      registerMembership: (realmId, input) =>
        request<RealmMembershipDto>(`${identityRealmPath(realmId)}/memberships/register`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      grantRealmAdministrator: (realmId, membershipId, input) =>
        request<RealmMembershipDto>(
          `${identityRealmPath(realmId)}/memberships/${encodeURIComponent(membershipId)}/administrator`,
          {
            method: "POST",
            body: json(input),
            csrf: true,
          },
        ),
      suspendMembership: (realmId, membershipId, input) =>
        request<RealmMembershipDto>(
          `${identityRealmPath(realmId)}/memberships/${encodeURIComponent(membershipId)}`,
          {
            method: "PATCH",
            body: json({ ...input, status: "suspended" }),
            csrf: true,
          },
        ),
      reactivateMembership: (realmId, membershipId, input) =>
        request<RealmMembershipDto>(
          `${identityRealmPath(realmId)}/memberships/${encodeURIComponent(membershipId)}`,
          {
            method: "PATCH",
            body: json({ ...input, status: "active" }),
            csrf: true,
          },
        ),
      listFullAccess: (realmId) =>
        request<RealmFullAccessListDto>(`${identityRealmPath(realmId)}/full-access`),
      grantFullAccess: (realmId, input) =>
        request<RealmFullAccessBindingDto>(`${identityRealmPath(realmId)}/full-access`, {
          method: "POST",
          body: json(input),
          csrf: true,
        }),
      revokeFullAccess: (realmId, bindingId, input) =>
        request<RealmFullAccessBindingDto>(
          `${identityRealmPath(realmId)}/full-access/${encodeURIComponent(bindingId)}`,
          {
            method: "DELETE",
            body: json(input),
            csrf: true,
          },
        ),
      authorizationFor: (realmId) => createAuthorizationClient((kind, id) =>
        `${identityRealmPath(realmId)}/authorization${kind === undefined ? "" : `/${kind}`}${
          id === undefined ? "" : `/${encodeURIComponent(id)}`
        }`),
    },
    contentRealms: {
      forRealm: createContentRealmClient,
    },
  };
}

function normalizeBaseUrl(value: string): string {
  if (value === "") {
    return "";
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function queryString(value: object): string {
  const search = new URLSearchParams();
  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined) search.set(key, String(member));
  }
  return search.size === 0 ? "" : `?${search.toString()}`;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function fallbackProblem(response: Response, payload: unknown): ProblemDetails {
  const detail =
    typeof payload === "string" && payload.length > 0
      ? payload
      : `XeCMS request failed with HTTP ${response.status}.`;
  return {
    type: "about:blank",
    title: response.statusText || "Request failed",
    status: response.status,
    detail,
    code: "HTTP_ERROR",
    requestId: response.headers.get("x-request-id") ?? "unknown",
  };
}

function hasCsrfToken(value: unknown): value is { readonly csrfToken: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "csrfToken" in value &&
    typeof value.csrfToken === "string"
  );
}
