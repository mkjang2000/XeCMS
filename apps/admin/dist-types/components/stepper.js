import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@xecms/ui";
import styles from "./stepper.module.css";
const statusBadge = {
    done: { tone: "success", label: "완료" },
    current: { tone: "primary", label: "진행할 차례" },
    blocked: { tone: "warning", label: "먼저 필요" },
    todo: { tone: "neutral", label: "대기" },
};
function marker(status, index) {
    if (status === "done")
        return "✓";
    if (status === "blocked")
        return "!";
    return String(index + 1);
}
/**
 * Read-only setup checklist. The caller computes each step's status from its own
 * queries; this component only renders. Reuses Badge/design tokens — no new
 * icons or data fetching.
 */
export function Checklist({ title, steps, }) {
    return (_jsxs("div", { children: [title === undefined ? null : _jsx("p", { className: styles.title, children: title }), _jsx("ol", { className: styles.checklist, children: steps.map((step, index) => {
                    const badge = statusBadge[step.status];
                    return (_jsxs("li", { className: styles.step, "data-status": step.status, children: [_jsx("span", { className: styles.marker, "aria-hidden": "true", children: marker(step.status, index) }), _jsxs("div", { className: styles.body, children: [_jsxs("div", { className: styles.headline, children: [_jsx("span", { className: styles.label, children: step.label }), _jsx(Badge, { tone: badge.tone, children: badge.label })] }), step.description === undefined ? null : (_jsx("p", { className: styles.description, children: step.description })), step.action === undefined ? null : _jsx("div", { className: styles.action, children: step.action })] })] }, step.id));
                }) })] }));
}
//# sourceMappingURL=stepper.js.map