import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAdminApi, documentDisplayStateLabel, type CollectionSummary, type CollectionEntitlementAction, type DocumentDisplayState, type IdentityRealm, type RealmCollectionEntitlement } from "@xecms/admin";
import { Callout, CheckboxField, ConfirmDialog, TextInput } from "@xecms/ui";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { DisplayModeGate, displayModeAtLeast, type DisplayMode } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { ENTITLEMENT_ACTION_GROUPS } from "./entitlement-model.js";
import { MutationError } from "./shared.js";

/** Display states an operator can gate on. `deleted` is excluded — deleted documents aren't an access target. */
const SELECTABLE_DISPLAY_STATES: readonly DocumentDisplayState[] = [
  "draft",
  "published",
  "published-with-draft",
  "archived",
];

function toggleInSet<T>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(value); else next.delete(value);
  return next;
}

export function EntitlementEditDialog({ realm, collection, current, mode, onClose, onSaved }: {
  readonly realm: IdentityRealm;
  readonly collection: CollectionSummary;
  readonly current: RealmCollectionEntitlement | undefined;
  readonly mode: DisplayMode;
  readonly onClose: () => void;
  readonly onSaved: (saved: RealmCollectionEntitlement) => void | Promise<void>;
}) {
  const api = useAdminApi();
  const advanced = displayModeAtLeast(mode, "advanced");
  const [selectedActions, setSelectedActions] = useState<ReadonlySet<CollectionEntitlementAction>>(
    () => new Set(current?.actions ?? []),
  );
  const [ownerOnly, setOwnerOnly] = useState(current?.constraint?.ownerOnly === true);
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(
    () => new Set(current?.constraint?.statuses ?? []),
  );
  const [limitReadable, setLimitReadable] = useState(current?.readableFields !== undefined);
  const [readable, setReadable] = useState<ReadonlySet<string>>(
    () => new Set(current?.readableFields ?? []),
  );
  const [limitWritable, setLimitWritable] = useState(current?.writableFields !== undefined);
  const [writable, setWritable] = useState<ReadonlySet<string>>(
    () => new Set(current?.writableFields ?? []),
  );
  const [password, setPassword] = useState("");

  // The applied schema gives the real field list so the operator picks rather than types.
  const detail = useQuery({
    queryKey: [...queryKeys.collections, collection.id, "applied"] as const,
    queryFn: () => api.collections.getApplied(collection.id),
    enabled: advanced,
  });
  const fields = detail.data?.fields ?? [];

  const toggleGroup = (groupActions: readonly CollectionEntitlementAction[], on: boolean) => {
    setSelectedActions((previous) => {
      const next = new Set(previous);
      for (const action of groupActions) {
        if (on) next.add(action); else next.delete(action);
      }
      return next;
    });
  };
  // Writing a field the ceiling won't let you read is forbidden; keep writable ⊆ readable in the UI too.
  const setReadableField = (name: string, on: boolean) => {
    setReadable((previous) => toggleInSet(previous, name, on));
    if (!on) setWritable((previous) => toggleInSet(previous, name, false));
  };

  const save = useMutation({
    mutationFn: () => {
      const actions = ENTITLEMENT_ACTION_GROUPS
        .flatMap((group) => group.actions)
        .filter((action) => selectedActions.has(action));
      const readableFields = limitReadable ? [...readable] : undefined;
      const writableFields = limitWritable ? [...writable] : undefined;
      const statusList = [...statuses];
      const constraint = ownerOnly || statusList.length > 0
        ? {
            ...(ownerOnly ? { ownerOnly: true } : {}),
            ...(statusList.length > 0 ? { statuses: statusList } : {}),
          }
        : undefined;
      return api.identityRealms.putCollectionEntitlement(realm.realmId, collection.id, {
        actions,
        ...(readableFields === undefined ? {} : { readableFields }),
        ...(writableFields === undefined ? {} : { writableFields }),
        ...(constraint === undefined ? {} : { constraint }),
        expectedRevision: current?.revision ?? null,
        password,
      });
    },
    onSuccess: (saved) => { void onSaved(saved); },
  });

  const hasAction = (groupActions: readonly CollectionEntitlementAction[]): boolean =>
    groupActions.some((action) => selectedActions.has(action));

  return (
    <ConfirmDialog
      title={`${collection.label ?? collection.name} — 접근 허용 범위`}
      confirmLabel={current === undefined ? "허용" : "저장"}
      isPending={save.isPending}
      isConfirmDisabled={password === ""}
      onCancel={() => { onClose(); save.reset(); }}
      onConfirm={() => save.mutate()}
    >
      <div className={styles.entitlementDialog}>
        <p className={styles.compactHint}>여기서 고른 범위가 이 공간의 <strong>최대치</strong>입니다. 공간 안에서 더 넓게 주더라도 넘지 못합니다.</p>

        <div className={styles.entitlementGroup}>
          <h4>허용 작업</h4>
          <div className={styles.entitlementCheckGrid}>
            {ENTITLEMENT_ACTION_GROUPS
              .filter((group) => group.advanced !== true || advanced)
              .map((group) => (
                <CheckboxField
                  key={group.id}
                  isSelected={hasAction(group.actions)}
                  onChange={(on) => toggleGroup(group.actions, on)}
                >{group.label} <span className={styles.secondaryLine}>{group.hint}</span></CheckboxField>
              ))}
          </div>
        </div>

        <DisplayModeGate minimum="advanced">
          <div className={styles.entitlementGroup}>
            <h4>조건</h4>
            <CheckboxField isSelected={ownerOnly} onChange={setOwnerOnly}>본인이 작성한 문서만</CheckboxField>
            <p className={styles.compactHint}>특정 상태의 문서로만 제한 (아무것도 안 고르면 모든 상태 허용)</p>
            <div className={styles.entitlementCheckGrid}>
              {SELECTABLE_DISPLAY_STATES.map((state) => (
                <CheckboxField
                  key={state}
                  isSelected={statuses.has(state)}
                  onChange={(on) => setStatuses((previous) => toggleInSet(previous, state, on))}
                >{documentDisplayStateLabel(state)}</CheckboxField>
              ))}
            </div>
          </div>

          <div className={styles.entitlementGroup}>
            <h4>필드 범위</h4>
            {detail.isPending ? <PageLoading label="필드 목록을 불러오는 중" /> : null}
            {detail.isError ? <LoadError error={detail.error} onRetry={() => void detail.refetch()} /> : null}
            <CheckboxField isSelected={limitReadable} onChange={setLimitReadable}>읽을 수 있는 필드를 제한</CheckboxField>
            {limitReadable && fields.length > 0 ? (
              <div className={styles.entitlementCheckGrid}>
                {fields.map((field) => (
                  <CheckboxField
                    key={field.id}
                    isSelected={readable.has(field.name)}
                    onChange={(on) => setReadableField(field.name, on)}
                  >{field.label ?? field.name}</CheckboxField>
                ))}
              </div>
            ) : null}
            <CheckboxField isSelected={limitWritable} onChange={setLimitWritable}>쓸 수 있는 필드를 제한</CheckboxField>
            {limitWritable && fields.length > 0 ? (
              <div className={styles.entitlementCheckGrid}>
                {fields.map((field) => {
                  const readAllowed = !limitReadable || readable.has(field.name);
                  return (
                    <CheckboxField
                      key={field.id}
                      isSelected={writable.has(field.name)}
                      isDisabled={!readAllowed}
                      onChange={(on) => setWritable((previous) => toggleInSet(previous, field.name, on))}
                    >{field.label ?? field.name}{readAllowed ? "" : " (읽기 미허용)"}</CheckboxField>
                  );
                })}
              </div>
            ) : null}
            <p className={styles.compactHint}>쓰기는 읽기를 허용한 필드에서만 켤 수 있습니다.</p>
          </div>
        </DisplayModeGate>

        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={save.error} />
      </div>
    </ConfirmDialog>
  );
}

export function EntitlementRemoveDialog({ realm, entitlement, onClose, onRemoved }: {
  readonly realm: IdentityRealm;
  readonly entitlement: RealmCollectionEntitlement;
  readonly onClose: () => void;
  readonly onRemoved: () => void | Promise<void>;
}) {
  const api = useAdminApi();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.identityRealms.deleteCollectionEntitlement(realm.realmId, entitlement.collectionId, {
      expectedRevision: entitlement.revision,
      password,
    }),
    onSuccess: () => { void onRemoved(); },
  });
  return (
    <ConfirmDialog
      title="접근 허용 제거"
      confirmLabel="제거"
      danger
      isPending={remove.isPending}
      isConfirmDisabled={password === ""}
      onCancel={() => { onClose(); remove.reset(); }}
      onConfirm={() => remove.mutate()}
    >
      <div className={styles.dialogStack}>
        <Callout tone="warning"><strong>허용을 제거하면 이 공간은 이 콘텐츠에 더 이상 접근할 수 없습니다.</strong> 다시 열려면 허용을 새로 설정해야 합니다.</Callout>
        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={remove.error} />
      </div>
    </ConfirmDialog>
  );
}
