import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import { Badge, Button, Callout, CheckboxField, ConfirmDialog, EmptyState, SelectField, TextInput, TextAreaField, } from "@xecms/ui";
import { Link, useNavigate, useParams } from "react-router";
import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
import styles from "../identity-realms.module.css";
function IdentityStatus({ identity }) {
    if (identity.status === "disabled")
        return _jsx(Badge, { tone: "danger", children: "\uBE44\uD65C\uC131" });
    if (identity.isOwner)
        return _jsx(Badge, { tone: "info", children: "Owner" });
    return _jsx(Badge, { tone: "success", children: "\uD65C\uC131" });
}
function ErrorCallout({ error }) {
    if (error === null || error === undefined)
        return null;
    const converted = toAdminApiError(error);
    return _jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: converted.message }), " ", _jsx("code", { children: converted.code })] });
}
function formatInstant(value) {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" })
        .format(new Date(value));
}
export function UserListPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchDraft, setSearchDraft] = useState("");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("all");
    const [creating, setCreating] = useState(false);
    const [createKind, setCreateKind] = useState("human");
    const [identifier, setIdentifier] = useState("");
    const [temporaryPassword, setTemporaryPassword] = useState("");
    const identities = useQuery({
        queryKey: queryKeys.identities(query, status),
        queryFn: () => api.identities.list({
            limit: 50,
            ...(query === "" ? {} : { query }),
            ...(status === "all" ? {} : { status }),
        }),
    });
    const create = useMutation({
        mutationFn: () => createKind === "human"
            ? api.identities.create({ primaryIdentifier: identifier, temporaryPassword })
            : api.identities.createService({ primaryIdentifier: identifier }),
        onSuccess: async (identity) => {
            await queryClient.invalidateQueries({ queryKey: ["identities"] });
            navigate(`/admin/users/${encodeURIComponent(identity.identityId)}`);
        },
    });
    const submitSearch = (event) => {
        event.preventDefault();
        setQuery(searchDraft.trim());
    };
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Users & access", title: "\uC0AC\uC6A9\uC790", description: "\uACC4\uC815\uC758 \uC0C1\uD0DC\uC640 \uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC18D\uC744 \uD55C\uACF3\uC5D0\uC11C \uAD00\uB9AC\uD569\uB2C8\uB2E4. \uACC4\uC815\uC744 \uB9CC\uB4E4\uC5B4\uB3C4 \uC5ED\uD560\uC740 \uC790\uB3D9 \uBD80\uC5EC\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", actions: _jsxs(_Fragment, { children: [_jsxs(Button, { variant: "secondary", onPress: () => { setCreateKind("service"); setCreating(true); }, children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC11C\uBE44\uC2A4 \uACC4\uC815 \uC0DD\uC131"] }), _jsxs(Button, { onPress: () => { setCreateKind("human"); setCreating(true); }, children: [_jsx(Icon, { name: "plus", size: 17 }), "\uC6B4\uC601 \uACC4\uC815 \uC0DD\uC131"] })] }) }), creating ? (_jsxs("section", { className: styles.formCard, "aria-labelledby": "create-user-title", children: [_jsx(SectionHeader, { id: "create-user-title", title: createKind === "human" ? "새 운영 계정" : "새 서비스 계정", description: createKind === "human" ? "임시 비밀번호는 첫 로그인 후 변경 대상이 됩니다." : "서비스 계정은 password login을 할 수 없으며 역할과 API key를 별도로 구성합니다." }), _jsxs("form", { className: styles.formStack, onSubmit: (event) => {
                            event.preventDefault();
                            if (identifier.trim() === "" || (createKind === "human" && temporaryPassword.length < 12))
                                return;
                            create.mutate();
                        }, children: [_jsxs("div", { className: styles.fieldGrid, children: [_jsx(TextInput, { label: createKind === "human" ? "로그인 식별자" : "서비스 식별자", value: identifier, onChange: setIdentifier, placeholder: createKind === "human" ? "editor.user" : "search.indexer", isRequired: true }), createKind === "human" ? _jsx(TextInput, { label: "\uC784\uC2DC \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", value: temporaryPassword, onChange: setTemporaryPassword, description: "12\uC790 \uC774\uC0C1", isRequired: true }) : null] }), _jsx(ErrorCallout, { error: create.error }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { variant: "secondary", onPress: () => setCreating(false), children: "\uCDE8\uC18C" }), _jsx(Button, { type: "submit", isDisabled: create.isPending || identifier.trim() === "" || (createKind === "human" && temporaryPassword.length < 12), children: create.isPending ? "생성 중…" : createKind === "human" ? "계정 생성" : "서비스 계정 생성" })] })] })] })) : null, _jsxs("section", { className: styles.panel, "aria-labelledby": "user-list-title", children: [_jsx(SectionHeader, { id: "user-list-title", title: "\uACC4\uC815 \uBAA9\uB85D", description: "\uC2DD\uBCC4\uC790\uC640 \uD65C\uC131 \uC0C1\uD0DC\uB85C \uAC80\uC0C9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }), _jsxs("form", { className: styles.fieldGrid, onSubmit: submitSearch, children: [_jsx(TextInput, { label: "\uC2DD\uBCC4\uC790 \uAC80\uC0C9", value: searchDraft, onChange: setSearchDraft, placeholder: "\uC774\uB984 \uC77C\uBD80" }), _jsx(SelectField, { label: "\uC0C1\uD0DC", value: status, options: [
                                    { value: "all", label: "전체" },
                                    { value: "active", label: "활성" },
                                    { value: "disabled", label: "비활성" },
                                ], onChange: (value) => setStatus(value) }), _jsx("div", { className: styles.formActions, children: _jsx(Button, { type: "submit", variant: "secondary", children: "\uAC80\uC0C9" }) })] }), identities.isPending ? _jsx(PageLoading, { label: "\uC0AC\uC6A9\uC790\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, identities.isError ? _jsx(LoadError, { error: identities.error, onRetry: () => void identities.refetch() }) : null, identities.data?.items.length === 0 ? _jsx(EmptyState, { title: "\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC0AC\uC6A9\uC790\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uAC80\uC0C9 \uC870\uAC74\uC744 \uBC14\uAFB8\uAC70\uB098 \uC0C8 \uC6B4\uC601 \uACC4\uC815\uC744 \uB9CC\uB4DC\uC138\uC694." }) : null, identities.data && identities.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Identity" }), _jsx("th", { children: "\uC885\uB958" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", { children: "Membership" }), _jsx("th", { children: "\uCD5C\uADFC \uBCC0\uACBD" })] }) }), _jsx("tbody", { children: identities.data.items.map((identity) => (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx(Link, { to: `/admin/users/${encodeURIComponent(identity.identityId)}`, children: _jsx("strong", { children: identity.primaryIdentifier }) }), _jsx("span", { className: styles.secondaryLine, children: identity.identityId })] }), _jsx("td", { children: identity.kind === "human" ? "사람" : "서비스" }), _jsx("td", { children: _jsx(IdentityStatus, { identity: identity }) }), _jsxs("td", { children: [identity.memberships.length, "\uAC1C"] }), _jsx("td", { children: formatInstant(identity.updatedAt) })] }, identity.identityId))) })] }) })) : null] })] }));
}
export function UserDetailPage() {
    const { identityId } = useParams();
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [identifier, setIdentifier] = useState(null);
    const [confirmStatus, setConfirmStatus] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [temporaryPassword, setTemporaryPassword] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [revokeApiKeys, setRevokeApiKeys] = useState(false);
    const [revokeSessionId, setRevokeSessionId] = useState(null);
    const [revokeAllOpen, setRevokeAllOpen] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false);
    const [transferReason, setTransferReason] = useState("");
    const [transferPassword, setTransferPassword] = useState("");
    const [apiKeyOpen, setApiKeyOpen] = useState(false);
    const [apiKeyName, setApiKeyName] = useState("");
    const [apiKeyScopes, setApiKeyScopes] = useState("");
    const [apiKeyExpiresAt, setApiKeyExpiresAt] = useState("");
    const [createdApiKeySecret, setCreatedApiKeySecret] = useState(null);
    const [revokeApiKeyId, setRevokeApiKeyId] = useState(null);
    const [sessionView, setSessionView] = useState("active");
    const [sessionPage, setSessionPage] = useState(1);
    const [credentialTokenPurpose, setCredentialTokenPurpose] = useState(null);
    const [credentialTokenPassword, setCredentialTokenPassword] = useState("");
    const [createdCredentialToken, setCreatedCredentialToken] = useState(null);
    const identity = useQuery({
        queryKey: queryKeys.identity(identityId ?? "missing"),
        queryFn: () => api.identities.get(identityId),
        enabled: identityId !== undefined,
    });
    const sessions = useQuery({
        queryKey: queryKeys.identitySessions(identityId ?? "missing", sessionView, sessionPage),
        queryFn: () => api.identities.listSessions(identityId, {
            status: sessionView,
            page: sessionPage,
            pageSize: 10,
        }),
        enabled: identityId !== undefined,
    });
    const apiKeys = useQuery({
        queryKey: queryKeys.identityApiKeys(identityId ?? "missing"),
        queryFn: () => api.identities.listApiKeys(identityId),
        enabled: identityId !== undefined && identity.data?.kind === "service",
    });
    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["identities"] });
    };
    const update = useMutation({
        mutationFn: () => api.identities.update(identityId, {
            expectedRevision: identity.data.revision,
            primaryIdentifier: (identifier ?? identity.data.primaryIdentifier).trim(),
        }),
        onSuccess: async () => { setIdentifier(null); await refresh(); },
    });
    const statusMutation = useMutation({
        mutationFn: () => identity.data.status === "active"
            ? api.identities.disable(identityId, identity.data.revision)
            : api.identities.reactivate(identityId, identity.data.revision),
        onSuccess: async () => { setConfirmStatus(false); await refresh(); },
    });
    const resetCredentials = useMutation({
        mutationFn: () => api.identities.resetCredentials(identityId, {
            expectedRevision: identity.data.revision,
            temporaryPassword,
            currentPassword,
            revokeApiKeys,
        }),
        onSuccess: async () => {
            setResetOpen(false);
            setTemporaryPassword("");
            setCurrentPassword("");
            setRevokeApiKeys(false);
            await refresh();
            setSessionPage(1);
            await queryClient.invalidateQueries({ queryKey: queryKeys.identitySessionsRoot(identityId) });
        },
    });
    const revokeSession = useMutation({
        mutationFn: (sessionId) => api.identities.revokeSession(sessionId),
        onSuccess: async () => {
            setRevokeSessionId(null);
            setSessionPage(1);
            await queryClient.invalidateQueries({ queryKey: queryKeys.identitySessionsRoot(identityId) });
        },
    });
    const revokeAllSessions = useMutation({
        mutationFn: () => api.identities.revokeAllSessions(identityId),
        onSuccess: async () => {
            setRevokeAllOpen(false);
            setSessionPage(1);
            await queryClient.invalidateQueries({ queryKey: queryKeys.identitySessionsRoot(identityId) });
        },
    });
    const transferOwner = useMutation({
        mutationFn: () => api.identities.transferOwner({
            targetIdentityId: identityId, reason: transferReason, currentPassword: transferPassword,
        }),
        onSuccess: () => {
            queryClient.clear();
            navigate("/admin/login", { replace: true });
        },
    });
    const createApiKey = useMutation({
        mutationFn: () => api.identities.createApiKey(identityId, {
            name: apiKeyName,
            scopes: [...new Set(apiKeyScopes.split(",").map((scope) => scope.trim()).filter(Boolean))],
            ...(apiKeyExpiresAt === "" ? {} : { expiresAt: new Date(apiKeyExpiresAt).toISOString() }),
        }),
        onSuccess: async (key) => {
            setApiKeyOpen(false);
            setApiKeyName("");
            setApiKeyScopes("");
            setApiKeyExpiresAt("");
            setCreatedApiKeySecret(key.secret);
            await queryClient.invalidateQueries({ queryKey: queryKeys.identityApiKeys(identityId) });
        },
    });
    const revokeApiKey = useMutation({
        mutationFn: (apiKeyId) => api.identities.revokeApiKey(apiKeyId),
        onSuccess: async () => {
            setRevokeApiKeyId(null);
            await queryClient.invalidateQueries({ queryKey: queryKeys.identityApiKeys(identityId) });
        },
    });
    const createCredentialToken = useMutation({
        mutationFn: () => {
            const input = { expectedRevision: identity.data.revision, currentPassword: credentialTokenPassword };
            return credentialTokenPurpose === "invitation"
                ? api.identities.createInvitation(identityId, input)
                : api.identities.createResetToken(identityId, input);
        },
        onSuccess: async (token) => {
            setCredentialTokenPurpose(null);
            setCredentialTokenPassword("");
            setCreatedCredentialToken({ secret: token.secret, expiresAt: token.expiresAt });
            await refresh();
        },
    });
    const createSystemMembership = useMutation({
        mutationFn: () => api.identities.createSystemMembership(identityId, identity.data.revision),
        onSuccess: refresh,
    });
    if (identity.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uC0AC\uC6A9\uC790 \uC0C1\uC138\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (identity.isError || identity.data === undefined)
        return _jsx(Page, { children: _jsx(LoadError, { error: identity.error, onRetry: () => void identity.refetch() }) });
    const current = identity.data;
    const nextIdentifier = identifier ?? current.primaryIdentifier;
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Users & access", title: current.primaryIdentifier, description: current.identityId, actions: _jsx(IdentityStatus, { identity: current }) }), _jsxs("div", { className: styles.summaryGrid, children: [_jsxs("div", { children: [_jsx("span", { children: "\uC885\uB958" }), _jsx("strong", { children: current.kind === "human" ? "사람" : "서비스" })] }), _jsxs("div", { children: [_jsx("span", { children: "Identity revision" }), _jsx("strong", { children: current.revision })] }), _jsxs("div", { children: [_jsx("span", { children: "Credential version" }), _jsx("strong", { children: current.credentialVersion })] }), _jsxs("div", { children: [_jsx("span", { children: "Membership" }), _jsx("strong", { children: current.memberships.length })] })] }), _jsxs("section", { className: styles.panel, "aria-labelledby": "identity-settings-title", children: [_jsx(SectionHeader, { id: "identity-settings-title", title: "\uACC4\uC815 \uC124\uC815", description: "identifier \uBCC0\uACBD\uC740 \uB85C\uADF8\uC778 \uC2DD\uBCC4\uC790\uC640 \uC6B4\uC601\uC790 \uACF5\uAC04 \uAD8C\uD55C \uB300\uC0C1 \uD45C\uC2DC\uBA85\uC744 \uD568\uAED8 \uAC31\uC2E0\uD569\uB2C8\uB2E4." }), _jsx("div", { className: styles.fieldGrid, children: _jsx(TextInput, { label: "\uB85C\uADF8\uC778 \uC2DD\uBCC4\uC790", value: nextIdentifier, onChange: setIdentifier, isDisabled: current.status === "disabled" }) }), _jsx(ErrorCallout, { error: update.error ?? statusMutation.error ?? transferOwner.error }), _jsxs("div", { className: styles.formActions, children: [!current.isOwner && current.kind === "human" && current.status === "active" ? _jsx(Button, { variant: "secondary", onPress: () => setTransferOpen(true), children: "CMS \uC18C\uC720\uC790\uB85C \uC774\uC804" }) : null, _jsx(Button, { variant: current.status === "active" ? "danger" : "secondary", onPress: () => setConfirmStatus(true), isDisabled: current.isOwner, children: current.status === "active" ? "계정 비활성화" : "계정 재활성화" }), _jsx(Button, { onPress: () => update.mutate(), isDisabled: update.isPending || nextIdentifier.trim() === current.primaryIdentifier || nextIdentifier.trim() === "", children: "\uBCC0\uACBD \uC800\uC7A5" })] })] }), current.kind === "human" ? (_jsxs("section", { className: styles.panel, "aria-labelledby": "credentials-title", children: [_jsx(SectionHeader, { id: "credentials-title", title: "Credential & session", description: "\uD65C\uC131 session\uB9CC \uAE30\uBCF8 \uD45C\uC2DC\uD569\uB2C8\uB2E4. \uD3D0\uAE30\u00B7\uB9CC\uB8CC \uC774\uB825\uC740 \uBCC4\uB3C4 \uD398\uC774\uC9C0\uC5D0\uC11C \uC870\uD68C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }), _jsxs("div", { className: styles.formActions, children: [_jsx(Button, { variant: "secondary", onPress: () => setCredentialTokenPurpose("invitation"), isDisabled: current.status === "disabled", children: "\uCD08\uB300 token \uBC1C\uAE09" }), _jsx(Button, { variant: "secondary", onPress: () => setCredentialTokenPurpose("password-reset"), isDisabled: current.isOwner || current.status === "disabled", children: "Reset token \uBC1C\uAE09" }), _jsx(Button, { variant: "secondary", onPress: () => setResetOpen(true), isDisabled: current.isOwner || current.status === "disabled", children: "\uC784\uC2DC \uBE44\uBC00\uBC88\uD638 \uC7AC\uC124\uC815" }), _jsx(Button, { variant: "danger", onPress: () => setRevokeAllOpen(true), isDisabled: sessionView !== "active" || (sessions.data?.total ?? 0) === 0, children: "\uBAA8\uB4E0 session \uD3D0\uAE30" })] }), createdCredentialToken !== null ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC9C0\uAE08 \uD55C \uBC88\uB9CC \uD45C\uC2DC\uB429\uB2C8\uB2E4." }), _jsx("br", {}), _jsx("code", { children: createdCredentialToken.secret }), _jsx("br", {}), "\uB9CC\uB8CC: ", formatInstant(createdCredentialToken.expiresAt), _jsx("br", {}), _jsx(Button, { size: "small", variant: "quiet", onPress: () => setCreatedCredentialToken(null), children: "\uD655\uC778" })] })) : null, _jsxs("div", { className: styles.viewSwitcher, role: "group", "aria-label": "Session \uD45C\uC2DC \uBC94\uC704", children: [_jsx(Button, { size: "small", variant: sessionView === "active" ? "secondary" : "quiet", onPress: () => { setSessionView("active"); setSessionPage(1); }, children: "\uD65C\uC131 session" }), _jsx(Button, { size: "small", variant: sessionView === "history" ? "secondary" : "quiet", onPress: () => { setSessionView("history"); setSessionPage(1); }, children: "\uD3D0\uAE30\u00B7\uB9CC\uB8CC \uC774\uB825" })] }), sessions.isPending ? _jsx(PageLoading, { label: "Session\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, sessions.isError ? _jsx(LoadError, { error: sessions.error, onRetry: () => void sessions.refetch() }) : null, sessions.data?.items.length === 0 ? _jsx(EmptyState, { title: sessionView === "active" ? "활성 session이 없습니다" : "폐기·만료 이력이 없습니다", description: sessionView === "active" ? "로그인하면 관리 가능한 활성 session이 표시됩니다." : "폐기되거나 만료된 session이 생기면 이곳에 표시됩니다." }) : null, sessions.data && sessions.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Audience / Realm" }), _jsx("th", { children: "\uC778\uC99D" }), _jsx("th", { children: "\uB9CC\uB8CC" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", { children: "\uC791\uC5C5" })] }) }), _jsx("tbody", { children: sessions.data.items.map((session) => _jsxs("tr", { children: [_jsxs("td", { children: [_jsxs("strong", { children: [session.audience === "admin" ? "Admin" : "Content", session.current ? " · 현재" : ""] }), _jsx("span", { className: styles.secondaryLine, children: session.realmName })] }), _jsx("td", { children: formatInstant(session.authenticatedAt) }), _jsx("td", { children: formatInstant(session.expiresAt) }), _jsx("td", { children: session.revokedAt !== undefined
                                                    ? _jsx(Badge, { tone: "neutral", children: "\uD3D0\uAE30\uB428" })
                                                    : Date.parse(session.expiresAt) <= Date.now()
                                                        ? _jsx(Badge, { tone: "neutral", children: "\uB9CC\uB8CC\uB428" })
                                                        : _jsx(Badge, { tone: "success", children: "\uD65C\uC131" }) }), _jsx("td", { children: session.revokedAt === undefined && Date.parse(session.expiresAt) > Date.now()
                                                    ? _jsx(Button, { size: "small", variant: "danger", onPress: () => setRevokeSessionId(session.sessionId), children: "\uD3D0\uAE30" })
                                                    : _jsx("span", { className: styles.secondaryLine, children: session.revokeReason ?? (session.revokedAt === undefined ? "자동 만료" : formatInstant(session.revokedAt)) }) })] }, session.sessionId)) })] }) })) : null, sessions.data && sessions.data.total > sessions.data.pageSize ? (_jsxs("div", { className: styles.pagination, role: "group", "aria-label": "Session \uC774\uB825 \uD398\uC774\uC9C0", children: [_jsx(Button, { size: "small", variant: "quiet", isDisabled: sessions.data.page <= 1, onPress: () => setSessionPage((page) => Math.max(1, page - 1)), children: "\uC774\uC804" }), _jsxs("span", { children: [sessions.data.page, " / ", Math.ceil(sessions.data.total / sessions.data.pageSize), " \u00B7 \uCD1D ", sessions.data.total, "\uAC74"] }), _jsx(Button, { size: "small", variant: "quiet", isDisabled: sessions.data.page * sessions.data.pageSize >= sessions.data.total, onPress: () => setSessionPage((page) => page + 1), children: "\uB2E4\uC74C" })] })) : null, _jsx(ErrorCallout, { error: resetCredentials.error ?? createCredentialToken.error ?? revokeSession.error ?? revokeAllSessions.error })] })) : null, current.kind === "service" ? (_jsxs("section", { className: styles.panel, "aria-labelledby": "api-keys-title", children: [_jsx(SectionHeader, { id: "api-keys-title", title: "API keys", description: "\uC2E4\uC81C \uD5C8\uC6A9 \uAD8C\uD55C\uC740 \uC11C\uBE44\uC2A4 \uACC4\uC815 \uAD8C\uD55C \uB300\uC0C1\uC758 \uC5ED\uD560 \uAD8C\uD55C\uACFC key scope\uC758 \uAD50\uC9D1\uD569\uC785\uB2C8\uB2E4." }), _jsx("div", { className: styles.formActions, children: _jsxs(Button, { onPress: () => setApiKeyOpen(true), isDisabled: current.status === "disabled", children: [_jsx(Icon, { name: "plus", size: 16 }), "API key \uC0DD\uC131"] }) }), createdApiKeySecret !== null ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC9C0\uAE08 \uD55C \uBC88\uB9CC \uD45C\uC2DC\uB429\uB2C8\uB2E4." }), _jsx("br", {}), _jsx("code", { children: createdApiKeySecret }), _jsx("br", {}), _jsx(Button, { size: "small", variant: "quiet", onPress: () => setCreatedApiKeySecret(null), children: "\uD655\uC778" })] })) : null, apiKeys.isPending ? _jsx(PageLoading, { label: "API key\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) : null, apiKeys.isError ? _jsx(LoadError, { error: apiKeys.error, onRetry: () => void apiKeys.refetch() }) : null, apiKeys.data?.items.length === 0 ? _jsx(EmptyState, { title: "API key\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4", description: "Role binding\uC744 \uBA3C\uC800 \uAD6C\uC131\uD55C \uB4A4 \uCD5C\uC18C scope\uC758 key\uB97C \uC0DD\uC131\uD558\uC138\uC694." }) : null, apiKeys.data && apiKeys.data.items.length > 0 ? (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\uC774\uB984 / Prefix" }), _jsx("th", { children: "Scopes" }), _jsx("th", { children: "\uC0DD\uC131" }), _jsx("th", { children: "\uCD5C\uADFC \uC0AC\uC6A9" }), _jsx("th", { children: "\uC791\uC5C5" })] }) }), _jsx("tbody", { children: apiKeys.data.items.map((key) => _jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: key.name }), _jsx("span", { className: styles.secondaryLine, children: key.prefix })] }), _jsx("td", { children: _jsx("code", { children: key.scopes.join(", ") || "default deny" }) }), _jsx("td", { children: formatInstant(key.createdAt) }), _jsx("td", { children: key.lastUsedAt === undefined ? "—" : formatInstant(key.lastUsedAt) }), _jsx("td", { children: key.revokedAt === undefined ? _jsx(Button, { size: "small", variant: "danger", onPress: () => setRevokeApiKeyId(key.apiKeyId), children: "\uD3D0\uAE30" }) : _jsx(Badge, { tone: "neutral", children: "\uD3D0\uAE30\uB428" }) })] }, key.apiKeyId)) })] }) })) : null, _jsx(ErrorCallout, { error: createApiKey.error ?? revokeApiKey.error })] })) : null, _jsxs("section", { className: styles.panel, "aria-labelledby": "memberships-title", children: [_jsx(SectionHeader, { id: "memberships-title", title: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC18C\uC18D(Membership)", description: "\uC18C\uC18D \uC0C1\uD0DC\uC640 \uC5F0\uACB0\uB41C \uAD8C\uD55C \uB300\uC0C1\uC744 \uD655\uC778\uD569\uB2C8\uB2E4." }), current.kind === "human" && current.status === "active" && !current.memberships.some(({ realmKind }) => realmKind === "system") ? (_jsx("div", { className: styles.formActions, children: _jsx(Button, { onPress: () => createSystemMembership.mutate(), isDisabled: createSystemMembership.isPending, children: "\uC6B4\uC601 \uACC4\uC815\uC73C\uB85C \uC2B9\uACA9" }) })) : null, _jsx(ErrorCallout, { error: createSystemMembership.error }), current.memberships.length === 0 ? _jsx(EmptyState, { title: "\uC18C\uC18D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC0C1\uC138\uC5D0\uC11C \uBA85\uC2DC\uC801\uC73C\uB85C provisioning\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) : (_jsx("div", { className: styles.tableWrap, children: _jsxs("table", { className: styles.table, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04" }), _jsx("th", { children: "\uC0C1\uD0DC" }), _jsx("th", { children: "\uAD8C\uD55C \uB300\uC0C1" }), _jsx("th", { children: "Profile" })] }) }), _jsx("tbody", { children: current.memberships.map((membership) => _jsxs("tr", { children: [_jsxs("td", { children: [_jsx("strong", { children: membership.realmName }), _jsx("span", { className: styles.secondaryLine, children: membership.realmKey })] }), _jsx("td", { children: _jsx(Badge, { tone: membership.status === "active" ? "success" : membership.status === "pending" ? "warning" : "danger", children: membership.status }) }), _jsx("td", { children: _jsx("code", { children: membership.subjectId }) }), _jsx("td", { children: membership.profileDocumentId ?? "—" })] }, membership.membershipId)) })] }) }))] }), confirmStatus ? (_jsx(ConfirmDialog, { title: current.status === "active" ? "계정 비활성화" : "계정 재활성화", confirmLabel: current.status === "active" ? "비활성화" : "재활성화", danger: current.status === "active", isPending: statusMutation.isPending, onCancel: () => setConfirmStatus(false), onConfirm: () => statusMutation.mutate(), children: _jsxs("p", { children: [_jsx("strong", { children: current.primaryIdentifier }), "\uC758 ", current.status === "active" ? "모든 활성 session과 API key를 폐기합니다." : "계정만 활성화하며 기존 session은 복원하지 않습니다."] }) })) : null, resetOpen ? (_jsx(ConfirmDialog, { title: "\uC784\uC2DC \uBE44\uBC00\uBC88\uD638 \uC7AC\uC124\uC815", confirmLabel: "Credential \uC7AC\uC124\uC815", danger: true, isPending: resetCredentials.isPending, isConfirmDisabled: temporaryPassword.length < 12 || currentPassword === "", onCancel: () => setResetOpen(false), onConfirm: () => resetCredentials.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("strong", { children: current.primaryIdentifier }), "\uC758 \uAE30\uC874 session\uC774 \uBAA8\uB450 \uD3D0\uAE30\uB418\uACE0 \uB2E4\uC74C \uB85C\uADF8\uC778 \uD6C4 password \uBCC0\uACBD\uC774 \uD544\uC694\uD569\uB2C8\uB2E4."] }), _jsx(TextInput, { label: "\uC0C8 \uC784\uC2DC \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", value: temporaryPassword, onChange: setTemporaryPassword, isRequired: true }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: currentPassword, onChange: setCurrentPassword, isRequired: true }), _jsx(CheckboxField, { isSelected: revokeApiKeys, onChange: setRevokeApiKeys, children: "\uC774 Identity\uC758 API key\uB3C4 \uBAA8\uB450 \uD3D0\uAE30" })] }) })) : null, credentialTokenPurpose !== null ? (_jsx(ConfirmDialog, { title: credentialTokenPurpose === "invitation" ? "초대 token 발급" : "비밀번호 reset token 발급", confirmLabel: "Token \uBC1C\uAE09", danger: credentialTokenPurpose === "password-reset", isPending: createCredentialToken.isPending, isConfirmDisabled: credentialTokenPassword === "", onCancel: () => setCredentialTokenPurpose(null), onConfirm: () => createCredentialToken.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: ["\uC6D0\uBB38 token\uC740 \uC0DD\uC131 \uC9C1\uD6C4 \uD55C \uBC88\uB9CC \uD45C\uC2DC\uB429\uB2C8\uB2E4. ", credentialTokenPurpose === "password-reset" ? "기존 session은 즉시 폐기됩니다." : "새 token을 만들면 이전 미사용 token은 폐기됩니다."] }), _jsx(TextInput, { label: "\uD604\uC7AC System \uACC4\uC815 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: credentialTokenPassword, onChange: setCredentialTokenPassword, isRequired: true })] }) })) : null, revokeSessionId !== null ? (_jsx(ConfirmDialog, { title: "Session \uD3D0\uAE30", confirmLabel: "\uD3D0\uAE30", danger: true, isPending: revokeSession.isPending, onCancel: () => setRevokeSessionId(null), onConfirm: () => revokeSession.mutate(revokeSessionId), children: _jsx("p", { children: "\uC120\uD0DD\uD55C session\uC740 \uC751\uB2F5\uC774 \uC644\uB8CC\uB41C \uC9C1\uD6C4\uBD80\uD130 \uB354 \uC774\uC0C1 \uC778\uC99D\uC5D0 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }) })) : null, revokeAllOpen ? (_jsx(ConfirmDialog, { title: "\uBAA8\uB4E0 session \uD3D0\uAE30", confirmLabel: "\uBAA8\uB450 \uD3D0\uAE30", danger: true, isPending: revokeAllSessions.isPending, onCancel: () => setRevokeAllOpen(false), onConfirm: () => revokeAllSessions.mutate(), children: _jsxs("p", { children: [_jsx("strong", { children: current.primaryIdentifier }), "\uC758 Admin\u00B7Content session\uC744 \uBAA8\uB450 \uD3D0\uAE30\uD569\uB2C8\uB2E4."] }) })) : null, transferOpen ? (_jsx(ConfirmDialog, { title: "CMS \uC18C\uC720\uC790(Owner) \uC774\uC804", confirmLabel: "\uC18C\uC720\uC790 \uC774\uC804", danger: true, isPending: transferOwner.isPending, isConfirmDisabled: transferReason.trim().length < 3 || transferPassword === "", onCancel: () => setTransferOpen(false), onConfirm: () => transferOwner.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsxs("p", { children: [_jsx("strong", { children: current.primaryIdentifier }), "\uC5D0\uAC8C CMS \uCD5C\uACE0\uAD00\uB9AC\uC790 \uAD8C\uD55C\uC744 \uC774\uC804\uD569\uB2C8\uB2E4. \uBAA8\uB4E0 Admin session\uC774 \uD3D0\uAE30\uB418\uC5B4 \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574\uC57C \uD569\uB2C8\uB2E4."] }), _jsx(TextAreaField, { label: "\uC774\uC804 \uC0AC\uC720", value: transferReason, onChange: setTransferReason, rows: 3, isRequired: true }), _jsx(TextInput, { label: "\uD604\uC7AC \uC18C\uC720\uC790 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", value: transferPassword, onChange: setTransferPassword, isRequired: true })] }) })) : null, apiKeyOpen ? (_jsx(ConfirmDialog, { title: "API key \uC0DD\uC131", confirmLabel: "Key \uC0DD\uC131", isPending: createApiKey.isPending, isConfirmDisabled: apiKeyName.trim() === "", onCancel: () => setApiKeyOpen(false), onConfirm: () => createApiKey.mutate(), children: _jsxs("div", { className: styles.dialogStack, children: [_jsx(TextInput, { label: "Key \uC774\uB984", value: apiKeyName, onChange: setApiKeyName, placeholder: "Production reader", isRequired: true }), _jsx(TextInput, { label: "Permission scopes", value: apiKeyScopes, onChange: setApiKeyScopes, description: "\uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4. \uBE44\uC6B0\uBA74 default deny\uC785\uB2C8\uB2E4.", placeholder: "content.list, content.read" }), _jsx(TextInput, { label: "\uB9CC\uB8CC \uC2DC\uAC01", type: "datetime-local", value: apiKeyExpiresAt, onChange: setApiKeyExpiresAt })] }) })) : null, revokeApiKeyId !== null ? (_jsx(ConfirmDialog, { title: "API key \uD3D0\uAE30", confirmLabel: "Key \uD3D0\uAE30", danger: true, isPending: revokeApiKey.isPending, onCancel: () => setRevokeApiKeyId(null), onConfirm: () => revokeApiKey.mutate(revokeApiKeyId), children: _jsx("p", { children: "\uD3D0\uAE30\uB41C \uC6D0\uBB38 key\uB294 \uC989\uC2DC \uC778\uC99D\uC5D0 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uACE0 \uB2E4\uC2DC \uD65C\uC131\uD654\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }) })) : null] }));
}
//# sourceMappingURL=user-pages.js.map