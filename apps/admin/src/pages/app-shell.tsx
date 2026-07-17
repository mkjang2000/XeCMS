import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, LoadingIndicator } from "@xecms/ui";
import {
  allAccessAllowed,
  anyAccessAllowed,
  useAdminApi,
  type AccessEvaluationProfile,
} from "@xecms/admin";
import {
  permissionCheck,
  systemResources,
  useAccessProfile,
} from "../access-profile.js";
import { Icon, type IconName } from "../components/icon.js";
import {
  DisplayModeSelector,
  displayModeAtLeast,
  useDisplayMode,
  type DisplayMode,
} from "../display-mode.js";
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
] as const;

export const navigationItems: readonly {
  readonly to: string;
  readonly icon: IconName;
  readonly label: string;
  readonly minimum: DisplayMode;
  readonly access: readonly string[];
  readonly requireAll?: boolean;
}[] = [
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

export function visibleNavigationItems(
  mode: DisplayMode,
  profile: AccessEvaluationProfile | undefined,
) {
  return navigationItems.filter((item) =>
    displayModeAtLeast(mode, item.minimum)
    && (item.requireAll
      ? allAccessAllowed(profile, item.access)
      : anyAccessAllowed(profile, item.access)));
}

export function AdminIndexRedirect() {
  const { mode } = useDisplayMode();
  const accessProfile = useAccessProfile("admin-navigation", navigationAccessChecks);
  if (accessProfile.isPending) {
    return <LoadingIndicator label="접근 가능한 첫 화면을 찾는 중" />;
  }
  if (accessProfile.isError) {
    return (
      <EmptyState
        title="메뉴 권한을 확인할 수 없습니다"
        description="잠시 후 새로고침하거나 서버 상태를 확인해 주세요."
      />
    );
  }
  const first = visibleNavigationItems(mode, accessProfile.data)[0];
  if (first !== undefined) return <Navigate to={first.to} replace />;
  return (
    <EmptyState
      title="현재 표시할 수 있는 관리 화면이 없습니다"
      description="상단 표시 단계를 높이거나 관리자에게 필요한 권한을 요청하세요."
    />
  );
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

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">본문으로 건너뛰기</a>
      <aside className={styles.sidebar}>
        <div className={styles.brandLockup} aria-label="XeCMS Admin Studio">
          <span className={styles.brandMark} aria-hidden="true">Xe</span>
          <span className={styles.brandCopy}>
            <span className={styles.brandName}>XeCMS</span>
            <span className={styles.brandMeta}>Admin Studio</span>
          </span>
        </div>
        <div className={styles.workspaceCard}>
          <span className={styles.workspaceIcon}><Icon name="workspace" size={17} /></span>
          <span className={styles.workspaceCopy}>
            <strong>Default Workspace</strong>
            <span>Development instance</span>
          </span>
        </div>
        <nav className={styles.nav} aria-label="Admin 주 메뉴">
          <span className={styles.navLabel}>Workspace</span>
          {accessProfile.isPending ? (
            <span className={styles.navMessage}>접근 가능한 메뉴 확인 중…</span>
          ) : accessProfile.isError ? (
            <span className={styles.navMessage}>메뉴 권한을 확인할 수 없습니다.</span>
          ) : visibleItems.length === 0 ? (
            <span className={styles.navMessage}>표시 가능한 관리 메뉴가 없습니다.</span>
          ) : visibleItems.map((item) => (
              <NavLink key={item.to} to={item.to}>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
            <span className={styles.accountCopy}>
              <strong>{username}</strong>
              <span>
                {accessProfile.data
                  ? `System Realm · Policy r${accessProfile.data.policyRevision}`
                  : "System Realm 계정"}
              </span>
            </span>
          </div>
          <Button
            variant="quiet"
            size="small"
            className={styles.logoutButton}
            onPress={() => logout.mutate()}
            isDisabled={logout.isPending}
          >
            <Icon name="logout" size={17} />
            <span className={styles.logoutLabel}>{logout.isPending ? "로그아웃 중…" : "로그아웃"}</span>
          </Button>
        </div>
      </aside>
      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.topbarContext}>
            <strong>Admin Studio</strong>
            <span className={styles.topbarDivider} aria-hidden="true" />
            <span>Default Workspace</span>
          </div>
          <div className={styles.topbarActions}>
            <DisplayModeSelector compact />
            <span className={styles.environment}>Development</span>
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
