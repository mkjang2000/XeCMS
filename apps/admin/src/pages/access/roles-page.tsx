import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AuthorizationLevel,
  AuthorizationPolicy,
  AuthorizationRole,
  AuthorizationRoleInput,
} from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { useDisplayMode } from "../../display-mode.js";
import { ScopeTreeSelector } from "../../components/resource-scope-tree.js";
import { MutationError, PolicySummary, textList } from "./common.js";
import { PermissionEditor } from "./permission-editor.js";
import { canMutateAuthorization, useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";

export function AccessRolesPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
  const { mode } = useDisplayMode();
  const advanced = mode === "advanced";
  const [editingRole, setEditingRole] = useState<AuthorizationRole | null>(null);
  const [editingLevel, setEditingLevel] = useState<AuthorizationLevel | null>(null);
  const [levelEditorOpen, setLevelEditorOpen] = useState(false);
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
      setLevelEditorOpen(false);
    },
  });

  if (policy.isPending) return <Page><PageLoading label="권한 정책을 불러오는 중" /></Page>;
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;
  const writable = canMutateAuthorization(policy.data, realmId);
  const levels = [...policy.data.levels].sort((left, right) => right.rank - left.rank);
  const selectRole = (role: AuthorizationRole) => {
    setEditingLevel(null);
    setLevelEditorOpen(false);
    setEditingRole(role);
  };
  const selectLevel = (level: AuthorizationLevel | null) => {
    setEditingRole(null);
    setEditingLevel(level);
    setLevelEditorOpen(true);
  };
  const createRoleAt = (level: AuthorizationLevel) => selectRole({
    id: "",
    realmId: policy.data.realmId,
    levelId: level.id,
    name: "",
    permissions: [],
    delegatablePermissions: [],
    fieldAccess: [],
    protected: false,
  });
  const closeInspector = () => {
    setEditingRole(null);
    setEditingLevel(null);
    setLevelEditorOpen(false);
  };
  const inspectorOpen = levelEditorOpen || editingRole !== null;

  return (
    <Page>
      <PageHeader
        eyebrow={realmId ? "Content Realm authorization" : "System authorization"}
        title={advanced ? "레벨과 역할" : "등급과 역할"}
        description={advanced ? "위쪽 레벨이 아래쪽 역할을 관리합니다. 같은 레벨에서는 책임만 나누고 서로를 관리하지 않습니다." : "등급별 역할과 맡은 업무를 관리합니다. 등급 순서 변경은 고급 모드에서 할 수 있습니다."}
        actions={advanced && writable ? <Button onPress={() => selectLevel(null)}>새 레벨</Button> : undefined}
      />
      <AccessWorkspaceNav policy={policy.data} />
      <div className={styles.guideBanner}>
        <span className={styles.guideNumber}>1</span>
        <div><strong>{advanced ? "먼저 관리 서열을 정하고, 같은 높이에 필요한 역할을 나누세요." : "등급 안에서 담당 업무별 역할을 나눌 수 있습니다."}</strong><p>{advanced ? "역할을 선택하면 오른쪽에서 실제 업무와 위임 범위를 설정할 수 있습니다." : "고급 위임·필드 제한이 있는 역할도 값을 유지한 채 기본 업무만 편집합니다."}</p></div>
      </div>
      <PolicySummary policy={policy.data} />
      <div className={`${styles.layout} ${styles.rolesLayout}`}>
        <div className={styles.levels}>
          {levels.map((level) => {
            const roles = policy.data.roles.filter((role) => role.levelId === level.id);
            return (
              <section className={styles.levelCard} key={level.id}>
                <div className={styles.levelHeader}>
                  <div className={styles.levelIdentity}>
                    {advanced ? <span className={styles.rank}>L{level.rank}</span> : null}
                    <div>
                      <h2>{level.name}</h2>
                      <span className={styles.hint}>{advanced ? `권한 레벨 ${level.rank} · 같은 높이의 역할 ${roles.length}개` : `역할 ${roles.length}개`}</span>
                    </div>
                  </div>
                  <div className={styles.levelActions}>
                    {writable ? <Button size="small" variant="secondary" onPress={() => createRoleAt(level)}>동일 레벨 역할 추가</Button> : null}
                    {advanced && writable && !level.protected
                      ? <Button size="small" variant="quiet" onPress={() => selectLevel(level)}>레벨 편집</Button>
                      : level.protected ? <Badge>보호됨</Badge> : null}
                  </div>
                </div>
                <div className={styles.roleList}>
                  {roles.map((role) => (
                    <button
                      className={styles.roleCard}
                      type="button"
                      key={role.id}
                      data-selected={editingRole?.id === role.id}
                      aria-pressed={editingRole?.id === role.id}
                      onClick={() => selectRole(role)}
                    >
                      <div className={styles.roleSummary}>
                        <div className={styles.roleHeader}><h3>{role.name}</h3>{role.protected ? <Badge>보호됨</Badge> : null}</div>
                        <p className={styles.muted}>{role.description || "설명이 아직 없습니다."}</p>
                      </div>
                      <div className={styles.roleStats}>
                        <span className={styles.chip}>권한 {role.permissions.length}</span>
                        {advanced ? <span className={styles.chip}>위임 {role.delegatablePermissions.length}</span> : null}
                        {advanced ? <span className={styles.chip}>필드 규칙 {role.fieldAccess.length}</span> : null}
                        {!advanced && (role.delegatablePermissions.length > 0 || role.fieldAccess.length > 0) ? <Badge tone="info">고급 설정 있음</Badge> : null}
                      </div>
                      <span className={styles.roleChevron} aria-hidden="true">›</span>
                    </button>
                  ))}
                  {roles.length === 0 ? (
                    <div className={styles.emptyRoleRow}>
                      <span>아직 역할이 없습니다.</span>
                      {writable ? <Button size="small" variant="quiet" onPress={() => createRoleAt(level)}>첫 역할 추가</Button> : null}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
        {inspectorOpen ? <button className={styles.drawerBackdrop} type="button" aria-label="편집 패널 닫기" onClick={closeInspector} /> : null}
        <div className={styles.detailPane} data-open={inspectorOpen}>
          {inspectorOpen ? <div className={styles.drawerHeader}><strong>{levelEditorOpen ? editingLevel ? "레벨 편집" : "새 레벨" : editingRole?.name || "새 역할"}</strong><Button size="small" variant="quiet" onPress={closeInspector}>닫기</Button></div> : null}
          {levelEditorOpen ? (
            writable ? <>
              <LevelEditor level={editingLevel} onCancel={closeInspector} onSave={(input) => saveLevel.mutate(input)} isPending={saveLevel.isPending} />
              <MutationError error={saveLevel.error} />
            </> : <section className={styles.panel}><Callout tone="info">Full Access가 종료되어 레벨 편집을 닫았습니다. 현재 정책은 읽기 전용입니다.</Callout></section>
          ) : (
            <>
              <RoleEditor
                policy={policy.data}
                role={editingRole}
                onCancel={() => setEditingRole(null)}
                onSave={(input) => saveRole.mutate(input)}
                onDelete={writable && editingRole?.id && !editingRole.protected ? () => deleteRole.mutate(editingRole.id) : undefined}
                isPending={saveRole.isPending || deleteRole.isPending}
                advanced={advanced}
                forcedReadOnly={!writable}
              />
              <MutationError error={saveRole.error ?? deleteRole.error} />
            </>
          )}
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

function RoleEditor({ policy, role, onSave, onDelete, onCancel, isPending, advanced, forcedReadOnly }: {
  readonly policy: AuthorizationPolicy;
  readonly role: AuthorizationRole | null;
  readonly onSave: (input: AuthorizationRoleInput) => void;
  readonly onDelete?: () => void;
  readonly onCancel: () => void;
  readonly isPending: boolean;
  readonly advanced: boolean;
  readonly forcedReadOnly: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [levelId, setLevelId] = useState("");
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [delegations, setDelegations] = useState<readonly string[]>([]);
  const [fieldResourceId, setFieldResourceId] = useState("");
  const [readableFields, setReadableFields] = useState("");
  const [writableFields, setWritableFields] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [technicalPermissions, setTechnicalPermissions] = useState(false);
  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setLevelId(role?.levelId ?? policy.levels[0]?.id ?? "");
    setPermissions(role?.permissions ?? []);
    setDelegations(role?.delegatablePermissions ?? []);
    setFieldResourceId(role?.fieldAccess[0]?.resourceId ?? "");
    setReadableFields(role?.fieldAccess[0]?.readableFields.join(", ") ?? "");
    setWritableFields(role?.fieldAccess[0]?.writableFields.join(", ") ?? "");
    setPermissionQuery("");
    setTechnicalPermissions(false);
  }, [policy.levels, role]);
  const togglePermission = (key: string, selected: boolean) => {
    setPermissions((current) => selected ? [...new Set([...current, key])] : current.filter((item) => item !== key));
    if (!selected) setDelegations((current) => current.filter((item) => item !== key));
  };
  const toggleDelegation = (key: string, selected: boolean) => {
    setDelegations((current) => selected ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  };
  if (role === null) {
    return <section className={`${styles.panel} ${styles.inspectorEmpty}`}><EmptyState title="편집할 항목을 선택하세요" description="목록에서 역할을 선택하거나 새 레벨·동일 레벨 역할을 추가하세요." /></section>;
  }
  const readOnly = forcedReadOnly || role.protected;
  const availablePermissions = readOnly
    ? policy.permissions
    : policy.permissions.filter((permission) =>
      permission.delegatable && !permission.protected);
  const normalizedQuery = permissionQuery.trim().toLocaleLowerCase();
  const visiblePermissions = normalizedQuery === ""
    ? availablePermissions
    : availablePermissions.filter((permission) =>
      `${permission.key} ${permission.label} ${permission.category}`.toLocaleLowerCase().includes(normalizedQuery));
  const selectedLevel = policy.levels.find((level) => level.id === levelId);
  return (
    <section className={styles.panel} aria-label="역할 편집기">
      <SectionHeader
        title={readOnly ? "보호 역할 상세" : role.id ? "역할 편집" : "동일 레벨 역할 추가"}
        description={forcedReadOnly ? "CMS Owner 감독 모드에서는 구성을 확인할 수 있지만 수정할 수 없습니다." : readOnly ? "시스템 보호 역할은 구성을 확인할 수 있지만 수정할 수 없습니다." : advanced ? "사용 권한과 하위 역할에 위임할 수 있는 범위를 분리합니다." : "역할이 맡을 기본 업무를 선택합니다. 숨은 고급 설정은 그대로 유지됩니다."}
        actions={readOnly ? <Badge>읽기 전용</Badge> : undefined}
      />
      {readOnly ? <Callout tone="info">{forcedReadOnly ? "Full Access를 시작하기 전에는 Realm 정책을 읽기만 할 수 있습니다." : "이 역할은 시스템 동작에 필요하므로 이름, 레벨, 권한 구성이 보호됩니다."}</Callout> : null}
      {!advanced && (role.delegatablePermissions.length > 0 || role.fieldAccess.length > 0) ? <Callout tone="info"><strong>고급 설정 있음</strong> 위임 또는 필드 접근 제한은 이 화면에서 바뀌지 않으며 저장해도 그대로 유지됩니다.</Callout> : null}
      <div className={styles.form}>
        <div className={styles.editorSection}>
          <div className={styles.editorSectionHeader}><span>1</span><div><h3>역할의 이름과 위치</h3><p>같은 레벨의 역할은 서열이 같고 담당 업무만 다릅니다.</p></div></div>
          <label className={styles.field}><span>역할 이름</span><input value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} /></label>
          <label className={styles.field}><span>역할 설명</span><textarea value={description} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} placeholder="예: 게시물을 검토하고 발행하는 담당자" /></label>
          <label className={styles.field}><span>{advanced ? "권한 레벨" : "등급"}</span><select value={levelId} disabled={readOnly} onChange={(event) => setLevelId(event.target.value)}>{[...policy.levels].sort((a, b) => b.rank - a.rank).map((level) => <option key={level.id} value={level.id}>{level.name}{advanced ? ` · 레벨 ${level.rank}` : ""}</option>)}</select></label>
          {advanced && selectedLevel ? <div className={styles.levelExplanation}><strong>{selectedLevel.name} · 레벨 {selectedLevel.rank}</strong><span>이 역할보다 낮은 레벨의 역할만 관리할 수 있습니다. 같은 레벨끼리는 서로 독립적입니다.</span></div> : null}
        </div>
        <div className={styles.editorSection}>
          <div className={styles.editorSectionHeader}><span>2</span><div><h3>{advanced ? "할 수 있는 일과 위임 범위" : "할 수 있는 일"}</h3><p>{advanced ? "업무별로 사용 여부와 다른 하위 역할에 넘겨줄 수 있는 범위를 선택하세요." : "이 역할이 맡을 업무를 선택하세요."}</p></div></div>
          <PermissionEditor
            permissions={visiblePermissions}
            selected={permissions}
            delegated={delegations}
            query={permissionQuery}
            technical={technicalPermissions}
            advanced={advanced}
            readOnly={readOnly}
            onQueryChange={setPermissionQuery}
            onTechnicalChange={setTechnicalPermissions}
            onPermissionChange={togglePermission}
            onDelegationChange={toggleDelegation}
          />
        </div>
        {advanced ? <div className={`${styles.stack} ${styles.editorSection}`}>
          <div className={styles.editorSectionHeader}><span>3</span><div><h3>필드 접근 제한 <em>선택 사항</em></h3><p>특정 콘텐츠에서 읽거나 수정할 수 있는 필드만 제한할 때 사용합니다.</p></div></div>
          <ScopeTreeSelector
            label="제한할 콘텐츠 범위"
            description="제한이 필요한 Collection 또는 개별 Document를 선택하세요. 선택하지 않으면 별도 필드 제한을 두지 않습니다."
            resources={policy.resources}
            value={fieldResourceId}
            onChange={setFieldResourceId}
            allowEmpty
            isDisabled={readOnly}
            isSelectable={({ type }) => type === "collection" || type === "document"}
          />
          {fieldResourceId ? <div className={styles.fieldRow}>
            <label className={styles.field}><span>볼 수 있는 필드</span><input value={readableFields} disabled={readOnly} onChange={(event) => setReadableFields(event.target.value)} placeholder="title, summary" /></label>
            <label className={styles.field}><span>수정할 수 있는 필드</span><input value={writableFields} disabled={readOnly} onChange={(event) => setWritableFields(event.target.value)} placeholder="title" /></label>
          </div> : null}
        </div> : null}
        <div className={styles.formActions}>
          {onDelete ? <Button variant="danger" onPress={onDelete} isDisabled={isPending}>삭제</Button> : null}
          <Button variant="quiet" onPress={onCancel} isDisabled={isPending}>취소</Button>
          {!readOnly ? <Button onPress={() => onSave({
            name: name.trim(), description: description.trim() || undefined, levelId, permissions,
            delegatablePermissions: delegations,
            fieldAccess: advanced ? (fieldResourceId ? [{ resourceId: fieldResourceId, readableFields: textList(readableFields), writableFields: textList(writableFields) }] : []) : role.fieldAccess,
          })} isDisabled={isPending || name.trim() === "" || levelId === ""}>저장</Button> : null}
        </div>
      </div>
    </section>
  );
}
