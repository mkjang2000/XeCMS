import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  calculateLastPage,
  createDefaultFieldRegistry,
  documentPublishActionLabel,
  parsePageParameter,
  toAdminApiError,
  useAdminApi,
  type CollectionDetail,
  type CollectionField,
  type DocumentChoice,
  type DocumentData,
  type DocumentRecord,
  type DocumentTreeNode,
  type MediaRecord,
  type MoveDocumentPermissionImpact,
  type MoveDocumentPreview,
  type MoveDocumentResult,
} from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, EmptyState, SelectField, TextInput } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { CollectionWorkspaceNav } from "../components/collection-workspace-nav.js";
import { DocumentPagination } from "../components/document-pagination.js";
import { DocumentStatus } from "../components/document-status.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader } from "../components/page.js";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import {
  decideDocumentFormSync,
  documentTitle,
  formatAdminDate,
} from "../document-presentation.js";
import { queryKeys } from "../queries.js";

const fieldRegistry = createDefaultFieldRegistry();

function choiceLabel(document: DocumentRecord): string {
  const preferred = ["title", "name", "label", "slug"]
    .map((key) => document.data[key])
    .find((value) => typeof value === "string" && value.trim());
  const candidate = preferred ?? Object.values(document.data)
    .find((value) => typeof value === "string" && value.trim());
  return typeof candidate === "string" ? `${candidate} · ${document.id}` : document.id;
}

function TreeRow({
  node,
  nodes,
  collectionId,
  structureVersion,
  isMoving,
  onMove,
}: {
  readonly node: DocumentTreeNode;
  readonly nodes: readonly DocumentTreeNode[];
  readonly collectionId: string;
  readonly structureVersion: number;
  readonly isMoving: boolean;
  readonly onMove: (node: DocumentTreeNode, parentId: string | null, position: number) => void;
}) {
  const navigate = useNavigate();
  const [parentId, setParentId] = useState(node.parentId ?? "");
  const [position, setPosition] = useState(String(node.position));
  useEffect(() => {
    setParentId(node.parentId ?? "");
    setPosition(String(node.position));
  }, [node.parentId, node.position, structureVersion]);
  const descendants = new Set(nodes.filter((candidate) => candidate.path.includes(node.document.id)).map(({ document }) => document.id));
  const titles = new Map(nodes.map((candidate) => [candidate.document.id, choiceLabel(candidate.document)]));
  const breadcrumbs = node.path.map((id) => titles.get(id) ?? id);
  return (
    <li className={styles.treeNode} style={{ "--tree-depth": node.depth } as CSSProperties}>
      <div className={styles.treeNodeMain}>
        <span className={styles.treeGuide} aria-hidden="true" />
        <div className={styles.treeNodeCopy}>
          <Link to={`/admin/content/${collectionId}/${node.document.id}`}>{choiceLabel(node.document)}</Link>
          <span>{breadcrumbs.join(" / ") || "최상위"}</span>
        </div>
        <DocumentStatus state={node.document.displayState} />
        {node.hasChildren ? <Badge tone="neutral">하위 있음</Badge> : null}
      </div>
      <div className={styles.treeControls} aria-label={`${choiceLabel(node.document)} 계층 편집`}>
        <label>
          <span>부모</span>
          <select value={parentId} disabled={isMoving} onChange={(event) => setParentId(event.target.value)}>
            <option value="">최상위</option>
            {nodes.filter((candidate) => candidate.document.id !== node.document.id && !descendants.has(candidate.document.id)).map((candidate) => (
              <option key={candidate.document.id} value={candidate.document.id}>{"　".repeat(candidate.depth)}{choiceLabel(candidate.document)}</option>
            ))}
          </select>
        </label>
        <TextInput label="순서" type="number" value={position} onChange={setPosition} isDisabled={isMoving} />
        <Button size="small" variant="secondary" isDisabled={isMoving} onPress={() => onMove(node, parentId || null, Math.max(0, Number(position) || 0))}>이동</Button>
        <Button size="small" variant="quiet" isDisabled={isMoving || node.position <= 0} onPress={() => onMove(node, node.parentId, node.position - 1)} aria-label="한 칸 위로">↑</Button>
        <Button size="small" variant="quiet" isDisabled={isMoving} onPress={() => onMove(node, node.parentId, node.position + 1)} aria-label="한 칸 아래로">↓</Button>
        <Button size="small" variant="quiet" onPress={() => navigate(`/admin/content/${collectionId}/new?parent=${encodeURIComponent(node.document.id)}`)}>하위 추가</Button>
      </div>
    </li>
  );
}

