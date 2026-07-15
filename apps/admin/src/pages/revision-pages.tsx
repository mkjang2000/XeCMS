import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import {
  documentRevisionOriginLabel,
  toAdminApiError,
  useAdminApi,
  type DocumentRevisionSummary,
} from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, EmptyState } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { DocumentStatus } from "../components/document-status.js";
import { Page, PageHeader } from "../components/page.js";
import { documentTitle, formatAdminDate } from "../document-presentation.js";
import { queryKeys } from "../queries.js";

function RevisionFlags({ revision }: { readonly revision: DocumentRevisionSummary }) {
  if (!revision.isCurrentDraft && !revision.isPublished) return null;
  return (
    <span className={styles.revisionFlags}>
      {revision.isCurrentDraft ? <Badge tone="info">현재 초안</Badge> : null}
      {revision.isPublished ? <Badge tone="success">현재 게시 버전</Badge> : null}
    </span>
  );
}

function RevisionOrigin({ revision }: { readonly revision: DocumentRevisionSummary }) {
  return (
    <span className={styles.revisionOrigin}>
      <span>{documentRevisionOriginLabel(revision.origin)}</span>
      {revision.origin.kind === "restore" ? (
        <code>원본 {revision.origin.restoredFromRevisionId}</code>
      ) : null}
    </span>
  );
}

