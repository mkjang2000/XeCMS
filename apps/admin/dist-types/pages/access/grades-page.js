import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout, ConfirmDialog, EmptyState } from "@xecms/ui";
import gradeStyles from "../../access-grades.module.css";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, SectionHeader } from "../../components/page.js";
import { AccessPageHeader } from "./common.js";
import { AdvancedConfigNotice, PolicyMutationError } from "./guardrails.js";
import { droppedDelegations, gradePermissionEdit, levelSimpleState, memberCountByLevel, rankBetween, sortedLevels, } from "./policy-simple-view.js";
import { permissionCategoryName, permissionTaskName } from "./vocabulary.js";
import { accessBasePath, canMutateAuthorization, useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";
export function AccessGradesPage() {
    const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const policy = useAuthorizationPolicy();
    const [sheet, setSheet] = useState(null);
    const basePath = accessBasePath(realmId);
    const ensureRole = useMutation({
        mutationFn: async (level) => authorization.createRole({
            name: level.name,
            levelId: level.id,
            permissions: [],
            delegatablePermissions: [],
            fieldAccess: [],
            expectedPolicyRevision: policy.data.revision,
        }),
        onSuccess: (next, level) => {
            queryClient.setQueryData(policyKey, next);
            setSheet({ kind: "edit", levelId: level.id });
        },
    });
    if (policy.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uB4F1\uAE09 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(RealmAuthorizationError, { error: policy.error, context: "policy", realmId: realmId, onRetry: () => void policy.refetch() }) });
    const levels = sortedLevels(policy.data);
    const counts = memberCountByLevel(policy.data);
    const writable = canMutateAuthorization(policy.data, realmId);
    const closeSheet = () => setSheet(null);
    const editingLevel = sheet?.kind === "edit"
        ? levels.find(({ id }) => id === sheet.levelId) ?? null
        : null;
    return (_jsxs(Page, { children: [_jsx(AccessPageHeader, { realmId: realmId, title: "\uB4F1\uAE09 \uAD00\uB9AC", description: "\uBA64\uBC84 \uB4F1\uAE09\uB9C8\uB2E4 \uD560 \uC218 \uC788\uB294 \uC77C\uC744 \uC815\uD569\uB2C8\uB2E4. \uC704\uC5D0 \uC788\uB294 \uB4F1\uAE09\uC774 \uC544\uB798 \uB4F1\uAE09\uC744 \uAD00\uB9AC\uD569\uB2C8\uB2E4.", actions: writable ? _jsx(Button, { onPress: () => setSheet({ kind: "create" }), children: "\uC0C8 \uB4F1\uAE09" }) : undefined }), _jsx(AccessWorkspaceNav, { policy: policy.data }), _jsxs("div", { className: `${styles.layout} ${styles.rolesLayout}`, children: [_jsxs("div", { className: gradeStyles.gradeList, children: [levels.map((level) => (_jsx(GradeCard, { policy: policy.data, level: level, memberCount: counts.get(level.id) ?? 0, onEdit: () => setSheet({ kind: "edit", levelId: level.id }), onDefine: () => ensureRole.mutate(level), definePending: ensureRole.isPending, readOnly: !writable }, level.id))), _jsx(PolicyMutationError, { error: ensureRole.error, policyKey: policyKey })] }), sheet !== null ? _jsx("button", { className: styles.drawerBackdrop, type: "button", "aria-label": "\uD3B8\uC9D1 \uD328\uB110 \uB2EB\uAE30", onClick: closeSheet }) : null, _jsxs("div", { className: styles.detailPane, "data-open": sheet !== null, children: [sheet !== null ? (_jsxs("div", { className: styles.drawerHeader, children: [_jsx("strong", { children: sheet.kind === "create" ? "새 등급" : editingLevel?.name ?? "등급" }), _jsx(Button, { size: "small", variant: "quiet", onPress: closeSheet, children: "\uB2EB\uAE30" })] })) : null, sheet === null ? (_jsx("section", { className: `${styles.panel} ${styles.inspectorEmpty}`, children: _jsx(EmptyState, { title: "\uB4F1\uAE09\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "\uB4F1\uAE09 \uCE74\uB4DC\uC5D0\uC11C \uAD8C\uD55C \uD3B8\uC9D1\uC744 \uB204\uB974\uBA74 \uC774\uACF3\uC5D0\uC11C \uD560 \uC218 \uC788\uB294 \uC77C\uC744 \uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) })) : sheet.kind === "create" ? (writable ? _jsx(GradeCreator, { policy: policy.data, onClose: closeSheet, onCreated: (levelId) => setSheet({ kind: "edit", levelId }) }) : null) : editingLevel === null ? null : (_jsx(GradePermissionSheet, { policy: policy.data, level: editingLevel, basePath: basePath, forcedReadOnly: !writable, onClose: closeSheet }, editingLevel.id))] })] })] }));
}
function roleCategorySummary(policy, role) {
    const categoryByKey = new Map(policy.permissions.map((permission) => [permission.key, permission.category]));
    const categories = [...new Set(role.permissions
            .map((key) => categoryByKey.get(key))
            .filter((category) => category !== undefined))];
    return categories.length === 0 ? "아직 정해진 업무 없음" : categories.map(permissionCategoryName).join(" · ") + " 담당";
}
function GradeCard({ policy, level, memberCount, onEdit, onDefine, definePending, readOnly }) {
    const state = levelSimpleState(policy, level);
    const permissionCount = state.kind === "editable"
        ? state.role.permissions.length
        : state.kind === "empty"
            ? 0
            : [...new Set(state.roles.flatMap(({ permissions }) => permissions))].length;
    return (_jsxs("section", { className: gradeStyles.gradeCard, "data-locked": state.kind === "protected", "aria-label": `${level.name} 등급`, children: [_jsxs("div", { className: gradeStyles.gradeHeader, children: [_jsxs("div", { className: gradeStyles.gradeIdentity, children: [_jsx("h2", { children: level.name }), _jsxs("div", { className: gradeStyles.gradeMeta, children: [_jsxs("span", { children: ["\uBA64\uBC84 ", memberCount, "\uBA85"] }), _jsxs("span", { children: ["\uD560 \uC218 \uC788\uB294 \uC77C ", permissionCount, "\uAC1C"] }), state.kind === "aggregate" ? _jsxs("span", { children: ["\uC5ED\uD560 ", state.roles.length, "\uAC1C"] }) : null] })] }), _jsx("div", { className: gradeStyles.gradeActions, children: state.kind === "protected" ? (_jsxs(_Fragment, { children: [_jsx(Badge, { children: "\uAE30\uBCF8 \uC81C\uACF5" }), _jsx(Button, { size: "small", variant: "quiet", onPress: onEdit, children: "\uAD6C\uC131 \uBCF4\uAE30" })] })) : state.kind === "editable" ? (_jsx(Button, { size: "small", variant: "secondary", onPress: onEdit, children: readOnly ? "구성 보기" : "권한 편집" })) : state.kind === "empty" ? (readOnly ? _jsx(Badge, { tone: "info", children: "\uC77D\uAE30 \uC804\uC6A9" }) : _jsx(Button, { size: "small", variant: "secondary", onPress: onDefine, isDisabled: definePending, children: "\uC774 \uB4F1\uAE09\uC758 \uAD8C\uD55C \uC815\uD558\uAE30" })) : (_jsx(Button, { size: "small", variant: "quiet", onPress: onEdit, children: "\uAD6C\uC131 \uBCF4\uAE30" })) })] }), state.kind === "aggregate" ? (_jsxs("div", { className: gradeStyles.gradeRoleSplit, children: [_jsx("p", { children: "\uC774 \uB4F1\uAE09\uC740 \uB2F4\uB2F9 \uC5C5\uBB34\uBCC4\uB85C \uC5ED\uD560\uC774 \uB098\uB258\uC5B4 \uC788\uC5B4\uC694. \uC804\uCCB4 \uAD6C\uC131\uC740 \uADF8\uB300\uB85C \uD655\uC778\uD560 \uC218 \uC788\uACE0, \uC5ED\uD560\uBCC4 \uD3B8\uC9D1\uC740 \uD45C\uC900 \uBAA8\uB4DC\uC5D0\uC11C \uD560 \uC218 \uC788\uC5B4\uC694." }), state.roles.map((role) => (_jsxs("div", { className: gradeStyles.gradeRoleRow, children: [_jsx("strong", { children: role.name }), _jsx("span", { children: roleCategorySummary(policy, role) })] }, role.id)))] })) : null, state.kind === "protected" ? (_jsx("div", { className: gradeStyles.gradeMeta, children: level.rank >= 100 ? "워크스페이스의 최고 관리 등급이에요. 항상 모든 일을 할 수 있어 변경할 수 없어요." : "로그인하지 않은 방문자 등급이에요. 안전을 위해 변경할 수 없어요." })) : null] }));
}
function GradePermissionSheet({ policy, level, basePath, forcedReadOnly, onClose }) {
    const { authorization, policyKey } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const state = levelSimpleState(policy, level);
    const readOnly = forcedReadOnly || state.kind !== "editable";
    const role = state.kind === "editable" ? state.role : null;
    const unionPermissions = useMemo(() => state.kind === "editable"
        ? state.role.permissions
        : state.kind === "empty" ? [] : [...new Set(state.roles.flatMap(({ permissions }) => permissions))], [state]);
    // 간단 모드 시트에 노출하는 권한 카탈로그(위임 가능·비보호). 역할이 이미 가진
    // 비노출 권한은 저장 시 그대로 보존한다.
    const visibleCatalog = useMemo(() => policy.permissions.filter((permission) => readOnly || (permission.delegatable && !permission.protected)), [policy.permissions, readOnly]);
    const visibleKeys = useMemo(() => new Set(visibleCatalog.map(({ key }) => key)), [visibleCatalog]);
    const hiddenGranted = useMemo(() => (role?.permissions ?? []).filter((key) => !visibleKeys.has(key)), [role, visibleKeys]);
    const [selected, setSelected] = useState(() => (role?.permissions ?? unionPermissions).filter((key) => visibleKeys.has(key)));
    const [confirming, setConfirming] = useState(false);
    const save = useMutation({
        mutationFn: async () => {
            const nextPermissions = [...hiddenGranted, ...selected];
            return authorization.updateRole(role.id, {
                ...gradePermissionEdit(role, nextPermissions),
                expectedPolicyRevision: policy.revision,
            });
        },
        onSuccess: (next) => {
            queryClient.setQueryData(policyKey, next);
            setConfirming(false);
            onClose();
        },
        onError: () => setConfirming(false),
    });
    const groups = useMemo(() => {
        const map = new Map();
        for (const permission of visibleCatalog) {
            map.set(permission.category, [...(map.get(permission.category) ?? []), permission]);
        }
        return [...map.entries()];
    }, [visibleCatalog]);
    const toggle = (key, on) => {
        setSelected((current) => on ? [...new Set([...current, key])] : current.filter((item) => item !== key));
    };
    const toggleCategory = (keys, on) => {
        setSelected((current) => on
            ? [...new Set([...current, ...keys])]
            : current.filter((item) => !keys.includes(item)));
    };
    const originalVisible = (role?.permissions ?? unionPermissions).filter((key) => visibleKeys.has(key));
    const added = selected.filter((key) => !originalVisible.includes(key));
    const removed = originalVisible.filter((key) => !selected.includes(key));
    const dirty = added.length > 0 || removed.length > 0;
    const dropped = role === null ? [] : droppedDelegations(role, [...hiddenGranted, ...selected]);
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uB4F1\uAE09 \uAD8C\uD55C \uD3B8\uC9D1\uAE30", children: [_jsx(SectionHeader, { title: readOnly ? `${level.name} 등급 구성` : `${level.name} 등급의 권한`, description: readOnly
                    ? "이 등급이 할 수 있는 일을 한눈에 보여 드려요."
                    : "이 등급의 멤버가 할 수 있는 일을 체크하세요.", actions: readOnly ? _jsx(Badge, { children: "\uC77D\uAE30 \uC804\uC6A9" }) : undefined }), state.kind === "aggregate" ? (_jsx(AdvancedConfigNotice, { message: "\uC774 \uB4F1\uAE09\uC740 \uB2F4\uB2F9 \uC5C5\uBB34\uBCC4\uB85C \uC5ED\uD560\uC774 \uB098\uB258\uC5B4 \uC788\uC5B4 \uC5EC\uAE30\uC11C\uB294 \uC804\uCCB4 \uAD6C\uC131\uB9CC \uBCF4\uC5EC \uB4DC\uB824\uC694.", reasons: state.roles.map((item) => `${item.name} — ${roleCategorySummary(policy, item)}`), to: `${basePath}/roles`, actionLabel: "\uD45C\uC900 \uBAA8\uB4DC\uC5D0\uC11C \uC5ED\uD560\uBCC4\uB85C \uD3B8\uC9D1" })) : null, state.kind === "protected" ? (_jsx(Callout, { tone: "info", children: "\uAE30\uBCF8 \uC81C\uACF5 \uB4F1\uAE09\uC740 \uC2DC\uC2A4\uD15C \uB3D9\uC791\uC5D0 \uD544\uC694\uD574 \uAD6C\uC131\uC744 \uBC14\uAFC0 \uC218 \uC5C6\uC5B4\uC694." })) : null, _jsx("div", { className: gradeStyles.sheetGroups, children: groups.map(([category, items]) => {
                    const keys = items.map(({ key }) => key);
                    const activeKeys = readOnly ? unionPermissions : selected;
                    const checkedCount = keys.filter((key) => activeKeys.includes(key)).length;
                    return (_jsxs("section", { className: gradeStyles.sheetGroup, children: [_jsxs("div", { className: gradeStyles.sheetGroupHeader, children: [_jsx("strong", { children: permissionCategoryName(category) }), !readOnly ? (_jsx(CategoryToggle, { label: `${permissionCategoryName(category)} 전체 선택`, total: keys.length, checked: checkedCount, onChange: (on) => toggleCategory(keys, on) })) : _jsxs("span", { className: styles.hint, children: [checkedCount, "/", keys.length, "\uAC1C"] })] }), items.map((permission) => (_jsxs("label", { className: gradeStyles.sheetTask, "data-readonly": readOnly, children: [_jsx("input", { type: "checkbox", checked: (readOnly ? unionPermissions : selected).includes(permission.key), disabled: readOnly, onChange: (event) => toggle(permission.key, event.target.checked) }), _jsx("span", { children: permissionTaskName(permission.key) })] }, permission.key)))] }, category));
                }) }), !readOnly ? (_jsxs(_Fragment, { children: [_jsx("div", { className: gradeStyles.sheetSummary, children: _jsxs("span", { children: [selected.length, "\uAC1C \uC5C5\uBB34 \uD5C8\uC6A9", dirty ? ` · 추가 ${added.length} / 해제 ${removed.length}` : ""] }) }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { variant: "quiet", onPress: onClose, isDisabled: save.isPending, children: "\uCDE8\uC18C" }), _jsx(Button, { onPress: () => setConfirming(true), isDisabled: !dirty || save.isPending, children: "\uC800\uC7A5" })] })] })) : null, _jsx(PolicyMutationError, { error: save.error, policyKey: policyKey }), confirming ? (_jsxs(ConfirmDialog, { title: `${level.name} 등급의 권한 변경`, confirmLabel: "\uBCC0\uACBD \uC800\uC7A5", isPending: save.isPending, onConfirm: () => save.mutate(), onCancel: () => setConfirming(false), children: [_jsxs("p", { children: [level.name, " \uB4F1\uAE09\uC758 \uAD8C\uD55C ", added.length + removed.length, "\uAC1C\uB97C \uBCC0\uACBD\uD569\uB2C8\uB2E4. \uC774 \uB4F1\uAE09\uC758 \uBAA8\uB4E0 \uBA64\uBC84\uC5D0\uAC8C \uBC14\uB85C \uC801\uC6A9\uB3FC\uC694."] }), dropped.length > 0 ? (_jsxs("p", { children: ["\uD574\uC81C\uD558\uB294 \uAD8C\uD55C\uC5D0\uB294 \uACE0\uAE09 \uC124\uC815(\uC544\uB798 \uB4F1\uAE09\uC73C\uB85C \uB118\uACA8\uC8FC\uAE30)\uC774 \uC788\uC5B4\uC694. \uD568\uAED8 \uD574\uC81C\uB429\uB2C8\uB2E4: ", dropped.map(permissionTaskName).join(", ")] })) : null] })) : null] }));
}
function CategoryToggle({ label, total, checked, onChange }) {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current !== null)
            ref.current.indeterminate = checked > 0 && checked < total;
    }, [checked, total]);
    return (_jsxs("label", { className: gradeStyles.sheetGroupToggle, children: [_jsx("input", { ref: ref, type: "checkbox", "aria-label": label, checked: total > 0 && checked === total, onChange: (event) => onChange(event.target.checked) }), _jsx("span", { children: "\uC804\uCCB4 \uC120\uD0DD" })] }));
}
function GradeCreator({ policy, onClose, onCreated }) {
    const { authorization, policyKey } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const [name, setName] = useState("");
    const [slot, setSlot] = useState("");
    const [recoveryLevel, setRecoveryLevel] = useState(null);
    const levels = sortedLevels(policy);
    const slots = levels.slice(0, -1).map((upper, index) => {
        const lower = levels[index + 1];
        return {
            id: `${upper.id}:${lower.id}`,
            label: `${upper.name} 아래 · ${lower.name} 위`,
            rank: rankBetween(upper.rank, lower.rank),
        };
    });
    const selectedSlot = slots.find(({ id }) => id === slot);
    const create = useMutation({
        mutationFn: async () => {
            const trimmed = name.trim();
            const rank = selectedSlot.rank;
            const afterLevel = await authorization.createLevel({
                name: trimmed,
                rank,
                expectedPolicyRevision: policy.revision,
            });
            queryClient.setQueryData(policyKey, afterLevel);
            const level = afterLevel.levels.find((item) => item.name === trimmed && item.rank === rank);
            if (level === undefined)
                throw new Error("등급이 만들어졌지만 정보를 다시 불러와야 해요.");
            try {
                const afterRole = await authorization.createRole({
                    name: trimmed,
                    levelId: level.id,
                    permissions: [],
                    delegatablePermissions: [],
                    fieldAccess: [],
                    expectedPolicyRevision: afterLevel.revision,
                });
                queryClient.setQueryData(policyKey, afterRole);
                return level.id;
            }
            catch (error) {
                setRecoveryLevel(level);
                throw error;
            }
        },
        onSuccess: onCreated,
    });
    const retryRole = useMutation({
        mutationFn: async () => {
            const current = queryClient.getQueryData([...policyKey]);
            return authorization.createRole({
                name: recoveryLevel.name,
                levelId: recoveryLevel.id,
                permissions: [],
                delegatablePermissions: [],
                fieldAccess: [],
                expectedPolicyRevision: (current ?? policy).revision,
            });
        },
        onSuccess: (next) => {
            queryClient.setQueryData(policyKey, next);
            const levelId = recoveryLevel.id;
            setRecoveryLevel(null);
            onCreated(levelId);
        },
    });
    if (recoveryLevel !== null) {
        return (_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uB4F1\uAE09\uC740 \uB9CC\uB4E4\uC5B4\uC84C\uC5B4\uC694", description: "\uAD8C\uD55C \uC124\uC815\uB9CC \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uBA74 \uB3FC\uC694." }), _jsxs(Callout, { tone: "warning", children: [_jsxs("strong", { children: [recoveryLevel.name, " \uB4F1\uAE09\uC740 \uB9CC\uB4E4\uC5B4\uC84C\uC9C0\uB9CC \uAD8C\uD55C \uC124\uC815 \uC900\uBE44\uAC00 \uB05D\uB098\uC9C0 \uC54A\uC558\uC5B4\uC694."] }), _jsx("div", { children: "\uB2E4\uC2DC \uC2DC\uB3C4\uD558\uAC70\uB098, \uB098\uC911\uC5D0 \uB4F1\uAE09 \uCE74\uB4DC\uC758 \"\uC774 \uB4F1\uAE09\uC758 \uAD8C\uD55C \uC815\uD558\uAE30\"\uB85C \uC774\uC5B4\uC11C \uD560 \uC218 \uC788\uC5B4\uC694." })] }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { variant: "quiet", onPress: onClose, isDisabled: retryRole.isPending, children: "\uB098\uC911\uC5D0 \uD558\uAE30" }), _jsx(Button, { onPress: () => retryRole.mutate(), isDisabled: retryRole.isPending, children: "\uAD8C\uD55C \uC124\uC815 \uB2E4\uC2DC \uC2DC\uB3C4" })] }), _jsx(PolicyMutationError, { error: retryRole.error, policyKey: policyKey })] }));
    }
    return (_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uC0C8 \uB4F1\uAE09", description: "\uB4F1\uAE09 \uC774\uB984\uACFC \uC704\uCE58\uB9CC \uC815\uD558\uBA74 \uBC14\uB85C \uAD8C\uD55C\uC744 \uACE0\uB97C \uC218 \uC788\uC5B4\uC694." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uB4F1\uAE09 \uC774\uB984" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value), placeholder: "\uC608: \uC6B0\uC218 \uBA64\uBC84" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC5B4\uB290 \uC704\uCE58\uC5D0 \uB458\uAE4C\uC694?" }), _jsxs("select", { value: slot, onChange: (event) => setSlot(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), slots.map((item) => (_jsxs("option", { value: item.id, disabled: item.rank === null, children: [item.label, item.rank === null ? " · 지금은 만들 수 없어요" : ""] }, item.id)))] })] }), selectedSlot?.rank === null ? (_jsx(Callout, { tone: "info", children: "\uC774 \uC704\uCE58\uC5D0\uB294 \uC9C0\uAE08 \uC0C8 \uB4F1\uAE09\uC744 \uB9CC\uB4E4 \uC218 \uC5C6\uC5B4\uC694. \uB2E4\uB978 \uC704\uCE58\uB97C \uC120\uD0DD\uD558\uAC70\uB098 \uAD00\uB9AC\uC790\uC5D0\uAC8C \uBB38\uC758\uD574 \uC8FC\uC138\uC694." })) : null, _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { variant: "quiet", onPress: onClose, isDisabled: create.isPending, children: "\uCDE8\uC18C" }), _jsx(Button, { onPress: () => create.mutate(), isDisabled: create.isPending || name.trim() === "" || selectedSlot === undefined || selectedSlot.rank === null, children: "\uB4F1\uAE09 \uB9CC\uB4E4\uAE30" })] }), _jsx(PolicyMutationError, { error: create.error, policyKey: policyKey })] })] }));
}
//# sourceMappingURL=grades-page.js.map