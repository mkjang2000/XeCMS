import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./tabs.module.css";
/**
 * Accessible tablist shared across detail pages. Generalises the previously
 * hard-coded RealmDetailTabs so any page can render URL- or state-driven tabs
 * with the same look and keyboard behaviour.
 */
export function Tabs({ ariaLabel, tabs, active, onChange, }) {
    return (_jsx("div", { className: styles.tabs, role: "tablist", "aria-label": ariaLabel, children: tabs.map((tab) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": active === tab.id, disabled: tab.disabled, onClick: () => onChange(tab.id), children: [tab.label, tab.badge] }, tab.id))) }));
}
/** Shared danger marker for tabs (replaces detailTabDangerDot). */
export function TabDangerDot({ label }) {
    return _jsx("span", { className: styles.dangerDot, "aria-label": label });
}
//# sourceMappingURL=tabs.js.map