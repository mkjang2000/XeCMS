import { useQueries, useQuery } from "@tanstack/react-query";
import { useAdminApi, type RealmCollectionEntitlement } from "@xecms/admin";
import { Badge, Button, EmptyState } from "@xecms/ui";
import { Link, useNavigate } from "react-router";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { Page, PageHeader } from "../../components/page.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { entitlementActionSummary } from "./entitlement-model.js";

/**
 * Cross-space access matrix: rows are collections, columns are Content Realms,
 * each cell shows the ceiling (allowed actions) for that (collection, realm)
 * pair. The reverse endpoint (`listEntitlementsForCollection`) fills one row per
 * collection with a single request. Read-only overview; editing stays on the
 * per-space "권한" tab, reachable by clicking a cell.
 */
export function RealmEntitlementMatrixPage() {
  const api = useAdminApi();
  const navigate = useNavigate();

  const realms = useQuery({ queryKey: queryKeys.identityRealms, queryFn: () => api.identityRealms.list() });
  const collections = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });

  // Only Content Realms are gated; the System realm never appears.
  const contentRealms = (realms.data?.items ?? []).filter((r) => r.kind === "content");
  const collectionItems = collections.data?.items ?? [];

  // One reverse query per collection → a full matrix row.
  const rowQueries = useQueries({
    queries: collectionItems.map((collection) => ({
      queryKey: queryKeys.collectionEntitlements(collection.id),
      queryFn: () => api.identityRealms.listEntitlementsForCollection(collection.id),
    })),
  });

  // collectionId → (realmId → entitlement)
  const byCollection = new Map<string, Map<string, RealmCollectionEntitlement>>();
  collectionItems.forEach((collection, index) => {
    const result = rowQueries[index]?.data;
    byCollection.set(
      collection.id,
      new Map((result?.entitlements ?? []).map((e) => [e.realmId, e] as const)),
    );
  });

  // collectionId → the realm that owns it as its Auth (profile) collection.
  const authOwnerByCollection = new Map<string, string>();
  for (const r of contentRealms) {
    if (r.profileCollectionId !== undefined) authOwnerByCollection.set(r.profileCollectionId, r.realmId);
  }

  const loading = realms.isPending || collections.isPending || rowQueries.some((q) => q.isPending);
  const rowError = rowQueries.find((q) => q.isError);

  return (
    <Page>
      <PageHeader
        eyebrow="Access"
        title="콘텐츠 접근 매트릭스"
        description="어떤 사용자 공간이 어떤 콘텐츠에 접근할 수 있는지 한눈에 봅니다. 셀을 누르면 해당 공간의 접근 설정으로 이동합니다."
        actions={<Button variant="secondary" onPress={() => navigate("/admin/realms")}>사용자 공간 목록</Button>}
      />
      {realms.isError ? <LoadError error={realms.error} onRetry={() => void realms.refetch()} /> : null}
      {collections.isError ? <LoadError error={collections.error} onRetry={() => void collections.refetch()} /> : null}
      {rowError !== undefined ? <LoadError error={rowError.error} onRetry={() => void rowError.refetch()} /> : null}
      {loading ? <PageLoading label="접근 매트릭스를 불러오는 중" /> : null}
      {!loading && contentRealms.length === 0 ? (
        <EmptyState title="사용자 공간이 없습니다" description="먼저 사용자 공간을 만들면 접근 매트릭스가 채워집니다." />
      ) : null}
      {!loading && contentRealms.length > 0 && collectionItems.length === 0 ? (
        <EmptyState title="콘텐츠 유형이 없습니다" description="스키마에서 콘텐츠 유형을 먼저 만들어 주세요." />
      ) : null}
      {!loading && contentRealms.length > 0 && collectionItems.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.entitlementMatrix}`}>
            <thead>
              <tr>
                <th className={styles.entitlementMatrixCorner}>콘텐츠 유형</th>
                {contentRealms.map((realm) => (
                  <th key={realm.realmId}>
                    <Link to={`/admin/realms/${encodeURIComponent(realm.realmId)}?tab=access`}>{realm.name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collectionItems.map((collection) => (
                <tr key={collection.id}>
                  <th scope="row" className={styles.entitlementMatrixRowHead}>
                    {collection.label ?? collection.name}
                  </th>
                  {contentRealms.map((realm) => {
                    const authOwnerId = authOwnerByCollection.get(collection.id);
                    const isAuth = authOwnerId === realm.realmId;
                    // Another realm's Auth collection is never accessible here.
                    const isForeignAuth = authOwnerId !== undefined && authOwnerId !== realm.realmId;
                    const entitlement = byCollection.get(collection.id)?.get(realm.realmId);
                    return (
                      <td
                        key={realm.realmId}
                        className={styles.entitlementMatrixCell}
                        data-access={
                          isAuth ? "guaranteed"
                            : isForeignAuth ? "blocked"
                            : entitlement !== undefined ? "allowed" : "none"
                        }
                      >
                        <Link
                          to={`/admin/realms/${encodeURIComponent(realm.realmId)}?tab=access`}
                          aria-label={`${realm.name} · ${collection.label ?? collection.name} 접근 설정`}
                        >
                          {isAuth ? (
                            <Badge tone="success">항상 허용</Badge>
                          ) : isForeignAuth ? (
                            <span className={styles.entitlementMatrixNone}>접근 불가</span>
                          ) : entitlement !== undefined ? (
                            <span className={styles.entitlementMatrixActions}>{entitlementActionSummary(entitlement.actions)}</span>
                          ) : (
                            <span className={styles.entitlementMatrixNone}>접근 안 함</span>
                          )}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  );
}
