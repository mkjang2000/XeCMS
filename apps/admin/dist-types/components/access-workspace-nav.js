import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, useParams } from "react-router";
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
];
export function AccessWorkspaceNav({ policy }) {
    const { realmId } = useParams();
    const { mode } = useDisplayMode();
    const base = realmId === undefined
        ? "/admin/access"
        : `/admin/realms/${encodeURIComponent(realmId)}/access`;
    return _jsxs(_Fragment, { children: [_jsx(AccessModeBanner, { policy: policy, realmId: realmId }), _jsx("nav", { className: styles.accessNav, "aria-label": "\uAD8C\uD55C \uAD00\uB9AC", children: items
                    .filter(({ minimum }) => displayModeAtLeast(mode, minimum))
                    .map((item) => _jsx(NavLink, { to: `${base}/${item.path}`, children: item.label }, item.path)) })] });
}
//# sourceMappingURL=access-workspace-nav.js.map