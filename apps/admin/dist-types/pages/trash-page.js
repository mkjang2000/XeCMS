import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { calculateLastPage, parsePageParameter, toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Button, Callout, ConfirmDialog, EmptyState, TextInput } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { CollectionWorkspaceNav } from "../components/collection-workspace-nav.js";
import { DocumentPagination } from "../components/document-pagination.js";
import { DocumentStatus } from "../components/document-status.js";
import { Page, PageHeader } from "../components/page.js";
import { documentTitle, formatAdminDate } from "../document-presentation.js";
import { queryKeys } from "../queries.js";
export function TrashPage() {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const { collectionId = "" } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const rawPage = searchParams.get("page");
    const page = parsePageParameter(rawPage);
    const [purgeTarget, setPurgeTarget] = useState(null);
    const [purgeConfirmation, setPurgeConfirmation] = useState("");
    const collection = useQuery({
        queryKey: queryKeys.collectionApplied(collectionId),
        queryFn: () => api.collections.getApplied(collectionId),
    });
    const documents = useQuery({
        queryKey: queryKeys.documents(collectionId, page, "deleted"),
        queryFn: () => api.documents.list(collectionId, { page, pageSize: 25, state: "deleted" }),
    });
    const restore = useMutation({
        mutationFn: (target) => api.documents.restoreDeleted(collectionId, target.id, { expectedVersion: target.version }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
        },
    });
    const purge = useMutation({
        mutationFn: (target) => api.documents.purge(collectionId, target.id, { expectedVersion: target.version }),
        onSuccess: async () => {
            setPurgeTarget(null);
            setPurgeConfirmation("");
            await queryClient.invalidateQueries({ queryKey: queryKeys.documentsRoot(collectionId) });
        },
        onError: () => {
            // Keep an error visible outside the modal and discard the target's stale
            // aggregate version. The user can reload the list and explicitly choose
            // the current row before attempting purge again.
            setPurgeTarget(null);
            setPurgeConfirmation("");
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
    const mutationError = restore.isError
        ? toAdminApiError(restore.error)
        : purge.isError
            ? toAdminApiError(purge.error)
            : null;
    const isVersionConflict = mutationError?.code === "DOCUMENT_VERSION_CONFLICT";
    const reloadLatest = async () => {
        setPurgeTarget(null);
        setPurgeConfirmation("");
        restore.reset();
        purge.reset();
        await documents.refetch();
    };
    if (collection.isPending || documents.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uD734\uC9C0\uD1B5\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (collection.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collection.error, onRetry: () => void collection.refetch() }) });
    if (documents.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: documents.error, onRetry: () => void documents.refetch() }) });
    const busy = restore.isPending || purge.isPending;
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Content trash", title: `${collection.data.label || collection.data.name} 휴지통`, description: `삭제된 문서 ${documents.data.total}개` }), _jsx(CollectionWorkspaceNav, { collectionId: collectionId }), _jsx(Callout, { tone: "warning", children: "\uC0AD\uC81C\uB41C \uBB38\uC11C\uB294 \uACF5\uAC1C\uB418\uC9C0 \uC54A\uC9C0\uB9CC \uBC84\uC804 \uAE30\uB85D\uACFC \uCC38\uC870\uAC00 \uC720\uC9C0\uB429\uB2C8\uB2E4. \uC601\uAD6C \uC0AD\uC81C\uB294 \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }), isVersionConflict ? _jsx(ConflictNotice, { onReload: () => void reloadLatest() }) : null, mutationError && !isVersionConflict ? _jsx(LoadError, { error: mutationError }) : null, documents.data.items.length === 0 ? (_jsx(EmptyState, { title: "\uD734\uC9C0\uD1B5\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4", description: "\uC0AD\uC81C\uD55C \uBB38\uC11C\uAC00 \uC774\uACF3\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4." })) : (_jsx("div", { className: styles.tableWrap, "aria-busy": busy, children: _jsxs("table", { className: styles.table, children: [_jsxs("caption", { className: styles.visuallyHidden, children: [collection.data.label || collection.data.name, " \uD734\uC9C0\uD1B5 \uBB38\uC11C \uBAA9\uB85D"] }), _jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "\uBB38\uC11C" }), _jsx("th", { scope: "col", children: "\uC0C1\uD0DC" }), _jsx("th", { scope: "col", children: "\uC0AD\uC81C \uC815\uBCF4" }), _jsx("th", { scope: "col", children: "\uC791\uC5C5" })] }) }), _jsx("tbody", { children: documents.data.items.map((item) => {
                                const title = documentTitle(item, collection.data);
                                return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { className: styles.documentTitle, children: title }), _jsx("span", { className: styles.documentId, children: item.id })] }), _jsx("td", { children: _jsx(DocumentStatus, { state: item.displayState }) }), _jsx("td", { children: item.deletion ? (_jsxs("span", { className: styles.deletionMeta, children: [_jsx("span", { children: formatAdminDate(item.deletion.deletedAt) }), _jsx("span", { children: item.deletion.deletedBy }), item.deletion.reason ? _jsx("span", { children: item.deletion.reason }) : null] })) : "삭제 정보 없음" }), _jsx("td", { children: _jsxs("div", { className: styles.rowActions, children: [_jsx(Button, { size: "small", variant: "secondary", "aria-label": `${title} 복원`, isDisabled: busy, onPress: () => {
                                                            purge.reset();
                                                            restore.mutate(item);
                                                        }, children: "\uBCF5\uC6D0" }), _jsx(Button, { size: "small", variant: "danger", "aria-label": `${title} 영구 삭제`, isDisabled: busy, onPress: () => {
                                                            restore.reset();
                                                            purge.reset();
                                                            setPurgeConfirmation("");
                                                            setPurgeTarget(item);
                                                        }, children: "\uC601\uAD6C \uC0AD\uC81C" })] }) })] }, item.id));
                            }) })] }) })), _jsx(DocumentPagination, { page: documents.data.page, pageSize: documents.data.pageSize, total: documents.data.total, onChange: (nextPage) => setSearchParams(nextPage <= 1 ? {} : { page: String(nextPage) }) }), purgeTarget ? (_jsx(ConfirmDialog, { title: "\uBB38\uC11C \uC601\uAD6C \uC0AD\uC81C", confirmLabel: "\uC601\uAD6C \uC0AD\uC81C", danger: true, isPending: purge.isPending, isConfirmDisabled: purgeConfirmation !== purgeTarget.id, onCancel: () => {
                    setPurgeTarget(null);
                    setPurgeConfirmation("");
                }, onConfirm: () => purge.mutate(purgeTarget), children: _jsxs("div", { className: styles.purgeConfirmation, children: [_jsx("p", { children: "\uBB38\uC11C\uC640 \uBAA8\uB4E0 \uBC84\uC804 \uAE30\uB85D\uC744 \uC644\uC804\uD788 \uC0AD\uC81C\uD569\uB2C8\uB2E4. \uC774 \uC791\uC5C5\uC740 \uB418\uB3CC\uB9B4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }), _jsx("code", { children: purgeTarget.id }), _jsx(TextInput, { label: "\uD655\uC778\uC744 \uC704\uD574 \uBB38\uC11C ID \uC785\uB825", description: "\uC704 \uBB38\uC11C ID\uB97C \uC815\uD655\uD788 \uC785\uB825\uD574\uC57C \uC601\uAD6C \uC0AD\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", value: purgeConfirmation, onChange: setPurgeConfirmation, autoFocus: true })] }) })) : null] }));
}
//# sourceMappingURL=trash-page.js.map