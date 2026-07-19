import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { AccessWorkspaceNav } from "../../components/access-workspace-nav.js";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { useDisplayMode } from "../../display-mode.js";
import { ScopeTreeSelector } from "../../components/resource-scope-tree.js";
import { MutationError, PolicySummary, textList } from "./common.js";
import { PermissionEditor } from "./permission-editor.js";
import { canMutateAuthorization, useAuthorizationPolicy, useAuthorizationWorkspace } from "./workspace.js";
export function AccessRolesPage() {
    const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const policy = useAuthorizationPolicy();
    const { mode } = useDisplayMode();
    const advanced = mode === "advanced";
    const [editingRole, setEditingRole] = useState(null);
    const [editingLevel, setEditingLevel] = useState(null);
    const [levelEditorOpen, setLevelEditorOpen] = useState(false);
    const saveRole = useMutation({
        mutationFn: async (input) => editingRole === null || editingRole.id === ""
            ? authorization.createRole({ ...input, expectedPolicyRevision: policy.data.revision })
            : authorization.updateRole(editingRole.id, { ...input, expectedPolicyRevision: policy.data.revision }),
        onSuccess: (next) => {
            queryClient.setQueryData(policyKey, next);
            setEditingRole(null);
        },
    });
    const deleteRole = useMutation({
        mutationFn: (roleId) => authorization.deleteRole(roleId, policy.data.revision),
        onSuccess: (next) => {
            queryClient.setQueryData(policyKey, next);
            setEditingRole(null);
        },
    });
    const saveLevel = useMutation({
        mutationFn: (input) => editingLevel === null
            ? authorization.createLevel({ ...input, expectedPolicyRevision: policy.data.revision })
            : authorization.updateLevel(editingLevel.id, { ...input, expectedPolicyRevision: policy.data.revision }),
        onSuccess: (next) => {
            queryClient.setQueryData(policyKey, next);
            setEditingLevel(null);
            setLevelEditorOpen(false);
        },
    });
    if (policy.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uAD8C\uD55C \uC815\uCC45\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(RealmAuthorizationError, { error: policy.error, context: "policy", realmId: realmId, onRetry: () => void policy.refetch() }) });
    const writable = canMutateAuthorization(policy.data, realmId);
    const levels = [...policy.data.levels].sort((left, right) => right.rank - left.rank);
    const selectRole = (role) => {
        setEditingLevel(null);
        setLevelEditorOpen(false);
        setEditingRole(role);
    };
    const selectLevel = (level) => {
        setEditingRole(null);
        setEditingLevel(level);
        setLevelEditorOpen(true);
    };
    const createRoleAt = (level) => selectRole({
        id: "",
        realmId: policy.data.realmId,
        levelId: level.id,
        name: "",
        permissions: [],
        delegatablePermissions: [],
        fieldAccess: [],
        protected: false,
    });
    const closeInspector = () => {
        setEditingRole(null);
        setEditingLevel(null);
        setLevelEditorOpen(false);
    };
    const inspectorOpen = levelEditorOpen || editingRole !== null;
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "System authorization", title: advanced ? "레벨과 역할" : "등급과 역할", description: advanced ? "위쪽 레벨이 아래쪽 역할을 관리합니다. 같은 레벨에서는 책임만 나누고 서로를 관리하지 않습니다." : "등급별 역할과 맡은 업무를 관리합니다. 등급 순서 변경은 고급 모드에서 할 수 있습니다.", actions: advanced && writable ? _jsx(Button, { onPress: () => selectLevel(null), children: "\uC0C8 \uB808\uBCA8" }) : undefined }), _jsx(AccessWorkspaceNav, { policy: policy.data }), _jsxs("div", { className: styles.guideBanner, children: [_jsx("span", { className: styles.guideNumber, children: "1" }), _jsxs("div", { children: [_jsx("strong", { children: advanced ? "먼저 관리 서열을 정하고, 같은 높이에 필요한 역할을 나누세요." : "등급 안에서 담당 업무별 역할을 나눌 수 있습니다." }), _jsx("p", { children: advanced ? "역할을 선택하면 오른쪽에서 실제 업무와 위임 범위를 설정할 수 있습니다." : "고급 위임·필드 제한이 있는 역할도 값을 유지한 채 기본 업무만 편집합니다." })] })] }), _jsx(PolicySummary, { policy: policy.data }), _jsxs("div", { className: `${styles.layout} ${styles.rolesLayout}`, children: [_jsx("div", { className: styles.levels, children: levels.map((level) => {
                            const roles = policy.data.roles.filter((role) => role.levelId === level.id);
                            return (_jsxs("section", { className: styles.levelCard, children: [_jsxs("div", { className: styles.levelHeader, children: [_jsxs("div", { className: styles.levelIdentity, children: [advanced ? _jsxs("span", { className: styles.rank, children: ["L", level.rank] }) : null, _jsxs("div", { children: [_jsx("h2", { children: level.name }), _jsx("span", { className: styles.hint, children: advanced ? `권한 레벨 ${level.rank} · 같은 높이의 역할 ${roles.length}개` : `역할 ${roles.length}개` })] })] }), _jsxs("div", { className: styles.levelActions, children: [writable ? _jsx(Button, { size: "small", variant: "secondary", onPress: () => createRoleAt(level), children: "\uB3D9\uC77C \uB808\uBCA8 \uC5ED\uD560 \uCD94\uAC00" }) : null, advanced && writable && !level.protected
                                                        ? _jsx(Button, { size: "small", variant: "quiet", onPress: () => selectLevel(level), children: "\uB808\uBCA8 \uD3B8\uC9D1" })
                                                        : level.protected ? _jsx(Badge, { children: "\uBCF4\uD638\uB428" }) : null] })] }), _jsxs("div", { className: styles.roleList, children: [roles.map((role) => (_jsxs("button", { className: styles.roleCard, type: "button", "data-selected": editingRole?.id === role.id, "aria-pressed": editingRole?.id === role.id, onClick: () => selectRole(role), children: [_jsxs("div", { className: styles.roleSummary, children: [_jsxs("div", { className: styles.roleHeader, children: [_jsx("h3", { children: role.name }), role.protected ? _jsx(Badge, { children: "\uBCF4\uD638\uB428" }) : null] }), _jsx("p", { className: styles.muted, children: role.description || "설명이 아직 없습니다." })] }), _jsxs("div", { className: styles.roleStats, children: [_jsxs("span", { className: styles.chip, children: ["\uAD8C\uD55C ", role.permissions.length] }), advanced ? _jsxs("span", { className: styles.chip, children: ["\uC704\uC784 ", role.delegatablePermissions.length] }) : null, advanced ? _jsxs("span", { className: styles.chip, children: ["\uD544\uB4DC \uADDC\uCE59 ", role.fieldAccess.length] }) : null, !advanced && (role.delegatablePermissions.length > 0 || role.fieldAccess.length > 0) ? _jsx(Badge, { tone: "info", children: "\uACE0\uAE09 \uC124\uC815 \uC788\uC74C" }) : null] }), _jsx("span", { className: styles.roleChevron, "aria-hidden": "true", children: "\u203A" })] }, role.id))), roles.length === 0 ? (_jsxs("div", { className: styles.emptyRoleRow, children: [_jsx("span", { children: "\uC544\uC9C1 \uC5ED\uD560\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }), writable ? _jsx(Button, { size: "small", variant: "quiet", onPress: () => createRoleAt(level), children: "\uCCAB \uC5ED\uD560 \uCD94\uAC00" }) : null] })) : null] })] }, level.id));
                        }) }), inspectorOpen ? _jsx("button", { className: styles.drawerBackdrop, type: "button", "aria-label": "\uD3B8\uC9D1 \uD328\uB110 \uB2EB\uAE30", onClick: closeInspector }) : null, _jsxs("div", { className: styles.detailPane, "data-open": inspectorOpen, children: [inspectorOpen ? _jsxs("div", { className: styles.drawerHeader, children: [_jsx("strong", { children: levelEditorOpen ? editingLevel ? "레벨 편집" : "새 레벨" : editingRole?.name || "새 역할" }), _jsx(Button, { size: "small", variant: "quiet", onPress: closeInspector, children: "\uB2EB\uAE30" })] }) : null, levelEditorOpen ? (writable ? _jsxs(_Fragment, { children: [_jsx(LevelEditor, { level: editingLevel, onCancel: closeInspector, onSave: (input) => saveLevel.mutate(input), isPending: saveLevel.isPending }), _jsx(MutationError, { error: saveLevel.error })] }) : _jsx("section", { className: styles.panel, children: _jsx(Callout, { tone: "info", children: "Full Access\uAC00 \uC885\uB8CC\uB418\uC5B4 \uB808\uBCA8 \uD3B8\uC9D1\uC744 \uB2EB\uC558\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uC815\uCC45\uC740 \uC77D\uAE30 \uC804\uC6A9\uC785\uB2C8\uB2E4." }) })) : (_jsxs(_Fragment, { children: [_jsx(RoleEditor, { policy: policy.data, role: editingRole, onCancel: () => setEditingRole(null), onSave: (input) => saveRole.mutate(input), onDelete: writable && editingRole?.id && !editingRole.protected ? () => deleteRole.mutate(editingRole.id) : undefined, isPending: saveRole.isPending || deleteRole.isPending, advanced: advanced, forcedReadOnly: !writable }), _jsx(MutationError, { error: saveRole.error ?? deleteRole.error })] }))] })] })] }));
}
function LevelEditor({ level, onSave, onCancel, isPending }) {
    const [name, setName] = useState("");
    const [rank, setRank] = useState("50");
    useEffect(() => {
        setName(level?.name ?? "");
        setRank(String(level?.rank ?? 50));
    }, [level]);
    return (_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: level ? "레벨 편집" : "새 레벨", description: "\uC22B\uC790\uAC00 \uD074\uC218\uB85D \uAD00\uB9AC \uC11C\uC5F4\uC774 \uB192\uC2B5\uB2C8\uB2E4." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uB808\uBCA8 \uC774\uB984" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Rank" }), _jsx("input", { type: "number", value: rank, onChange: (event) => setRank(event.target.value) })] }), _jsxs("div", { className: styles.formActions, children: [level ? _jsx(Button, { variant: "quiet", onPress: onCancel, children: "\uCDE8\uC18C" }) : null, _jsx(Button, { onPress: () => onSave({ name: name.trim(), rank: Number(rank) }), isDisabled: isPending || name.trim() === "", children: "\uC800\uC7A5" })] })] })] }));
}
function RoleEditor({ policy, role, onSave, onDelete, onCancel, isPending, advanced, forcedReadOnly }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [levelId, setLevelId] = useState("");
    const [permissions, setPermissions] = useState([]);
    const [delegations, setDelegations] = useState([]);
    const [fieldResourceId, setFieldResourceId] = useState("");
    const [readableFields, setReadableFields] = useState("");
    const [writableFields, setWritableFields] = useState("");
    const [permissionQuery, setPermissionQuery] = useState("");
    const [technicalPermissions, setTechnicalPermissions] = useState(false);
    useEffect(() => {
        setName(role?.name ?? "");
        setDescription(role?.description ?? "");
        setLevelId(role?.levelId ?? policy.levels[0]?.id ?? "");
        setPermissions(role?.permissions ?? []);
        setDelegations(role?.delegatablePermissions ?? []);
        setFieldResourceId(role?.fieldAccess[0]?.resourceId ?? "");
        setReadableFields(role?.fieldAccess[0]?.readableFields.join(", ") ?? "");
        setWritableFields(role?.fieldAccess[0]?.writableFields.join(", ") ?? "");
        setPermissionQuery("");
        setTechnicalPermissions(false);
    }, [policy.levels, role]);
    const togglePermission = (key, selected) => {
        setPermissions((current) => selected ? [...new Set([...current, key])] : current.filter((item) => item !== key));
        if (!selected)
            setDelegations((current) => current.filter((item) => item !== key));
    };
    const toggleDelegation = (key, selected) => {
        setDelegations((current) => selected ? [...new Set([...current, key])] : current.filter((item) => item !== key));
    };
    if (role === null) {
        return _jsx("section", { className: `${styles.panel} ${styles.inspectorEmpty}`, children: _jsx(EmptyState, { title: "\uD3B8\uC9D1\uD560 \uD56D\uBAA9\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "\uBAA9\uB85D\uC5D0\uC11C \uC5ED\uD560\uC744 \uC120\uD0DD\uD558\uAC70\uB098 \uC0C8 \uB808\uBCA8\u00B7\uB3D9\uC77C \uB808\uBCA8 \uC5ED\uD560\uC744 \uCD94\uAC00\uD558\uC138\uC694." }) });
    }
    const readOnly = forcedReadOnly || role.protected;
    const availablePermissions = readOnly
        ? policy.permissions
        : policy.permissions.filter((permission) => permission.delegatable && !permission.protected);
    const normalizedQuery = permissionQuery.trim().toLocaleLowerCase();
    const visiblePermissions = normalizedQuery === ""
        ? availablePermissions
        : availablePermissions.filter((permission) => `${permission.key} ${permission.label} ${permission.category}`.toLocaleLowerCase().includes(normalizedQuery));
    const selectedLevel = policy.levels.find((level) => level.id === levelId);
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uC5ED\uD560 \uD3B8\uC9D1\uAE30", children: [_jsx(SectionHeader, { title: readOnly ? "보호 역할 상세" : role.id ? "역할 편집" : "동일 레벨 역할 추가", description: forcedReadOnly ? "CMS Owner 감독 모드에서는 구성을 확인할 수 있지만 수정할 수 없습니다." : readOnly ? "시스템 보호 역할은 구성을 확인할 수 있지만 수정할 수 없습니다." : advanced ? "사용 권한과 하위 역할에 위임할 수 있는 범위를 분리합니다." : "역할이 맡을 기본 업무를 선택합니다. 숨은 고급 설정은 그대로 유지됩니다.", actions: readOnly ? _jsx(Badge, { children: "\uC77D\uAE30 \uC804\uC6A9" }) : undefined }), readOnly ? _jsx(Callout, { tone: "info", children: forcedReadOnly ? "Full Access를 시작하기 전에는 Realm 정책을 읽기만 할 수 있습니다." : "이 역할은 시스템 동작에 필요하므로 이름, 레벨, 권한 구성이 보호됩니다." }) : null, !advanced && (role.delegatablePermissions.length > 0 || role.fieldAccess.length > 0) ? _jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "\uACE0\uAE09 \uC124\uC815 \uC788\uC74C" }), " \uC704\uC784 \uB610\uB294 \uD544\uB4DC \uC811\uADFC \uC81C\uD55C\uC740 \uC774 \uD654\uBA74\uC5D0\uC11C \uBC14\uB00C\uC9C0 \uC54A\uC73C\uBA70 \uC800\uC7A5\uD574\uB3C4 \uADF8\uB300\uB85C \uC720\uC9C0\uB429\uB2C8\uB2E4."] }) : null, _jsxs("div", { className: styles.form, children: [_jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "1" }), _jsxs("div", { children: [_jsx("h3", { children: "\uC5ED\uD560\uC758 \uC774\uB984\uACFC \uC704\uCE58" }), _jsx("p", { children: "\uAC19\uC740 \uB808\uBCA8\uC758 \uC5ED\uD560\uC740 \uC11C\uC5F4\uC774 \uAC19\uACE0 \uB2F4\uB2F9 \uC5C5\uBB34\uB9CC \uB2E4\uB985\uB2C8\uB2E4." })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC5ED\uD560 \uC774\uB984" }), _jsx("input", { value: name, disabled: readOnly, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC5ED\uD560 \uC124\uBA85" }), _jsx("textarea", { value: description, disabled: readOnly, onChange: (event) => setDescription(event.target.value), placeholder: "\uC608: \uAC8C\uC2DC\uBB3C\uC744 \uAC80\uD1A0\uD558\uACE0 \uBC1C\uD589\uD558\uB294 \uB2F4\uB2F9\uC790" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: advanced ? "권한 레벨" : "등급" }), _jsx("select", { value: levelId, disabled: readOnly, onChange: (event) => setLevelId(event.target.value), children: [...policy.levels].sort((a, b) => b.rank - a.rank).map((level) => _jsxs("option", { value: level.id, children: [level.name, advanced ? ` · 레벨 ${level.rank}` : ""] }, level.id)) })] }), advanced && selectedLevel ? _jsxs("div", { className: styles.levelExplanation, children: [_jsxs("strong", { children: [selectedLevel.name, " \u00B7 \uB808\uBCA8 ", selectedLevel.rank] }), _jsx("span", { children: "\uC774 \uC5ED\uD560\uBCF4\uB2E4 \uB0AE\uC740 \uB808\uBCA8\uC758 \uC5ED\uD560\uB9CC \uAD00\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uB808\uBCA8\uB07C\uB9AC\uB294 \uC11C\uB85C \uB3C5\uB9BD\uC801\uC785\uB2C8\uB2E4." })] }) : null] }), _jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "2" }), _jsxs("div", { children: [_jsx("h3", { children: advanced ? "할 수 있는 일과 위임 범위" : "할 수 있는 일" }), _jsx("p", { children: advanced ? "업무별로 사용 여부와 다른 하위 역할에 넘겨줄 수 있는 범위를 선택하세요." : "이 역할이 맡을 업무를 선택하세요." })] })] }), _jsx(PermissionEditor, { permissions: visiblePermissions, selected: permissions, delegated: delegations, query: permissionQuery, technical: technicalPermissions, advanced: advanced, readOnly: readOnly, onQueryChange: setPermissionQuery, onTechnicalChange: setTechnicalPermissions, onPermissionChange: togglePermission, onDelegationChange: toggleDelegation })] }), advanced ? _jsxs("div", { className: `${styles.stack} ${styles.editorSection}`, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "3" }), _jsxs("div", { children: [_jsxs("h3", { children: ["\uD544\uB4DC \uC811\uADFC \uC81C\uD55C ", _jsx("em", { children: "\uC120\uD0DD \uC0AC\uD56D" })] }), _jsx("p", { children: "\uD2B9\uC815 \uCF58\uD150\uCE20\uC5D0\uC11C \uC77D\uAC70\uB098 \uC218\uC815\uD560 \uC218 \uC788\uB294 \uD544\uB4DC\uB9CC \uC81C\uD55C\uD560 \uB54C \uC0AC\uC6A9\uD569\uB2C8\uB2E4." })] })] }), _jsx(ScopeTreeSelector, { label: "\uC81C\uD55C\uD560 \uCF58\uD150\uCE20 \uBC94\uC704", description: "\uC81C\uD55C\uC774 \uD544\uC694\uD55C Collection \uB610\uB294 \uAC1C\uBCC4 Document\uB97C \uC120\uD0DD\uD558\uC138\uC694. \uC120\uD0DD\uD558\uC9C0 \uC54A\uC73C\uBA74 \uBCC4\uB3C4 \uD544\uB4DC \uC81C\uD55C\uC744 \uB450\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", resources: policy.resources, value: fieldResourceId, onChange: setFieldResourceId, allowEmpty: true, isDisabled: readOnly, isSelectable: ({ type }) => type === "collection" || type === "document" }), fieldResourceId ? _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uBCFC \uC218 \uC788\uB294 \uD544\uB4DC" }), _jsx("input", { value: readableFields, disabled: readOnly, onChange: (event) => setReadableFields(event.target.value), placeholder: "title, summary" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC218\uC815\uD560 \uC218 \uC788\uB294 \uD544\uB4DC" }), _jsx("input", { value: writableFields, disabled: readOnly, onChange: (event) => setWritableFields(event.target.value), placeholder: "title" })] })] }) : null] }) : null, _jsxs("div", { className: styles.formActions, children: [onDelete ? _jsx(Button, { variant: "danger", onPress: onDelete, isDisabled: isPending, children: "\uC0AD\uC81C" }) : null, _jsx(Button, { variant: "quiet", onPress: onCancel, isDisabled: isPending, children: "\uCDE8\uC18C" }), !readOnly ? _jsx(Button, { onPress: () => onSave({
                                    name: name.trim(), description: description.trim() || undefined, levelId, permissions,
                                    delegatablePermissions: delegations,
                                    fieldAccess: advanced ? (fieldResourceId ? [{ resourceId: fieldResourceId, readableFields: textList(readableFields), writableFields: textList(writableFields) }] : []) : role.fieldAccess,
                                }), isDisabled: isPending || name.trim() === "" || levelId === "", children: "\uC800\uC7A5" }) : null] })] })] }));
}
//# sourceMappingURL=roles-page.js.map