export function RevisionHistoryPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const { collectionId = "", documentId = "" } = useParams();
  const collection = useQuery({
    queryKey: queryKeys.collectionApplied(collectionId),
    queryFn: () => api.collections.getApplied(collectionId),
  });
  const document = useQuery({
    queryKey: queryKeys.document(collectionId, documentId),
    queryFn: () => api.documents.get(collectionId, documentId),
  });
  const revisions = useQuery({
    queryKey: queryKeys.revisions(collectionId, documentId),
    queryFn: () => api.revisions.list(collectionId, documentId),
  });

  if (collection.isPending || document.isPending || revisions.isPending) {
    return <Page><PageLoading label="버전 기록을 불러오는 중" /></Page>;
  }
  if (collection.isError) return <Page><LoadError error={collection.error} onRetry={() => void collection.refetch()} /></Page>;
  if (document.isError) return <Page><LoadError error={document.error} onRetry={() => void document.refetch()} /></Page>;
  if (revisions.isError) return <Page><LoadError error={revisions.error} onRetry={() => void revisions.refetch()} /></Page>;

  const title = documentTitle(document.data, collection.data);
  return (
    <Page>
      <PageHeader
        eyebrow="Revision history"
        title={`${title} 버전 기록`}
        description={`${revisions.data.items.length}개 버전 · 현재 문서 버전 ${revisions.data.documentVersion}`}
        actions={(
          <Button variant="secondary" onPress={() => navigate(`/admin/content/${collectionId}/${documentId}`)}>
            문서 편집으로
          </Button>
        )}
      />
      <div className={styles.documentMeta}>
        <DocumentStatus state={document.data.displayState} announce />
        <span>문서 ID {document.data.id}</span>
      </div>
      {revisions.data.items.length === 0 ? (
        <EmptyState title="버전 기록이 없습니다" description="문서를 저장하면 버전 기록이 생성됩니다." />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>{title} 버전 기록</caption>
            <thead>
              <tr>
                <th scope="col">버전</th>
                <th scope="col">생성 이유</th>
                <th scope="col">상태</th>
                <th scope="col">생성 정보</th>
                <th scope="col">미리보기</th>
              </tr>
            </thead>
            <tbody>
              {revisions.data.items.map((revision) => (
                <tr key={revision.id}>
                  <td><strong>버전 {revision.sequence}</strong></td>
                  <td><RevisionOrigin revision={revision} /></td>
                  <td><RevisionFlags revision={revision} /></td>
                  <td>
                    <span className={styles.revisionCreated}>
                      <span>{formatAdminDate(revision.createdAt)}</span>
                      <span>{revision.createdBy}</span>
                    </span>
                  </td>
                  <td>
                    <Link to={`/admin/content/${collectionId}/${documentId}/revisions/${revision.id}`}>
                      버전 {revision.sequence} 미리보기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

export function RevisionPreviewPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { collectionId = "", documentId = "", revisionId = "" } = useParams();
  const [showRestore, setShowRestore] = useState(false);
  const collection = useQuery({
    queryKey: queryKeys.collectionApplied(collectionId),
    queryFn: () => api.collections.getApplied(collectionId),
  });
  const document = useQuery({
    queryKey: queryKeys.document(collectionId, documentId),
    queryFn: () => api.documents.get(collectionId, documentId),
  });
  const revisions = useQuery({
    queryKey: queryKeys.revisions(collectionId, documentId),
    queryFn: () => api.revisions.list(collectionId, documentId),
  });
  const revision = useQuery({
    queryKey: queryKeys.revision(collectionId, documentId, revisionId),
    queryFn: () => api.revisions.get(collectionId, documentId, revisionId),
  });
  const restore = useMutation({
    mutationFn: () => api.revisions.restore(
      collectionId,
      documentId,
      revisionId,
      { expectedVersion: revisions.data!.documentVersion },
    ),
    onSuccess: async (saved) => {
      setShowRestore(false);
      queryClient.setQueryData(queryKeys.document(collectionId, documentId), saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.revisionsRoot(collectionId, documentId) }),
      ]);
      navigate(`/admin/content/${collectionId}/${documentId}`);
    },
    onError: () => setShowRestore(false),
  });

  const reloadLatest = async () => {
    restore.reset();
    await Promise.all([document.refetch(), revisions.refetch(), revision.refetch()]);
  };
  const restoreError = restore.isError ? toAdminApiError(restore.error) : null;
  const isVersionConflict = restoreError?.code === "DOCUMENT_VERSION_CONFLICT";

  if (collection.isPending || document.isPending || revisions.isPending || revision.isPending) {
    return <Page><PageLoading label="버전 미리보기를 불러오는 중" /></Page>;
  }
  if (collection.isError) return <Page><LoadError error={collection.error} onRetry={() => void collection.refetch()} /></Page>;
  if (document.isError) return <Page><LoadError error={document.error} onRetry={() => void document.refetch()} /></Page>;
  if (revisions.isError) return <Page><LoadError error={revisions.error} onRetry={() => void revisions.refetch()} /></Page>;
  if (revision.isError) return <Page><LoadError error={revision.error} onRetry={() => void revision.refetch()} /></Page>;

  const title = documentTitle(document.data, collection.data);
  const canRestore = document.data.displayState !== "deleted" && document.data.displayState !== "archived";
  return (
    <Page>
      <PageHeader
        eyebrow="Revision snapshot"
        title={`${title} · 버전 ${revision.data.sequence}`}
        description={`${formatAdminDate(revision.data.createdAt)} · ${documentRevisionOriginLabel(revision.data.origin)}`}
        actions={(
          <>
            <Button
              variant="secondary"
              onPress={() => navigate(`/admin/content/${collectionId}/${documentId}/revisions`)}
            >
              버전 기록으로
            </Button>
            {canRestore ? (
              <Button isDisabled={restore.isPending} onPress={() => setShowRestore(true)}>
                새 초안으로 복원
              </Button>
            ) : null}
          </>
        )}
      />
      <div className={styles.documentMeta}>
        <DocumentStatus state={document.data.displayState} announce />
        <RevisionFlags revision={revision.data} />
      </div>
      {!canRestore ? (
        <Callout tone="warning">
          {document.data.displayState === "deleted"
            ? "휴지통에 있는 문서는 먼저 복원해야 과거 버전을 새 초안으로 만들 수 있습니다."
            : "보관된 문서는 보관 상태를 해제해야 과거 버전을 새 초안으로 만들 수 있습니다."}
        </Callout>
      ) : null}
      {isVersionConflict ? <ConflictNotice onReload={() => void reloadLatest()} /> : null}
      {restoreError && !isVersionConflict ? <LoadError error={restoreError} /> : null}
      <section className={styles.snapshotCard} aria-labelledby="revision-snapshot-heading">
        <div className={styles.snapshotHeader}>
          <div>
            <h2 id="revision-snapshot-heading">저장된 데이터 스냅샷</h2>
            <p>이 화면은 읽기 전용이며 현재 편집 중인 문서에는 영향을 주지 않습니다.</p>
          </div>
          <code>{revision.data.id}</code>
        </div>
        <pre className={styles.snapshot} aria-label={`버전 ${revision.data.sequence} JSON 미리보기`}>
          <code>{JSON.stringify(revision.data.data, null, 2)}</code>
        </pre>
      </section>
      {showRestore && canRestore ? (
        <ConfirmDialog
          title="버전 복원"
          confirmLabel="새 초안으로 복원"
          isPending={restore.isPending}
          onCancel={() => setShowRestore(false)}
          onConfirm={() => restore.mutate()}
        >
          버전 {revision.data.sequence}의 데이터를 새 초안으로 복원합니다. 현재 게시 중인 버전은 변경되지 않으며,
          복원 결과도 새로운 버전 기록으로 남습니다.
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}
