import { NavLink, useParams } from "react-router";
import { displayModeAtLeast, useDisplayMode } from "../display-mode.js";
import styles from "../authorization.module.css";

const items = [
  { path: "roles", label: "레벨과 역할", minimum: "standard" },
  { path: "bindings", label: "주체와 바인딩", minimum: "standard" },
  { path: "simulator", label: "권한 시뮬레이터", minimum: "advanced" },
  { path: "audit", label: "감사 로그", minimum: "advanced" },
] as const;

export function AccessWorkspaceNav() {
  const { realmId } = useParams();
  const { mode } = useDisplayMode();
  const base = realmId === undefined
    ? "/admin/access"
    : `/admin/realms/${encodeURIComponent(realmId)}/access`;
  return (
    <nav className={styles.accessNav} aria-label="권한 관리">
      {items
        .filter(({ minimum }) => displayModeAtLeast(mode, minimum))
        .map((item) => <NavLink key={item.path} to={`${base}/${item.path}`}>{item.label}</NavLink>)}
    </nav>
  );
}
