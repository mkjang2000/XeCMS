import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AuthorizationBindingInput,
  AuthorizationPolicy,
  AuthorizationRoleBinding,
} from "@xecms/admin";
import { Badge, Button, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { ScopeTreeSelector } from "../../components/resource-scope-tree.js";
import {
  dateTimeValue,
  emptyBinding,
  MutationError,
  optionalInstant,
  PolicySummary,
  resourcePathOf,
  roleNameOf,
  subjectNameOf,
  textList,
} from "./common.js";
import { propagationLabel, subjectTypeName } from "./vocabulary.js";
import { useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";

export function AccessBindingsPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
  const [subjectName, setSubjectName] = useState("");
  const [subjectType, setSubjectType] = useState<"user" | "group" | "service-account">("user");
  const [memberId, setMemberId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [editingBinding, setEditingBinding] = useState<AuthorizationRoleBinding | null>(null);
  const [subjectCreatorOpen, setSubjectCreatorOpen] = useState(false);
  const updatePolicy = (next: AuthorizationPolicy) => queryClient.setQueryData(policyKey, next);
  const createSubject = useMutation({
    mutationFn: () => authorization.createSubject({ expectedPolicyRevision: policy.data!.revision, type: subjectType, name: subjectName.trim() }),
    onSuccess: (next) => { updatePolicy(next); setSubjectName(""); },
  });
  const addMembership = useMutation({
    mutationFn: () => authorization.addGroupMembership({ expectedPolicyRevision: policy.data!.revision, memberSubjectId: memberId, groupSubjectId: groupId }),
    onSuccess: updatePolicy,
  });
  const saveBinding = useMutation({
    mutationFn: (input: AuthorizationBindingInput) => editingBinding?.id
      ? authorization.updateBinding(editingBinding.id, { ...input, expectedPolicyRevision: policy.data!.revision })
      : authorization.createBinding({ ...input, expectedPolicyRevision: policy.data!.revision }),
    onSuccess: (next) => { updatePolicy(next); setEditingBinding(null); },
  });
  const deleteBinding = useMutation({
    mutationFn: (id: string) => authorization.deleteBinding(id, policy.data!.revision),
    onSuccess: (next) => { updatePolicy(next); setEditingBinding(null); },
  });

  if (policy.isPending) return <Page><PageLoading label="바인딩을 불러오는 중" /></Page>;
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;
  const openBinding = (binding: AuthorizationRoleBinding) => {
    setSubjectCreatorOpen(false);
    setEditingBinding(binding);
  };
  const openSubjectCreator = () => {
    setEditingBinding(null);
    setSubjectCreatorOpen(true);
  };
  const closeInspector = () => {
    setEditingBinding(null);
    setSubjectCreatorOpen(false);
  };
  const inspectorOpen = subjectCreatorOpen || editingBinding !== null;

  return (
    <Page>
      <PageHeader
        eyebrow={realmId ? "Content Realm authorization" : "System authorization"}
        title="역할 배정"
        description="사용자나 그룹에 역할을 연결하고, 어느 영역까지 적용할지 정합니다."
        actions={<><Button variant="secondary" onPress={openSubjectCreator}>사용자·그룹 등록</Button><Button onPress={() => openBinding(emptyBinding(policy.data))}>역할 배정하기</Button></>}
      />
      <AccessWorkspaceNav />
      <div className={styles.guideBanner}>
        <span className={styles.guideNumber}>2</span>
        <div><strong>누구에게, 어떤 역할을, 어디까지 적용할지만 순서대로 고르세요.</strong><p>기간이나 소유자·상태 조건은 필요한 경우에만 추가할 수 있습니다.</p></div>
      </div>
      <PolicySummary policy={policy.data} />
      <div className={styles.layout}>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <SectionHeader title="현재 역할 배정" description="사용자와 그룹이 실제로 행사할 수 있는 역할 범위입니다." />
            {policy.data.bindings.length === 0 ? <EmptyState title="배정된 역할이 없습니다" description="사용자 또는 그룹에 첫 역할을 배정해 보세요." /> : <BindingTable policy={policy.data} onEdit={openBinding} />}
          </section>
          <section className={styles.panel}>
            <SectionHeader title="중첩 그룹" description="그룹을 통한 권한 상속 경로는 판정 설명에 그대로 기록됩니다." />
            <div className={styles.fieldRow}>
              <label className={styles.field}><span>멤버</span><select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">선택</option>{policy.data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
              <label className={styles.field}><span>상위 그룹</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">선택</option>{policy.data.subjects.filter(({ type }) => type === "group").map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
            </div>
            <div className={styles.formActions}><Button onPress={() => addMembership.mutate()} isDisabled={!memberId || !groupId || addMembership.isPending}>그룹에 추가</Button></div>
            <div className={styles.chips}>{policy.data.groupMemberships.map((membership) => <span className={styles.chip} key={`${membership.memberSubjectId}:${membership.groupSubjectId}`}>{subjectNameOf(policy.data, membership.memberSubjectId)} → {subjectNameOf(policy.data, membership.groupSubjectId)}</span>)}</div>
          </section>
        </div>
        {inspectorOpen ? <button className={styles.drawerBackdrop} type="button" aria-label="편집 패널 닫기" onClick={closeInspector} /> : null}
        <div className={styles.detailPane} data-open={inspectorOpen}>
          {inspectorOpen ? <div className={styles.drawerHeader}><strong>{subjectCreatorOpen ? "사용자·그룹 등록" : editingBinding?.id ? "역할 배정 수정" : "새 역할 배정"}</strong><Button size="small" variant="quiet" onPress={closeInspector}>닫기</Button></div> : null}
          {subjectCreatorOpen ? (
            <section className={styles.panel}>
              <SectionHeader title="사용자·그룹 등록" description="권한을 받을 사용자, 그룹 또는 서비스 계정을 등록합니다." />
              <div className={styles.form}>
                <label className={styles.field}><span>유형</span><select value={subjectType} onChange={(event) => setSubjectType(event.target.value as typeof subjectType)}><option value="user">사용자</option><option value="group">그룹</option><option value="service-account">서비스 계정</option></select></label>
                <label className={styles.field}><span>표시 이름</span><input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} /></label>
                <div className={styles.formActions}><Button onPress={() => createSubject.mutate()} isDisabled={!subjectName.trim() || createSubject.isPending}>추가</Button></div>
              </div>
            </section>
          ) : (
            <BindingEditor policy={policy.data} binding={editingBinding} onCancel={closeInspector} onSave={(input) => saveBinding.mutate(input)} onDelete={editingBinding?.id ? () => deleteBinding.mutate(editingBinding.id) : undefined} isPending={saveBinding.isPending || deleteBinding.isPending} />
          )}
          <MutationError error={createSubject.error ?? addMembership.error ?? saveBinding.error ?? deleteBinding.error} />
        </div>
      </div>
    </Page>
  );
}

function BindingTable({ policy, onEdit }: { readonly policy: AuthorizationPolicy; readonly onEdit: (binding: AuthorizationRoleBinding) => void }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>사용자·그룹</th><th>부여된 역할</th><th>적용 영역</th><th>하위 적용</th><th>추가 조건</th><th /></tr></thead><tbody>{policy.bindings.map((binding) => <tr key={binding.id}><td><strong>{subjectNameOf(policy, binding.subjectId)}</strong></td><td>{roleNameOf(policy, binding.roleId)}</td><td title={binding.resourceId}>{resourcePathOf(policy, binding.resourceId)}</td><td>{propagationLabel(binding.propagation)}</td><td>{binding.constraints || binding.validFrom || binding.validUntil ? <Badge>조건 있음</Badge> : <span className={styles.muted}>항상 적용</span>}</td><td>{binding.protected ? <Badge>보호됨</Badge> : <Button size="small" variant="quiet" onPress={() => onEdit(binding)}>수정</Button>}</td></tr>)}</tbody></table></div>;
}

function BindingEditor({ policy, binding, onSave, onDelete, onCancel, isPending }: {
  readonly policy: AuthorizationPolicy;
  readonly binding: AuthorizationRoleBinding | null;
  readonly onSave: (input: AuthorizationBindingInput) => void;
  readonly onDelete?: () => void;
  readonly onCancel: () => void;
  readonly isPending: boolean;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [propagation, setPropagation] = useState<AuthorizationBindingInput["propagation"]>("self");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [ownerSubjectId, setOwnerSubjectId] = useState("");
  const [statuses, setStatuses] = useState("");
  useEffect(() => {
    setSubjectId(binding?.subjectId ?? ""); setRoleId(binding?.roleId ?? "");
    setResourceId(binding?.resourceId ?? policy.resources[0]?.id ?? "");
    setPropagation(binding?.propagation ?? "self"); setValidFrom(dateTimeValue(binding?.validFrom));
    setValidUntil(dateTimeValue(binding?.validUntil)); setOwnerSubjectId(binding?.constraints?.ownerSubjectId ?? "");
    setStatuses(binding?.constraints?.statuses?.join(", ") ?? "");
  }, [binding, policy.resources]);
  if (binding === null) return <section className={styles.panel}><EmptyState title="역할 배정을 선택하세요" description="새 역할을 배정하거나 기존 배정 항목을 편집할 수 있습니다." /></section>;
  const statusValues = textList(statuses);
  return <section className={styles.panel} aria-label="역할 배정 편집기"><SectionHeader title={binding.id ? "역할 배정 수정" : "새 역할 배정"} description="아래 세 단계만 선택하면 역할이 적용됩니다." /><div className={styles.form}>
    <div className={styles.editorSection}>
      <div className={styles.editorSectionHeader}><span>1</span><div><h3>누구에게 적용할까요?</h3><p>개별 사용자, 그룹 또는 서비스 계정을 선택합니다.</p></div></div>
      <label className={styles.field}><span>사용자 또는 그룹</span><select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">선택해 주세요</option>{policy.subjects.filter(({ protected: itemProtected }) => !itemProtected).map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {subjectTypeName(subject.type)}</option>)}</select></label>
    </div>
    <div className={styles.editorSection}>
      <div className={styles.editorSectionHeader}><span>2</span><div><h3>어떤 역할을 줄까요?</h3><p>역할에 포함된 업무 권한이 선택한 대상에게 부여됩니다.</p></div></div>
      <label className={styles.field}><span>부여할 역할</span><select value={roleId} onChange={(event) => setRoleId(event.target.value)}><option value="">선택해 주세요</option>{policy.roles.filter(({ protected: itemProtected }) => !itemProtected).map((role) => { const level = policy.levels.find(({ id }) => id === role.levelId); return <option key={role.id} value={role.id}>{role.name}{level ? ` · ${level.name} 레벨 ${level.rank}` : ""}</option>; })}</select></label>
    </div>
    <div className={styles.editorSection}>
      <div className={styles.editorSectionHeader}><span>3</span><div><h3>어디까지 적용할까요?</h3><p>콘텐츠나 관리 영역을 고르고 하위 항목으로의 적용 방식을 선택합니다.</p></div></div>
      <ScopeTreeSelector
        label="적용할 영역"
        description="트리에서 실제 영역을 선택하세요. 아래 옵션으로 현재 항목과 하위 항목의 포함 여부를 정합니다."
        resources={policy.resources}
        value={resourceId}
        onChange={setResourceId}
        propagation={propagation}
        onPropagationChange={setPropagation}
      />
    </div>
    <details className={styles.advancedDetails} open={Boolean(validFrom || validUntil || ownerSubjectId || statuses)}>
      <summary><span>추가 조건</span><small>기간, 소유자 또는 콘텐츠 상태를 제한할 때만 사용</small></summary>
      <div className={styles.advancedDetailsBody}>
        <div className={styles.fieldRow}><label className={styles.field}><span>적용 시작</span><input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><label className={styles.field}><span>적용 종료</span><input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label></div>
        <label className={styles.field}><span>특정 소유자의 콘텐츠만</span><select value={ownerSubjectId} onChange={(event) => setOwnerSubjectId(event.target.value)}><option value="">소유자 제한 없음</option>{policy.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <label className={styles.field}><span>특정 상태만</span><input value={statuses} onChange={(event) => setStatuses(event.target.value)} placeholder="예: draft, rejected" /></label>
      </div>
    </details>
    <div className={styles.bindingPreview}>
      <strong>배정 요약</strong>
      <span>{subjectId ? subjectNameOf(policy, subjectId) : "대상 미선택"}에게 {roleId ? roleNameOf(policy, roleId) : "역할 미선택"} 역할을 {resourceId ? resourcePathOf(policy, resourceId) : "영역 미선택"}에서 적용</span>
    </div>
    <div className={styles.formActions}>{onDelete ? <Button variant="danger" onPress={onDelete}>배정 삭제</Button> : null}<Button variant="quiet" onPress={onCancel}>취소</Button><Button onPress={() => onSave({ subjectId, roleId, resourceId, propagation, validFrom: optionalInstant(validFrom), validUntil: optionalInstant(validUntil), constraints: ownerSubjectId || statusValues.length ? { ownerSubjectId: ownerSubjectId || undefined, statuses: statusValues.length ? statusValues : undefined } : undefined })} isDisabled={isPending || !subjectId || !roleId || !resourceId}>{binding.id ? "변경 저장" : "역할 배정"}</Button></div>
  </div></section>;
}
