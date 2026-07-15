import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import { useAdminApi, type CollectionSummary } from "@xecms/admin";
import styles from "../app.module.css";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";

function Status({ collection }: { readonly collection: CollectionSummary }) {
  const pending = collection.status === "applied" && collection.hasPendingChanges;
  return (
    <Badge tone={pending ? "warning" : collection.status === "applied" ? "success" : "neutral"}>
      {pending ? "적용 대기 변경" : collection.status === "applied" ? "적용됨" : "초안"}
    </Badge>
  );
}

export function SchemaListPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });
  const diagnostics = useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: () => api.settings.diagnostics(),
  });
  const editable = diagnostics.data?.schemaMode === "editable";
  return (
    <Page>
      <PageHeader
        eyebrow="Structure"
        title="스키마"
        description="컬렉션과 필드를 정의한 뒤 데이터베이스 변경을 검토합니다."
        actions={<><Button variant="secondary" onPress={() => navigate("/admin/schema/tools")}>Manifest · TypeScript</Button><Button isDisabled={!editable} onPress={() => navigate("/admin/schema/new")}><Icon name="plus" size={17} />새 콘텐츠 타입</Button></>}
      />
      {diagnostics.data && !editable ? (
        <Callout tone="warning">
          Schema mode가 <strong>{diagnostics.data.schemaMode}</strong>이므로 시각 편집과 적용이 잠겨 있습니다.
        </Callout>
      ) : null}
      {query.isPending ? <PageLoading label="컬렉션을 불러오는 중" /> : null}
      {query.isError ? <LoadError error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.items.length === 0 ? (
        <EmptyState
          title="아직 컬렉션이 없습니다"
          description="첫 컬렉션을 만들고 콘텐츠 구조를 정의해 보세요."
          action={<Button isDisabled={!editable} onPress={() => navigate("/admin/schema/new")}><Icon name="plus" size={17} />새 콘텐츠 타입</Button>}
        />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <div className={styles.collectionGrid}>
          {query.data.items.map((collection) => (
            <Link key={collection.id} to={`/admin/schema/${collection.id}`} className={styles.collectionCard}>
              <div className={styles.collectionCardTop}>
                <span className={styles.collectionIcon}><Icon name="schema" size={20} /></span>
                <Status collection={collection} />
              </div>
              <div className={styles.collectionCardBody}>
                <h2>{collection.label || collection.name}</h2>
                <div className={styles.collectionMeta}>{collection.name}</div>
              </div>
              <div className={styles.collectionCardFooter}>
                <span>필드 {collection.fieldCount}개</span>
                <span className={styles.collectionArrow}><Icon name="arrowRight" size={14} /></span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

export function ContentCollectionsPage() {
  const api = useAdminApi();
  const query = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });
  const applied = query.data?.items.filter(({ status }) => status === "applied") ?? [];
  return (
    <Page>
      <PageHeader eyebrow="Workspace" title="콘텐츠" description="적용된 컬렉션의 문서를 작성하고 관리합니다." />
      {query.isPending ? <PageLoading label="컬렉션을 불러오는 중" /> : null}
      {query.isError ? <LoadError error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && applied.length === 0 ? (
        <EmptyState
          title="사용 가능한 컬렉션이 없습니다"
          description="스키마에서 컬렉션을 만들고 migration을 적용하면 여기에 표시됩니다."
        />
      ) : null}
      {applied.length > 0 ? (
        <div className={styles.collectionGrid}>
          {applied.map((collection) => (
            <Link key={collection.id} to={`/admin/content/${collection.id}`} className={styles.collectionCard}>
              <div className={styles.collectionCardTop}>
                <span className={styles.collectionIcon}><Icon name="content" size={20} /></span>
                <Badge tone="success">사용 가능</Badge>
              </div>
              <div className={styles.collectionCardBody}>
                <h2>{collection.label || collection.name}</h2>
                <div className={styles.collectionMeta}>{collection.name}</div>
              </div>
              <div className={styles.collectionCardFooter}>
                <span>필드 {collection.fieldCount}개 · 문서 관리</span>
                <span className={styles.collectionArrow}><Icon name="arrowRight" size={14} /></span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
