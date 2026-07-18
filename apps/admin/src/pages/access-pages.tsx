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
import { LoadError, PageLoading, RealmAuthorizationError } from "../components/async-state.js";
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
    ["사용자·그룹", policy.subjects.length],
    ["역할", policy.roles.length],
    ["역할 배정", policy.bindings.length],
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

const permissionCategoryNames: Readonly<Record<string, string>> = {
  authorization: "권한 정책",
  content: "콘텐츠",
  schema: "스키마",
  identity: "사용자",
  "service-account": "서비스 계정",
  group: "그룹",
  role: "역할",
  "authority-level": "권한 레벨",
  media: "미디어",
  plugin: "플러그인",
  job: "백그라운드 작업",
  audit: "감사 로그",
  retention: "데이터 보존",
  "api-key": "API 키",
  system: "시스템 설정",
  site: "사이트",
  "admin-app": "Admin App",
};

const permissionObjectNames: Readonly<Record<string, string>> = {
  authorization: "권한 정책",
  content: "콘텐츠",
  revision: "버전",
  schema: "스키마",
  identity: "사용자",
  credentials: "인증 정보",
  session: "세션",
  owner: "소유자",
  "system-membership": "시스템 계정 연결",
  "service-account": "서비스 계정",
  group: "그룹",
  member: "구성원",
  role: "역할",
  "authority-level": "권한 레벨",
  media: "미디어",
  plugin: "플러그인",
  job: "백그라운드 작업",
  audit: "감사 로그",
  retention: "데이터 보존 정책",
  consistency: "무결성 검사",
  "api-key": "API 키",
  system: "시스템",
  settings: "설정",
  site: "사이트",
  collection: "컬렉션",
  "admin-app": "Admin App",
};

const permissionVerbNames: Readonly<Record<string, string>> = {
  list: "목록 보기",
  read: "보기",
  create: "만들기",
  update: "수정",
  delete: "삭제",
  purge: "영구 삭제",
  publish: "게시",
  unpublish: "게시 취소",
  archive: "보관",
  restore: "복원",
  reset: "재설정",
  revoke: "폐기",
  transfer: "이전",
  install: "설치",
  configure: "설정",
  enable: "활성화",
  disable: "비활성화",
  uninstall: "제거",
  retry: "재시도",
  export: "내보내기",
  preview: "미리보기",
  apply: "적용",
  upload: "업로드",
  bind: "연결",
  assign: "배정",
  reorder: "순서 변경",
  manage: "관리",
  access: "접근",
};

function permissionCategoryName(category: string): string {
  return permissionCategoryNames[category] ?? category;
}

function permissionTaskName(key: string): string {
  const parts = key.split(".");
  const operation = parts.pop() ?? key;
  const object = parts.map((part) => permissionObjectNames[part] ?? part).join(" · ");
  return `${object} ${permissionVerbNames[operation] ?? operation}`;
}

function subjectTypeName(type: AuthorizationPolicy["subjects"][number]["type"]): string {
  switch (type) {
    case "user": return "사용자";
    case "group": return "그룹";
    case "service-account": return "서비스 계정";
  }
}

