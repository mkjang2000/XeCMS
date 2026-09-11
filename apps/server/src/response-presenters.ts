import {
  ApplicationError,
  DocumentApplicationService,
  type ActorContext,
  type ContentHierarchyQueryResult,
  type DocumentRecord,
  type MediaRecord,
} from "@xecms/application";
import type {
  CollectionListDto,
  DocumentRecordDto,
  DocumentTreeDto,
  IncompleteMediaRecordDto,
  MediaRecordDto,
  ProblemDetails,
  SchemaRevisionEnvelopeDto,
  WorkspaceSettingsDto,
} from "@xecms/contracts";
import { type CollectionDefinition } from "@xecms/schema";

export function workspaceSettingsDto(value: {
  readonly id: string; readonly displayName: string; readonly defaultTimezone: string;
  readonly adminLocale: string; readonly revision: number; readonly updatedAt: string;
  readonly updatedBy: string;
}): WorkspaceSettingsDto {
  return { workspaceId: value.id, displayName: value.displayName,
    defaultTimezone: value.defaultTimezone, adminLocale: value.adminLocale,
    revision: value.revision, updatedAt: value.updatedAt, updatedBy: value.updatedBy };
}

export function revisionDto(revision: {
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly schema: SchemaRevisionEnvelopeDto["schema"];
  readonly createdAt: string;
  readonly createdBy: string;
}): SchemaRevisionEnvelopeDto {
  return {
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    schema: revision.schema,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
  };
}

export function collectionList(
  active: { readonly revisionId: string; readonly schema: { readonly collections: readonly CollectionDefinition[] } } | null,
  draft: { readonly schema: { readonly collections: readonly CollectionDefinition[] } } | null,
): CollectionListDto {
  const activeById = new Map(active?.schema.collections.map((collection) => [collection.id, collection]) ?? []);
  const draftById = new Map(draft?.schema.collections.map((collection) => [collection.id, collection]) ?? []);
  const ids = new Set([...activeById.keys(), ...draftById.keys()]);
  return {
    items: [...ids].map((id) => {
      const applied = activeById.get(id);
      const pending = draftById.get(id);
      const collection = applied ?? pending;
      if (collection === undefined) {
        throw new Error("Collection overlay is inconsistent.");
      }
      const hasPendingChanges =
        draft !== null &&
        (applied === undefined || pending === undefined || JSON.stringify(applied) !== JSON.stringify(pending));
      return {
        id: collection.id,
        name: collection.name,
        ...(collection.label === undefined ? {} : { label: collection.label }),
        ...(collection.auth === undefined ? {} : { authRealmKey: collection.auth.realmKey }),
        kind: collection.kind ?? "collection",
        ...(collection.hierarchy === undefined ? {} : {
          hierarchy: {
            enabled: collection.hierarchy.enabled,
            ordering: collection.hierarchy.ordering ?? "manual",
            permissionInheritance: collection.hierarchy.permissionInheritance === true,
          },
        }),
        fields: collection.fields.map((field) => ({
          id: field.id,
          name: field.name,
          ...(field.label === undefined ? {} : { label: field.label }),
          type: field.type,
          required: field.required === true,
          ...(field.sensitivity === undefined ? {} : { sensitivity: field.sensitivity }),
        })),
        status: applied === undefined ? "draft" as const : "applied" as const,
        hasPendingChanges,
        revisionId: applied === undefined ? null : active?.revisionId ?? null,
      };
    }),
  };
}

