import type { AdminRuntimeDataClient } from "@xecms/admin-runtime";
import { resolvePreviewQuery, type PreviewQueryParameterValue } from "@xecms/admin-runtime";
import type { ComposedPageDefinition } from "@xecms/admin-apps";
import type {
  ComposedDocumentDto,
  ComposedQueryResultDto,
  DocumentRecordDto,
} from "@xecms/client";

import { xecmsClient } from "../../xecms-client.js";

/** Thrown when Preview attempts a mutation — the editor Preview is read-only. */
export class PreviewMutationBlocked extends Error {
  public constructor() {
    super("미리보기에서는 데이터를 저장할 수 없습니다. 저장 후 실행 화면에서 확인하세요.");
    this.name = "PreviewMutationBlocked";
  }
}

const notSupported = (): never => {
  throw new Error("이 동작은 미리보기에서 지원하지 않습니다.");
};

/**
 * A data client for the editor Preview. Unlike the real Runtime client (which
 * resolves queries from the APPLIED manifest server-side), this resolves each
 * Data Source from the EDITING (unsaved) page client-side, then calls the plain
 * content query API — so the Preview reflects unsaved layout/wiring against real
 * data without an apply. Reads pass through; mutations are blocked (Preview never
 * writes). All content endpoints still enforce masking and permissions server-side.
 */
export function createPreviewDataClient(pages: readonly ComposedPageDefinition[]): AdminRuntimeDataClient {
  const pageById = new Map(pages.map((page) => [page.id, page]));

  const toRow = (record: DocumentRecordDto): { readonly id: string; readonly data: Readonly<Record<string, unknown>> } => ({
    id: record.id,
    data: record.data,
  });

  return {
    query: (collectionId, input) => xecmsClient.documents.query(collectionId, input),
    queryComposed: async (pageId, dataSourceId, input): Promise<ComposedQueryResultDto> => {
      const page = pageById.get(pageId);
      const dataSource = page?.dataSources.find((source) => source.id === dataSourceId);
      if (dataSource === undefined) return { items: [], hasNextPage: false };
      const request = resolvePreviewQuery(
        dataSource,
        (input.parameters ?? {}) as Readonly<Record<string, PreviewQueryParameterValue>>,
        input.cursor,
      );
      const result = await xecmsClient.documents.query(dataSource.collectionId, request);
      return {
        items: result.items.map(toRow),
        hasNextPage: result.hasNextPage,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
      };
    },
    getComposedDocument: async (_pageId, _componentId, input): Promise<ComposedDocumentDto | null> => {
      try {
        const record = await xecmsClient.documents.get(input.collectionId, input.documentId);
        return { id: record.id, data: record.data };
      } catch {
        return null;
      }
    },
    get: (collectionId, documentId) => xecmsClient.documents.get(collectionId, documentId),
    create: () => { throw new PreviewMutationBlocked(); },
    update: () => { throw new PreviewMutationBlocked(); },
    delete: () => { throw new PreviewMutationBlocked(); },
    publish: () => { throw new PreviewMutationBlocked(); },
    unpublish: () => { throw new PreviewMutationBlocked(); },
    restore: () => { throw new PreviewMutationBlocked(); },
    restoreRevision: () => { throw new PreviewMutationBlocked(); },
    move: () => { throw new PreviewMutationBlocked(); },
    uploadMedia: () => { throw new PreviewMutationBlocked(); },
    revisions: notSupported,
    tree: notSupported,
    previewMove: notSupported,
    listMedia: notSupported,
    mediaContentUrl: (mediaId) => `/api/media/${encodeURIComponent(mediaId)}/content`,
    logout: notSupported,
  };
}
