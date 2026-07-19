import { NavLink, useParams } from "react-router";
import type { AuthorizationPolicy } from "@xecms/admin";
import { displayModeAtLeast, useDisplayMode } from "../display-mode.js";
import styles from "../authorization.module.css";
import { AccessModeBanner } from "../pages/access/access-mode-banner.js";

const items = [
  { path: "grades", label: "등급 관리", minimum: "basic" },
  { path: "members", label: "멤버", minimum: "basic" },
  { path: "roles", label: "레벨과 역할", minimum: "standard" },
  { path: "bindings", label: "역할 배정", minimum: "standard" },
  { path: "simulator", label: "사용자 권한 확인", minimum: "standard" },
  { path: "audit", label: "감사 로그", minimum: "advanced" },
] as const;

export function AccessWorkspaceNav({ policy }: { readonly policy: AuthorizationPolicy }) {
  const { realmId } = useParams();
  const { mode } = useDisplayMode();
  const base = realmId === undefined
    ? "/admin/access"
    : `/admin/realms/${encodeURIComponent(realmId)}/access`;
  return <>
    <AccessModeBanner policy={policy} realmId={realmId} />
    <nav className={styles.accessNav} aria-label="권한 관리">
      {items
        .filter(({ minimum }) => displayModeAtLeast(mode, minimum))
        .map((item) => <NavLink key={item.path} to={`${base}/${item.path}`}>{item.label}</NavLink>)}
    </nav>
  </>;
}
