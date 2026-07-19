import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SCHEMA_NAME_ERROR_MESSAGE, SCHEMA_NAME_PATTERN, toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Badge, Button, Callout, CheckboxField, ConfirmDialog, EmptyState, SelectField, TextAreaField, TextInput, } from "@xecms/ui";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { LoadError, PageLoading, RealmAuthorizationError } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { Tabs, TabDangerDot } from "../components/tabs.js";
import { Checklist } from "../components/stepper.js";
import { isRealmSetupIncomplete, ownerCandidateMemberships, realmSetupSteps } from "./realm-setup.js";
import { DisplayModeGate, displayModeAtLeast, useDisplayMode } from "../display-mode.js";
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
function realmDetailTab(value) {
    return value === "members" || value === "profile" || value === "access" ? value : "overview";
}
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
function defaultProfileCollectionName(realmKey) {
    const camel = realmKey.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
    const prefixed = /^[a-z]/.test(camel) ? camel : `realm${camel}`;
    return `${prefixed}Accounts`.slice(0, 64);
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
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Identity federation", title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uAD00\uB9AC", description: "\uACC4\uC815\uC758 \uB85C\uADF8\uC778 \uC790\uACA9 \uC99D\uBA85\uC740 \uACF5\uC720\uD558\uB418 \uC18C\uC18D\u00B7\uAD8C\uD55C \uB300\uC0C1\u00B7\uAD8C\uD55C\uC740 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uBCC4\uB85C \uBD84\uB9AC\uD569\uB2C8\uB2E4.", actions: _jsxs(Button, { onPress: () => setCreating((value) => !value), children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC0C8 \uC0AC\uC6A9\uC790 \uACF5\uAC04"] }) }), creating ? (_jsx(CreateRealmForm, { isPending: create.isPending, error: create.error, onCancel: () => setCreating(false), onSubmit: (input) => create.mutate(input) })) : null, realms.isPending ? _jsx(PageLoading, { label: "\uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, realms.isError ? _jsx(RealmAuthorizationError, { error: realms.error, context: "list", onRetry: () => void realms.refetch() }) : null, realms.data?.items.length === 0 ? (_jsx(EmptyState, { title: "\uB4F1\uB85D\uB41C \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uCCAB \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uB9CC\uB4E4\uC5B4 \uB3C5\uB9BD\uB41C \uD68C\uC6D0\u00B7\uACE0\uAC1D \uACC4\uC815 \uC601\uC5ED\uC744 \uAD6C\uC131\uD558\uC138\uC694.", action: _jsx(Button, { onPress: () => setCreating(true), children: "\uC0C8 \uC0AC\uC6A9\uC790 \uACF5\uAC04" }) })) : null, realms.data && realms.data.items.length > 0 ? (_jsx("div", { className: styles.realmGrid, children: realms.data.items.map((realm) => (_jsxs(Link, { className: styles.realmCard, to: `/admin/realms/${encodeURIComponent(realm.realmId)}`, children: [_jsxs("div", { className: styles.realmCardHeader, children: [_jsx("span", { className: styles.realmIcon, children: _jsx(Icon, { name: "identity", size: 20 }) }), _jsx(RealmStatusBadge, { realm: realm })] }), _jsxs("div", { className: styles.realmCardBody, children: [_jsx("h2", { children: realm.name }), _jsx("code", { children: realm.realmKey })] }), _jsxs("dl", { className: styles.compactFacts, children: [_jsxs("div", { children: [_jsx("dt", { children: "Realm ID" }), _jsx("dd", { children: realm.realmId })] }), _jsxs("div", { children: [_jsx("dt", { children: "Revision" }), _jsx("dd", { children: realm.revision })] }), realm.kind === "content" ? _jsxs("div", { children: [_jsx("dt", { children: "Profile Collection" }), _jsx("dd", { children: realm.profileCollectionId ?? "연결 대기" })] }) : null] }), _jsxs("div", { className: styles.realmCardFooter, children: [_jsx("span", { children: realm.kind === "system" ? "CMS 운영 계정 영역" : realm.authentication.registration === "open" ? "공개 가입 허용" : "관리자 승인형" }), _jsx(Icon, { name: "arrowRight", size: 14 })] })] }, realm.realmId))) })) : null] }));
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
    return (_jsxs("section", { className: styles.formCard, "aria-labelledby": "create-realm-title", children: [_jsx(SectionHeader, { id: "create-realm-title", title: "\uC0C8 \uC0AC\uC6A9\uC790 \uACF5\uAC04(Realm)", description: "Profile Collection \uC5F0\uACB0\uC740 Schema auth \uC124\uC815\uC774 \uC801\uC6A9\uB420 \uB54C \uC644\uB8CC\uB429\uB2C8\uB2E4." }), _jsxs("form", { className: styles.formStack, onSubmit: (event) => {
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
                }, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(TextInput, { label: "\uD45C\uC2DC \uC774\uB984", value: name, onChange: setName, placeholder: "Community", isRequired: true }), _jsx(TextInput, { label: "\uACF5\uAC04 Key (Realm Key)", value: key, onChange: (value) => setKey(value.toLocaleLowerCase("en-US")), description: "URL\uACFC \uAD8C\uD55C namespace\uC5D0 \uC0AC\uC6A9\uB418\uB294 \uBCC0\uACBD \uBD88\uAC00 slug\uC785\uB2C8\uB2E4.", placeholder: "community", isRequired: true }), _jsx(SelectField, { label: "\uAC00\uC785 \uC815\uCC45", value: registration, options: registrationOptions, onChange: (value) => setRegistration(value) }), _jsx(SelectField, { label: "\uC6B4\uC601\uC790 \uACC4\uC815 \uC5F0\uACB0", value: provisioning, options: provisioningOptions, onChange: (value) => {
                                    const next = value;
                                    setProvisioning(next);
                                    if (next === "jit")
                                        setAcceptSystem(true);
                                } }), _jsx(TextInput, { label: "\uAE30\uBCF8 \uC5ED\uD560 ID (Role IDs)", value: defaultRoles, onChange: setDefaultRoles, description: "\uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4. \uBE44\uC6CC \uB450\uBA74 \uB85C\uADF8\uC778\uB9CC \uD5C8\uC6A9\uB429\uB2C8\uB2E4." })] }), _jsx(CheckboxField, { isSelected: acceptSystem, onChange: setAcceptSystem, isDisabled: provisioning === "jit", children: "\uAE30\uC874 \uC6B4\uC601\uC790 \uACC4\uC815\uC758 \uC18C\uC18D \uC0DD\uC131\uC744 \uD5C8\uC6A9" }), _jsx(MutationError, { error: error }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { type: "button", variant: "secondary", onPress: onCancel, isDisabled: isPending, children: "\uCDE8\uC18C" }), _jsx(Button, { type: "submit", isDisabled: !valid || isPending, children: isPending ? "생성 중…" : "사용자 공간 생성" })] })] })] }));
}
export function IdentityRealmDetailPage() {
    const { realmId } = useParams();
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { mode } = useDisplayMode();
    const [searchParams, setSearchParams] = useSearchParams();
    const [profileSetupOpen, setProfileSetupOpen] = useState(false);
    const [detailTab, setDetailTabState] = useState(() => realmDetailTab(searchParams.get("tab")));
    const setDetailTab = (tab) => {
        setDetailTabState(tab);
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            if (tab === "overview")
                next.delete("tab");
            else
                next.set("tab", tab);
            return next;
        }, { replace: true });
    };
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
    const owner = useQuery({
        queryKey: queryKeys.realmOwner(realmId ?? "missing"),
        queryFn: () => api.identityRealms.getOwner(realmId),
        enabled: realmId !== undefined && isContent,
        retry: false,
    });
    const fullAccess = useQuery({
        queryKey: queryKeys.realmFullAccess(realmId ?? "missing"),
        queryFn: () => api.identityRealms.listFullAccess(realmId),
        enabled: realmId !== undefined && isContent,
        retry: false,
    });
    const createProfileSchema = useMutation({
        mutationFn: (input) => api.identityRealms.createProfileSchema(realmId, input),
        onSuccess: async (nextRealm) => {
            queryClient.setQueryData(queryKeys.identityRealm(nextRealm.realmId), nextRealm);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.identityRealms }),
                queryClient.invalidateQueries({ queryKey: queryKeys.collections }),
            ]);
            setProfileSetupOpen(false);
        },
    });
    if (realmId === undefined)
        return _jsx(Page, { children: _jsx(Callout, { tone: "error", children: "\uACF5\uAC04 ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." }) });
    if (realm.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC0C1\uC138 \uC815\uBCF4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (realm.isError)
        return _jsx(Page, { children: _jsx(RealmAuthorizationError, { error: realm.error, context: "detail", onRetry: () => void realm.refetch() }) });
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: realm.data.kind === "system" ? "운영자 공간(System Realm)" : "사용자 공간(Content Realm)", title: realm.data.name, description: realm.data.kind === "system"
                    ? "CMS 운영 계정과 Admin 세션의 보호된 운영자 공간입니다."
                    : "계정의 로그인 자격 증명과 이 공간의 소속·권한 대상·프로필 연결을 관리합니다.", actions: _jsxs(_Fragment, { children: [_jsx(RealmStatusBadge, { realm: realm.data }), _jsx(Button, { variant: "secondary", onPress: () => navigate("/admin/realms"), children: "\uBAA9\uB85D\uC73C\uB85C" })] }) }), _jsx(RealmIdentitySummary, { realm: realm.data }), realm.data.kind === "system" ? (_jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "\uC6B4\uC601\uC790 \uACF5\uAC04\uC740 \uC774 \uD654\uBA74\uC5D0\uC11C \uC218\uC815\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." }), " \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC5D0 \uC6B4\uC601 \uACC4\uC815\uC744 \uC5F0\uACB0\uD574\uB3C4 \uC6B4\uC601 \uAD8C\uD55C\uC774 \uC804\uD30C\uB418\uC9C0\uB294 \uC54A\uC2B5\uB2C8\uB2E4."] })) : (_jsxs(_Fragment, { children: [_jsx(RealmSetupChecklist, { realm: realm.data, owner: owner.data, memberships: memberships.data?.items, ownerCandidateCount: ownerCandidateMemberships({
                            memberships: memberships.data?.items,
                            identities: identities.data?.items,
                            owner: owner.data,
                            systemRealmId: realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system",
                        }).length, onOpenProfileSetup: () => setProfileSetupOpen(true), onGoMembers: () => setDetailTab("members"), onGoAccess: () => navigate(`/admin/realms/${encodeURIComponent(realm.data.realmId)}/access/${mode === "basic" ? "grades" : "roles"}`) }), realm.data.status === "provisioning" && displayModeAtLeast(mode, "advanced") ? (_jsxs(Callout, { tone: "info", children: ["\uACE0\uAE09: \uC9C1\uC811 Schema\uB97C \uC124\uACC4\uD558\uB824\uBA74 ", _jsx(Button, { size: "small", variant: "quiet", onPress: () => navigate("/admin/schema/new"), children: "\uC2A4\uD0A4\uB9C8 \uD3B8\uC9D1\uAE30\uB85C \uC774\uB3D9" }), "\uD558\uC138\uC694."] })) : null, realm.data.status === "disabled" ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC740 \uBE44\uD65C\uC131 \uC0C1\uD0DC\uC785\uB2C8\uB2E4." }), " \uC2E0\uADDC \uC138\uC158, \uC18C\uC18D provisioning\uACFC Full Access grant\uAC00 \uCC28\uB2E8\uB429\uB2C8\uB2E4."] })) : null, _jsx(RealmDetailTabs, { active: detailTab, hasProfile: realm.data.profileCollectionId !== undefined, fullAccessActive: (fullAccess.data?.activeBinding !== undefined && isActiveFullAccess(fullAccess.data.activeBinding))
                            || fullAccess.data?.items.some(isActiveFullAccess) === true, onChange: setDetailTab }), detailTab === "overview" ? _jsx(RealmSettingsForm, { realm: realm.data }) : null, detailTab === "members" ? (_jsxs(_Fragment, { children: [_jsx(RealmOwnerSection, { realm: realm.data, owner: owner, memberships: memberships, identities: identities, systemRealmId: realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system" }), _jsx(MembershipSection, { realm: realm.data, owner: owner, memberships: memberships, identities: identities, systemRealmId: realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system" })] })) : null, detailTab === "profile" && realm.data.profileCollectionId !== undefined ? (_jsx(RealmProfileFieldsSection, { realm: realm.data })) : null, detailTab === "access" ? (_jsxs(_Fragment, { children: [_jsx(RealmAccessOverview, { realm: realm.data, mode: mode }), _jsx(FullAccessSection, { realm: realm.data, bindings: fullAccess, mode: mode })] })) : null, profileSetupOpen ? (_jsx(ProfileSchemaSetupDialog, { realm: realm.data, error: createProfileSchema.error, isPending: createProfileSchema.isPending, onCancel: () => { setProfileSetupOpen(false); createProfileSchema.reset(); }, onConfirm: (input) => createProfileSchema.mutate(input) })) : null] }))] }));
}
const STEP_LABEL = {
    activate: "1. 스키마 연결 · 활성화",
    owner: "2. 소유자 지정",
    administrator: "3. 관리자 지정",
    access: "4. 권한 구성",
};
/**
 * Setup progress for a Content Realm, derived entirely from already-loaded
 * queries. Turns the hidden ordering (activate → owner → administrator →
 * access) into a visible checklist and — crucially — previews the bootstrap
 * deadlock before the operator is bounced out of the policy screen.
 */
