import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, CheckboxField, EmptyState } from "@xecms/ui";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
const severityLabel = { safe: "안전", risky: "주의", destructive: "파괴적" };
function ChangeItem({ change }) {
    const severityClass = change.severity === "destructive"
        ? styles.severityDestructive
        : change.severity === "risky" ? styles.severityRisky : "";
    return (_jsxs("li", { className: styles.change, children: [_jsx("span", { className: `${styles.severity} ${severityClass}`, children: severityLabel[change.severity] }), _jsxs("div", { children: [_jsx("p", { children: change.description }), _jsx("div", { className: styles.changePath, children: change.path.join(" › ") })] })] }));
}
export function MigrationPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { collectionId = "" } = useParams();
    const [approved, setApproved] = useState(false);
    const collection = useQuery({
        queryKey: queryKeys.collectionDraft(collectionId),
        queryFn: () => api.collections.get(collectionId),
    });
    const diagnostics = useQuery({
        queryKey: queryKeys.diagnostics,
        queryFn: () => api.settings.diagnostics(),
    });
    const editable = diagnostics.data?.schemaMode === "editable";
    const preview = useQuery({
        queryKey: queryKeys.migration(collectionId, collection.data?.draftVersion ?? "none"),
        queryFn: () => api.collections.preview(collectionId, { expectedDraftVersion: collection.data.draftVersion }),
        enabled: collection.data !== undefined && editable,
    });
    const apply = useMutation({
        mutationFn: () => api.collections.apply(collectionId, {
            planId: preview.data.planId,
            expectedDraftVersion: preview.data.draftVersion,
            approveDestructive: preview.data.destructive && approved,
        }),
        onSuccess: async (updated) => {
            queryClient.setQueryData(queryKeys.collectionDraft(collectionId), updated);
            queryClient.setQueryData(queryKeys.collectionApplied(collectionId), updated);
            await queryClient.invalidateQueries({ queryKey: queryKeys.collections });
            navigate(`/admin/content/${collectionId}`);
        },
    });
    const applyError = apply.isError ? toAdminApiError(apply.error) : null;
    if (collection.isPending || diagnostics.isPending || (editable && preview.isPending))
        return _jsx(Page, { children: _jsx(PageLoading, { label: "Migration \uACC4\uD68D\uC744 \uACC4\uC0B0\uD558\uB294 \uC911" }) });
    if (collection.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collection.error, onRetry: () => void collection.refetch() }) });
    if (diagnostics.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: diagnostics.error, onRetry: () => void diagnostics.refetch() }) });
    if (!editable)
        return _jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Migration review", title: "\uBCC0\uACBD \uC0AC\uD56D \uAC80\uD1A0", description: "Schema \uC801\uC6A9 \uC815\uCC45\uC744 \uD655\uC778\uD569\uB2C8\uB2E4." }), _jsxs(Callout, { tone: "warning", children: ["Schema mode\uAC00 ", _jsx("strong", { children: diagnostics.data.schemaMode }), "\uC774\uBBC0\uB85C migration preview\uC640 \uC801\uC6A9\uC774 \uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4."] }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { variant: "secondary", onPress: () => navigate(`/admin/schema/${collectionId}`), children: "\uC2A4\uD0A4\uB9C8\uB85C \uB3CC\uC544\uAC00\uAE30" }) })] });
    if (preview.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: preview.error, onRetry: () => void preview.refetch() }) });
    if (preview.data === undefined)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "Migration \uACC4\uD68D\uC744 \uACC4\uC0B0\uD558\uB294 \uC911" }) });
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Migration review", title: "\uBCC0\uACBD \uC0AC\uD56D \uAC80\uD1A0", description: `${collection.data.label || collection.data.name}에서 시작한 변경을 포함해 저장된 전체 Schema 변경을 한 번에 적용합니다.` }), _jsx(Callout, { tone: "info", children: "Migration \uC801\uC6A9 \uB2E8\uC704\uB294 Workspace\uC758 \uC804\uCCB4 Schema\uC785\uB2C8\uB2E4. \uC544\uB798 \uBAA9\uB85D\uC5D0\uB294 \uB2E4\uB978 \uCEEC\uB809\uC158\uC758 \uB300\uAE30 \uC911\uC778 \uBCC0\uACBD\uB3C4 \uBAA8\uB450 \uD45C\uC2DC\uB429\uB2C8\uB2E4." }), applyError?.status === 409 ? _jsx(ConflictNotice, { onReload: () => { void collection.refetch(); void preview.refetch(); apply.reset(); } }) : null, applyError && applyError.status !== 409 ? _jsx(LoadError, { error: applyError }) : null, preview.data.changes.length === 0 ? (_jsx(EmptyState, { title: "\uC801\uC6A9\uD560 \uBCC0\uACBD \uC0AC\uD56D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC2A4\uD0A4\uB9C8\uC640 \uD604\uC7AC \uB370\uC774\uD130\uBCA0\uC774\uC2A4\uAC00 \uC774\uBBF8 \uC77C\uCE58\uD569\uB2C8\uB2E4." })) : (_jsxs("section", { className: styles.card, "aria-labelledby": "changes-heading", children: [_jsx("h2", { id: "changes-heading", className: styles.sectionHeading, children: "Schema \uBCC0\uACBD" }), _jsx("ul", { className: styles.changeList, children: preview.data.changes.map((change) => _jsx(ChangeItem, { change: change }, change.id)) })] })), preview.data.operations.length > 0 ? (_jsxs("section", { className: styles.card, "aria-labelledby": "operations-heading", children: [_jsx("h2", { id: "operations-heading", className: styles.sectionHeading, children: "Database \uC791\uC5C5" }), _jsx("ul", { className: styles.changeList, children: preview.data.operations.map((operation) => (_jsxs("li", { children: [_jsx("p", { children: operation.description }), operation.sql ? _jsx("pre", { className: styles.sql, children: _jsx("code", { children: operation.sql }) }) : null] }, operation.id))) })] })) : null, preview.data.destructive ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uB370\uC774\uD130\uAC00 \uC190\uC2E4\uB420 \uC218 \uC788\uB294 \uBCC0\uACBD\uC785\uB2C8\uB2E4." }), _jsx(CheckboxField, { isSelected: approved, onChange: setApproved, children: "\uB370\uC774\uD130 \uC190\uC2E4 \uAC00\uB2A5\uC131\uC744 \uD655\uC778\uD588\uC73C\uBA70 \uD30C\uAD34\uC801 \uBCC0\uACBD\uC744 \uC2B9\uC778\uD569\uB2C8\uB2E4" })] })) : null, _jsxs("div", { className: styles.formActions, "aria-busy": apply.isPending, children: [_jsx(Button, { variant: preview.data.destructive ? "danger" : "primary", onPress: () => apply.mutate(), isDisabled: apply.isPending || preview.data.changes.length === 0 || (preview.data.destructive && !approved), children: apply.isPending ? "적용 중…" : "변경 적용" }), _jsx(Button, { variant: "secondary", isDisabled: apply.isPending, onPress: () => navigate(`/admin/schema/${collectionId}`), children: "\uC2A4\uD0A4\uB9C8\uB85C \uB3CC\uC544\uAC00\uAE30" })] })] }));
}
//# sourceMappingURL=migration-page.js.map