import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthorizationLevel, AuthorizationPolicy, AuthorizationRole } from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, EmptyState } from "@xecms/ui";
import gradeStyles from "../../access-grades.module.css";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { AdvancedConfigNotice, PolicyMutationError } from "./guardrails.js";
import {
  droppedDelegations,
  gradePermissionEdit,
  levelSimpleState,
  memberCountByLevel,
  rankBetween,
  sortedLevels,
  type LevelSimpleState,
} from "./policy-simple-view.js";
import { permissionCategoryName, permissionTaskName } from "./vocabulary.js";
import { accessBasePath, canMutateAuthorization, useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";

type SheetState =
  | { readonly kind: "edit"; readonly levelId: string }
  | { readonly kind: "create" }
  | null;

export function AccessGradesPage() {
  const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const policy = useAuthorizationPolicy();
  const [sheet, setSheet] = useState<SheetState>(null);
  const basePath = accessBasePath(realmId);

  const ensureRole = useMutation({
    mutationFn: async (level: AuthorizationLevel) => authorization.createRole({
      name: level.name,
      levelId: level.id,
      permissions: [],
      delegatablePermissions: [],
      fieldAccess: [],
      expectedPolicyRevision: policy.data!.revision,
    }),
    onSuccess: (next, level) => {
      queryClient.setQueryData(policyKey, next);
      setSheet({ kind: "edit", levelId: level.id });
    },
  });

  if (policy.isPending) return <Page><PageLoading label="등급 정보를 불러오는 중" /></Page>;
  if (policy.isError) return <Page><RealmAuthorizationError error={policy.error} context="policy" realmId={realmId} onRetry={() => void policy.refetch()} /></Page>;

  const levels = sortedLevels(policy.data);
  const counts = memberCountByLevel(policy.data);
  const writable = canMutateAuthorization(policy.data, realmId);
  const closeSheet = () => setSheet(null);
  const editingLevel = sheet?.kind === "edit"
    ? levels.find(({ id }) => id === sheet.levelId) ?? null
    : null;

  return (
    <Page>
      <PageHeader
        eyebrow={realmId ? "Content Realm" : "Workspace"}
        title="등급 관리"
        description="멤버 등급마다 할 수 있는 일을 정합니다. 위에 있는 등급이 아래 등급을 관리합니다."
        actions={writable ? <Button onPress={() => setSheet({ kind: "create" })}>새 등급</Button> : undefined}
      />
      <AccessWorkspaceNav policy={policy.data} />
      <div className={`${styles.layout} ${styles.rolesLayout}`}>
        <div className={gradeStyles.gradeList}>
          {levels.map((level) => (
            <GradeCard
              key={level.id}
              policy={policy.data}
              level={level}
              memberCount={counts.get(level.id) ?? 0}
              onEdit={() => setSheet({ kind: "edit", levelId: level.id })}
              onDefine={() => ensureRole.mutate(level)}
              definePending={ensureRole.isPending}
              readOnly={!writable}
            />
          ))}
          <PolicyMutationError error={ensureRole.error} policyKey={policyKey} />
        </div>
        {sheet !== null ? <button className={styles.drawerBackdrop} type="button" aria-label="편집 패널 닫기" onClick={closeSheet} /> : null}
        <div className={styles.detailPane} data-open={sheet !== null}>
          {sheet !== null ? (
            <div className={styles.drawerHeader}>
              <strong>{sheet.kind === "create" ? "새 등급" : editingLevel?.name ?? "등급"}</strong>
              <Button size="small" variant="quiet" onPress={closeSheet}>닫기</Button>
            </div>
          ) : null}
          {sheet === null ? (
            <section className={`${styles.panel} ${styles.inspectorEmpty}`}>
              <EmptyState title="등급을 선택하세요" description="등급 카드에서 권한 편집을 누르면 이곳에서 할 수 있는 일을 정할 수 있습니다." />
            </section>
          ) : sheet.kind === "create" ? (
            writable ? <GradeCreator policy={policy.data} onClose={closeSheet} onCreated={(levelId) => setSheet({ kind: "edit", levelId })} /> : null
          ) : editingLevel === null ? null : (
            <GradePermissionSheet
              key={editingLevel.id}
              policy={policy.data}
              level={editingLevel}
              basePath={basePath}
              forcedReadOnly={!writable}
              onClose={closeSheet}
            />
          )}
        </div>
      </div>
    </Page>
  );
}

function roleCategorySummary(policy: AuthorizationPolicy, role: AuthorizationRole): string {
  const categoryByKey = new Map(policy.permissions.map((permission) => [permission.key, permission.category]));
  const categories = [...new Set(role.permissions
    .map((key) => categoryByKey.get(key))
    .filter((category): category is string => category !== undefined))];
  return categories.length === 0 ? "아직 정해진 업무 없음" : categories.map(permissionCategoryName).join(" · ") + " 담당";
}

function GradeCard({ policy, level, memberCount, onEdit, onDefine, definePending, readOnly }: {
  readonly policy: AuthorizationPolicy;
  readonly level: AuthorizationLevel;
  readonly memberCount: number;
  readonly onEdit: () => void;
  readonly onDefine: () => void;
  readonly definePending: boolean;
  readonly readOnly: boolean;
}) {
  const state = levelSimpleState(policy, level);
  const permissionCount = state.kind === "editable"
    ? state.role.permissions.length
    : state.kind === "empty"
      ? 0
      : [...new Set(state.roles.flatMap(({ permissions }) => permissions))].length;
  return (
    <section className={gradeStyles.gradeCard} data-locked={state.kind === "protected"} aria-label={`${level.name} 등급`}>
      <div className={gradeStyles.gradeHeader}>
        <div className={gradeStyles.gradeIdentity}>
          <h2>{level.name}</h2>
          <div className={gradeStyles.gradeMeta}>
            <span>멤버 {memberCount}명</span>
            <span>할 수 있는 일 {permissionCount}개</span>
            {state.kind === "aggregate" ? <span>역할 {state.roles.length}개</span> : null}
          </div>
        </div>
        <div className={gradeStyles.gradeActions}>
          {state.kind === "protected" ? (
            <>
              <Badge>기본 제공</Badge>
              <Button size="small" variant="quiet" onPress={onEdit}>구성 보기</Button>
            </>
          ) : state.kind === "editable" ? (
            <Button size="small" variant="secondary" onPress={onEdit}>{readOnly ? "구성 보기" : "권한 편집"}</Button>
          ) : state.kind === "empty" ? (
            readOnly ? <Badge tone="info">읽기 전용</Badge> : <Button size="small" variant="secondary" onPress={onDefine} isDisabled={definePending}>이 등급의 권한 정하기</Button>
          ) : (
            <Button size="small" variant="quiet" onPress={onEdit}>구성 보기</Button>
          )}
        </div>
      </div>
      {state.kind === "aggregate" ? (
        <div className={gradeStyles.gradeRoleSplit}>
          <p>이 등급은 담당 업무별로 역할이 나뉘어 있어요. 전체 구성은 그대로 확인할 수 있고, 역할별 편집은 표준 모드에서 할 수 있어요.</p>
          {state.roles.map((role) => (
            <div className={gradeStyles.gradeRoleRow} key={role.id}>
              <strong>{role.name}</strong>
              <span>{roleCategorySummary(policy, role)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {state.kind === "protected" ? (
        <div className={gradeStyles.gradeMeta}>
          {level.rank >= 100 ? "워크스페이스의 최고 관리 등급이에요. 항상 모든 일을 할 수 있어 변경할 수 없어요." : "로그인하지 않은 방문자 등급이에요. 안전을 위해 변경할 수 없어요."}
        </div>
      ) : null}
    </section>
  );
}

function GradePermissionSheet({ policy, level, basePath, forcedReadOnly, onClose }: {
  readonly policy: AuthorizationPolicy;
  readonly level: AuthorizationLevel;
  readonly basePath: string;
  readonly forcedReadOnly: boolean;
  readonly onClose: () => void;
}) {
  const { authorization, policyKey } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const state = levelSimpleState(policy, level);
  const readOnly = forcedReadOnly || state.kind !== "editable";
  const role = state.kind === "editable" ? state.role : null;
  const unionPermissions = useMemo(() => state.kind === "editable"
    ? state.role.permissions
    : state.kind === "empty" ? [] : [...new Set(state.roles.flatMap(({ permissions }) => permissions))], [state]);

  // 간단 모드 시트에 노출하는 권한 카탈로그(위임 가능·비보호). 역할이 이미 가진
  // 비노출 권한은 저장 시 그대로 보존한다.
  const visibleCatalog = useMemo(() => policy.permissions.filter(
    (permission) => readOnly || (permission.delegatable && !permission.protected),
  ), [policy.permissions, readOnly]);
  const visibleKeys = useMemo(() => new Set(visibleCatalog.map(({ key }) => key)), [visibleCatalog]);
  const hiddenGranted = useMemo(
    () => (role?.permissions ?? []).filter((key) => !visibleKeys.has(key)),
    [role, visibleKeys],
  );

  const [selected, setSelected] = useState<readonly string[]>(
    () => (role?.permissions ?? unionPermissions).filter((key) => visibleKeys.has(key)),
  );
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const nextPermissions = [...hiddenGranted, ...selected];
      return authorization.updateRole(role!.id, {
        ...gradePermissionEdit(role!, nextPermissions),
        expectedPolicyRevision: policy.revision,
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(policyKey, next);
      setConfirming(false);
      onClose();
    },
    onError: () => setConfirming(false),
  });

  const groups = useMemo(() => {
    const map = new Map<string, typeof visibleCatalog>();
    for (const permission of visibleCatalog) {
      map.set(permission.category, [...(map.get(permission.category) ?? []), permission]);
    }
    return [...map.entries()];
  }, [visibleCatalog]);

  const toggle = (key: string, on: boolean) => {
    setSelected((current) => on ? [...new Set([...current, key])] : current.filter((item) => item !== key));
  };
  const toggleCategory = (keys: readonly string[], on: boolean) => {
    setSelected((current) => on
      ? [...new Set([...current, ...keys])]
      : current.filter((item) => !keys.includes(item)));
  };

  const originalVisible = (role?.permissions ?? unionPermissions).filter((key) => visibleKeys.has(key));
  const added = selected.filter((key) => !originalVisible.includes(key));
  const removed = originalVisible.filter((key) => !selected.includes(key));
  const dirty = added.length > 0 || removed.length > 0;
  const dropped = role === null ? [] : droppedDelegations(role, [...hiddenGranted, ...selected]);

  return (
    <section className={styles.panel} aria-label="등급 권한 편집기">
      <SectionHeader
        title={readOnly ? `${level.name} 등급 구성` : `${level.name} 등급의 권한`}
        description={readOnly
          ? "이 등급이 할 수 있는 일을 한눈에 보여 드려요."
          : "이 등급의 멤버가 할 수 있는 일을 체크하세요."}
        actions={readOnly ? <Badge>읽기 전용</Badge> : undefined}
      />
      {state.kind === "aggregate" ? (
        <AdvancedConfigNotice
          message="이 등급은 담당 업무별로 역할이 나뉘어 있어 여기서는 전체 구성만 보여 드려요."
          reasons={state.roles.map((item) => `${item.name} — ${roleCategorySummary(policy, item)}`)}
          to={`${basePath}/roles`}
          actionLabel="표준 모드에서 역할별로 편집"
        />
      ) : null}
      {state.kind === "protected" ? (
        <Callout tone="info">기본 제공 등급은 시스템 동작에 필요해 구성을 바꿀 수 없어요.</Callout>
      ) : null}
      <div className={gradeStyles.sheetGroups}>
        {groups.map(([category, items]) => {
          const keys = items.map(({ key }) => key);
          const activeKeys = readOnly ? unionPermissions : selected;
          const checkedCount = keys.filter((key) => activeKeys.includes(key)).length;
          return (
            <section className={gradeStyles.sheetGroup} key={category}>
              <div className={gradeStyles.sheetGroupHeader}>
                <strong>{permissionCategoryName(category)}</strong>
                {!readOnly ? (
                  <CategoryToggle
                    label={`${permissionCategoryName(category)} 전체 선택`}
                    total={keys.length}
                    checked={checkedCount}
                    onChange={(on) => toggleCategory(keys, on)}
                  />
                ) : <span className={styles.hint}>{checkedCount}/{keys.length}개</span>}
              </div>
              {items.map((permission) => (
                <label className={gradeStyles.sheetTask} key={permission.key} data-readonly={readOnly}>
                  <input
                    type="checkbox"
                    checked={(readOnly ? unionPermissions : selected).includes(permission.key)}
                    disabled={readOnly}
                    onChange={(event) => toggle(permission.key, event.target.checked)}
                  />
                  <span>{permissionTaskName(permission.key)}</span>
                </label>
              ))}
            </section>
          );
        })}
      </div>
      {!readOnly ? (
        <>
          <div className={gradeStyles.sheetSummary}>
            <span>{selected.length}개 업무 허용{dirty ? ` · 추가 ${added.length} / 해제 ${removed.length}` : ""}</span>
          </div>
          <div className={styles.formActions}>
            <Button variant="quiet" onPress={onClose} isDisabled={save.isPending}>취소</Button>
            <Button onPress={() => setConfirming(true)} isDisabled={!dirty || save.isPending}>저장</Button>
          </div>
        </>
      ) : null}
      <PolicyMutationError error={save.error} policyKey={policyKey} />
      {confirming ? (
        <ConfirmDialog
          title={`${level.name} 등급의 권한 변경`}
          confirmLabel="변경 저장"
          isPending={save.isPending}
          onConfirm={() => save.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>{level.name} 등급의 권한 {added.length + removed.length}개를 변경합니다. 이 등급의 모든 멤버에게 바로 적용돼요.</p>
          {dropped.length > 0 ? (
            <p>해제하는 권한에는 고급 설정(아래 등급으로 넘겨주기)이 있어요. 함께 해제됩니다: {dropped.map(permissionTaskName).join(", ")}</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function CategoryToggle({ label, total, checked, onChange }: {
  readonly label: string;
  readonly total: number;
  readonly checked: number;
  readonly onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = checked > 0 && checked < total;
  }, [checked, total]);
  return (
    <label className={gradeStyles.sheetGroupToggle}>
      <input
        ref={ref}
        type="checkbox"
        aria-label={label}
        checked={total > 0 && checked === total}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>전체 선택</span>
    </label>
  );
}

function GradeCreator({ policy, onClose, onCreated }: {
  readonly policy: AuthorizationPolicy;
  readonly onClose: () => void;
  readonly onCreated: (levelId: string) => void;
}) {
  const { authorization, policyKey } = useAuthorizationWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slot, setSlot] = useState("");
  const [recoveryLevel, setRecoveryLevel] = useState<AuthorizationLevel | null>(null);

  const levels = sortedLevels(policy);
  const slots = levels.slice(0, -1).map((upper, index) => {
    const lower = levels[index + 1]!;
    return {
      id: `${upper.id}:${lower.id}`,
      label: `${upper.name} 아래 · ${lower.name} 위`,
      rank: rankBetween(upper.rank, lower.rank),
    };
  });
  const selectedSlot = slots.find(({ id }) => id === slot);

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      const rank = selectedSlot!.rank!;
      const afterLevel = await authorization.createLevel({
        name: trimmed,
        rank,
        expectedPolicyRevision: policy.revision,
      });
      queryClient.setQueryData(policyKey, afterLevel);
      const level = afterLevel.levels.find((item) => item.name === trimmed && item.rank === rank);
      if (level === undefined) throw new Error("등급이 만들어졌지만 정보를 다시 불러와야 해요.");
      try {
        const afterRole = await authorization.createRole({
          name: trimmed,
          levelId: level.id,
          permissions: [],
          delegatablePermissions: [],
          fieldAccess: [],
          expectedPolicyRevision: afterLevel.revision,
        });
        queryClient.setQueryData(policyKey, afterRole);
        return level.id;
      } catch (error) {
        setRecoveryLevel(level);
        throw error;
      }
    },
    onSuccess: onCreated,
  });

  const retryRole = useMutation({
    mutationFn: async () => {
      const current = queryClient.getQueryData<AuthorizationPolicy>([...policyKey]);
      return authorization.createRole({
        name: recoveryLevel!.name,
        levelId: recoveryLevel!.id,
        permissions: [],
        delegatablePermissions: [],
        fieldAccess: [],
        expectedPolicyRevision: (current ?? policy).revision,
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(policyKey, next);
      const levelId = recoveryLevel!.id;
      setRecoveryLevel(null);
      onCreated(levelId);
    },
  });

  if (recoveryLevel !== null) {
    return (
      <section className={styles.panel}>
        <SectionHeader title="등급은 만들어졌어요" description="권한 설정만 다시 시도하면 돼요." />
        <Callout tone="warning">
          <strong>{recoveryLevel.name} 등급은 만들어졌지만 권한 설정 준비가 끝나지 않았어요.</strong>
          <div>다시 시도하거나, 나중에 등급 카드의 "이 등급의 권한 정하기"로 이어서 할 수 있어요.</div>
        </Callout>
        <div className={styles.formActions}>
          <Button variant="quiet" onPress={onClose} isDisabled={retryRole.isPending}>나중에 하기</Button>
          <Button onPress={() => retryRole.mutate()} isDisabled={retryRole.isPending}>권한 설정 다시 시도</Button>
        </div>
        <PolicyMutationError error={retryRole.error} policyKey={policyKey} />
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <SectionHeader title="새 등급" description="등급 이름과 위치만 정하면 바로 권한을 고를 수 있어요." />
      <div className={styles.form}>
        <label className={styles.field}><span>등급 이름</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 우수 멤버" /></label>
        <label className={styles.field}>
          <span>어느 위치에 둘까요?</span>
          <select value={slot} onChange={(event) => setSlot(event.target.value)}>
            <option value="">선택해 주세요</option>
            {slots.map((item) => (
              <option key={item.id} value={item.id} disabled={item.rank === null}>
                {item.label}{item.rank === null ? " · 지금은 만들 수 없어요" : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedSlot?.rank === null ? (
          <Callout tone="info">이 위치에는 지금 새 등급을 만들 수 없어요. 다른 위치를 선택하거나 관리자에게 문의해 주세요.</Callout>
        ) : null}
        <div className={styles.formActions}>
          <Button variant="quiet" onPress={onClose} isDisabled={create.isPending}>취소</Button>
          <Button
            onPress={() => create.mutate()}
            isDisabled={create.isPending || name.trim() === "" || selectedSlot === undefined || selectedSlot.rank === null}
          >등급 만들기</Button>
        </div>
        <PolicyMutationError error={create.error} policyKey={policyKey} />
      </div>
    </section>
  );
}