export function AccessRolesPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
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
        title="레벨과 역할"
        description="위쪽 레벨이 아래쪽 역할을 관리합니다. 같은 레벨에서는 책임만 나누고 서로를 관리하지 않습니다."
        actions={<Button onPress={() => selectLevel(null)}>새 레벨</Button>}
      />
      <AccessWorkspaceNav />
      <div className={styles.guideBanner}>
        <span className={styles.guideNumber}>1</span>
        <div><strong>먼저 관리 서열을 정하고, 같은 높이에 필요한 역할을 나누세요.</strong><p>역할을 선택하면 오른쪽에서 실제 업무와 위임 범위를 설정할 수 있습니다.</p></div>
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
                    <span className={styles.rank}>L{level.rank}</span>
                    <div>
                      <h2>{level.name}</h2>
                      <span className={styles.hint}>권한 레벨 {level.rank} · 같은 높이의 역할 {roles.length}개</span>
                    </div>
                  </div>
                  <div className={styles.levelActions}>
                    <Button size="small" variant="secondary" onPress={() => createRoleAt(level)}>동일 레벨 역할 추가</Button>
                    {!level.protected
                      ? <Button size="small" variant="quiet" onPress={() => selectLevel(level)}>레벨 편집</Button>
                      : <Badge>보호됨</Badge>}
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
                        <span className={styles.chip}>위임 {role.delegatablePermissions.length}</span>
                        <span className={styles.chip}>필드 규칙 {role.fieldAccess.length}</span>
                      </div>
                      <span className={styles.roleChevron} aria-hidden="true">›</span>
                    </button>
                  ))}
                  {roles.length === 0 ? (
                    <div className={styles.emptyRoleRow}>
                      <span>아직 역할이 없습니다.</span>
                      <Button size="small" variant="quiet" onPress={() => createRoleAt(level)}>첫 역할 추가</Button>
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
            <>
              <LevelEditor level={editingLevel} onCancel={closeInspector} onSave={(input) => saveLevel.mutate(input)} isPending={saveLevel.isPending} />
              <MutationError error={saveLevel.error} />
            </>
          ) : (
            <>
              <RoleEditor
                policy={policy.data}
                role={editingRole}
                onCancel={() => setEditingRole(null)}
                onSave={(input) => saveRole.mutate(input)}
                onDelete={editingRole?.id && !editingRole.protected ? () => deleteRole.mutate(editingRole.id) : undefined}
                isPending={saveRole.isPending || deleteRole.isPending}
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
  const readOnly = role.protected;
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
        description={readOnly ? "시스템 보호 역할은 구성을 확인할 수 있지만 수정할 수 없습니다." : "사용 권한과 하위 역할에 위임할 수 있는 범위를 분리합니다."}
        actions={readOnly ? <Badge>읽기 전용</Badge> : undefined}
      />
      {readOnly ? <Callout tone="info">이 역할은 시스템 동작에 필요하므로 이름, 레벨, 권한 구성이 보호됩니다.</Callout> : null}
      <div className={styles.form}>
        <div className={styles.editorSection}>
          <div className={styles.editorSectionHeader}><span>1</span><div><h3>역할의 이름과 위치</h3><p>같은 레벨의 역할은 서열이 같고 담당 업무만 다릅니다.</p></div></div>
          <label className={styles.field}><span>역할 이름</span><input value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} /></label>
          <label className={styles.field}><span>역할 설명</span><textarea value={description} disabled={readOnly} onChange={(event) => setDescription(event.target.value)} placeholder="예: 게시물을 검토하고 발행하는 담당자" /></label>
          <label className={styles.field}><span>권한 레벨</span><select value={levelId} disabled={readOnly} onChange={(event) => setLevelId(event.target.value)}>{[...policy.levels].sort((a, b) => b.rank - a.rank).map((level) => <option key={level.id} value={level.id}>{level.name} · 레벨 {level.rank}</option>)}</select></label>
          {selectedLevel ? <div className={styles.levelExplanation}><strong>{selectedLevel.name} · 레벨 {selectedLevel.rank}</strong><span>이 역할보다 낮은 레벨의 역할만 관리할 수 있습니다. 같은 레벨끼리는 서로 독립적입니다.</span></div> : null}
        </div>
        <div className={styles.editorSection}>
          <div className={styles.editorSectionHeader}><span>2</span><div><h3>할 수 있는 일과 위임 범위</h3><p>업무별로 사용 여부와 다른 하위 역할에 넘겨줄 수 있는 범위를 선택하세요.</p></div></div>
          <PermissionEditor
            permissions={visiblePermissions}
            selected={permissions}
            delegated={delegations}
            query={permissionQuery}
            technical={technicalPermissions}
            readOnly={readOnly}
            onQueryChange={setPermissionQuery}
            onTechnicalChange={setTechnicalPermissions}
            onPermissionChange={togglePermission}
            onDelegationChange={toggleDelegation}
          />
        </div>
        <div className={`${styles.stack} ${styles.editorSection}`}>
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
        </div>
        <div className={styles.formActions}>
          {onDelete ? <Button variant="danger" onPress={onDelete} isDisabled={isPending}>삭제</Button> : null}
          <Button variant="quiet" onPress={onCancel} isDisabled={isPending}>취소</Button>
          {!readOnly ? <Button onPress={() => onSave({
            name: name.trim(), description: description.trim() || undefined, levelId, permissions,
            delegatablePermissions: delegations,
            fieldAccess: fieldResourceId ? [{ resourceId: fieldResourceId, readableFields: textList(readableFields), writableFields: textList(writableFields) }] : [],
          })} isDisabled={isPending || name.trim() === "" || levelId === ""}>저장</Button> : null}
        </div>
      </div>
    </section>
  );
}

