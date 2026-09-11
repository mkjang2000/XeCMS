import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi, type CollectionSummary, type IdentityRealm, type RealmCollectionEntitlement, type RealmCollectionEntitlementList } from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { SectionHeader } from "../../components/page.js";
import { DisplayModeGate, type DisplayMode } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { AddTargetDialog } from "./add-target-dialog.js";
import { EntitlementEditDialog, EntitlementRemoveDialog } from "./entitlement-dialogs.js";
import { entitlementActionSummary, entitlementConstraintSummary, entitlementFieldSummary, mergeEntitlement } from "./entitlement-model.js";
import { IdValue } from "./shared.js";

/**
 * CMS-level collection access ceiling for one Realm. The ceiling only removes
 * access — final access = Realm policy AND this ceiling — and a collection with
 * no row here is unreachable once enforcement is on (fail-closed). Editable by
 * the CMS Owner only.
 */
export function CollectionEntitlementSection({ realm, mode }: {
  readonly realm: IdentityRealm;
  readonly mode: DisplayMode;
}) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{
    readonly collection: CollectionSummary;
    readonly current: RealmCollectionEntitlement | undefined;
  } | null>(null);
  const [removing, setRemoving] = useState<RealmCollectionEntitlement | null>(null);
  const [adding, setAdding] = useState(false);

  const entitlements = useQuery({
    queryKey: queryKeys.realmEntitlements(realm.realmId),
    queryFn: () => api.identityRealms.listCollectionEntitlements(realm.realmId),
  });
  const collections = useQuery({
    queryKey: queryKeys.collections,
    queryFn: () => api.collections.list(),
  });
  const realms = useQuery({
    queryKey: queryKeys.identityRealms,
    queryFn: () => api.identityRealms.list(),
  });

  const byCollectionId = new Map(
    (entitlements.data?.entitlements ?? []).map((e) => [e.collectionId, e] as const),
  );
  // Auth (profile) collections owned by OTHER realms — these can never be exposed
  // here (they hold another realm's account data). The server enforces this too.
  const foreignAuthCollectionIds = new Set(
    (realms.data?.items ?? [])
      .filter((r) => r.realmId !== realm.realmId && r.profileCollectionId !== undefined)
      .map((r) => r.profileCollectionId as string),
  );

  const allCollections = collections.data?.items ?? [];
  const collectionById = new Map(allCollections.map((c) => [c.id, c] as const));
  const ownAuthCollection = realm.profileCollectionId === undefined
    ? undefined
    : collectionById.get(realm.profileCollectionId);
  // Rows = what is actually configured (plus the always-allowed Auth collection).
  // Everything else lives behind the add picker, so the table never grows with
  // the number of collections in the workspace.
  const configured = allCollections.filter(
    (c) => c.id !== realm.profileCollectionId
      && byCollectionId.has(c.id)
      && !foreignAuthCollectionIds.has(c.id),
  );
  // Rows on another realm's Auth collection predate the server-side block (or were
  // written directly). They grant nothing legitimate, so they are surfaced as
  // stray entries to clear out — never as an editable ceiling.
  const strayForeignAuth = allCollections.filter(
    (c) => byCollectionId.has(c.id) && foreignAuthCollectionIds.has(c.id),
  );
  const addable = allCollections.filter(
    (c) => c.id !== realm.profileCollectionId
      && !byCollectionId.has(c.id)
      && !foreignAuthCollectionIds.has(c.id),
  );
  const unconfiguredCount = allCollections.length - configured.length
    - strayForeignAuth.length - (ownAuthCollection === undefined ? 0 : 1);

  return (
    <section className={styles.panel} aria-labelledby="realm-entitlement-title">
      <SectionHeader
        id="realm-entitlement-title"
        title="접근 가능한 콘텐츠"
        description="이 사용자 공간이 다룰 수 있는 콘텐츠와 그 범위를 CMS에서 정합니다. 공간 안에서 아무리 넓게 권한을 줘도 여기서 정한 범위를 넘지 못합니다."
        actions={
          <Button
            size="small"
            variant="secondary"
            isDisabled={realm.status !== "active" || addable.length === 0}
            onPress={() => setAdding(true)}
          >콘텐츠 추가</Button>
        }
      />
      <Callout tone="info">
        허용하지 않은 콘텐츠는 공간 안에서 권한을 줬더라도 접근할 수 없습니다.
      </Callout>
      {entitlements.isPending || collections.isPending ? (
        <PageLoading label="Collection 접근 상한을 불러오는 중" />
      ) : null}
      {entitlements.isError ? (
        <LoadError error={entitlements.error} onRetry={() => void entitlements.refetch()} />
      ) : null}
      {collections.isError ? (
        <LoadError error={collections.error} onRetry={() => void collections.refetch()} />
      ) : null}
      {collections.data && allCollections.length === 0 ? (
        <EmptyState title="콘텐츠 유형이 없습니다" description="스키마에서 콘텐츠 유형(Collection)을 먼저 만들면 여기에서 접근 범위를 정할 수 있습니다." />
      ) : null}
      {collections.data && allCollections.length > 0 && configured.length === 0
        && strayForeignAuth.length === 0 && ownAuthCollection === undefined ? (
        <EmptyState
          title="허용한 콘텐츠가 없습니다"
          description="이 공간은 아직 어떤 콘텐츠에도 접근할 수 없습니다. 「콘텐츠 추가」로 접근을 허용할 콘텐츠를 고르세요."
        />
      ) : null}
      {strayForeignAuth.length > 0 ? (
        <Callout tone="warning">
          다른 사용자 공간의 인증 스키마에 남아 있는 접근 설정 {strayForeignAuth.length}개가 있습니다.
          지금은 적용되지 않지만, 남겨둘 이유가 없으니 제거해 주세요.
        </Callout>
      ) : null}
      {collections.data && allCollections.length > 0
        && (configured.length > 0 || strayForeignAuth.length > 0 || ownAuthCollection !== undefined) ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.entitlementTable}`}>
            <thead>
              <tr>
                <th>콘텐츠 유형</th>
                <th>허용 작업</th>
                <th>조건</th>
                <th>필드</th>
                <th className={styles.entitlementActionsHead}>작업</th>
              </tr>
            </thead>
            <tbody>
              {/* The realm's own Auth (profile) collection is always accessible —
                  it can never be gated, so the ceiling controls don't apply. */}
              {ownAuthCollection !== undefined ? (
                <tr key={ownAuthCollection.id} data-has-entitlement>
                  <td>
                    <div className={styles.entitlementName}>
                      <span className={styles.entitlementNameRow}>
                        <strong>{ownAuthCollection.label ?? ownAuthCollection.name}</strong>
                        <Badge tone="info">인증 스키마</Badge>
                      </span>
                      <DisplayModeGate minimum="advanced">
                        <IdValue label="Collection ID" value={ownAuthCollection.id} />
                      </DisplayModeGate>
                    </div>
                  </td>
                  <td><Badge tone="success">항상 허용</Badge></td>
                  <td className={styles.entitlementMuted}>—</td>
                  <td className={styles.entitlementMuted}>—</td>
                  <td><span className={styles.compactHint}>공간 로그인·프로필에 필요해 제한할 수 없습니다.</span></td>
                </tr>
              ) : null}
              {configured.map((collection) => {
                const current = byCollectionId.get(collection.id) as RealmCollectionEntitlement;
                return (
                  <tr key={collection.id} data-has-entitlement>
                    <td>
                      <div className={styles.entitlementName}>
                        <span className={styles.entitlementNameRow}>
                          <strong>{collection.label ?? collection.name}</strong>
                        </span>
                        <DisplayModeGate minimum="advanced">
                          <IdValue label="Collection ID" value={collection.id} />
                        </DisplayModeGate>
                      </div>
                    </td>
                    <td><span className={styles.entitlementActions}>{entitlementActionSummary(current.actions)}</span></td>
                    <td>{entitlementConstraintSummary(current)}</td>
                    <td>{entitlementFieldSummary(current)}</td>
                    <td>
                      <div className={styles.entitlementRowActions}>
                        <Button
                          size="small"
                          variant="secondary"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setEditing({ collection, current })}
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
              {/* Stray rows on another realm's Auth collection: not a ceiling, so
                  they are shown as ineffective and offer removal only. */}
              {strayForeignAuth.map((collection) => {
                const current = byCollectionId.get(collection.id) as RealmCollectionEntitlement;
                return (
                  <tr key={collection.id} data-stray-entitlement>
                    <td>
                      <div className={styles.entitlementName}>
                        <span className={styles.entitlementNameRow}>
                          <strong>{collection.label ?? collection.name}</strong>
                          <Badge tone="danger">다른 공간 인증 스키마</Badge>
                        </span>
                        <DisplayModeGate minimum="advanced">
                          <IdValue label="Collection ID" value={collection.id} />
                        </DisplayModeGate>
                      </div>
                    </td>
                    <td colSpan={3}>
                      <span className={styles.compactHint}>
                        다른 공간의 계정·프로필 데이터라 접근이 열리지 않습니다. 남아 있는 설정이니 제거해 주세요.
                      </span>
                    </td>
                    <td>
                      <div className={styles.entitlementRowActions}>
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
      ) : null}
      {collections.data && unconfiguredCount > 0 ? (
        <p className={styles.compactHint}>
          나머지 콘텐츠 {unconfiguredCount}개는 이 공간에서 접근할 수 없습니다.
        </p>
      ) : null}
      {adding ? (
        <AddTargetDialog
          title="접근을 허용할 콘텐츠"
          description="고른 콘텐츠의 허용 범위를 이어서 정합니다. 목록에 없는 콘텐츠는 이미 설정되었거나 접근할 수 없는 콘텐츠입니다."
          searchLabel="콘텐츠 유형 검색"
          items={addable}
          keyOf={(c) => c.id}
          labelOf={(c) => c.label ?? c.name}
          hintOf={(c) => c.name}
          emptyText="추가할 수 있는 콘텐츠가 없습니다."
          onClose={() => setAdding(false)}
          onPick={(collection) => {
            setAdding(false);
            setEditing({ collection, current: undefined });
          }}
        />
      ) : null}
      {editing ? (
        <EntitlementEditDialog
          realm={realm}
          collection={editing.collection}
          current={editing.current}
          mode={mode}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            queryClient.setQueryData<RealmCollectionEntitlementList>(
              queryKeys.realmEntitlements(realm.realmId),
              (previous) => mergeEntitlement(previous, saved),
            );
            setEditing(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.collectionEntitlements(saved.collectionId),
            });
          }}
        />
      ) : null}
      {removing ? (
        <EntitlementRemoveDialog
          realm={realm}
          entitlement={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            const collectionId = removing.collectionId;
            queryClient.setQueryData<RealmCollectionEntitlementList>(
              queryKeys.realmEntitlements(realm.realmId),
              (previous) => previous === undefined ? previous : {
                ...previous,
                entitlements: previous.entitlements.filter((e) => e.collectionId !== collectionId),
              },
            );
            setRemoving(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.collectionEntitlements(collectionId),
            });
          }}
        />
      ) : null}
    </section>
  );
}
