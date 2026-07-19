import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { AuthorizationPolicy, AuthorizationSubject } from "@xecms/admin";
import { Badge, Button, ConfirmDialog, EmptyState } from "@xecms/ui";
import gradeStyles from "../../access-grades.module.css";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { useDisplayMode } from "../../display-mode.js";
import { roleNameOf } from "./common.js";
import { PolicyMutationError } from "./guardrails.js";
import {
  gradeOptions,
  rootResource,
  subjectGradeState,
  type GradeOption,
  type SubjectGradeState,
} from "./policy-simple-view.js";
import { EffectivePermissionList } from "./simulator-page.js";
import { accessBasePath, canMutateAuthorization, useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";

interface PendingGradeChange {
  readonly subject: AuthorizationSubject;
  readonly state: SubjectGradeState;
  readonly option: GradeOption | null;
}

export function AccessMembersPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
  const [newMemberName, setNewMemberName] = useState("");
  const [pendingChange, setPendingChange] = useState<PendingGradeChange | null>(null);

  const updatePolicy = (next: AuthorizationPolicy) => queryClient.setQueryData(policyKey, next);
  const createSubject = useMutation({
    mutationFn: () => authorization.createSubject({
      expectedPolicyRevision: policy.data!.revision,
      type: "user",
      name: newMemberName.trim(),
    }),
    onSuccess: (next) => { updatePolicy(next); setNewMemberName(""); },
  });
  const applyGrade = useMutation({
    mutationFn: async ({ subject, state, option }: PendingGradeChange) => {
      const revision = policy.data!.revision;
      const root = rootResource(policy.data!)!;
      const existing = state.kind === "simple" ? state.binding : null;
      if (option === null) {
        return authorization.deleteBinding(existing!.id, revision);
      }
      if (existing === null) {
        return authorization.createBinding({
          expectedPolicyRevision: revision,
          subjectId: subject.id,
          roleId: option.roleId!,
          resourceId: root.id,
          propagation: "self-and-children",
        });
      }
      // simple 판정상 숨은 조건은 없지만, 원본 값을 그대로 넘겨 무손실을 유지한다.
      return authorization.updateBinding(existing.id, {
        expectedPolicyRevision: revision,
        subjectId: subject.id,
        roleId: option.roleId!,
        resourceId: root.id,
        propagation: "self-and-children",
        validFrom: existing.validFrom,
        validUntil: existing.validUntil,
        constraints: existing.constraints,
      });
    },
    onSuccess: (next) => { updatePolicy(next); setPendingChange(null); },
    onError: () => setPendingChange(null),
  });

  if (policy.isPending) {
    return <Page><PageLoading label="멤버 정보를 불러오는 중" /></Page>;
  }
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;

  const root = rootResource(policy.data);
  const options = gradeOptions(policy.data);
  const members = policy.data.subjects.filter(({ type }) => type === "user");
  const basePath = accessBasePath(realmId);
  const writable = canMutateAuthorization(policy.data, realmId);
  const levelName = (levelId: string) => policy.data.levels.find(({ id }) => id === levelId)?.name ?? levelId;

  return (
    <Page>
      <PageHeader
        eyebrow={realmId ? "Content Realm" : "Workspace"}
        title="멤버"
        description="멤버마다 등급 하나만 고르면 그 등급의 권한이 그대로 적용됩니다."
      />
      <AccessWorkspaceNav policy={policy.data} />
      {writable ? <section className={styles.panel}>
        <SectionHeader title="새 멤버 추가" description="이름만 입력하면 바로 등급을 정할 수 있어요." />
        <div className={gradeStyles.memberAdd}>
          <label>
            <span>표시 이름</span>
            <input value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} placeholder="예: 김민지" />
          </label>
          <Button onPress={() => createSubject.mutate()} isDisabled={!newMemberName.trim() || createSubject.isPending}>추가</Button>
        </div>
        <PolicyMutationError error={createSubject.error} policyKey={policyKey} />
      </section> : null}
      <section className={styles.panel}>
        <SectionHeader title="멤버 등급" description="등급을 바꾸면 확인 후 바로 적용됩니다." />
        {members.length === 0 ? (
          <EmptyState title="아직 멤버가 없습니다" description="위에서 첫 멤버를 추가해 보세요." />
        ) : (
          <div className={gradeStyles.memberTable}>
            {members.map((subject) => (
              <MemberRow
                key={subject.id}
                policy={policy.data}
                subject={subject}
                options={options}
                rootMissing={root === null}
                levelName={levelName}
                basePath={basePath}
                readOnly={!writable}
                onChange={(state, option) => setPendingChange({ subject, state, option })}
                changePending={applyGrade.isPending}
              />
            ))}
          </div>
        )}
        <PolicyMutationError error={applyGrade.error} policyKey={policyKey} />
      </section>
      {writable && pendingChange !== null ? (
        <ConfirmDialog
          title="멤버 등급 변경"
          confirmLabel={pendingChange.option === null ? "등급 해제" : "등급 적용"}
          danger={pendingChange.option === null}
          isPending={applyGrade.isPending}
          onConfirm={() => applyGrade.mutate(pendingChange)}
          onCancel={() => setPendingChange(null)}
        >
          <p>
            {pendingChange.option === null
              ? `${pendingChange.subject.name} 님의 등급을 해제합니다. 이 멤버는 더 이상 별도 권한을 갖지 않아요.`
              : `${pendingChange.subject.name} 님을 ${pendingChange.option.levelName} 등급으로 지정합니다. 등급의 권한이 바로 적용돼요.`}
          </p>
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}

function MemberRow({ policy, subject, options, rootMissing, levelName, basePath, readOnly, onChange, changePending }: {
  readonly policy: AuthorizationPolicy;
  readonly subject: AuthorizationSubject;
  readonly options: readonly GradeOption[];
  readonly rootMissing: boolean;
  readonly levelName: (levelId: string) => string;
  readonly basePath: string;
  readonly readOnly: boolean;
  readonly onChange: (state: SubjectGradeState, option: GradeOption | null) => void;
  readonly changePending: boolean;
}) {
  const state = subjectGradeState(policy, subject.id);
  const [expanded, setExpanded] = useState(false);
  const locked = readOnly || (state.kind === "simple" && state.locked) || subject.protected;

  return (
    <article className={gradeStyles.memberRow} aria-label={`${subject.name} 멤버`}>
      <div className={gradeStyles.memberIdentity}>
        <strong>{subject.name}</strong>
        <span>{subject.disabled ? "비활성화됨" : "사용자"}</span>
      </div>
      <div className={gradeStyles.memberGrade}>
        {state.kind === "complex" ? (
          <ComplexGradeSummary policy={policy} subjectId={subject.id} reasons={state.reasons} basePath={basePath} />
        ) : locked ? (
          <div className={gradeStyles.memberChips}>
            <Badge>{state.kind === "simple" ? levelName(state.levelId) : "등급 없음"}</Badge>
            <Badge tone="info">{readOnly ? "CMS Owner · 읽기 전용" : "기본 제공 · 잠김"}</Badge>
          </div>
        ) : rootMissing ? (
          <span className={styles.hint}>영역 구조가 복잡해 표준 모드에서 관리해 주세요.</span>
        ) : (
          <label>
            <span className={styles.visuallyHidden}>{subject.name} 등급</span>
            <select
              value={state.kind === "simple" ? state.levelId : ""}
              disabled={changePending || readOnly}
              onChange={(event) => {
                const levelId = event.target.value;
                onChange(state, levelId === "" ? null : options.find((option) => option.levelId === levelId) ?? null);
              }}
            >
              <option value="">등급 없음</option>
              {options.map((option) => (
                <option key={option.levelId} value={option.levelId} disabled={option.roleId === null}>
                  {option.levelName}{option.disabledReason === null ? "" : ` · ${option.disabledReason}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={gradeStyles.memberActions}>
        <Button size="small" variant="quiet" onPress={() => setExpanded((current) => !current)}>
          {expanded ? "닫기" : "할 수 있는 일 보기"}
        </Button>
      </div>
      {expanded ? (
        <div className={gradeStyles.memberExpansion}>
          <MemberCapabilities policy={policy} subjectId={subject.id} />
        </div>
      ) : null}
    </article>
  );
}

function ComplexGradeSummary({ policy, subjectId, reasons, basePath }: {
  readonly policy: AuthorizationPolicy;
  readonly subjectId: string;
  readonly reasons: readonly string[];
  readonly basePath: string;
}) {
  const { setMode } = useDisplayMode();
  const navigate = useNavigate();
  const boundRoles = policy.bindings
    .filter((binding) => binding.subjectId === subjectId)
    .map((binding) => roleNameOf(policy, binding.roleId));
  return (
    <div className={gradeStyles.memberGrade}>
      <div className={gradeStyles.memberChips}>
        {boundRoles.length > 0
          ? boundRoles.map((name) => <Badge key={name}>{name}</Badge>)
          : <Badge>세부 설정 있음</Badge>}
        <Button
          size="small"
          variant="secondary"
          onPress={() => {
            setMode("standard");
            void navigate(`${basePath}/bindings`);
          }}
        >표준 모드에서 관리</Button>
      </div>
      <ul className={gradeStyles.memberReasons}>
        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </div>
  );
}

function MemberCapabilities({ policy, subjectId }: {
  readonly policy: AuthorizationPolicy;
  readonly subjectId: string;
}) {
  const { authorization } = useAuthorizationWorkspace();
  const root = rootResource(policy);
  const capabilities = useMutation({
    mutationFn: async () => Promise.all(policy.permissions.map(async (permission) => {
      if (permission.hierarchyGuard !== "none") {
        return { permission, supported: false as const, decision: null };
      }
      return {
        permission,
        supported: true as const,
        decision: await authorization.simulate({
          subjectId,
          action: permission.key,
          resourceId: root!.id,
        }),
      };
    })),
  });
  if (root === null) return <span className={styles.hint}>영역 구조를 확인할 수 없어 결과를 보여줄 수 없어요.</span>;
  if (capabilities.data === undefined) {
    return (
      <div className={styles.formActions}>
        <Button
          size="small"
          variant="secondary"
          onPress={() => capabilities.mutate()}
          isDisabled={capabilities.isPending}
        >{capabilities.isPending ? "확인 중…" : "지금 확인하기"}</Button>
      </div>
    );
  }
  return <EffectivePermissionList policy={policy} results={capabilities.data} />;
}
