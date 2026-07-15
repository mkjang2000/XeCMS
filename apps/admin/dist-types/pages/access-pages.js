import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Badge, Button, Callout, EmptyState } from "@xecms/ui";
import styles from "../authorization.module.css";
import { AccessWorkspaceNav } from "../components/access-workspace-nav.js";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { resourcePath, ScopeTreeSelector } from "../components/resource-scope-tree.js";
import { queryKeys } from "../queries.js";
function useAuthorizationPolicy() {
    const { authorization, policyKey } = useAuthorizationWorkspace();
    return useQuery({
        queryKey: policyKey,
        queryFn: () => authorization.getPolicy(),
    });
}
function useAuthorizationWorkspace() {
    const api = useAdminApi();
    const { realmId } = useParams();
    return realmId === undefined
        ? {
            authorization: api.authorization,
            policyKey: queryKeys.authorization,
            auditKey: queryKeys.authorizationAudit,
        }
        : {
            authorization: api.identityRealms.authorizationFor(realmId),
            realmId,
            policyKey: queryKeys.realmAuthorization(realmId),
            auditKey: queryKeys.realmAuthorizationAudit(realmId),
        };
}
function PolicySummary({ policy }) {
    const items = [
        ["정책 Revision", policy.revision],
        ["권한 주체", policy.subjects.length],
        ["역할", policy.roles.length],
        ["활성 바인딩", policy.bindings.length],
    ];
    return (_jsx("div", { className: styles.summaryGrid, children: items.map(([label, value]) => (_jsxs("div", { className: styles.summaryCard, children: [_jsx("span", { children: label }), _jsx("strong", { children: value })] }, label))) }));
}
function MutationError({ error }) {
    if (error === null || error === undefined)
        return null;
    const converted = toAdminApiError(error);
    const details = converted.details;
    return (_jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: converted.message }), details?.decision?.reasonCode ? _jsxs("div", { children: ["\uD310\uC815 \uCF54\uB4DC: ", details.decision.reasonCode] }) : null] }));
}
function textList(value) {
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
function dateTimeValue(value) {
    return value === undefined ? "" : new Date(value).toISOString().slice(0, 16);
}
function optionalInstant(value) {
    return value === "" ? undefined : new Date(value).toISOString();
}
export function AccessRolesPage() {
    const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const policy = useAuthorizationPolicy();
    const [editingRole, setEditingRole] = useState(null);
    const [editingLevel, setEditingLevel] = useState(null);
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
        },
    });
    if (policy.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uAD8C\uD55C \uC815\uCC45\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: policy.error, onRetry: () => void policy.refetch() }) });
    const levels = [...policy.data.levels].sort((left, right) => right.rank - left.rank);
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "System authorization", title: "\uB808\uBCA8\uACFC \uC5ED\uD560", description: "\uC218\uC9C1 \uB808\uBCA8 \uC548\uC5D0 \uBAA9\uC801\uBCC4 \uC5ED\uD560\uC744 \uC218\uD3C9\uC73C\uB85C \uAD6C\uC131\uD569\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, {}), _jsx(PolicySummary, { policy: policy.data }), _jsxs("div", { className: styles.layout, children: [_jsx("div", { className: styles.levels, children: levels.map((level) => {
                            const roles = policy.data.roles.filter((role) => role.levelId === level.id);
                            return (_jsxs("section", { className: styles.levelCard, children: [_jsxs("div", { className: styles.levelHeader, children: [_jsxs("div", { children: [_jsx("h2", { children: level.name }), _jsx("span", { className: styles.hint, children: "\uAC19\uC740 \uB808\uBCA8\uC758 \uC5ED\uD560\uC740 \uC11C\uB85C \uB3D9\uB4F1\uD569\uB2C8\uB2E4." })] }), _jsxs("div", { className: styles.rowBetween, children: [_jsxs("span", { className: styles.rank, children: ["L", level.rank] }), !level.protected ? _jsx(Button, { size: "small", variant: "quiet", onPress: () => setEditingLevel(level), children: "\uD3B8\uC9D1" }) : _jsx(Badge, { children: "\uBCF4\uD638\uB428" })] })] }), _jsxs("div", { className: styles.roleList, children: [roles.map((role) => (_jsxs("button", { className: styles.roleCard, type: "button", onClick: () => !role.protected && setEditingRole(role), children: [_jsxs("div", { className: styles.roleHeader, children: [_jsx("h3", { children: role.name }), role.protected ? _jsx(Badge, { children: "\uBCF4\uD638\uB428" }) : null] }), _jsx("p", { className: styles.muted, children: role.description || "설명 없음" }), _jsxs("div", { className: styles.chips, children: [_jsxs("span", { className: styles.chip, children: ["\uAD8C\uD55C ", role.permissions.length] }), _jsxs("span", { className: styles.chip, children: ["\uC704\uC784 ", role.delegatablePermissions.length] }), _jsxs("span", { className: styles.chip, children: ["\uD544\uB4DC \uADDC\uCE59 ", role.fieldAccess.length] })] })] }, role.id))), _jsxs("button", { className: styles.roleCard, type: "button", onClick: () => setEditingRole({
                                                    id: "", realmId: policy.data.realmId, levelId: level.id, name: "", permissions: [],
                                                    delegatablePermissions: [], fieldAccess: [], protected: false,
                                                }), children: [_jsx("div", { className: styles.roleHeader, children: _jsx("h3", { children: "+ \uB3D9\uC77C \uB808\uBCA8 \uC5ED\uD560 \uCD94\uAC00" }) }), _jsx("p", { className: styles.muted, children: "\uC0C8 \uBAA9\uC801\uC758 \uC5ED\uD560\uC744 \uC774 \uB808\uBCA8\uC5D0 \uC218\uD3C9\uC73C\uB85C \uCD94\uAC00\uD569\uB2C8\uB2E4." })] })] })] }, level.id));
                        }) }), _jsxs("div", { className: styles.stack, children: [_jsx(LevelEditor, { level: editingLevel, onCancel: () => setEditingLevel(null), onSave: (input) => saveLevel.mutate(input), isPending: saveLevel.isPending }), _jsx(MutationError, { error: saveLevel.error }), _jsx(RoleEditor, { policy: policy.data, role: editingRole, onCancel: () => setEditingRole(null), onSave: (input) => saveRole.mutate(input), onDelete: editingRole?.id ? () => deleteRole.mutate(editingRole.id) : undefined, isPending: saveRole.isPending || deleteRole.isPending }), _jsx(MutationError, { error: saveRole.error ?? deleteRole.error })] })] })] }));
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
function RoleEditor({ policy, role, onSave, onDelete, onCancel, isPending }) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [levelId, setLevelId] = useState("");
    const [permissions, setPermissions] = useState([]);
    const [delegations, setDelegations] = useState([]);
    const [fieldResourceId, setFieldResourceId] = useState("");
    const [readableFields, setReadableFields] = useState("");
    const [writableFields, setWritableFields] = useState("");
    useEffect(() => {
        setName(role?.name ?? "");
        setDescription(role?.description ?? "");
        setLevelId(role?.levelId ?? policy.levels[0]?.id ?? "");
        setPermissions(role?.permissions ?? []);
        setDelegations(role?.delegatablePermissions ?? []);
        setFieldResourceId(role?.fieldAccess[0]?.resourceId ?? "");
        setReadableFields(role?.fieldAccess[0]?.readableFields.join(", ") ?? "");
        setWritableFields(role?.fieldAccess[0]?.writableFields.join(", ") ?? "");
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
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC5ED\uD560\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "\uC67C\uCABD \uC5ED\uD560\uC744 \uC120\uD0DD\uD558\uAC70\uB098 \uB3D9\uC77C \uB808\uBCA8 \uC5ED\uD560\uC744 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    }
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uC5ED\uD560 \uD3B8\uC9D1\uAE30", children: [_jsx(SectionHeader, { title: role.id ? "역할 편집" : "동일 레벨 역할 추가", description: "\uC0AC\uC6A9 \uAD8C\uD55C\uACFC \uD558\uC704 \uC5ED\uD560\uC5D0 \uC704\uC784\uD560 \uC218 \uC788\uB294 \uBC94\uC704\uB97C \uBD84\uB9AC\uD569\uB2C8\uB2E4." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC5ED\uD560 \uC774\uB984" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC124\uBA85" }), _jsx("textarea", { value: description, onChange: (event) => setDescription(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Authority Level" }), _jsx("select", { value: levelId, onChange: (event) => setLevelId(event.target.value), children: [...policy.levels].sort((a, b) => b.rank - a.rank).map((level) => _jsxs("option", { value: level.id, children: [level.name, " \u00B7 L", level.rank] }, level.id)) })] }), _jsxs("div", { children: [_jsxs("div", { className: styles.panelHeader, children: [_jsx("h3", { children: "Permission Matrix" }), _jsx("span", { className: styles.hint, children: "\uC704\uC784\uC740 \uC0AC\uC6A9 \uAD8C\uD55C\uC758 \uBD80\uBD84\uC9D1\uD569\uC785\uB2C8\uB2E4." })] }), _jsxs("div", { className: styles.permissionMatrix, children: [_jsxs("div", { className: styles.permissionHeader, children: [_jsx("span", { children: "\uAD8C\uD55C" }), _jsx("span", { children: "\uC0AC\uC6A9" }), _jsx("span", { children: "\uC704\uC784" })] }), policy.permissions.map((permission) => (_jsxs("div", { className: styles.permissionRow, children: [_jsxs("span", { className: styles.permissionName, children: [_jsx("code", { children: permission.key }), _jsxs("span", { children: [permission.label, " \u00B7 ", permission.category] })] }), _jsx("label", { className: styles.checkboxCell, children: _jsx("input", { "aria-label": `${permission.key} 사용`, type: "checkbox", checked: permissions.includes(permission.key), onChange: (event) => togglePermission(permission.key, event.target.checked) }) }), _jsx("label", { className: styles.checkboxCell, children: _jsx("input", { "aria-label": `${permission.key} 위임`, type: "checkbox", checked: delegations.includes(permission.key), disabled: !permissions.includes(permission.key) || !permission.delegatable || permission.protected, onChange: (event) => toggleDelegation(permission.key, event.target.checked) }) })] }, permission.key)))] })] }), _jsxs("div", { className: styles.stack, children: [_jsxs("div", { className: styles.panelHeader, children: [_jsx("h3", { children: "\uD544\uB4DC \uC811\uADFC \uC81C\uD55C" }), _jsx("span", { className: styles.hint, children: "\uBE44\uC6CC \uB450\uBA74 \uD574\uB2F9 \uB9AC\uC18C\uC2A4\uC758 \uBAA8\uB4E0 \uD544\uB4DC\uB97C \uD5C8\uC6A9\uD569\uB2C8\uB2E4." })] }), _jsx(ScopeTreeSelector, { label: "\uD544\uB4DC \uC811\uADFC Scope", description: "Collection \uB610\uB294 \uAC1C\uBCC4 Document\uB97C \uC120\uD0DD\uD558\uC138\uC694. \uC0C1\uC704 \uC601\uC5ED\uC740 \uC704\uCE58\uB97C \uC124\uBA85\uD558\uAE30 \uC704\uD574 \uD568\uAED8 \uD45C\uC2DC\uB429\uB2C8\uB2E4.", resources: policy.resources, value: fieldResourceId, onChange: setFieldResourceId, allowEmpty: true, isSelectable: ({ type }) => type === "collection" || type === "document" }), fieldResourceId ? _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC77D\uAE30 \uD5C8\uC6A9 \uD544\uB4DC" }), _jsx("input", { value: readableFields, onChange: (event) => setReadableFields(event.target.value), placeholder: "title, summary" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC4F0\uAE30 \uD5C8\uC6A9 \uD544\uB4DC" }), _jsx("input", { value: writableFields, onChange: (event) => setWritableFields(event.target.value), placeholder: "title" })] })] }) : null] }), _jsxs("div", { className: styles.formActions, children: [onDelete ? _jsx(Button, { variant: "danger", onPress: onDelete, isDisabled: isPending, children: "\uC0AD\uC81C" }) : null, _jsx(Button, { variant: "quiet", onPress: onCancel, isDisabled: isPending, children: "\uCDE8\uC18C" }), _jsx(Button, { onPress: () => onSave({
                                    name: name.trim(), description: description.trim() || undefined, levelId, permissions,
                                    delegatablePermissions: delegations,
                                    fieldAccess: fieldResourceId ? [{ resourceId: fieldResourceId, readableFields: textList(readableFields), writableFields: textList(writableFields) }] : [],
                                }), isDisabled: isPending || name.trim() === "" || levelId === "", children: "\uC800\uC7A5" })] })] })] }));
}
export function AccessBindingsPage() {
    const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const policy = useAuthorizationPolicy();
    const [subjectName, setSubjectName] = useState("");
    const [subjectType, setSubjectType] = useState("user");
    const [memberId, setMemberId] = useState("");
    const [groupId, setGroupId] = useState("");
    const [editingBinding, setEditingBinding] = useState(null);
    const updatePolicy = (next) => queryClient.setQueryData(policyKey, next);
    const createSubject = useMutation({
        mutationFn: () => authorization.createSubject({ expectedPolicyRevision: policy.data.revision, type: subjectType, name: subjectName.trim() }),
        onSuccess: (next) => { updatePolicy(next); setSubjectName(""); },
    });
    const addMembership = useMutation({
        mutationFn: () => authorization.addGroupMembership({ expectedPolicyRevision: policy.data.revision, memberSubjectId: memberId, groupSubjectId: groupId }),
        onSuccess: updatePolicy,
    });
    const saveBinding = useMutation({
        mutationFn: (input) => editingBinding?.id
            ? authorization.updateBinding(editingBinding.id, { ...input, expectedPolicyRevision: policy.data.revision })
            : authorization.createBinding({ ...input, expectedPolicyRevision: policy.data.revision }),
        onSuccess: (next) => { updatePolicy(next); setEditingBinding(null); },
    });
    const deleteBinding = useMutation({
        mutationFn: (id) => authorization.deleteBinding(id, policy.data.revision),
        onSuccess: (next) => { updatePolicy(next); setEditingBinding(null); },
    });
    if (policy.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uBC14\uC778\uB529\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: policy.error, onRetry: () => void policy.refetch() }) });
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "System authorization", title: "\uC8FC\uCCB4\uC640 \uC5ED\uD560 \uBC14\uC778\uB529", description: "\uB204\uAC00 \uC5B4\uB5A4 \uC5ED\uD560\uC744 \uC5B4\uB290 \uB9AC\uC18C\uC2A4 \uBC94\uC704\uC5D0\uC11C \uD589\uC0AC\uD558\uB294\uC9C0 \uC5F0\uACB0\uD569\uB2C8\uB2E4.", actions: _jsx(Button, { onPress: () => setEditingBinding(emptyBinding(policy.data)), children: "\uC0C8 \uBC14\uC778\uB529" }) }), _jsx(AccessWorkspaceNav, {}), _jsx(PolicySummary, { policy: policy.data }), _jsxs("div", { className: styles.layout, children: [_jsxs("div", { className: styles.stack, children: [_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uC5ED\uD560 \uBC14\uC778\uB529", description: "\uAE30\uAC04\u00B7\uC18C\uC720\uC790\u00B7\uC0C1\uD0DC \uC870\uAC74\uC740 \uBAA8\uB4E0 \uC870\uAC74\uC744 \uB9CC\uC871\uD560 \uB54C\uB9CC \uC801\uC6A9\uB429\uB2C8\uB2E4." }), policy.data.bindings.length === 0 ? _jsx(EmptyState, { title: "\uBC14\uC778\uB529\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uAD8C\uD55C \uC8FC\uCCB4\uC5D0 \uC5ED\uD560\uACFC Scope\uB97C \uC5F0\uACB0\uD558\uC138\uC694." }) : _jsx(BindingTable, { policy: policy.data, onEdit: setEditingBinding })] }), _jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uC911\uCCA9 \uADF8\uB8F9", description: "\uADF8\uB8F9\uC744 \uD1B5\uD55C \uAD8C\uD55C \uC0C1\uC18D \uACBD\uB85C\uB294 \uD310\uC815 \uC124\uBA85\uC5D0 \uADF8\uB300\uB85C \uAE30\uB85D\uB429\uB2C8\uB2E4." }), _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uBA64\uBC84" }), _jsxs("select", { value: memberId, onChange: (event) => setMemberId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.data.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC0C1\uC704 \uADF8\uB8F9" }), _jsxs("select", { value: groupId, onChange: (event) => setGroupId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.data.subjects.filter(({ type }) => type === "group").map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] })] }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { onPress: () => addMembership.mutate(), isDisabled: !memberId || !groupId || addMembership.isPending, children: "\uADF8\uB8F9\uC5D0 \uCD94\uAC00" }) }), _jsx("div", { className: styles.chips, children: policy.data.groupMemberships.map((membership) => _jsxs("span", { className: styles.chip, children: [subjectNameOf(policy.data, membership.memberSubjectId), " \u2192 ", subjectNameOf(policy.data, membership.groupSubjectId)] }, `${membership.memberSubjectId}:${membership.groupSubjectId}`)) })] })] }), _jsxs("div", { className: styles.stack, children: [_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uAD8C\uD55C \uC8FC\uCCB4 \uCD94\uAC00", description: "M3\uC5D0\uC11C\uB294 \uC0AC\uC6A9\uC790, \uADF8\uB8F9, \uC11C\uBE44\uC2A4 \uACC4\uC815\uC744 \uB3D9\uC77C\uD55C Subject\uB85C \uB2E4\uB8F9\uB2C8\uB2E4." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC720\uD615" }), _jsxs("select", { value: subjectType, onChange: (event) => setSubjectType(event.target.value), children: [_jsx("option", { value: "user", children: "\uC0AC\uC6A9\uC790" }), _jsx("option", { value: "group", children: "\uADF8\uB8F9" }), _jsx("option", { value: "service-account", children: "\uC11C\uBE44\uC2A4 \uACC4\uC815" })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD45C\uC2DC \uC774\uB984" }), _jsx("input", { value: subjectName, onChange: (event) => setSubjectName(event.target.value) })] }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { onPress: () => createSubject.mutate(), isDisabled: !subjectName.trim() || createSubject.isPending, children: "\uCD94\uAC00" }) })] })] }), _jsx(BindingEditor, { policy: policy.data, binding: editingBinding, onCancel: () => setEditingBinding(null), onSave: (input) => saveBinding.mutate(input), onDelete: editingBinding?.id ? () => deleteBinding.mutate(editingBinding.id) : undefined, isPending: saveBinding.isPending || deleteBinding.isPending }), _jsx(MutationError, { error: createSubject.error ?? addMembership.error ?? saveBinding.error ?? deleteBinding.error })] })] })] }));
}
function emptyBinding(policy) {
    return { id: "", realmId: policy.realmId, subjectId: "", roleId: "", resourceId: policy.resources[0]?.id ?? "", propagation: "self", protected: false };
}
function subjectNameOf(policy, id) {
    return policy.subjects.find((subject) => subject.id === id)?.name ?? id;
}
function roleNameOf(policy, id) {
    return policy.roles.find((role) => role.id === id)?.name ?? id;
}
function resourceNameOf(policy, id) {
    return policy.resources.find((resource) => resource.id === id)?.name ?? id;
}
function resourcePathOf(policy, id) {
    const path = resourcePath(policy.resources, id);
    return path.length > 0 ? path.map(({ name }) => name).join(" / ") : id;
}
function propagationLabel(propagation) {
    switch (propagation) {
        case "self": return "현재 리소스";
        case "children": return "모든 하위";
        case "self-and-children": return "현재 및 모든 하위";
    }
}
function BindingTable({ policy, onEdit }) {
    return _jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Subject" }), _jsx("th", { children: "Role" }), _jsx("th", { children: "Scope" }), _jsx("th", { children: "\uC804\uD30C" }), _jsx("th", { children: "\uC870\uAC74" }), _jsx("th", {})] }) }), _jsx("tbody", { children: policy.bindings.map((binding) => _jsxs("tr", { children: [_jsx("td", { children: subjectNameOf(policy, binding.subjectId) }), _jsx("td", { children: roleNameOf(policy, binding.roleId) }), _jsx("td", { title: binding.resourceId, children: resourcePathOf(policy, binding.resourceId) }), _jsx("td", { children: propagationLabel(binding.propagation) }), _jsx("td", { children: binding.constraints ? "조건부" : "없음" }), _jsx("td", { children: binding.protected ? _jsx(Badge, { children: "\uBCF4\uD638\uB428" }) : _jsx(Button, { size: "small", variant: "quiet", onPress: () => onEdit(binding), children: "\uD3B8\uC9D1" }) })] }, binding.id)) })] }) });
}
function BindingEditor({ policy, binding, onSave, onDelete, onCancel, isPending }) {
    const [subjectId, setSubjectId] = useState("");
    const [roleId, setRoleId] = useState("");
    const [resourceId, setResourceId] = useState("");
    const [propagation, setPropagation] = useState("self");
    const [validFrom, setValidFrom] = useState("");
    const [validUntil, setValidUntil] = useState("");
    const [ownerSubjectId, setOwnerSubjectId] = useState("");
    const [statuses, setStatuses] = useState("");
    useEffect(() => {
        setSubjectId(binding?.subjectId ?? "");
        setRoleId(binding?.roleId ?? "");
        setResourceId(binding?.resourceId ?? policy.resources[0]?.id ?? "");
        setPropagation(binding?.propagation ?? "self");
        setValidFrom(dateTimeValue(binding?.validFrom));
        setValidUntil(dateTimeValue(binding?.validUntil));
        setOwnerSubjectId(binding?.constraints?.ownerSubjectId ?? "");
        setStatuses(binding?.constraints?.statuses?.join(", ") ?? "");
    }, [binding, policy.resources]);
    if (binding === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uBC14\uC778\uB529\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "\uC0C8 \uBC14\uC778\uB529\uC744 \uB9CC\uB4E4\uAC70\uB098 \uAE30\uC874 \uD56D\uBAA9\uC744 \uD3B8\uC9D1\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    const statusValues = textList(statuses);
    return _jsxs("section", { className: styles.panel, "aria-label": "\uC5ED\uD560 \uBC14\uC778\uB529 \uD3B8\uC9D1\uAE30", children: [_jsx(SectionHeader, { title: binding.id ? "바인딩 편집" : "새 역할 바인딩" }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Subject" }), _jsxs("select", { value: subjectId, onChange: (event) => setSubjectId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.subjects.filter(({ protected: itemProtected }) => !itemProtected).map((subject) => _jsxs("option", { value: subject.id, children: [subject.name, " \u00B7 ", subject.type] }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Role" }), _jsxs("select", { value: roleId, onChange: (event) => setRoleId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.roles.filter(({ protected: itemProtected }) => !itemProtected).map((role) => _jsx("option", { value: role.id, children: role.name }, role.id))] })] }), _jsx(ScopeTreeSelector, { label: "Resource Scope", description: "parentId \uACC4\uCE35\uC744 \uB530\uB77C Collection\uACFC Document\uC758 \uC2E4\uC81C \uC704\uCE58\uB97C \uD655\uC778\uD55C \uB4A4 \uBC94\uC704\uB97C \uC120\uD0DD\uD558\uC138\uC694.", resources: policy.resources, value: resourceId, onChange: setResourceId, propagation: propagation, onPropagationChange: setPropagation }), _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC720\uD6A8 \uC2DC\uC791" }), _jsx("input", { type: "datetime-local", value: validFrom, onChange: (event) => setValidFrom(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC720\uD6A8 \uC885\uB8CC" }), _jsx("input", { type: "datetime-local", value: validUntil, onChange: (event) => setValidUntil(event.target.value) })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC18C\uC720\uC790 \uC870\uAC74" }), _jsxs("select", { value: ownerSubjectId, onChange: (event) => setOwnerSubjectId(event.target.value), children: [_jsx("option", { value: "", children: "\uC81C\uD55C \uC5C6\uC74C" }), policy.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC0C1\uD0DC \uC870\uAC74" }), _jsx("input", { value: statuses, onChange: (event) => setStatuses(event.target.value), placeholder: "draft, rejected" })] }), _jsxs("div", { className: styles.formActions, children: [onDelete ? _jsx(Button, { variant: "danger", onPress: onDelete, children: "\uC0AD\uC81C" }) : null, _jsx(Button, { variant: "quiet", onPress: onCancel, children: "\uCDE8\uC18C" }), _jsx(Button, { onPress: () => onSave({ subjectId, roleId, resourceId, propagation, validFrom: optionalInstant(validFrom), validUntil: optionalInstant(validUntil), constraints: ownerSubjectId || statusValues.length ? { ownerSubjectId: ownerSubjectId || undefined, statuses: statusValues.length ? statusValues : undefined } : undefined }), isDisabled: isPending || !subjectId || !roleId || !resourceId, children: "\uC800\uC7A5" })] })] })] });
}
export function AccessSimulatorPage() {
    const { authorization, realmId } = useAuthorizationWorkspace();
    const policy = useAuthorizationPolicy();
    const [subjectId, setSubjectId] = useState("");
    const [action, setAction] = useState("");
    const [resourceId, setResourceId] = useState("");
    const [ownerSubjectId, setOwnerSubjectId] = useState("");
    const [status, setStatus] = useState("");
    const simulation = useMutation({ mutationFn: () => authorization.simulate({ subjectId, action, resourceId, context: ownerSubjectId || status ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined } : undefined }) });
    const effectivePermissions = useMutation({
        mutationFn: async () => Promise.all(policy.data.permissions.map(async (permission) => ({
            permission,
            decision: await authorization.simulate({
                subjectId,
                action: permission.key,
                resourceId,
                context: ownerSubjectId || status
                    ? { ownerSubjectId: ownerSubjectId || undefined, status: status || undefined }
                    : undefined,
            }),
        }))),
    });
    if (policy.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uC2DC\uBBAC\uB808\uC774\uD130\uB97C \uC900\uBE44\uD558\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: policy.error, onRetry: () => void policy.refetch() }) });
    const resetResults = () => {
        simulation.reset();
        effectivePermissions.reset();
    };
    return _jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "Explainable authorization", title: "\uAD8C\uD55C \uC2DC\uBBAC\uB808\uC774\uD130", description: "\uAC1C\uBCC4 \uD310\uC815\uACFC \uC0AC\uC6A9\uC790\uBCC4 \uC804\uCCB4 Effective Permission\uC744 \uC2E4\uC81C API\uC640 \uAC19\uC740 \uC815\uCC45 snapshot\uC73C\uB85C \uC870\uD68C\uD569\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, {}), _jsxs("div", { className: styles.layout, children: [_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uD310\uC815 \uC870\uAC74" }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Subject" }), _jsxs("select", { value: subjectId, onChange: (event) => { setSubjectId(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.data.subjects.map((subject) => _jsxs("option", { value: subject.id, children: [subject.name, " \u00B7 ", subject.type] }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "Action" }), _jsxs("select", { value: action, onChange: (event) => setAction(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.data.permissions.map((permission) => _jsxs("option", { value: permission.key, children: [permission.key, " \u00B7 ", permission.label] }, permission.key))] })] }), _jsx(ScopeTreeSelector, { label: "Resource", description: "\uD310\uC815\uD560 Collection \uB610\uB294 Document\uC758 \uC2E4\uC81C \uACC4\uCE35 \uC704\uCE58\uB97C \uC120\uD0DD\uD558\uC138\uC694.", resources: policy.data.resources, value: resourceId, onChange: (next) => { setResourceId(next); resetResults(); } }), _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC18C\uC720\uC790 Context" }), _jsxs("select", { value: ownerSubjectId, onChange: (event) => { setOwnerSubjectId(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC5C6\uC74C" }), policy.data.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC0C1\uD0DC Context" }), _jsx("input", { value: status, onChange: (event) => { setStatus(event.target.value); resetResults(); }, placeholder: "draft" })] })] }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { variant: "secondary", onPress: () => effectivePermissions.mutate(), isDisabled: !subjectId || !resourceId || effectivePermissions.isPending, children: effectivePermissions.isPending ? "전체 조회 중…" : "전체 유효 권한 조회" }), _jsx(Button, { onPress: () => simulation.mutate(), isDisabled: !subjectId || !action || !resourceId || simulation.isPending, children: simulation.isPending ? "판정 중…" : "선택 권한 판정" })] }), _jsx(MutationError, { error: simulation.error ?? effectivePermissions.error })] })] }), _jsxs("div", { className: styles.stack, children: [_jsx(DecisionExplanation, { policy: policy.data, decision: simulation.data ?? null }), _jsx(EffectivePermissionList, { policy: policy.data, results: effectivePermissions.data ?? null })] })] })] });
}
function EffectivePermissionList({ policy, results, }) {
    if (results === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC804\uCCB4 \uC720\uD6A8 \uAD8C\uD55C", description: "Subject\uC640 Resource\uB97C \uC120\uD0DD\uD55C \uB4A4 \uC804\uCCB4 \uC720\uD6A8 \uAD8C\uD55C \uC870\uD68C\uB97C \uC2E4\uD589\uD558\uC138\uC694." }) });
    const sorted = [...results].sort((left, right) => Number(right.decision.allowed) - Number(left.decision.allowed));
    const allowedCount = results.filter(({ decision }) => decision.allowed).length;
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uC0AC\uC6A9\uC790\uBCC4 Effective Permission", "aria-live": "polite", children: [_jsxs("div", { className: styles.panelHeader, children: [_jsxs("div", { children: [_jsx("h2", { children: "\uC804\uCCB4 \uC720\uD6A8 \uAD8C\uD55C" }), _jsx("span", { className: styles.hint, children: resourcePathOf(policy, results[0]?.decision.resourceId ?? "") })] }), _jsxs(Badge, { tone: allowedCount > 0 ? "success" : "neutral", children: [allowedCount, "/", results.length, " \uD5C8\uC6A9"] })] }), _jsx("div", { className: styles.effectiveList, children: sorted.map(({ permission, decision }) => (_jsxs("article", { className: styles.effectiveItem, "data-allowed": decision.allowed, children: [_jsxs("div", { children: [_jsx("strong", { children: permission.label }), _jsx("code", { children: permission.key })] }), _jsx(Badge, { tone: decision.allowed ? "success" : "danger", children: decision.allowed ? "Allowed" : "Denied" }), _jsx("span", { children: decision.reasonCode })] }, permission.key))) })] }));
}
function DecisionExplanation({ policy, decision }) {
    if (decision === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uD310\uC815 \uC870\uAC74\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "\uD5C8\uC6A9 \uC5EC\uBD80\uBFD0 \uC544\uB2C8\uB77C Role, Level, Binding\uACFC \uADF8\uB8F9 \uACBD\uB85C\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    return _jsxs("section", { className: styles.decisionCard, "data-allowed": decision.allowed, children: [_jsxs("div", { className: styles.decisionTitle, children: [_jsx(Badge, { tone: decision.allowed ? "success" : "danger", children: decision.allowed ? "Allowed" : "Denied" }), _jsx("strong", { children: decision.reasonCode })] }), _jsxs("div", { className: styles.auditMeta, children: [_jsxs("span", { children: ["Action ", decision.action] }), _jsxs("span", { children: ["Policy r", decision.policyRevision] }), decision.actorLevel === undefined ? null : _jsxs("span", { children: ["Actor L", decision.actorLevel] })] }), _jsx("div", { className: styles.grantList, children: decision.matchedGrants.map((grant) => _jsxs("div", { className: styles.grant, children: [_jsxs("strong", { children: [roleNameOf(policy, grant.sourceRoleId), " \u00B7 L", grant.sourceRank] }), _jsxs("span", { children: [resourceNameOf(policy, grant.sourceResourceId), " \u00B7 ", grant.sourcePropagation] }), _jsxs("span", { children: ["Binding ", grant.sourceBindingId] }), grant.membershipPath.length ? _jsxs("span", { children: ["\uADF8\uB8F9 \uACBD\uB85C: ", grant.membershipPath.map((id) => subjectNameOf(policy, id)).join(" → ")] }) : _jsx("span", { children: "\uC9C1\uC811 \uBD80\uC5EC" })] }, `${grant.sourceBindingId}:${grant.permission}`)) })] });
}
export function AccessAuditPage() {
    const { authorization, auditKey, realmId } = useAuthorizationWorkspace();
    const policy = useAuthorizationPolicy();
    const audit = useQuery({ queryKey: auditKey, queryFn: () => authorization.listAudit() });
    if (policy.isPending || audit.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uAC10\uC0AC \uB85C\uADF8\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (policy.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: policy.error, onRetry: () => void policy.refetch() }) });
    if (audit.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: audit.error, onRetry: () => void audit.refetch() }) });
    return _jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm audit" : "Security audit", title: "\uC815\uCC45 \uBCC0\uACBD \uAC10\uC0AC", description: "\uC815\uCC45 \uAD6C\uC870 \uBCC0\uACBD\uC758 actor, target, before/after\uC640 \uD310\uC815 \uADFC\uAC70\uB97C \uBCF4\uC874\uD569\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, {}), audit.data.items.length === 0 ? _jsx(EmptyState, { title: "\uAC10\uC0AC \uC774\uBCA4\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC5ED\uD560\uC774\uB098 \uBC14\uC778\uB529\uC744 \uBCC0\uACBD\uD558\uBA74 \uC774\uACF3\uC5D0 \uAE30\uB85D\uB429\uB2C8\uB2E4." }) : _jsx("div", { className: styles.auditList, children: audit.data.items.map((entry) => _jsxs("article", { className: styles.auditItem, children: [_jsxs("div", { className: styles.rowBetween, children: [_jsxs("div", { children: [_jsx("strong", { children: entry.action }), _jsxs("div", { className: styles.hint, children: [entry.targetType, " \u00B7 ", entry.targetId] })] }), _jsxs(Badge, { children: ["r", entry.policyRevision] })] }), _jsxs("div", { className: styles.auditMeta, children: [_jsx("span", { children: new Date(entry.occurredAt).toLocaleString("ko-KR") }), _jsxs("span", { children: ["Actor ", subjectNameOf(policy.data, entry.actorSubjectId)] }), _jsx("span", { children: entry.decision?.reasonCode ?? "BOOTSTRAP" })] }), _jsxs("details", { children: [_jsx("summary", { children: "\uBCC0\uACBD \uC804\uD6C4 \uBCF4\uAE30" }), _jsxs("div", { className: styles.diff, children: [_jsx("pre", { children: JSON.stringify(entry.before, null, 2) }), _jsx("pre", { children: JSON.stringify(entry.after, null, 2) })] })] })] }, entry.id)) })] });
}
//# sourceMappingURL=access-pages.js.map