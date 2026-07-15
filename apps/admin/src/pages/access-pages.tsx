import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  toAdminApiError,
  useAdminApi,
  type AuthorizationBindingInput,
  type AuthorizationAdminApi,
  type AuthorizationDecision,
  type AuthorizationLevel,
  type AuthorizationPolicy,
  type AuthorizationRole,
  type AuthorizationRoleBinding,
  type AuthorizationRoleInput,
} from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import styles from "../authorization.module.css";
import { AccessWorkspaceNav } from "../components/access-workspace-nav.js";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { resourcePath, ScopeTreeSelector } from "../components/resource-scope-tree.js";
import { queryKeys } from "../queries.js";

function useAuthorizationPolicy() {
  const { authorization, policyKey } = useAuthorizationWorkspace();
  return useQuery({
    queryKey: policyKey,
    queryFn: () => authorization.getPolicy(),
  });
}

function useAuthorizationWorkspace(): {
  readonly authorization: AuthorizationAdminApi;
  readonly realmId?: string;
  readonly policyKey: readonly string[];
  readonly auditKey: readonly string[];
} {
  const api = useAdminApi();
  const { realmId } = useParams();
  return realmId === undefined
    ? {
        authorization: api.authorization,
        policyKey: queryKeys.authorization,
        auditKey: queryKeys.authorizationAudit,
      }
    : {
        authorization: api.identityRealms.authorizationFor(realmId),
        realmId,
        policyKey: queryKeys.realmAuthorization(realmId),
        auditKey: queryKeys.realmAuthorizationAudit(realmId),
      };
}

