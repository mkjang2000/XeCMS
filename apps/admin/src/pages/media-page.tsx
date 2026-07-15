import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout, ConfirmDialog, EmptyState } from "@xecms/ui";
import { toAdminApiError, useAdminApi, type MediaRecord } from "@xecms/admin";
import styles from "../app.module.css";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function MediaPage() {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File>();
  const [deleteTarget, setDeleteTarget] = useState<MediaRecord>();
  const list = useQuery({ queryKey: queryKeys.media, queryFn: () => api.media.list() });
  const consistency = useMutation({ mutationFn: () => api.media.checkConsistency() });
  const upload = useMutation({
    mutationFn: (file: File) => api.media.upload(file),
    onSuccess: async () => {
      setSelectedFile(undefined);
      if (inputRef.current) inputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: queryKeys.media });
    },
  });
  const remove = useMutation({
    mutationFn: (mediaId: string) => api.media.delete(mediaId),
    onSuccess: async () => {
      setDeleteTarget(undefined);
      await queryClient.invalidateQueries({ queryKey: queryKeys.media });
    },
    onError: () => setDeleteTarget(undefined),
  });
  const uploadError = upload.isError ? toAdminApiError(upload.error) : null;
  const removeError = remove.isError ? toAdminApiError(remove.error) : null;

  return (
    <Page>
      <PageHeader
        eyebrow="Asset workspace"
        title="미디어 라이브러리"
        description="로컬 스토리지에 파일을 스트리밍 업로드하고 콘텐츠의 upload 필드에서 stable ID로 연결합니다."
        actions={<Button variant="secondary" onPress={() => consistency.mutate()} isDisabled={consistency.isPending}>{consistency.isPending ? "검사 중…" : "일관성 검사"}</Button>}
      />
      <section className={styles.mediaUploadCard} aria-label="미디어 업로드">
        <label className={styles.filePicker}>
          <span className={styles.mediaUploadIcon}><Icon name="media" size={22} /></span>
          <span><strong>{selectedFile?.name ?? "업로드할 파일 선택"}</strong><small>{selectedFile ? `${selectedFile.type || "application/octet-stream"} · ${formatBytes(selectedFile.size)}` : "크기와 MIME 정책은 서버에서 다시 검증합니다."}</small></span>
          <input ref={inputRef} type="file" onChange={(event) => setSelectedFile(event.target.files?.[0])} />
        </label>
        <Button onPress={() => selectedFile && upload.mutate(selectedFile)} isDisabled={!selectedFile || upload.isPending}>{upload.isPending ? "업로드 중…" : "파일 업로드"}</Button>
      </section>
      {uploadError ? <LoadError error={uploadError} /> : null}
      {removeError ? <LoadError error={removeError} /> : null}
      {consistency.isError ? <LoadError error={consistency.error} /> : null}
      {consistency.data ? (
        <Callout tone={consistency.data.missing.length || consistency.data.orphanStorageKeys.length || consistency.data.incomplete.length ? "warning" : "success"}>
          정상 {consistency.data.healthyCount}개 · 누락 파일 {consistency.data.missing.length}개 · 고아 파일 {consistency.data.orphanStorageKeys.length}개 · 미완료 메타데이터 {consistency.data.incomplete.length}개
          {consistency.data.missing.length ? ` · 누락 ID: ${consistency.data.missing.map(({ id }) => id).join(", ")}` : ""}
          {consistency.data.orphanStorageKeys.length ? ` · 고아 key: ${consistency.data.orphanStorageKeys.join(", ")}` : ""}
          {consistency.data.incomplete.length ? ` · 미완료 ID: ${consistency.data.incomplete.map(({ id }) => id).join(", ")}` : ""}
        </Callout>
      ) : null}
      {list.isPending ? <PageLoading label="미디어를 불러오는 중" /> : null}
      {list.isError ? <LoadError error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data?.items.length === 0 ? <EmptyState title="아직 업로드한 파일이 없습니다" description="첫 파일을 업로드하면 콘텐츠 편집기에서 바로 선택할 수 있습니다." /> : null}
      {list.data?.items.length ? (
        <div className={styles.mediaGrid}>
          {list.data.items.map((item) => (
            <article key={item.id} className={styles.mediaCard}>
              <div className={styles.mediaPreview}>
                {item.mimeType.startsWith("image/") && item.status === "available"
                  ? <img src={item.contentUrl} alt="" loading="lazy" />
                  : <Icon name="media" size={30} />}
              </div>
              <div className={styles.mediaInfo}>
                <div className={styles.mediaTitle}><strong title={item.fileName}>{item.fileName}</strong><Badge tone={item.status === "available" ? "success" : "warning"}>{item.status === "available" ? "사용 가능" : "파일 누락"}</Badge></div>
                <span>{item.mimeType} · {formatBytes(item.size)}</span>
                <code>{item.id}</code>
              </div>
              <div className={styles.mediaActions}>
                <a href={item.contentUrl} target="_blank" rel="noreferrer">원본 열기</a>
                <Button variant="quiet" size="small" onPress={() => setDeleteTarget(item)}>삭제</Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog title="미디어 삭제" confirmLabel="삭제" danger isPending={remove.isPending} onCancel={() => setDeleteTarget(undefined)} onConfirm={() => remove.mutate(deleteTarget.id)}>
          <strong>{deleteTarget.fileName}</strong> 파일을 삭제합니다. 콘텐츠에서 참조 중이면 서버 정책에 따라 삭제가 차단됩니다.
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}
