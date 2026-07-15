import { jsx as _jsx } from "react/jsx-runtime";
import { NavLink, useParams } from "react-router";
import styles from "../authorization.module.css";
const items = [
    { path: "roles", label: "레벨과 역할" },
    { path: "bindings", label: "주체와 바인딩" },
    { path: "simulator", label: "권한 시뮬레이터" },
    { path: "audit", label: "감사 로그" },
];
export function AccessWorkspaceNav() {
    const { realmId } = useParams();
    const base = realmId === undefined
        ? "/admin/access"
        : `/admin/realms/${encodeURIComponent(realmId)}/access`;
    return (_jsx("nav", { className: styles.accessNav, "aria-label": "\uAD8C\uD55C \uAD00\uB9AC", children: items.map((item) => _jsx(NavLink, { to: `${base}/${item.path}`, children: item.label }, item.path)) }));
}
//# sourceMappingURL=access-workspace-nav.js.map