function PolicySummary({ policy }: { readonly policy: AuthorizationPolicy }) {
  const items = [
    ["정책 Revision", policy.revision],
    ["권한 주체", policy.subjects.length],
    ["역할", policy.roles.length],
    ["활성 바인딩", policy.bindings.length],
  ] as const;
  return (
    <div className={styles.summaryGrid}>
      {items.map(([label, value]) => (
        <div className={styles.summaryCard} key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
}

function MutationError({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  const converted = toAdminApiError(error);
  const details = converted.details as { readonly decision?: { readonly reasonCode?: string } } | undefined;
  return (
    <Callout tone="error">
      <strong>{converted.message}</strong>
      {details?.decision?.reasonCode ? <div>판정 코드: {details.decision.reasonCode}</div> : null}
    </Callout>
  );
}

function textList(value: string): readonly string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function dateTimeValue(value?: string): string {
  return value === undefined ? "" : new Date(value).toISOString().slice(0, 16);
}

function optionalInstant(value: string): string | undefined {
  return value === "" ? undefined : new Date(value).toISOString();
}

export function AccessRolesPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
  const [editingRole, setEditingRole] = useState<AuthorizationRole | null>(null);
  const [editingLevel, setEditingLevel] = useState<AuthorizationLevel | null>(null);
  const saveRole = useMutation({
    mutationFn: async (input: AuthorizationRoleInput) => editingRole === null || editingRole.id === ""
      ? authorization.createRole({ ...input, expectedPolicyRevision: policy.data!.revision })
      : authorization.updateRole(editingRole.id, { ...input, expectedPolicyRevision: policy.data!.revision }),
    onSuccess: (next) => {
      queryClient.setQueryData(policyKey, next);
      setEditingRole(null);
    },
  });
  const deleteRole = useMutation({
    mutationFn: (roleId: string) => authorization.deleteRole(roleId, policy.data!.revision),
    onSuccess: (next) => {
      queryClient.setQueryData(policyKey, next);
      setEditingRole(null);
    },
  });
  const saveLevel = useMutation({
    mutationFn: (input: { readonly name: string; readonly rank: number }) => editingLevel === null
      ? authorization.createLevel({ ...input, expectedPolicyRevision: policy.data!.revision })
      : authorization.updateLevel(editingLevel.id, { ...input, expectedPolicyRevision: policy.data!.revision }),
    onSuccess: (next) => {
      queryClient.setQueryData(policyKey, next);
      setEditingLevel(null);
    },
  });

  if (policy.isPending) return <Page><PageLoading label="권한 정책을 불러오는 중" /></Page>;
  if (policy.isError) return <Page><LoadError error={policy.error} onRetry={() => void policy.refetch()} /></Page>;
  const levels = [...policy.data.levels].sort((left, right) => right.rank - left.rank);

  return (
    <Page>
      <PageHeader eyebrow={realmId ? "Content Realm authorization" : "System authorization"} title="레벨과 역할" description="수직 레벨 안에 목적별 역할을 수평으로 구성합니다." />
      <AccessWorkspaceNav />
      <PolicySummary policy={policy.data} />
      <div className={styles.layout}>
        <div className={styles.levels}>
          {levels.map((level) => {
            const roles = policy.data.roles.filter((role) => role.levelId === level.id);
            return (
              <section className={styles.levelCard} key={level.id}>
                <div className={styles.levelHeader}>
                  <div><h2>{level.name}</h2><span className={styles.hint}>같은 레벨의 역할은 서로 동등합니다.</span></div>
                  <div className={styles.rowBetween}>
                    <span className={styles.rank}>L{level.rank}</span>
                    {!level.protected ? <Button size="small" variant="quiet" onPress={() => setEditingLevel(level)}>편집</Button> : <Badge>보호됨</Badge>}
                  </div>
                </div>
                <div className={styles.roleList}>
                  {roles.map((role) => (
                    <button className={styles.roleCard} type="button" key={role.id} onClick={() => !role.protected && setEditingRole(role)}>
                      <div className={styles.roleHeader}><h3>{role.name}</h3>{role.protected ? <Badge>보호됨</Badge> : null}</div>
                      <p className={styles.muted}>{role.description || "설명 없음"}</p>
                      <div className={styles.chips}>
                        <span className={styles.chip}>권한 {role.permissions.length}</span>
                        <span className={styles.chip}>위임 {role.delegatablePermissions.length}</span>
                        <span className={styles.chip}>필드 규칙 {role.fieldAccess.length}</span>
                      </div>
                    </button>
                  ))}
                  <button className={styles.roleCard} type="button" onClick={() => setEditingRole({
                    id: "", realmId: policy.data.realmId, levelId: level.id, name: "", permissions: [],
                    delegatablePermissions: [], fieldAccess: [], protected: false,
                  })}>
                    <div className={styles.roleHeader}><h3>+ 동일 레벨 역할 추가</h3></div>
                    <p className={styles.muted}>새 목적의 역할을 이 레벨에 수평으로 추가합니다.</p>
                  </button>
                </div>
              </section>
            );
          })}
        </div>
        <div className={styles.stack}>
          <LevelEditor level={editingLevel} onCancel={() => setEditingLevel(null)} onSave={(input) => saveLevel.mutate(input)} isPending={saveLevel.isPending} />
          <MutationError error={saveLevel.error} />
          <RoleEditor
            policy={policy.data}
            role={editingRole}
            onCancel={() => setEditingRole(null)}
            onSave={(input) => saveRole.mutate(input)}
            onDelete={editingRole?.id ? () => deleteRole.mutate(editingRole.id) : undefined}
            isPending={saveRole.isPending || deleteRole.isPending}
          />
          <MutationError error={saveRole.error ?? deleteRole.error} />
        </div>
      </div>
    </Page>
  );
}

function LevelEditor({ level, onSave, onCancel, isPending }: {
  readonly level: AuthorizationLevel | null;
  readonly onSave: (input: { readonly name: string; readonly rank: number }) => void;
  readonly onCancel: () => void;
  readonly isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [rank, setRank] = useState("50");
  useEffect(() => {
    setName(level?.name ?? "");
    setRank(String(level?.rank ?? 50));
  }, [level]);
  return (
    <section className={styles.panel}>
      <SectionHeader title={level ? "레벨 편집" : "새 레벨"} description="숫자가 클수록 관리 서열이 높습니다." />
      <div className={styles.form}>
        <label className={styles.field}><span>레벨 이름</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className={styles.field}><span>Rank</span><input type="number" value={rank} onChange={(event) => setRank(event.target.value)} /></label>
        <div className={styles.formActions}>
          {level ? <Button variant="quiet" onPress={onCancel}>취소</Button> : null}
          <Button onPress={() => onSave({ name: name.trim(), rank: Number(rank) })} isDisabled={isPending || name.trim() === ""}>저장</Button>
        </div>
      </div>
    </section>
  );
}

function RoleEditor({ policy, role, onSave, onDelete, onCancel, isPending }: {
  readonly policy: AuthorizationPolicy;
  readonly role: AuthorizationRole | null;
  readonly onSave: (input: AuthorizationRoleInput) => void;
  readonly onDelete?: () => void;
  readonly onCancel: () => void;
  readonly isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [levelId, setLevelId] = useState("");
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [delegations, setDelegations] = useState<readonly string[]>([]);
  const [fieldResourceId, setFieldResourceId] = useState("");
  const [readableFields, setReadableFields] = useState("");
  const [writableFields, setWritableFields] = useState("");
  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setLevelId(role?.levelId ?? policy.levels[0]?.id ?? "");
    setPermissions(role?.permissions ?? []);
    setDelegations(role?.delegatablePermissions ?? []);
    setFieldResourceId(role?.fieldAccess[0]?.resourceId ?? "");
    setReadableFields(role?.fieldAccess[0]?.readableFields.join(", ") ?? "");
    setWritableFields(role?.fieldAccess[0]?.writableFields.join(", ") ?? "");
  }, [policy.levels, role]);
  const togglePermission = (key: string, selected: boolean) => {
    setPermissions((current) => selected ? [...new Set([...current, key])] : current.filter((item) => item !== key));
    if (!selected) setDelegations((current) => current.filter((item) => item !== key));
  };
  const toggleDelegation = (key: string, selected: boolean) => {
    setDelegations((current) => selected ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  };
  if (role === null) {
    return <section className={styles.panel}><EmptyState title="역할을 선택하세요" description="왼쪽 역할을 선택하거나 동일 레벨 역할을 추가할 수 있습니다." /></section>;
  }
  return (
    <section className={styles.panel} aria-label="역할 편집기">
      <SectionHeader title={role.id ? "역할 편집" : "동일 레벨 역할 추가"} description="사용 권한과 하위 역할에 위임할 수 있는 범위를 분리합니다." />
      <div className={styles.form}>
        <label className={styles.field}><span>역할 이름</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className={styles.field}><span>설명</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className={styles.field}><span>Authority Level</span><select value={levelId} onChange={(event) => setLevelId(event.target.value)}>{[...policy.levels].sort((a, b) => b.rank - a.rank).map((level) => <option key={level.id} value={level.id}>{level.name} · L{level.rank}</option>)}</select></label>
        <div>
          <div className={styles.panelHeader}><h3>Permission Matrix</h3><span className={styles.hint}>위임은 사용 권한의 부분집합입니다.</span></div>
          <div className={styles.permissionMatrix}>
            <div className={styles.permissionHeader}><span>권한</span><span>사용</span><span>위임</span></div>
            {policy.permissions.map((permission) => (
              <div className={styles.permissionRow} key={permission.key}>
                <span className={styles.permissionName}><code>{permission.key}</code><span>{permission.label} · {permission.category}</span></span>
                <label className={styles.checkboxCell}><input aria-label={`${permission.key} 사용`} type="checkbox" checked={permissions.includes(permission.key)} onChange={(event) => togglePermission(permission.key, event.target.checked)} /></label>
                <label className={styles.checkboxCell}><input aria-label={`${permission.key} 위임`} type="checkbox" checked={delegations.includes(permission.key)} disabled={!permissions.includes(permission.key) || !permission.delegatable || permission.protected} onChange={(event) => toggleDelegation(permission.key, event.target.checked)} /></label>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.stack}>
          <div className={styles.panelHeader}><h3>필드 접근 제한</h3><span className={styles.hint}>비워 두면 해당 리소스의 모든 필드를 허용합니다.</span></div>
          <ScopeTreeSelector
            label="필드 접근 Scope"
            description="Collection 또는 개별 Document를 선택하세요. 상위 영역은 위치를 설명하기 위해 함께 표시됩니다."
            resources={policy.resources}
            value={fieldResourceId}
            onChange={setFieldResourceId}
            allowEmpty
            isSelectable={({ type }) => type === "collection" || type === "document"}
          />
          {fieldResourceId ? <div className={styles.fieldRow}>
            <label className={styles.field}><span>읽기 허용 필드</span><input value={readableFields} onChange={(event) => setReadableFields(event.target.value)} placeholder="title, summary" /></label>
            <label className={styles.field}><span>쓰기 허용 필드</span><input value={writableFields} onChange={(event) => setWritableFields(event.target.value)} placeholder="title" /></label>
          </div> : null}
        </div>
        <div className={styles.formActions}>
          {onDelete ? <Button variant="danger" onPress={onDelete} isDisabled={isPending}>삭제</Button> : null}
          <Button variant="quiet" onPress={onCancel} isDisabled={isPending}>취소</Button>
          <Button onPress={() => onSave({
            name: name.trim(), description: description.trim() || undefined, levelId, permissions,
            delegatablePermissions: delegations,
            fieldAccess: fieldResourceId ? [{ resourceId: fieldResourceId, readableFields: textList(readableFields), writableFields: textList(writableFields) }] : [],
          })} isDisabled={isPending || name.trim() === "" || levelId === ""}>저장</Button>
        </div>
      </div>
    </section>
  );
}

export function AccessBindingsPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
  const [subjectName, setSubjectName] = useState("");
  const [subjectType, setSubjectType] = useState<"user" | "group" | "service-account">("user");
  const [memberId, setMemberId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [editingBinding, setEditingBinding] = useState<AuthorizationRoleBinding | null>(null);
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
  if (policy.isError) return <Page><LoadError error={policy.error} onRetry={() => void policy.refetch()} /></Page>;

  return (
    <Page>
      <PageHeader eyebrow={realmId ? "Content Realm authorization" : "System authorization"} title="주체와 역할 바인딩" description="누가 어떤 역할을 어느 리소스 범위에서 행사하는지 연결합니다." actions={<Button onPress={() => setEditingBinding(emptyBinding(policy.data))}>새 바인딩</Button>} />
      <AccessWorkspaceNav />
      <PolicySummary policy={policy.data} />
      <div className={styles.layout}>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <SectionHeader title="역할 바인딩" description="기간·소유자·상태 조건은 모든 조건을 만족할 때만 적용됩니다." />
            {policy.data.bindings.length === 0 ? <EmptyState title="바인딩이 없습니다" description="권한 주체에 역할과 Scope를 연결하세요." /> : <BindingTable policy={policy.data} onEdit={setEditingBinding} />}
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
        <div className={styles.stack}>
          <section className={styles.panel}>
            <SectionHeader title="권한 주체 추가" description="M3에서는 사용자, 그룹, 서비스 계정을 동일한 Subject로 다룹니다." />
            <div className={styles.form}>
              <label className={styles.field}><span>유형</span><select value={subjectType} onChange={(event) => setSubjectType(event.target.value as typeof subjectType)}><option value="user">사용자</option><option value="group">그룹</option><option value="service-account">서비스 계정</option></select></label>
              <label className={styles.field}><span>표시 이름</span><input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} /></label>
              <div className={styles.formActions}><Button onPress={() => createSubject.mutate()} isDisabled={!subjectName.trim() || createSubject.isPending}>추가</Button></div>
            </div>
          </section>
          <BindingEditor policy={policy.data} binding={editingBinding} onCancel={() => setEditingBinding(null)} onSave={(input) => saveBinding.mutate(input)} onDelete={editingBinding?.id ? () => deleteBinding.mutate(editingBinding.id) : undefined} isPending={saveBinding.isPending || deleteBinding.isPending} />
          <MutationError error={createSubject.error ?? addMembership.error ?? saveBinding.error ?? deleteBinding.error} />
        </div>
      </div>
    </Page>
  );
}

function emptyBinding(policy: AuthorizationPolicy): AuthorizationRoleBinding {
  return { id: "", realmId: policy.realmId, subjectId: "", roleId: "", resourceId: policy.resources[0]?.id ?? "", propagation: "self", protected: false };
}

function subjectNameOf(policy: AuthorizationPolicy, id: string): string {
  return policy.subjects.find((subject) => subject.id === id)?.name ?? id;
}

function roleNameOf(policy: AuthorizationPolicy, id: string): string {
  return policy.roles.find((role) => role.id === id)?.name ?? id;
}

function resourceNameOf(policy: AuthorizationPolicy, id: string): string {
  return policy.resources.find((resource) => resource.id === id)?.name ?? id;
}

function resourcePathOf(policy: AuthorizationPolicy, id: string): string {
  const path = resourcePath(policy.resources, id);
  return path.length > 0 ? path.map(({ name }) => name).join(" / ") : id;
}

function propagationLabel(propagation: AuthorizationRoleBinding["propagation"]): string {
  switch (propagation) {
    case "self": return "현재 리소스";
    case "children": return "모든 하위";
    case "self-and-children": return "현재 및 모든 하위";
  }
}

function BindingTable({ policy, onEdit }: { readonly policy: AuthorizationPolicy; readonly onEdit: (binding: AuthorizationRoleBinding) => void }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Subject</th><th>Role</th><th>Scope</th><th>전파</th><th>조건</th><th /></tr></thead><tbody>{policy.bindings.map((binding) => <tr key={binding.id}><td>{subjectNameOf(policy, binding.subjectId)}</td><td>{roleNameOf(policy, binding.roleId)}</td><td title={binding.resourceId}>{resourcePathOf(policy, binding.resourceId)}</td><td>{propagationLabel(binding.propagation)}</td><td>{binding.constraints ? "조건부" : "없음"}</td><td>{binding.protected ? <Badge>보호됨</Badge> : <Button size="small" variant="quiet" onPress={() => onEdit(binding)}>편집</Button>}</td></tr>)}</tbody></table></div>;
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
  if (binding === null) return <section className={styles.panel}><EmptyState title="바인딩을 선택하세요" description="새 바인딩을 만들거나 기존 항목을 편집할 수 있습니다." /></section>;
  const statusValues = textList(statuses);
  return <section className={styles.panel} aria-label="역할 바인딩 편집기"><SectionHeader title={binding.id ? "바인딩 편집" : "새 역할 바인딩"} /><div className={styles.form}>
    <label className={styles.field}><span>Subject</span><select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">선택</option>{policy.subjects.filter(({ protected: itemProtected }) => !itemProtected).map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {subject.type}</option>)}</select></label>
    <label className={styles.field}><span>Role</span><select value={roleId} onChange={(event) => setRoleId(event.target.value)}><option value="">선택</option>{policy.roles.filter(({ protected: itemProtected }) => !itemProtected).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
    <ScopeTreeSelector
      label="Resource Scope"
      description="parentId 계층을 따라 Collection과 Document의 실제 위치를 확인한 뒤 범위를 선택하세요."
      resources={policy.resources}
      value={resourceId}
      onChange={setResourceId}
      propagation={propagation}
      onPropagationChange={setPropagation}
    />
    <div className={styles.fieldRow}><label className={styles.field}><span>유효 시작</span><input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label><label className={styles.field}><span>유효 종료</span><input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label></div>
    <label className={styles.field}><span>소유자 조건</span><select value={ownerSubjectId} onChange={(event) => setOwnerSubjectId(event.target.value)}><option value="">제한 없음</option>{policy.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
    <label className={styles.field}><span>상태 조건</span><input value={statuses} onChange={(event) => setStatuses(event.target.value)} placeholder="draft, rejected" /></label>
    <div className={styles.formActions}>{onDelete ? <Button variant="danger" onPress={onDelete}>삭제</Button> : null}<Button variant="quiet" onPress={onCancel}>취소</Button><Button onPress={() => onSave({ subjectId, roleId, resourceId, propagation, validFrom: optionalInstant(validFrom), validUntil: optionalInstant(validUntil), constraints: ownerSubjectId || statusValues.length ? { ownerSubjectId: ownerSubjectId || undefined, statuses: statusValues.length ? statusValues : undefined } : undefined })} isDisabled={isPending || !subjectId || !roleId || !resourceId}>저장</Button></div>
  </div></section>;
}

export function AccessSimulatorPage() {
  const { authorization, realmId } = useAuthorizationWorkspace();
  const policy = useAuthorizationPolicy();
  const [subjectId, setSubjectId] = useState("");
  const [action, setAction] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [ownerSubjectId, setOwnerSubjectId] = useState("");
  const [status, setStatus] = useState("");
  const simulation = useMutation({ mutationFn: () => authorization.simulate({ subjectId, action, resourceId, context: ownerSubjectId || status ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined } : undefined }) });
  const effectivePermissions = useMutation({
    mutationFn: async () => Promise.all(policy.data!.permissions.map(async (permission) => ({
      permission,
      decision: await authorization.simulate({
        subjectId,
        action: permission.key,
        resourceId,
        context: ownerSubjectId || status
          ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined }
          : undefined,
      }),
    }))),
  });
  if (policy.isPending) return <Page><PageLoading label="시뮬레이터를 준비하는 중" /></Page>;
  if (policy.isError) return <Page><LoadError error={policy.error} onRetry={() => void policy.refetch()} /></Page>;
  const resetResults = () => {
    simulation.reset();
    effectivePermissions.reset();
  };
  return <Page><PageHeader eyebrow={realmId ? "Content Realm authorization" : "Explainable authorization"} title="권한 시뮬레이터" description="개별 판정과 사용자별 전체 Effective Permission을 실제 API와 같은 정책 snapshot으로 조회합니다." /><AccessWorkspaceNav /><div className={styles.layout}><section className={styles.panel}><SectionHeader title="판정 조건" /><div className={styles.form}>
    <label className={styles.field}><span>Subject</span><select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); resetResults(); }}><option value="">선택</option>{policy.data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} · {subject.type}</option>)}</select></label>
    <label className={styles.field}><span>Action</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="">선택</option>{policy.data.permissions.map((permission) => <option key={permission.key} value={permission.key}>{permission.key} · {permission.label}</option>)}</select></label>
    <ScopeTreeSelector
      label="Resource"
      description="판정할 Collection 또는 Document의 실제 계층 위치를 선택하세요."
      resources={policy.data.resources}
      value={resourceId}
      onChange={(next) => { setResourceId(next); resetResults(); }}
    />
    <div className={styles.fieldRow}><label className={styles.field}><span>소유자 Context</span><select value={ownerSubjectId} onChange={(event) => { setOwnerSubjectId(event.target.value); resetResults(); }}><option value="">없음</option>{policy.data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label className={styles.field}><span>상태 Context</span><input value={status} onChange={(event) => { setStatus(event.target.value); resetResults(); }} placeholder="draft" /></label></div>
    <div className={styles.formActions}>
      <Button variant="secondary" onPress={() => effectivePermissions.mutate()} isDisabled={!subjectId || !resourceId || effectivePermissions.isPending}>{effectivePermissions.isPending ? "전체 조회 중…" : "전체 유효 권한 조회"}</Button>
      <Button onPress={() => simulation.mutate()} isDisabled={!subjectId || !action || !resourceId || simulation.isPending}>{simulation.isPending ? "판정 중…" : "선택 권한 판정"}</Button>
    </div>
    <MutationError error={simulation.error ?? effectivePermissions.error} />
  </div></section><div className={styles.stack}><DecisionExplanation policy={policy.data} decision={simulation.data ?? null} /><EffectivePermissionList policy={policy.data} results={effectivePermissions.data ?? null} /></div></div></Page>;
}

function EffectivePermissionList({
  policy,
  results,
}: {
  readonly policy: AuthorizationPolicy;
  readonly results: readonly {
    readonly permission: AuthorizationPolicy["permissions"][number];
    readonly decision: AuthorizationDecision;
  }[] | null;
}) {
  if (results === null) return <section className={styles.panel}><EmptyState title="전체 유효 권한" description="Subject와 Resource를 선택한 뒤 전체 유효 권한 조회를 실행하세요." /></section>;
  const sorted = [...results].sort((left, right) => Number(right.decision.allowed) - Number(left.decision.allowed));
  const allowedCount = results.filter(({ decision }) => decision.allowed).length;
  return (
    <section className={styles.panel} aria-label="사용자별 Effective Permission" aria-live="polite">
      <div className={styles.panelHeader}>
        <div><h2>전체 유효 권한</h2><span className={styles.hint}>{resourcePathOf(policy, results[0]?.decision.resourceId ?? "")}</span></div>
        <Badge tone={allowedCount > 0 ? "success" : "neutral"}>{allowedCount}/{results.length} 허용</Badge>
      </div>
      <div className={styles.effectiveList}>
        {sorted.map(({ permission, decision }) => (
          <article className={styles.effectiveItem} key={permission.key} data-allowed={decision.allowed}>
            <div><strong>{permission.label}</strong><code>{permission.key}</code></div>
            <Badge tone={decision.allowed ? "success" : "danger"}>{decision.allowed ? "Allowed" : "Denied"}</Badge>
            <span>{decision.reasonCode}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function DecisionExplanation({ policy, decision }: { readonly policy: AuthorizationPolicy; readonly decision: AuthorizationDecision | null }) {
  if (decision === null) return <section className={styles.panel}><EmptyState title="판정 조건을 선택하세요" description="허용 여부뿐 아니라 Role, Level, Binding과 그룹 경로를 확인할 수 있습니다." /></section>;
  return <section className={styles.decisionCard} data-allowed={decision.allowed}><div className={styles.decisionTitle}><Badge tone={decision.allowed ? "success" : "danger"}>{decision.allowed ? "Allowed" : "Denied"}</Badge><strong>{decision.reasonCode}</strong></div><div className={styles.auditMeta}><span>Action {decision.action}</span><span>Policy r{decision.policyRevision}</span>{decision.actorLevel === undefined ? null : <span>Actor L{decision.actorLevel}</span>}</div><div className={styles.grantList}>{decision.matchedGrants.map((grant) => <div className={styles.grant} key={`${grant.sourceBindingId}:${grant.permission}`}><strong>{roleNameOf(policy, grant.sourceRoleId)} · L{grant.sourceRank}</strong><span>{resourceNameOf(policy, grant.sourceResourceId)} · {grant.sourcePropagation}</span><span>Binding {grant.sourceBindingId}</span>{grant.membershipPath.length ? <span>그룹 경로: {grant.membershipPath.map((id) => subjectNameOf(policy, id)).join(" → ")}</span> : <span>직접 부여</span>}</div>)}</div></section>;
}

export function AccessAuditPage() {
  const { authorization, auditKey, realmId } = useAuthorizationWorkspace();
  const policy = useAuthorizationPolicy();
  const audit = useQuery({ queryKey: auditKey, queryFn: () => authorization.listAudit() });
  if (policy.isPending || audit.isPending) return <Page><PageLoading label="감사 로그를 불러오는 중" /></Page>;
  if (policy.isError) return <Page><LoadError error={policy.error} onRetry={() => void policy.refetch()} /></Page>;
  if (audit.isError) return <Page><LoadError error={audit.error} onRetry={() => void audit.refetch()} /></Page>;
  return <Page><PageHeader eyebrow={realmId ? "Content Realm audit" : "Security audit"} title="정책 변경 감사" description="정책 구조 변경의 actor, target, before/after와 판정 근거를 보존합니다." /><AccessWorkspaceNav />{audit.data.items.length === 0 ? <EmptyState title="감사 이벤트가 없습니다" description="역할이나 바인딩을 변경하면 이곳에 기록됩니다." /> : <div className={styles.auditList}>{audit.data.items.map((entry) => <article className={styles.auditItem} key={entry.id}><div className={styles.rowBetween}><div><strong>{entry.action}</strong><div className={styles.hint}>{entry.targetType} · {entry.targetId}</div></div><Badge>r{entry.policyRevision}</Badge></div><div className={styles.auditMeta}><span>{new Date(entry.occurredAt).toLocaleString("ko-KR")}</span><span>Actor {subjectNameOf(policy.data, entry.actorSubjectId)}</span><span>{entry.decision?.reasonCode ?? "BOOTSTRAP"}</span></div><details><summary>변경 전후 보기</summary><div className={styles.diff}><pre>{JSON.stringify(entry.before, null, 2)}</pre><pre>{JSON.stringify(entry.after, null, 2)}</pre></div></details></article>)}</div>}</Page>;
}
