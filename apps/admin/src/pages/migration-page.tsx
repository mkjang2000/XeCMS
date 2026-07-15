import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, CheckboxField, EmptyState } from "@xecms/ui";
import { toAdminApiError, useAdminApi, type MigrationChange } from "@xecms/admin";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";

const severityLabel = { safe: "안전", risky: "주의", destructive: "파괴적" } as const;

function ChangeItem({ change }: { readonly change: MigrationChange }) {
  const severityClass = change.severity === "destructive"
    ? styles.severityDestructive
    : change.severity === "risky" ? styles.severityRisky : "";
  return (
    <li className={styles.change}>
      <span className={`${styles.severity} ${severityClass}`}>{severityLabel[change.severity]}</span>
      <div>
        <p>{change.description}</p>
        <div className={styles.changePath}>{change.path.join(" › ")}</div>
      </div>
    </li>
  );
}

export function MigrationPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { collectionId = "" } = useParams();
  const [approved, setApproved] = useState(false);
  const collection = useQuery({
    queryKey: queryKeys.collectionDraft(collectionId),
    queryFn: () => api.collections.get(collectionId),
  });
  const preview = useQuery({
    queryKey: queryKeys.migration(collectionId, collection.data?.draftVersion ?? "none"),
    queryFn: () => api.collections.preview(collectionId, { expectedDraftVersion: collection.data!.draftVersion }),
    enabled: collection.data !== undefined,
  });
  const apply = useMutation({
    mutationFn: () => api.collections.apply(collectionId, {
      planId: preview.data!.planId,
      expectedDraftVersion: preview.data!.draftVersion,
      approveDestructive: preview.data!.destructive && approved,
    }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.collectionDraft(collectionId), updated);
      queryClient.setQueryData(queryKeys.collectionApplied(collectionId), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.collections });
      navigate(`/admin/content/${collectionId}`);
    },
  });
  const applyError = apply.isError ? toAdminApiError(apply.error) : null;

  if (collection.isPending || preview.isPending) return <Page><PageLoading label="Migration 계획을 계산하는 중" /></Page>;
  if (collection.isError) return <Page><LoadError error={collection.error} onRetry={() => void collection.refetch()} /></Page>;
  if (preview.isError) return <Page><LoadError error={preview.error} onRetry={() => void preview.refetch()} /></Page>;

  return (
    <Page>
      <PageHeader
        eyebrow="Migration review"
        title="변경 사항 검토"
        description={`${collection.data.label || collection.data.name}에서 시작한 변경을 포함해 저장된 전체 Schema 변경을 한 번에 적용합니다.`}
      />
      <Callout tone="info">Migration 적용 단위는 Workspace의 전체 Schema입니다. 아래 목록에는 다른 컬렉션의 대기 중인 변경도 모두 표시됩니다.</Callout>
      {applyError?.status === 409 ? <ConflictNotice onReload={() => { void collection.refetch(); void preview.refetch(); apply.reset(); }} /> : null}
      {applyError && applyError.status !== 409 ? <LoadError error={applyError} /> : null}
      {preview.data.changes.length === 0 ? (
        <EmptyState title="적용할 변경 사항이 없습니다" description="스키마와 현재 데이터베이스가 이미 일치합니다." />
      ) : (
        <section className={styles.card} aria-labelledby="changes-heading">
          <h2 id="changes-heading" className={styles.sectionHeading}>Schema 변경</h2>
          <ul className={styles.changeList}>
            {preview.data.changes.map((change) => <ChangeItem key={change.id} change={change} />)}
          </ul>
        </section>
      )}
      {preview.data.operations.length > 0 ? (
        <section className={styles.card} aria-labelledby="operations-heading">
          <h2 id="operations-heading" className={styles.sectionHeading}>Database 작업</h2>
          <ul className={styles.changeList}>
            {preview.data.operations.map((operation) => (
              <li key={operation.id}>
                <p>{operation.description}</p>
                {operation.sql ? <pre className={styles.sql}><code>{operation.sql}</code></pre> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {preview.data.destructive ? (
        <Callout tone="warning">
          <strong>데이터가 손실될 수 있는 변경입니다.</strong>
          <CheckboxField isSelected={approved} onChange={setApproved}>
            데이터 손실 가능성을 확인했으며 파괴적 변경을 승인합니다
          </CheckboxField>
        </Callout>
      ) : null}
      <div className={styles.formActions} aria-busy={apply.isPending}>
        <Button
          variant={preview.data.destructive ? "danger" : "primary"}
          onPress={() => apply.mutate()}
          isDisabled={apply.isPending || preview.data.changes.length === 0 || (preview.data.destructive && !approved)}
        >
          {apply.isPending ? "적용 중…" : "변경 적용"}
        </Button>
        <Button variant="secondary" isDisabled={apply.isPending} onPress={() => navigate(`/admin/schema/${collectionId}`)}>스키마로 돌아가기</Button>
      </div>
    </Page>
  );
}