export async function presentTree(
  actor: ActorContext,
  collectionId: string,
  result: ContentHierarchyQueryResult,
  documents: DocumentApplicationService,
): Promise<DocumentTreeDto> {
  if (result.items.length > 1_000) {
    throw new ApplicationError(
      "HIERARCHY_QUERY_TOO_LARGE",
      413,
      "A synchronous hierarchy response is limited to 1000 nodes.",
      { details: { limit: 1_000, actual: result.items.length } },
    );
  }
  const byId = new Map(result.items.map((position) => [String(position.documentId), position]));
  const childrenByParent = new Map<string, typeof result.items[number][]>();
  for (const position of result.items) {
    const parentKey = position.parentId === null ? "" : String(position.parentId);
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(position);
    childrenByParent.set(parentKey, siblings);
  }
  childrenByParent.forEach((siblings) => siblings.sort((left, right) => left.sortKey - right.sortKey));
  const orderedPositions: typeof result.items[number][] = [];
  const appendSubtree = (position: typeof result.items[number]): void => {
    orderedPositions.push(position);
    (childrenByParent.get(String(position.documentId)) ?? []).forEach(appendSubtree);
  };
  result.items
    .filter((position) => position.parentId === null || !byId.has(String(position.parentId)))
    .sort((left, right) => left.sortKey - right.sortKey)
    .forEach(appendSubtree);
  const readableEntries = await Promise.all(orderedPositions.map(async (position) => {
    const documentId = String(position.documentId);
    try {
      return [documentId, await documents.get(actor, collectionId, documentId)] as const;
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.status === 403) return null;
      throw error;
    }
  }));
  const readable = new Map(readableEntries.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  ));
  const items = orderedPositions.flatMap((position) => {
    const documentId = String(position.documentId);
    const document = readable.get(documentId);
    if (document === undefined) return [];
    const path: string[] = [documentId];
    let cursor = position.parentId === null ? null : String(position.parentId);
    const visited = new Set(path);
    while (cursor !== null && readable.has(cursor) && !visited.has(cursor)) {
      path.unshift(cursor);
      visited.add(cursor);
      const parent = byId.get(cursor);
      cursor = parent?.parentId === null || parent?.parentId === undefined
        ? null
        : String(parent.parentId);
    }
    const visibleParentId = position.parentId !== null && readable.has(String(position.parentId))
      ? String(position.parentId)
      : null;
    return {
      document,
      parentId: visibleParentId,
      position: position.sortKey,
      depth: path.length - 1,
      path,
      hasChildren: result.items.some((candidate) =>
        candidate.parentId !== null &&
        String(candidate.parentId) === documentId &&
        readable.has(String(candidate.documentId))),
    };
  });
  return { version: result.version, items };
}

export function mediaRecordDto(record: MediaRecord, missing: boolean): MediaRecordDto {
  if (record.status !== "ready" || record.size === null || record.sha256 === null) {
    throw new ApplicationError("MEDIA_NOT_READY", 500, `Media '${record.id}' is not ready.`);
  }
  return {
    id: record.id,
    fileName: record.originalFileName,
    mimeType: record.mimeType,
    size: record.size,
    checksum: record.sha256,
    storageKey: record.storageKey,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    status: missing ? "missing" : "available",
  };
}

export function incompleteMediaRecordDto(record: MediaRecord): IncompleteMediaRecordDto {
  if (record.status === "ready") {
    throw new ApplicationError("MEDIA_RECORD_STATE_INVALID", 500, `Media '${record.id}' is ready.`);
  }
  return {
    id: record.id,
    fileName: record.originalFileName,
    mimeType: record.mimeType,
    storageKey: record.storageKey,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    status: record.status,
    ...(record.failureReason === undefined ? {} : { failureReason: record.failureReason }),
  };
}

export function documentDto(document: DocumentRecord): DocumentRecordDto {
  return {
    id: document.id,
    collectionId: document.collectionId,
    data: document.data,
    version: document.version,
    displayState: document.displayState,
    draftRevisionId: document.draftRevisionId,
    publication: document.publication,
    deletion: document.deletion,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function problemDetails(error: Error, requestId: string): ProblemDetails {
  if (error instanceof ApplicationError) {
    return {
      type: `urn:xecms:error:${error.code.toLocaleLowerCase("en-US")}`,
      title: statusTitle(error.status),
      status: error.status,
      detail: error.message,
      code: error.code,
      requestId,
      ...(error.options.issues === undefined ? {} : { issues: error.options.issues }),
      ...(error.options.details === undefined ? {} : { details: error.options.details }),
    };
  }
  const status = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  return {
    type: `urn:xecms:error:${status >= 500 ? "internal-server-error" : "request-invalid"}`,
    title: statusTitle(status),
    status,
    detail: status >= 500 ? "An unexpected server error occurred." : error.message,
    code: status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_INVALID",
    requestId,
  };
}

export function statusTitle(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Content";
    case 429:
      return "Too Many Requests";
    default:
      return status >= 500 ? "Internal Server Error" : "Request Failed";
  }
}
