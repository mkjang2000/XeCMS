import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AuthorizationDecision, AuthorizationPolicy } from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { ScopeTreeSelector } from "../../components/resource-scope-tree.js";
import { useDisplayMode } from "../../display-mode.js";
import { MutationError, resourceNameOf, resourcePathOf, roleNameOf, subjectNameOf } from "./common.js";
import {
  decisionReasonName,
  hierarchyContextDescription,
  permissionTaskName,
  propagationLabel,
  subjectTypeName,
} from "./vocabulary.js";
import { useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";

export function AccessSimulatorPage() {
  const { authorization, realmId } = useAuthorizationWorkspace();
  const policy = useAuthorizationPolicy();
  const { mode } = useDisplayMode();
  const advanced = mode === "advanced";
  const [subjectId, setSubjectId] = useState("");
  const [action, setAction] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [ownerSubjectId, setOwnerSubjectId] = useState("");
  const [status, setStatus] = useState("");
  const selectedPermission = policy.data?.permissions.find((permission) => permission.key === action);
  const selectedHierarchyGuard = selectedPermission?.hierarchyGuard ?? "none";
  const hierarchyUnsupported = selectedHierarchyGuard !== "none";
  const simulation = useMutation({ mutationFn: () => authorization.simulate({ subjectId, action, resourceId, context: ownerSubjectId || status ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined } : undefined }) });
  const effectivePermissions = useMutation({
    mutationFn: async () => Promise.all(policy.data!.permissions.map(async (permission) => {
      if (permission.hierarchyGuard !== "none") {
        return { permission, supported: false as const, decision: null };
      }
      return {
        permission,
        supported: true as const,
        decision: await authorization.simulate({
          subjectId,
          action: permission.key,
          resourceId,
          context: ownerSubjectId || status
            ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined }
            : undefined,
        }),
      };
    })),
  });
  if (policy.isPending) return <Page><PageLoading label="시뮬레이터를 준비하는 중" /></Page>;
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;
  const resetResults = () => {
    simulation.reset();
    effectivePermissions.reset();
  };
  return <Page>
    <PageHeader eyebrow={realmId ? "Content Realm authorization" : "Explainable authorization"} title="사용자 권한 확인" description="사용자와 영역을 선택하면 실제로 가능한 업무와 그 이유를 한눈에 확인할 수 있습니다." />
    <AccessWorkspaceNav />
    <div className={styles.guideBanner}>
      <span className={styles.guideNumber}>?</span>
      <div><strong>설정을 바꾸지 않고 현재 권한만 안전하게 확인합니다.</strong><p>{advanced ? "특정 권한의 상세 판정은 아래 고급 진단에서 별도로 실행할 수 있습니다." : "사용자와 영역을 고르면 가능한 업무를 평이한 이름으로 보여 드립니다."}</p></div>
    </div>
    <div className={`${styles.layout} ${styles.simulatorLayout}`}>
      <section className={styles.panel}>
        <SectionHeader title="누구의 권한을 어디에서 확인할까요?" description="사용자 또는 그룹과 실제 콘텐츠·관리 영역을 선택하세요." />
        <div className={styles.form}>
          <label className={styles.field}><span>확인할 사용자·그룹</span><select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); resetResults(); }}><option value="">선택해 주세요</option>{policy.data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {subjectTypeName(subject.type)}</option>)}</select></label>
          <ScopeTreeSelector
            label="확인할 영역"
            description="권한을 확인할 Collection, Document 또는 관리 영역을 선택하세요."
            resources={policy.data.resources}
            value={resourceId}
            onChange={(next) => { setResourceId(next); resetResults(); }}
          />
          <Button isFullWidth onPress={() => effectivePermissions.mutate()} isDisabled={!subjectId || !resourceId || effectivePermissions.isPending}>{effectivePermissions.isPending ? "권한 확인 중…" : "이 영역의 전체 권한 확인"}</Button>
          {advanced ? <details className={styles.advancedDetails}>
            <summary><span>특정 권한 상세 진단</span><small>Action과 조건을 직접 지정하는 고급 도구</small></summary>
            <div className={styles.advancedDetailsBody}>
              <label className={styles.field}><span>확인할 권한</span><select value={action} onChange={(event) => { setAction(event.target.value); resetResults(); }}><option value="">선택해 주세요</option>{policy.data.permissions.map((permission) => <option key={permission.key} value={permission.key}>{permissionTaskName(permission.key)} · {permission.key}{permission.hierarchyGuard === "none" ? "" : " · 대상 정보 필요"}</option>)}</select></label>
              <div className={styles.fieldRow}><label className={styles.field}><span>콘텐츠 소유자 조건</span><select value={ownerSubjectId} onChange={(event) => { setOwnerSubjectId(event.target.value); resetResults(); }}><option value="">조건 없음</option>{policy.data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label className={styles.field}><span>콘텐츠 상태 조건</span><input value={status} onChange={(event) => { setStatus(event.target.value); resetResults(); }} placeholder="예: draft" /></label></div>
              {hierarchyUnsupported ? (
                <Callout tone="info">
                  <strong>이 권한은 대상과의 관리 서열도 확인해야 합니다.</strong><br />
                  {hierarchyContextDescription(selectedHierarchyGuard)} 실제 관리 작업에서 대상의 권한 레벨과 보호 상태를 함께 판정합니다.
                </Callout>
              ) : null}
              <Button variant="secondary" isFullWidth onPress={() => simulation.mutate()} isDisabled={!subjectId || !action || !resourceId || hierarchyUnsupported || simulation.isPending}>{simulation.isPending ? "진단 중…" : hierarchyUnsupported ? "대상 정보 필요" : "선택한 권한 진단"}</Button>
            </div>
          </details> : null}
          <MutationError error={simulation.error ?? effectivePermissions.error} />
        </div>
      </section>
      <div className={styles.stack}><EffectivePermissionList policy={policy.data} results={effectivePermissions.data ?? null} technical={advanced} />{advanced ? <DecisionExplanation policy={policy.data} decision={simulation.data ?? null} /> : null}</div>
    </div>
  </Page>;
}

