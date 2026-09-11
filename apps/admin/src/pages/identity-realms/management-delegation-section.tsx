import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi, type IdentityRealm, type RealmManagementDelegation, type RealmManagementDelegationList, type ManagementAction, type DelegationScopeRule } from "@xecms/admin";
import { Button, Callout, CheckboxField, ConfirmDialog, EmptyState, SelectField, TextInput } from "@xecms/ui";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { SectionHeader } from "../../components/page.js";
import { DisplayModeGate } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { AddTargetDialog } from "./add-target-dialog.js";
import { MutationError, IdValue } from "./shared.js";

/** UI grouping of management actions the CMS may delegate. */
const MANAGEMENT_ACTION_ITEMS: readonly {
  readonly action: ManagementAction;
  readonly label: string;
}[] = [
  { action: "identity.credentials.reset", label: "비밀번호 재설정" },
  { action: "identity.disable", label: "계정 비활성/재활성" },
  { action: "identity.session.revoke", label: "세션 폐기" },
  { action: "identity.update", label: "계정 정보 수정" },
  { action: "membership.suspend", label: "소속 정지" },
  { action: "membership.reactivate", label: "소속 재활성" },
  { action: "membership.provision", label: "소속 부여" },
];

function delegationActionSummary(delegation: RealmManagementDelegation): string {
  const labels = MANAGEMENT_ACTION_ITEMS
    .filter((item) => delegation.actions.includes(item.action))
    .map((item) => item.label);
  return labels.length === 0 ? "없음" : labels.join(" · ");
}

/**
 * Cross-realm user administration: which OTHER realms this realm's operators may
 * administer, and how (per-action any/all). Declared by the CMS Owner. Read here
 * as `managingRealmId = realm`.
 */
