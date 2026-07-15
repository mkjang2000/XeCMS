import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import {
  calculateLastPage,
  parsePageParameter,
  toAdminApiError,
  useAdminApi,
  type DocumentRecord,
} from "@xecms/admin";
import { Button, Callout, ConfirmDialog, EmptyState, TextInput } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { CollectionWorkspaceNav } from "../components/collection-workspace-nav.js";
import { DocumentPagination } from "../components/document-pagination.js";
import { DocumentStatus } from "../components/document-status.js";
import { Page, PageHeader } from "../components/page.js";
import { documentTitle, formatAdminDate } from "../document-presentation.js";
import { queryKeys } from "../queries.js";

export function TrashPage() {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const { collectionId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get("page");
  const page = parsePageParameter(rawPage);
  const [purgeTarget, setPurgeTarget] = useState<DocumentRecord | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const collection = useQuery({
    queryKey: queryKeys.collectionApplied(collectionId),
    queryFn: () => api.collections.getApplied(collectionId),
  });
  const documents = useQuery({
    queryKey: queryKeys.documents(collectionId, page, "deleted"),
    queryFn: () => api.documents.list(collectionId, { page, pageSize: 25, state: "deleted" }),
  });
  const restore = useMutation({
    mutationFn: (target: DocumentRecord) => api.documents.restoreDeleted(
      collectionId,
      target.id,
      { expectedVersion: target.version },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
    },
  });
  const purge = useMutation({
    mutationFn: (target: DocumentRecord) => api.documents.purge(
      collectionId,
      target.id,
      { expectedVersion: target.version },
    ),
    onSuccess: async () => {
      setPurgeTarget(null);
      setPurgeConfirmation("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
    },
    onError: () => {
      // Keep an error visible outside the modal and discard the target's stale
      // aggregate version. The user can reload the list and explicitly choose
      // the current row before attempting purge again.
      setPurgeTarget(null);
      setPurgeConfirmation("");
    },
  });

  useEffect(() => {
    if (rawPage !== null && page === 1 && rawPage !== "1") {
      setSearchParams({}, { replace: true });
      return;
    }
    if (documents.data && documents.data.total > 0 && documents.data.items.length === 0 && page > 1) {
      const lastPage = calculateLastPage(documents.data.total, documents.data.pageSize);
      setSearchParams(lastPage === 1 ? {} : { page: String(lastPage) }, { replace: true });
    }
  }, [documents.data, page, rawPage, setSearchParams]);

  const mutationError = restore.isError
    ? toAdminApiError(restore.error)
    : purge.isError
      ? toAdminApiError(purge.error)
      : null;
  const isVersionConflict = mutationError?.code === "DOCUMENT_VERSION_CONFLICT";
  const reloadLatest = async () => {
    setPurgeTarget(null);
    setPurgeConfirmation("");
    restore.reset();
    purge.reset();
    await documents.refetch();
  };

  if (collection.isPending || documents.isPending) return <Page><PageLoading label="휴지통을 불러오는 중" /></Page>;
  if (collection.isError) return <Page><LoadError error={collection.error} onRetry={() => void collection.refetch()} /></Page>;
  if (documents.isError) return <Page><LoadError error={documents.error} onRetry={() => void documents.refetch()} /></Page>;

  const busy = restore.isPending || purge.isPending;
  return (
    <Page>
      <PageHeader
        eyebrow="Content trash"
        title={`${collection.data.label || collection.data.name} 휴지통`}
        description={`삭제된 문서 ${documents.data.total}개`}
      />
      <CollectionWorkspaceNav collectionId={collectionId} />
      <Callout tone="warning">
        삭제된 문서는 공개되지 않지만 버전 기록과 참조가 유지됩니다. 영구 삭제는 되돌릴 수 없습니다.
      </Callout>
      {isVersionConflict ? <ConflictNotice onReload={() => void reloadLatest()} /> : null}
      {mutationError && !isVersionConflict ? <LoadError error={mutationError} /> : null}
      {documents.data.items.length === 0 ? (
        <EmptyState title="휴지통이 비어 있습니다" description="삭제한 문서가 이곳에 표시됩니다." />
      ) : (
        <div className={styles.tableWrap} aria-busy={busy}>
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>{collection.data.label || collection.data.name} 휴지통 문서 목록</caption>
            <thead>
              <tr>
                <th scope="col">문서</th>
                <th scope="col">상태</th>
                <th scope="col">삭제 정보</th>
                <th scope="col">작업</th>
              </tr>
            </thead>
            <tbody>
              {documents.data.items.map((item) => {
                const title = documentTitle(item, collection.data);
                return (
                  <tr key={item.id}>
                    <td>
                      <strong className={styles.documentTitle}>{title}</strong>
                      <span className={styles.documentId}>{item.id}</span>
                    </td>
                    <td><DocumentStatus state={item.displayState} /></td>
                    <td>
                      {item.deletion ? (
                        <span className={styles.deletionMeta}>
                          <span>{formatAdminDate(item.deletion.deletedAt)}</span>
                          <span>{item.deletion.deletedBy}</span>
                          {item.deletion.reason ? <span>{item.deletion.reason}</span> : null}
                        </span>
                      ) : "삭제 정보 없음"}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <Button
                          size="small"
                          variant="secondary"
                          aria-label={`${title} 복원`}
                          isDisabled={busy}
                          onPress={() => {
                            purge.reset();
                            restore.mutate(item);
                          }}
                        >
                          복원
                        </Button>
                        <Button
                          size="small"
                          variant="danger"
                          aria-label={`${title} 영구 삭제`}
                          isDisabled={busy}
                          onPress={() => {
                            restore.reset();
                            purge.reset();
                            setPurgeConfirmation("");
                            setPurgeTarget(item);
                          }}
                        >
                          영구 삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <DocumentPagination
        page={documents.data.page}
        pageSize={documents.data.pageSize}
        total={documents.data.total}
        onChange={(nextPage) => setSearchParams(nextPage <= 1 ? {} : { page: String(nextPage) })}
      />
      {purgeTarget ? (
        <ConfirmDialog
          title="문서 영구 삭제"
          confirmLabel="영구 삭제"
          danger
          isPending={purge.isPending}
          isConfirmDisabled={purgeConfirmation !== purgeTarget.id}
          onCancel={() => {
            setPurgeTarget(null);
            setPurgeConfirmation("");
          }}
          onConfirm={() => purge.mutate(purgeTarget)}
        >
          <div className={styles.purgeConfirmation}>
            <p>문서와 모든 버전 기록을 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.</p>
            <code>{purgeTarget.id}</code>
            <TextInput
              label="확인을 위해 문서 ID 입력"
              description="위 문서 ID를 정확히 입력해야 영구 삭제할 수 있습니다."
              value={purgeConfirmation}
              onChange={setPurgeConfirmation}
              autoFocus
            />
          </div>
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}