function RealmSetupChecklist({ realm, owner, memberships, ownerCandidateCount, onOpenProfileSetup, onGoMembers, onGoAccess, }) {
    const steps = realmSetupSteps({ realm, owner, memberships, ownerCandidateCount });
    if (!isRealmSetupIncomplete(steps))
        return null;
    const byId = new Map(steps.map((step) => [step.id, step.status]));
    const stepDefs = steps.map((step) => {
        const base = { id: step.id, label: STEP_LABEL[step.id], status: step.status };
        if (step.id === "activate" && step.status !== "done") {
            return {
                ...base,
                description: "로그인 identifier와 기본 Profile 필드를 정하면 Collection 생성·연결·활성화를 한 번에 처리합니다.",
                action: _jsx(Button, { size: "small", onPress: onOpenProfileSetup, children: "\uAE30\uBCF8 \uC778\uC99D \uC2A4\uD0A4\uB9C8 \uC0DD\uC131" }),
            };
        }
        if (step.id === "owner" && step.status === "blocked") {
            return {
                ...base,
                description: "소유자로 지정할 활성 운영자가 아직 없습니다. ‘사용자’ 탭에서 기존 운영자를 먼저 연결하세요.",
                action: _jsx(Button, { size: "small", variant: "secondary", onPress: onGoMembers, children: "\uC0AC\uC6A9\uC790 \uD0ED\uC73C\uB85C \uC774\uB3D9" }),
            };
        }
        if (step.id === "owner" && step.status === "current") {
            return {
                ...base,
                description: "이 공간의 사람 최고관리자를 지정해 운영 연속성을 확보하세요.",
                action: _jsx(Button, { size: "small", onPress: onGoMembers, children: "\uC18C\uC720\uC790 \uC9C0\uC815\uD558\uB7EC \uAC00\uAE30" }),
            };
        }
        if (step.id === "administrator" && step.status === "current") {
            return {
                ...base,
                description: "공간을 활성화해도 만든 본인은 권한 화면에 들어갈 수 없습니다. ‘사용자’ 탭에서 본인(또는 담당자)을 관리자로 지정하세요.",
                action: _jsx(Button, { size: "small", onPress: onGoMembers, children: "\uAD00\uB9AC\uC790 \uC9C0\uC815\uD558\uB7EC \uAC00\uAE30" }),
            };
        }
        if (step.id === "access" && step.status === "current") {
            return {
                ...base,
                description: "이제 권한 등급·역할·배정을 구성할 수 있습니다.",
                action: _jsx(Button, { size: "small", variant: "secondary", onPress: onGoAccess, children: "\uAD8C\uD55C \uAD6C\uC131\uC73C\uB85C \uC774\uB3D9" }),
            };
        }
        return base;
    });
    const tone = byId.get("owner") === "blocked" ? "warning" : "info";
    return (_jsx(Callout, { tone: tone, children: _jsx(Checklist, { title: "\uC124\uC815 \uC9C4\uD589 \uC0C1\uD0DC", steps: stepDefs }) }));
}
function RealmDetailTabs({ active, hasProfile, fullAccessActive, onChange }) {
    const tabs = [
        { id: "overview", label: "개요" },
        { id: "members", label: "사용자" },
        { id: "profile", label: "프로필 필드", disabled: !hasProfile },
        { id: "access", label: "권한", badge: fullAccessActive ? _jsx(TabDangerDot, { label: "Full Access \uC0AC\uC6A9 \uC911" }) : undefined },
    ];
    return _jsx(Tabs, { ariaLabel: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC0C1\uC138 \uC601\uC5ED", tabs: tabs, active: active, onChange: onChange });
}
function RealmAccessOverview({ realm, mode }) {
    const navigate = useNavigate();
    const target = mode === "basic" ? "grades" : "roles";
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "realm-access-overview-title", children: [_jsx(SectionHeader, { id: "realm-access-overview-title", title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uAD8C\uD55C", description: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC548\uC5D0\uC11C \uC0AC\uC6A9\uD560 \uAD8C\uD55C \uB4F1\uAE09, \uC5ED\uD560\uACFC \uC0AC\uC6A9\uC790 \uBC30\uC815\uC744 \uAD00\uB9AC\uD569\uB2C8\uB2E4.", actions: _jsx(Button, { onPress: () => navigate(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/${target}`), isDisabled: realm.status !== "active", children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uAD8C\uD55C \uAD00\uB9AC" }) }), _jsx("p", { className: styles.compactHint, children: "\uC77C\uBC18 \uAD8C\uD55C\uC740 \uC5ED\uD560\uACFC Scope\uB85C \uAD00\uB9AC\uD569\uB2C8\uB2E4. Full Access\uB294 CMS Owner\uAC00 \uAE30\uAC04\uC744 \uC815\uD574 \uC815\uCC45\uC744 \uC9C1\uC811 \uBCF5\uAD6C\uD560 \uB54C\uB9CC \uC0AC\uC6A9\uD569\uB2C8\uB2E4." })] }));
}
function ProfileSchemaSetupDialog({ realm, error, isPending, onCancel, onConfirm }) {
    const [collectionName, setCollectionName] = useState(() => defaultProfileCollectionName(realm.realmKey));
    const [collectionLabel, setCollectionLabel] = useState(() => `${realm.name} Accounts`);
    const [identifierFieldName, setIdentifierFieldName] = useState("loginId");
    const [includeDisplayName, setIncludeDisplayName] = useState(true);
    const collectionNameError = collectionName !== "" && !SCHEMA_NAME_PATTERN.test(collectionName)
        ? SCHEMA_NAME_ERROR_MESSAGE
        : undefined;
    const identifierFieldNameError = identifierFieldName !== "" && !SCHEMA_NAME_PATTERN.test(identifierFieldName)
        ? SCHEMA_NAME_ERROR_MESSAGE
        : undefined;
    const converted = error === null || error === undefined ? null : toAdminApiError(error);
    const errorMessage = converted?.code === "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT"
        ? "적용되지 않은 다른 스키마 변경 사항이 있습니다. 먼저 스키마 화면에서 적용하거나 버려 주세요."
        : converted?.code === "COLLECTION_NAME_CONFLICT"
            ? "같은 이름의 Collection이 이미 있습니다. 다른 이름을 사용해 주세요."
            : converted?.message;
    return (_jsx(ConfirmDialog, { title: "\uAE30\uBCF8 \uC778\uC99D \uC2A4\uD0A4\uB9C8 \uC0DD\uC131", confirmLabel: "\uC0DD\uC131\uD558\uACE0 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uD65C\uC131\uD654", isPending: isPending, isConfirmDisabled: collectionName.trim() === ""
            || collectionLabel.trim() === ""
            || identifierFieldName.trim() === ""
            || collectionNameError !== undefined
            || identifierFieldNameError !== undefined, onCancel: onCancel, onConfirm: () => onConfirm({
            collectionName: collectionName.trim(),
            collectionLabel: collectionLabel.trim(),
            identifierFieldName: identifierFieldName.trim(),
            includeDisplayName,
        }), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("strong", { children: realm.name }), " \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 Profile Collection\uC744 \uC0DD\uC131\uD558\uACE0 \uC989\uC2DC Schema\uC5D0 \uC801\uC6A9\uD569\uB2C8\uB2E4."] }), _jsx(TextInput, { label: "Collection \uC774\uB984", value: collectionName, onChange: setCollectionName, description: "API\uC640 \uC800\uC7A5\uC18C\uC5D0\uC11C \uC0AC\uC6A9\uD558\uB294 \uC601\uBB38 \uC774\uB984\uC785\uB2C8\uB2E4.", maxLength: 64, errorMessage: collectionNameError, isRequired: true }), _jsx(TextInput, { label: "\uD45C\uC2DC \uC774\uB984", value: collectionLabel, onChange: setCollectionLabel, isRequired: true }), _jsx(TextInput, { label: "\uB85C\uADF8\uC778 ID \uD544\uB4DC\uBA85", value: identifierFieldName, onChange: setIdentifierFieldName, description: "\uC608: loginId, email, username. \uD544\uC218\u00B7\uACE0\uC720 text \uD544\uB4DC\uB85C \uC0DD\uC131\uB429\uB2C8\uB2E4.", maxLength: 64, errorMessage: identifierFieldNameError, isRequired: true }), _jsx(CheckboxField, { isSelected: includeDisplayName, onChange: setIncludeDisplayName, children: "\uC0AC\uC6A9\uC790 \uD45C\uC2DC \uC774\uB984(displayName) \uD544\uB4DC \uCD94\uAC00" }), _jsx(Callout, { tone: "info", children: "\uC774 \uC791\uC5C5\uC740 \uD604\uC7AC Schema\uC5D0 \uB2E4\uB978 \uBBF8\uC801\uC6A9 \uBCC0\uACBD\uC774 \uC5C6\uC744 \uB54C\uB9CC \uC2E4\uD589\uB418\uBA70, \uC0DD\uC131\uACFC \uC801\uC6A9\uC774 \uB05D\uB098\uBA74 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC774 \uD65C\uC131\uD654\uB429\uB2C8\uB2E4." }), errorMessage ? _jsx(Callout, { tone: "error", children: errorMessage }) : null] }) }));
}
function RealmProfileFieldsSection({ realm }) {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const collectionId = realm.profileCollectionId;
    const [adding, setAdding] = useState(false);
    const profile = useQuery({
        queryKey: queryKeys.collectionApplied(collectionId),
        queryFn: () => api.collections.getApplied(collectionId),
    });
    const diagnostics = useQuery({
        queryKey: queryKeys.diagnostics,
        queryFn: () => api.settings.diagnostics(),
    });
    const editable = diagnostics.data?.schemaMode === "editable" && realm.status === "active";
    const createField = useMutation({
        mutationFn: (input) => api.identityRealms.createProfileField(realm.realmId, input),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.collectionApplied(collectionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.collectionDraft(collectionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.collections }),
            ]);
            setAdding(false);
        },
    });
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "realm-profile-fields-title", children: [_jsx(SectionHeader, { id: "realm-profile-fields-title", title: "\uC0AC\uC6A9\uC790 \uD504\uB85C\uD544 \uD544\uB4DC", description: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uD68C\uC6D0\uC758 Profile \uBB38\uC11C\uC5D0 \uC800\uC7A5\uB418\uB294 \uAE30\uBCF8 \uC815\uBCF4\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4.", actions: _jsxs("div", { className: styles.rowActions, children: [_jsx(Button, { variant: "secondary", onPress: () => navigate(`/admin/schema/${encodeURIComponent(collectionId)}`), children: "\uC2A4\uD0A4\uB9C8\uC5D0\uC11C \uC790\uC138\uD788 \uD3B8\uC9D1" }), _jsx(Button, { isDisabled: !editable, onPress: () => { createField.reset(); setAdding(true); }, children: "\uD504\uB85C\uD544 \uD544\uB4DC \uCD94\uAC00" })] }) }), profile.isPending ? _jsx(PageLoading, { label: "\uC0AC\uC6A9\uC790 \uD504\uB85C\uD544 \uD544\uB4DC\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, profile.isError ? _jsx(LoadError, { error: profile.error, onRetry: () => void profile.refetch() }) : null, profile.data ? _jsx(ProfileFieldList, { collection: profile.data }) : null, realm.status === "disabled" ? (_jsx(Callout, { tone: "warning", children: "\uD504\uB85C\uD544 \uD544\uB4DC\uB97C \uCD94\uAC00\uD558\uB824\uBA74 \uBA3C\uC800 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC124\uC815\uC5D0\uC11C \uC0C1\uD0DC\uB97C \uD65C\uC131\uC73C\uB85C \uBCC0\uACBD\uD574 \uC8FC\uC138\uC694." })) : diagnostics.data && !editable ? (_jsxs(Callout, { tone: "warning", children: ["Schema mode\uAC00 ", _jsx("strong", { children: diagnostics.data.schemaMode }), "\uC774\uBBC0\uB85C \uC774 \uD654\uBA74\uC5D0\uC11C \uD544\uB4DC\uB97C \uCD94\uAC00\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."] })) : null, _jsx("p", { className: styles.compactHint, children: "\uC5EC\uAE30\uC11C\uB294 \uB370\uC774\uD130 \uC190\uC2E4 \uC704\uD5D8\uC774 \uC5C6\uB294 \uC120\uD0DD\uD615 text \uD544\uB4DC\uB9CC \uBC14\uB85C \uCD94\uAC00\uD569\uB2C8\uB2E4. \uC0AD\uC81C, \uD0C0\uC785 \uBCC0\uACBD, \uD544\uC218\uAC12 \uC804\uD658, \uAD00\uACC4\u00B7\uC911\uCCA9 \uD544\uB4DC\uB294 Schema Builder\uC5D0\uC11C \uAC80\uD1A0\uD569\uB2C8\uB2E4." }), adding && profile.data ? (_jsx(AddProfileFieldDialog, { collection: profile.data, error: createField.error, isPending: createField.isPending, onCancel: () => { setAdding(false); createField.reset(); }, onConfirm: (input) => createField.mutate(input) })) : null] }));
}
function ProfileFieldList({ collection }) {
    const identifierIds = new Set(collection.auth?.identifierFieldIds ?? []);
    return (_jsx("ul", { className: styles.profileFieldList, "aria-label": "\uC0AC\uC6A9\uC790 \uD504\uB85C\uD544 \uD544\uB4DC \uBAA9\uB85D", children: collection.fields.map((field) => {
            const identifier = identifierIds.has(field.id);
            return (_jsxs("li", { className: styles.profileFieldItem, children: [_jsxs("div", { className: styles.profileFieldIdentity, children: [_jsx("strong", { children: field.label || field.name }), _jsx("code", { children: field.name })] }), _jsxs("div", { className: styles.profileFieldBadges, children: [identifier ? _jsx(Badge, { tone: "info", children: "\uB85C\uADF8\uC778 ID \u00B7 \uBCF4\uD638\uB428" }) : _jsx(Badge, { tone: "neutral", children: "\uD504\uB85C\uD544" }), _jsx(Badge, { tone: "neutral", children: profileFieldTypeLabel(field) }), _jsx(Badge, { tone: field.required ? "warning" : "neutral", children: field.required ? "필수" : "선택" }), field.unique ? _jsx(Badge, { tone: "neutral", children: "\uACE0\uC720" }) : null] }), _jsx(DisplayModeGate, { minimum: "advanced", children: _jsx("code", { className: styles.profileFieldStableId, children: field.id }) })] }, field.id));
        }) }));
}
function profileFieldTypeLabel(field) {
    switch (field.type) {
        case "text": return "한 줄 text";
        case "textarea": return "여러 줄 text";
        default: return field.type;
    }
}
function AddProfileFieldDialog({ collection, error, isPending, onCancel, onConfirm }) {
    const [name, setName] = useState("");
    const [label, setLabel] = useState("");
    const [type, setType] = useState("text");
    const trimmedName = name.trim();
    const duplicate = collection.fields.some((field) => field.name.toLocaleLowerCase("en-US") === trimmedName.toLocaleLowerCase("en-US"));
    const nameError = trimmedName !== "" && !SCHEMA_NAME_PATTERN.test(trimmedName)
        ? SCHEMA_NAME_ERROR_MESSAGE
        : duplicate ? "같은 필드명이 이미 있습니다." : undefined;
    const converted = error === null || error === undefined ? null : toAdminApiError(error);
    const errorMessage = converted?.code === "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT"
        ? "적용되지 않은 다른 스키마 변경 사항이 있습니다. 먼저 Schema Builder에서 적용하거나 버려 주세요."
        : converted?.code === "PROFILE_FIELD_NAME_CONFLICT"
            ? "같은 필드명이 이미 있습니다. 최신 스키마를 확인해 주세요."
            : converted?.message;
    return (_jsx(ConfirmDialog, { title: "\uD504\uB85C\uD544 \uD544\uB4DC \uCD94\uAC00", confirmLabel: "\uD544\uB4DC \uCD94\uAC00\uD558\uACE0 \uC801\uC6A9", isPending: isPending, isConfirmDisabled: trimmedName === "" || label.trim() === "" || nameError !== undefined, onCancel: onCancel, onConfirm: () => onConfirm({ name: trimmedName, label: label.trim(), type }), children: _jsxs("div", { className: styles.dialogStack, children: [_jsx(TextInput, { label: "\uD544\uB4DC\uBA85", value: name, onChange: setName, description: "\uC608: nickname, phone, introduction", maxLength: 64, errorMessage: nameError, isRequired: true }), _jsx(TextInput, { label: "\uD45C\uC2DC \uC774\uB984", value: label, onChange: setLabel, isRequired: true }), _jsx(SelectField, { label: "\uC785\uB825 \uD615\uD0DC", value: type, onChange: (value) => setType(value), options: [
                        { value: "text", label: "한 줄 text" },
                        { value: "textarea", label: "여러 줄 text" },
                    ] }), _jsx(Callout, { tone: "info", children: "\uC0C8 \uD544\uB4DC\uB294 \uAE30\uC874 \uD68C\uC6D0 \uB370\uC774\uD130\uC5D0 \uC601\uD5A5\uC744 \uC8FC\uC9C0 \uC54A\uB3C4\uB85D \uC120\uD0DD \uC785\uB825\uC73C\uB85C \uC0DD\uC131\uB429\uB2C8\uB2E4." }), errorMessage ? _jsx(Callout, { tone: "error", children: errorMessage }) : null] }) }));
}
function RealmIdentitySummary({ realm }) {
    return (_jsxs("section", { className: styles.summaryGrid, "aria-label": "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC2DD\uBCC4 \uC815\uBCF4", children: [_jsxs("div", { children: [_jsx("span", { children: "Realm ID" }), _jsx("code", { children: realm.realmId })] }), _jsxs("div", { children: [_jsx("span", { children: "Realm Key" }), _jsx("code", { children: realm.realmKey })] }), _jsxs("div", { children: [_jsx("span", { children: "Profile Collection ID" }), _jsx("code", { children: realm.profileCollectionId ?? "연결 대기" })] }), _jsxs("div", { children: [_jsx("span", { children: "\uACF5\uAC04 \uBC84\uC804 (Revision)" }), _jsx("strong", { children: realm.revision })] })] }));
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
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "realm-settings-title", children: [_jsx(SectionHeader, { id: "realm-settings-title", title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC124\uC815", description: `공간 버전 ${realm.revision}을 기준으로 충돌 없이 저장합니다.` }), editable ? null : (_jsx(Callout, { tone: "info", children: "Auth Collection\uC744 \uC5F0\uACB0\uD574 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC774 \uD65C\uC131\uD654\uB418\uAE30 \uC804\uAE4C\uC9C0\uB294 \uC124\uC815\uC744 \uBCC0\uACBD\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC704 \uC548\uB0B4\uC5D0 \uB530\uB77C \uC2A4\uD0A4\uB9C8\uB97C \uC801\uC6A9\uD574 \uC8FC\uC138\uC694." })), _jsxs("form", { className: styles.formStack, onSubmit: (event) => { event.preventDefault(); if (editable)
                    save.mutate(); }, children: [_jsxs("div", { className: styles.settingsFieldGrid, children: [_jsx(TextInput, { label: "\uD45C\uC2DC \uC774\uB984", value: name, onChange: setName, isDisabled: !editable, isRequired: true }), _jsx(SelectField, { label: "\uC0C1\uD0DC", value: status, options: statusOptions, onChange: (value) => setStatus(value), isDisabled: !editable }), _jsx(SelectField, { label: "\uAC00\uC785 \uC815\uCC45", value: registration, options: registrationOptions, onChange: (value) => setRegistration(value), isDisabled: !editable }), _jsx(SelectField, { label: "\uC6B4\uC601\uC790 \uACC4\uC815 provisioning", value: provisioning, options: provisioningOptions, onChange: (value) => {
                                    const next = value;
                                    setProvisioning(next);
                                    if (next === "jit")
                                        setAcceptSystem(true);
                                }, isDisabled: !editable }), _jsx(TextInput, { label: "\uAE30\uBCF8 \uC5ED\uD560 ID (Role IDs)", value: defaultRoles, onChange: setDefaultRoles, description: "\uC0C8 \uC18C\uC18D\uC758 \uAD8C\uD55C \uB300\uC0C1\uC5D0 \uC801\uC6A9\uD560 Role ID\uB97C \uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4.", isDisabled: !editable })] }), _jsx(CheckboxField, { isSelected: acceptSystem, onChange: setAcceptSystem, isDisabled: !editable || provisioning === "jit", children: "\uC6B4\uC601\uC790 \uACC4\uC815\uC774 \uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 \uC18C\uC18D\uC744 \uAC00\uC9C8 \uC218 \uC788\uC74C" }), converted?.status === 409 ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uB2E4\uB978 \uAD00\uB9AC\uC790\uAC00 \uBA3C\uC800 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uBCC0\uACBD\uD588\uC2B5\uB2C8\uB2E4." }), " \uCD5C\uC2E0 \uBC84\uC804\uC744 \uB2E4\uC2DC \uBD88\uB7EC\uC628 \uB4A4 \uC785\uB825\uD574 \uC8FC\uC138\uC694."] })) : _jsx(MutationError, { error: save.error }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { type: "submit", isDisabled: !editable || name.trim() === "" || save.isPending || (provisioning === "jit" && !acceptSystem), children: save.isPending ? "저장 중…" : `Revision ${realm.revision} 기준 저장` }) })] })] }));
}
function RealmOwnerSection({ realm, owner, memberships, identities, systemRealmId }) {
    const api = useAdminApi();
    const queryClient = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [targetMembershipId, setTargetMembershipId] = useState("");
    const [reason, setReason] = useState("");
    const [password, setPassword] = useState("");
    const [revokePreviousSessions, setRevokePreviousSessions] = useState(true);
    const [suspendPreviousMembership, setSuspendPreviousMembership] = useState(false);
    const identityById = new Map(identities.data?.items.map((identity) => [identity.globalIdentityId, identity]));
    const candidates = ownerCandidateMemberships({
        memberships: memberships.data?.items,
        identities: identities.data?.items,
        owner: owner.data,
        systemRealmId,
    });
    const operation = owner.data?.status === "healthy"
        ? "transfer"
        : owner.data?.status === "invalid" ? "recover" : "assign";
    const operationLabel = operation === "transfer" ? "소유자 교체" : operation === "recover" ? "소유자 복구" : "소유자 지정";
    const changeOwner = useMutation({
        mutationFn: () => {
            const base = {
                targetMembershipId,
                expectedPolicyRevision: owner.data.policyRevision,
                reason: reason.trim(),
                password,
            };
            if (operation === "assign")
                return api.identityRealms.assignOwner(realm.realmId, base);
            if (operation === "recover")
                return api.identityRealms.recoverOwner(realm.realmId, base);
            return api.identityRealms.transferOwner(realm.realmId, {
                ...base,
                revokePreviousSessions,
                suspendPreviousMembership,
            });
        },
        onSuccess: async (nextOwner) => {
            queryClient.setQueryData(queryKeys.realmOwner(realm.realmId), nextOwner);
            setDialogOpen(false);
            setTargetMembershipId("");
            setReason("");
            setPassword("");
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.realmMemberships(realm.realmId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.realmAuthorization(realm.realmId) }),
            ]);
        },
    });
    const openDialog = () => {
        changeOwner.reset();
        setTargetMembershipId("");
        setReason("");
        setPassword("");
        setRevokePreviousSessions(true);
        setSuspendPreviousMembership(false);
        setDialogOpen(true);
    };
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "realm-owner-title", "data-owner-status": owner.data?.status, children: [_jsx(SectionHeader, { id: "realm-owner-title", title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC720\uC790(Realm Owner)", description: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 \uC2E4\uC81C \uC0AC\uB78C \uCD5C\uACE0\uAD00\uB9AC\uC790\uC640 \uC6B4\uC601 \uC5F0\uC18D\uC131\uC744 \uAD00\uB9AC\uD569\uB2C8\uB2E4.", actions: owner.data ? (_jsx(Button, { variant: owner.data.status === "healthy" ? "secondary" : "danger", onPress: openDialog, isDisabled: realm.status !== "active" || candidates.length === 0, children: operationLabel })) : undefined }), owner.isPending ? _jsx(PageLoading, { label: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC720\uC790 \uC0C1\uD0DC\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, owner.isError ? _jsx(LoadError, { error: owner.error, onRetry: () => void owner.refetch() }) : null, owner.data?.status === "healthy" && owner.data.owner ? (_jsxs("div", { className: styles.ownerSummary, children: [_jsxs("div", { children: [_jsx("strong", { children: owner.data.owner.primaryIdentifier }), _jsx("span", { children: "\uB300\uD45C \uC18C\uC720\uC790" })] }), _jsxs("div", { className: styles.rowActions, children: [_jsx(Badge, { tone: owner.data.owner.identityActive ? "success" : "danger", children: owner.data.owner.identityActive ? "계정 활성" : "계정 비활성" }), _jsx(MembershipStatusBadge, { status: owner.data.owner.membershipStatus })] }), _jsxs(DisplayModeGate, { minimum: "advanced", children: [_jsx(IdValue, { label: "Global Identity ID", value: owner.data.owner.globalIdentityId }), _jsx(IdValue, { label: "\uC18C\uC720\uC790 \uAD8C\uD55C \uB300\uC0C1 ID (Subject)", value: owner.data.owner.subjectId })] })] })) : null, owner.data?.status === "ownerless" ? (_jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: "\uC6B4\uC601 \uC18C\uC720\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." }), " \uD65C\uC131 \uC6B4\uC601\uC790\uB97C \uC5F0\uACB0\uD55C \uB4A4 \uC18C\uC720\uC790\uB97C \uC9C0\uC815\uD574\uC57C \uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 \uC815\uC0C1\uC801\uC778 \uAD8C\uD55C \uAD00\uB9AC \uC8FC\uCCB4\uAC00 \uC0DD\uAE41\uB2C8\uB2E4."] })) : null, owner.data?.status === "invalid" ? (_jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC720\uC790 \uC0C1\uD0DC\uAC00 \uC190\uC0C1\uB418\uC5C8\uC2B5\uB2C8\uB2E4." }), " ", owner.data.issueCode ? _jsx("code", { children: owner.data.issueCode }) : null, " \uC801\uACA9 \uC6B4\uC601\uC790\uB97C \uC120\uD0DD\uD574 \uBCF5\uAD6C\uD558\uC138\uC694."] })) : null, owner.data && candidates.length === 0 ? (_jsx("p", { className: styles.compactHint, children: "\uC18C\uC720\uC790\uB85C \uC9C0\uC815\uD560 \uB2E4\uB978 \uD65C\uC131 \uC6B4\uC601\uC790 \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC544\uB798\uC5D0\uC11C \uAE30\uC874 \uC6B4\uC601\uC790\uB97C \uBA3C\uC800 \uC5F0\uACB0\uD558\uC138\uC694." })) : null, dialogOpen && owner.data ? (_jsx(ConfirmDialog, { title: operationLabel, confirmLabel: operationLabel, danger: operation !== "assign", isPending: changeOwner.isPending, isConfirmDisabled: targetMembershipId === "" || reason.trim() === "" || password === "", onCancel: () => { setDialogOpen(false); changeOwner.reset(); }, onConfirm: () => changeOwner.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsx("p", { children: "CMS Owner \uC790\uC2E0\uC740 \uB300\uC0C1\uC774 \uB420 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC11C\uBC84\uAC00 \uB300\uC0C1 \uACC4\uC815, \uC18C\uC18D\uACFC \uC0AC\uB78C \uAD8C\uD55C \uB300\uC0C1\uC744 \uB2E4\uC2DC \uAC80\uC99D\uD569\uB2C8\uB2E4." }), _jsx(SelectField, { label: "\uC0C8 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC720\uC790", value: targetMembershipId, options: candidates.map((membership) => ({
                                value: membership.membershipId,
                                label: `${(membership.identity ?? identityById.get(membership.globalIdentityId))?.primaryIdentifier ?? membership.globalIdentityId} · ${membership.membershipId}`,
                            })), onChange: setTargetMembershipId }), _jsx(TextAreaField, { label: "\uBCC0\uACBD \uC0AC\uC720", value: reason, onChange: setReason, rows: 3, isRequired: true }), operation === "transfer" ? (_jsxs("div", { className: styles.dialogStack, children: [_jsx(CheckboxField, { isSelected: revokePreviousSessions, onChange: setRevokePreviousSessions, children: "\uAE30\uC874 \uC18C\uC720\uC790\uC758 \uD65C\uC131 \uC138\uC158 \uD3D0\uAE30" }), _jsx(CheckboxField, { isSelected: suspendPreviousMembership, onChange: setSuspendPreviousMembership, children: "\uAE30\uC874 \uC18C\uC720\uC790\uC758 \uC18C\uC18D\uB3C4 \uD568\uAED8 \uC815\uC9C0" })] })) : null, _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: password, onChange: setPassword, isRequired: true }), _jsx(MutationError, { error: changeOwner.error })] }) })) : null] }));
}
function MembershipSection({ realm, owner, memberships, identities, systemRealmId }) {
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
    const [membershipAction, setMembershipAction] = useState(null);
    const [promoting, setPromoting] = useState(null);
    const [promoteReauthPassword, setPromoteReauthPassword] = useState("");
    // Provisioning a Membership, appointing an administrator, or changing a
    // Membership's status all advance the Realm's authorization policy revision
    // (and can change the Owner's Membership badge). Refresh the Owner status too
    // so its cached policyRevision stays current — a stale revision makes the
    // Owner assign/transfer CAS fail with POLICY_REVISION_CONFLICT.
    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.realmMemberships(realm.realmId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.realmOwner(realm.realmId) }),
    ]);
    const provision = useMutation({
        mutationFn: (profile) => api.identityRealms.provisionMembership(realm.realmId, {
            globalIdentityId: identityId,
            profile,
            password,
        }),
        onSuccess: async () => {
            setPassword("");
            setProfileSource("{}");
            setMembershipAction(null);
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
            setMembershipAction(null);
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
    const submitProvision = () => {
        const profile = parseProfile(profileSource, setProfileError);
        if (profile !== null)
            provision.mutate(profile);
    };
    const submitRegister = () => {
        const profile = parseProfile(newProfileSource, setNewProfileError);
        if (profile !== null)
            register.mutate(profile);
    };
    return (_jsxs("section", { className: styles.panel, "aria-labelledby": "membership-title", children: [_jsx(SectionHeader, { id: "membership-title", title: "\uC0AC\uC6A9\uC790 \uD560\uB2F9", description: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC5D0 \uC5F0\uACB0\uB41C \uC0AC\uC6A9\uC790\uB97C \uD655\uC778\uD558\uACE0 \uD544\uC694\uD55C \uC5F0\uACB0 \uC791\uC5C5\uC744 \uC2E4\uD589\uD569\uB2C8\uB2E4.", actions: _jsxs("div", { className: styles.rowActions, children: [_jsx(Button, { onPress: () => { register.reset(); setNewProfileError(null); setMembershipAction("register"); }, isDisabled: !canRegister, children: "\uC0C8 \uC0AC\uC6A9\uC790" }), _jsx(Button, { variant: "secondary", onPress: () => { provision.reset(); setProfileError(null); setMembershipAction("provision"); }, isDisabled: !canProvision || identities.isPending || candidates.length === 0, children: "\uAE30\uC874 \uC6B4\uC601\uC790 \uC5F0\uACB0" })] }) }), realm.status !== "active" ? (_jsx(Callout, { tone: "warning", children: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC774 \uD65C\uC131 \uC0C1\uD0DC\uAC00 \uB418\uC5B4\uC57C \uC0AC\uC6A9\uC790\uB97C \uC5F0\uACB0\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : null, identities.isError ? _jsx(LoadError, { error: identities.error, onRetry: () => void identities.refetch() }) : null, !realm.authentication.acceptSystemIdentities ? (_jsx("p", { className: styles.compactHint, children: "\uAE30\uC874 \uC6B4\uC601\uC790 \uC5F0\uACB0\uC740 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC124\uC815\uC5D0\uC11C \uC6B4\uC601\uC790 \uACC4\uC815 \uC18C\uC18D\uC744 \uD5C8\uC6A9\uD558\uBA74 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : realm.status === "active" && !identities.isPending && candidates.length === 0 ? (_jsx("p", { className: styles.compactHint, children: "\uC5F0\uACB0 \uAC00\uB2A5\uD55C \uC6B4\uC601\uC790 \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." })) : null, memberships.isPending ? _jsx(PageLoading, { label: "\uC18C\uC18D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, memberships.isError ? _jsx(LoadError, { error: memberships.error, onRetry: () => void memberships.refetch() }) : null, memberships.data?.items.length === 0 ? _jsx(EmptyState, { title: "\uC5F0\uACB0\uB41C \uC0AC\uC6A9\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC0C1\uB2E8 \uC791\uC5C5\uC73C\uB85C \uC0AC\uC6A9\uC790\uB97C \uC5F0\uACB0\uD558\uAC70\uB098 \uC77C\uBC18 \uC0AC\uC6A9\uC790\uAC00 \uAC00\uC785/JIT \uB85C\uADF8\uC778\uD558\uBA74 \uC5EC\uAE30\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4." }) : null, memberships.data && memberships.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: `${styles.table} ${styles.membershipTable}`, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\uC0AC\uC6A9\uC790" }), _jsx("th", { children: "Realm Subject" }), _jsx("th", { children: "Profile" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", { children: "\uC5F0\uACB0 \uBC29\uC2DD" }), _jsx("th", { children: "\uC791\uC5C5" })] }) }), _jsx("tbody", { children: memberships.data.items.map((membership) => {
                                const identity = membership.identity ?? identityById.get(membership.globalIdentityId);
                                const isOwner = owner.data?.status === "healthy"
                                    && owner.data.owner?.membershipId === membership.membershipId;
                                const isAdministrator = membership.realmAdministrator === true;
                                return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: identity?.primaryIdentifier ?? "Identifier 미제공" }), isOwner ? _jsx(Badge, { tone: "primary", children: "\uC18C\uC720\uC790" }) : null, isAdministrator ? _jsx(Badge, { tone: "info", children: "\uAD00\uB9AC\uC790" }) : null, _jsxs(DisplayModeGate, { minimum: "advanced", children: [_jsx(IdValue, { label: "Global Identity ID", value: membership.globalIdentityId }), _jsx(IdValue, { label: "Membership ID", value: membership.membershipId })] })] }), _jsx("td", { children: _jsx("code", { className: styles.compactCode, children: membership.subjectId }) }), _jsx("td", { children: _jsx("code", { className: styles.compactCode, children: membership.profileDocumentId ?? "프로비저닝 중" }) }), _jsx("td", { children: _jsx(MembershipStatusBadge, { status: membership.status }) }), _jsxs("td", { children: [provisionedByLabel(membership.provisionedBy), _jsxs("span", { className: styles.secondaryLine, children: ["Revision ", membership.revision] })] }), _jsx("td", { children: _jsxs("div", { className: styles.rowActions, children: [membership.status === "active" && realm.kind === "content" && !isAdministrator && !isOwner ? (_jsx(Button, { size: "small", variant: "secondary", isDisabled: realm.status !== "active" || promote.isPending, onPress: () => { setPromoting(membership); setPromoteReauthPassword(""); }, children: "\uAD00\uB9AC\uC790\uB85C \uC9C0\uC815" })) : null, isOwner ? (_jsx("span", { className: styles.compactHint, children: "\uC18C\uC720\uC790\uB294 \uC704 \uC18C\uC720\uC790 \uAD50\uCCB4\u00B7\uBCF5\uAD6C\uB85C \uAD00\uB9AC" })) : membership.status === "active" ? (_jsx(Button, { size: "small", variant: "danger", isDisabled: realm.status !== "active" || changeStatus.isPending, onPress: () => changeStatus.mutate({ membership, status: "suspended" }), children: "\uC815\uC9C0" })) : membership.status === "suspended" ? (_jsx(Button, { size: "small", variant: "secondary", isDisabled: realm.status !== "active" || changeStatus.isPending, onPress: () => changeStatus.mutate({ membership, status: "active" }), children: "\uC7AC\uD65C\uC131\uD654" })) : _jsx(Badge, { tone: "warning", children: "\uC644\uB8CC \uB300\uAE30" })] }) })] }, membership.membershipId));
                            }) })] }) })) : null, _jsx(MutationError, { error: changeStatus.error }), membershipAction === "register" ? (_jsx(ConfirmDialog, { title: "\uC0C8 \uC0AC\uC6A9\uC790 \uB9CC\uB4E4\uC5B4 \uC5F0\uACB0", confirmLabel: "\uC0C8 \uC0AC\uC6A9\uC790 \uC0DD\uC131 \uD6C4 \uC5F0\uACB0", isPending: register.isPending, isConfirmDisabled: !canRegister || newIdentifier.trim() === "" || newPassword === "" || newReauthPassword === "", onCancel: () => { setMembershipAction(null); register.reset(); }, onConfirm: submitRegister, children: _jsxs("div", { className: styles.dialogStack, children: [_jsx("p", { children: "\uC0C8 \uB85C\uADF8\uC778 \uACC4\uC815\uC744 \uB9CC\uB4E4\uACE0 \uACE7\uBC14\uB85C \uC774 Realm\uC5D0 \uC5F0\uACB0\uD569\uB2C8\uB2E4." }), _jsxs("div", { className: styles.dialogFieldGrid, children: [_jsx(TextInput, { label: "\uB85C\uADF8\uC778 identifier", value: newIdentifier, onChange: setNewIdentifier, description: "\uC608: \uC774\uBA54\uC77C \uB610\uB294 \uC0AC\uC6A9\uC790\uBA85", isRequired: true }), _jsx(TextInput, { label: "\uCD08\uAE30 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", value: newPassword, onChange: setNewPassword, description: "12\uC790 \uC774\uC0C1", isRequired: true })] }), _jsx(TextInput, { label: "\uD604\uC7AC \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: newReauthPassword, onChange: setNewReauthPassword, description: "\uBCF8\uC778 \uD655\uC778\uC744 \uC704\uD574 \uD544\uC694\uD569\uB2C8\uB2E4.", isRequired: true }), _jsx(DisplayModeGate, { minimum: "standard", children: _jsxs("details", { className: styles.optionalDetails, children: [_jsx("summary", { children: "\uCD08\uAE30 Profile JSON" }), _jsx(TextAreaField, { label: "\uCD08\uAE30 Profile JSON", value: newProfileSource, onChange: setNewProfileSource, rows: 4, errorMessage: newProfileError ?? undefined, description: "\uBE44\uC6CC \uB458 \uC218 \uC788\uC73C\uBA70 Profile Collection Schema \uAC80\uC99D\uC744 \uD1B5\uACFC\uD574\uC57C \uD569\uB2C8\uB2E4." })] }) }), _jsx(MutationError, { error: register.error })] }) })) : null, membershipAction === "provision" ? (_jsx(ConfirmDialog, { title: "\uAE30\uC874 \uC6B4\uC601\uC790 \uACC4\uC815 \uC5F0\uACB0", confirmLabel: "\uC6B4\uC601\uC790 \uACC4\uC815 \uC5F0\uACB0", isPending: provision.isPending, isConfirmDisabled: !canProvision || identityId === "" || password === "", onCancel: () => { setMembershipAction(null); provision.reset(); }, onConfirm: submitProvision, children: _jsxs("div", { className: styles.dialogStack, children: [_jsx("p", { children: "\uAE30\uC874 System \uC6B4\uC601\uC790 \uACC4\uC815\uC744 \uC774 Realm\uC758 Membership\uC73C\uB85C \uC5F0\uACB0\uD569\uB2C8\uB2E4." }), _jsx(SelectField, { label: "\uC5F0\uACB0\uD560 \uC6B4\uC601\uC790(System) \uACC4\uC815", value: identityId, options: candidates.map((identity) => ({
                                value: identity.globalIdentityId,
                                label: `${identity.primaryIdentifier} · ${identity.globalIdentityId}`,
                            })), onChange: setIdentityId }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: password, onChange: setPassword, isRequired: true }), _jsx(DisplayModeGate, { minimum: "standard", children: _jsxs("details", { className: styles.optionalDetails, children: [_jsx("summary", { children: "\uCD08\uAE30 Profile JSON" }), _jsx(TextAreaField, { label: "\uCD08\uAE30 Profile JSON", value: profileSource, onChange: setProfileSource, rows: 4, errorMessage: profileError ?? undefined, description: "\uBE44\uC6CC \uB458 \uC218 \uC788\uC73C\uBA70 Profile Collection Schema \uAC80\uC99D\uC744 \uD1B5\uACFC\uD574\uC57C \uD569\uB2C8\uB2E4." })] }) }), _jsx(MutationError, { error: provision.error })] }) })) : null, promoting ? (_jsx(ConfirmDialog, { title: "\uACF5\uAC04 \uAD00\uB9AC\uC790\uB85C \uC9C0\uC815", confirmLabel: "\uAD00\uB9AC\uC790\uB85C \uC9C0\uC815", isPending: promote.isPending, isConfirmDisabled: promoteReauthPassword === "", onCancel: () => { setPromoting(null); setPromoteReauthPassword(""); }, onConfirm: () => promote.mutate(promoting), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("strong", { children: (promoting.identity ?? identityById.get(promoting.globalIdentityId))?.primaryIdentifier ?? promoting.subjectId }), " \uB2D8\uC5D0\uAC8C \uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 ", _jsx("strong", { children: "\uAD00\uB9AC\uC790(content-administrator)" }), " \uAD8C\uD55C\uC744 \uBD80\uC5EC\uD569\uB2C8\uB2E4. \uC774\uD6C4 \uC774 \uACC4\uC815\uC73C\uB85C \u201C\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uAD8C\uD55C \uAD00\uB9AC\u201D \uD654\uBA74\uC5D0 \uB4E4\uC5B4\uAC00 \uAD8C\uD55C\uC744 \uC9C1\uC811 \uAD00\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."] }), _jsx(MutationError, { error: promote.error }), _jsx(TextInput, { label: "\uD604\uC7AC \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: promoteReauthPassword, onChange: setPromoteReauthPassword, description: "\uBCF8\uC778 \uD655\uC778\uC744 \uC704\uD574 \uD604\uC7AC \uB85C\uADF8\uC778\uD55C \uAD00\uB9AC\uC790 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD569\uB2C8\uB2E4.", isRequired: true })] }) })) : null] }));
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
function localDateTimeAfter(minutes) {
    const value = new Date(Date.now() + minutes * 60_000);
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}
function isActiveFullAccess(binding) {
    return binding.revokedAt === undefined && Date.parse(binding.validUntil) > Date.now();
}
function remainingFullAccessTime(validUntil) {
    const remainingMinutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
    if (remainingMinutes < 60)
        return `${remainingMinutes}분 후 만료`;
    const hours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    return minutes === 0 ? `${hours}시간 후 만료` : `${hours}시간 ${minutes}분 후 만료`;
}
function FullAccessSection({ realm, bindings, mode }) {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [reason, setReason] = useState("");
    const [validUntil, setValidUntil] = useState("");
    const [password, setPassword] = useState("");
    const [granting, setGranting] = useState(false);
    const [revoking, setRevoking] = useState(null);
    const [revokePassword, setRevokePassword] = useState("");
    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.realmFullAccess(realm.realmId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.realmAuthorization(realm.realmId) }),
    ]);
    const grant = useMutation({
        mutationFn: () => api.identityRealms.grantFullAccess(realm.realmId, {
            reason: reason.trim(),
            password,
            validUntil: localInstant(validUntil),
        }),
        onSuccess: async () => {
            setReason("");
            setValidUntil("");
            setPassword("");
            setGranting(false);
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
    const listedActiveBindings = bindings.data?.items.filter(isActiveFullAccess) ?? [];
    const activeBindings = bindings.data?.activeBinding !== undefined
        && isActiveFullAccess(bindings.data.activeBinding)
        && !listedActiveBindings.some(({ bindingId }) => bindingId === bindings.data.activeBinding.bindingId)
        ? [bindings.data.activeBinding, ...listedActiveBindings]
        : listedActiveBindings;
    const currentBinding = bindings.data?.activeBinding !== undefined && isActiveFullAccess(bindings.data.activeBinding)
        ? bindings.data.activeBinding
        : undefined;
    useEffect(() => {
        if (currentBinding === undefined)
            return;
        const delay = Math.max(0, Date.parse(currentBinding.validUntil) - Date.now()) + 100;
        const timer = window.setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.realmFullAccess(realm.realmId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.realmAuthorization(realm.realmId) });
        }, delay);
        return () => window.clearTimeout(timer);
    }, [currentBinding?.bindingId, currentBinding?.validUntil, queryClient, realm.realmId]);
    const expiryTime = validUntil === "" ? Number.NaN : Date.parse(localInstant(validUntil));
    const expiryValid = Number.isFinite(expiryTime)
        && expiryTime > Date.now()
        && expiryTime <= Date.now() + 4 * 60 * 60_000;
    const openGrantDialog = () => {
        grant.reset();
        setReason("");
        setPassword("");
        setValidUntil(localDateTimeAfter(30));
        setGranting(true);
    };
    return (_jsxs("section", { className: `${styles.panel} ${styles.fullAccessPanel}`, "data-active": activeBindings.length > 0, "aria-labelledby": "full-access-title", children: [_jsx(SectionHeader, { id: "full-access-title", title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 Full Access", description: "CMS Owner\uAC00 \uC81C\uD55C\uB41C \uC2DC\uAC04 \uB3D9\uC548 \uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 Admin Studio \uC815\uCC45\uC744 \uC9C1\uC811 \uBCF5\uAD6C\uD558\uB294 \uBE44\uC0C1 \uC811\uADFC\uC785\uB2C8\uB2E4.", actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "small", variant: "secondary", onPress: () => navigate(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/audit`), children: "\uAC10\uC0AC \uB85C\uADF8" }), _jsx(Button, { variant: "danger", onPress: openGrantDialog, isDisabled: realm.status === "disabled" || currentBinding !== undefined, children: currentBinding ? "Full Access 사용 중" : "Full Access 시작" })] }) }), _jsx("p", { className: styles.compactHint, children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC18D\uC774\uB098 Content API \uAD8C\uD55C\uC740 \uB9CC\uB4E4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC77C\uBC18 \uC6B4\uC601\uC740 \uC0AC\uB78C \uC18C\uC720\uC790\uC640 \uC5ED\uD560 \uC5F0\uACB0\uB85C \uCC98\uB9AC\uD558\uC138\uC694." }), bindings.isPending ? _jsx(PageLoading, { label: "Full Access \uC0C1\uD0DC\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, bindings.isError ? _jsx(LoadError, { error: bindings.error, onRetry: () => void bindings.refetch() }) : null, activeBindings.length > 0 ? (_jsx("div", { className: styles.fullAccessActiveList, children: activeBindings.map((binding) => (_jsxs("article", { className: styles.fullAccessActiveItem, children: [_jsxs("div", { children: [_jsx(Badge, { tone: "danger", children: "Full Access \uC0AC\uC6A9 \uC911" }), _jsx("strong", { children: remainingFullAccessTime(binding.validUntil) }), _jsx("span", { children: binding.reason })] }), _jsxs("div", { children: [_jsxs("span", { children: ["System Identity ", _jsx("code", { children: binding.systemIdentityId })] }), _jsxs("span", { children: [formatInstant(binding.createdAt), " \uC2DC\uC791 \u00B7 ", formatInstant(binding.validUntil), " \uB9CC\uB8CC"] })] }), _jsx(Button, { size: "small", variant: "danger", onPress: () => { setRevoking(binding); setRevokePassword(""); }, children: "\uC989\uC2DC \uD574\uC81C" })] }, binding.bindingId))) })) : bindings.data ? (_jsxs("div", { className: styles.fullAccessInactive, children: [_jsx(Badge, { tone: "neutral", children: "\uBE44\uD65C\uC131" }), _jsx("span", { children: "\uD604\uC7AC \uC0AC\uC6A9 \uC911\uC778 Full Access\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." })] })) : null, displayModeAtLeast(mode, "advanced") && bindings.data && bindings.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "System Identity" }), _jsx("th", { children: "\uBC1C\uAE09 \uC0AC\uC720" }), _jsx("th", { children: "\uBC1C\uAE09\uC790" }), _jsx("th", { children: "\uC720\uD6A8 \uAE30\uAC04" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", {})] }) }), _jsx("tbody", { children: bindings.data.items.map((binding) => {
                                const expired = binding.terminationReason === "expired"
                                    || Date.parse(binding.validUntil) <= Date.now();
                                const revoked = binding.terminationReason === "revoked"
                                    || (binding.revokedAt !== undefined && !expired);
                                return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx(IdValue, { label: "System Identity ID", value: binding.systemIdentityId }), _jsx(IdValue, { label: "Full Access Binding ID", value: binding.bindingId })] }), _jsx("td", { children: binding.reason }), _jsx("td", { children: _jsx(IdValue, { label: "Global Identity ID", value: binding.grantedByGlobalIdentityId }) }), _jsxs("td", { children: [formatInstant(binding.createdAt), _jsxs("span", { className: styles.secondaryLine, children: ["\uB9CC\uB8CC ", formatInstant(binding.validUntil)] })] }), _jsx("td", { children: expired ? _jsx(Badge, { tone: "warning", children: "\uB9CC\uB8CC\uB428" }) : revoked ? _jsx(Badge, { tone: "neutral", children: "\uD574\uC9C0\uB428" }) : _jsx(Badge, { tone: "danger", children: "\uD65C\uC131 Full Access" }) }), _jsx("td", { children: !revoked && !expired ? _jsx(Button, { size: "small", variant: "danger", onPress: () => { setRevoking(binding); setRevokePassword(""); }, children: "\uC989\uC2DC \uD574\uC81C" }) : null })] }, binding.bindingId));
                            }) })] }) })) : null, _jsx(MutationError, { error: revoke.error }), granting ? (_jsx(ConfirmDialog, { title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 Full Access \uC2DC\uC791", confirmLabel: "Full Access \uC2DC\uC791", danger: true, isPending: grant.isPending, isConfirmDisabled: !expiryValid || reason.trim() === "" || password === "", onCancel: () => { setGranting(false); grant.reset(); }, onConfirm: () => grant.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uBE44\uC0C1 \uC815\uCC45 \uBCF5\uAD6C\uC5D0\uB9CC \uC0AC\uC6A9\uD558\uC138\uC694." }), " \uD604\uC7AC \uB85C\uADF8\uC778\uD55C CMS Owner\uC758 System Identity\uC5D0\uB9CC \uC801\uC6A9\uB418\uBA70 Content API\uC5D0\uB294 \uC801\uC6A9\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."] }), _jsx("div", { className: styles.fullAccessPresets, "aria-label": "Full Access \uAE30\uAC04 \uC120\uD0DD", children: [15, 30, 60].map((minutes) => _jsx(Button, { size: "small", variant: "secondary", onPress: () => setValidUntil(localDateTimeAfter(minutes)), children: minutes === 60 ? "1시간" : `${minutes}분` }, minutes)) }), _jsx(TextInput, { label: "\uB9CC\uB8CC \uC2DC\uAC01", type: "datetime-local", value: validUntil, onChange: setValidUntil, description: "\uBBF8\uB798 \uC2DC\uAC01\uC744 \uD544\uC218\uB85C \uC9C0\uC815\uD558\uBA70 \uCD5C\uB300 4\uC2DC\uAC04\uAE4C\uC9C0 \uD5C8\uC6A9\uB429\uB2C8\uB2E4.", isRequired: true }), validUntil !== "" && !expiryValid ? _jsx(Callout, { tone: "error", children: "\uB9CC\uB8CC \uC2DC\uAC01\uC740 \uD604\uC7AC\uBCF4\uB2E4 \uC774\uD6C4\uC774\uACE0 4\uC2DC\uAC04 \uC774\uB0B4\uC5EC\uC57C \uD569\uB2C8\uB2E4." }) : null, _jsx(TextAreaField, { label: "\uC811\uADFC \uC0AC\uC720", value: reason, onChange: setReason, rows: 3, isRequired: true }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: password, onChange: setPassword, isRequired: true }), _jsx(MutationError, { error: grant.error })] }) })) : null, revoking ? (_jsx(ConfirmDialog, { title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 Full Access \uC989\uC2DC \uD574\uC81C", confirmLabel: "\uC989\uC2DC \uD574\uC81C", danger: true, isPending: revoke.isPending, isConfirmDisabled: revokePassword === "", onCancel: () => { setRevoking(null); setRevokePassword(""); }, onConfirm: () => revoke.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("code", { children: revoking.systemIdentityId }), " System Identity\uC758 Realm Full Access\uB97C \uC989\uC2DC \uD574\uC81C\uD569\uB2C8\uB2E4."] }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: revokePassword, onChange: setRevokePassword, isRequired: true })] }) })) : null] }));
}
//# sourceMappingURL=identity-realm-pages.js.map