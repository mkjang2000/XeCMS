import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, SectionHeader } from "../../components/page.js";
import { ScopeTreeSelector } from "../../components/resource-scope-tree.js";
import { useDisplayMode } from "../../display-mode.js";
import { AccessPageHeader, MutationError, resourceNameOf, resourcePathOf, roleNameOf, subjectNameOf } from "./common.js";
import { decisionReasonName, hierarchyContextDescription, permissionTaskName, propagationLabel, subjectTypeName, } from "./vocabulary.js";
import { useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";
export function AccessSimulatorPage() {
    const { authorization, realmId } = useAuthorizationWorkspace();
    const policy = useAuthorizationPolicy();
    const { mode } = useDisplayMode();
    const advanced = mode === "advanced";
    const [subjectId, setSubjectId] = useState("");
    const [action, setAction] = useState("");
    const [resourceId, setResourceId] = useState("");
    const [ownerSubjectId, setOwnerSubjectId] = useState("");
    const [status, setStatus] = useState("");
    const selectedPermission = policy.data?.permissions.find((permission) => permission.key === action);
    const selectedHierarchyGuard = selectedPermission?.hierarchyGuard ?? "none";
    const hierarchyUnsupported = selectedHierarchyGuard !== "none";
    const simulation = useMutation({ mutationFn: () => authorization.simulate({ subjectId, action, resourceId, context: ownerSubjectId || status ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined } : undefined }) });
    const effectivePermissions = useMutation({
        mutationFn: async () => Promise.all(policy.data.permissions.map(async (permission) => {
            if (permission.hierarchyGuard !== "none") {
                return { permission, supported: false, decision: null };
            }
            return {
                permission,
                supported: true,
                decision: await authorization.simulate({
                    subjectId,
                    action: permission.key,
                    resourceId,
                    context: ownerSubjectId || status
                        ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined }
                        : undefined,
                }),
            };
        })),
    });
    if (policy.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uC2DC\uBBAC\uB808\uC774\uD130\uB97C \uC900\uBE44\uD558\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(RealmAuthorizationError, { error: policy.error, context: "policy", realmId: realmId, onRetry: () => void policy.refetch() }) });
    const resetResults = () => {
        simulation.reset();
        effectivePermissions.reset();
    };
    return _jsxs(Page, { children: [_jsx(AccessPageHeader, { realmId: realmId, title: "\uC0AC\uC6A9\uC790 \uAD8C\uD55C \uD655\uC778", description: "\uC0AC\uC6A9\uC790\uC640 \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uBA74 \uC2E4\uC81C\uB85C \uAC00\uB2A5\uD55C \uC5C5\uBB34\uC640 \uADF8 \uC774\uC720\uB97C \uD55C\uB208\uC5D0 \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, { policy: policy.data }), _jsxs("div", { className: styles.guideBanner, children: [_jsx("span", { className: styles.guideNumber, children: "?" }), _jsxs("div", { children: [_jsx("strong", { children: "\uC124\uC815\uC744 \uBC14\uAFB8\uC9C0 \uC54A\uACE0 \uD604\uC7AC \uAD8C\uD55C\uB9CC \uC548\uC804\uD558\uAC8C \uD655\uC778\uD569\uB2C8\uB2E4." }), _jsx("p", { children: advanced ? "특정 권한의 상세 판정은 아래 고급 진단에서 별도로 실행할 수 있습니다." : "사용자와 영역을 고르면 가능한 업무를 평이한 이름으로 보여 드립니다." })] })] }), _jsxs("div", { className: `${styles.layout} ${styles.simulatorLayout}`, children: [_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uB204\uAD6C\uC758 \uAD8C\uD55C\uC744 \uC5B4\uB514\uC5D0\uC11C \uD655\uC778\uD560\uAE4C\uC694?", description: "\uC0AC\uC6A9\uC790 \uB610\uB294 \uADF8\uB8F9\uACFC \uC2E4\uC81C \uCF58\uD150\uCE20\u00B7\uAD00\uB9AC \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uC138\uC694." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD655\uC778\uD560 \uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9" }), _jsxs("select", { value: subjectId, onChange: (event) => { setSubjectId(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), policy.data.subjects.map((subject) => _jsxs("option", { value: subject.id, children: [subject.name, " \u00B7 ", subjectTypeName(subject.type)] }, subject.id))] })] }), _jsx(ScopeTreeSelector, { label: "\uD655\uC778\uD560 \uC601\uC5ED", description: "\uAD8C\uD55C\uC744 \uD655\uC778\uD560 Collection, Document \uB610\uB294 \uAD00\uB9AC \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uC138\uC694.", resources: policy.data.resources, value: resourceId, onChange: (next) => { setResourceId(next); resetResults(); } }), _jsx(Button, { isFullWidth: true, onPress: () => effectivePermissions.mutate(), isDisabled: !subjectId || !resourceId || effectivePermissions.isPending, children: effectivePermissions.isPending ? "권한 확인 중…" : "이 영역의 전체 권한 확인" }), advanced ? _jsxs("details", { className: styles.advancedDetails, children: [_jsxs("summary", { children: [_jsx("span", { children: "\uD2B9\uC815 \uAD8C\uD55C \uC0C1\uC138 \uC9C4\uB2E8" }), _jsx("small", { children: "Action\uACFC \uC870\uAC74\uC744 \uC9C1\uC811 \uC9C0\uC815\uD558\uB294 \uACE0\uAE09 \uB3C4\uAD6C" })] }), _jsxs("div", { className: styles.advancedDetailsBody, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD655\uC778\uD560 \uAD8C\uD55C" }), _jsxs("select", { value: action, onChange: (event) => { setAction(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), policy.data.permissions.map((permission) => _jsxs("option", { value: permission.key, children: [permissionTaskName(permission.key), " \u00B7 ", permission.key, permission.hierarchyGuard === "none" ? "" : " · 대상 정보 필요"] }, permission.key))] })] }), _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uCF58\uD150\uCE20 \uC18C\uC720\uC790 \uC870\uAC74" }), _jsxs("select", { value: ownerSubjectId, onChange: (event) => { setOwnerSubjectId(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC870\uAC74 \uC5C6\uC74C" }), policy.data.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uCF58\uD150\uCE20 \uC0C1\uD0DC \uC870\uAC74" }), _jsx("input", { value: status, onChange: (event) => { setStatus(event.target.value); resetResults(); }, placeholder: "\uC608: draft" })] })] }), hierarchyUnsupported ? (_jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "\uC774 \uAD8C\uD55C\uC740 \uB300\uC0C1\uACFC\uC758 \uAD00\uB9AC \uC11C\uC5F4\uB3C4 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4." }), _jsx("br", {}), hierarchyContextDescription(selectedHierarchyGuard), " \uC2E4\uC81C \uAD00\uB9AC \uC791\uC5C5\uC5D0\uC11C \uB300\uC0C1\uC758 \uAD8C\uD55C \uB808\uBCA8\uACFC \uBCF4\uD638 \uC0C1\uD0DC\uB97C \uD568\uAED8 \uD310\uC815\uD569\uB2C8\uB2E4."] })) : null, _jsx(Button, { variant: "secondary", isFullWidth: true, onPress: () => simulation.mutate(), isDisabled: !subjectId || !action || !resourceId || hierarchyUnsupported || simulation.isPending, children: simulation.isPending ? "진단 중…" : hierarchyUnsupported ? "대상 정보 필요" : "선택한 권한 진단" })] })] }) : null, _jsx(MutationError, { error: simulation.error ?? effectivePermissions.error })] })] }), _jsxs("div", { className: styles.stack, children: [_jsx(EffectivePermissionList, { policy: policy.data, results: effectivePermissions.data ?? null, technical: advanced }), advanced ? _jsx(DecisionExplanation, { policy: policy.data, decision: simulation.data ?? null }) : null] })] })] });
}
export function EffectivePermissionList({ policy, results, technical = false, }) {
    if (results === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC804\uCCB4 \uAD8C\uD55C \uACB0\uACFC", description: "\uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9\uACFC \uC601\uC5ED\uC744 \uC120\uD0DD\uD55C \uB4A4 \uC804\uCCB4 \uAD8C\uD55C \uD655\uC778\uC744 \uC2E4\uD589\uD558\uC138\uC694." }) });
    const sorted = [...results].sort((left, right) => Number(right.decision?.allowed === true) - Number(left.decision?.allowed === true)
        || Number(right.supported) - Number(left.supported));
    const supportedCount = results.filter(({ supported }) => supported).length;
    const unsupportedCount = results.length - supportedCount;
    const allowedCount = results.filter(({ decision }) => decision?.allowed === true).length;
    const firstDecision = results.find(({ decision }) => decision !== null)?.decision;
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uC0AC\uC6A9\uC790\uBCC4 Effective Permission", "aria-live": "polite", children: [_jsxs("div", { className: styles.panelHeader, children: [_jsxs("div", { children: [_jsx("h2", { children: "\uC774 \uC601\uC5ED\uC5D0\uC11C \uAC00\uB2A5\uD55C \uC5C5\uBB34" }), _jsx("span", { className: styles.hint, children: resourcePathOf(policy, firstDecision?.resourceId ?? "") })] }), _jsxs(Badge, { tone: allowedCount > 0 ? "success" : "neutral", children: [allowedCount, "/", supportedCount, "\uAC1C \uAC00\uB2A5", unsupportedCount ? ` · ${unsupportedCount}개 추가 정보 필요` : ""] })] }), _jsx("div", { className: styles.effectiveList, children: sorted.map(({ permission, supported, decision }) => (_jsxs("article", { className: styles.effectiveItem, "data-allowed": decision?.allowed === true, children: [_jsxs("div", { children: [_jsx("strong", { children: permissionTaskName(permission.key) }), technical ? _jsx("code", { children: permission.key }) : null] }), _jsx(Badge, { tone: !supported ? "neutral" : decision?.allowed ? "success" : "danger", children: !supported ? "추가 정보 필요" : decision?.allowed ? "가능" : "불가" }), _jsx("span", { children: supported ? decisionReasonName(decision?.reasonCode ?? "") : hierarchyContextDescription(permission.hierarchyGuard) })] }, permission.key))) })] }));
}
export function DecisionExplanation({ policy, decision }) {
    if (decision === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC0C1\uC138 \uC9C4\uB2E8 \uACB0\uACFC", description: "\uD2B9\uC815 \uAD8C\uD55C \uC0C1\uC138 \uC9C4\uB2E8\uC744 \uC2E4\uD589\uD558\uBA74 \uC801\uC6A9\uB41C \uC5ED\uD560\uACFC \uADF8\uB8F9 \uACBD\uB85C\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    return _jsxs("section", { className: styles.decisionCard, "data-allowed": decision.allowed, children: [_jsxs("div", { className: styles.decisionTitle, children: [_jsx(Badge, { tone: decision.allowed ? "success" : "danger", children: decision.allowed ? "허용됨" : "허용되지 않음" }), _jsx("strong", { children: decisionReasonName(decision.reasonCode) })] }), _jsxs("div", { className: styles.auditMeta, children: [_jsx("span", { children: permissionTaskName(decision.action) }), _jsxs("span", { children: ["\uC815\uCC45 Revision ", decision.policyRevision] }), decision.actorLevel === undefined ? null : _jsxs("span", { children: ["\uC0AC\uC6A9\uC790 \uB808\uBCA8 ", decision.actorLevel] })] }), _jsxs("details", { className: styles.decisionTechnical, children: [_jsx("summary", { children: "\uAE30\uC220 \uC815\uBCF4 \uBCF4\uAE30" }), _jsx("code", { children: decision.reasonCode }), _jsx("code", { children: decision.action })] }), _jsx("div", { className: styles.grantList, children: decision.matchedGrants.map((grant) => _jsxs("div", { className: styles.grant, children: [_jsxs("strong", { children: [roleNameOf(policy, grant.sourceRoleId), " \u00B7 \uB808\uBCA8 ", grant.sourceRank] }), _jsxs("span", { children: [resourceNameOf(policy, grant.sourceResourceId), " \u00B7 ", propagationLabel(grant.sourcePropagation)] }), grant.membershipPath.length ? _jsxs("span", { children: ["\uADF8\uB8F9 \uACBD\uB85C: ", grant.membershipPath.map((id) => subjectNameOf(policy, id)).join(" → ")] }) : _jsx("span", { children: "\uC9C1\uC811 \uBC30\uC815\uB428" })] }, `${grant.sourceBindingId}:${grant.permission}`)) })] });
}
//# sourceMappingURL=simulator-page.js.map