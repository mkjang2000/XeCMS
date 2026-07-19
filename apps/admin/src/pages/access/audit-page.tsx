import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { LoadError, PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page } from "../../components/page.js";
import { AccessPageHeader, subjectNameOf } from "./common.js";
import { useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";

export function AccessAuditPage() {
  const { authorization, auditKey, realmId } = useAuthorizationWorkspace();
  const policy = useAuthorizationPolicy();
  const audit = useQuery({ queryKey: auditKey, queryFn: () => authorization.listAudit() });
  if (policy.isPending || audit.isPending) return <Page><PageLoading label="감사 로그를 불러오는 중" /></Page>;
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;
  if (audit.isError) return <Page><LoadError error={audit.error} onRetry={() => void audit.refetch()} /></Page>;
  return <Page><AccessPageHeader realmId={realmId} title="정책 변경 감사" description="정책 구조 변경의 actor, target, before/after와 판정 근거를 보존합니다." /><AccessWorkspaceNav policy={policy.data} />{audit.data.items.length === 0 ? <EmptyState title="감사 이벤트가 없습니다" description="역할이나 바인딩을 변경하면 이곳에 기록됩니다." /> : <div className={styles.auditList}>{audit.data.items.map((entry) => <article className={styles.auditItem} key={entry.id}><div className={styles.rowBetween}><div><strong>{entry.action}</strong><div className={styles.hint}>{entry.targetType} · {entry.targetId}</div></div><Badge>r{entry.policyRevision}</Badge></div><div className={styles.auditMeta}><span>{new Date(entry.occurredAt).toLocaleString("ko-KR")}</span><span>Actor {entry.actorSubjectId === undefined ? entry.actorIdentityId ?? "System control plane" : subjectNameOf(policy.data, entry.actorSubjectId)}</span>{entry.accessMode === undefined ? null : <span>{entry.accessMode}</span>}<span>{entry.decision?.reasonCode ?? "BOOTSTRAP"}</span></div><details><summary>변경 전후 보기</summary><div className={styles.diff}><pre>{JSON.stringify(entry.before, null, 2)}</pre><pre>{JSON.stringify(entry.after, null, 2)}</pre></div></details></article>)}</div>}</Page>;
}
