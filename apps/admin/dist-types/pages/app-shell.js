import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, LoadingIndicator } from "@xecms/ui";
import { allAccessAllowed, anyAccessAllowed, useAdminApi, } from "@xecms/admin";
import { permissionCheck, systemResources, useAccessProfile, } from "../access-profile.js";
import { Icon } from "../components/icon.js";
import { DisplayModeSelector, displayModeAtLeast, useDisplayMode, } from "../display-mode.js";
import styles from "../app-shell.module.css";
import { queryKeys } from "../queries.js";
export const navigationAccessChecks = [
    permissionCheck("nav.content.list", "content.list", systemResources.content),
    permissionCheck("nav.content.schema", "schema.read", systemResources.schema),
    permissionCheck("nav.schema", "schema.read", systemResources.schema),
    permissionCheck("nav.media", "media.read", systemResources.workspace),
    permissionCheck("nav.users", "identity.read", systemResources.authorization),
    permissionCheck("nav.realms", "identity.read", systemResources.authorization),
    permissionCheck("nav.access", "authorization.read", systemResources.authorization),
    permissionCheck("nav.jobs", "job.read", systemResources.workspace),
    permissionCheck("nav.operations.audit", "audit.read", systemResources.workspace),
    permissionCheck("nav.operations.retention", "retention.read", systemResources.workspace),
    permissionCheck("nav.operations.media", "media.consistency.read", systemResources.workspace),
    permissionCheck("nav.plugins", "plugin.read", systemResources.workspace),
    permissionCheck("nav.settings.system", "system.settings.read", systemResources.workspace),
    permissionCheck("nav.settings.sites", "site.read", systemResources.workspace),
];
export const navigationItems = [
    { to: "/admin/content", icon: "content", label: "콘텐츠", minimum: "basic", access: ["nav.content.list", "nav.content.schema"], requireAll: true },
    { to: "/admin/schema", icon: "schema", label: "스키마", minimum: "basic", access: ["nav.schema"] },
    { to: "/admin/media", icon: "media", label: "미디어", minimum: "basic", access: ["nav.media"] },
    { to: "/admin/users", icon: "identity", label: "사용자", minimum: "basic", access: ["nav.users"] },
    { to: "/admin/realms", icon: "identity", label: "Identity Realms", minimum: "standard", access: ["nav.realms"] },
    { to: "/admin/access", icon: "shield", label: "권한", minimum: "standard", access: ["nav.access"] },
    { to: "/admin/jobs", icon: "events", label: "이벤트 작업", minimum: "advanced", access: ["nav.jobs"] },
    { to: "/admin/operations", icon: "shield", label: "운영 및 감사", minimum: "advanced", access: ["nav.operations.audit", "nav.operations.retention", "nav.operations.media"] },
    { to: "/admin/plugins", icon: "schema", label: "Plugins", minimum: "advanced", access: ["nav.plugins"] },
    { to: "/admin/settings", icon: "workspace", label: "설정 및 사이트", minimum: "basic", access: ["nav.settings.system", "nav.settings.sites"] },
];
export function visibleNavigationItems(mode, profile) {
    return navigationItems.filter((item) => displayModeAtLeast(mode, item.minimum)
        && (item.requireAll
            ? allAccessAllowed(profile, item.access)
            : anyAccessAllowed(profile, item.access)));
}
export function AdminIndexRedirect() {
    const { mode } = useDisplayMode();
    const accessProfile = useAccessProfile("admin-navigation", navigationAccessChecks);
    if (accessProfile.isPending) {
        return _jsx(LoadingIndicator, { label: "\uC811\uADFC \uAC00\uB2A5\uD55C \uCCAB \uD654\uBA74\uC744 \uCC3E\uB294 \uC911" });
    }
    if (accessProfile.isError) {
        return (_jsx(EmptyState, { title: "\uBA54\uB274 \uAD8C\uD55C\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC7A0\uC2DC \uD6C4 \uC0C8\uB85C\uACE0\uCE68\uD558\uAC70\uB098 \uC11C\uBC84 \uC0C1\uD0DC\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }));
    }
    const first = visibleNavigationItems(mode, accessProfile.data)[0];
    if (first !== undefined)
        return _jsx(Navigate, { to: first.to, replace: true });
    return (_jsx(EmptyState, { title: "\uD604\uC7AC \uD45C\uC2DC\uD560 \uC218 \uC788\uB294 \uAD00\uB9AC \uD654\uBA74\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC0C1\uB2E8 \uD45C\uC2DC \uB2E8\uACC4\uB97C \uB192\uC774\uAC70\uB098 \uAD00\uB9AC\uC790\uC5D0\uAC8C \uD544\uC694\uD55C \uAD8C\uD55C\uC744 \uC694\uCCAD\uD558\uC138\uC694." }));
}
export function AppShell() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { mode } = useDisplayMode();
    const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.auth.getSession() });
    const accessProfile = useAccessProfile("admin-navigation", navigationAccessChecks);
    const logout = useMutation({
        mutationFn: () => api.auth.logout(),
        onSuccess: () => {
            queryClient.clear();
            navigate("/admin/login", { replace: true });
        },
    });
    const username = session.data?.user?.username ?? "사용자";
    const initials = username.slice(0, 2);
    const visibleItems = visibleNavigationItems(mode, accessProfile.data);
    return (_jsxs("div", { className: styles.shell, children: [_jsx("a", { className: styles.skipLink, href: "#main-content", children: "\uBCF8\uBB38\uC73C\uB85C \uAC74\uB108\uB6F0\uAE30" }), _jsxs("aside", { className: styles.sidebar, children: [_jsxs("div", { className: styles.brandLockup, "aria-label": "XeCMS Admin Studio", children: [_jsx("span", { className: styles.brandMark, "aria-hidden": "true", children: "Xe" }), _jsxs("span", { className: styles.brandCopy, children: [_jsx("span", { className: styles.brandName, children: "XeCMS" }), _jsx("span", { className: styles.brandMeta, children: "Admin Studio" })] })] }), _jsxs("div", { className: styles.workspaceCard, children: [_jsx("span", { className: styles.workspaceIcon, children: _jsx(Icon, { name: "workspace", size: 17 }) }), _jsxs("span", { className: styles.workspaceCopy, children: [_jsx("strong", { children: "Default Workspace" }), _jsx("span", { children: "Development instance" })] })] }), _jsxs("nav", { className: styles.nav, "aria-label": "Admin \uC8FC \uBA54\uB274", children: [_jsx("span", { className: styles.navLabel, children: "Workspace" }), accessProfile.isPending ? (_jsx("span", { className: styles.navMessage, children: "\uC811\uADFC \uAC00\uB2A5\uD55C \uBA54\uB274 \uD655\uC778 \uC911\u2026" })) : accessProfile.isError ? (_jsx("span", { className: styles.navMessage, children: "\uBA54\uB274 \uAD8C\uD55C\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." })) : visibleItems.length === 0 ? (_jsx("span", { className: styles.navMessage, children: "\uD45C\uC2DC \uAC00\uB2A5\uD55C \uAD00\uB9AC \uBA54\uB274\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." })) : visibleItems.map((item) => (_jsxs(NavLink, { to: item.to, children: [_jsx(Icon, { name: item.icon, size: 18 }), _jsx("span", { children: item.label })] }, item.to)))] }), _jsxs("div", { className: styles.sidebarFooter, children: [_jsxs("div", { className: styles.account, children: [_jsx("span", { className: styles.avatar, "aria-hidden": "true", children: initials }), _jsxs("span", { className: styles.accountCopy, children: [_jsx("strong", { children: username }), _jsx("span", { children: accessProfile.data
                                                    ? `System Realm · Policy r${accessProfile.data.policyRevision}`
                                                    : "System Realm 계정" })] })] }), _jsxs(Button, { variant: "quiet", size: "small", className: styles.logoutButton, onPress: () => logout.mutate(), isDisabled: logout.isPending, children: [_jsx(Icon, { name: "logout", size: 17 }), _jsx("span", { className: styles.logoutLabel, children: logout.isPending ? "로그아웃 중…" : "로그아웃" })] })] })] }), _jsxs("div", { className: styles.content, children: [_jsxs("header", { className: styles.topbar, children: [_jsxs("div", { className: styles.topbarContext, children: [_jsx("strong", { children: "Admin Studio" }), _jsx("span", { className: styles.topbarDivider, "aria-hidden": "true" }), _jsx("span", { children: "Default Workspace" })] }), _jsxs("div", { className: styles.topbarActions, children: [_jsx(DisplayModeSelector, { compact: true }), _jsx("span", { className: styles.environment, children: "Development" })] })] }), _jsx("main", { id: "main-content", className: styles.main, tabIndex: -1, children: _jsx(Outlet, {}) })] })] }));
}
//# sourceMappingURL=app-shell.js.map