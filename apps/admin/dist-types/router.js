import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createBrowserRouter, isRouteErrorResponse, Navigate, redirect, useRouteError } from "react-router";
import { toAdminApiError } from "@xecms/admin";
import { Button, LoadingIndicator } from "@xecms/ui";
import styles from "./app.module.css";
import { AppShell } from "./pages/app-shell.js";
import { queryKeys } from "./queries.js";
function RouteErrorPage() {
    const error = useRouteError();
    const notFound = isRouteErrorResponse(error) && error.status === 404;
    const apiError = toAdminApiError(error);
    const unavailable = apiError.status === 0 || [502, 503, 504].includes(apiError.status);
    const title = notFound
        ? "페이지를 찾을 수 없습니다"
        : unavailable
            ? "API 서버에 연결할 수 없습니다"
            : "Admin 화면을 열 수 없습니다";
    const description = notFound
        ? "주소를 확인해 주세요."
        : unavailable
            ? "XeCMS API 실행 상태를 확인한 뒤 다시 시도해 주세요."
            : "잠시 후 다시 시도해 주세요.";
    return (_jsx("main", { className: styles.errorPage, children: _jsxs("div", { children: [_jsx("h1", { children: title }), _jsx("p", { className: styles.muted, children: description }), _jsx(Button, { onPress: () => window.location.reload(), children: "\uB2E4\uC2DC \uC2DC\uB3C4" })] }) }));
}
function RouteLoadingPage() {
    return (_jsx("main", { className: styles.errorPage, children: _jsx("div", { children: _jsx(LoadingIndicator, { label: "Admin\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) }) }));
}
function NotFoundPage() {
    return (_jsx("main", { className: styles.errorPage, children: _jsxs("div", { children: [_jsx("h1", { children: "\uD398\uC774\uC9C0\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }), _jsx("p", { className: styles.muted, children: "\uC8FC\uC18C\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }), _jsx(Button, { onPress: () => { window.location.href = "/admin/schema"; }, children: "Admin \uD648\uC73C\uB85C" })] }) }));
}
export function createAdminRouter(api, queryClient) {
    const requireSession = async () => {
        const bootstrap = await queryClient.fetchQuery({
            queryKey: queryKeys.bootstrap,
            queryFn: () => api.auth.getBootstrapStatus(),
            staleTime: 30_000,
        });
        if (bootstrap.required)
            throw redirect("/admin/setup");
        const session = await queryClient.fetchQuery({
            queryKey: queryKeys.session,
            queryFn: () => api.auth.getSession(),
            staleTime: 15_000,
        });
        if (session.user === null)
            throw redirect("/admin/login");
        if (session.passwordChangeRequired === true)
            throw redirect("/admin/password-change");
        return session;
    };
    return createBrowserRouter([
        { path: "/", element: _jsx(Navigate, { to: "/admin", replace: true }) },
        {
            path: "/admin/setup",
            lazy: async () => ({ Component: (await import("./pages/auth-pages.js")).SetupPage }),
            hydrateFallbackElement: _jsx(RouteLoadingPage, {}),
            errorElement: _jsx(RouteErrorPage, {}),
        },
        {
            path: "/admin/login",
            lazy: async () => ({ Component: (await import("./pages/auth-pages.js")).LoginPage }),
            hydrateFallbackElement: _jsx(RouteLoadingPage, {}),
            errorElement: _jsx(RouteErrorPage, {}),
        },
        {
            path: "/admin/password-change",
            loader: async () => {
                const session = await queryClient.fetchQuery({
                    queryKey: queryKeys.session,
                    queryFn: () => api.auth.getSession(),
                    staleTime: 0,
                });
                if (session.user === null)
                    throw redirect("/admin/login");
                if (session.passwordChangeRequired !== true)
                    throw redirect("/admin/schema");
                return session;
            },
            lazy: async () => ({ Component: (await import("./pages/auth-pages.js")).PasswordChangePage }),
            hydrateFallbackElement: _jsx(RouteLoadingPage, {}),
            errorElement: _jsx(RouteErrorPage, {}),
        },
        {
            path: "/community/:realmKey",
            lazy: async () => ({ Component: (await import("./pages/community-page.js")).CommunityPage }),
            hydrateFallbackElement: _jsx(RouteLoadingPage, {}),
            errorElement: _jsx(RouteErrorPage, {}),
        },
        {
            path: "/admin",
            loader: requireSession,
            element: _jsx(AppShell, {}),
            hydrateFallbackElement: _jsx(RouteLoadingPage, {}),
            errorElement: _jsx(RouteErrorPage, {}),
            children: [
                { index: true, element: _jsx(Navigate, { to: "schema", replace: true }) },
                {
                    path: "schema",
                    lazy: async () => ({ Component: (await import("./pages/collection-pages.js")).SchemaListPage }),
                },
                {
                    path: "schema/new",
                    lazy: async () => ({ Component: (await import("./pages/schema-editor-page.js")).SchemaEditorPage }),
                },
                {
                    path: "schema/tools",
                    lazy: async () => ({ Component: (await import("./pages/schema-tools-page.js")).SchemaToolsPage }),
                },
                {
                    path: "schema/:collectionId",
                    lazy: async () => ({ Component: (await import("./pages/schema-editor-page.js")).SchemaEditorPage }),
                },
                {
                    path: "schema/:collectionId/changes",
                    lazy: async () => ({ Component: (await import("./pages/migration-page.js")).MigrationPage }),
                },
                {
                    path: "content",
                    lazy: async () => ({ Component: (await import("./pages/collection-pages.js")).ContentCollectionsPage }),
                },
                {
                    path: "content/:collectionId",
                    lazy: async () => ({ Component: (await import("./pages/document-pages.js")).DocumentListPage }),
                },
                {
                    path: "content/:collectionId/new",
                    lazy: async () => ({ Component: (await import("./pages/document-pages.js")).DocumentEditorPage }),
                },
                {
                    path: "content/:collectionId/trash",
                    lazy: async () => ({ Component: (await import("./pages/trash-page.js")).TrashPage }),
                },
                {
                    path: "content/:collectionId/:documentId/revisions",
                    lazy: async () => ({ Component: (await import("./pages/revision-pages.js")).RevisionHistoryPage }),
                },
                {
                    path: "content/:collectionId/:documentId/revisions/:revisionId",
                    lazy: async () => ({ Component: (await import("./pages/revision-pages.js")).RevisionPreviewPage }),
                },
                {
                    path: "content/:collectionId/:documentId",
                    lazy: async () => ({ Component: (await import("./pages/document-pages.js")).DocumentEditorPage }),
                },
                {
                    path: "media",
                    lazy: async () => ({ Component: (await import("./pages/media-page.js")).MediaPage }),
                },
                {
                    path: "jobs",
                    lazy: async () => ({ Component: (await import("./pages/jobs-page.js")).JobsPage }),
                },
                {
                    path: "operations",
                    lazy: async () => ({ Component: (await import("./pages/operations-page.js")).OperationsPage }),
                },
                {
                    path: "plugins",
                    lazy: async () => ({ Component: (await import("./pages/plugins-page.js")).PluginsPage }),
                },
                {
                    path: "users",
                    lazy: async () => ({ Component: (await import("./pages/user-pages.js")).UserListPage }),
                },
                {
                    path: "users/:identityId",
                    lazy: async () => ({ Component: (await import("./pages/user-pages.js")).UserDetailPage }),
                },
                {
                    path: "settings",
                    lazy: async () => ({ Component: (await import("./pages/settings-page.js")).SettingsPage }),
                },
                {
                    path: "realms",
                    lazy: async () => ({ Component: (await import("./pages/identity-realm-pages.js")).IdentityRealmListPage }),
                },
                {
                    path: "realms/:realmId",
                    lazy: async () => ({ Component: (await import("./pages/identity-realm-pages.js")).IdentityRealmDetailPage }),
                },
                { path: "realms/:realmId/access", element: _jsx(Navigate, { to: "roles", replace: true }) },
                {
                    path: "realms/:realmId/access/roles",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessRolesPage }),
                },
                {
                    path: "realms/:realmId/access/bindings",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessBindingsPage }),
                },
                {
                    path: "realms/:realmId/access/simulator",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessSimulatorPage }),
                },
                {
                    path: "realms/:realmId/access/audit",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessAuditPage }),
                },
                { path: "access", element: _jsx(Navigate, { to: "/admin/access/roles", replace: true }) },
                {
                    path: "access/roles",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessRolesPage }),
                },
                {
                    path: "access/bindings",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessBindingsPage }),
                },
                {
                    path: "access/simulator",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessSimulatorPage }),
                },
                {
                    path: "access/audit",
                    lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessAuditPage }),
                },
            ],
        },
        { path: "*", element: _jsx(NotFoundPage, {}) },
    ]);
}
//# sourceMappingURL=router.js.map