type PermissionMode = "none" | "use" | "delegate";

function PermissionEditor({
  permissions,
  selected,
  delegated,
  query,
  technical,
  readOnly,
  onQueryChange,
  onTechnicalChange,
  onPermissionChange,
  onDelegationChange,
}: {
  readonly permissions: AuthorizationPolicy["permissions"];
  readonly selected: readonly string[];
  readonly delegated: readonly string[];
  readonly query: string;
  readonly technical: boolean;
  readonly readOnly: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onTechnicalChange: (value: boolean) => void;
  readonly onPermissionChange: (key: string, selected: boolean) => void;
  readonly onDelegationChange: (key: string, selected: boolean) => void;
}) {
  const groups = new Map<string, AuthorizationPolicy["permissions"]>();
  for (const permission of permissions) {
    groups.set(permission.category, [...(groups.get(permission.category) ?? []), permission]);
  }
  const modeOf = (key: string): PermissionMode => delegated.includes(key)
    ? "delegate"
    : selected.includes(key) ? "use" : "none";
  const setMode = (key: string, mode: PermissionMode) => {
    onPermissionChange(key, mode !== "none");
    onDelegationChange(key, mode === "delegate");
  };
  return (
    <div className={styles.permissionEditor}>
      <div className={styles.permissionToolbar}>
        <div className={styles.permissionSummary}>
          <strong>{selected.length}개 업무 허용</strong>
          <span>{delegated.length}개는 하위 역할에 위임 가능</span>
        </div>
        <div className={styles.permissionTools}>
          <label className={styles.permissionSearch}>
            <span className={styles.visuallyHidden}>권한 검색</span>
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="업무 또는 권한 검색" />
          </label>
          <Button size="small" variant="secondary" onPress={() => onTechnicalChange(!technical)}>
            {technical ? "업무별 간편 보기" : "권한 코드 보기"}
          </Button>
        </div>
      </div>
      {technical ? (
        <div className={styles.permissionMatrix}>
          <div className={styles.permissionHeader}><span>권한 코드</span><span>사용</span><span>위임</span></div>
          {permissions.map((permission) => (
            <div className={styles.permissionRow} key={permission.key}>
              <span className={styles.permissionName}><code>{permission.key}</code><span>{permissionTaskName(permission.key)} · {permissionCategoryName(permission.category)}</span></span>
              <label className={styles.checkboxCell}><input aria-label={`${permission.key} 사용`} type="checkbox" checked={selected.includes(permission.key)} disabled={readOnly} onChange={(event) => onPermissionChange(permission.key, event.target.checked)} /></label>
              <label className={styles.checkboxCell}><input aria-label={`${permission.key} 위임`} type="checkbox" checked={delegated.includes(permission.key)} disabled={readOnly || !selected.includes(permission.key) || !permission.delegatable || permission.protected} onChange={(event) => onDelegationChange(permission.key, event.target.checked)} /></label>
            </div>
          ))}
          {permissions.length === 0 ? <div className={styles.permissionEmpty}>검색 조건에 맞는 권한이 없습니다.</div> : null}
        </div>
      ) : (
        <div className={styles.permissionGroups}>
          {[...groups.entries()].map(([category, items]) => {
            const selectedCount = items.filter(({ key }) => selected.includes(key)).length;
            return (
              <section className={styles.permissionGroup} key={category}>
                <div className={styles.permissionGroupHeader}>
                  <div><strong>{permissionCategoryName(category)}</strong><span>{items.length}개 업무</span></div>
                  <Badge tone={selectedCount > 0 ? "success" : "neutral"}>{selectedCount}개 허용</Badge>
                </div>
                <div className={styles.permissionTaskList}>
                  {items.map((permission) => {
                    const mode = modeOf(permission.key);
                    return (
                      <article className={styles.permissionTask} key={permission.key} data-enabled={mode !== "none"}>
                        <div className={styles.permissionTaskIdentity}>
                          <strong>{permissionTaskName(permission.key)}</strong>
                          <code>{permission.key}</code>
                          {permission.hierarchyGuard !== "none" ? <span>대상과의 권한 레벨을 함께 확인합니다.</span> : null}
                        </div>
                        <div className={styles.permissionModes} role="radiogroup" aria-label={`${permissionTaskName(permission.key)} 권한 수준`}>
                          {(["none", "use", "delegate"] as const).map((option) => {
                            const disabled = readOnly || (option === "delegate" && (!permission.delegatable || permission.protected));
                            const label = option === "none" ? "허용 안 함" : option === "use" ? "사용" : "사용 + 위임";
                            return (
                              <label key={option} data-selected={mode === option} data-disabled={disabled}>
                                <input
                                  type="radio"
                                  name={`permission-${permission.key}`}
                                  value={option}
                                  checked={mode === option}
                                  disabled={disabled}
                                  onChange={() => setMode(permission.key, option)}
                                />
                                <span>{label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {permissions.length === 0 ? <div className={styles.permissionEmpty}>검색 조건에 맞는 업무가 없습니다.</div> : null}
        </div>
      )}
    </div>
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
    case "children": return "하위만 (현재 제외)";
    case "self-and-children": return "현재 + 모든 하위";
  }
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

export function AccessSimulatorPage() {
  const { authorization, realmId } = useAuthorizationWorkspace();
  const policy = useAuthorizationPolicy();
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
      <div><strong>설정을 바꾸지 않고 현재 권한만 안전하게 확인합니다.</strong><p>특정 권한의 상세 판정은 아래 고급 진단에서 별도로 실행할 수 있습니다.</p></div>
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
          <details className={styles.advancedDetails}>
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
          </details>
          <MutationError error={simulation.error ?? effectivePermissions.error} />
        </div>
      </section>
      <div className={styles.stack}><EffectivePermissionList policy={policy.data} results={effectivePermissions.data ?? null} /><DecisionExplanation policy={policy.data} decision={simulation.data ?? null} /></div>
    </div>
  </Page>;
}

function EffectivePermissionList({
  policy,
  results,
}: {
  readonly policy: AuthorizationPolicy;
  readonly results: readonly {
    readonly permission: AuthorizationPolicy["permissions"][number];
    readonly supported: boolean;
    readonly decision: AuthorizationDecision | null;
  }[] | null;
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
            <div><strong>{permissionTaskName(permission.key)}</strong><code>{permission.key}</code></div>
            <Badge tone={!supported ? "neutral" : decision?.allowed ? "success" : "danger"}>{!supported ? "추가 정보 필요" : decision?.allowed ? "가능" : "불가"}</Badge>
            <span>{supported ? decisionReasonName(decision?.reasonCode ?? "") : hierarchyContextDescription(permission.hierarchyGuard)}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function hierarchyContextDescription(
  guard: AuthorizationPolicy["permissions"][number]["hierarchyGuard"],
): string {
  switch (guard) {
    case "target-role": return "대상 역할의 Authority Level context가 필요합니다.";
    case "target-binding": return "대상 바인딩의 역할·주체·Scope context가 필요합니다.";
    case "target-subject": return "대상 사용자의 Authority Level과 보호 상태 context가 필요합니다.";
    case "none": return "";
  }
}

function decisionReasonName(code: string): string {
  const names: Readonly<Record<string, string>> = {
    PERMISSION_GRANTED: "필요한 역할과 권한이 적용되어 있습니다.",
    ALLOW_PERMISSION: "필요한 역할과 권한이 적용되어 있습니다.",
    ALLOW_REALM_FULL_ACCESS: "이 Realm의 전체 접근 권한이 적용되어 있습니다.",
    PERMISSION_NOT_GRANTED: "이 업무를 허용하는 역할이 배정되지 않았습니다.",
    DENY_PERMISSION: "이 업무를 허용하는 역할이 배정되지 않았습니다.",
    CONSTRAINT_NOT_SATISFIED: "배정된 역할의 기간·소유자·상태 조건과 일치하지 않습니다.",
    RESOURCE_NOT_IN_SCOPE: "역할이 적용되는 영역 밖에 있습니다.",
    SUBJECT_DISABLED: "사용자 또는 그룹이 비활성화되어 있습니다.",
    HIERARCHY_CONTEXT_REQUIRED: "대상과의 권한 레벨 정보가 더 필요합니다.",
  };
  return names[code] ?? "현재 정책 조건에 따라 판정되었습니다.";
}

function DecisionExplanation({ policy, decision }: { readonly policy: AuthorizationPolicy; readonly decision: AuthorizationDecision | null }) {
  if (decision === null) return <section className={styles.panel}><EmptyState title="상세 진단 결과" description="특정 권한 상세 진단을 실행하면 적용된 역할과 그룹 경로를 확인할 수 있습니다." /></section>;
  return <section className={styles.decisionCard} data-allowed={decision.allowed}><div className={styles.decisionTitle}><Badge tone={decision.allowed ? "success" : "danger"}>{decision.allowed ? "허용됨" : "허용되지 않음"}</Badge><strong>{decisionReasonName(decision.reasonCode)}</strong></div><div className={styles.auditMeta}><span>{permissionTaskName(decision.action)}</span><span>정책 Revision {decision.policyRevision}</span>{decision.actorLevel === undefined ? null : <span>사용자 레벨 {decision.actorLevel}</span>}</div><details className={styles.decisionTechnical}><summary>기술 정보 보기</summary><code>{decision.reasonCode}</code><code>{decision.action}</code></details><div className={styles.grantList}>{decision.matchedGrants.map((grant) => <div className={styles.grant} key={`${grant.sourceBindingId}:${grant.permission}`}><strong>{roleNameOf(policy, grant.sourceRoleId)} · 레벨 {grant.sourceRank}</strong><span>{resourceNameOf(policy, grant.sourceResourceId)} · {propagationLabel(grant.sourcePropagation)}</span>{grant.membershipPath.length ? <span>그룹 경로: {grant.membershipPath.map((id) => subjectNameOf(policy, id)).join(" → ")}</span> : <span>직접 배정됨</span>}</div>)}</div></section>;
}

export function AccessAuditPage() {
  const { authorization, auditKey, realmId } = useAuthorizationWorkspace();
  const policy = useAuthorizationPolicy();
  const audit = useQuery({ queryKey: auditKey, queryFn: () => authorization.listAudit() });
  if (policy.isPending || audit.isPending) return <Page><PageLoading label="감사 로그를 불러오는 중" /></Page>;
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;
  if (audit.isError) return <Page><LoadError error={audit.error} onRetry={() => void audit.refetch()} /></Page>;
  return <Page><PageHeader eyebrow={realmId ? "Content Realm audit" : "Security audit"} title="정책 변경 감사" description="정책 구조 변경의 actor, target, before/after와 판정 근거를 보존합니다." /><AccessWorkspaceNav />{audit.data.items.length === 0 ? <EmptyState title="감사 이벤트가 없습니다" description="역할이나 바인딩을 변경하면 이곳에 기록됩니다." /> : <div className={styles.auditList}>{audit.data.items.map((entry) => <article className={styles.auditItem} key={entry.id}><div className={styles.rowBetween}><div><strong>{entry.action}</strong><div className={styles.hint}>{entry.targetType} · {entry.targetId}</div></div><Badge>r{entry.policyRevision}</Badge></div><div className={styles.auditMeta}><span>{new Date(entry.occurredAt).toLocaleString("ko-KR")}</span><span>Actor {subjectNameOf(policy.data, entry.actorSubjectId)}</span><span>{entry.decision?.reasonCode ?? "BOOTSTRAP"}</span></div><details><summary>변경 전후 보기</summary><div className={styles.diff}><pre>{JSON.stringify(entry.before, null, 2)}</pre><pre>{JSON.stringify(entry.after, null, 2)}</pre></div></details></article>)}</div>}</Page>;
}
