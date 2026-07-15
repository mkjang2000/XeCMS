import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "../app.module.css";
export function Page({ children }) {
    return _jsx("div", { className: styles.page, children: children });
}
export function PageHeader({ title, eyebrow, description, actions, }) {
    return (_jsxs("header", { className: styles.pageHeader, children: [_jsxs("div", { className: styles.pageTitleBlock, children: [eyebrow ? _jsx("p", { className: styles.pageKicker, children: eyebrow }) : null, _jsx("h1", { children: title }), description ? _jsx("p", { children: description }) : null] }), actions ? _jsx("div", { className: styles.headerActions, children: actions }) : null] }));
}
export function SectionHeader({ id, title, description, actions, }) {
    return (_jsxs("div", { className: styles.sectionHeader, children: [_jsxs("div", { children: [_jsx("h2", { id: id, className: styles.sectionHeading, children: title }), description ? _jsx("p", { className: styles.muted, children: description }) : null] }), actions ? _jsx("div", { className: styles.actions, children: actions }) : null] }));
}
//# sourceMappingURL=page.js.map