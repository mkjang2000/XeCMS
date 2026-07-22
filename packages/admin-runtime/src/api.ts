import type {
  AdminAppRuntimeDto,
  ContentSessionDto,
  DocumentQueryRequest,
  DocumentQueryResultDto,
  DocumentRecordDto,
  DocumentRevisionListDto,
  ProblemDetails,
  SessionDto,
} from "@xecms/contracts";

export class AdminRuntimeApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly problem?: ProblemDetails,
  ) {
    super(message);
    this.name = "AdminRuntimeApiError";
  }
}

export interface AdminRuntimeDataClient {
  query(collectionId: string, input: DocumentQueryRequest): Promise<DocumentQueryResultDto>;
  get(collectionId: string, documentId: string): Promise<DocumentRecordDto>;
  create(collectionId: string, data: Readonly<Record<string, unknown>>): Promise<DocumentRecordDto>;
  update(
    collectionId: string,
    documentId: string,
    data: Readonly<Record<string, unknown>>,
    expectedVersion: number,
  ): Promise<DocumentRecordDto>;
  publish(collectionId: string, documentId: string, expectedVersion: number): Promise<DocumentRecordDto>;
  unpublish(collectionId: string, documentId: string, expectedVersion: number): Promise<DocumentRecordDto>;
  delete(collectionId: string, documentId: string, expectedVersion: number): Promise<void>;
  restore(collectionId: string, documentId: string, expectedVersion: number): Promise<DocumentRecordDto>;
  revisions(collectionId: string, documentId: string): Promise<DocumentRevisionListDto>;
  restoreRevision(collectionId: string, documentId: string, revisionId: string, expectedVersion: number): Promise<DocumentRecordDto>;
  logout(): Promise<void>;
}

export async function loadAdminAppRuntime(appKey: string): Promise<AdminAppRuntimeDto> {
  return request(`/api/admin-apps/runtime/${encodeURIComponent(appKey)}`);
}

export function createAdminRuntimeDataClient(runtime: AdminAppRuntimeDto): AdminRuntimeDataClient {
  const realmKey = runtime.user.realmKey;
  const prefix = realmKey === undefined
    ? "/api"
    : `/api/content-realms/${encodeURIComponent(realmKey)}`;
  let csrfToken: string | undefined;

  const csrf = async (): Promise<string> => {
    if (csrfToken !== undefined) return csrfToken;
    const session = realmKey === undefined
      ? await request<SessionDto>("/api/auth/session")
      : await request<ContentSessionDto>(`${prefix}/session`);
    const token = "csrfToken" in session ? session.csrfToken : undefined;
    if (token === undefined) throw new AdminRuntimeApiError(401, "SESSION_REQUIRED", "로그인이 필요합니다.");
    csrfToken = token;
    return token;
  };

  return {
    query: (collectionId, input) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/query`,
      { method: "POST", body: JSON.stringify(input) },
    ),
    get: (collectionId, documentId) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
    ),
    create: async (collectionId, data) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents`,
      {
        method: "POST",
        headers: { "x-csrf-token": await csrf() },
        body: JSON.stringify({ data }),
      },
    ),
    update: async (collectionId, documentId, data, expectedVersion) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
      {
        method: "PATCH",
        headers: { "x-csrf-token": await csrf() },
        body: JSON.stringify({ data, expectedVersion }),
      },
    ),
    publish: async (collectionId, documentId, expectedVersion) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/publish`,
      { method: "POST", headers: { "x-csrf-token": await csrf() }, body: JSON.stringify({ expectedVersion }) },
    ),
    unpublish: async (collectionId, documentId, expectedVersion) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/unpublish`,
      { method: "POST", headers: { "x-csrf-token": await csrf() }, body: JSON.stringify({ expectedVersion }) },
    ),
    delete: async (collectionId, documentId, expectedVersion) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE", headers: { "x-csrf-token": await csrf() }, body: JSON.stringify({ expectedVersion }) },
    ),
    restore: async (collectionId, documentId, expectedVersion) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/restore`,
      { method: "POST", headers: { "x-csrf-token": await csrf() }, body: JSON.stringify({ expectedVersion }) },
    ),
    revisions: (collectionId, documentId) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/revisions`,
    ),
    restoreRevision: async (collectionId, documentId, revisionId, expectedVersion) => request(
      `${prefix}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: "POST", headers: { "x-csrf-token": await csrf() }, body: JSON.stringify({ expectedVersion }) },
    ),
    logout: async () => request(
      realmKey === undefined ? "/api/auth/logout" : `${prefix}/logout`,
      { method: "POST", headers: { "x-csrf-token": await csrf() } },
    ),
  };
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch (error: unknown) {
    throw new AdminRuntimeApiError(
      0,
      "NETWORK_ERROR",
      error instanceof Error ? error.message : "API 서버에 연결할 수 없습니다.",
    );
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as ProblemDetails | null;
    throw new AdminRuntimeApiError(
      response.status,
      problem?.code ?? "HTTP_ERROR",
      problem?.detail ?? `요청이 실패했습니다 (${response.status}).`,
      problem ?? undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
