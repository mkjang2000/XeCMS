import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { LoadError, PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page } from "../../components/page.js";
import { AccessPageHeader, subjectNameOf } from "./common.js";
import { useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";
export function AccessAuditPage() {
    const { authorization, auditKey, realmId } = useAuthorizationWorkspace();
    const policy = useAuthorizationPolicy();
    const audit = useQuery({ queryKey: auditKey, queryFn: () => authorization.listAudit() });
    if (policy.isPending || audit.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uAC10\uC0AC \uB85C\uADF8\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(RealmAuthorizationError, { error: policy.error, context: "policy", realmId: realmId, onRetry: () => void policy.refetch() }) });
    if (audit.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: audit.error, onRetry: () => void audit.refetch() }) });
    return _jsxs(Page, { children: [_jsx(AccessPageHeader, { realmId: realmId, title: "\uC815\uCC45 \uBCC0\uACBD \uAC10\uC0AC", description: "\uC815\uCC45 \uAD6C\uC870 \uBCC0\uACBD\uC758 actor, target, before/after\uC640 \uD310\uC815 \uADFC\uAC70\uB97C \uBCF4\uC874\uD569\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, { policy: policy.data }), audit.data.items.length === 0 ? _jsx(EmptyState, { title: "\uAC10\uC0AC \uC774\uBCA4\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC5ED\uD560\uC774\uB098 \uBC14\uC778\uB529\uC744 \uBCC0\uACBD\uD558\uBA74 \uC774\uACF3\uC5D0 \uAE30\uB85D\uB429\uB2C8\uB2E4." }) : _jsx("div", { className: styles.auditList, children: audit.data.items.map((entry) => _jsxs("article", { className: styles.auditItem, children: [_jsxs("div", { className: styles.rowBetween, children: [_jsxs("div", { children: [_jsx("strong", { children: entry.action }), _jsxs("div", { className: styles.hint, children: [entry.targetType, " \u00B7 ", entry.targetId] })] }), _jsxs(Badge, { children: ["r", entry.policyRevision] })] }), _jsxs("div", { className: styles.auditMeta, children: [_jsx("span", { children: new Date(entry.occurredAt).toLocaleString("ko-KR") }), _jsxs("span", { children: ["Actor ", entry.actorSubjectId === undefined ? entry.actorIdentityId ?? "System control plane" : subjectNameOf(policy.data, entry.actorSubjectId)] }), entry.accessMode === undefined ? null : _jsx("span", { children: entry.accessMode }), _jsx("span", { children: entry.decision?.reasonCode ?? "BOOTSTRAP" })] }), _jsxs("details", { children: [_jsx("summary", { children: "\uBCC0\uACBD \uC804\uD6C4 \uBCF4\uAE30" }), _jsxs("div", { className: styles.diff, children: [_jsx("pre", { children: JSON.stringify(entry.before, null, 2) }), _jsx("pre", { children: JSON.stringify(entry.after, null, 2) })] })] })] }, entry.id)) })] });
}
//# sourceMappingURL=audit-page.js.map