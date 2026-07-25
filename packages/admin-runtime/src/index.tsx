import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  AdminNavigationItem,
  AdminPageDefinition,
  AdminPageDefinitionV2,
  ComposedPageDefinition,
  FormLayoutNode,
} from "@xecms/admin-apps";

import { ComposedPage } from "./composed-page.js";
import type { PluginComponentRegistry } from "./composed-runtime.js";

export * from "./composed-geometry.js";
import type {
  AdminAppRuntimeDto,
  CollectionSummaryDto,
  DocumentQueryRequest,
  DocumentRecordDto,
  DocumentRevisionSummaryDto,
  DocumentTreeNodeDto,
  FieldSummaryDto,
  MediaRecordDto,
  MoveDocumentPermissionImpactDto,
  MoveDocumentPreviewDto,
} from "@xecms/contracts";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";

import {
  AdminRuntimeApiError,
  createAdminRuntimeDataClient,
  type AdminRuntimeDataClient,
} from "./api.js";
import styles from "./runtime.module.css";

export * from "./api.js";
export type { PluginComponentRegistry, PluginComponentRenderer } from "./composed-runtime.js";
// Exposed for the Builder's in-editor preview: render real Component chrome from
// a draft page with a mock client (no live runtime/data needed).
export { ComposedRuntimeProvider } from "./composed-runtime.js";
export { renderComposedComponent } from "./composed-components.js";

export interface AdminRuntimeShellProps {
  readonly runtime: AdminAppRuntimeDto;
  readonly relativePath: string;
  readonly navigate: (relativePath: string, replace?: boolean) => void;
  readonly onSessionEnded: () => void;
  /** Trusted Plugin Component renderers, keyed by namespaced kind (CPB-9). */
  readonly plugins?: PluginComponentRegistry;
}

export function AdminRuntimeShell({ runtime, relativePath, navigate, onSessionEnded, plugins }: AdminRuntimeShellProps) {
  const client = useMemo(() => createAdminRuntimeDataClient(runtime), [runtime]);
  const [dirty, setDirty] = useState(false);
  const segments = relativePath.split("/").filter(Boolean);
  const pageId = segments[0] ?? runtime.manifest.startPageId;
  const documentId = segments[1];
  const page = runtime.manifest.pages.find(({ id }) => id === pageId);
  const visibleNavigation = runtime.manifest.navigation
    .map((item) => visibleNavigationItem(item, runtime))
    .filter((item): item is AdminNavigationItem => item !== null);

  useEffect(() => {
    if (segments.length === 0) navigate(runtime.manifest.startPageId, true);
  }, [navigate, runtime.manifest.startPageId, segments.length]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const guardedNavigate = (target: string, bypassGuard = false) => {
    if (!bypassGuard && dirty && !window.confirm("저장하지 않은 변경 사항을 버리고 이동할까요?")) return;
    setDirty(false);
    navigate(target);
  };

  const logout = async () => {
    if (dirty && !window.confirm("저장하지 않은 변경 사항을 버리고 로그아웃할까요?")) return;
    await client.logout().catch(() => undefined);
    onSessionEnded();
  };

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#app-content">본문으로 건너뛰기</a>
      <aside className={styles.sidebar}>
        <header className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">{runtime.manifest.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{runtime.manifest.name}</strong><small>{audienceLabel(runtime)}</small></div>
        </header>
        <nav className={styles.navigation} aria-label={`${runtime.manifest.name} 메뉴`}>
          {visibleNavigation.map((item) => (
            <NavigationItem
              key={item.id}
              item={item}
              currentPageId={pageId}
              onNavigate={(target) => guardedNavigate(target)}
            />
          ))}
        </nav>
        <footer className={styles.account}>
          <div><span>{runtime.user.displayName}</span><small>{runtime.user.realmKey ?? "System Realm"}</small></div>
          <button type="button" onClick={() => void logout()}>로그아웃</button>
        </footer>
      </aside>
      <main id="app-content" className={styles.content} tabIndex={-1}>
        {!runtime.dependencyHealth.healthy ? (
          <Callout tone="warning">
            일부 Schema 또는 확장 기능이 변경되어 App이 제한 모드로 실행 중입니다.
          </Callout>
        ) : null}
        {page === undefined ? (
          <RuntimeMessage title="페이지를 찾을 수 없습니다">App 메뉴에서 다른 화면을 선택해 주세요.</RuntimeMessage>
        ) : runtime.access.pages[page.id] !== true ? (
          <RuntimeMessage title="이 화면에 접근할 수 없습니다">필요한 콘텐츠 권한이 없습니다.</RuntimeMessage>
        ) : (
          <RuntimePage
            key={`${runtime.revisionId}:${page.id}:${documentId ?? ""}`}
            runtime={runtime}
            page={page}
            documentId={documentId}
            client={client}
            navigate={guardedNavigate}
            onDirtyChange={setDirty}
            plugins={plugins}
          />
        )}
      </main>
    </div>
  );
}

function RuntimePage({ runtime, page, documentId, client, navigate, onDirtyChange, plugins }: {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: AdminPageDefinitionV2;
  readonly documentId?: string;
  readonly client: AdminRuntimeDataClient;
  readonly navigate: (path: string, bypassGuard?: boolean) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly plugins?: PluginComponentRegistry;
}) {
  if (page.type === "composed-page") {
    return <ComposedPage runtime={runtime} page={page} client={client} navigate={(target) => navigate(target)} plugins={plugins} />;
  }
  switch (page.type) {
    case "collection-list": return (
      <CollectionList runtime={runtime} page={page} client={client} navigate={navigate} />
    );
    case "document-form": return (
      <DocumentForm
        runtime={runtime}
        page={page}
        documentId={documentId}
        client={client}
        navigate={navigate}
        onDirtyChange={onDirtyChange}
      />
    );
    case "document-detail": return (
      <DocumentDetail runtime={runtime} page={page} documentId={documentId} client={client} navigate={navigate} />
    );
    case "singleton": return (
      <SingletonForm runtime={runtime} page={page} client={client} onDirtyChange={onDirtyChange} />
    );
    case "dashboard": return <Dashboard runtime={runtime} page={page} />;
    case "plugin-page": return (
      <RuntimeMessage title={page.title ?? "확장 화면"}>
        확장 화면 <code>{page.extensionId}</code>은 현재 Runtime registry에서 사용할 수 없습니다.
      </RuntimeMessage>
    );
  }
}

