import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import { Callout } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { PageHeader } from "../../components/page.js";
import { resourcePath } from "../../components/resource-scope-tree.js";
import { queryKeys } from "../../queries.js";
/**
 * Unified header for every authorization screen. Makes the "same screen, two
 * contexts" ambiguity explicit: a global (System) policy vs a specific user
 * space's policy — the latter shows the realm's name so operators know which
 * space they are editing. Replaces the per-page ad-hoc eyebrows.
 */
export function AccessPageHeader({ realmId, title, description, actions, }) {
    const api = useAdminApi();
    const realm = useQuery({
        queryKey: queryKeys.identityRealm(realmId ?? "missing"),
        queryFn: () => api.identityRealms.get(realmId),
        enabled: realmId !== undefined,
    });
    const eyebrow = realmId === undefined
        ? "운영자 공간 · 권한"
        : `사용자 공간 · ${realm.data?.name ?? "…"}`;
    return (_jsx(PageHeader, { eyebrow: eyebrow, title: title, ...(description === undefined ? {} : { description }), ...(actions === undefined ? {} : { actions }) }));
}
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