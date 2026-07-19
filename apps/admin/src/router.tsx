import { createBrowserRouter, isRouteErrorResponse, Navigate, redirect, useRouteError } from "react-router";
import type { QueryClient } from "@tanstack/react-query";
import { toAdminApiError, type AdminApi } from "@xecms/admin";
import { Button, LoadingIndicator } from "@xecms/ui";
import styles from "./app.module.css";
import { AdminIndexRedirect, AppShell } from "./pages/app-shell.js";
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
  return (
    <main className={styles.errorPage}>
      <div>
        <h1>{title}</h1>
        <p className={styles.muted}>{description}</p>
        <Button onPress={() => window.location.reload()}>다시 시도</Button>
      </div>
    </main>
  );
}

function RouteLoadingPage() {
  return (
    <main className={styles.errorPage}>
      <div>
        <LoadingIndicator label="Admin을 불러오는 중" />
      </div>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className={styles.errorPage}>
      <div>
        <h1>페이지를 찾을 수 없습니다</h1>
        <p className={styles.muted}>주소를 확인해 주세요.</p>
        <Button onPress={() => { window.location.href = "/admin/schema"; }}>Admin 홈으로</Button>
      </div>
    </main>
  );
}

export function createAdminRouter(api: AdminApi, queryClient: QueryClient) {
  const requireSession = async () => {
    const bootstrap = await queryClient.fetchQuery({
      queryKey: queryKeys.bootstrap,
      queryFn: () => api.auth.getBootstrapStatus(),
      staleTime: 30_000,
    });
    if (bootstrap.required) throw redirect("/admin/setup");
    const session = await queryClient.fetchQuery({
      queryKey: queryKeys.session,
      queryFn: () => api.auth.getSession(),
      staleTime: 15_000,
    });
    if (session.user === null) throw redirect("/admin/login");
    if (session.passwordChangeRequired === true) throw redirect("/admin/password-change");
    return session;
  };

  return createBrowserRouter([
    { path: "/", element: <Navigate to="/admin" replace /> },
    {
      path: "/admin/setup",
      lazy: async () => ({ Component: (await import("./pages/auth-pages.js")).SetupPage }),
      hydrateFallbackElement: <RouteLoadingPage />,
      errorElement: <RouteErrorPage />,
    },
    {
      path: "/admin/login",
      lazy: async () => ({ Component: (await import("./pages/auth-pages.js")).LoginPage }),
      hydrateFallbackElement: <RouteLoadingPage />,
      errorElement: <RouteErrorPage />,
    },
    {
      path: "/admin/password-change",
      loader: async () => {
        const session = await queryClient.fetchQuery({
          queryKey: queryKeys.session,
          queryFn: () => api.auth.getSession(),
          staleTime: 0,
        });
        if (session.user === null) throw redirect("/admin/login");
        if (session.passwordChangeRequired !== true) throw redirect("/admin/schema");
        return session;
      },
      lazy: async () => ({ Component: (await import("./pages/auth-pages.js")).PasswordChangePage }),
      hydrateFallbackElement: <RouteLoadingPage />,
      errorElement: <RouteErrorPage />,
    },
    {
      path: "/community/:realmKey",
      lazy: async () => ({ Component: (await import("./pages/community-page.js")).CommunityPage }),
      hydrateFallbackElement: <RouteLoadingPage />,
      errorElement: <RouteErrorPage />,
    },
    {
      path: "/admin",
      loader: requireSession,
      element: <AppShell />,
      hydrateFallbackElement: <RouteLoadingPage />,
      errorElement: <RouteErrorPage />,
      children: [
        { index: true, element: <AdminIndexRedirect /> },
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
          path: "realms/entitlements",
          lazy: async () => ({ Component: (await import("./pages/identity-realm-pages.js")).RealmEntitlementMatrixPage }),
        },
        {
          path: "realms/:realmId",
          lazy: async () => ({ Component: (await import("./pages/identity-realm-pages.js")).IdentityRealmDetailPage }),
        },
        {
          path: "realms/:realmId/access",
          lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessIndexRedirect }),
        },
        {
          path: "realms/:realmId/access/grades",
          lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessGradesPage }),
        },
        {
          path: "realms/:realmId/access/members",
          lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessMembersPage }),
        },
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
        {
          path: "access",
          lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessIndexRedirect }),
        },
        {
          path: "access/grades",
          lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessGradesPage }),
        },
        {
          path: "access/members",
          lazy: async () => ({ Component: (await import("./pages/access-pages.js")).AccessMembersPage }),
        },
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
    { path: "*", element: <NotFoundPage /> },
  ]);
}
