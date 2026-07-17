import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
        ["사용자·그룹", policy.subjects.length],
        ["역할", policy.roles.length],
        ["역할 배정", policy.bindings.length],
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
const permissionCategoryNames = {
    authorization: "권한 정책",
    content: "콘텐츠",
    schema: "스키마",
    identity: "사용자",
    "service-account": "서비스 계정",
    group: "그룹",
    role: "역할",
    "authority-level": "권한 레벨",
    media: "미디어",
    plugin: "플러그인",
    job: "백그라운드 작업",
    audit: "감사 로그",
    retention: "데이터 보존",
    "api-key": "API 키",
    system: "시스템 설정",
    site: "사이트",
    "admin-app": "Admin App",
};
const permissionObjectNames = {
    authorization: "권한 정책",
    content: "콘텐츠",
    revision: "버전",
    schema: "스키마",
    identity: "사용자",
    credentials: "인증 정보",
    session: "세션",
    owner: "소유자",
    "system-membership": "시스템 계정 연결",
    "service-account": "서비스 계정",
    group: "그룹",
    member: "구성원",
    role: "역할",
    "authority-level": "권한 레벨",
    media: "미디어",
    plugin: "플러그인",
    job: "백그라운드 작업",
    audit: "감사 로그",
    retention: "데이터 보존 정책",
    consistency: "무결성 검사",
    "api-key": "API 키",
    system: "시스템",
    settings: "설정",
    site: "사이트",
    collection: "컬렉션",
    "admin-app": "Admin App",
};
const permissionVerbNames = {
    list: "목록 보기",
    read: "보기",
    create: "만들기",
    update: "수정",
    delete: "삭제",
    purge: "영구 삭제",
    publish: "게시",
    unpublish: "게시 취소",
    archive: "보관",
    restore: "복원",
    reset: "재설정",
    revoke: "폐기",
    transfer: "이전",
    install: "설치",
    configure: "설정",
    enable: "활성화",
    disable: "비활성화",
    uninstall: "제거",
    retry: "재시도",
    export: "내보내기",
    preview: "미리보기",
    apply: "적용",
    upload: "업로드",
    bind: "연결",
    assign: "배정",
    reorder: "순서 변경",
    manage: "관리",
    access: "접근",
};
function permissionCategoryName(category) {
    return permissionCategoryNames[category] ?? category;
}
function permissionTaskName(key) {
    const parts = key.split(".");
    const operation = parts.pop() ?? key;
    const object = parts.map((part) => permissionObjectNames[part] ?? part).join(" · ");
    return `${object} ${permissionVerbNames[operation] ?? operation}`;
}
function subjectTypeName(type) {
    switch (type) {
        case "user": return "사용자";
        case "group": return "그룹";
        case "service-account": return "서비스 계정";
    }
}
export function AccessRolesPage() {
    const { authorization, policyKey, realmId } = useAuthorizationWorkspace();
    const queryClient = useQueryClient();
    const policy = useAuthorizationPolicy();
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
        return _jsx(Page, { children: _jsx(LoadError, { error: policy.error, onRetry: () => void policy.refetch() }) });
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
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "System authorization", title: "\uB808\uBCA8\uACFC \uC5ED\uD560", description: "\uC704\uCABD \uB808\uBCA8\uC774 \uC544\uB798\uCABD \uC5ED\uD560\uC744 \uAD00\uB9AC\uD569\uB2C8\uB2E4. \uAC19\uC740 \uB808\uBCA8\uC5D0\uC11C\uB294 \uCC45\uC784\uB9CC \uB098\uB204\uACE0 \uC11C\uB85C\uB97C \uAD00\uB9AC\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", actions: _jsx(Button, { onPress: () => selectLevel(null), children: "\uC0C8 \uB808\uBCA8" }) }), _jsx(AccessWorkspaceNav, {}), _jsxs("div", { className: styles.guideBanner, children: [_jsx("span", { className: styles.guideNumber, children: "1" }), _jsxs("div", { children: [_jsx("strong", { children: "\uBA3C\uC800 \uAD00\uB9AC \uC11C\uC5F4\uC744 \uC815\uD558\uACE0, \uAC19\uC740 \uB192\uC774\uC5D0 \uD544\uC694\uD55C \uC5ED\uD560\uC744 \uB098\uB204\uC138\uC694." }), _jsx("p", { children: "\uC5ED\uD560\uC744 \uC120\uD0DD\uD558\uBA74 \uC624\uB978\uCABD\uC5D0\uC11C \uC2E4\uC81C \uC5C5\uBB34\uC640 \uC704\uC784 \uBC94\uC704\uB97C \uC124\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })] })] }), _jsx(PolicySummary, { policy: policy.data }), _jsxs("div", { className: `${styles.layout} ${styles.rolesLayout}`, children: [_jsx("div", { className: styles.levels, children: levels.map((level) => {
                            const roles = policy.data.roles.filter((role) => role.levelId === level.id);
                            return (_jsxs("section", { className: styles.levelCard, children: [_jsxs("div", { className: styles.levelHeader, children: [_jsxs("div", { className: styles.levelIdentity, children: [_jsxs("span", { className: styles.rank, children: ["L", level.rank] }), _jsxs("div", { children: [_jsx("h2", { children: level.name }), _jsxs("span", { className: styles.hint, children: ["\uAD8C\uD55C \uB808\uBCA8 ", level.rank, " \u00B7 \uAC19\uC740 \uB192\uC774\uC758 \uC5ED\uD560 ", roles.length, "\uAC1C"] })] })] }), _jsxs("div", { className: styles.levelActions, children: [_jsx(Button, { size: "small", variant: "secondary", onPress: () => createRoleAt(level), children: "\uB3D9\uC77C \uB808\uBCA8 \uC5ED\uD560 \uCD94\uAC00" }), !level.protected
                                                        ? _jsx(Button, { size: "small", variant: "quiet", onPress: () => selectLevel(level), children: "\uB808\uBCA8 \uD3B8\uC9D1" })
                                                        : _jsx(Badge, { children: "\uBCF4\uD638\uB428" })] })] }), _jsxs("div", { className: styles.roleList, children: [roles.map((role) => (_jsxs("button", { className: styles.roleCard, type: "button", "data-selected": editingRole?.id === role.id, "aria-pressed": editingRole?.id === role.id, onClick: () => selectRole(role), children: [_jsxs("div", { className: styles.roleSummary, children: [_jsxs("div", { className: styles.roleHeader, children: [_jsx("h3", { children: role.name }), role.protected ? _jsx(Badge, { children: "\uBCF4\uD638\uB428" }) : null] }), _jsx("p", { className: styles.muted, children: role.description || "설명이 아직 없습니다." })] }), _jsxs("div", { className: styles.roleStats, children: [_jsxs("span", { className: styles.chip, children: ["\uAD8C\uD55C ", role.permissions.length] }), _jsxs("span", { className: styles.chip, children: ["\uC704\uC784 ", role.delegatablePermissions.length] }), _jsxs("span", { className: styles.chip, children: ["\uD544\uB4DC \uADDC\uCE59 ", role.fieldAccess.length] })] }), _jsx("span", { className: styles.roleChevron, "aria-hidden": "true", children: "\u203A" })] }, role.id))), roles.length === 0 ? (_jsxs("div", { className: styles.emptyRoleRow, children: [_jsx("span", { children: "\uC544\uC9C1 \uC5ED\uD560\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }), _jsx(Button, { size: "small", variant: "quiet", onPress: () => createRoleAt(level), children: "\uCCAB \uC5ED\uD560 \uCD94\uAC00" })] })) : null] })] }, level.id));
                        }) }), inspectorOpen ? _jsx("button", { className: styles.drawerBackdrop, type: "button", "aria-label": "\uD3B8\uC9D1 \uD328\uB110 \uB2EB\uAE30", onClick: closeInspector }) : null, _jsxs("div", { className: styles.detailPane, "data-open": inspectorOpen, children: [inspectorOpen ? _jsxs("div", { className: styles.drawerHeader, children: [_jsx("strong", { children: levelEditorOpen ? editingLevel ? "레벨 편집" : "새 레벨" : editingRole?.name || "새 역할" }), _jsx(Button, { size: "small", variant: "quiet", onPress: closeInspector, children: "\uB2EB\uAE30" })] }) : null, levelEditorOpen ? (_jsxs(_Fragment, { children: [_jsx(LevelEditor, { level: editingLevel, onCancel: closeInspector, onSave: (input) => saveLevel.mutate(input), isPending: saveLevel.isPending }), _jsx(MutationError, { error: saveLevel.error })] })) : (_jsxs(_Fragment, { children: [_jsx(RoleEditor, { policy: policy.data, role: editingRole, onCancel: () => setEditingRole(null), onSave: (input) => saveRole.mutate(input), onDelete: editingRole?.id && !editingRole.protected ? () => deleteRole.mutate(editingRole.id) : undefined, isPending: saveRole.isPending || deleteRole.isPending }), _jsx(MutationError, { error: saveRole.error ?? deleteRole.error })] }))] })] })] }));
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
    const readOnly = role.protected;
    const availablePermissions = readOnly
        ? policy.permissions
        : policy.permissions.filter((permission) => permission.delegatable && !permission.protected);
    const normalizedQuery = permissionQuery.trim().toLocaleLowerCase();
    const visiblePermissions = normalizedQuery === ""
        ? availablePermissions
        : availablePermissions.filter((permission) => `${permission.key} ${permission.label} ${permission.category}`.toLocaleLowerCase().includes(normalizedQuery));
    const selectedLevel = policy.levels.find((level) => level.id === levelId);
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uC5ED\uD560 \uD3B8\uC9D1\uAE30", children: [_jsx(SectionHeader, { title: readOnly ? "보호 역할 상세" : role.id ? "역할 편집" : "동일 레벨 역할 추가", description: readOnly ? "시스템 보호 역할은 구성을 확인할 수 있지만 수정할 수 없습니다." : "사용 권한과 하위 역할에 위임할 수 있는 범위를 분리합니다.", actions: readOnly ? _jsx(Badge, { children: "\uC77D\uAE30 \uC804\uC6A9" }) : undefined }), readOnly ? _jsx(Callout, { tone: "info", children: "\uC774 \uC5ED\uD560\uC740 \uC2DC\uC2A4\uD15C \uB3D9\uC791\uC5D0 \uD544\uC694\uD558\uBBC0\uB85C \uC774\uB984, \uB808\uBCA8, \uAD8C\uD55C \uAD6C\uC131\uC774 \uBCF4\uD638\uB429\uB2C8\uB2E4." }) : null, _jsxs("div", { className: styles.form, children: [_jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "1" }), _jsxs("div", { children: [_jsx("h3", { children: "\uC5ED\uD560\uC758 \uC774\uB984\uACFC \uC704\uCE58" }), _jsx("p", { children: "\uAC19\uC740 \uB808\uBCA8\uC758 \uC5ED\uD560\uC740 \uC11C\uC5F4\uC774 \uAC19\uACE0 \uB2F4\uB2F9 \uC5C5\uBB34\uB9CC \uB2E4\uB985\uB2C8\uB2E4." })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC5ED\uD560 \uC774\uB984" }), _jsx("input", { value: name, disabled: readOnly, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC5ED\uD560 \uC124\uBA85" }), _jsx("textarea", { value: description, disabled: readOnly, onChange: (event) => setDescription(event.target.value), placeholder: "\uC608: \uAC8C\uC2DC\uBB3C\uC744 \uAC80\uD1A0\uD558\uACE0 \uBC1C\uD589\uD558\uB294 \uB2F4\uB2F9\uC790" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uAD8C\uD55C \uB808\uBCA8" }), _jsx("select", { value: levelId, disabled: readOnly, onChange: (event) => setLevelId(event.target.value), children: [...policy.levels].sort((a, b) => b.rank - a.rank).map((level) => _jsxs("option", { value: level.id, children: [level.name, " \u00B7 \uB808\uBCA8 ", level.rank] }, level.id)) })] }), selectedLevel ? _jsxs("div", { className: styles.levelExplanation, children: [_jsxs("strong", { children: [selectedLevel.name, " \u00B7 \uB808\uBCA8 ", selectedLevel.rank] }), _jsx("span", { children: "\uC774 \uC5ED\uD560\uBCF4\uB2E4 \uB0AE\uC740 \uB808\uBCA8\uC758 \uC5ED\uD560\uB9CC \uAD00\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uAC19\uC740 \uB808\uBCA8\uB07C\uB9AC\uB294 \uC11C\uB85C \uB3C5\uB9BD\uC801\uC785\uB2C8\uB2E4." })] }) : null] }), _jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "2" }), _jsxs("div", { children: [_jsx("h3", { children: "\uD560 \uC218 \uC788\uB294 \uC77C\uACFC \uC704\uC784 \uBC94\uC704" }), _jsx("p", { children: "\uC5C5\uBB34\uBCC4\uB85C \uC0AC\uC6A9 \uC5EC\uBD80\uC640 \uB2E4\uB978 \uD558\uC704 \uC5ED\uD560\uC5D0 \uB118\uACA8\uC904 \uC218 \uC788\uB294 \uBC94\uC704\uB97C \uC120\uD0DD\uD558\uC138\uC694." })] })] }), _jsx(PermissionEditor, { permissions: visiblePermissions, selected: permissions, delegated: delegations, query: permissionQuery, technical: technicalPermissions, readOnly: readOnly, onQueryChange: setPermissionQuery, onTechnicalChange: setTechnicalPermissions, onPermissionChange: togglePermission, onDelegationChange: toggleDelegation })] }), _jsxs("div", { className: `${styles.stack} ${styles.editorSection}`, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "3" }), _jsxs("div", { children: [_jsxs("h3", { children: ["\uD544\uB4DC \uC811\uADFC \uC81C\uD55C ", _jsx("em", { children: "\uC120\uD0DD \uC0AC\uD56D" })] }), _jsx("p", { children: "\uD2B9\uC815 \uCF58\uD150\uCE20\uC5D0\uC11C \uC77D\uAC70\uB098 \uC218\uC815\uD560 \uC218 \uC788\uB294 \uD544\uB4DC\uB9CC \uC81C\uD55C\uD560 \uB54C \uC0AC\uC6A9\uD569\uB2C8\uB2E4." })] })] }), _jsx(ScopeTreeSelector, { label: "\uC81C\uD55C\uD560 \uCF58\uD150\uCE20 \uBC94\uC704", description: "\uC81C\uD55C\uC774 \uD544\uC694\uD55C Collection \uB610\uB294 \uAC1C\uBCC4 Document\uB97C \uC120\uD0DD\uD558\uC138\uC694. \uC120\uD0DD\uD558\uC9C0 \uC54A\uC73C\uBA74 \uBCC4\uB3C4 \uD544\uB4DC \uC81C\uD55C\uC744 \uB450\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", resources: policy.resources, value: fieldResourceId, onChange: setFieldResourceId, allowEmpty: true, isDisabled: readOnly, isSelectable: ({ type }) => type === "collection" || type === "document" }), fieldResourceId ? _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uBCFC \uC218 \uC788\uB294 \uD544\uB4DC" }), _jsx("input", { value: readableFields, disabled: readOnly, onChange: (event) => setReadableFields(event.target.value), placeholder: "title, summary" })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC218\uC815\uD560 \uC218 \uC788\uB294 \uD544\uB4DC" }), _jsx("input", { value: writableFields, disabled: readOnly, onChange: (event) => setWritableFields(event.target.value), placeholder: "title" })] })] }) : null] }), _jsxs("div", { className: styles.formActions, children: [onDelete ? _jsx(Button, { variant: "danger", onPress: onDelete, isDisabled: isPending, children: "\uC0AD\uC81C" }) : null, _jsx(Button, { variant: "quiet", onPress: onCancel, isDisabled: isPending, children: "\uCDE8\uC18C" }), !readOnly ? _jsx(Button, { onPress: () => onSave({
                                    name: name.trim(), description: description.trim() || undefined, levelId, permissions,
                                    delegatablePermissions: delegations,
                                    fieldAccess: fieldResourceId ? [{ resourceId: fieldResourceId, readableFields: textList(readableFields), writableFields: textList(writableFields) }] : [],
                                }), isDisabled: isPending || name.trim() === "" || levelId === "", children: "\uC800\uC7A5" }) : null] })] })] }));
}
function PermissionEditor({ permissions, selected, delegated, query, technical, readOnly, onQueryChange, onTechnicalChange, onPermissionChange, onDelegationChange, }) {
    const groups = new Map();
    for (const permission of permissions) {
        groups.set(permission.category, [...(groups.get(permission.category) ?? []), permission]);
    }
    const modeOf = (key) => delegated.includes(key)
        ? "delegate"
        : selected.includes(key) ? "use" : "none";
    const setMode = (key, mode) => {
        onPermissionChange(key, mode !== "none");
        onDelegationChange(key, mode === "delegate");
    };
    return (_jsxs("div", { className: styles.permissionEditor, children: [_jsxs("div", { className: styles.permissionToolbar, children: [_jsxs("div", { className: styles.permissionSummary, children: [_jsxs("strong", { children: [selected.length, "\uAC1C \uC5C5\uBB34 \uD5C8\uC6A9"] }), _jsxs("span", { children: [delegated.length, "\uAC1C\uB294 \uD558\uC704 \uC5ED\uD560\uC5D0 \uC704\uC784 \uAC00\uB2A5"] })] }), _jsxs("div", { className: styles.permissionTools, children: [_jsxs("label", { className: styles.permissionSearch, children: [_jsx("span", { className: styles.visuallyHidden, children: "\uAD8C\uD55C \uAC80\uC0C9" }), _jsx("input", { value: query, onChange: (event) => onQueryChange(event.target.value), placeholder: "\uC5C5\uBB34 \uB610\uB294 \uAD8C\uD55C \uAC80\uC0C9" })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => onTechnicalChange(!technical), children: technical ? "업무별 간편 보기" : "권한 코드 보기" })] })] }), technical ? (_jsxs("div", { className: styles.permissionMatrix, children: [_jsxs("div", { className: styles.permissionHeader, children: [_jsx("span", { children: "\uAD8C\uD55C \uCF54\uB4DC" }), _jsx("span", { children: "\uC0AC\uC6A9" }), _jsx("span", { children: "\uC704\uC784" })] }), permissions.map((permission) => (_jsxs("div", { className: styles.permissionRow, children: [_jsxs("span", { className: styles.permissionName, children: [_jsx("code", { children: permission.key }), _jsxs("span", { children: [permissionTaskName(permission.key), " \u00B7 ", permissionCategoryName(permission.category)] })] }), _jsx("label", { className: styles.checkboxCell, children: _jsx("input", { "aria-label": `${permission.key} 사용`, type: "checkbox", checked: selected.includes(permission.key), disabled: readOnly, onChange: (event) => onPermissionChange(permission.key, event.target.checked) }) }), _jsx("label", { className: styles.checkboxCell, children: _jsx("input", { "aria-label": `${permission.key} 위임`, type: "checkbox", checked: delegated.includes(permission.key), disabled: readOnly || !selected.includes(permission.key) || !permission.delegatable || permission.protected, onChange: (event) => onDelegationChange(permission.key, event.target.checked) }) })] }, permission.key))), permissions.length === 0 ? _jsx("div", { className: styles.permissionEmpty, children: "\uAC80\uC0C9 \uC870\uAC74\uC5D0 \uB9DE\uB294 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }) : null] })) : (_jsxs("div", { className: styles.permissionGroups, children: [[...groups.entries()].map(([category, items]) => {
                        const selectedCount = items.filter(({ key }) => selected.includes(key)).length;
                        return (_jsxs("section", { className: styles.permissionGroup, children: [_jsxs("div", { className: styles.permissionGroupHeader, children: [_jsxs("div", { children: [_jsx("strong", { children: permissionCategoryName(category) }), _jsxs("span", { children: [items.length, "\uAC1C \uC5C5\uBB34"] })] }), _jsxs(Badge, { tone: selectedCount > 0 ? "success" : "neutral", children: [selectedCount, "\uAC1C \uD5C8\uC6A9"] })] }), _jsx("div", { className: styles.permissionTaskList, children: items.map((permission) => {
                                        const mode = modeOf(permission.key);
                                        return (_jsxs("article", { className: styles.permissionTask, "data-enabled": mode !== "none", children: [_jsxs("div", { className: styles.permissionTaskIdentity, children: [_jsx("strong", { children: permissionTaskName(permission.key) }), _jsx("code", { children: permission.key }), permission.hierarchyGuard !== "none" ? _jsx("span", { children: "\uB300\uC0C1\uACFC\uC758 \uAD8C\uD55C \uB808\uBCA8\uC744 \uD568\uAED8 \uD655\uC778\uD569\uB2C8\uB2E4." }) : null] }), _jsx("div", { className: styles.permissionModes, role: "radiogroup", "aria-label": `${permissionTaskName(permission.key)} 권한 수준`, children: ["none", "use", "delegate"].map((option) => {
                                                        const disabled = readOnly || (option === "delegate" && (!permission.delegatable || permission.protected));
                                                        const label = option === "none" ? "허용 안 함" : option === "use" ? "사용" : "사용 + 위임";
                                                        return (_jsxs("label", { "data-selected": mode === option, "data-disabled": disabled, children: [_jsx("input", { type: "radio", name: `permission-${permission.key}`, value: option, checked: mode === option, disabled: disabled, onChange: () => setMode(permission.key, option) }), _jsx("span", { children: label })] }, option));
                                                    }) })] }, permission.key));
                                    }) })] }, category));
                    }), permissions.length === 0 ? _jsx("div", { className: styles.permissionEmpty, children: "\uAC80\uC0C9 \uC870\uAC74\uC5D0 \uB9DE\uB294 \uC5C5\uBB34\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." }) : null] }))] }));
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
    const [subjectCreatorOpen, setSubjectCreatorOpen] = useState(false);
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
    const openBinding = (binding) => {
        setSubjectCreatorOpen(false);
        setEditingBinding(binding);
    };
    const openSubjectCreator = () => {
        setEditingBinding(null);
        setSubjectCreatorOpen(true);
    };
    const closeInspector = () => {
        setEditingBinding(null);
        setSubjectCreatorOpen(false);
    };
    const inspectorOpen = subjectCreatorOpen || editingBinding !== null;
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "System authorization", title: "\uC5ED\uD560 \uBC30\uC815", description: "\uC0AC\uC6A9\uC790\uB098 \uADF8\uB8F9\uC5D0 \uC5ED\uD560\uC744 \uC5F0\uACB0\uD558\uACE0, \uC5B4\uB290 \uC601\uC5ED\uAE4C\uC9C0 \uC801\uC6A9\uD560\uC9C0 \uC815\uD569\uB2C8\uB2E4.", actions: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "secondary", onPress: openSubjectCreator, children: "\uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9 \uB4F1\uB85D" }), _jsx(Button, { onPress: () => openBinding(emptyBinding(policy.data)), children: "\uC5ED\uD560 \uBC30\uC815\uD558\uAE30" })] }) }), _jsx(AccessWorkspaceNav, {}), _jsxs("div", { className: styles.guideBanner, children: [_jsx("span", { className: styles.guideNumber, children: "2" }), _jsxs("div", { children: [_jsx("strong", { children: "\uB204\uAD6C\uC5D0\uAC8C, \uC5B4\uB5A4 \uC5ED\uD560\uC744, \uC5B4\uB514\uAE4C\uC9C0 \uC801\uC6A9\uD560\uC9C0\uB9CC \uC21C\uC11C\uB300\uB85C \uACE0\uB974\uC138\uC694." }), _jsx("p", { children: "\uAE30\uAC04\uC774\uB098 \uC18C\uC720\uC790\u00B7\uC0C1\uD0DC \uC870\uAC74\uC740 \uD544\uC694\uD55C \uACBD\uC6B0\uC5D0\uB9CC \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })] })] }), _jsx(PolicySummary, { policy: policy.data }), _jsxs("div", { className: styles.layout, children: [_jsxs("div", { className: styles.stack, children: [_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uD604\uC7AC \uC5ED\uD560 \uBC30\uC815", description: "\uC0AC\uC6A9\uC790\uC640 \uADF8\uB8F9\uC774 \uC2E4\uC81C\uB85C \uD589\uC0AC\uD560 \uC218 \uC788\uB294 \uC5ED\uD560 \uBC94\uC704\uC785\uB2C8\uB2E4." }), policy.data.bindings.length === 0 ? _jsx(EmptyState, { title: "\uBC30\uC815\uB41C \uC5ED\uD560\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC0AC\uC6A9\uC790 \uB610\uB294 \uADF8\uB8F9\uC5D0 \uCCAB \uC5ED\uD560\uC744 \uBC30\uC815\uD574 \uBCF4\uC138\uC694." }) : _jsx(BindingTable, { policy: policy.data, onEdit: openBinding })] }), _jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uC911\uCCA9 \uADF8\uB8F9", description: "\uADF8\uB8F9\uC744 \uD1B5\uD55C \uAD8C\uD55C \uC0C1\uC18D \uACBD\uB85C\uB294 \uD310\uC815 \uC124\uBA85\uC5D0 \uADF8\uB300\uB85C \uAE30\uB85D\uB429\uB2C8\uB2E4." }), _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uBA64\uBC84" }), _jsxs("select", { value: memberId, onChange: (event) => setMemberId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.data.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC0C1\uC704 \uADF8\uB8F9" }), _jsxs("select", { value: groupId, onChange: (event) => setGroupId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD" }), policy.data.subjects.filter(({ type }) => type === "group").map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] })] }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { onPress: () => addMembership.mutate(), isDisabled: !memberId || !groupId || addMembership.isPending, children: "\uADF8\uB8F9\uC5D0 \uCD94\uAC00" }) }), _jsx("div", { className: styles.chips, children: policy.data.groupMemberships.map((membership) => _jsxs("span", { className: styles.chip, children: [subjectNameOf(policy.data, membership.memberSubjectId), " \u2192 ", subjectNameOf(policy.data, membership.groupSubjectId)] }, `${membership.memberSubjectId}:${membership.groupSubjectId}`)) })] })] }), inspectorOpen ? _jsx("button", { className: styles.drawerBackdrop, type: "button", "aria-label": "\uD3B8\uC9D1 \uD328\uB110 \uB2EB\uAE30", onClick: closeInspector }) : null, _jsxs("div", { className: styles.detailPane, "data-open": inspectorOpen, children: [inspectorOpen ? _jsxs("div", { className: styles.drawerHeader, children: [_jsx("strong", { children: subjectCreatorOpen ? "사용자·그룹 등록" : editingBinding?.id ? "역할 배정 수정" : "새 역할 배정" }), _jsx(Button, { size: "small", variant: "quiet", onPress: closeInspector, children: "\uB2EB\uAE30" })] }) : null, subjectCreatorOpen ? (_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9 \uB4F1\uB85D", description: "\uAD8C\uD55C\uC744 \uBC1B\uC744 \uC0AC\uC6A9\uC790, \uADF8\uB8F9 \uB610\uB294 \uC11C\uBE44\uC2A4 \uACC4\uC815\uC744 \uB4F1\uB85D\uD569\uB2C8\uB2E4." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC720\uD615" }), _jsxs("select", { value: subjectType, onChange: (event) => setSubjectType(event.target.value), children: [_jsx("option", { value: "user", children: "\uC0AC\uC6A9\uC790" }), _jsx("option", { value: "group", children: "\uADF8\uB8F9" }), _jsx("option", { value: "service-account", children: "\uC11C\uBE44\uC2A4 \uACC4\uC815" })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD45C\uC2DC \uC774\uB984" }), _jsx("input", { value: subjectName, onChange: (event) => setSubjectName(event.target.value) })] }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { onPress: () => createSubject.mutate(), isDisabled: !subjectName.trim() || createSubject.isPending, children: "\uCD94\uAC00" }) })] })] })) : (_jsx(BindingEditor, { policy: policy.data, binding: editingBinding, onCancel: closeInspector, onSave: (input) => saveBinding.mutate(input), onDelete: editingBinding?.id ? () => deleteBinding.mutate(editingBinding.id) : undefined, isPending: saveBinding.isPending || deleteBinding.isPending })), _jsx(MutationError, { error: createSubject.error ?? addMembership.error ?? saveBinding.error ?? deleteBinding.error })] })] })] }));
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
        case "children": return "하위만 (현재 제외)";
        case "self-and-children": return "현재 + 모든 하위";
    }
}
function BindingTable({ policy, onEdit }) {
    return _jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9" }), _jsx("th", { children: "\uBD80\uC5EC\uB41C \uC5ED\uD560" }), _jsx("th", { children: "\uC801\uC6A9 \uC601\uC5ED" }), _jsx("th", { children: "\uD558\uC704 \uC801\uC6A9" }), _jsx("th", { children: "\uCD94\uAC00 \uC870\uAC74" }), _jsx("th", {})] }) }), _jsx("tbody", { children: policy.bindings.map((binding) => _jsxs("tr", { children: [_jsx("td", { children: _jsx("strong", { children: subjectNameOf(policy, binding.subjectId) }) }), _jsx("td", { children: roleNameOf(policy, binding.roleId) }), _jsx("td", { title: binding.resourceId, children: resourcePathOf(policy, binding.resourceId) }), _jsx("td", { children: propagationLabel(binding.propagation) }), _jsx("td", { children: binding.constraints || binding.validFrom || binding.validUntil ? _jsx(Badge, { children: "\uC870\uAC74 \uC788\uC74C" }) : _jsx("span", { className: styles.muted, children: "\uD56D\uC0C1 \uC801\uC6A9" }) }), _jsx("td", { children: binding.protected ? _jsx(Badge, { children: "\uBCF4\uD638\uB428" }) : _jsx(Button, { size: "small", variant: "quiet", onPress: () => onEdit(binding), children: "\uC218\uC815" }) })] }, binding.id)) })] }) });
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
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC5ED\uD560 \uBC30\uC815\uC744 \uC120\uD0DD\uD558\uC138\uC694", description: "\uC0C8 \uC5ED\uD560\uC744 \uBC30\uC815\uD558\uAC70\uB098 \uAE30\uC874 \uBC30\uC815 \uD56D\uBAA9\uC744 \uD3B8\uC9D1\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    const statusValues = textList(statuses);
    return _jsxs("section", { className: styles.panel, "aria-label": "\uC5ED\uD560 \uBC30\uC815 \uD3B8\uC9D1\uAE30", children: [_jsx(SectionHeader, { title: binding.id ? "역할 배정 수정" : "새 역할 배정", description: "\uC544\uB798 \uC138 \uB2E8\uACC4\uB9CC \uC120\uD0DD\uD558\uBA74 \uC5ED\uD560\uC774 \uC801\uC6A9\uB429\uB2C8\uB2E4." }), _jsxs("div", { className: styles.form, children: [_jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "1" }), _jsxs("div", { children: [_jsx("h3", { children: "\uB204\uAD6C\uC5D0\uAC8C \uC801\uC6A9\uD560\uAE4C\uC694?" }), _jsx("p", { children: "\uAC1C\uBCC4 \uC0AC\uC6A9\uC790, \uADF8\uB8F9 \uB610\uB294 \uC11C\uBE44\uC2A4 \uACC4\uC815\uC744 \uC120\uD0DD\uD569\uB2C8\uB2E4." })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC0AC\uC6A9\uC790 \uB610\uB294 \uADF8\uB8F9" }), _jsxs("select", { value: subjectId, onChange: (event) => setSubjectId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), policy.subjects.filter(({ protected: itemProtected }) => !itemProtected).map((subject) => _jsxs("option", { value: subject.id, children: [subject.name, " \u00B7 ", subjectTypeName(subject.type)] }, subject.id))] })] })] }), _jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "2" }), _jsxs("div", { children: [_jsx("h3", { children: "\uC5B4\uB5A4 \uC5ED\uD560\uC744 \uC904\uAE4C\uC694?" }), _jsx("p", { children: "\uC5ED\uD560\uC5D0 \uD3EC\uD568\uB41C \uC5C5\uBB34 \uAD8C\uD55C\uC774 \uC120\uD0DD\uD55C \uB300\uC0C1\uC5D0\uAC8C \uBD80\uC5EC\uB429\uB2C8\uB2E4." })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uBD80\uC5EC\uD560 \uC5ED\uD560" }), _jsxs("select", { value: roleId, onChange: (event) => setRoleId(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), policy.roles.filter(({ protected: itemProtected }) => !itemProtected).map((role) => { const level = policy.levels.find(({ id }) => id === role.levelId); return _jsxs("option", { value: role.id, children: [role.name, level ? ` · ${level.name} 레벨 ${level.rank}` : ""] }, role.id); })] })] })] }), _jsxs("div", { className: styles.editorSection, children: [_jsxs("div", { className: styles.editorSectionHeader, children: [_jsx("span", { children: "3" }), _jsxs("div", { children: [_jsx("h3", { children: "\uC5B4\uB514\uAE4C\uC9C0 \uC801\uC6A9\uD560\uAE4C\uC694?" }), _jsx("p", { children: "\uCF58\uD150\uCE20\uB098 \uAD00\uB9AC \uC601\uC5ED\uC744 \uACE0\uB974\uACE0 \uD558\uC704 \uD56D\uBAA9\uC73C\uB85C\uC758 \uC801\uC6A9 \uBC29\uC2DD\uC744 \uC120\uD0DD\uD569\uB2C8\uB2E4." })] })] }), _jsx(ScopeTreeSelector, { label: "\uC801\uC6A9\uD560 \uC601\uC5ED", description: "\uD2B8\uB9AC\uC5D0\uC11C \uC2E4\uC81C \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uC138\uC694. \uC544\uB798 \uC635\uC158\uC73C\uB85C \uD604\uC7AC \uD56D\uBAA9\uACFC \uD558\uC704 \uD56D\uBAA9\uC758 \uD3EC\uD568 \uC5EC\uBD80\uB97C \uC815\uD569\uB2C8\uB2E4.", resources: policy.resources, value: resourceId, onChange: setResourceId, propagation: propagation, onPropagationChange: setPropagation })] }), _jsxs("details", { className: styles.advancedDetails, open: Boolean(validFrom || validUntil || ownerSubjectId || statuses), children: [_jsxs("summary", { children: [_jsx("span", { children: "\uCD94\uAC00 \uC870\uAC74" }), _jsx("small", { children: "\uAE30\uAC04, \uC18C\uC720\uC790 \uB610\uB294 \uCF58\uD150\uCE20 \uC0C1\uD0DC\uB97C \uC81C\uD55C\uD560 \uB54C\uB9CC \uC0AC\uC6A9" })] }), _jsxs("div", { className: styles.advancedDetailsBody, children: [_jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC801\uC6A9 \uC2DC\uC791" }), _jsx("input", { type: "datetime-local", value: validFrom, onChange: (event) => setValidFrom(event.target.value) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uC801\uC6A9 \uC885\uB8CC" }), _jsx("input", { type: "datetime-local", value: validUntil, onChange: (event) => setValidUntil(event.target.value) })] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD2B9\uC815 \uC18C\uC720\uC790\uC758 \uCF58\uD150\uCE20\uB9CC" }), _jsxs("select", { value: ownerSubjectId, onChange: (event) => setOwnerSubjectId(event.target.value), children: [_jsx("option", { value: "", children: "\uC18C\uC720\uC790 \uC81C\uD55C \uC5C6\uC74C" }), policy.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD2B9\uC815 \uC0C1\uD0DC\uB9CC" }), _jsx("input", { value: statuses, onChange: (event) => setStatuses(event.target.value), placeholder: "\uC608: draft, rejected" })] })] })] }), _jsxs("div", { className: styles.bindingPreview, children: [_jsx("strong", { children: "\uBC30\uC815 \uC694\uC57D" }), _jsxs("span", { children: [subjectId ? subjectNameOf(policy, subjectId) : "대상 미선택", "\uC5D0\uAC8C ", roleId ? roleNameOf(policy, roleId) : "역할 미선택", " \uC5ED\uD560\uC744 ", resourceId ? resourcePathOf(policy, resourceId) : "영역 미선택", "\uC5D0\uC11C \uC801\uC6A9"] })] }), _jsxs("div", { className: styles.formActions, children: [onDelete ? _jsx(Button, { variant: "danger", onPress: onDelete, children: "\uBC30\uC815 \uC0AD\uC81C" }) : null, _jsx(Button, { variant: "quiet", onPress: onCancel, children: "\uCDE8\uC18C" }), _jsx(Button, { onPress: () => onSave({ subjectId, roleId, resourceId, propagation, validFrom: optionalInstant(validFrom), validUntil: optionalInstant(validUntil), constraints: ownerSubjectId || statusValues.length ? { ownerSubjectId: ownerSubjectId || undefined, statuses: statusValues.length ? statusValues : undefined } : undefined }), isDisabled: isPending || !subjectId || !roleId || !resourceId, children: binding.id ? "변경 저장" : "역할 배정" })] })] })] });
}
export function AccessSimulatorPage() {
    const { authorization, realmId } = useAuthorizationWorkspace();
    const policy = useAuthorizationPolicy();
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
        return _jsx(Page, { children: _jsx(LoadError, { error: policy.error, onRetry: () => void policy.refetch() }) });
    const resetResults = () => {
        simulation.reset();
        effectivePermissions.reset();
    };
    return _jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realmId ? "Content Realm authorization" : "Explainable authorization", title: "\uC0AC\uC6A9\uC790 \uAD8C\uD55C \uD655\uC778", description: "\uC0AC\uC6A9\uC790\uC640 \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uBA74 \uC2E4\uC81C\uB85C \uAC00\uB2A5\uD55C \uC5C5\uBB34\uC640 \uADF8 \uC774\uC720\uB97C \uD55C\uB208\uC5D0 \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }), _jsx(AccessWorkspaceNav, {}), _jsxs("div", { className: styles.guideBanner, children: [_jsx("span", { className: styles.guideNumber, children: "?" }), _jsxs("div", { children: [_jsx("strong", { children: "\uC124\uC815\uC744 \uBC14\uAFB8\uC9C0 \uC54A\uACE0 \uD604\uC7AC \uAD8C\uD55C\uB9CC \uC548\uC804\uD558\uAC8C \uD655\uC778\uD569\uB2C8\uB2E4." }), _jsx("p", { children: "\uD2B9\uC815 \uAD8C\uD55C\uC758 \uC0C1\uC138 \uD310\uC815\uC740 \uC544\uB798 \uACE0\uAE09 \uC9C4\uB2E8\uC5D0\uC11C \uBCC4\uB3C4\uB85C \uC2E4\uD589\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })] })] }), _jsxs("div", { className: `${styles.layout} ${styles.simulatorLayout}`, children: [_jsxs("section", { className: styles.panel, children: [_jsx(SectionHeader, { title: "\uB204\uAD6C\uC758 \uAD8C\uD55C\uC744 \uC5B4\uB514\uC5D0\uC11C \uD655\uC778\uD560\uAE4C\uC694?", description: "\uC0AC\uC6A9\uC790 \uB610\uB294 \uADF8\uB8F9\uACFC \uC2E4\uC81C \uCF58\uD150\uCE20\u00B7\uAD00\uB9AC \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uC138\uC694." }), _jsxs("div", { className: styles.form, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD655\uC778\uD560 \uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9" }), _jsxs("select", { value: subjectId, onChange: (event) => { setSubjectId(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), policy.data.subjects.map((subject) => _jsxs("option", { value: subject.id, children: [subject.name, " \u00B7 ", subjectTypeName(subject.type)] }, subject.id))] })] }), _jsx(ScopeTreeSelector, { label: "\uD655\uC778\uD560 \uC601\uC5ED", description: "\uAD8C\uD55C\uC744 \uD655\uC778\uD560 Collection, Document \uB610\uB294 \uAD00\uB9AC \uC601\uC5ED\uC744 \uC120\uD0DD\uD558\uC138\uC694.", resources: policy.data.resources, value: resourceId, onChange: (next) => { setResourceId(next); resetResults(); } }), _jsx(Button, { isFullWidth: true, onPress: () => effectivePermissions.mutate(), isDisabled: !subjectId || !resourceId || effectivePermissions.isPending, children: effectivePermissions.isPending ? "권한 확인 중…" : "이 영역의 전체 권한 확인" }), _jsxs("details", { className: styles.advancedDetails, children: [_jsxs("summary", { children: [_jsx("span", { children: "\uD2B9\uC815 \uAD8C\uD55C \uC0C1\uC138 \uC9C4\uB2E8" }), _jsx("small", { children: "Action\uACFC \uC870\uAC74\uC744 \uC9C1\uC811 \uC9C0\uC815\uD558\uB294 \uACE0\uAE09 \uB3C4\uAD6C" })] }), _jsxs("div", { className: styles.advancedDetailsBody, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uD655\uC778\uD560 \uAD8C\uD55C" }), _jsxs("select", { value: action, onChange: (event) => { setAction(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC120\uD0DD\uD574 \uC8FC\uC138\uC694" }), policy.data.permissions.map((permission) => _jsxs("option", { value: permission.key, children: [permissionTaskName(permission.key), " \u00B7 ", permission.key, permission.hierarchyGuard === "none" ? "" : " · 대상 정보 필요"] }, permission.key))] })] }), _jsxs("div", { className: styles.fieldRow, children: [_jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uCF58\uD150\uCE20 \uC18C\uC720\uC790 \uC870\uAC74" }), _jsxs("select", { value: ownerSubjectId, onChange: (event) => { setOwnerSubjectId(event.target.value); resetResults(); }, children: [_jsx("option", { value: "", children: "\uC870\uAC74 \uC5C6\uC74C" }), policy.data.subjects.map((subject) => _jsx("option", { value: subject.id, children: subject.name }, subject.id))] })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: "\uCF58\uD150\uCE20 \uC0C1\uD0DC \uC870\uAC74" }), _jsx("input", { value: status, onChange: (event) => { setStatus(event.target.value); resetResults(); }, placeholder: "\uC608: draft" })] })] }), hierarchyUnsupported ? (_jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "\uC774 \uAD8C\uD55C\uC740 \uB300\uC0C1\uACFC\uC758 \uAD00\uB9AC \uC11C\uC5F4\uB3C4 \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4." }), _jsx("br", {}), hierarchyContextDescription(selectedHierarchyGuard), " \uC2E4\uC81C \uAD00\uB9AC \uC791\uC5C5\uC5D0\uC11C \uB300\uC0C1\uC758 \uAD8C\uD55C \uB808\uBCA8\uACFC \uBCF4\uD638 \uC0C1\uD0DC\uB97C \uD568\uAED8 \uD310\uC815\uD569\uB2C8\uB2E4."] })) : null, _jsx(Button, { variant: "secondary", isFullWidth: true, onPress: () => simulation.mutate(), isDisabled: !subjectId || !action || !resourceId || hierarchyUnsupported || simulation.isPending, children: simulation.isPending ? "진단 중…" : hierarchyUnsupported ? "대상 정보 필요" : "선택한 권한 진단" })] })] }), _jsx(MutationError, { error: simulation.error ?? effectivePermissions.error })] })] }), _jsxs("div", { className: styles.stack, children: [_jsx(EffectivePermissionList, { policy: policy.data, results: effectivePermissions.data ?? null }), _jsx(DecisionExplanation, { policy: policy.data, decision: simulation.data ?? null })] })] })] });
}
function EffectivePermissionList({ policy, results, }) {
    if (results === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC804\uCCB4 \uAD8C\uD55C \uACB0\uACFC", description: "\uC0AC\uC6A9\uC790\u00B7\uADF8\uB8F9\uACFC \uC601\uC5ED\uC744 \uC120\uD0DD\uD55C \uB4A4 \uC804\uCCB4 \uAD8C\uD55C \uD655\uC778\uC744 \uC2E4\uD589\uD558\uC138\uC694." }) });
    const sorted = [...results].sort((left, right) => Number(right.decision?.allowed === true) - Number(left.decision?.allowed === true)
        || Number(right.supported) - Number(left.supported));
    const supportedCount = results.filter(({ supported }) => supported).length;
    const unsupportedCount = results.length - supportedCount;
    const allowedCount = results.filter(({ decision }) => decision?.allowed === true).length;
    const firstDecision = results.find(({ decision }) => decision !== null)?.decision;
    return (_jsxs("section", { className: styles.panel, "aria-label": "\uC0AC\uC6A9\uC790\uBCC4 Effective Permission", "aria-live": "polite", children: [_jsxs("div", { className: styles.panelHeader, children: [_jsxs("div", { children: [_jsx("h2", { children: "\uC774 \uC601\uC5ED\uC5D0\uC11C \uAC00\uB2A5\uD55C \uC5C5\uBB34" }), _jsx("span", { className: styles.hint, children: resourcePathOf(policy, firstDecision?.resourceId ?? "") })] }), _jsxs(Badge, { tone: allowedCount > 0 ? "success" : "neutral", children: [allowedCount, "/", supportedCount, "\uAC1C \uAC00\uB2A5", unsupportedCount ? ` · ${unsupportedCount}개 추가 정보 필요` : ""] })] }), _jsx("div", { className: styles.effectiveList, children: sorted.map(({ permission, supported, decision }) => (_jsxs("article", { className: styles.effectiveItem, "data-allowed": decision?.allowed === true, children: [_jsxs("div", { children: [_jsx("strong", { children: permissionTaskName(permission.key) }), _jsx("code", { children: permission.key })] }), _jsx(Badge, { tone: !supported ? "neutral" : decision?.allowed ? "success" : "danger", children: !supported ? "추가 정보 필요" : decision?.allowed ? "가능" : "불가" }), _jsx("span", { children: supported ? decisionReasonName(decision?.reasonCode ?? "") : hierarchyContextDescription(permission.hierarchyGuard) })] }, permission.key))) })] }));
}
function hierarchyContextDescription(guard) {
    switch (guard) {
        case "target-role": return "대상 역할의 Authority Level context가 필요합니다.";
        case "target-binding": return "대상 바인딩의 역할·주체·Scope context가 필요합니다.";
        case "target-subject": return "대상 사용자의 Authority Level과 보호 상태 context가 필요합니다.";
        case "none": return "";
    }
}
function decisionReasonName(code) {
    const names = {
        PERMISSION_GRANTED: "필요한 역할과 권한이 적용되어 있습니다.",
        ALLOW_PERMISSION: "필요한 역할과 권한이 적용되어 있습니다.",
        ALLOW_REALM_FULL_ACCESS: "이 Realm의 전체 접근 권한이 적용되어 있습니다.",
        PERMISSION_NOT_GRANTED: "이 업무를 허용하는 역할이 배정되지 않았습니다.",
        DENY_PERMISSION: "이 업무를 허용하는 역할이 배정되지 않았습니다.",
        CONSTRAINT_NOT_SATISFIED: "배정된 역할의 기간·소유자·상태 조건과 일치하지 않습니다.",
        RESOURCE_NOT_IN_SCOPE: "역할이 적용되는 영역 밖에 있습니다.",
        SUBJECT_DISABLED: "사용자 또는 그룹이 비활성화되어 있습니다.",
        HIERARCHY_CONTEXT_REQUIRED: "대상과의 권한 레벨 정보가 더 필요합니다.",
    };
    return names[code] ?? "현재 정책 조건에 따라 판정되었습니다.";
}
function DecisionExplanation({ policy, decision }) {
    if (decision === null)
        return _jsx("section", { className: styles.panel, children: _jsx(EmptyState, { title: "\uC0C1\uC138 \uC9C4\uB2E8 \uACB0\uACFC", description: "\uD2B9\uC815 \uAD8C\uD55C \uC0C1\uC138 \uC9C4\uB2E8\uC744 \uC2E4\uD589\uD558\uBA74 \uC801\uC6A9\uB41C \uC5ED\uD560\uACFC \uADF8\uB8F9 \uACBD\uB85C\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) });
    return _jsxs("section", { className: styles.decisionCard, "data-allowed": decision.allowed, children: [_jsxs("div", { className: styles.decisionTitle, children: [_jsx(Badge, { tone: decision.allowed ? "success" : "danger", children: decision.allowed ? "허용됨" : "허용되지 않음" }), _jsx("strong", { children: decisionReasonName(decision.reasonCode) })] }), _jsxs("div", { className: styles.auditMeta, children: [_jsx("span", { children: permissionTaskName(decision.action) }), _jsxs("span", { children: ["\uC815\uCC45 Revision ", decision.policyRevision] }), decision.actorLevel === undefined ? null : _jsxs("span", { children: ["\uC0AC\uC6A9\uC790 \uB808\uBCA8 ", decision.actorLevel] })] }), _jsxs("details", { className: styles.decisionTechnical, children: [_jsx("summary", { children: "\uAE30\uC220 \uC815\uBCF4 \uBCF4\uAE30" }), _jsx("code", { children: decision.reasonCode }), _jsx("code", { children: decision.action })] }), _jsx("div", { className: styles.grantList, children: decision.matchedGrants.map((grant) => _jsxs("div", { className: styles.grant, children: [_jsxs("strong", { children: [roleNameOf(policy, grant.sourceRoleId), " \u00B7 \uB808\uBCA8 ", grant.sourceRank] }), _jsxs("span", { children: [resourceNameOf(policy, grant.sourceResourceId), " \u00B7 ", propagationLabel(grant.sourcePropagation)] }), grant.membershipPath.length ? _jsxs("span", { children: ["\uADF8\uB8F9 \uACBD\uB85C: ", grant.membershipPath.map((id) => subjectNameOf(policy, id)).join(" → ")] }) : _jsx("span", { children: "\uC9C1\uC811 \uBC30\uC815\uB428" })] }, `${grant.sourceBindingId}:${grant.permission}`)) })] });
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