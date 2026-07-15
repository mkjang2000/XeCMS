import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { documentRevisionOriginLabel, toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, EmptyState } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { DocumentStatus } from "../components/document-status.js";
import { Page, PageHeader } from "../components/page.js";
import { documentTitle, formatAdminDate } from "../document-presentation.js";
import { queryKeys } from "../queries.js";
function RevisionFlags({ revision }) {
    if (!revision.isCurrentDraft && !revision.isPublished)
        return null;
    return (_jsxs("span", { className: styles.revisionFlags, children: [revision.isCurrentDraft ? _jsx(Badge, { tone: "info", children: "\uD604\uC7AC \uCD08\uC548" }) : null, revision.isPublished ? _jsx(Badge, { tone: "success", children: "\uD604\uC7AC \uAC8C\uC2DC \uBC84\uC804" }) : null] }));
}
function RevisionOrigin({ revision }) {
    return (_jsxs("span", { className: styles.revisionOrigin, children: [_jsx("span", { children: documentRevisionOriginLabel(revision.origin) }), revision.origin.kind === "restore" ? (_jsxs("code", { children: ["\uC6D0\uBCF8 ", revision.origin.restoredFromRevisionId] })) : null] }));
}
export function RevisionHistoryPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const { collectionId = "", documentId = "" } = useParams();
    const collection = useQuery({
        queryKey: queryKeys.collectionApplied(collectionId),
        queryFn: () => api.collections.getApplied(collectionId),
    });
    const document = useQuery({
        queryKey: queryKeys.document(collectionId, documentId),
        queryFn: () => api.documents.get(collectionId, documentId),
    });
    const revisions = useQuery({
        queryKey: queryKeys.revisions(collectionId, documentId),
        queryFn: () => api.revisions.list(collectionId, documentId),
    });
    if (collection.isPending || document.isPending || revisions.isPending) {
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uBC84\uC804 \uAE30\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    }
    if (collection.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collection.error, onRetry: () => void collection.refetch() }) });
    if (document.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: document.error, onRetry: () => void document.refetch() }) });
    if (revisions.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: revisions.error, onRetry: () => void revisions.refetch() }) });
    const title = documentTitle(document.data, collection.data);
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Revision history", title: `${title} 버전 기록`, description: `${revisions.data.items.length}개 버전 · 현재 문서 버전 ${revisions.data.documentVersion}`, actions: (_jsx(Button, { variant: "secondary", onPress: () => navigate(`/admin/content/${collectionId}/${documentId}`), children: "\uBB38\uC11C \uD3B8\uC9D1\uC73C\uB85C" })) }), _jsxs("div", { className: styles.documentMeta, children: [_jsx(DocumentStatus, { state: document.data.displayState, announce: true }), _jsxs("span", { children: ["\uBB38\uC11C ID ", document.data.id] })] }), revisions.data.items.length === 0 ? (_jsx(EmptyState, { title: "\uBC84\uC804 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uBB38\uC11C\uB97C \uC800\uC7A5\uD558\uBA74 \uBC84\uC804 \uAE30\uB85D\uC774 \uC0DD\uC131\uB429\uB2C8\uB2E4." })) : (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsxs("caption", { className: styles.visuallyHidden, children: [title, " \uBC84\uC804 \uAE30\uB85D"] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "\uBC84\uC804" }), _jsx("th", { scope: "col", children: "\uC0DD\uC131 \uC774\uC720" }), _jsx("th", { scope: "col", children: "\uC0C1\uD0DC" }), _jsx("th", { scope: "col", children: "\uC0DD\uC131 \uC815\uBCF4" }), _jsx("th", { scope: "col", children: "\uBBF8\uB9AC\uBCF4\uAE30" })] }) }), _jsx("tbody", { children: revisions.data.items.map((revision) => (_jsxs("tr", { children: [_jsx("td", { children: _jsxs("strong", { children: ["\uBC84\uC804 ", revision.sequence] }) }), _jsx("td", { children: _jsx(RevisionOrigin, { revision: revision }) }), _jsx("td", { children: _jsx(RevisionFlags, { revision: revision }) }), _jsx("td", { children: _jsxs("span", { className: styles.revisionCreated, children: [_jsx("span", { children: formatAdminDate(revision.createdAt) }), _jsx("span", { children: revision.createdBy })] }) }), _jsx("td", { children: _jsxs(Link, { to: `/admin/content/${collectionId}/${documentId}/revisions/${revision.id}`, children: ["\uBC84\uC804 ", revision.sequence, " \uBBF8\uB9AC\uBCF4\uAE30"] }) })] }, revision.id))) })] }) }))] }));
}
export function RevisionPreviewPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { collectionId = "", documentId = "", revisionId = "" } = useParams();
    const [showRestore, setShowRestore] = useState(false);
    const collection = useQuery({
        queryKey: queryKeys.collectionApplied(collectionId),
        queryFn: () => api.collections.getApplied(collectionId),
    });
    const document = useQuery({
        queryKey: queryKeys.document(collectionId, documentId),
        queryFn: () => api.documents.get(collectionId, documentId),
    });
    const revisions = useQuery({
        queryKey: queryKeys.revisions(collectionId, documentId),
        queryFn: () => api.revisions.list(collectionId, documentId),
    });
    const revision = useQuery({
        queryKey: queryKeys.revision(collectionId, documentId, revisionId),
        queryFn: () => api.revisions.get(collectionId, documentId, revisionId),
    });
    const restore = useMutation({
        mutationFn: () => api.revisions.restore(collectionId, documentId, revisionId, { expectedVersion: revisions.data.documentVersion }),
        onSuccess: async (saved) => {
            setShowRestore(false);
            queryClient.setQueryData(queryKeys.document(collectionId, documentId), saved);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.revisionsRoot(collectionId, documentId) }),
            ]);
            navigate(`/admin/content/${collectionId}/${documentId}`);
        },
        onError: () => setShowRestore(false),
    });
    const reloadLatest = async () => {
        restore.reset();
        await Promise.all([document.refetch(), revisions.refetch(), revision.refetch()]);
    };
    const restoreError = restore.isError ? toAdminApiError(restore.error) : null;
    const isVersionConflict = restoreError?.code === "DOCUMENT_VERSION_CONFLICT";
    if (collection.isPending || document.isPending || revisions.isPending || revision.isPending) {
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uBC84\uC804 \uBBF8\uB9AC\uBCF4\uAE30\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    }
    if (collection.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collection.error, onRetry: () => void collection.refetch() }) });
    if (document.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: document.error, onRetry: () => void document.refetch() }) });
    if (revisions.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: revisions.error, onRetry: () => void revisions.refetch() }) });
    if (revision.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: revision.error, onRetry: () => void revision.refetch() }) });
    const title = documentTitle(document.data, collection.data);
    const canRestore = document.data.displayState !== "deleted" && document.data.displayState !== "archived";
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Revision snapshot", title: `${title} · 버전 ${revision.data.sequence}`, description: `${formatAdminDate(revision.data.createdAt)} · ${documentRevisionOriginLabel(revision.data.origin)}`, actions: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", onPress: () => navigate(`/admin/content/${collectionId}/${documentId}/revisions`), children: "\uBC84\uC804 \uAE30\uB85D\uC73C\uB85C" }), canRestore ? (_jsx(Button, { isDisabled: restore.isPending, onPress: () => setShowRestore(true), children: "\uC0C8 \uCD08\uC548\uC73C\uB85C \uBCF5\uC6D0" })) : null] })) }), _jsxs("div", { className: styles.documentMeta, children: [_jsx(DocumentStatus, { state: document.data.displayState, announce: true }), _jsx(RevisionFlags, { revision: revision.data })] }), !canRestore ? (_jsx(Callout, { tone: "warning", children: document.data.displayState === "deleted"
                    ? "휴지통에 있는 문서는 먼저 복원해야 과거 버전을 새 초안으로 만들 수 있습니다."
                    : "보관된 문서는 보관 상태를 해제해야 과거 버전을 새 초안으로 만들 수 있습니다." })) : null, isVersionConflict ? _jsx(ConflictNotice, { onReload: () => void reloadLatest() }) : null, restoreError && !isVersionConflict ? _jsx(LoadError, { error: restoreError }) : null, _jsxs("section", { className: styles.snapshotCard, "aria-labelledby": "revision-snapshot-heading", children: [_jsxs("div", { className: styles.snapshotHeader, children: [_jsxs("div", { children: [_jsx("h2", { id: "revision-snapshot-heading", children: "\uC800\uC7A5\uB41C \uB370\uC774\uD130 \uC2A4\uB0C5\uC0F7" }), _jsx("p", { children: "\uC774 \uD654\uBA74\uC740 \uC77D\uAE30 \uC804\uC6A9\uC774\uBA70 \uD604\uC7AC \uD3B8\uC9D1 \uC911\uC778 \uBB38\uC11C\uC5D0\uB294 \uC601\uD5A5\uC744 \uC8FC\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." })] }), _jsx("code", { children: revision.data.id })] }), _jsx("pre", { className: styles.snapshot, "aria-label": `버전 ${revision.data.sequence} JSON 미리보기`, children: _jsx("code", { children: JSON.stringify(revision.data.data, null, 2) }) })] }), showRestore && canRestore ? (_jsxs(ConfirmDialog, { title: "\uBC84\uC804 \uBCF5\uC6D0", confirmLabel: "\uC0C8 \uCD08\uC548\uC73C\uB85C \uBCF5\uC6D0", isPending: restore.isPending, onCancel: () => setShowRestore(false), onConfirm: () => restore.mutate(), children: ["\uBC84\uC804 ", revision.data.sequence, "\uC758 \uB370\uC774\uD130\uB97C \uC0C8 \uCD08\uC548\uC73C\uB85C \uBCF5\uC6D0\uD569\uB2C8\uB2E4. \uD604\uC7AC \uAC8C\uC2DC \uC911\uC778 \uBC84\uC804\uC740 \uBCC0\uACBD\uB418\uC9C0 \uC54A\uC73C\uBA70, \uBCF5\uC6D0 \uACB0\uACFC\uB3C4 \uC0C8\uB85C\uC6B4 \uBC84\uC804 \uAE30\uB85D\uC73C\uB85C \uB0A8\uC2B5\uB2C8\uB2E4."] })) : null] }));
}
//# sourceMappingURL=revision-pages.js.map