import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  toAdminApiError,
  useAdminApi,
  type EventDeliveryRecord,
  type EventDeliveryStatus,
} from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
import styles from "../jobs.module.css";

const statuses: readonly { readonly value: "" | EventDeliveryStatus; readonly label: string }[] = [
  { value: "", label: "모든 상태" },
  { value: "pending", label: "대기" },
  { value: "processing", label: "처리 중" },
  { value: "succeeded", label: "성공" },
  { value: "dead", label: "실패 종료" },
];

export function JobsPage() {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | EventDeliveryStatus>("");
  const [topic, setTopic] = useState("");
  const [handlerId, setHandlerId] = useState("");
  const [selected, setSelected] = useState<EventDeliveryRecord | null>(null);
  const jobs = useQuery({
    queryKey: queryKeys.jobs(page, status, topic, handlerId),
    queryFn: () => api.jobs.list({ page, pageSize: 25,
      ...(status === "" ? {} : { status }), ...(topic === "" ? {} : { topic }),
      ...(handlerId === "" ? {} : { handlerId }) }),
    refetchInterval: 5_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["jobs"] });
  const run = useMutation({ mutationFn: () => api.jobs.run(), onSuccess: refresh });
  const retry = useMutation({
    mutationFn: (id: string) => api.jobs.retry(id),
    onSuccess: async (next) => { setSelected(next); await refresh(); },
  });

  if (jobs.isPending) return <Page><PageLoading label="이벤트 작업을 불러오는 중" /></Page>;
  if (jobs.isError) return <Page><LoadError error={jobs.error} onRetry={() => void jobs.refetch()} /></Page>;
  const converted = run.error || retry.error ? toAdminApiError(run.error ?? retry.error) : null;
  return (
    <Page>
      <PageHeader eyebrow="Durable event worker" title="이벤트 작업" description="Transactional Outbox에서 fan-out된 Handler delivery와 재시도 상태를 관리합니다." actions={<Button onPress={() => run.mutate()} isDisabled={run.isPending}>{run.isPending ? "실행 중…" : "Worker 한 번 실행"}</Button>} />
      <div className={styles.summary}>
        {statuses.filter(({ value }) => value !== "").map(({ value, label }) => <div key={value}><span>{label}</span><strong>{jobs.data.counts[value as EventDeliveryStatus]}</strong></div>)}
      </div>
      {run.data ? <Callout tone="success">Claim {run.data.claimed} · 성공 {run.data.succeeded} · 재시도 {run.data.failed} · Dead {run.data.dead}</Callout> : null}
      {converted ? <Callout tone="error"><strong>{converted.message}</strong> <code>{converted.code}</code></Callout> : null}
      <section className={styles.filters} aria-label="작업 필터">
        <label><span>상태</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as typeof status); }}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>Topic</span><input value={topic} placeholder="document.created" onChange={(event) => { setPage(1); setTopic(event.target.value); }} /></label>
        <label><span>Handler</span><input value={handlerId} placeholder="core.search-projection" onChange={(event) => { setPage(1); setHandlerId(event.target.value); }} /></label>
      </section>
      {jobs.data.items.length === 0 ? <EmptyState title="표시할 이벤트 작업이 없습니다" description="콘텐츠를 변경하면 commit과 함께 Outbox Event가 만들어집니다." /> : (
        <div className={styles.layout}>
          <div className={styles.tableWrap}><table><thead><tr><th>상태</th><th>Topic / Handler</th><th>시도</th><th>다음 실행</th><th /></tr></thead><tbody>{jobs.data.items.map((job) => <tr key={job.id} data-selected={selected?.id === job.id}><td><StatusBadge status={job.status} /></td><td><strong>{job.topic}</strong><code>{job.handlerId}</code></td><td>{job.attempts}/{job.maxAttempts}</td><td>{formatTime(job.availableAt)}</td><td><Button size="small" variant="quiet" onPress={() => setSelected(job)}>상세</Button></td></tr>)}</tbody></table></div>
          <JobDetail job={selected} isPending={retry.isPending} onRetry={(id) => retry.mutate(id)} />
        </div>
      )}
      <div className={styles.pagination}><Button variant="quiet" isDisabled={page <= 1} onPress={() => setPage((value) => value - 1)}>이전</Button><span>{page} / {Math.max(1, Math.ceil(jobs.data.total / jobs.data.pageSize))}</span><Button variant="quiet" isDisabled={page * jobs.data.pageSize >= jobs.data.total} onPress={() => setPage((value) => value + 1)}>다음</Button></div>
    </Page>
  );
}

function JobDetail({ job, onRetry, isPending }: { readonly job: EventDeliveryRecord | null; readonly onRetry: (id: string) => void; readonly isPending: boolean }) {
  if (job === null) return <section className={styles.detail}><EmptyState title="작업을 선택하세요" description="Event envelope, lease와 오류 정보를 확인할 수 있습니다." /></section>;
  const retryable = job.status === "dead" || job.status === "pending";
  return <section className={styles.detail} aria-label="이벤트 작업 상세"><div className={styles.detailHeader}><div><StatusBadge status={job.status} /><h2>{job.topic}</h2></div>{retryable ? <Button variant={job.status === "dead" ? "danger" : "secondary"} isDisabled={isPending} onPress={() => onRetry(job.id)}>재시도 초기화</Button> : null}</div><dl><div><dt>Delivery</dt><dd><code>{job.id}</code></dd></div><div><dt>Event</dt><dd><code>{job.eventId}</code></dd></div><div><dt>Aggregate</dt><dd>{job.event.aggregate.type} · <code>{job.event.aggregate.id}</code></dd></div><div><dt>Lease</dt><dd>{job.lockedBy ? `${job.lockedBy} · ${formatTime(job.lockedUntil)}` : "없음"}</dd></div></dl>{job.lastErrorMessage ? <Callout tone="error"><strong>{job.lastErrorCode}</strong><div>{job.lastErrorMessage}</div></Callout> : null}<details><summary>Event payload</summary><pre>{JSON.stringify(job.event.payload, null, 2)}</pre></details></section>;
}

function StatusBadge({ status }: { readonly status: EventDeliveryStatus }) {
  const tone = status === "succeeded" ? "success" : status === "dead" ? "danger" : status === "processing" ? "info" : "warning";
  return <Badge tone={tone}>{status}</Badge>;
}
function formatTime(value?: string): string { return value ? new Date(value).toLocaleString("ko-KR") : "—"; }
