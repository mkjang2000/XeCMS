import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { toAdminApiError } from "@xecms/admin";
import { Callout } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { resourcePath } from "../../components/resource-scope-tree.js";
export function PolicySummary({ policy }) {
    const items = [
        ["정책 Revision", policy.revision],
        ["사용자·그룹", policy.subjects.length],
        ["역할", policy.roles.length],
        ["역할 배정", policy.bindings.length],
    ];
    return (_jsx("div", { className: styles.summaryGrid, children: items.map(([label, value]) => (_jsxs("div", { className: styles.summaryCard, children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }, label))) }));
}
export function MutationError({ error }) {
    if (error === null || error === undefined)
        return null;
    const converted = toAdminApiError(error);
    const details = converted.details;
    return (_jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: converted.message }), details?.decision?.reasonCode ? _jsxs("div", { children: ["\uD310\uC815 \uCF54\uB4DC: ", details.decision.reasonCode] }) : null] }));
}
export function textList(value) {
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
export function dateTimeValue(value) {
    return value === undefined ? "" : new Date(value).toISOString().slice(0, 16);
}
export function optionalInstant(value) {
    return value === "" ? undefined : new Date(value).toISOString();
}
export function subjectNameOf(policy, id) {
    return policy.subjects.find((subject) => subject.id === id)?.name ?? id;
}
export function roleNameOf(policy, id) {
    return policy.roles.find((role) => role.id === id)?.name ?? id;
}
export function resourceNameOf(policy, id) {
    return policy.resources.find((resource) => resource.id === id)?.name ?? id;
}
export function resourcePathOf(policy, id) {
    const path = resourcePath(policy.resources, id);
    return path.length > 0 ? path.map(({ name }) => name).join(" / ") : id;
}
export function emptyBinding(policy) {
    return { id: "", realmId: policy.realmId, subjectId: "", roleId: "", resourceId: policy.resources[0]?.id ?? "", propagation: "self", protected: false };
}
//# sourceMappingURL=common.js.map