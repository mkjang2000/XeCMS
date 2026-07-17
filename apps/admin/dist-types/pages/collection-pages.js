import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import { accessAllowed, useAdminApi } from "@xecms/admin";
import { permissionCheck, systemResources, useAccessProfile, } from "../access-profile.js";
import styles from "../app.module.css";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { DisplayModeGate } from "../display-mode.js";
import { Page, PageHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
const schemaActionChecks = [
    permissionCheck("schema.action.create", "schema.create", systemResources.schema),
    permissionCheck("schema.action.export", "schema.export", systemResources.schema),
];
function Status({ collection }) {
    const pending = collection.status === "applied" && collection.hasPendingChanges;
    return (_jsx(Badge, { tone: pending ? "warning" : collection.status === "applied" ? "success" : "neutral", children: pending ? "적용 대기 변경" : collection.status === "applied" ? "적용됨" : "초안" }));
}
export function SchemaListPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const query = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });
    const diagnostics = useQuery({
        queryKey: queryKeys.diagnostics,
        queryFn: () => api.settings.diagnostics(),
    });
    const accessProfile = useAccessProfile("schema-actions", schemaActionChecks);
    const editable = diagnostics.data?.schemaMode === "editable";
    const canCreate = editable && accessAllowed(accessProfile.data, "schema.action.create");
    const canUseTools = accessAllowed(accessProfile.data, "schema.action.export");
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Structure", title: "\uC2A4\uD0A4\uB9C8", description: "\uCEEC\uB809\uC158\uACFC \uD544\uB4DC\uB97C \uC815\uC758\uD55C \uB4A4 \uB370\uC774\uD130\uBCA0\uC774\uC2A4 \uBCC0\uACBD\uC744 \uAC80\uD1A0\uD569\uB2C8\uB2E4.", actions: _jsxs(_Fragment, { children: [canUseTools ? _jsx(DisplayModeGate, { minimum: "advanced", children: _jsx(Button, { variant: "secondary", onPress: () => navigate("/admin/schema/tools"), children: "Manifest \u00B7 TypeScript" }) }) : null, canCreate ? _jsxs(Button, { onPress: () => navigate("/admin/schema/new"), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC0C8 \uCF58\uD150\uCE20 \uD0C0\uC785"] }) : null] }) }), diagnostics.data && !editable ? (_jsxs(Callout, { tone: "warning", children: ["Schema mode\uAC00 ", _jsx("strong", { children: diagnostics.data.schemaMode }), "\uC774\uBBC0\uB85C \uC2DC\uAC01 \uD3B8\uC9D1\uACFC \uC801\uC6A9\uC774 \uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4."] })) : null, query.isPending ? _jsx(PageLoading, { label: "\uCEEC\uB809\uC158\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, query.isError ? _jsx(LoadError, { error: query.error, onRetry: () => void query.refetch() }) : null, query.data && query.data.items.length === 0 ? (_jsx(EmptyState, { title: "\uC544\uC9C1 \uCEEC\uB809\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCCAB \uCEEC\uB809\uC158\uC744 \uB9CC\uB4E4\uACE0 \uCF58\uD150\uCE20 \uAD6C\uC870\uB97C \uC815\uC758\uD574 \uBCF4\uC138\uC694.", action: canCreate ? _jsxs(Button, { onPress: () => navigate("/admin/schema/new"), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC0C8 \uCF58\uD150\uCE20 \uD0C0\uC785"] }) : undefined })) : null, query.data && query.data.items.length > 0 ? (_jsx("div", { className: styles.collectionGrid, children: query.data.items.map((collection) => (_jsxs(Link, { to: `/admin/schema/${collection.id}`, className: styles.collectionCard, children: [_jsxs("div", { className: styles.collectionCardTop, children: [_jsx("span", { className: styles.collectionIcon, children: _jsx(Icon, { name: "schema", size: 20 }) }), _jsx(Status, { collection: collection })] }), _jsxs("div", { className: styles.collectionCardBody, children: [_jsx("h2", { children: collection.label || collection.name }), _jsx(DisplayModeGate, { minimum: "standard", children: _jsx("div", { className: styles.collectionMeta, children: collection.name }) })] }), _jsxs("div", { className: styles.collectionCardFooter, children: [_jsxs("span", { children: ["\uD544\uB4DC ", collection.fieldCount, "\uAC1C"] }), _jsx("span", { className: styles.collectionArrow, children: _jsx(Icon, { name: "arrowRight", size: 14 }) })] })] }, collection.id))) })) : null] }));
}
export function ContentCollectionsPage() {
    const api = useAdminApi();
    const query = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });
    const applied = query.data?.items.filter(({ status }) => status === "applied") ?? [];
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Workspace", title: "\uCF58\uD150\uCE20", description: "\uC801\uC6A9\uB41C \uCEEC\uB809\uC158\uC758 \uBB38\uC11C\uB97C \uC791\uC131\uD558\uACE0 \uAD00\uB9AC\uD569\uB2C8\uB2E4." }), query.isPending ? _jsx(PageLoading, { label: "\uCEEC\uB809\uC158\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, query.isError ? _jsx(LoadError, { error: query.error, onRetry: () => void query.refetch() }) : null, query.data && applied.length === 0 ? (_jsx(EmptyState, { title: "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uCEEC\uB809\uC158\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC2A4\uD0A4\uB9C8\uC5D0\uC11C \uCEEC\uB809\uC158\uC744 \uB9CC\uB4E4\uACE0 migration\uC744 \uC801\uC6A9\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4." })) : null, applied.length > 0 ? (_jsx("div", { className: styles.collectionGrid, children: applied.map((collection) => (_jsxs(Link, { to: `/admin/content/${collection.id}`, className: styles.collectionCard, children: [_jsxs("div", { className: styles.collectionCardTop, children: [_jsx("span", { className: styles.collectionIcon, children: _jsx(Icon, { name: "content", size: 20 }) }), _jsx(Badge, { tone: "success", children: "\uC0AC\uC6A9 \uAC00\uB2A5" })] }), _jsxs("div", { className: styles.collectionCardBody, children: [_jsx("h2", { children: collection.label || collection.name }), _jsx(DisplayModeGate, { minimum: "standard", children: _jsx("div", { className: styles.collectionMeta, children: collection.name }) })] }), _jsxs("div", { className: styles.collectionCardFooter, children: [_jsxs("span", { children: ["\uD544\uB4DC ", collection.fieldCount, "\uAC1C \u00B7 \uBB38\uC11C \uAD00\uB9AC"] }), _jsx("span", { className: styles.collectionArrow, children: _jsx(Icon, { name: "arrowRight", size: 14 }) })] })] }, collection.id))) })) : null] }));
}
//# sourceMappingURL=collection-pages.js.map