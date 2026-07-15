import { NavLink, Outlet, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@xecms/ui";
import { useAdminApi } from "@xecms/admin";
import { Icon } from "../components/icon.js";
import styles from "../app-shell.module.css";
import { queryKeys } from "../queries.js";

export function AppShell() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.auth.getSession() });
  const logout = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.clear();
      navigate("/admin/login", { replace: true });
    },
  });
  const username = session.data?.user?.username ?? "사용자";
  const initials = username.slice(0, 2);

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
          <NavLink to="/admin/content">
            <Icon name="content" size={18} />
            <span>콘텐츠</span>
          </NavLink>
          <NavLink to="/admin/schema">
            <Icon name="schema" size={18} />
            <span>스키마</span>
          </NavLink>
          <NavLink to="/admin/media">
            <Icon name="media" size={18} />
            <span>미디어</span>
          </NavLink>
          <NavLink to="/admin/realms">
            <Icon name="identity" size={18} />
            <span>Identity Realms</span>
          </NavLink>
          <NavLink to="/admin/users">
            <Icon name="identity" size={18} />
            <span>사용자</span>
          </NavLink>
          <NavLink to="/admin/access">
            <Icon name="shield" size={18} />
            <span>권한</span>
          </NavLink>
          <NavLink to="/admin/jobs">
            <Icon name="events" size={18} />
            <span>이벤트 작업</span>
          </NavLink>
          <NavLink to="/admin/operations">
            <Icon name="shield" size={18} />
            <span>운영 및 감사</span>
          </NavLink>
          <NavLink to="/admin/plugins">
            <Icon name="schema" size={18} />
            <span>Plugins</span>
          </NavLink>
          <NavLink to="/admin/settings">
            <Icon name="workspace" size={18} />
            <span>설정 및 사이트</span>
          </NavLink>
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
            <span className={styles.accountCopy}>
              <strong>{username}</strong>
              <span>System administrator</span>
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
          <span className={styles.environment}>Development</span>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