interface PendingDocumentMove {
  readonly node: DocumentTreeNode;
  readonly parentId: string | null;
  readonly position: number;
  readonly expectedVersion: number;
  readonly preview: MoveDocumentPreview;
}

function documentPathLabel(
  ids: readonly string[],
  titles: ReadonlyMap<string, string>,
): string {
  return ids.map((id) => titles.get(id) ?? id).join(" / ") || "최상위";
}

function parentLabel(
  parentId: string | null,
  titles: ReadonlyMap<string, string>,
): string {
  return parentId === null ? "최상위" : (titles.get(parentId) ?? parentId);
}

function PermissionImpactDetails({
  impact,
  titles,
}: {
  readonly impact: MoveDocumentPermissionImpact;
  readonly titles: ReadonlyMap<string, string>;
}) {
  const permissionChanges = impact.effectivePermissionChanges ?? [];
  const fieldChanges = impact.effectiveFieldAccessChanges ?? [];
  const fieldList = (fields: readonly string[] | null): string => {
    if (fields === null) return "전체 필드";
    return fields.length === 0 ? "허용 필드 없음" : fields.join(", ");
  };
  return (
    <div className={styles.permissionImpact}>
      <div className={styles.impactPaths}>
        <div><span>이동 전 권한 경로</span><strong>{documentPathLabel(impact.beforeDocumentPath, titles)}</strong><code>{impact.beforeParentResourceId}</code></div>
        <span aria-hidden="true">→</span>
        <div><span>이동 후 권한 경로</span><strong>{documentPathLabel(impact.afterDocumentPath, titles)}</strong><code>{impact.afterParentResourceId}</code></div>
      </div>
      <div className={styles.impactSummary}>
        <Badge tone="warning">권한 영향</Badge>
        <span>문서 {impact.affectedDocumentIds.length}개 · Authorization Resource {impact.affectedResourceIds.length}개가 새 상속 경로를 사용합니다.</span>
      </div>
      {impact.requiresAuthorizationManagement === true ? (
        <Callout tone="warning">Binding 또는 필드 Scope의 적용 범위가 달라지므로 보호된 Owner 권한으로만 이 이동을 승인할 수 있습니다.</Callout>
      ) : null}
      {permissionChanges.length > 0 ? (
        <ul className={styles.permissionDeltaList} aria-label="실질 권한 변화">
          {permissionChanges.map((change) => {
            const gained = !change.beforeAllowed && change.afterAllowed;
            return (
              <li key={`${change.subjectId}:${change.resourceId}:${change.permission}`}>
                <Badge tone={gained ? "success" : "danger"}>{gained ? "획득" : "상실"}</Badge>
                <span>{change.subjectId}</span>
                <code>{change.permission}</code>
              </li>
            );
          })}
        </ul>
      ) : null}
      {fieldChanges.length > 0 ? (
        <ul className={styles.permissionDeltaList} aria-label="필드 접근 변화">
          {fieldChanges.map((change) => {
            const broadened = change.change === "broadened";
            const label = broadened ? "확대" : change.change === "narrowed" ? "축소" : "변경";
            return (
              <li key={`${change.subjectId}:${change.resourceId}:${change.operation}`}>
                <Badge tone={broadened ? "warning" : change.change === "narrowed" ? "danger" : "neutral"}>{label}</Badge>
                <span>{change.subjectId}</span>
                <code>{change.operation === "read" ? "필드 읽기" : "필드 쓰기"}</code>
                <span className={styles.fieldDelta}>{fieldList(change.beforeFields)} → {fieldList(change.afterFields)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {impact.effectivePermissionChangesTruncated === true ? (
        <Callout tone="warning">권한 영향이 계산 상한을 넘어 일부 변화만 표시됩니다. 구조 경로와 Owner 승인 규칙은 전체 subtree에 적용됩니다.</Callout>
      ) : null}
    </div>
  );
}

function MovePreviewDetails({
  pending,
  nodes,
}: {
  readonly pending: PendingDocumentMove;
  readonly nodes: readonly DocumentTreeNode[];
}) {
  const titles = new Map(nodes.map((node) => [node.document.id, choiceLabel(node.document)]));
  const affectedIds = pending.preview.permissionImpact?.affectedDocumentIds
    ?? pending.preview.affectedDocumentIds;
  return (
    <div className={styles.movePreview}>
      <p><strong>{choiceLabel(pending.node.document)}</strong>의 위치를 변경하기 전에 콘텐츠와 권한 영향을 확인하세요.</p>
      <div className={styles.moveParents}>
        <div><span>현재 부모</span><strong>{parentLabel(pending.preview.previousParentId, titles)}</strong><small>순서 {pending.preview.previousPosition}</small></div>
        <span aria-hidden="true">→</span>
        <div><span>새 부모</span><strong>{parentLabel(pending.parentId, titles)}</strong><small>순서 {pending.position}</small></div>
      </div>
      {pending.preview.permissionImpact ? (
        <PermissionImpactDetails impact={pending.preview.permissionImpact} titles={titles} />
      ) : (
        <Callout tone="info">이 Collection은 권한 상속을 사용하지 않아 Authorization Scope 경로는 바뀌지 않습니다.</Callout>
      )}
      <details className={styles.affectedDocuments}>
        <summary>영향받는 문서 {affectedIds.length}개 보기</summary>
        <ul>{affectedIds.map((id) => <li key={id}>{titles.get(id) ?? id}</li>)}</ul>
      </details>
      <p className={styles.previewRevision}>Tree v{pending.expectedVersion} · Policy r{pending.preview.policyRevision} 기준 미리보기</p>
    </div>
  );
}

function MoveResultNotice({
  result,
  nodes,
}: {
  readonly result: MoveDocumentResult;
  readonly nodes: readonly DocumentTreeNode[];
}) {
  const titles = new Map(nodes.map((node) => [node.document.id, choiceLabel(node.document)]));
  const impact = result.permissionImpact;
  return (
    <Callout tone="success">
      <strong>{choiceLabel(result.node.document)} 이동 완료</strong>
      <div>Tree v{result.version} · Policy r{result.policyRevision}</div>
      {impact ? <div>{documentPathLabel(impact.beforeDocumentPath, titles)} → {documentPathLabel(impact.afterDocumentPath, titles)} · 영향 문서 {impact.affectedDocumentIds.length}개</div> : null}
    </Callout>
  );
}

export function DocumentListPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const { collectionId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get("page");
  const page = parsePageParameter(rawPage);
  const view = searchParams.get("view") === "tree" ? "tree" : "table";
  const collection = useQuery({
    queryKey: queryKeys.collectionApplied(collectionId),
    queryFn: () => api.collections.getApplied(collectionId),
  });
  const documents = useQuery({
    queryKey: queryKeys.documents(collectionId, page, "active"),
    queryFn: () => api.documents.list(collectionId, { page, pageSize: 25, state: "active" }),
  });
  const tree = useQuery({
    queryKey: queryKeys.documentTree(collectionId),
    queryFn: () => api.documents.tree(collectionId),
    enabled: collection.data?.hierarchy?.enabled === true && view === "tree",
  });
  const queryClient = useQueryClient();
  const [pendingMove, setPendingMove] = useState<PendingDocumentMove | null>(null);
  const [lastMoveResult, setLastMoveResult] = useState<MoveDocumentResult | null>(null);
  const previewMove = useMutation({
    mutationFn: async ({ node, parentId, position }: {
      readonly node: DocumentTreeNode;
      readonly parentId: string | null;
      readonly position: number;
    }) => ({
      node,
      parentId,
      position,
      expectedVersion: tree.data!.version,
      preview: await api.documents.previewMove(collectionId, node.document.id, {
        newParentId: parentId,
        position,
        expectedVersion: tree.data!.version,
      }),
    }),
    onSuccess: (pending) => {
      setLastMoveResult(null);
      setPendingMove(pending);
    },
  });
  const move = useMutation({
    mutationFn: (pending: PendingDocumentMove) =>
      api.documents.move(collectionId, pending.node.document.id, {
        newParentId: pending.parentId,
        position: pending.position,
        expectedVersion: pending.expectedVersion,
        expectedPolicyRevision: pending.preview.policyRevision,
      }),
    onSuccess: async (result) => {
      setPendingMove(null);
      setLastMoveResult(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.documentTree(collectionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.authorization }),
      ]);
    },
  });

  useEffect(() => {
    if (rawPage !== null && page === 1 && rawPage !== "1") {
      setSearchParams({}, { replace: true });
      return;
    }
    if (documents.data && documents.data.total > 0 && documents.data.items.length === 0 && page > 1) {
      const lastPage = calculateLastPage(documents.data.total, documents.data.pageSize);
      setSearchParams(lastPage === 1 ? {} : { page: String(lastPage) }, { replace: true });
    }
  }, [documents.data, page, rawPage, setSearchParams]);
  const columns = useMemo<ColumnDef<DocumentRecord>[]>(() => {
    const helper = createColumnHelper<DocumentRecord>();
    return [
      helper.accessor((row) => collection.data ? documentTitle(row, collection.data) : row.id, {
        id: "title",
        header: "문서",
        cell: ({ row, getValue }) => (
          <Link to={`/admin/content/${collectionId}/${row.original.id}`}>{getValue()}</Link>
        ),
      }),
      helper.accessor("displayState", {
        header: "상태",
        cell: ({ getValue }) => <DocumentStatus state={getValue()} />,
      }),
      helper.accessor("updatedAt", {
        header: "수정일",
        cell: ({ getValue }) => formatAdminDate(getValue()),
      }),
      helper.accessor("version", { header: "버전" }),
    ];
  }, [collection.data, collectionId]);
  // TanStack Table treats a new data reference as a data change. Creating an
  // array inline here continuously reset its internal pagination state and,
  // in development StrictMode, starved React Router navigation commits.
  const tableData = useMemo(
    () => [...(documents.data?.items ?? [])],
    [documents.data?.items],
  );
  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (collection.isPending || documents.isPending || (view === "tree" && tree.isPending)) return <Page><PageLoading label="문서를 불러오는 중" /></Page>;
  if (collection.isError) return <Page><LoadError error={collection.error} onRetry={() => void collection.refetch()} /></Page>;
  if (documents.isError) return <Page><LoadError error={documents.error} onRetry={() => void documents.refetch()} /></Page>;
  if (view === "tree" && tree.isError) return <Page><LoadError error={tree.error} onRetry={() => void tree.refetch()} /></Page>;

  const canCreate = collection.data.kind !== "singleton" || documents.data.total === 0;
  const setView = (next: "table" | "tree") => {
    const params = new URLSearchParams(searchParams);
    if (next === "tree") params.set("view", "tree"); else params.delete("view");
    params.delete("page");
    setSearchParams(params);
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Content collection"
        title={collection.data.label || collection.data.name}
        description={`전체 ${documents.data.total}개의 문서`}
        actions={canCreate ? <Button onPress={() => navigate(`/admin/content/${collectionId}/new`)}><Icon name="plus" size={17} />새 문서</Button> : <Badge tone="neutral">싱글턴 문서 생성됨</Badge>}
      />
      <CollectionWorkspaceNav collectionId={collectionId} />
      {collection.data.hierarchy?.enabled ? (
        <div className={styles.viewSwitcher} aria-label="문서 목록 보기 방식">
          <Button size="small" variant={view === "table" ? "primary" : "quiet"} onPress={() => setView("table")}>표 보기</Button>
          <Button size="small" variant={view === "tree" ? "primary" : "quiet"} onPress={() => setView("tree")}>트리 보기</Button>
        </div>
      ) : null}
      {previewMove.isError ? <LoadError error={previewMove.error} /> : null}
      {move.isError && pendingMove === null ? <LoadError error={move.error} /> : null}
      {lastMoveResult && tree.data ? <MoveResultNotice result={lastMoveResult} nodes={tree.data.items} /> : null}
      {view === "tree" && tree.data ? (
        tree.data.items.length === 0 ? (
          <EmptyState title="아직 계층 문서가 없습니다" description="최상위 문서를 만든 다음 하위 문서를 추가해 보세요." action={canCreate ? <Button onPress={() => navigate(`/admin/content/${collectionId}/new`)}><Icon name="plus" size={17} />최상위 문서</Button> : undefined} />
        ) : (
          <section className={styles.treeCard} aria-label={`${collection.data.label || collection.data.name} 콘텐츠 트리`}>
            <div className={styles.treeLegend}><span>문서 · breadcrumb</span><span>부모와 수동 순서를 변경한 뒤 이동을 누르세요. 구조 버전 {tree.data.version}</span></div>
            <ol className={styles.treeList}>
              {tree.data.items.map((node) => <TreeRow key={node.document.id} node={node} nodes={tree.data.items} collectionId={collectionId} structureVersion={tree.data.version} isMoving={previewMove.isPending || move.isPending || pendingMove !== null} onMove={(target, parentId, position) => previewMove.mutate({ node: target, parentId, position })} />)}
            </ol>
          </section>
        )
      ) : documents.data.items.length === 0 ? (
        <EmptyState
          title="아직 문서가 없습니다"
          description="첫 문서를 작성해 컬렉션을 채워 보세요."
          action={canCreate ? <Button onPress={() => navigate(`/admin/content/${collectionId}/new`)}><Icon name="plus" size={17} />새 문서</Button> : undefined}
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>{collection.data.label || collection.data.name} 문서 목록</caption>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} scope="col">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={styles.linkedRow}
                  onClick={(event) => {
                    if (
                      event.target instanceof Element
                      && event.target.closest("a, button, input, select, textarea")
                    ) return;
                    navigate(`/admin/content/${collectionId}/${row.original.id}`);
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "table" ? <DocumentPagination
        page={documents.data.page}
        pageSize={documents.data.pageSize}
        total={documents.data.total}
        onChange={(nextPage) => setSearchParams(nextPage <= 1 ? {} : { page: String(nextPage) })}
      /> : null}
      {pendingMove && tree.data ? (
        <ConfirmDialog
          title="콘텐츠 이동 및 권한 영향"
          confirmLabel="확인 후 이동"
          isPending={move.isPending}
          onCancel={() => {
            if (move.isPending) return;
            setPendingMove(null);
            move.reset();
          }}
          onConfirm={() => move.mutate(pendingMove)}
        >
          <MovePreviewDetails pending={pendingMove} nodes={tree.data.items} />
          {move.isError ? <LoadError error={move.error} /> : null}
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}

interface DocumentFormValues {
  data: Record<string, unknown>;
}

function initialValues(collection: CollectionDetail, document?: DocumentRecord): DocumentFormValues {
  return {
    data: Object.fromEntries(collection.fields.map((field) => [
      field.name,
      document?.data[field.name] ?? (
        field.multiple || field.cardinality === "many"
          ? []
          : fieldRegistry.get(field.type).initialValue
      ),
    ])),
  };
}

function normalizeDocumentData(values: DocumentFormValues, fields: readonly CollectionField[]): DocumentData {
  return Object.freeze(Object.fromEntries(fields.flatMap((field) => {
    const value = values.data[field.name];
    if (!field.required && (value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0))) return [];
    return [[field.name, value]];
  })));
}

function validateRequired(field: CollectionField, value: unknown): true | string {
  if (!field.required) return true;
  if (field.type === "boolean" && typeof value === "boolean") return true;
  if (field.type === "number" && typeof value === "number" && Number.isFinite(value)) return true;
  if (["text", "textarea", "date", "datetime", "select", "enum", "relation", "upload"].includes(field.type) && typeof value === "string" && value.trim()) return true;
  if (Array.isArray(value) && value.length > 0) return true;
  if (value !== null && typeof value === "object") return true;
  return `${field.label || field.name} 값을 입력해 주세요.`;
}

export function DocumentEditorPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { collectionId = "", documentId } = useParams();
  const [editorSearchParams] = useSearchParams();
  const requestedParentId = editorSearchParams.get("parent");
  const isNew = documentId === undefined;
  const [showDelete, setShowDelete] = useState(false);
  const [showUnpublish, setShowUnpublish] = useState(false);
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const initializedRouteRef = useRef<string | null>(null);
  const loadedVersionRef = useRef<number | null>(null);
  const collection = useQuery({
    queryKey: queryKeys.collectionApplied(collectionId),
    queryFn: () => api.collections.getApplied(collectionId),
  });
  const document = useQuery({
    queryKey: queryKeys.document(collectionId, documentId ?? "new"),
    queryFn: () => api.documents.get(collectionId, documentId!),
    enabled: !isNew,
  });
  const relationTargetIds = [...new Set((collection.data?.fields ?? []).flatMap((field) =>
    field.type === "relation" && field.targetCollectionId ? [field.targetCollectionId] : []))];
  const relationDocuments = useQuery({
    queryKey: queryKeys.relationOptions(relationTargetIds),
    queryFn: async () => Object.fromEntries(await Promise.all(relationTargetIds.map(async (targetId) => {
      const result = await api.documents.list(targetId, { page: 1, pageSize: 100, state: "active" });
      return [targetId, result.items.map((item): DocumentChoice => ({ value: item.id, label: choiceLabel(item) }))] as const;
    }))),
    enabled: relationTargetIds.length > 0,
  });
  const hasUploadFields = collection.data?.fields.some(({ type }) => type === "upload") ?? false;
  const media = useQuery({
    queryKey: queryKeys.media,
    queryFn: () => api.media.list(),
    enabled: hasUploadFields,
  });
  const tree = useQuery({
    queryKey: queryKeys.documentTree(collectionId),
    queryFn: () => api.documents.tree(collectionId),
    enabled: collection.data?.hierarchy?.enabled === true,
  });
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { isDirty },
  } = useForm<DocumentFormValues>({ defaultValues: { data: {} } });

  useEffect(() => {
    if (!collection.data || (!isNew && !document.data)) return;

    const routeKey = isNew
      ? `new:${collectionId}`
      : `document:${collectionId}:${documentId ?? ""}`;
    const decision = decideDocumentFormSync({
      routeKey,
      initializedRouteKey: initializedRouteRef.current,
      isNew,
      loadedVersion: loadedVersionRef.current,
      ...(document.data === undefined ? {} : { remoteVersion: document.data.version }),
      isDirty,
    });
    if (decision === "initialize") {
      reset(initialValues(collection.data, document.data));
      initializedRouteRef.current = routeKey;
      loadedVersionRef.current = document.data?.version ?? null;
      setRemoteUpdateAvailable(false);
      return;
    }

    // A background query refresh must never overwrite a dirty form or let the
    // form borrow the newer aggregate version and bypass optimistic locking.
    if (decision === "conflict") {
      setRemoteUpdateAvailable(true);
      return;
    }
    if (decision === "reset" && document.data) {
      reset(initialValues(collection.data, document.data));
      loadedVersionRef.current = document.data.version;
      setRemoteUpdateAvailable(false);
    }
  }, [collection.data, collectionId, document.data, documentId, isDirty, isNew, reset]);

  const expectedVersion = () => loadedVersionRef.current ?? document.data!.version;

  const save = useMutation({
    mutationFn: (values: DocumentFormValues) => {
      const data = normalizeDocumentData(values, collection.data!.fields);
      return isNew
        ? api.documents.create(collectionId, {
          data,
          ...(requestedParentId ? { parentId: requestedParentId } : {}),
        })
        : api.documents.update(collectionId, documentId, { data, expectedVersion: expectedVersion() });
    },
    onSuccess: async (saved) => {
      reset(initialValues(collection.data!, saved));
      loadedVersionRef.current = saved.version;
      setRemoteUpdateAvailable(false);
      queryClient.setQueryData(queryKeys.document(collectionId, saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
      navigate(`/admin/content/${collectionId}`);
    },
    onError: (error) => {
      const apiError = toAdminApiError(error);
      let shouldFocus = true;
      Object.entries(apiError.fieldErrors).forEach(([path, message]) => {
        const fieldName = path.startsWith("data.") ? path.slice(5) : path;
        setError(`data.${fieldName}`, { message }, { shouldFocus });
        shouldFocus = false;
      });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.documents.delete(collectionId, documentId!, { expectedVersion: expectedVersion() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
      navigate(`/admin/content/${collectionId}`, { replace: true });
    },
    onError: () => setShowDelete(false),
  });
  const lifecycle = useMutation({
    mutationFn: (action: "publish" | "unpublish") => action === "publish"
      ? api.documents.publish(collectionId, documentId!, { expectedVersion: expectedVersion() })
      : api.documents.unpublish(collectionId, documentId!, { expectedVersion: expectedVersion() }),
    onSuccess: async (saved) => {
      setShowUnpublish(false);
      reset(initialValues(collection.data!, saved));
      loadedVersionRef.current = saved.version;
      setRemoteUpdateAvailable(false);
      queryClient.setQueryData(queryKeys.document(collectionId, saved.id), saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.revisionsRoot(collectionId, saved.id) }),
      ]);
    },
    onError: (_error, action) => {
      if (action === "unpublish") setShowUnpublish(false);
    },
  });

  const reloadLatest = async () => {
    const result = await document.refetch();
    if (collection.data && result.data) {
      reset(initialValues(collection.data, result.data));
      loadedVersionRef.current = result.data.version;
      setRemoteUpdateAvailable(false);
    }
    save.reset();
    remove.reset();
    lifecycle.reset();
  };
  const saveError = save.isError ? toAdminApiError(save.error) : null;
  const deleteError = remove.isError ? toAdminApiError(remove.error) : null;
  const lifecycleError = lifecycle.isError ? toAdminApiError(lifecycle.error) : null;
  const hasVersionConflict = [saveError, deleteError, lifecycleError]
    .some((error) => error?.code === "DOCUMENT_VERSION_CONFLICT");

  if (collection.isPending || (!isNew && document.isPending)) return <Page><PageLoading label="문서를 불러오는 중" /></Page>;
  if (collection.isError) return <Page><LoadError error={collection.error} onRetry={() => void collection.refetch()} /></Page>;
  if (!isNew && document.isError) return <Page><LoadError error={document.error} onRetry={() => void document.refetch()} /></Page>;

  const lifecycleBusy = lifecycle.isPending || remove.isPending;
  const publishLabel = document.data ? documentPublishActionLabel(document.data.displayState) : null;
  const readOnlyState = document.data?.displayState === "deleted" || document.data?.displayState === "archived";
  const currentTreeNode = tree.data?.items.find((node) => node.document.id === documentId);
  const treeTitles = new Map((tree.data?.items ?? []).map((node) => [node.document.id, choiceLabel(node.document)]));

  return (
    <Page>
      <PageHeader
        eyebrow="Content editor"
        title={isNew ? "새 문서" : "문서 편집"}
        description={`${collection.data.label || collection.data.name} 컬렉션`}
        actions={!isNew ? (
          <>
            <Button
              variant="secondary"
              isDisabled={save.isPending || lifecycleBusy}
              onPress={() => navigate(`/admin/content/${collectionId}/${documentId}/revisions`)}
            >
              버전 기록
            </Button>
            {document.data?.displayState === "deleted" ? (
              <Button variant="secondary" onPress={() => navigate(`/admin/content/${collectionId}/trash`)}>
                휴지통으로
              </Button>
            ) : null}
            {!readOnlyState && publishLabel ? (
              <Button
                isDisabled={isDirty || save.isPending || lifecycleBusy}
                onPress={() => lifecycle.mutate("publish")}
              >
                {lifecycle.isPending && lifecycle.variables === "publish" ? "게시 중…" : publishLabel}
              </Button>
            ) : null}
            {!readOnlyState && document.data?.publication ? (
              <Button
                variant="secondary"
                isDisabled={isDirty || save.isPending || lifecycleBusy}
                onPress={() => setShowUnpublish(true)}
              >
                게시 취소
              </Button>
            ) : null}
            {document.data?.displayState !== "deleted" ? (
              <Button
                variant="danger"
                isDisabled={save.isPending || lifecycleBusy || remoteUpdateAvailable}
                onPress={() => setShowDelete(true)}
              >
                문서 삭제
              </Button>
            ) : null}
          </>
        ) : undefined}
      />
      {document.data ? (
        <div className={styles.documentMeta}>
          <DocumentStatus state={document.data.displayState} announce />
          <span>문서 버전 {document.data.version}</span>
          {document.data.publication ? <span>게시일 {formatAdminDate(document.data.publication.publishedAt)}</span> : null}
        </div>
      ) : null}
      {collection.data.hierarchy?.enabled && (requestedParentId || currentTreeNode) ? (
        <nav className={styles.breadcrumb} aria-label="콘텐츠 위치">
          <Link to={`/admin/content/${collectionId}?view=tree`}>{collection.data.label || collection.data.name}</Link>
          {(currentTreeNode?.path ?? (requestedParentId ? [requestedParentId] : [])).map((id) => <span key={id}>/ {treeTitles.get(id) ?? id}</span>)}
          {isNew ? <strong>/ 새 하위 문서</strong> : null}
        </nav>
      ) : null}
      {relationDocuments.isError ? <LoadError error={relationDocuments.error} onRetry={() => void relationDocuments.refetch()} /> : null}
      {media.isError ? <LoadError error={media.error} onRetry={() => void media.refetch()} /> : null}
      {isDirty && publishLabel ? (
        <Callout tone="info">게시하려면 먼저 현재 변경 사항을 문서 저장해 주세요.</Callout>
      ) : null}
      {document.data?.displayState === "deleted" ? (
        <Callout tone="warning">휴지통에 있는 문서는 읽기 전용입니다. 먼저 복원한 뒤 편집하거나 게시해 주세요.</Callout>
      ) : null}
      {document.data?.displayState === "archived" ? (
        <Callout tone="warning">보관된 문서는 읽기 전용입니다. 보관 상태를 해제한 뒤 편집하거나 게시할 수 있으며, 필요하면 휴지통으로 이동할 수 있습니다.</Callout>
      ) : null}
      {hasVersionConflict || remoteUpdateAvailable ? (
        <ConflictNotice onReload={() => void reloadLatest()} />
      ) : null}
      {saveError && saveError.code !== "DOCUMENT_VERSION_CONFLICT" ? <LoadError error={saveError} /> : null}
      {deleteError && deleteError.code !== "DOCUMENT_VERSION_CONFLICT" ? <LoadError error={deleteError} /> : null}
      {lifecycleError && lifecycleError.code !== "DOCUMENT_VERSION_CONFLICT" ? <LoadError error={lifecycleError} /> : null}
      <form
        className={`${styles.card} ${styles.editorCard}`}
        aria-busy={save.isPending || lifecycleBusy}
        onSubmit={handleSubmit((values) => save.mutate(values))}
      >
        <div className={styles.editorFields}>
          {collection.data.fields.map((field) => {
            const Editor = fieldRegistry.get(field.type).Editor;
            return (
              <Controller
                key={field.id}
                control={control}
                name={`data.${field.name}`}
                rules={{ validate: (value) => validateRequired(field, value) }}
                render={({ field: { ref, ...input }, fieldState }) => (
                  <Editor
                    field={field}
                    value={input.value}
                    onChange={input.onChange}
                    onBlur={input.onBlur}
                    name={input.name}
                    inputRef={ref}
                    isDisabled={readOnlyState}
                    errorMessage={fieldState.error?.message}
                    relationOptions={field.targetCollectionId ? relationDocuments.data?.[field.targetCollectionId] : undefined}
                    mediaItems={media.data?.items as readonly MediaRecord[] | undefined}
                  />
                )}
              />
            );
          })}
        </div>
        <div className={styles.editorActions}>
          {!readOnlyState ? (
            <Button type="submit" isDisabled={save.isPending || lifecycleBusy || remoteUpdateAvailable}>{save.isPending ? "저장 중…" : "문서 저장"}</Button>
          ) : null}
          <Button type="button" variant="secondary" isDisabled={save.isPending || lifecycleBusy} onPress={() => navigate(`/admin/content/${collectionId}`)}>취소</Button>
        </div>
      </form>
      <UnsavedChangesGuard when={isDirty && !save.isPending && !lifecycleBusy} />
      {showDelete ? (
        <ConfirmDialog
          title="문서 삭제"
          confirmLabel="문서 삭제"
          danger
          isPending={remove.isPending}
          onCancel={() => setShowDelete(false)}
          onConfirm={() => remove.mutate()}
        >
          이 문서를 휴지통으로 이동하시겠습니까? 버전 기록과 문서 참조는 유지되며 휴지통에서 복원할 수 있습니다.
        </ConfirmDialog>
      ) : null}
      {showUnpublish ? (
        <ConfirmDialog
          title="게시 취소"
          confirmLabel="게시 취소"
          isPending={lifecycle.isPending}
          onCancel={() => setShowUnpublish(false)}
          onConfirm={() => lifecycle.mutate("unpublish")}
        >
          공개 중인 버전을 게시 취소하시겠습니까? 문서와 버전 기록은 그대로 유지됩니다.
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}
