import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink } from "react-router";
import styles from "../app.module.css";
export function CollectionWorkspaceNav({ collectionId }) {
    return (_jsxs("div", { className: styles.workspaceNav, role: "group", "aria-label": "\uCEEC\uB809\uC158 \uBCF4\uAE30", children: [_jsx(NavLink, { end: true, to: `/admin/content/${collectionId}`, children: "\uBB38\uC11C \uBAA9\uB85D" }), _jsx(NavLink, { to: `/admin/content/${collectionId}/trash`, children: "\uD734\uC9C0\uD1B5" })] }));
}
//# sourceMappingURL=collection-workspace-nav.js.map