function CollectionList({ runtime, page, client, navigate }: {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: Extract<AdminPageDefinition, { readonly type: "collection-list" }>;
  readonly client: AdminRuntimeDataClient;
  readonly navigate: (path: string) => void;
}) {
  const collection = collectionFor(runtime, page.collectionId);
  const readable = runtime.access.readableFields[page.collectionId];
  const visibleColumns = useMemo(() => page.columns.filter(({ field }) => field.kind === "system"
    || readable === null || readable?.includes(field.fieldId)), [page.columns, readable]);
  const visibleFilters = useMemo(() => (page.availableFilters ?? []).filter(({ field }) => field.kind === "system"
    || readable === null || readable?.includes(field.fieldId)), [page.availableFilters, readable]);
  const [items, setItems] = useState<readonly DocumentRecordDto[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<readonly (string | undefined)[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterId, setFilterId] = useState(visibleFilters[0]?.id ?? "");
  const [filterValue, setFilterValue] = useState("");
  const [view, setView] = useState<"table" | "tree">("table");
  const hierarchyEnabled = collection?.hierarchy?.enabled === true;

  useEffect(() => {
    let current = true;
    setPending(true);
    setError(null);
    const fields = visibleColumns.flatMap(({ field }) => field.kind === "data" ? [field.fieldId] : []);
    const filterDefinition = visibleFilters.find(({ id }) => id === filterId);
    const userFilter = filterDefinition === undefined || filterValue.trim() === "" ? undefined : {
      type: "condition" as const,
      field: filterDefinition.field,
      operator: filterDefinition.operators?.[0] ?? "contains" as const,
      value: filterValue.trim(),
    };
    const filter = page.fixedFilter === undefined ? userFilter : userFilter === undefined
      ? page.fixedFilter
      : { type: "group" as const, operator: "and" as const, filters: [page.fixedFilter, userFilter] };
    const input: DocumentQueryRequest = {
      limit: 25,
      ...(fields.length === 0 ? {} : { fields }),
      ...(filter === undefined ? {} : { filter }),
      ...(page.defaultSort === undefined ? {} : { sort: page.defaultSort }),
      ...(cursor === undefined ? {} : { cursor }),
      state: page.state ?? "active",
    };
    void client.query(page.collectionId, input).then((result) => {
      if (!current) return;
      setItems(result.items);
      setNextCursor(result.nextCursor);
    }).catch((caught) => current && setError(message(caught))).finally(() => current && setPending(false));
    return () => { current = false; };
  }, [client, cursor, filterId, filterValue, page, visibleColumns, visibleFilters]);

  const createPage = page.state === "deleted" ? undefined : runtime.manifest.pages.find((candidate) =>
    candidate.type === "document-form" && candidate.collectionId === page.collectionId
    && (candidate.mode === "create" || candidate.mode === "create-or-edit")
    && runtime.access.pages[candidate.id] === true);

  return (
    <section className={styles.page}>
      <PageHeader
        eyebrow={collection?.label ?? collection?.name ?? page.collectionId}
        title={page.title ?? collection?.label ?? collection?.name ?? "문서"}
        action={createPage === undefined ? null : <Button onPress={() => navigate(createPage.id)}>새 문서</Button>}
      />
      {hierarchyEnabled ? <div className={styles.viewSwitcher} aria-label="문서 목록 보기 방식">
        <Button size="small" variant={view === "table" ? "primary" : "quiet"} onPress={() => setView("table")}>표 보기</Button>
        <Button size="small" variant={view === "tree" ? "primary" : "quiet"} onPress={() => setView("tree")}>트리 보기</Button>
      </div> : null}
      {view === "tree" && hierarchyEnabled ? (
        <HierarchyTree
          collectionId={page.collectionId}
          collectionLabel={collection?.label ?? collection?.name ?? page.collectionId}
          client={client}
          canMove={runtime.access.actions[`${page.id}:core.action.hierarchy.move`] === true}
          onOpen={(documentId) => page.rowClick && navigate(`${page.rowClick.pageId}/${documentId}`)}
        />
      ) : <>
      {error ? <Callout tone="error">{error}</Callout> : null}
      {visibleFilters.length > 0 ? <div className={styles.filterBar}>
        <select aria-label="필터 필드" value={filterId} onChange={(event) => { setFilterId(event.target.value); setCursor(undefined); setHistory([]); }}>
          {visibleFilters.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
        </select>
        <input aria-label="필터 값" value={filterValue} placeholder="검색 값" onChange={(event) => { setFilterValue(event.target.value); setCursor(undefined); setHistory([]); }} />
        {filterValue ? <button type="button" onClick={() => setFilterValue("")}>지우기</button> : null}
      </div> : null}
      <div className={styles.tableCard} aria-busy={pending}>
        {pending ? <LoadingIndicator label="문서를 불러오는 중" /> : items.length === 0 ? (
          <p className={styles.empty}>표시할 문서가 없습니다.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table>
              <thead><tr>{visibleColumns.map((column) => <th key={column.id}>{column.label ?? columnLabel(column.field, collection)}</th>)}</tr></thead>
              <tbody>{items.map((document) => (
                <tr
                  key={document.id}
                  tabIndex={page.rowClick === undefined ? undefined : 0}
                  onClick={() => page.rowClick && navigate(`${page.rowClick.pageId}/${document.id}`)}
                  onKeyDown={(event) => {
                    if (page.rowClick && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault(); navigate(`${page.rowClick.pageId}/${document.id}`);
                    }
                  }}
                >
                  {visibleColumns.map((column) => <td key={column.id}>{renderColumn(document, column.field, collection)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className={styles.pagination}>
        <Button
          variant="secondary"
          isDisabled={history.length === 0 || pending}
          onPress={() => {
            const previous = history.at(-1);
            setHistory((values) => values.slice(0, -1));
            setCursor(previous);
          }}
        >이전</Button>
        <Button
          variant="secondary"
          isDisabled={nextCursor === undefined || pending}
          onPress={() => {
            setHistory((values) => [...values, cursor]);
            setCursor(nextCursor);
          }}
        >다음</Button>
      </div>
      </>}
    </section>
  );
}

interface PendingHierarchyMove {
  readonly node: DocumentTreeNodeDto;
  readonly parentId: string | null;
  readonly position: number;
  readonly expectedVersion: number;
  readonly preview: MoveDocumentPreviewDto;
}

function HierarchyTree({ collectionId, collectionLabel, client, canMove, onOpen }: {
  readonly collectionId: string;
  readonly collectionLabel: string;
  readonly client: AdminRuntimeDataClient;
  readonly canMove: boolean;
  readonly onOpen: (documentId: string) => void;
}) {
  const [nodes, setNodes] = useState<readonly DocumentTreeNodeDto[]>([]);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PendingHierarchyMove | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const reload = async () => {
    setPending(true); setError(null);
    try {
      const tree = await client.tree(collectionId);
      setNodes(tree.items); setVersion(tree.version);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => { void reload(); }, [client, collectionId]);

  const requestPreview = async (node: DocumentTreeNodeDto, parentId: string | null, position: number) => {
    setMoving(true); setError(null); setResult(null);
    try {
      const movePreview = await client.previewMove(collectionId, node.document.id, {
        newParentId: parentId,
        position,
        expectedVersion: version,
      });
      setPreview({ node, parentId, position, expectedVersion: version, preview: movePreview });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setMoving(false);
    }
  };
  const applyMove = async () => {
    if (preview === null) return;
    setMoving(true); setError(null);
    try {
      const moved = await client.move(collectionId, preview.node.document.id, {
        newParentId: preview.parentId,
        position: preview.position,
        expectedVersion: preview.expectedVersion,
        expectedPolicyRevision: preview.preview.policyRevision,
      });
      setPreview(null);
      setResult(`${documentChoiceLabel(moved.node.document)} 이동 완료 · Tree v${moved.version} · Policy r${moved.policyRevision}`);
      await reload();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setMoving(false);
    }
  };

  if (pending) return <LoadingIndicator label="콘텐츠 트리를 불러오는 중" />;
  return <section className={styles.hierarchyCard} aria-label={`${collectionLabel} 콘텐츠 트리`}>
    <header className={styles.hierarchyHeader}>
      <div><strong>계층 구조</strong><small>Tree v{version} · 보이는 문서와 허용된 작업만 표시됩니다.</small></div>
      <Button size="small" variant="quiet" onPress={() => void reload()}>새로고침</Button>
    </header>
    {error ? <Callout tone="error">{error}</Callout> : null}
    {result ? <Callout tone="success">{result}</Callout> : null}
    {nodes.length === 0 ? <p className={styles.empty}>표시할 계층 문서가 없습니다.</p> : <ol className={styles.hierarchyList}>
      {nodes.map((node) => <HierarchyRow
        key={node.document.id}
        node={node}
        nodes={nodes}
        version={version}
        disabled={moving}
        canMove={canMove}
        onOpen={onOpen}
        onMove={(parentId, position) => void requestPreview(node, parentId, position)}
      />)}
    </ol>}
    {preview ? <div className={styles.previewBackdrop} role="presentation">
      <section className={styles.movePreview} role="dialog" aria-modal="true" aria-labelledby="runtime-move-preview-title">
        <header><div><span>MOVE PREVIEW</span><h2 id="runtime-move-preview-title">계층 이동 확인</h2></div><button type="button" aria-label="닫기" onClick={() => setPreview(null)}>×</button></header>
        <p><strong>{documentChoiceLabel(preview.node.document)}</strong>의 구조와 권한 영향을 확인하세요.</p>
        <MoveImpact preview={preview} nodes={nodes} />
        <footer>
          <Button variant="quiet" isDisabled={moving} onPress={() => setPreview(null)}>취소</Button>
          <Button isDisabled={moving} onPress={() => void applyMove()}>{moving ? "이동 중…" : "확인 후 이동"}</Button>
        </footer>
      </section>
    </div> : null}
  </section>;
}

function HierarchyRow({ node, nodes, version, disabled, canMove, onOpen, onMove }: {
  readonly node: DocumentTreeNodeDto;
  readonly nodes: readonly DocumentTreeNodeDto[];
  readonly version: number;
  readonly disabled: boolean;
  readonly canMove: boolean;
  readonly onOpen: (documentId: string) => void;
  readonly onMove: (parentId: string | null, position: number) => void;
}) {
  const [parentId, setParentId] = useState(node.parentId ?? "");
  const [position, setPosition] = useState(String(node.position));
  useEffect(() => {
    setParentId(node.parentId ?? ""); setPosition(String(node.position));
  }, [node.parentId, node.position, version]);
  const descendants = new Set(nodes
    .filter((candidate) => candidate.path.includes(node.document.id))
    .map((candidate) => candidate.document.id));
  const titles = new Map(nodes.map((candidate) => [candidate.document.id, documentChoiceLabel(candidate.document)]));
  return <li className={styles.hierarchyNode} style={{ marginInlineStart: `${Math.min(node.depth, 8) * 1.1}rem` }}>
    <div className={styles.hierarchyNodeTitle}>
      <button type="button" onClick={() => onOpen(node.document.id)}>{documentChoiceLabel(node.document)}</button>
      <small>{node.path.map((id) => titles.get(id) ?? id).join(" / ") || "최상위"}</small>
      <span className={styles.status}>{node.document.displayState}</span>
    </div>
    {canMove ? <div className={styles.hierarchyControls} aria-label={`${documentChoiceLabel(node.document)} 계층 편집`}>
      <label><span>부모</span><select value={parentId} disabled={disabled} onChange={(event) => {
        setParentId(event.target.value);
        setPosition("0");
      }}>
        <option value="">최상위</option>
        {nodes.filter((candidate) => candidate.document.id !== node.document.id && !descendants.has(candidate.document.id))
          .map((candidate) => <option key={candidate.document.id} value={candidate.document.id}>{"　".repeat(candidate.depth)}{documentChoiceLabel(candidate.document)}</option>)}
      </select></label>
      <label><span>순서</span><input type="number" min="0" value={position} disabled={disabled} onChange={(event) => setPosition(event.target.value)} /></label>
      <Button size="small" variant="secondary" isDisabled={disabled} onPress={() => onMove(parentId || null, Math.max(0, Number(position) || 0))}>이동 Preview</Button>
    </div> : null}
  </li>;
}

function MoveImpact({ preview, nodes }: {
  readonly preview: PendingHierarchyMove;
  readonly nodes: readonly DocumentTreeNodeDto[];
}) {
  const titles = new Map(nodes.map((node) => [node.document.id, documentChoiceLabel(node.document)]));
  const parent = (id: string | null) => id === null ? "최상위" : titles.get(id) ?? id;
  const impact = preview.preview.permissionImpact;
  return <div className={styles.moveImpact}>
    <div className={styles.movePath}><div><span>현재 부모</span><strong>{parent(preview.preview.previousParentId)}</strong><small>순서 {preview.preview.previousPosition}</small></div><b aria-hidden="true">→</b><div><span>새 부모</span><strong>{parent(preview.parentId)}</strong><small>순서 {preview.position}</small></div></div>
    {impact === null ? <Callout tone="info">권한 상속을 사용하지 않아 Authorization 경로 변화가 없습니다.</Callout> : <PermissionImpact impact={impact} titles={titles} />}
    <small>Tree v{preview.expectedVersion} · Policy r{preview.preview.policyRevision} 기준</small>
  </div>;
}

function PermissionImpact({ impact, titles }: {
  readonly impact: MoveDocumentPermissionImpactDto;
  readonly titles: ReadonlyMap<string, string>;
}) {
  const path = (ids: readonly string[]) => ids.map((id) => titles.get(id) ?? id).join(" / ") || "최상위";
  return <div className={styles.permissionImpact}>
    <Callout tone={impact.requiresAuthorizationManagement ? "warning" : "info"}>
      영향 문서 {impact.affectedDocumentIds.length}개 · {path(impact.beforeDocumentPath)} → {path(impact.afterDocumentPath)}
      {impact.requiresAuthorizationManagement ? " · Authorization 관리 권한이 필요합니다." : ""}
    </Callout>
    {(impact.effectivePermissionChanges?.length ?? 0) > 0 ? <ul>
      {impact.effectivePermissionChanges?.map((change) => <li key={`${change.subjectId}:${change.resourceId}:${change.permission}`}>
        <strong>{change.change === "granted" ? "획득" : "상실"}</strong> {change.subjectId} · <code>{change.permission}</code>
      </li>)}
    </ul> : null}
    {(impact.effectiveFieldAccessChanges?.length ?? 0) > 0 ? <ul>
      {impact.effectiveFieldAccessChanges?.map((change) => <li key={`${change.subjectId}:${change.resourceId}:${change.operation}`}>
        <strong>필드 {change.change === "broadened" ? "확대" : change.change === "narrowed" ? "축소" : "변경"}</strong> {change.subjectId} · {change.operation}
      </li>)}
    </ul> : null}
    {impact.effectivePermissionChangesTruncated ? <small>변경 수가 많아 일부 권한 영향만 표시됩니다.</small> : null}
  </div>;
}

interface RuntimeFormResources {
  readonly relations: Readonly<Record<string, readonly DocumentRecordDto[]>>;
  readonly media: readonly MediaRecordDto[];
  readonly error: string | null;
  readonly uploadMedia: (file: File) => Promise<MediaRecordDto>;
}

function useRuntimeFormResources(
  runtime: AdminAppRuntimeDto,
  pageId: string,
  collection: CollectionSummaryDto | undefined,
  client: AdminRuntimeDataClient,
): RuntimeFormResources {
  const [relations, setRelations] = useState<Readonly<Record<string, readonly DocumentRecordDto[]>>>({});
  const [media, setMedia] = useState<readonly MediaRecordDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const relationTargetIds = useMemo(() => [...new Set((collection?.fields ?? []).flatMap((field) =>
    field.type === "relation" && field.targetCollectionId !== undefined
      && runtime.schema.collections.some(({ id }) => id === field.targetCollectionId)
      ? [field.targetCollectionId]
      : []))], [collection, runtime.schema.collections]);
  const needsMedia = collection?.fields.some(({ type }) => type === "upload") === true;
  const canReadMedia = runtime.access.actions[`${pageId}:core.action.media.read`] === true;

  useEffect(() => {
    let current = true;
    setError(null);
    void Promise.all([
      ...relationTargetIds.map(async (targetId) => [
        targetId,
        (await client.query(targetId, { limit: 100, state: "active" })).items,
      ] as const),
      ...(needsMedia && canReadMedia ? [client.listMedia().then((result) => ["__media", result.items] as const)] : []),
    ]).then((entries) => {
      if (!current) return;
      setRelations(Object.fromEntries(entries.filter(([key]) => key !== "__media")));
      const mediaEntry = entries.find(([key]) => key === "__media");
      setMedia((mediaEntry?.[1] ?? []) as readonly MediaRecordDto[]);
    }).catch((caught) => current && setError(message(caught)));
    return () => { current = false; };
  }, [canReadMedia, client, needsMedia, relationTargetIds]);

  return {
    relations,
    media,
    error,
    uploadMedia: async (file) => {
      const uploaded = await client.uploadMedia(file);
      setMedia((items) => [uploaded, ...items.filter(({ id }) => id !== uploaded.id)]);
      return uploaded;
    },
  };
}

function DocumentForm({ runtime, page, documentId, client, navigate, onDirtyChange }: {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: Extract<AdminPageDefinition, { readonly type: "document-form" }>;
  readonly documentId?: string;
  readonly client: AdminRuntimeDataClient;
  readonly navigate: (path: string, bypassGuard?: boolean) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
  const collection = collectionFor(runtime, page.collectionId);
  const [document, setDocument] = useState<DocumentRecordDto | null>(null);
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  const [pending, setPending] = useState(documentId !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [baseline, setBaseline] = useState("{}");
  const writable = runtime.access.writableFields[page.collectionId];
  const resources = useRuntimeFormResources(runtime, page.id, collection, client);

  useEffect(() => {
    if (documentId === undefined) return;
    let current = true;
    void client.get(page.collectionId, documentId).then((result) => {
      if (!current) return;
      setDocument(result); setValues(result.data); setBaseline(JSON.stringify(result.data));
    }).catch((caught) => current && setError(message(caught))).finally(() => current && setPending(false));
    return () => { current = false; };
  }, [client, documentId, page.collectionId]);

  const dirty = JSON.stringify(values) !== baseline;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null); setFieldErrors({});
    try {
      const saved = document === null
        ? await client.create(page.collectionId, values)
        : await client.update(page.collectionId, document.id, values, document.version);
      setDocument(saved); setValues(saved.data); setBaseline(JSON.stringify(saved.data));
      const detail = runtime.manifest.pages.find((candidate) =>
        candidate.type === "document-detail" && candidate.collectionId === page.collectionId
        && runtime.access.pages[candidate.id] === true);
      if (detail !== undefined) navigate(`${detail.id}/${saved.id}`, true);
    } catch (caught) {
      setError(message(caught)); setFieldErrors(validationIssues(caught));
    } finally { setSaving(false); }
  };

  if (pending) return <LoadingIndicator label="문서를 불러오는 중" />;
  return (
    <section className={styles.page}>
      <PageHeader eyebrow={collection?.label ?? page.collectionId} title={document === null ? "새 문서" : "문서 편집"} />
      {error ? <Callout tone="error">{error}</Callout> : null}
      {resources.error ? <Callout tone="error">선택 항목을 불러오지 못했습니다. {resources.error}</Callout> : null}
      <form className={styles.formCard} onSubmit={(event) => void save(event)}>
        <FormNodes
          nodes={page.layout.nodes}
          collection={collection}
          values={values}
          readable={runtime.access.readableFields[page.collectionId]}
          writable={writable}
          errors={fieldErrors}
          resources={resources}
          canUploadMedia={runtime.access.actions[`${page.id}:core.action.media.upload`] === true}
          onChange={(name, value) => {
            setValues((current) => ({ ...current, [name]: value }));
            setFieldErrors((current) => withoutKey(current, name));
          }}
        />
        <div className={styles.formActions}><Button type="submit" isDisabled={saving}>{saving ? "저장 중…" : "저장"}</Button></div>
      </form>
    </section>
  );
}

function SingletonForm({ runtime, page, client, onDirtyChange }: {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: Extract<AdminPageDefinition, { readonly type: "singleton" }>;
  readonly client: AdminRuntimeDataClient;
  readonly onDirtyChange: (dirty: boolean) => void;
}) {
  const collection = collectionFor(runtime, page.collectionId);
  const [document, setDocument] = useState<DocumentRecordDto | null>(null);
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [baseline, setBaseline] = useState("{}");
  const resources = useRuntimeFormResources(runtime, page.id, collection, client);
  useEffect(() => {
    let current = true;
    void client.query(page.collectionId, { limit: 1, state: "active" }).then((result) => {
      if (!current) return;
      const first = result.items[0] ?? null; const data = first?.data ?? {};
      setDocument(first); setValues(data); setBaseline(JSON.stringify(data));
    }).catch((caught) => current && setError(message(caught))).finally(() => current && setPending(false));
    return () => { current = false; };
  }, [client, page.collectionId]);
  const dirty = JSON.stringify(values) !== baseline;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null); setFieldErrors({});
    try {
      const saved = document === null
        ? await client.create(page.collectionId, values)
        : await client.update(page.collectionId, document.id, values, document.version);
      setDocument(saved); setValues(saved.data); setBaseline(JSON.stringify(saved.data));
    } catch (caught) {
      setError(message(caught)); setFieldErrors(validationIssues(caught));
    } finally { setSaving(false); }
  };
  if (pending) return <LoadingIndicator label="설정을 불러오는 중" />;
  return <section className={styles.page}>
    <PageHeader eyebrow={collection?.label ?? page.collectionId} title={page.title ?? collection?.label ?? "설정"} />
    {error ? <Callout tone="error">{error}</Callout> : null}
    {resources.error ? <Callout tone="error">선택 항목을 불러오지 못했습니다. {resources.error}</Callout> : null}
    <form className={styles.formCard} onSubmit={(event) => void save(event)}>
      <FormNodes nodes={page.layout.nodes} collection={collection} values={values} errors={fieldErrors}
        readable={runtime.access.readableFields[page.collectionId]}
        writable={runtime.access.writableFields[page.collectionId]}
        resources={resources}
        canUploadMedia={runtime.access.actions[`${page.id}:core.action.media.upload`] === true}
        onChange={(name, value) => {
          setValues((current) => ({ ...current, [name]: value }));
          setFieldErrors((current) => withoutKey(current, name));
        }} />
      <div className={styles.formActions}><Button type="submit" isDisabled={saving}>{saving ? "저장 중…" : "저장"}</Button></div>
    </form>
  </section>;
}

function DocumentDetail({ runtime, page, documentId, client, navigate }: {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: Extract<AdminPageDefinition, { readonly type: "document-detail" }>;
  readonly documentId?: string;
  readonly client: AdminRuntimeDataClient;
  readonly navigate: (path: string) => void;
}) {
  const collection = collectionFor(runtime, page.collectionId);
  const [document, setDocument] = useState<DocumentRecordDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<readonly DocumentRevisionSummaryDto[]>([]);
  const [mutating, setMutating] = useState(false);
  const showsRevisions = page.layout.panels.some(({ type }) => type === "revisions");
  useEffect(() => {
    if (documentId === undefined) return;
    let current = true;
    void client.get(page.collectionId, documentId).then((result) => current && setDocument(result))
      .catch((caught) => current && setError(message(caught)));
    return () => { current = false; };
  }, [client, documentId, page.collectionId]);
  useEffect(() => {
    if (documentId === undefined || !showsRevisions
      || runtime.access.actions[`${page.id}:core.action.revision.read`] !== true) return;
    let current = true;
    void client.revisions(page.collectionId, documentId).then((result) => current && setRevisions(result.items))
      .catch((caught) => current && setError(message(caught)));
    return () => { current = false; };
  }, [client, documentId, page.collectionId, page.id, runtime.access.actions, showsRevisions]);
  if (documentId === undefined) return <RuntimeMessage title="문서를 선택해 주세요">목록 화면에서 문서를 선택하세요.</RuntimeMessage>;
  if (error) return <Callout tone="error">{error}</Callout>;
  if (document === null) return <LoadingIndicator label="문서를 불러오는 중" />;
  const edit = runtime.manifest.pages.find((candidate) => candidate.type === "document-form"
    && candidate.collectionId === page.collectionId && candidate.mode !== "create"
    && runtime.access.pages[candidate.id] === true);
  const fieldIds = page.layout.panels.flatMap((panel) => "fieldIds" in panel ? panel.fieldIds : []);
  const readable = runtime.access.readableFields[page.collectionId];
  const fields = (fieldIds.length === 0 ? collection?.fields ?? [] : fieldIds.flatMap((id) => {
    const field = collection?.fields.find((candidate) => candidate.id === id); return field ? [field] : [];
  })).filter((field) => readable === null || readable?.includes(field.id));
  const allowed = (action: string) => runtime.access.actions[`${page.id}:${action}`] === true;
  const mutate = async (operation: () => Promise<DocumentRecordDto>) => {
    setMutating(true); setError(null);
    try { setDocument(await operation()); } catch (caught) { setError(message(caught)); } finally { setMutating(false); }
  };
  const list = runtime.manifest.pages.find((candidate) => candidate.type === "collection-list"
    && candidate.collectionId === page.collectionId && candidate.state !== "deleted"
    && runtime.access.pages[candidate.id] === true);
  const trash = runtime.manifest.pages.find((candidate) => candidate.type === "collection-list"
    && candidate.collectionId === page.collectionId && candidate.state === "deleted"
    && runtime.access.pages[candidate.id] === true);
  return <section className={styles.page}>
    <PageHeader eyebrow={collection?.label ?? page.collectionId} title={page.title ?? "문서 상세"}
      action={<div className={styles.inlineActions}>
        {edit === undefined || !allowed("core.action.update") ? null : <Button variant="secondary" onPress={() => navigate(`${edit.id}/${document.id}`)}>편집</Button>}
        {allowed("core.action.publish") && (document.displayState === "draft" || document.displayState === "published-with-draft") ? <Button isDisabled={mutating} onPress={() => void mutate(() => client.publish(page.collectionId, document.id, document.version))}>Publish</Button> : null}
        {allowed("core.action.unpublish") && (document.displayState === "published" || document.displayState === "published-with-draft") ? <Button variant="secondary" isDisabled={mutating} onPress={() => void mutate(() => client.unpublish(page.collectionId, document.id, document.version))}>Unpublish</Button> : null}
        {allowed("core.action.restore") && document.displayState === "deleted" ? <Button isDisabled={mutating} onPress={() => void (async () => {
          setMutating(true); setError(null);
          try { await client.restore(page.collectionId, document.id, document.version); if (list) navigate(list.id); }
          catch (caught) { setError(message(caught)); } finally { setMutating(false); }
        })()}>복원</Button> : null}
        {allowed("core.action.delete") && document.displayState !== "deleted" ? <Button variant="danger" isDisabled={mutating} onPress={() => void (async () => {
          if (!window.confirm("이 문서를 휴지통으로 이동할까요?")) return;
          setMutating(true); setError(null);
          try { await client.delete(page.collectionId, document.id, document.version); if (trash) navigate(trash.id); else if (list) navigate(list.id); }
          catch (caught) { setError(message(caught)); } finally { setMutating(false); }
        })()}>삭제</Button> : null}
      </div>} />
    <dl className={styles.detailCard}>
      {fields.map((field) => <div key={field.id}><dt>{field.label ?? field.name}</dt><dd>{renderValue(document.data[field.name])}</dd></div>)}
      <div><dt>상태</dt><dd><span className={styles.status}>{document.displayState}</span></dd></div>
      <div><dt>최근 수정</dt><dd>{new Date(document.updatedAt).toLocaleString()}</dd></div>
    </dl>
    {showsRevisions && runtime.access.actions[`${page.id}:core.action.revision.read`] === true ? <section className={styles.revisionCard}>
      <h2>Revision</h2>{revisions.length === 0 ? <p className={styles.muted}>Revision이 없습니다.</p> : revisions.map((revision) => <article key={revision.id}><div><strong>Revision {revision.sequence}</strong><small>{new Date(revision.createdAt).toLocaleString()} · {revision.origin.kind}</small></div>{revision.isCurrentDraft ? <span>현재 Draft</span> : runtime.access.actions[`${page.id}:core.action.revision.restore`] === true ? <Button size="small" variant="secondary" isDisabled={mutating} onPress={() => void mutate(() => client.restoreRevision(page.collectionId, document.id, revision.id, document.version))}>이 Revision 복원</Button> : null}</article>)}</section> : null}
  </section>;
}

function Dashboard({ runtime, page }: {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: Extract<AdminPageDefinition, { readonly type: "dashboard" }>;
}) {
  return <section className={styles.page}>
    <PageHeader eyebrow={runtime.manifest.name} title={page.title ?? "대시보드"} />
    <div className={styles.dashboardGrid}>{page.widgets.map((widget) => (
      <article key={widget.id} className={styles.widget} style={{ gridColumn: `span ${Math.min(widget.width ?? 4, 12)}` }}>
        <span>{widget.widgetId}</span><h2>{widget.title ?? widget.id}</h2>
        <p>이 Widget은 선언된 Query와 Action을 안전하게 실행할 준비가 되어 있습니다.</p>
      </article>
    ))}</div>
  </section>;
}

function FormNodes({ nodes, collection, values, readable, writable, errors, resources, canUploadMedia, onChange }: {
  readonly nodes: readonly FormLayoutNode[];
  readonly collection: CollectionSummaryDto | undefined;
  readonly values: Readonly<Record<string, unknown>>;
  readonly readable: readonly string[] | null | undefined;
  readonly writable: readonly string[] | null | undefined;
  readonly errors: Readonly<Record<string, string>>;
  readonly resources: RuntimeFormResources;
  readonly canUploadMedia: boolean;
  readonly onChange: (name: string, value: unknown) => void;
}) {
  return <>{nodes.map((node) => {
    if (node.type === "field") {
      const field = collection?.fields.find(({ id }) => id === node.fieldId);
      const canRead = readable === null || readable?.includes(node.fieldId) === true;
      const canWrite = writable === null || writable?.includes(node.fieldId) === true;
      if (field === undefined || node.hidden === true || (!canRead && !canWrite)) return null;
      return <FieldControl key={node.id} field={field} value={values[field.name]}
        readOnly={node.readOnly === true || (writable !== null && !writable?.includes(field.id))}
        label={node.label} description={node.description} error={errors[field.name]}
        relationOptions={field.targetCollectionId === undefined ? [] : resources.relations[field.targetCollectionId] ?? []}
        media={resources.media}
        canUploadMedia={canUploadMedia}
        onUploadMedia={resources.uploadMedia}
        onChange={(value) => onChange(field.name, value)} />;
    }
    if (node.type === "section") return <fieldset key={node.id} className={styles.formSection}>
      {node.title ? <legend>{node.title}</legend> : null}{node.description ? <p>{node.description}</p> : null}
      <div className={styles.formGrid} style={{ gridTemplateColumns: `repeat(${node.columns ?? 1}, minmax(0, 1fr))` }}>
        <FormNodes nodes={node.children} collection={collection} values={values} readable={readable} writable={writable} errors={errors} resources={resources} canUploadMedia={canUploadMedia} onChange={onChange} />
      </div>
    </fieldset>;
    if (node.type === "tabs") return <div key={node.id} className={styles.formSection}>{node.tabs.map((tab) => <section key={tab.id}><h3>{tab.label}</h3><FormNodes nodes={tab.children} collection={collection} values={values} readable={readable} writable={writable} errors={errors} resources={resources} canUploadMedia={canUploadMedia} onChange={onChange} /></section>)}</div>;
    return <details key={node.id} className={styles.formSection} open={node.initiallyOpen}><summary>{node.title}</summary><FormNodes nodes={node.children} collection={collection} values={values} readable={readable} writable={writable} errors={errors} resources={resources} canUploadMedia={canUploadMedia} onChange={onChange} /></details>;
  })}</>;
}

function FieldControl({ field, value, readOnly, label, description, error, relationOptions, media, canUploadMedia, onUploadMedia, onChange }: {
  readonly field: FieldSummaryDto;
  readonly value: unknown;
  readonly readOnly: boolean;
  readonly label?: string;
  readonly description?: string;
  readonly error?: string;
  readonly relationOptions: readonly DocumentRecordDto[];
  readonly media: readonly MediaRecordDto[];
  readonly canUploadMedia: boolean;
  readonly onUploadMedia: (file: File) => Promise<MediaRecordDto>;
  readonly onChange: (value: unknown) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const title = label ?? field.label ?? field.name;
  const id = `runtime-field-${field.id}`;
  const common = { id, name: field.name, disabled: readOnly, required: field.required, "aria-invalid": error === undefined ? undefined : true };
  let control: ReactNode;
  if (field.type === "boolean") {
    control = <input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  } else if (field.type === "textarea" || field.type === "rich-text") {
    control = <textarea {...common} rows={6} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  } else if (field.type === "number") {
    control = <input {...common} type="number" value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />;
  } else if (field.type === "date" || field.type === "datetime") {
    control = <input {...common} type={field.type === "date" ? "date" : "datetime-local"} value={typeof value === "string" ? value.slice(0, field.type === "date" ? 10 : 16) : ""} onChange={(event) => onChange(event.target.value)} />;
  } else if (field.type === "select" || field.type === "enum") {
    const selected = field.multiple === true
      ? (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
      : (typeof value === "string" ? value : "");
    control = <select {...common} multiple={field.multiple === true} value={selected} onChange={(event) => onChange(field.multiple === true
      ? [...event.currentTarget.selectedOptions].map(({ value: selectedValue }) => selectedValue)
      : event.currentTarget.value || null)}>
      {field.multiple === true ? null : <option value="">선택하지 않음</option>}
      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  } else if (field.type === "relation") {
    const selected = field.relationCardinality === "many"
      ? (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
      : (typeof value === "string" ? value : "");
    control = <select {...common} multiple={field.relationCardinality === "many"} value={selected} onChange={(event) => onChange(field.relationCardinality === "many"
      ? [...event.currentTarget.selectedOptions].map(({ value: selectedValue }) => selectedValue)
      : event.currentTarget.value || null)}>
      {field.relationCardinality === "many" ? null : <option value="">연결하지 않음</option>}
      {relationOptions.map((document) => <option key={document.id} value={document.id}>{documentChoiceLabel(document)}</option>)}
    </select>;
  } else if (field.type === "upload") {
    const selected = field.multiple === true
      ? (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
      : (typeof value === "string" ? value : "");
    control = <div className={styles.mediaPicker}>
      <select {...common} multiple={field.multiple === true} value={selected} onChange={(event) => onChange(field.multiple === true
        ? [...event.currentTarget.selectedOptions].map(({ value: selectedValue }) => selectedValue)
        : event.currentTarget.value || null)}>
        {field.multiple === true ? null : <option value="">미디어 없음</option>}
        {media.filter(({ mimeType }) => field.acceptedMimeTypes === undefined || field.acceptedMimeTypes.includes(mimeType))
          .map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.mimeType}</option>)}
      </select>
      {canUploadMedia && !readOnly ? <label className={styles.uploadButton}>
        {uploading ? "업로드 중…" : "새 파일 업로드"}
        <input type="file" disabled={uploading} accept={field.acceptedMimeTypes?.join(",")} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file === undefined) return;
          setUploading(true); setUploadError(null);
          void onUploadMedia(file).then((uploaded) => {
            if (field.multiple === true) {
              const current = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
              onChange([...current, uploaded.id]);
            } else {
              onChange(uploaded.id);
            }
          }).catch((caught) => setUploadError(message(caught))).finally(() => setUploading(false));
        }} />
      </label> : null}
      {uploadError ? <small className={styles.fieldError}>{uploadError}</small> : null}
    </div>;
  } else if (["json", "object", "array", "blocks", "component"].includes(field.type)) {
    control = <textarea {...common} rows={5} value={value === undefined ? "" : JSON.stringify(value, null, 2)} onChange={(event) => {
      try { onChange(event.target.value === "" ? null : JSON.parse(event.target.value)); } catch { /* keep editing until valid JSON */ }
    }} />;
  } else {
    control = <input {...common} type="text" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  }
  return <div className={styles.field}>
    <label htmlFor={id}>{title}{field.required ? " *" : ""}</label>
    {control}
    {description ? <small>{description}</small> : null}
    {error ? <small className={styles.fieldError}>{error}</small> : null}
  </div>;
}

function NavigationItem({ item, currentPageId, onNavigate }: {
  readonly item: AdminNavigationItem;
  readonly currentPageId: string;
  readonly onNavigate: (pageId: string) => void;
}) {
  if (item.pageId !== undefined) {
    const target = item.pageId;
    return <button type="button" data-active={target === currentPageId} onClick={() => onNavigate(target)}>{item.label}</button>;
  }
  return <section className={styles.navGroup} aria-label={`${item.label} 메뉴 그룹`}><span>{item.label}</span>{item.children?.map((child) => <NavigationItem key={child.id} item={child} currentPageId={currentPageId} onNavigate={onNavigate} />)}</section>;
}

function visibleNavigationItem(item: AdminNavigationItem, runtime: AdminAppRuntimeDto): AdminNavigationItem | null {
  const visible = conditionAllowed(item.visibility, runtime);
  if (!visible) return null;
  const children = item.children?.map((child) => visibleNavigationItem(child, runtime)).filter((child): child is AdminNavigationItem => child !== null);
  const pageVisible = item.pageId === undefined || runtime.access.pages[item.pageId] === true;
  if (!pageVisible && (children?.length ?? 0) === 0) return null;
  return { ...item, ...(children === undefined ? {} : { children }), ...(pageVisible ? {} : { pageId: undefined }) };
}

function conditionAllowed(condition: AdminNavigationItem["visibility"], runtime: AdminAppRuntimeDto): boolean {
  if (condition === undefined) return true;
  const allowed = (reference: { readonly action: string; readonly resourceId: string }) =>
    runtime.access.permissions[`${reference.action}@${encodeURIComponent(reference.resourceId)}`] === true;
  if (condition.allPermissions?.some((reference) => !allowed(reference))) return false;
  if (condition.anyPermissions !== undefined && !condition.anyPermissions.some(allowed)) return false;
  return true;
}

function PageHeader({ eyebrow, title, action = null }: { readonly eyebrow: string; readonly title: string; readonly action?: ReactNode }) {
  return <header className={styles.pageHeader}><div><span>{eyebrow}</span><h1>{title}</h1></div>{action}</header>;
}

function RuntimeMessage({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className={styles.message}><h1>{title}</h1><p>{children}</p></section>;
}

function collectionFor(runtime: AdminAppRuntimeDto, collectionId: string): CollectionSummaryDto | undefined {
  return runtime.schema.collections.find(({ id }) => id === collectionId);
}

function columnLabel(field: { readonly kind: string; readonly fieldId?: string; readonly field?: string }, collection?: CollectionSummaryDto): string {
  if (field.kind === "system") return field.field ?? "System";
  return collection?.fields.find(({ id }) => id === field.fieldId)?.label ?? field.fieldId ?? "Field";
}

function renderColumn(document: DocumentRecordDto, field: { readonly kind: string; readonly fieldId?: string; readonly field?: string }, collection?: CollectionSummaryDto): ReactNode {
  if (field.kind === "system") return renderValue(document[field.field as keyof DocumentRecordDto]);
  const name = collection?.fields.find(({ id }) => id === field.fieldId)?.name;
  return renderValue(name === undefined ? undefined : document.data[name]);
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return <span className={styles.muted}>—</span>;
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return <code>{JSON.stringify(value)}</code>;
}

function documentChoiceLabel(document: DocumentRecordDto): string {
  const preferred = ["title", "name", "label", "slug"]
    .map((key) => document.data[key])
    .find((value) => typeof value === "string" && value.trim().length > 0);
  if (typeof preferred === "string") return `${preferred} · ${document.id}`;
  const fallback = Object.values(document.data)
    .find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof fallback === "string" ? `${fallback} · ${document.id}` : document.id;
}

function audienceLabel(runtime: AdminAppRuntimeDto): string {
  return runtime.user.realmKey === undefined ? "System App" : `${runtime.user.realmKey} · Realm App`;
}

function message(error: unknown): string {
  return error instanceof AdminRuntimeApiError || error instanceof Error ? error.message : "요청을 처리할 수 없습니다.";
}

function validationIssues(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof AdminRuntimeApiError)) return {};
  return Object.fromEntries((error.problem?.issues ?? []).flatMap((issue) => {
    const path = issue.path.map(String);
    const dataIndex = path.indexOf("data");
    const name = dataIndex >= 0 ? path[dataIndex + 1] : path.at(-1);
    return name === undefined ? [] : [[name, issue.message]];
  }));
}

function withoutKey(values: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  if (!(key in values)) return values;
  const next = { ...values };
  delete next[key];
  return next;
}
