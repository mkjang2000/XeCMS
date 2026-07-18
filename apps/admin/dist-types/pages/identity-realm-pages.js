import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Badge, Button, Callout, CheckboxField, ConfirmDialog, EmptyState, SelectField, TextAreaField, TextInput, } from "@xecms/ui";
import { Link, useNavigate, useParams } from "react-router";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
import styles from "../identity-realms.module.css";
const provisioningOptions = [
    { value: "explicit", label: "명시적 승인" },
    { value: "jit", label: "첫 로그인 시 JIT" },
];
const registrationOptions = [
    { value: "closed", label: "가입 닫힘" },
    { value: "open", label: "가입 허용" },
];
const statusOptions = [
    { value: "active", label: "활성" },
    { value: "disabled", label: "비활성" },
];
function commaValues(value) {
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
function localInstant(value) {
    return value === "" ? undefined : new Date(value).toISOString();
}
function formatInstant(value) {
    if (value === undefined)
        return "—";
    return new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}
function RealmStatusBadge({ realm }) {
    if (realm.kind === "system")
        return _jsx(Badge, { tone: "info", children: "System" });
    switch (realm.status) {
        case "active": return _jsx(Badge, { tone: "success", children: "\uD65C\uC131" });
        case "provisioning": return _jsx(Badge, { tone: "warning", children: "\uD504\uB85C\uBE44\uC800\uB2DD \uC911" });
        case "disabled": return _jsx(Badge, { tone: "danger", children: "\uBE44\uD65C\uC131" });
    }
}
function MembershipStatusBadge({ status }) {
    switch (status) {
        case "active": return _jsx(Badge, { tone: "success", children: "\uD65C\uC131" });
        case "pending": return _jsx(Badge, { tone: "warning", children: "\uD504\uB85C\uBE44\uC800\uB2DD \uC911" });
        case "suspended": return _jsx(Badge, { tone: "danger", children: "\uC815\uC9C0" });
    }
}
function MutationError({ error }) {
    if (error === null || error === undefined)
        return null;
    const converted = toAdminApiError(error);
    return _jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: converted.message }), " ", _jsx("span", { className: styles.errorCode, children: converted.code })] });
}
export function IdentityRealmListPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [creating, setCreating] = useState(false);
    const realms = useQuery({
        queryKey: queryKeys.identityRealms,
        queryFn: () => api.identityRealms.list(),
    });
    const create = useMutation({
        mutationFn: api.identityRealms.create,
        onSuccess: async (realm) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.identityRealms });
            navigate(`/admin/realms/${encodeURIComponent(realm.realmId)}`);
        },
    });
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Identity federation", title: "Identity Realms", description: "Global Identity\uC758 \uC790\uACA9 \uC99D\uBA85\uC740 \uACF5\uC720\uD558\uB418 Membership, Subject\uC640 \uAD8C\uD55C\uC740 Realm\uBCC4\uB85C \uBD84\uB9AC\uD569\uB2C8\uB2E4.", actions: _jsxs(Button, { onPress: () => setCreating((value) => !value), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC0C8 Content Realm"] }) }), creating ? (_jsx(CreateRealmForm, { isPending: create.isPending, error: create.error, onCancel: () => setCreating(false), onSubmit: (input) => create.mutate(input) })) : null, realms.isPending ? _jsx(PageLoading, { label: "Identity Realm\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, realms.isError ? _jsx(LoadError, { error: realms.error, onRetry: () => void realms.refetch() }) : null, realms.data?.items.length === 0 ? (_jsx(EmptyState, { title: "\uB4F1\uB85D\uB41C Realm\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCCAB Content Realm\uC744 \uB9CC\uB4E4\uC5B4 \uB3C5\uB9BD\uB41C \uD68C\uC6D0\u00B7\uACE0\uAC1D \uACC4\uC815 \uC601\uC5ED\uC744 \uAD6C\uC131\uD558\uC138\uC694.", action: _jsx(Button, { onPress: () => setCreating(true), children: "\uC0C8 Content Realm" }) })) : null, realms.data && realms.data.items.length > 0 ? (_jsx("div", { className: styles.realmGrid, children: realms.data.items.map((realm) => (_jsxs(Link, { className: styles.realmCard, to: `/admin/realms/${encodeURIComponent(realm.realmId)}`, children: [_jsxs("div", { className: styles.realmCardHeader, children: [_jsx("span", { className: styles.realmIcon, children: _jsx(Icon, { name: "identity", size: 20 }) }), _jsx(RealmStatusBadge, { realm: realm })] }), _jsxs("div", { className: styles.realmCardBody, children: [_jsx("h2", { children: realm.name }), _jsx("code", { children: realm.realmKey })] }), _jsxs("dl", { className: styles.compactFacts, children: [_jsxs("div", { children: [_jsx("dt", { children: "Realm ID" }), _jsx("dd", { children: realm.realmId })] }), _jsxs("div", { children: [_jsx("dt", { children: "Revision" }), _jsx("dd", { children: realm.revision })] }), realm.kind === "content" ? _jsxs("div", { children: [_jsx("dt", { children: "Profile Collection" }), _jsx("dd", { children: realm.profileCollectionId ?? "연결 대기" })] }) : null] }), _jsxs("div", { className: styles.realmCardFooter, children: [_jsx("span", { children: realm.kind === "system" ? "CMS 운영 계정 영역" : realm.authentication.registration === "open" ? "공개 가입 허용" : "관리자 승인형" }), _jsx(Icon, { name: "arrowRight", size: 14 })] })] }, realm.realmId))) })) : null] }));
}
function CreateRealmForm({ onSubmit, onCancel, isPending, error }) {
    const [name, setName] = useState("");
    const [key, setKey] = useState("");
    const [acceptSystem, setAcceptSystem] = useState(true);
    const [provisioning, setProvisioning] = useState("explicit");
    const [registration, setRegistration] = useState("closed");
    const [defaultRoles, setDefaultRoles] = useState("");
    const valid = name.trim() !== "" && /^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/.test(key) &&
        (provisioning !== "jit" || acceptSystem);
    return (_jsxs("section", { className: styles.formCard, "aria-labelledby": "create-realm-title", children: [_jsx(SectionHeader, { id: "create-realm-title", title: "\uC0C8 Content Realm", description: "Profile Collection \uC5F0\uACB0\uC740 Schema auth \uC124\uC815\uC774 \uC801\uC6A9\uB420 \uB54C \uC644\uB8CC\uB429\uB2C8\uB2E4." }), _jsxs("form", { className: styles.formStack, onSubmit: (event) => {
                    event.preventDefault();
                    if (!valid)
                        return;
                    onSubmit({
                        key,
                        name: name.trim(),
                        acceptSystemIdentities: acceptSystem,
                        provisioning,
                        registration,
                        defaultRoleIds: commaValues(defaultRoles),
                    });
                }, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(TextInput, { label: "\uD45C\uC2DC \uC774\uB984", value: name, onChange: setName, placeholder: "Community", isRequired: true }), _jsx(TextInput, { label: "Realm Key", value: key, onChange: (value) => setKey(value.toLocaleLowerCase("en-US")), description: "URL\uACFC \uAD8C\uD55C namespace\uC5D0 \uC0AC\uC6A9\uB418\uB294 \uBCC0\uACBD \uBD88\uAC00 slug\uC785\uB2C8\uB2E4.", placeholder: "community", isRequired: true }), _jsx(SelectField, { label: "\uAC00\uC785 \uC815\uCC45", value: registration, options: registrationOptions, onChange: (value) => setRegistration(value) }), _jsx(SelectField, { label: "System Identity \uC5F0\uACB0", value: provisioning, options: provisioningOptions, onChange: (value) => {
                                    const next = value;
                                    setProvisioning(next);
                                    if (next === "jit")
                                        setAcceptSystem(true);
                                } }), _jsx(TextInput, { label: "\uAE30\uBCF8 Role IDs", value: defaultRoles, onChange: setDefaultRoles, description: "\uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4. \uBE44\uC6CC \uB450\uBA74 \uB85C\uADF8\uC778\uB9CC \uD5C8\uC6A9\uB429\uB2C8\uB2E4." })] }), _jsx(CheckboxField, { isSelected: acceptSystem, onChange: setAcceptSystem, isDisabled: provisioning === "jit", children: "\uAE30\uC874 System Global Identity\uC758 Membership \uC0DD\uC131\uC744 \uD5C8\uC6A9" }), _jsx(MutationError, { error: error }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { type: "button", variant: "secondary", onPress: onCancel, isDisabled: isPending, children: "\uCDE8\uC18C" }), _jsx(Button, { type: "submit", isDisabled: !valid || isPending, children: isPending ? "생성 중…" : "Realm 생성" })] })] })] }));
}
export function IdentityRealmDetailPage() {
    const { realmId } = useParams();
    const api = useAdminApi();
    const navigate = useNavigate();
    const realm = useQuery({
        queryKey: queryKeys.identityRealm(realmId ?? "missing"),
        queryFn: () => api.identityRealms.get(realmId),
        enabled: realmId !== undefined,
    });
    const isContent = realm.data?.kind === "content";
    const realms = useQuery({
        queryKey: queryKeys.identityRealms,
        queryFn: () => api.identityRealms.list(),
        enabled: isContent,
    });
    const identities = useQuery({
        queryKey: queryKeys.globalIdentities,
        queryFn: () => api.identityRealms.listGlobalIdentities(),
        enabled: isContent,
    });
    const memberships = useQuery({
        queryKey: queryKeys.realmMemberships(realmId ?? "missing"),
        queryFn: () => api.identityRealms.listMemberships(realmId),
        enabled: realmId !== undefined && isContent,
    });
    const fullAccess = useQuery({
        queryKey: queryKeys.realmFullAccess(realmId ?? "missing"),
        queryFn: () => api.identityRealms.listFullAccess(realmId),
        enabled: realmId !== undefined && isContent,
    });
    if (realmId === undefined)
        return _jsx(Page, { children: _jsx(Callout, { tone: "error", children: "Realm ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." }) });
    if (realm.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "Realm \uC0C1\uC138 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (realm.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: realm.error, onRetry: () => void realm.refetch() }) });
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realm.data.kind === "system" ? "System identity realm" : "Content identity realm", title: realm.data.name, description: realm.data.kind === "system"
                    ? "CMS 운영 계정과 Admin 세션의 보호된 System Realm입니다."
                    : "Global Identity 자격 증명과 이 Realm의 Membership·Subject·Profile 연결을 관리합니다.", actions: _jsxs(_Fragment, { children: [_jsx(RealmStatusBadge, { realm: realm.data }), realm.data.kind === "content" && realm.data.status === "active" ? (_jsx(Button, { onPress: () => navigate(`/admin/realms/${encodeURIComponent(realm.data.realmId)}/access/roles`), children: "Realm \uAD8C\uD55C \uAD00\uB9AC" })) : null, _jsx(Button, { variant: "secondary", onPress: () => navigate("/admin/realms"), children: "\uBAA9\uB85D\uC73C\uB85C" })] }) }), _jsx(RealmIdentitySummary, { realm: realm.data }), realm.data.kind === "system" ? (_jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "System Realm\uC740 \uC774 \uD654\uBA74\uC5D0\uC11C \uC218\uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }), " Content Realm\uC5D0 \uC6B4\uC601 \uACC4\uC815\uC744 \uC5F0\uACB0\uD574\uB3C4 System \uAD8C\uD55C\uC774 \uC804\uD30C\uB418\uC9C0\uB294 \uC54A\uC2B5\uB2C8\uB2E4."] })) : (_jsxs(_Fragment, { children: [realm.data.status === "provisioning" ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC544\uC9C1 \uD65C\uC131\uD654\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uD55C \uB2E8\uACC4\uAC00 \uB354 \uD544\uC694\uD569\uB2C8\uB2E4." }), _jsxs("p", { children: ["\uC774 Realm\uC740 ", _jsx("strong", { children: "Auth Collection\uC744 \uC5F0\uACB0\uD558\uACE0 \uC2A4\uD0A4\uB9C8\uB97C \uC801\uC6A9(Apply)" }), "\uD558\uB294 \uC21C\uAC04 \uC790\uB3D9\uC73C\uB85C \uD65C\uC131\uD654\uB429\uB2C8\uB2E4. \uAE30\uB2E4\uB9B0\uB2E4\uACE0 \uC800\uC808\uB85C \uD65C\uC131\uD654\uB418\uC9C0\uB294 \uC54A\uC2B5\uB2C8\uB2E4."] }), _jsxs("ol", { className: styles.provisioningSteps, children: [_jsx("li", { children: "\uC2A4\uD0A4\uB9C8 \uBE4C\uB354\uC5D0\uC11C \uB85C\uADF8\uC778 \uACC4\uC815\uC744 \uB2F4\uC744 Collection\uC744 \uB9CC\uB4E4\uAC70\uB098 \uC5FD\uB2C8\uB2E4." }), _jsxs("li", { children: ["\uADF8 Collection\uC758 ", _jsx("strong", { children: "Auth" }), " \uC124\uC815\uC5D0\uC11C Realm Key ", _jsx("code", { children: realm.data.realmKey }), "\uB97C \uC9C0\uC815\uD569\uB2C8\uB2E4."] }), _jsxs("li", { children: ["\uC2A4\uD0A4\uB9C8\uB97C ", _jsx("strong", { children: "Apply" }), "\uD558\uBA74 Profile Collection\uC774 \uC5F0\uACB0\uB418\uACE0 \uC774 Realm\uC774 \uD65C\uC131 \uC0C1\uD0DC\uB85C \uC804\uD658\uB429\uB2C8\uB2E4."] })] }), _jsx(Button, { onPress: () => navigate("/admin/schema"), children: "\uC2A4\uD0A4\uB9C8 \uBE4C\uB354\uB85C \uC774\uB3D9" })] })) : null, realm.data.status === "disabled" ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC774 Realm\uC740 \uBE44\uD65C\uC131 \uC0C1\uD0DC\uC785\uB2C8\uB2E4." }), " \uC2E0\uADDC \uC138\uC158, Membership provisioning\uACFC Full Access grant\uAC00 \uCC28\uB2E8\uB429\uB2C8\uB2E4."] })) : null, _jsx(RealmSettingsForm, { realm: realm.data }), _jsx(MembershipSection, { realm: realm.data, memberships: memberships, identities: identities, systemRealmId: realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system" }), _jsx(FullAccessSection, { realm: realm.data, memberships: memberships.data?.items ?? [], bindings: fullAccess, identities: identities.data?.items ?? [] })] }))] }));
}
function RealmIdentitySummary({ realm }) {
    return (_jsxs("section", { className: styles.summaryGrid, "aria-label": "Realm \uC2DD\uBCC4 \uC815\uBCF4", children: [_jsxs("div", { children: [_jsx("span", { children: "Realm ID" }), _jsx("code", { children: realm.realmId })] }), _jsxs("div", { children: [_jsx("span", { children: "Realm Key" }), _jsx("code", { children: realm.realmKey })] }), _jsxs("div", { children: [_jsx("span", { children: "Profile Collection ID" }), _jsx("code", { children: realm.profileCollectionId ?? "연결 대기" })] }), _jsxs("div", { children: [_jsx("span", { children: "Realm Revision" }), _jsx("strong", { children: realm.revision })] })] }));
}
function RealmSettingsForm({ realm }) {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const [name, setName] = useState(realm.name);
    const [status, setStatus] = useState(realm.status === "disabled" ? "disabled" : "active");
    const [acceptSystem, setAcceptSystem] = useState(realm.authentication.acceptSystemIdentities);
    const [provisioning, setProvisioning] = useState(realm.authentication.provisioning);
    const [registration, setRegistration] = useState(realm.authentication.registration);
    const [defaultRoles, setDefaultRoles] = useState(realm.authentication.defaultRoleIds.join(", "));
    const editable = realm.status !== "provisioning";
    const save = useMutation({
        mutationFn: () => api.identityRealms.update(realm.realmId, {
            expectedRevision: realm.revision,
            name: name.trim(),
            status,
            acceptSystemIdentities: acceptSystem,
            provisioning,
            registration,
            defaultRoleIds: commaValues(defaultRoles),
        }),
        onSuccess: async (next) => {
            queryClient.setQueryData(queryKeys.identityRealm(realm.realmId), next);
            await queryClient.invalidateQueries({ queryKey: queryKeys.identityRealms });
        },
    });
    const converted = save.error === null ? null : toAdminApiError(save.error);
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "realm-settings-title", children: [_jsx(SectionHeader, { id: "realm-settings-title", title: "Realm \uC124\uC815", description: `Realm Revision ${realm.revision}을 기준으로 충돌 없이 저장합니다.` }), editable ? null : (_jsx(Callout, { tone: "info", children: "Auth Collection\uC744 \uC5F0\uACB0\uD574 Realm\uC774 \uD65C\uC131\uD654\uB418\uAE30 \uC804\uAE4C\uC9C0\uB294 \uC124\uC815\uC744 \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC704 \uC548\uB0B4\uC5D0 \uB530\uB77C \uC2A4\uD0A4\uB9C8\uB97C \uC801\uC6A9\uD574 \uC8FC\uC138\uC694." })), _jsxs("form", { className: styles.formStack, onSubmit: (event) => { event.preventDefault(); if (editable)
                    save.mutate(); }, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(TextInput, { label: "\uD45C\uC2DC \uC774\uB984", value: name, onChange: setName, isDisabled: !editable, isRequired: true }), _jsx(SelectField, { label: "\uC0C1\uD0DC", value: status, options: statusOptions, onChange: (value) => setStatus(value), isDisabled: !editable }), _jsx(SelectField, { label: "\uAC00\uC785 \uC815\uCC45", value: registration, options: registrationOptions, onChange: (value) => setRegistration(value), isDisabled: !editable }), _jsx(SelectField, { label: "System Identity provisioning", value: provisioning, options: provisioningOptions, onChange: (value) => {
                                    const next = value;
                                    setProvisioning(next);
                                    if (next === "jit")
                                        setAcceptSystem(true);
                                }, isDisabled: !editable }), _jsx(TextInput, { label: "\uAE30\uBCF8 Role IDs", value: defaultRoles, onChange: setDefaultRoles, description: "\uC0C8 Membership Subject\uC5D0 \uC801\uC6A9\uD560 Role ID\uB97C \uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4.", isDisabled: !editable })] }), _jsx(CheckboxField, { isSelected: acceptSystem, onChange: setAcceptSystem, isDisabled: !editable || provisioning === "jit", children: "System Global Identity\uAC00 \uC774 Realm\uC758 Membership\uC744 \uAC00\uC9C8 \uC218 \uC788\uC74C" }), converted?.status === 409 ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uB2E4\uB978 \uAD00\uB9AC\uC790\uAC00 \uBA3C\uC800 Realm\uC744 \uBCC0\uACBD\uD588\uC2B5\uB2C8\uB2E4." }), " \uCD5C\uC2E0 Revision\uC744 \uB2E4\uC2DC \uBD88\uB7EC\uC628 \uB4A4 \uC785\uB825\uD574 \uC8FC\uC138\uC694."] })) : _jsx(MutationError, { error: save.error }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { type: "submit", isDisabled: !editable || name.trim() === "" || save.isPending || (provisioning === "jit" && !acceptSystem), children: save.isPending ? "저장 중…" : `Revision ${realm.revision} 기준 저장` }) })] })] }));
}
function MembershipSection({ realm, memberships, identities, systemRealmId }) {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const [identityId, setIdentityId] = useState("");
    const [profileSource, setProfileSource] = useState("{}");
    const [password, setPassword] = useState("");
    const [profileError, setProfileError] = useState(null);
    const [newIdentifier, setNewIdentifier] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [newProfileSource, setNewProfileSource] = useState("{}");
    const [newReauthPassword, setNewReauthPassword] = useState("");
    const [newProfileError, setNewProfileError] = useState(null);
    const [promoting, setPromoting] = useState(null);
    const [promoteReauthPassword, setPromoteReauthPassword] = useState("");
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.realmMemberships(realm.realmId) });
    const provision = useMutation({
        mutationFn: (profile) => api.identityRealms.provisionMembership(realm.realmId, {
            globalIdentityId: identityId,
            profile,
            password,
        }),
        onSuccess: async () => {
            setPassword("");
            setProfileSource("{}");
            await refresh();
        },
    });
    const register = useMutation({
        mutationFn: (profile) => api.identityRealms.registerMembership(realm.realmId, {
            identifier: newIdentifier.trim(),
            password: newPassword,
            profile,
            reauthPassword: newReauthPassword,
        }),
        onSuccess: async () => {
            setNewIdentifier("");
            setNewPassword("");
            setNewReauthPassword("");
            setNewProfileSource("{}");
            await refresh();
        },
    });
    const changeStatus = useMutation({
        mutationFn: (input) => input.status === "active"
            ? api.identityRealms.reactivateMembership(realm.realmId, input.membership.membershipId, input.membership.revision)
            : api.identityRealms.suspendMembership(realm.realmId, input.membership.membershipId, input.membership.revision),
        onSuccess: refresh,
    });
    const promote = useMutation({
        mutationFn: (membership) => api.identityRealms.grantRealmAdministrator(realm.realmId, membership.membershipId, {
            reauthPassword: promoteReauthPassword,
        }),
        onSuccess: async () => {
            setPromoting(null);
            setPromoteReauthPassword("");
            await refresh();
        },
    });
    const membershipIdentityIds = new Set(memberships.data?.items.map(({ globalIdentityId }) => globalIdentityId));
    const candidates = identities.data?.items.filter((identity) => identity.disabledAt === undefined &&
        identity.originRealmId === systemRealmId &&
        !membershipIdentityIds.has(identity.globalIdentityId)) ?? [];
    const identityById = new Map(identities.data?.items.map((identity) => [identity.globalIdentityId, identity]));
    const canProvision = realm.status === "active" && realm.authentication.acceptSystemIdentities;
    // A brand-new content user is not a System account, so acceptSystemIdentities
    // is irrelevant here — only that the Realm is active.
    const canRegister = realm.status === "active";
    const parseProfile = (source, setError) => {
        setError(null);
        try {
            const value = JSON.parse(source);
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
                setError("Profile은 JSON object여야 합니다.");
                return null;
            }
            return value;
        }
        catch {
            setError("유효한 JSON object를 입력해 주세요.");
            return null;
        }
    };
    const submitProvision = (event) => {
        event.preventDefault();
        const profile = parseProfile(profileSource, setProfileError);
        if (profile !== null)
            provision.mutate(profile);
    };
    const submitRegister = (event) => {
        event.preventDefault();
        const profile = parseProfile(newProfileSource, setNewProfileError);
        if (profile !== null)
            register.mutate(profile);
    };
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "membership-title", children: [_jsx(SectionHeader, { id: "membership-title", title: "\uC0AC\uC6A9\uC790 \uD560\uB2F9", description: "\uC774 Realm\uC5D0 \uC0AC\uC6A9\uC790\uB97C \uC5F0\uACB0(Membership)\uD569\uB2C8\uB2E4. \uC0C8 \uC0AC\uC6A9\uC790\uB97C \uC9C1\uC811 \uB9CC\uB4E4\uC5B4 \uC5F0\uACB0\uD558\uAC70\uB098, \uAE30\uC874 \uC6B4\uC601\uC790(System) \uACC4\uC815\uC744 \uBD99\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC77C\uBC18 \uC0AC\uC6A9\uC790\uB294 \uC2A4\uC2A4\uB85C \uAC00\uC785\uD558\uAC70\uB098 JIT \uB85C\uADF8\uC778\uC73C\uB85C\uB3C4 \uC790\uB3D9 \uC5F0\uACB0\uB429\uB2C8\uB2E4." }), realm.status !== "active" ? (_jsx(Callout, { tone: "warning", children: "\uC774 Realm\uC774 \uD65C\uC131 \uC0C1\uD0DC\uAC00 \uB418\uC5B4\uC57C \uC0AC\uC6A9\uC790\uB97C \uC5F0\uACB0\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : null, identities.isError ? _jsx(LoadError, { error: identities.error, onRetry: () => void identities.refetch() }) : null, _jsxs("div", { className: styles.membershipSubsection, "aria-labelledby": "membership-create-title", children: [_jsx("h3", { id: "membership-create-title", children: "\uC0C8 \uC0AC\uC6A9\uC790 \uB9CC\uB4E4\uC5B4 \uC5F0\uACB0" }), _jsx("p", { className: styles.membershipSubsectionHint, children: "\uC0C8 \uB85C\uADF8\uC778 \uACC4\uC815\uC744 \uB9CC\uB4E4\uACE0 \uACE7\uBC14\uB85C \uC774 Realm\uC5D0 \uC5F0\uACB0\uD569\uB2C8\uB2E4. \uCD08\uAE30 \uBE44\uBC00\uBC88\uD638\uB294 \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uC548\uC804\uD558\uAC8C \uC804\uB2EC\uD574 \uC8FC\uC138\uC694." }), _jsxs("form", { className: styles.provisionForm, onSubmit: submitRegister, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(TextInput, { label: "\uB85C\uADF8\uC778 identifier", value: newIdentifier, onChange: setNewIdentifier, description: "\uC608: \uC774\uBA54\uC77C. \uC774 Realm\uC758 \uB85C\uADF8\uC778 \uC544\uC774\uB514\uB85C \uC0AC\uC6A9\uB429\uB2C8\uB2E4.", isDisabled: !canRegister, isRequired: true }), _jsx(TextInput, { label: "\uCD08\uAE30 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", value: newPassword, onChange: setNewPassword, description: "12\uC790 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4. \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uC548\uC804\uD558\uAC8C \uC804\uB2EC\uD574 \uC8FC\uC138\uC694.", isDisabled: !canRegister, isRequired: true })] }), _jsx(TextAreaField, { label: "\uCD08\uAE30 Profile JSON", value: newProfileSource, onChange: setNewProfileSource, rows: 4, errorMessage: newProfileError ?? undefined, description: "Profile Collection Schema \uAC80\uC99D\uC744 \uD1B5\uACFC\uD574\uC57C \uD569\uB2C8\uB2E4.", isDisabled: !canRegister }), _jsx(TextInput, { label: "\uD604\uC7AC \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: newReauthPassword, onChange: setNewReauthPassword, description: "\uBCF8\uC778 \uD655\uC778\uC744 \uC704\uD574 \uD604\uC7AC \uB85C\uADF8\uC778\uD55C \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD569\uB2C8\uB2E4.", isDisabled: !canRegister, isRequired: true }), _jsx(MutationError, { error: register.error }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { type: "submit", isDisabled: !canRegister || newIdentifier.trim() === "" || newPassword === "" || newReauthPassword === "" || register.isPending, children: register.isPending ? "생성 중…" : "새 사용자 생성 후 연결" }) })] })] }), _jsxs("div", { className: styles.membershipSubsection, "aria-labelledby": "membership-link-title", children: [_jsx("h3", { id: "membership-link-title", children: "\uAE30\uC874 \uC6B4\uC601\uC790 \uACC4\uC815 \uC5F0\uACB0" }), _jsx("p", { className: styles.membershipSubsectionHint, children: "\uC774\uBBF8 \uC874\uC7AC\uD558\uB294 \uC6B4\uC601\uC790(System) \uACC4\uC815\uC744 \uC774 Realm\uC5D0 \uC5F0\uACB0\uD569\uB2C8\uB2E4." }), !realm.authentication.acceptSystemIdentities ? (_jsxs(Callout, { tone: "warning", children: ["\uC6B4\uC601\uC790(System) \uACC4\uC815 \uC5F0\uACB0\uC774 ", _jsx("strong", { children: "Realm \uC124\uC815\uC5D0\uC11C \uAEBC\uC838 \uC788\uC2B5\uB2C8\uB2E4." }), " \uBD99\uC774\uB824\uBA74 \uC704 \u2018Realm \uC124\uC815\u2019\uC5D0\uC11C \u201CSystem Global Identity\uAC00 \uC774 Realm\uC758 Membership\uC744 \uAC00\uC9C8 \uC218 \uC788\uC74C\u201D\uC744 \uCF1C \uC8FC\uC138\uC694."] })) : realm.status === "active" && candidates.length === 0 ? (_jsx(Callout, { tone: "info", children: "\uC5F0\uACB0\uD560 \uC218 \uC788\uB294 \uC6B4\uC601\uC790(System) \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uBAA8\uB4E0 \uC6B4\uC601\uC790 \uACC4\uC815\uC774 \uC774\uBBF8 \uC774 Realm\uC5D0 \uC5F0\uACB0\uB418\uC5B4 \uC788\uAC70\uB098 \uBE44\uD65C\uC131 \uC0C1\uD0DC\uC785\uB2C8\uB2E4." })) : null, _jsxs("form", { className: styles.provisionForm, onSubmit: submitProvision, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(SelectField, { label: "\uC5F0\uACB0\uD560 \uC6B4\uC601\uC790(System) \uACC4\uC815", value: identityId, options: candidates.map((identity) => ({
                                            value: identity.globalIdentityId,
                                            label: `${identity.primaryIdentifier} · ${identity.globalIdentityId}`,
                                        })), description: "\uC774 Realm\uC5D0 \uC5F0\uACB0\uD560 \uAE30\uC874 \uC6B4\uC601\uC790 \uACC4\uC815\uC744 \uC120\uD0DD\uD569\uB2C8\uB2E4.", onChange: setIdentityId, isDisabled: !canProvision || identities.isPending || candidates.length === 0 }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: password, onChange: setPassword, isDisabled: !canProvision, isRequired: true })] }), _jsx(TextAreaField, { label: "\uCD08\uAE30 Profile JSON", value: profileSource, onChange: setProfileSource, rows: 4, errorMessage: profileError ?? undefined, description: "Profile Collection Schema \uAC80\uC99D\uC744 \uD1B5\uACFC\uD574\uC57C \uD569\uB2C8\uB2E4.", isDisabled: !canProvision }), _jsx(MutationError, { error: provision.error }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { type: "submit", isDisabled: !canProvision || identityId === "" || password === "" || provision.isPending, children: provision.isPending ? "연결 중…" : "운영자 계정 연결" }) })] })] }), memberships.isPending ? _jsx(PageLoading, { label: "Membership\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, memberships.isError ? _jsx(LoadError, { error: memberships.error, onRetry: () => void memberships.refetch() }) : null, memberships.data?.items.length === 0 ? _jsx(EmptyState, { title: "\uC5F0\uACB0\uB41C \uC0AC\uC6A9\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC704 \uD3FC\uC73C\uB85C \uC0C8 \uC0AC\uC6A9\uC790\uB97C \uB9CC\uB4E4\uAC70\uB098 \uC6B4\uC601\uC790 \uACC4\uC815\uC744 \uC5F0\uACB0\uD558\uBA74, \uB610\uB294 \uC77C\uBC18 \uC0AC\uC6A9\uC790\uAC00 \uAC00\uC785/JIT \uB85C\uADF8\uC778\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4." }) : null, memberships.data && memberships.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Global Identity" }), _jsx("th", { children: "Realm Subject" }), _jsx("th", { children: "Profile Document" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", { children: "\uC0DD\uC131 \uBC29\uC2DD" }), _jsx("th", { children: "Revision" }), _jsx("th", {})] }) }), _jsx("tbody", { children: memberships.data.items.map((membership) => {
                                const identity = membership.identity ?? identityById.get(membership.globalIdentityId);
                                return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: identity?.primaryIdentifier ?? "Identifier 미제공" }), _jsx(IdValue, { label: "Global Identity ID", value: membership.globalIdentityId }), _jsx(IdValue, { label: "Membership ID", value: membership.membershipId })] }), _jsx("td", { children: _jsx(IdValue, { label: "Subject ID", value: membership.subjectId }) }), _jsx("td", { children: _jsx(IdValue, { label: "Profile Document ID", value: membership.profileDocumentId ?? "프로비저닝 중" }) }), _jsx("td", { children: _jsx(MembershipStatusBadge, { status: membership.status }) }), _jsx("td", { children: provisionedByLabel(membership.provisionedBy) }), _jsx("td", { children: membership.revision }), _jsx("td", { children: _jsxs("div", { className: styles.rowActions, children: [membership.status === "active" && realm.kind === "content" ? (_jsx(Button, { size: "small", variant: "secondary", isDisabled: realm.status !== "active" || promote.isPending, onPress: () => { setPromoting(membership); setPromoteReauthPassword(""); }, children: "\uAD00\uB9AC\uC790\uB85C \uC9C0\uC815" })) : null, membership.status === "active" ? (_jsx(Button, { size: "small", variant: "danger", isDisabled: realm.status !== "active" || changeStatus.isPending, onPress: () => changeStatus.mutate({ membership, status: "suspended" }), children: "\uC815\uC9C0" })) : membership.status === "suspended" ? (_jsx(Button, { size: "small", variant: "secondary", isDisabled: realm.status !== "active" || changeStatus.isPending, onPress: () => changeStatus.mutate({ membership, status: "active" }), children: "\uC7AC\uD65C\uC131\uD654" })) : _jsx(Badge, { tone: "warning", children: "\uC644\uB8CC \uB300\uAE30" })] }) })] }, membership.membershipId));
                            }) })] }) })) : null, _jsx(MutationError, { error: changeStatus.error }), promoting ? (_jsx(ConfirmDialog, { title: "Realm \uAD00\uB9AC\uC790\uB85C \uC9C0\uC815", confirmLabel: "\uAD00\uB9AC\uC790\uB85C \uC9C0\uC815", isPending: promote.isPending, isConfirmDisabled: promoteReauthPassword === "", onCancel: () => { setPromoting(null); setPromoteReauthPassword(""); }, onConfirm: () => promote.mutate(promoting), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("strong", { children: (promoting.identity ?? identityById.get(promoting.globalIdentityId))?.primaryIdentifier ?? promoting.subjectId }), " \uB2D8\uC5D0\uAC8C \uC774 Realm\uC758 ", _jsx("strong", { children: "\uAD00\uB9AC\uC790(content-administrator)" }), " \uAD8C\uD55C\uC744 \uBD80\uC5EC\uD569\uB2C8\uB2E4. \uC774\uD6C4 \uC774 \uACC4\uC815\uC73C\uB85C \u201CRealm \uAD8C\uD55C \uAD00\uB9AC\u201D \uD654\uBA74\uC5D0 \uB4E4\uC5B4\uAC00 \uAD8C\uD55C\uC744 \uC9C1\uC811 \uAD00\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."] }), _jsx(MutationError, { error: promote.error }), _jsx(TextInput, { label: "\uD604\uC7AC \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: promoteReauthPassword, onChange: setPromoteReauthPassword, description: "\uBCF8\uC778 \uD655\uC778\uC744 \uC704\uD574 \uD604\uC7AC \uB85C\uADF8\uC778\uD55C \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD569\uB2C8\uB2E4.", isRequired: true })] }) })) : null] }));
}
function provisionedByLabel(value) {
    switch (value) {
        case "explicit": return "관리자 명시적 생성";
        case "invitation": return "초대";
        case "jit": return "JIT 로그인";
        case "account-link": return "계정 연결";
        case "signup": return "가입";
    }
}
function IdValue({ label, value }) {
    return _jsxs("span", { className: styles.idValue, children: [_jsx("span", { children: label }), _jsx("code", { children: value })] });
}
function FullAccessSection({ realm, memberships, bindings, identities }) {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const [subjectId, setSubjectId] = useState("");
    const [reason, setReason] = useState("");
    const [validUntil, setValidUntil] = useState("");
    const [password, setPassword] = useState("");
    const [revoking, setRevoking] = useState(null);
    const [revokePassword, setRevokePassword] = useState("");
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.realmFullAccess(realm.realmId) });
    const grant = useMutation({
        mutationFn: () => api.identityRealms.grantFullAccess(realm.realmId, {
            subjectId,
            reason: reason.trim(),
            password,
            ...(localInstant(validUntil) === undefined ? {} : { validUntil: localInstant(validUntil) }),
        }),
        onSuccess: async () => {
            setSubjectId("");
            setReason("");
            setValidUntil("");
            setPassword("");
            await refresh();
        },
    });
    const revoke = useMutation({
        mutationFn: () => api.identityRealms.revokeFullAccess(realm.realmId, revoking.bindingId, revokePassword),
        onSuccess: async () => {
            setRevoking(null);
            setRevokePassword("");
            await refresh();
        },
    });
    const identityById = new Map(identities.map((identity) => [identity.globalIdentityId, identity]));
    const activeMemberships = memberships.filter(({ status }) => status === "active");
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "full-access-title", children: [_jsx(SectionHeader, { id: "full-access-title", title: "Realm Full Access", description: "\uD604\uC7AC\uC640 \uBBF8\uB798\uC758 \uC774 Realm \uB9AC\uC18C\uC2A4\uC5D0\uB9CC \uC801\uC6A9\uB418\uB294 \uBCC4\uB3C4 \uBCF4\uD638 \uBC14\uC778\uB529\uC785\uB2C8\uB2E4." }), _jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uBCF5\uAD6C\uC640 \uCD08\uAE30 \uC124\uC815\uC5D0\uB9CC \uC0AC\uC6A9\uD558\uC138\uC694." }), " \uC77C\uBC18 \uC6B4\uC601 \uAD8C\uD55C\uC740 Realm Role Binding\uC73C\uB85C \uBD80\uC5EC\uD574\uC57C \uD558\uBA70, grant\uC640 revoke \uBAA8\uB450 \uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638\uB97C \uC7AC\uAC80\uC99D\uD569\uB2C8\uB2E4."] }), _jsxs("form", { className: styles.formStack, onSubmit: (event) => { event.preventDefault(); grant.mutate(); }, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(SelectField, { label: "\uB300\uC0C1 Realm Subject", value: subjectId, options: activeMemberships.map((membership) => ({
                                    value: membership.subjectId,
                                    label: `${identityById.get(membership.globalIdentityId)?.primaryIdentifier ?? membership.globalIdentityId} · Subject ${membership.subjectId}`,
                                })), description: "Global Identity ID\uAC00 \uC544\uB2CC \uC774 Realm\uC758 Subject ID\uC5D0 \uBD80\uC5EC\uD569\uB2C8\uB2E4.", onChange: setSubjectId, isDisabled: realm.status !== "active" || activeMemberships.length === 0 }), _jsx(TextInput, { label: "\uB9CC\uB8CC \uC2DC\uAC01", type: "datetime-local", value: validUntil, onChange: setValidUntil, description: "\uBE44\uC6CC \uB450\uBA74 revoke\uD560 \uB54C\uAE4C\uC9C0 \uC720\uC9C0\uB429\uB2C8\uB2E4.", isDisabled: realm.status !== "active" }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: password, onChange: setPassword, isDisabled: realm.status !== "active", isRequired: true })] }), _jsx(TextAreaField, { label: "\uBD80\uC5EC \uC0AC\uC720", value: reason, onChange: setReason, rows: 3, isDisabled: realm.status !== "active", isRequired: true }), _jsx(MutationError, { error: grant.error }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { type: "submit", isDisabled: realm.status !== "active" || subjectId === "" || reason.trim() === "" || password === "" || grant.isPending, children: grant.isPending ? "부여 중…" : "Full Access 부여" }) })] }), bindings.isPending ? _jsx(PageLoading, { label: "Full Access \uBC14\uC778\uB529\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, bindings.isError ? _jsx(LoadError, { error: bindings.error, onRetry: () => void bindings.refetch() }) : null, bindings.data?.items.length === 0 ? _jsx(EmptyState, { title: "Full Access \uBC14\uC778\uB529\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uD544\uC694\uD55C Role\uACFC Scope\uB9CC \uBD80\uC5EC\uD558\uB294 \uC0C1\uD0DC\uAC00 \uAC00\uC7A5 \uC548\uC804\uD569\uB2C8\uB2E4." }) : null, bindings.data && bindings.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\uB300\uC0C1 Subject" }), _jsx("th", { children: "\uBD80\uC5EC \uC0AC\uC720" }), _jsx("th", { children: "\uBD80\uC5EC\uC790" }), _jsx("th", { children: "\uC720\uD6A8 \uAE30\uAC04" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", {})] }) }), _jsx("tbody", { children: bindings.data.items.map((binding) => {
                                const revoked = binding.revokedAt !== undefined;
                                const expired = binding.validUntil !== undefined && Date.parse(binding.validUntil) <= Date.now();
                                return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx(IdValue, { label: "Subject ID", value: binding.subjectId }), _jsx(IdValue, { label: "Full Access Binding ID", value: binding.bindingId })] }), _jsx("td", { children: binding.reason }), _jsxs("td", { children: [_jsx(IdValue, { label: "Global Identity ID", value: binding.grantedByGlobalIdentityId }), _jsx(IdValue, { label: "Subject ID", value: binding.grantedBySubjectId })] }), _jsxs("td", { children: [formatInstant(binding.createdAt), _jsxs("span", { className: styles.secondaryLine, children: ["\uB9CC\uB8CC ", formatInstant(binding.validUntil)] })] }), _jsx("td", { children: revoked ? _jsx(Badge, { tone: "neutral", children: "\uD574\uC9C0\uB428" }) : expired ? _jsx(Badge, { tone: "warning", children: "\uB9CC\uB8CC\uB428" }) : _jsx(Badge, { tone: "danger", children: "\uD65C\uC131 Full Access" }) }), _jsx("td", { children: !revoked ? _jsx(Button, { size: "small", variant: "danger", onPress: () => { setRevoking(binding); setRevokePassword(""); }, children: "\uD574\uC9C0" }) : null })] }, binding.bindingId));
                            }) })] }) })) : null, _jsx(MutationError, { error: revoke.error }), revoking ? (_jsx(ConfirmDialog, { title: "Realm Full Access \uD574\uC9C0", confirmLabel: "Full Access \uD574\uC9C0", danger: true, isPending: revoke.isPending, isConfirmDisabled: revokePassword === "", onCancel: () => { setRevoking(null); setRevokePassword(""); }, onConfirm: () => revoke.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("code", { children: revoking.subjectId }), " Subject\uC758 Full Access\uB97C \uD574\uC9C0\uD569\uB2C8\uB2E4."] }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: revokePassword, onChange: setRevokePassword, isRequired: true })] }) })) : null] }));
}
//# sourceMappingURL=identity-realm-pages.js.map