export function EffectivePermissionList({
  policy,
  results,
  technical = false,
}: {
  readonly policy: AuthorizationPolicy;
  readonly results: readonly {
    readonly permission: AuthorizationPolicy["permissions"][number];
    readonly supported: boolean;
    readonly decision: AuthorizationDecision | null;
  }[] | null;
  readonly technical?: boolean;
}) {
  if (results === null) return <section className={styles.panel}><EmptyState title="전체 권한 결과" description="사용자·그룹과 영역을 선택한 뒤 전체 권한 확인을 실행하세요." /></section>;
  const sorted = [...results].sort((left, right) =>
    Number(right.decision?.allowed === true) - Number(left.decision?.allowed === true)
    || Number(right.supported) - Number(left.supported));
  const supportedCount = results.filter(({ supported }) => supported).length;
  const unsupportedCount = results.length - supportedCount;
  const allowedCount = results.filter(({ decision }) => decision?.allowed === true).length;
  const firstDecision = results.find(({ decision }) => decision !== null)?.decision;
  return (
    <section className={styles.panel} aria-label="사용자별 Effective Permission" aria-live="polite">
      <div className={styles.panelHeader}>
        <div><h2>이 영역에서 가능한 업무</h2><span className={styles.hint}>{resourcePathOf(policy, firstDecision?.resourceId ?? "")}</span></div>
        <Badge tone={allowedCount > 0 ? "success" : "neutral"}>{allowedCount}/{supportedCount}개 가능{unsupportedCount ? ` · ${unsupportedCount}개 추가 정보 필요` : ""}</Badge>
      </div>
      <div className={styles.effectiveList}>
        {sorted.map(({ permission, supported, decision }) => (
          <article className={styles.effectiveItem} key={permission.key} data-allowed={decision?.allowed === true}>
            <div><strong>{permissionTaskName(permission.key)}</strong>{technical ? <code>{permission.key}</code> : null}</div>
            <Badge tone={!supported ? "neutral" : decision?.allowed ? "success" : "danger"}>{!supported ? "추가 정보 필요" : decision?.allowed ? "가능" : "불가"}</Badge>
            <span>{supported ? decisionReasonName(decision?.reasonCode ?? "") : hierarchyContextDescription(permission.hierarchyGuard)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DecisionExplanation({ policy, decision }: { readonly policy: AuthorizationPolicy; readonly decision: AuthorizationDecision | null }) {
  if (decision === null) return <section className={styles.panel}><EmptyState title="상세 진단 결과" description="특정 권한 상세 진단을 실행하면 적용된 역할과 그룹 경로를 확인할 수 있습니다." /></section>;
  return <section className={styles.decisionCard} data-allowed={decision.allowed}><div className={styles.decisionTitle}><Badge tone={decision.allowed ? "success" : "danger"}>{decision.allowed ? "허용됨" : "허용되지 않음"}</Badge><strong>{decisionReasonName(decision.reasonCode)}</strong></div><div className={styles.auditMeta}><span>{permissionTaskName(decision.action)}</span><span>정책 Revision {decision.policyRevision}</span>{decision.actorLevel === undefined ? null : <span>사용자 레벨 {decision.actorLevel}</span>}</div><details className={styles.decisionTechnical}><summary>기술 정보 보기</summary><code>{decision.reasonCode}</code><code>{decision.action}</code></details><div className={styles.grantList}>{decision.matchedGrants.map((grant) => <div className={styles.grant} key={`${grant.sourceBindingId}:${grant.permission}`}><strong>{roleNameOf(policy, grant.sourceRoleId)} · 레벨 {grant.sourceRank}</strong><span>{resourceNameOf(policy, grant.sourceResourceId)} · {propagationLabel(grant.sourcePropagation)}</span>{grant.membershipPath.length ? <span>그룹 경로: {grant.membershipPath.map((id) => subjectNameOf(policy, id)).join(" → ")}</span> : <span>직접 배정됨</span>}</div>)}</div></section>;
}