export function RealmManagementDelegationSection({ realm, realms }: {
  readonly realm: IdentityRealm;
  readonly realms: readonly IdentityRealm[];
}) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{
    readonly managedRealm: IdentityRealm;
    readonly current: RealmManagementDelegation | undefined;
  } | null>(null);
  const [removing, setRemoving] = useState<RealmManagementDelegation | null>(null);
  const [adding, setAdding] = useState(false);

  const delegations = useQuery({
    queryKey: queryKeys.realmDelegations(realm.realmId),
    queryFn: () => api.identityRealms.listManagementDelegations(realm.realmId),
  });

  // Candidate managed realms: other active content realms in the workspace.
  const candidates = realms.filter(
    (r) => r.kind === "content" && r.realmId !== realm.realmId,
  );
  const byManagedId = new Map(
    (delegations.data?.delegations ?? []).map((d) => [d.managedRealmId, d] as const),
  );
  const realmName = new Map(realms.map((r) => [r.realmId, r.name] as const));
  // Only realms with an actual delegation get a row; the rest sit in the picker.
  const delegated = candidates.filter((r) => byManagedId.has(r.realmId));
  const addable = candidates.filter((r) => !byManagedId.has(r.realmId));

  return (
    <section className={styles.panel} aria-labelledby="realm-delegation-title">
      <SectionHeader
        id="realm-delegation-title"
        title="다른 공간 사용자 관리 위임"
        description="이 공간의 관리자가 다른 공간의 사용자를 어디까지 관리할 수 있는지 CMS에서 정합니다. (비밀번호 재설정·계정 잠금 해제 등)"
        actions={
          <Button
            size="small"
            variant="secondary"
            isDisabled={realm.status !== "active" || addable.length === 0}
            onPress={() => setAdding(true)}
          >위임 추가</Button>
        }
      />
      <Callout tone="info">
        여기서 허용한 범위 안에서만, 이 공간의 사용자 관리 권한자가 대상 공간 사용자를 관리할 수 있습니다. CMS 계정은 대상이 되지 않습니다.
      </Callout>
      {delegations.isPending ? <PageLoading label="관리 위임을 불러오는 중" /> : null}
      {delegations.isError ? (
        <LoadError error={delegations.error} onRetry={() => void delegations.refetch()} />
      ) : null}
      {candidates.length === 0 ? (
        <EmptyState title="위임할 다른 공간이 없습니다" description="같은 워크스페이스에 다른 사용자 공간이 있어야 관리 위임을 설정할 수 있습니다." />
      ) : delegated.length === 0 ? (
        <EmptyState
          title="위임한 공간이 없습니다"
          description="이 공간의 관리자는 다른 공간의 사용자를 관리할 수 없습니다. 「위임 추가」로 대상 공간을 고르세요."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.entitlementTable}`}>
            <thead>
              <tr>
                <th>대상 공간</th>
                <th>허용 관리 작업</th>
                <th>판정</th>
                <th className={styles.entitlementActionsHead}>작업</th>
              </tr>
            </thead>
            <tbody>
              {delegated.map((managedRealm) => {
                const current = byManagedId.get(managedRealm.realmId) as RealmManagementDelegation;
                return (
                  <tr key={managedRealm.realmId} data-has-entitlement>
                    <td>
                      <div className={styles.entitlementName}>
                        <span className={styles.entitlementNameRow}>
                          <strong>{managedRealm.name}</strong>
                        </span>
                        <DisplayModeGate minimum="advanced">
                          <IdValue label="Realm ID" value={managedRealm.realmId} />
                        </DisplayModeGate>
                      </div>
                    </td>
                    <td><span className={styles.entitlementActions}>{delegationActionSummary(current)}</span></td>
                    <td>{delegationScopeSummary(current)}</td>
                    <td>
                      <div className={styles.entitlementRowActions}>
                        <Button
                          size="small"
                          variant="secondary"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setEditing({ managedRealm, current })}
                        >편집</Button>
                        <Button
                          size="small"
                          variant="danger"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setRemoving(current)}
                        >제거</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {addable.length > 0 && delegated.length > 0 ? (
        <p className={styles.compactHint}>
          나머지 공간 {addable.length}개는 이 공간이 관리할 수 없습니다.
        </p>
      ) : null}
      {adding ? (
        <AddTargetDialog
          title="사용자 관리를 위임할 공간"
          description="고른 공간에 대해 허용할 관리 작업을 이어서 정합니다."
          searchLabel="사용자 공간 검색"
          items={addable}
          keyOf={(r) => r.realmId}
          labelOf={(r) => r.name}
          hintOf={(r) => r.realmKey}
          emptyText="위임을 추가할 수 있는 공간이 없습니다."
          onClose={() => setAdding(false)}
          onPick={(managedRealm) => {
            setAdding(false);
            setEditing({ managedRealm, current: undefined });
          }}
        />
      ) : null}
      {editing ? (
        <DelegationEditDialog
          managingRealm={realm}
          managedRealm={editing.managedRealm}
          current={editing.current}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            queryClient.setQueryData<RealmManagementDelegationList>(
              queryKeys.realmDelegations(realm.realmId),
              (previous) => mergeDelegation(previous, saved, realm.realmId),
            );
            setEditing(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.managedByDelegations(saved.managedRealmId),
            });
          }}
        />
      ) : null}
      {removing ? (
        <DelegationRemoveDialog
          managingRealm={realm}
          delegation={removing}
          managedRealmName={realmName.get(removing.managedRealmId) ?? removing.managedRealmId}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            const managedRealmId = removing.managedRealmId;
            queryClient.setQueryData<RealmManagementDelegationList>(
              queryKeys.realmDelegations(realm.realmId),
              (previous) => previous === undefined ? previous : {
                ...previous,
                delegations: previous.delegations.filter((d) => d.managedRealmId !== managedRealmId),
              },
            );
            setRemoving(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.managedByDelegations(managedRealmId),
            });
          }}
        />
      ) : null}
    </section>
  );
}

function delegationScopeSummary(delegation: RealmManagementDelegation): string {
  const rules = new Set(delegation.actions.map((a) => delegation.scopeByAction[a] ?? "all"));
  if (rules.size === 0) return "—";
  if (rules.size > 1) return "작업별 상이";
  return rules.has("any") ? "느슨(하나라도 관리 대상)" : "엄격(모든 소속 관리 대상)";
}

function mergeDelegation(
  previous: RealmManagementDelegationList | undefined,
  saved: RealmManagementDelegation,
  managingRealmId: string,
): RealmManagementDelegationList {
  if (previous === undefined) return { managingRealmId, delegations: [saved] };
  const others = previous.delegations.filter((d) => d.managedRealmId !== saved.managedRealmId);
  return { ...previous, delegations: [...others, saved] };
}

function DelegationEditDialog({ managingRealm, managedRealm, current, onClose, onSaved }: {
  readonly managingRealm: IdentityRealm;
  readonly managedRealm: IdentityRealm;
  readonly current: RealmManagementDelegation | undefined;
  readonly onClose: () => void;
  readonly onSaved: (saved: RealmManagementDelegation) => void | Promise<void>;
}) {
  const api = useAdminApi();
  const [actions, setActions] = useState<ReadonlySet<ManagementAction>>(
    () => new Set(current?.actions ?? []),
  );
  const [scopeByAction, setScopeByAction] = useState<Readonly<Partial<Record<ManagementAction, DelegationScopeRule>>>>(
    () => ({ ...(current?.scopeByAction ?? {}) }),
  );
  const [password, setPassword] = useState("");

  const toggleAction = (action: ManagementAction, on: boolean) => {
    setActions((previous) => {
      const next = new Set(previous);
      if (on) next.add(action); else next.delete(action);
      return next;
    });
  };
  const setScope = (action: ManagementAction, rule: DelegationScopeRule) =>
    setScopeByAction((previous) => ({ ...previous, [action]: rule }));

  const save = useMutation({
    mutationFn: () => {
      const selected = MANAGEMENT_ACTION_ITEMS
        .map((item) => item.action)
        .filter((action) => actions.has(action));
      const scope: Partial<Record<ManagementAction, DelegationScopeRule>> = {};
      for (const action of selected) scope[action] = scopeByAction[action] ?? "all";
      return api.identityRealms.putManagementDelegation(managingRealm.realmId, managedRealm.realmId, {
        actions: selected,
        scopeByAction: scope,
        expectedRevision: current?.revision ?? null,
        password,
      });
    },
    onSuccess: (saved) => { void onSaved(saved); },
  });

  return (
    <ConfirmDialog
      title={`${managedRealm.name} 사용자 관리 위임`}
      confirmLabel={current === undefined ? "위임" : "저장"}
      isPending={save.isPending}
      isConfirmDisabled={password === "" || actions.size === 0}
      onCancel={() => { onClose(); save.reset(); }}
      onConfirm={() => save.mutate()}
    >
      <div className={styles.entitlementDialog}>
        <p className={styles.compactHint}><strong>{managingRealm.name}</strong>의 사용자 관리 권한자가 <strong>{managedRealm.name}</strong> 사용자에게 할 수 있는 작업을 고릅니다.</p>
        <div className={styles.entitlementGroup}>
          <h4>허용 관리 작업</h4>
          {MANAGEMENT_ACTION_ITEMS.map((item) => (
            <div key={item.action}>
              <CheckboxField
                isSelected={actions.has(item.action)}
                onChange={(on) => toggleAction(item.action, on)}
              >{item.label}</CheckboxField>
              {actions.has(item.action) ? (
                <SelectField
                  label={`${item.label} 판정`}
                  value={scopeByAction[item.action] ?? "all"}
                  options={[
                    { value: "all", label: "엄격 — 대상의 모든 소속이 관리 대상일 때만" },
                    { value: "any", label: "느슨 — 대상의 소속 중 하나라도 관리 대상이면" },
                  ]}
                  onChange={(value) => setScope(item.action, value as DelegationScopeRule)}
                />
              ) : null}
            </div>
          ))}
        </div>
        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={save.error} />
      </div>
    </ConfirmDialog>
  );
}

function DelegationRemoveDialog({ managingRealm, delegation, managedRealmName, onClose, onRemoved }: {
  readonly managingRealm: IdentityRealm;
  readonly delegation: RealmManagementDelegation;
  readonly managedRealmName: string;
  readonly onClose: () => void;
  readonly onRemoved: () => void | Promise<void>;
}) {
  const api = useAdminApi();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.identityRealms.deleteManagementDelegation(
      managingRealm.realmId, delegation.managedRealmId, {
        expectedRevision: delegation.revision,
        password,
      }),
    onSuccess: () => { void onRemoved(); },
  });
  return (
    <ConfirmDialog
      title="관리 위임 제거"
      confirmLabel="제거"
      danger
      isPending={remove.isPending}
      isConfirmDisabled={password === ""}
      onCancel={() => { onClose(); remove.reset(); }}
      onConfirm={() => remove.mutate()}
    >
      <div className={styles.dialogStack}>
        <Callout tone="warning"><strong>{managingRealm.name}가 {managedRealmName} 사용자를 더 이상 관리할 수 없게 됩니다.</strong></Callout>
        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={remove.error} />
      </div>
    </ConfirmDialog>
  );
}
