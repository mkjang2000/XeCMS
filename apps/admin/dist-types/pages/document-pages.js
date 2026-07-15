import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, } from "@tanstack/react-table";
import { calculateLastPage, createDefaultFieldRegistry, documentPublishActionLabel, parsePageParameter, toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, EmptyState, SelectField, TextInput } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { CollectionWorkspaceNav } from "../components/collection-workspace-nav.js";
import { DocumentPagination } from "../components/document-pagination.js";
import { DocumentStatus } from "../components/document-status.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader } from "../components/page.js";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { decideDocumentFormSync, documentTitle, formatAdminDate, } from "../document-presentation.js";
import { queryKeys } from "../queries.js";
const fieldRegistry = createDefaultFieldRegistry();
function choiceLabel(document) {
    const preferred = ["title", "name", "label", "slug"]
        .map((key) => document.data[key])
        .find((value) => typeof value === "string" && value.trim());
    const candidate = preferred ?? Object.values(document.data)
        .find((value) => typeof value === "string" && value.trim());
    return typeof candidate === "string" ? `${candidate} · ${document.id}` : document.id;
}
function TreeRow({ node, nodes, collectionId, structureVersion, isMoving, onMove, }) {
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
    return (_jsxs("li", { className: styles.treeNode, style: { "--tree-depth": node.depth }, children: [_jsxs("div", { className: styles.treeNodeMain, children: [_jsx("span", { className: styles.treeGuide, "aria-hidden": "true" }), _jsxs("div", { className: styles.treeNodeCopy, children: [_jsx(Link, { to: `/admin/content/${collectionId}/${node.document.id}`, children: choiceLabel(node.document) }), _jsx("span", { children: breadcrumbs.join(" / ") || "최상위" })] }), _jsx(DocumentStatus, { state: node.document.displayState }), node.hasChildren ? _jsx(Badge, { tone: "neutral", children: "\uD558\uC704 \uC788\uC74C" }) : null] }), _jsxs("div", { className: styles.treeControls, "aria-label": `${choiceLabel(node.document)} 계층 편집`, children: [_jsxs("label", { children: [_jsx("span", { children: "\uBD80\uBAA8" }), _jsxs("select", { value: parentId, disabled: isMoving, onChange: (event) => setParentId(event.target.value), children: [_jsx("option", { value: "", children: "\uCD5C\uC0C1\uC704" }), nodes.filter((candidate) => candidate.document.id !== node.document.id && !descendants.has(candidate.document.id)).map((candidate) => (_jsxs("option", { value: candidate.document.id, children: ["　".repeat(candidate.depth), choiceLabel(candidate.document)] }, candidate.document.id)))] })] }), _jsx(TextInput, { label: "\uC21C\uC11C", type: "number", value: position, onChange: setPosition, isDisabled: isMoving }), _jsx(Button, { size: "small", variant: "secondary", isDisabled: isMoving, onPress: () => onMove(node, parentId || null, Math.max(0, Number(position) || 0)), children: "\uC774\uB3D9" }), _jsx(Button, { size: "small", variant: "quiet", isDisabled: isMoving || node.position <= 0, onPress: () => onMove(node, node.parentId, node.position - 1), "aria-label": "\uD55C \uCE78 \uC704\uB85C", children: "\u2191" }), _jsx(Button, { size: "small", variant: "quiet", isDisabled: isMoving, onPress: () => onMove(node, node.parentId, node.position + 1), "aria-label": "\uD55C \uCE78 \uC544\uB798\uB85C", children: "\u2193" }), _jsx(Button, { size: "small", variant: "quiet", onPress: () => navigate(`/admin/content/${collectionId}/new?parent=${encodeURIComponent(node.document.id)}`), children: "\uD558\uC704 \uCD94\uAC00" })] })] }));
}
function documentPathLabel(ids, titles) {
    return ids.map((id) => titles.get(id) ?? id).join(" / ") || "최상위";
}
function parentLabel(parentId, titles) {
    return parentId === null ? "최상위" : (titles.get(parentId) ?? parentId);
}
function PermissionImpactDetails({ impact, titles, }) {
    const permissionChanges = impact.effectivePermissionChanges ?? [];
    const fieldChanges = impact.effectiveFieldAccessChanges ?? [];
    const fieldList = (fields) => {
        if (fields === null)
            return "전체 필드";
        return fields.length === 0 ? "허용 필드 없음" : fields.join(", ");
    };
    return (_jsxs("div", { className: styles.permissionImpact, children: [_jsxs("div", { className: styles.impactPaths, children: [_jsxs("div", { children: [_jsx("span", { children: "\uC774\uB3D9 \uC804 \uAD8C\uD55C \uACBD\uB85C" }), _jsx("strong", { children: documentPathLabel(impact.beforeDocumentPath, titles) }), _jsx("code", { children: impact.beforeParentResourceId })] }), _jsx("span", { "aria-hidden": "true", children: "\u2192" }), _jsxs("div", { children: [_jsx("span", { children: "\uC774\uB3D9 \uD6C4 \uAD8C\uD55C \uACBD\uB85C" }), _jsx("strong", { children: documentPathLabel(impact.afterDocumentPath, titles) }), _jsx("code", { children: impact.afterParentResourceId })] })] }), _jsxs("div", { className: styles.impactSummary, children: [_jsx(Badge, { tone: "warning", children: "\uAD8C\uD55C \uC601\uD5A5" }), _jsxs("span", { children: ["\uBB38\uC11C ", impact.affectedDocumentIds.length, "\uAC1C \u00B7 Authorization Resource ", impact.affectedResourceIds.length, "\uAC1C\uAC00 \uC0C8 \uC0C1\uC18D \uACBD\uB85C\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4."] })] }), impact.requiresAuthorizationManagement === true ? (_jsx(Callout, { tone: "warning", children: "Binding \uB610\uB294 \uD544\uB4DC Scope\uC758 \uC801\uC6A9 \uBC94\uC704\uAC00 \uB2EC\uB77C\uC9C0\uBBC0\uB85C \uBCF4\uD638\uB41C Owner \uAD8C\uD55C\uC73C\uB85C\uB9CC \uC774 \uC774\uB3D9\uC744 \uC2B9\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : null, permissionChanges.length > 0 ? (_jsx("ul", { className: styles.permissionDeltaList, "aria-label": "\uC2E4\uC9C8 \uAD8C\uD55C \uBCC0\uD654", children: permissionChanges.map((change) => {
                    const gained = !change.beforeAllowed && change.afterAllowed;
                    return (_jsxs("li", { children: [_jsx(Badge, { tone: gained ? "success" : "danger", children: gained ? "획득" : "상실" }), _jsx("span", { children: change.subjectId }), _jsx("code", { children: change.permission })] }, `${change.subjectId}:${change.resourceId}:${change.permission}`));
                }) })) : null, fieldChanges.length > 0 ? (_jsx("ul", { className: styles.permissionDeltaList, "aria-label": "\uD544\uB4DC \uC811\uADFC \uBCC0\uD654", children: fieldChanges.map((change) => {
                    const broadened = change.change === "broadened";
                    const label = broadened ? "확대" : change.change === "narrowed" ? "축소" : "변경";
                    return (_jsxs("li", { children: [_jsx(Badge, { tone: broadened ? "warning" : change.change === "narrowed" ? "danger" : "neutral", children: label }), _jsx("span", { children: change.subjectId }), _jsx("code", { children: change.operation === "read" ? "필드 읽기" : "필드 쓰기" }), _jsxs("span", { className: styles.fieldDelta, children: [fieldList(change.beforeFields), " \u2192 ", fieldList(change.afterFields)] })] }, `${change.subjectId}:${change.resourceId}:${change.operation}`));
                }) })) : null, impact.effectivePermissionChangesTruncated === true ? (_jsx(Callout, { tone: "warning", children: "\uAD8C\uD55C \uC601\uD5A5\uC774 \uACC4\uC0B0 \uC0C1\uD55C\uC744 \uB118\uC5B4 \uC77C\uBD80 \uBCC0\uD654\uB9CC \uD45C\uC2DC\uB429\uB2C8\uB2E4. \uAD6C\uC870 \uACBD\uB85C\uC640 Owner \uC2B9\uC778 \uADDC\uCE59\uC740 \uC804\uCCB4 subtree\uC5D0 \uC801\uC6A9\uB429\uB2C8\uB2E4." })) : null] }));
}
function MovePreviewDetails({ pending, nodes, }) {
    const titles = new Map(nodes.map((node) => [node.document.id, choiceLabel(node.document)]));
    const affectedIds = pending.preview.permissionImpact?.affectedDocumentIds
        ?? pending.preview.affectedDocumentIds;
    return (_jsxs("div", { className: styles.movePreview, children: [_jsxs("p", { children: [_jsx("strong", { children: choiceLabel(pending.node.document) }), "\uC758 \uC704\uCE58\uB97C \uBCC0\uACBD\uD558\uAE30 \uC804\uC5D0 \uCF58\uD150\uCE20\uC640 \uAD8C\uD55C \uC601\uD5A5\uC744 \uD655\uC778\uD558\uC138\uC694."] }), _jsxs("div", { className: styles.moveParents, children: [_jsxs("div", { children: [_jsx("span", { children: "\uD604\uC7AC \uBD80\uBAA8" }), _jsx("strong", { children: parentLabel(pending.preview.previousParentId, titles) }), _jsxs("small", { children: ["\uC21C\uC11C ", pending.preview.previousPosition] })] }), _jsx("span", { "aria-hidden": "true", children: "\u2192" }), _jsxs("div", { children: [_jsx("span", { children: "\uC0C8 \uBD80\uBAA8" }), _jsx("strong", { children: parentLabel(pending.parentId, titles) }), _jsxs("small", { children: ["\uC21C\uC11C ", pending.position] })] })] }), pending.preview.permissionImpact ? (_jsx(PermissionImpactDetails, { impact: pending.preview.permissionImpact, titles: titles })) : (_jsx(Callout, { tone: "info", children: "\uC774 Collection\uC740 \uAD8C\uD55C \uC0C1\uC18D\uC744 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC544 Authorization Scope \uACBD\uB85C\uB294 \uBC14\uB00C\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." })), _jsxs("details", { className: styles.affectedDocuments, children: [_jsxs("summary", { children: ["\uC601\uD5A5\uBC1B\uB294 \uBB38\uC11C ", affectedIds.length, "\uAC1C \uBCF4\uAE30"] }), _jsx("ul", { children: affectedIds.map((id) => _jsx("li", { children: titles.get(id) ?? id }, id)) })] }), _jsxs("p", { className: styles.previewRevision, children: ["Tree v", pending.expectedVersion, " \u00B7 Policy r", pending.preview.policyRevision, " \uAE30\uC900 \uBBF8\uB9AC\uBCF4\uAE30"] })] }));
}
function MoveResultNotice({ result, nodes, }) {
    const titles = new Map(nodes.map((node) => [node.document.id, choiceLabel(node.document)]));
    const impact = result.permissionImpact;
    return (_jsxs(Callout, { tone: "success", children: [_jsxs("strong", { children: [choiceLabel(result.node.document), " \uC774\uB3D9 \uC644\uB8CC"] }), _jsxs("div", { children: ["Tree v", result.version, " \u00B7 Policy r", result.policyRevision] }), impact ? _jsxs("div", { children: [documentPathLabel(impact.beforeDocumentPath, titles), " \u2192 ", documentPathLabel(impact.afterDocumentPath, titles), " \u00B7 \uC601\uD5A5 \uBB38\uC11C ", impact.affectedDocumentIds.length, "\uAC1C"] }) : null] }));
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
    const [pendingMove, setPendingMove] = useState(null);
    const [lastMoveResult, setLastMoveResult] = useState(null);
    const previewMove = useMutation({
        mutationFn: async ({ node, parentId, position }) => ({
            node,
            parentId,
            position,
            expectedVersion: tree.data.version,
            preview: await api.documents.previewMove(collectionId, node.document.id, {
                newParentId: parentId,
                position,
                expectedVersion: tree.data.version,
            }),
        }),
        onSuccess: (pending) => {
            setLastMoveResult(null);
            setPendingMove(pending);
        },
    });
    const move = useMutation({
        mutationFn: (pending) => api.documents.move(collectionId, pending.node.document.id, {
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
    const columns = useMemo(() => {
        const helper = createColumnHelper();
        return [
            helper.accessor((row) => collection.data ? documentTitle(row, collection.data) : row.id, {
                id: "title",
                header: "문서",
                cell: ({ row, getValue }) => (_jsx(Link, { to: `/admin/content/${collectionId}/${row.original.id}`, children: getValue() })),
            }),
            helper.accessor("displayState", {
                header: "상태",
                cell: ({ getValue }) => _jsx(DocumentStatus, { state: getValue() }),
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
    const tableData = useMemo(() => [...(documents.data?.items ?? [])], [documents.data?.items]);
    const table = useReactTable({
        data: tableData,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });
    if (collection.isPending || documents.isPending || (view === "tree" && tree.isPending))
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uBB38\uC11C\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (collection.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collection.error, onRetry: () => void collection.refetch() }) });
    if (documents.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: documents.error, onRetry: () => void documents.refetch() }) });
    if (view === "tree" && tree.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: tree.error, onRetry: () => void tree.refetch() }) });
    const canCreate = collection.data.kind !== "singleton" || documents.data.total === 0;
    const setView = (next) => {
        const params = new URLSearchParams(searchParams);
        if (next === "tree")
            params.set("view", "tree");
        else
            params.delete("view");
        params.delete("page");
        setSearchParams(params);
    };
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Content collection", title: collection.data.label || collection.data.name, description: `전체 ${documents.data.total}개의 문서`, actions: canCreate ? _jsxs(Button, { onPress: () => navigate(`/admin/content/${collectionId}/new`), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC0C8 \uBB38\uC11C"] }) : _jsx(Badge, { tone: "neutral", children: "\uC2F1\uAE00\uD134 \uBB38\uC11C \uC0DD\uC131\uB428" }) }), _jsx(CollectionWorkspaceNav, { collectionId: collectionId }), collection.data.hierarchy?.enabled ? (_jsxs("div", { className: styles.viewSwitcher, "aria-label": "\uBB38\uC11C \uBAA9\uB85D \uBCF4\uAE30 \uBC29\uC2DD", children: [_jsx(Button, { size: "small", variant: view === "table" ? "primary" : "quiet", onPress: () => setView("table"), children: "\uD45C \uBCF4\uAE30" }), _jsx(Button, { size: "small", variant: view === "tree" ? "primary" : "quiet", onPress: () => setView("tree"), children: "\uD2B8\uB9AC \uBCF4\uAE30" })] })) : null, previewMove.isError ? _jsx(LoadError, { error: previewMove.error }) : null, move.isError && pendingMove === null ? _jsx(LoadError, { error: move.error }) : null, lastMoveResult && tree.data ? _jsx(MoveResultNotice, { result: lastMoveResult, nodes: tree.data.items }) : null, view === "tree" && tree.data ? (tree.data.items.length === 0 ? (_jsx(EmptyState, { title: "\uC544\uC9C1 \uACC4\uCE35 \uBB38\uC11C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCD5C\uC0C1\uC704 \uBB38\uC11C\uB97C \uB9CC\uB4E0 \uB2E4\uC74C \uD558\uC704 \uBB38\uC11C\uB97C \uCD94\uAC00\uD574 \uBCF4\uC138\uC694.", action: canCreate ? _jsxs(Button, { onPress: () => navigate(`/admin/content/${collectionId}/new`), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uCD5C\uC0C1\uC704 \uBB38\uC11C"] }) : undefined })) : (_jsxs("section", { className: styles.treeCard, "aria-label": `${collection.data.label || collection.data.name} 콘텐츠 트리`, children: [_jsxs("div", { className: styles.treeLegend, children: [_jsx("span", { children: "\uBB38\uC11C \u00B7 breadcrumb" }), _jsxs("span", { children: ["\uBD80\uBAA8\uC640 \uC218\uB3D9 \uC21C\uC11C\uB97C \uBCC0\uACBD\uD55C \uB4A4 \uC774\uB3D9\uC744 \uB204\uB974\uC138\uC694. \uAD6C\uC870 \uBC84\uC804 ", tree.data.version] })] }), _jsx("ol", { className: styles.treeList, children: tree.data.items.map((node) => _jsx(TreeRow, { node: node, nodes: tree.data.items, collectionId: collectionId, structureVersion: tree.data.version, isMoving: previewMove.isPending || move.isPending || pendingMove !== null, onMove: (target, parentId, position) => previewMove.mutate({ node: target, parentId, position }) }, node.document.id)) })] }))) : documents.data.items.length === 0 ? (_jsx(EmptyState, { title: "\uC544\uC9C1 \uBB38\uC11C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCCAB \uBB38\uC11C\uB97C \uC791\uC131\uD574 \uCEEC\uB809\uC158\uC744 \uCC44\uC6CC \uBCF4\uC138\uC694.", action: canCreate ? _jsxs(Button, { onPress: () => navigate(`/admin/content/${collectionId}/new`), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC0C8 \uBB38\uC11C"] }) : undefined })) : (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsxs("caption", { className: styles.visuallyHidden, children: [collection.data.label || collection.data.name, " \uBB38\uC11C \uBAA9\uB85D"] }), _jsx("thead", { children: table.getHeaderGroups().map((headerGroup) => (_jsx("tr", { children: headerGroup.headers.map((header) => (_jsx("th", { scope: "col", children: header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext()) }, header.id))) }, headerGroup.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row) => (_jsx("tr", { className: styles.linkedRow, onClick: (event) => {
                                    if (event.target instanceof Element
                                        && event.target.closest("a, button, input, select, textarea"))
                                        return;
                                    navigate(`/admin/content/${collectionId}/${row.original.id}`);
                                }, children: row.getVisibleCells().map((cell) => (_jsx("td", { children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }) })), view === "table" ? _jsx(DocumentPagination, { page: documents.data.page, pageSize: documents.data.pageSize, total: documents.data.total, onChange: (nextPage) => setSearchParams(nextPage <= 1 ? {} : { page: String(nextPage) }) }) : null, pendingMove && tree.data ? (_jsxs(ConfirmDialog, { title: "\uCF58\uD150\uCE20 \uC774\uB3D9 \uBC0F \uAD8C\uD55C \uC601\uD5A5", confirmLabel: "\uD655\uC778 \uD6C4 \uC774\uB3D9", isPending: move.isPending, onCancel: () => {
                    if (move.isPending)
                        return;
                    setPendingMove(null);
                    move.reset();
                }, onConfirm: () => move.mutate(pendingMove), children: [_jsx(MovePreviewDetails, { pending: pendingMove, nodes: tree.data.items }), move.isError ? _jsx(LoadError, { error: move.error }) : null] })) : null] }));
}
function initialValues(collection, document) {
    return {
        data: Object.fromEntries(collection.fields.map((field) => [
            field.name,
            document?.data[field.name] ?? (field.multiple || field.cardinality === "many"
                ? []
                : fieldRegistry.get(field.type).initialValue),
        ])),
    };
}
function normalizeDocumentData(values, fields) {
    return Object.freeze(Object.fromEntries(fields.flatMap((field) => {
        const value = values.data[field.name];
        if (!field.required && (value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0)))
            return [];
        return [[field.name, value]];
    })));
}
function validateRequired(field, value) {
    if (!field.required)
        return true;
    if (field.type === "boolean" && typeof value === "boolean")
        return true;
    if (field.type === "number" && typeof value === "number" && Number.isFinite(value))
        return true;
    if (["text", "textarea", "date", "datetime", "select", "enum", "relation", "upload"].includes(field.type) && typeof value === "string" && value.trim())
        return true;
    if (Array.isArray(value) && value.length > 0)
        return true;
    if (value !== null && typeof value === "object")
        return true;
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
    const initializedRouteRef = useRef(null);
    const loadedVersionRef = useRef(null);
    const collection = useQuery({
        queryKey: queryKeys.collectionApplied(collectionId),
        queryFn: () => api.collections.getApplied(collectionId),
    });
    const document = useQuery({
        queryKey: queryKeys.document(collectionId, documentId ?? "new"),
        queryFn: () => api.documents.get(collectionId, documentId),
        enabled: !isNew,
    });
    const relationTargetIds = [...new Set((collection.data?.fields ?? []).flatMap((field) => field.type === "relation" && field.targetCollectionId ? [field.targetCollectionId] : []))];
    const relationDocuments = useQuery({
        queryKey: queryKeys.relationOptions(relationTargetIds),
        queryFn: async () => Object.fromEntries(await Promise.all(relationTargetIds.map(async (targetId) => {
            const result = await api.documents.list(targetId, { page: 1, pageSize: 100, state: "active" });
            return [targetId, result.items.map((item) => ({ value: item.id, label: choiceLabel(item) }))];
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
    const { control, handleSubmit, reset, setError, formState: { isDirty }, } = useForm({ defaultValues: { data: {} } });
    useEffect(() => {
        if (!collection.data || (!isNew && !document.data))
            return;
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
    const expectedVersion = () => loadedVersionRef.current ?? document.data.version;
    const save = useMutation({
        mutationFn: (values) => {
            const data = normalizeDocumentData(values, collection.data.fields);
            return isNew
                ? api.documents.create(collectionId, {
                    data,
                    ...(requestedParentId ? { parentId: requestedParentId } : {}),
                })
                : api.documents.update(collectionId, documentId, { data, expectedVersion: expectedVersion() });
        },
        onSuccess: async (saved) => {
            reset(initialValues(collection.data, saved));
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
        mutationFn: () => api.documents.delete(collectionId, documentId, { expectedVersion: expectedVersion() }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
            navigate(`/admin/content/${collectionId}`, { replace: true });
        },
        onError: () => setShowDelete(false),
    });
    const lifecycle = useMutation({
        mutationFn: (action) => action === "publish"
            ? api.documents.publish(collectionId, documentId, { expectedVersion: expectedVersion() })
            : api.documents.unpublish(collectionId, documentId, { expectedVersion: expectedVersion() }),
        onSuccess: async (saved) => {
            setShowUnpublish(false);
            reset(initialValues(collection.data, saved));
            loadedVersionRef.current = saved.version;
            setRemoteUpdateAvailable(false);
            queryClient.setQueryData(queryKeys.document(collectionId, saved.id), saved);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.revisionsRoot(collectionId, saved.id) }),
            ]);
        },
        onError: (_error, action) => {
            if (action === "unpublish")
                setShowUnpublish(false);
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
    if (collection.isPending || (!isNew && document.isPending))
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uBB38\uC11C\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (collection.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collection.error, onRetry: () => void collection.refetch() }) });
    if (!isNew && document.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: document.error, onRetry: () => void document.refetch() }) });
    const lifecycleBusy = lifecycle.isPending || remove.isPending;
    const publishLabel = document.data ? documentPublishActionLabel(document.data.displayState) : null;
    const readOnlyState = document.data?.displayState === "deleted" || document.data?.displayState === "archived";
    const currentTreeNode = tree.data?.items.find((node) => node.document.id === documentId);
    const treeTitles = new Map((tree.data?.items ?? []).map((node) => [node.document.id, choiceLabel(node.document)]));
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Content editor", title: isNew ? "새 문서" : "문서 편집", description: `${collection.data.label || collection.data.name} 컬렉션`, actions: !isNew ? (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", isDisabled: save.isPending || lifecycleBusy, onPress: () => navigate(`/admin/content/${collectionId}/${documentId}/revisions`), children: "\uBC84\uC804 \uAE30\uB85D" }), document.data?.displayState === "deleted" ? (_jsx(Button, { variant: "secondary", onPress: () => navigate(`/admin/content/${collectionId}/trash`), children: "\uD734\uC9C0\uD1B5\uC73C\uB85C" })) : null, !readOnlyState && publishLabel ? (_jsx(Button, { isDisabled: isDirty || save.isPending || lifecycleBusy, onPress: () => lifecycle.mutate("publish"), children: lifecycle.isPending && lifecycle.variables === "publish" ? "게시 중…" : publishLabel })) : null, !readOnlyState && document.data?.publication ? (_jsx(Button, { variant: "secondary", isDisabled: isDirty || save.isPending || lifecycleBusy, onPress: () => setShowUnpublish(true), children: "\uAC8C\uC2DC \uCDE8\uC18C" })) : null, document.data?.displayState !== "deleted" ? (_jsx(Button, { variant: "danger", isDisabled: save.isPending || lifecycleBusy || remoteUpdateAvailable, onPress: () => setShowDelete(true), children: "\uBB38\uC11C \uC0AD\uC81C" })) : null] })) : undefined }), document.data ? (_jsxs("div", { className: styles.documentMeta, children: [_jsx(DocumentStatus, { state: document.data.displayState, announce: true }), _jsxs("span", { children: ["\uBB38\uC11C \uBC84\uC804 ", document.data.version] }), document.data.publication ? _jsxs("span", { children: ["\uAC8C\uC2DC\uC77C ", formatAdminDate(document.data.publication.publishedAt)] }) : null] })) : null, collection.data.hierarchy?.enabled && (requestedParentId || currentTreeNode) ? (_jsxs("nav", { className: styles.breadcrumb, "aria-label": "\uCF58\uD150\uCE20 \uC704\uCE58", children: [_jsx(Link, { to: `/admin/content/${collectionId}?view=tree`, children: collection.data.label || collection.data.name }), (currentTreeNode?.path ?? (requestedParentId ? [requestedParentId] : [])).map((id) => _jsxs("span", { children: ["/ ", treeTitles.get(id) ?? id] }, id)), isNew ? _jsx("strong", { children: "/ \uC0C8 \uD558\uC704 \uBB38\uC11C" }) : null] })) : null, relationDocuments.isError ? _jsx(LoadError, { error: relationDocuments.error, onRetry: () => void relationDocuments.refetch() }) : null, media.isError ? _jsx(LoadError, { error: media.error, onRetry: () => void media.refetch() }) : null, isDirty && publishLabel ? (_jsx(Callout, { tone: "info", children: "\uAC8C\uC2DC\uD558\uB824\uBA74 \uBA3C\uC800 \uD604\uC7AC \uBCC0\uACBD \uC0AC\uD56D\uC744 \uBB38\uC11C \uC800\uC7A5\uD574 \uC8FC\uC138\uC694." })) : null, document.data?.displayState === "deleted" ? (_jsx(Callout, { tone: "warning", children: "\uD734\uC9C0\uD1B5\uC5D0 \uC788\uB294 \uBB38\uC11C\uB294 \uC77D\uAE30 \uC804\uC6A9\uC785\uB2C8\uB2E4. \uBA3C\uC800 \uBCF5\uC6D0\uD55C \uB4A4 \uD3B8\uC9D1\uD558\uAC70\uB098 \uAC8C\uC2DC\uD574 \uC8FC\uC138\uC694." })) : null, document.data?.displayState === "archived" ? (_jsx(Callout, { tone: "warning", children: "\uBCF4\uAD00\uB41C \uBB38\uC11C\uB294 \uC77D\uAE30 \uC804\uC6A9\uC785\uB2C8\uB2E4. \uBCF4\uAD00 \uC0C1\uD0DC\uB97C \uD574\uC81C\uD55C \uB4A4 \uD3B8\uC9D1\uD558\uAC70\uB098 \uAC8C\uC2DC\uD560 \uC218 \uC788\uC73C\uBA70, \uD544\uC694\uD558\uBA74 \uD734\uC9C0\uD1B5\uC73C\uB85C \uC774\uB3D9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : null, hasVersionConflict || remoteUpdateAvailable ? (_jsx(ConflictNotice, { onReload: () => void reloadLatest() })) : null, saveError && saveError.code !== "DOCUMENT_VERSION_CONFLICT" ? _jsx(LoadError, { error: saveError }) : null, deleteError && deleteError.code !== "DOCUMENT_VERSION_CONFLICT" ? _jsx(LoadError, { error: deleteError }) : null, lifecycleError && lifecycleError.code !== "DOCUMENT_VERSION_CONFLICT" ? _jsx(LoadError, { error: lifecycleError }) : null, _jsxs("form", { className: `${styles.card} ${styles.editorCard}`, "aria-busy": save.isPending || lifecycleBusy, onSubmit: handleSubmit((values) => save.mutate(values)), children: [_jsx("div", { className: styles.editorFields, children: collection.data.fields.map((field) => {
                            const Editor = fieldRegistry.get(field.type).Editor;
                            return (_jsx(Controller, { control: control, name: `data.${field.name}`, rules: { validate: (value) => validateRequired(field, value) }, render: ({ field: { ref, ...input }, fieldState }) => (_jsx(Editor, { field: field, value: input.value, onChange: input.onChange, onBlur: input.onBlur, name: input.name, inputRef: ref, isDisabled: readOnlyState, errorMessage: fieldState.error?.message, relationOptions: field.targetCollectionId ? relationDocuments.data?.[field.targetCollectionId] : undefined, mediaItems: media.data?.items })) }, field.id));
                        }) }), _jsxs("div", { className: styles.editorActions, children: [!readOnlyState ? (_jsx(Button, { type: "submit", isDisabled: save.isPending || lifecycleBusy || remoteUpdateAvailable, children: save.isPending ? "저장 중…" : "문서 저장" })) : null, _jsx(Button, { type: "button", variant: "secondary", isDisabled: save.isPending || lifecycleBusy, onPress: () => navigate(`/admin/content/${collectionId}`), children: "\uCDE8\uC18C" })] })] }), _jsx(UnsavedChangesGuard, { when: isDirty && !save.isPending && !lifecycleBusy }), showDelete ? (_jsx(ConfirmDialog, { title: "\uBB38\uC11C \uC0AD\uC81C", confirmLabel: "\uBB38\uC11C \uC0AD\uC81C", danger: true, isPending: remove.isPending, onCancel: () => setShowDelete(false), onConfirm: () => remove.mutate(), children: "\uC774 \uBB38\uC11C\uB97C \uD734\uC9C0\uD1B5\uC73C\uB85C \uC774\uB3D9\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C? \uBC84\uC804 \uAE30\uB85D\uACFC \uBB38\uC11C \uCC38\uC870\uB294 \uC720\uC9C0\uB418\uBA70 \uD734\uC9C0\uD1B5\uC5D0\uC11C \uBCF5\uC6D0\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : null, showUnpublish ? (_jsx(ConfirmDialog, { title: "\uAC8C\uC2DC \uCDE8\uC18C", confirmLabel: "\uAC8C\uC2DC \uCDE8\uC18C", isPending: lifecycle.isPending, onCancel: () => setShowUnpublish(false), onConfirm: () => lifecycle.mutate("unpublish"), children: "\uACF5\uAC1C \uC911\uC778 \uBC84\uC804\uC744 \uAC8C\uC2DC \uCDE8\uC18C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C? \uBB38\uC11C\uC640 \uBC84\uC804 \uAE30\uB85D\uC740 \uADF8\uB300\uB85C \uC720\uC9C0\uB429\uB2C8\uB2E4." })) : null] }));
}
//# sourceMappingURL=document-pages.js.map