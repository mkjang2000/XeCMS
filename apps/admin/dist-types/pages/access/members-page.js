import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Badge, Button, ConfirmDialog, EmptyState } from "@xecms/ui";
import gradeStyles from "../../access-grades.module.css";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, SectionHeader } from "../../components/page.js";
import { useDisplayMode } from "../../display-mode.js";
import { AccessPageHeader, roleNameOf } from "./common.js";
import { PolicyMutationError } from "./guardrails.js";
import { gradeOptions, rootResource, subjectGradeState, } from "./policy-simple-view.js";
import { EffectivePermissionList } from "./simulator-page.js";
import { accessBasePath, canMutateAuthorization, useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";
export function AccessMembersPage() {
    const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const policy = useAuthorizationPolicy();
    const [newMemberName, setNewMemberName] = useState("");
    const [pendingChange, setPendingChange] = useState(null);
    const updatePolicy = (next) => queryClient.setQueryData(policyKey, next);
    const createSubject = useMutation({
        mutationFn: () => authorization.createSubject({
            expectedPolicyRevision: policy.data.revision,
            type: "user",
            name: newMemberName.trim(),
        }),
        onSuccess: (next) => { updatePolicy(next); setNewMemberName(""); },
    });
    const applyGrade = useMutation({
        mutationFn: async ({ subject, state, option }) => {
            const revision = policy.data.revision;
            const root = rootResource(policy.data);
            const existing = state.kind === "simple" ? state.binding : null;
            if (option === null) {
                return authorization.deleteBinding(existing.id, revision);
            }
            if (existing === null) {
                return authorization.createBinding({
                    expectedPolicyRevision: revision,
                    subjectId: subject.id,
                    roleId: option.roleId,
                    resourceId: root.id,
                    propagation: "self-and-children",
                });
            }
            // simple 판정상 숨은 조건은 없지만, 원본 값을 그대로 넘겨 무손실을 유지한다.
            return authorization.updateBinding(existing.id, {
                expectedPolicyRevision: revision,
                subjectId: subject.id,
                roleId: option.roleId,
                resourceId: root.id,
                propagation: "self-and-children",
                validFrom: existing.validFrom,
                validUntil: existing.validUntil,
                constraints: existing.constraints,
            });
        },
        onSuccess: (next) => { updatePolicy(next); setPendingChange(null); },
        onError: () => setPendingChange(null),
    });
    if (policy.isPending) {
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uBA64\uBC84 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    }
    if (policy.isError)
        return _jsx(Page, { children: _jsx(RealmAuthorizationError, { error: policy.error, context: "policy", realmId: realmId, onRetry: () => void policy.refetch() }) });
    const root = rootResource(policy.data);
    const options = gradeOptions(policy.data);
    const members = policy.data.subjects.filter(({ type }) => type === "user");
    const basePath = accessBasePath(realmId);
    const writable = canMutateAuthorization(policy.data, realmId);
    const levelName = (levelId) => policy.data.levels.find(({ id }) => id === levelId)?.name ?? levelId;
    return (_jsxs(Page, { children: [_jsx(AccessPageHeader, { realmId: realmId, title: "\uBA64\uBC84", description: "\uBA64\uBC84\uB9C8\uB2E4 \uB4F1\uAE09 \uD558\uB098\uB9CC \uACE0\uB974\uBA74 \uADF8 \uB4F1\uAE09\uC758 \uAD8C\uD55C\uC774 \uADF8\uB300\uB85C \uC801\uC6A9\uB429\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, { policy: policy.data }), writable ? _jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uC0C8 \uBA64\uBC84 \uCD94\uAC00", description: "\uC774\uB984\uB9CC \uC785\uB825\uD558\uBA74 \uBC14\uB85C \uB4F1\uAE09\uC744 \uC815\uD560 \uC218 \uC788\uC5B4\uC694." }), _jsxs("div", { className: gradeStyles.memberAdd, children: [_jsxs("label", { children: [_jsx("span", { children: "\uD45C\uC2DC \uC774\uB984" }), _jsx("input", { value: newMemberName, onChange: (event) => setNewMemberName(event.target.value), placeholder: "\uC608: \uAE40\uBBFC\uC9C0" })] }), _jsx(Button, { onPress: () => createSubject.mutate(), isDisabled: !newMemberName.trim() || createSubject.isPending, children: "\uCD94\uAC00" })] }), _jsx(PolicyMutationError, { error: createSubject.error, policyKey: policyKey })] }) : null, _jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uBA64\uBC84 \uB4F1\uAE09", description: "\uB4F1\uAE09\uC744 \uBC14\uAFB8\uBA74 \uD655\uC778 \uD6C4 \uBC14\uB85C \uC801\uC6A9\uB429\uB2C8\uB2E4." }), members.length === 0 ? (_jsx(EmptyState, { title: "\uC544\uC9C1 \uBA64\uBC84\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC704\uC5D0\uC11C \uCCAB \uBA64\uBC84\uB97C \uCD94\uAC00\uD574 \uBCF4\uC138\uC694." })) : (_jsx("div", { className: gradeStyles.memberTable, children: members.map((subject) => (_jsx(MemberRow, { policy: policy.data, subject: subject, options: options, rootMissing: root === null, levelName: levelName, basePath: basePath, readOnly: !writable, onChange: (state, option) => setPendingChange({ subject, state, option }), changePending: applyGrade.isPending }, subject.id))) })), _jsx(PolicyMutationError, { error: applyGrade.error, policyKey: policyKey })] }), writable && pendingChange !== null ? (_jsx(ConfirmDialog, { title: "\uBA64\uBC84 \uB4F1\uAE09 \uBCC0\uACBD", confirmLabel: pendingChange.option === null ? "등급 해제" : "등급 적용", danger: pendingChange.option === null, isPending: applyGrade.isPending, onConfirm: () => applyGrade.mutate(pendingChange), onCancel: () => setPendingChange(null), children: _jsx("p", { children: pendingChange.option === null
                        ? `${pendingChange.subject.name} 님의 등급을 해제합니다. 이 멤버는 더 이상 별도 권한을 갖지 않아요.`
                        : `${pendingChange.subject.name} 님을 ${pendingChange.option.levelName} 등급으로 지정합니다. 등급의 권한이 바로 적용돼요.` }) })) : null] }));
}
function MemberRow({ policy, subject, options, rootMissing, levelName, basePath, readOnly, onChange, changePending }) {
    const state = subjectGradeState(policy, subject.id);
    const [expanded, setExpanded] = useState(false);
    const locked = readOnly || (state.kind === "simple" && state.locked) || subject.protected;
    return (_jsxs("article", { className: gradeStyles.memberRow, "aria-label": `${subject.name} 멤버`, children: [_jsxs("div", { className: gradeStyles.memberIdentity, children: [_jsx("strong", { children: subject.name }), _jsx("span", { children: subject.disabled ? "비활성화됨" : "사용자" })] }), _jsx("div", { className: gradeStyles.memberGrade, children: state.kind === "complex" ? (_jsx(ComplexGradeSummary, { policy: policy, subjectId: subject.id, reasons: state.reasons, basePath: basePath })) : locked ? (_jsxs("div", { className: gradeStyles.memberChips, children: [_jsx(Badge, { children: state.kind === "simple" ? levelName(state.levelId) : "등급 없음" }), _jsx(Badge, { tone: "info", children: readOnly ? "CMS Owner · 읽기 전용" : "기본 제공 · 잠김" })] })) : rootMissing ? (_jsx("span", { className: styles.hint, children: "\uC601\uC5ED \uAD6C\uC870\uAC00 \uBCF5\uC7A1\uD574 \uD45C\uC900 \uBAA8\uB4DC\uC5D0\uC11C \uAD00\uB9AC\uD574 \uC8FC\uC138\uC694." })) : (_jsxs("label", { children: [_jsxs("span", { className: styles.visuallyHidden, children: [subject.name, " \uB4F1\uAE09"] }), _jsxs("select", { value: state.kind === "simple" ? state.levelId : "", disabled: changePending || readOnly, onChange: (event) => {
                                const levelId = event.target.value;
                                onChange(state, levelId === "" ? null : options.find((option) => option.levelId === levelId) ?? null);
                            }, children: [_jsx("option", { value: "", children: "\uB4F1\uAE09 \uC5C6\uC74C" }), options.map((option) => (_jsxs("option", { value: option.levelId, disabled: option.roleId === null, children: [option.levelName, option.disabledReason === null ? "" : ` · ${option.disabledReason}`] }, option.levelId)))] })] })) }), _jsx("div", { className: gradeStyles.memberActions, children: _jsx(Button, { size: "small", variant: "quiet", onPress: () => setExpanded((current) => !current), children: expanded ? "닫기" : "할 수 있는 일 보기" }) }), expanded ? (_jsx("div", { className: gradeStyles.memberExpansion, children: _jsx(MemberCapabilities, { policy: policy, subjectId: subject.id }) })) : null] }));
}
function ComplexGradeSummary({ policy, subjectId, reasons, basePath }) {
    const { setMode } = useDisplayMode();
    const navigate = useNavigate();
    const boundRoles = policy.bindings
        .filter((binding) => binding.subjectId === subjectId)
        .map((binding) => roleNameOf(policy, binding.roleId));
    return (_jsxs("div", { className: gradeStyles.memberGrade, children: [_jsxs("div", { className: gradeStyles.memberChips, children: [boundRoles.length > 0
                        ? boundRoles.map((name) => _jsx(Badge, { children: name }, name))
                        : _jsx(Badge, { children: "\uC138\uBD80 \uC124\uC815 \uC788\uC74C" }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => {
                            setMode("standard", { auto: true });
                            void navigate(`${basePath}/bindings`);
                        }, children: "\uD45C\uC900 \uBAA8\uB4DC\uC5D0\uC11C \uAD00\uB9AC" })] }), _jsx("ul", { className: gradeStyles.memberReasons, children: reasons.map((reason) => _jsx("li", { children: reason }, reason)) })] }));
}
function MemberCapabilities({ policy, subjectId }) {
    const { authorization } = useAuthorizationWorkspace();
    const root = rootResource(policy);
    const capabilities = useMutation({
        mutationFn: async () => Promise.all(policy.permissions.map(async (permission) => {
            if (permission.hierarchyGuard !== "none") {
                return { permission, supported: false, decision: null };
            }
            return {
                permission,
                supported: true,
                decision: await authorization.simulate({
                    subjectId,
                    action: permission.key,
                    resourceId: root.id,
                }),
            };
        })),
    });
    if (root === null)
        return _jsx("span", { className: styles.hint, children: "\uC601\uC5ED \uAD6C\uC870\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC5B4 \uACB0\uACFC\uB97C \uBCF4\uC5EC\uC904 \uC218 \uC5C6\uC5B4\uC694." });
    if (capabilities.data === undefined) {
        return (_jsx("div", { className: styles.formActions, children: _jsx(Button, { size: "small", variant: "secondary", onPress: () => capabilities.mutate(), isDisabled: capabilities.isPending, children: capabilities.isPending ? "확인 중…" : "지금 확인하기" }) }));
    }
    return _jsx(EffectivePermissionList, { policy: policy, results: capabilities.data });
}
//# sourceMappingURL=members-page.js.map