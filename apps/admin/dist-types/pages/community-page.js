import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { createXeCmsClient, XeCmsApiError, } from "@xecms/client";
import { useParams } from "react-router";
import styles from "../community.module.css";
function errorMessage(error) {
    if (error instanceof XeCmsApiError)
        return `${error.message} (${error.code})`;
    return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}
function parseObject(source) {
    const value = JSON.parse(source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("JSON object를 입력해 주세요.");
    }
    return value;
}
export function CommunityPage() {
    const { realmKey = "" } = useParams();
    const client = useMemo(() => createXeCmsClient().contentRealms.forRealm(realmKey), [realmKey]);
    const [metadata, setMetadata] = useState(null);
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [collections, setCollections] = useState([]);
    const [selectedCollectionId, setSelectedCollectionId] = useState("");
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const loadContent = async () => {
        const collectionResult = await client.listCollections();
        setCollections(collectionResult.items);
        setSelectedCollectionId((current) => current || collectionResult.items[0]?.id || "");
    };
    const refreshIdentity = async () => {
        const nextSession = await client.getSession();
        setSession(nextSession);
        if (nextSession.authenticated) {
            const [nextProfile] = await Promise.all([client.getProfile(), loadContent()]);
            setProfile(nextProfile);
        }
        else {
            setProfile(null);
            setCollections([]);
            setDocuments([]);
        }
    };
    useEffect(() => {
        let current = true;
        setLoading(true);
        setError(null);
        void Promise.all([client.getMetadata(), client.getSession()])
            .then(async ([nextMetadata, nextSession]) => {
            if (!current)
                return;
            setMetadata(nextMetadata);
            setSession(nextSession);
            if (nextSession.authenticated) {
                const [nextProfile, nextCollections] = await Promise.all([
                    client.getProfile(),
                    client.listCollections(),
                ]);
                if (!current)
                    return;
                setProfile(nextProfile);
                setCollections(nextCollections.items);
                setSelectedCollectionId(nextCollections.items[0]?.id ?? "");
            }
        })
            .catch((caught) => current && setError(errorMessage(caught)))
            .finally(() => current && setLoading(false));
        return () => { current = false; };
    }, [client]);
    useEffect(() => {
        if (!session?.authenticated || selectedCollectionId === "") {
            setDocuments([]);
            return;
        }
        let current = true;
        setError(null);
        void client.listDocuments(selectedCollectionId, { page: 1, pageSize: 50 })
            .then((result) => current && setDocuments(result.items))
            .catch((caught) => current && setError(errorMessage(caught)));
        return () => { current = false; };
    }, [client, selectedCollectionId, session?.authenticated]);
    if (loading)
        return _jsx("main", { className: styles.center, children: _jsx("div", { className: styles.loading, children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\u2026" }) });
    if (metadata === null || session === null) {
        return _jsx("main", { className: styles.center, children: _jsx(ErrorCard, { message: error ?? "사용자 공간을 불러올 수 없습니다." }) });
    }
    return (_jsxs("main", { className: styles.shell, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { children: [_jsx("span", { className: styles.brand, children: "XeCMS \u00B7 Community" }), _jsx("h1", { children: metadata.name }), _jsxs("p", { children: [_jsx("code", { children: metadata.realmKey }), " Realm\uC758 \uB3C5\uB9BD \uACC4\uC815\u00B7\uD504\uB85C\uD544\u00B7\uCF58\uD150\uCE20 \uAD8C\uD55C \uAC80\uC99D \uD654\uBA74\uC785\uB2C8\uB2E4."] })] }), _jsx("span", { className: styles.realmBadge, children: session.authenticated ? "SIGNED IN" : "GUEST" })] }), error ? _jsx("div", { className: styles.error, role: "alert", children: error }) : null, session.authenticated ? (_jsx(CommunityWorkspace, { client: client, session: session, profile: profile, collections: collections, selectedCollectionId: selectedCollectionId, documents: documents, onSelectCollection: setSelectedCollectionId, onDocumentsChange: setDocuments, onProfileChange: setProfile, onError: setError, onLogout: async () => { await client.logout(); await refreshIdentity(); } })) : (_jsx(AuthenticationPanel, { metadata: metadata, onAuthenticate: async (mode, identifier, password, profileSource) => {
                    setError(null);
                    if (mode === "signup") {
                        await client.signup({ identifier, password, profile: parseObject(profileSource) });
                    }
                    else {
                        await client.login({
                            identifier,
                            password,
                            ...(metadata.acceptSystemIdentities && metadata.provisioning === "jit"
                                ? { jitProfile: parseObject(profileSource) }
                                : {}),
                        });
                    }
                    await refreshIdentity();
                }, onError: setError }))] }));
}
function AuthenticationPanel({ metadata, onAuthenticate, onError }) {
    const [mode, setMode] = useState("login");
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [profile, setProfile] = useState("{\n  \"displayName\": \"\"\n}");
    const [pending, setPending] = useState(false);
    const submit = async (event) => {
        event.preventDefault();
        setPending(true);
        try {
            await onAuthenticate(mode, identifier.trim(), password, profile);
        }
        catch (caught) {
            onError(errorMessage(caught));
        }
        finally {
            setPending(false);
        }
    };
    return (_jsxs("section", { className: styles.authCard, "aria-label": "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC778\uC99D", children: [_jsxs("div", { className: styles.tabs, children: [_jsx("button", { type: "button", "data-active": mode === "login", onClick: () => setMode("login"), children: "\uB85C\uADF8\uC778" }), _jsx("button", { type: "button", "data-active": mode === "signup", disabled: metadata.registration !== "open", onClick: () => setMode("signup"), children: "\uD68C\uC6D0\uAC00\uC785" })] }), _jsxs("form", { onSubmit: (event) => void submit(event), className: styles.form, children: [_jsxs("label", { children: [_jsx("span", { children: "Identifier" }), _jsx("input", { name: "identifier", autoComplete: "username", value: identifier, onChange: (event) => setIdentifier(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\uBE44\uBC00\uBC88\uD638" }), _jsx("input", { name: "password", type: "password", autoComplete: mode === "signup" ? "new-password" : "current-password", value: password, onChange: (event) => setPassword(event.target.value), required: true })] }), mode === "signup" || (metadata.acceptSystemIdentities && metadata.provisioning === "jit") ? _jsxs("label", { children: [_jsx("span", { children: mode === "signup" ? "Profile JSON" : "JIT Profile JSON" }), _jsx("textarea", { name: "profile", rows: 7, value: profile, onChange: (event) => setProfile(event.target.value) })] }) : null, _jsx("button", { className: styles.primaryButton, type: "submit", disabled: pending || !identifier.trim() || !password, children: pending ? "처리 중…" : mode === "signup" ? "계정 만들기" : "로그인" })] }), _jsxs("p", { className: styles.help, children: ["\uC2DD\uBCC4 \uD544\uB4DC: ", metadata.identifierFieldIds.join(", "), " \u00B7 \uAC00\uC785 \uC815\uCC45: ", metadata.registration] })] }));
}
function CommunityWorkspace({ client, session, profile, collections, selectedCollectionId, documents, onSelectCollection, onDocumentsChange, onProfileChange, onError, onLogout }) {
    const [profileSource, setProfileSource] = useState(() => JSON.stringify(profile?.data ?? {}, null, 2));
    const [documentSource, setDocumentSource] = useState("{\n  \"title\": \"\"\n}");
    const [editing, setEditing] = useState(null);
    const [pending, setPending] = useState(false);
    useEffect(() => setProfileSource(JSON.stringify(profile?.data ?? {}, null, 2)), [profile]);
    const run = async (operation) => {
        setPending(true);
        onError(null);
        try {
            await operation();
        }
        catch (caught) {
            onError(errorMessage(caught));
        }
        finally {
            setPending(false);
        }
    };
    const saveDocument = () => run(async () => {
        const data = parseObject(documentSource);
        const saved = editing === null
            ? await client.createDocument(selectedCollectionId, { data })
            : await client.updateDocument(selectedCollectionId, editing.id, { data, expectedVersion: editing.version });
        onDocumentsChange(editing === null ? [saved, ...documents] : documents.map((item) => item.id === saved.id ? saved : item));
        setEditing(null);
        setDocumentSource("{\n  \"title\": \"\"\n}");
    });
    return (_jsxs("div", { className: styles.workspace, children: [_jsxs("aside", { className: styles.sidebar, children: [_jsxs("div", { className: styles.identity, children: [_jsx("span", { children: "Content Subject" }), _jsx("strong", { children: session.subjectId }), _jsxs("small", { children: ["Membership r", session.membershipRevision] })] }), _jsxs("nav", { "aria-label": "\uD5C8\uC6A9\uB41C \uCEEC\uB809\uC158", children: [_jsx("h2", { children: "\uC811\uADFC \uAC00\uB2A5\uD55C \uCF58\uD150\uCE20" }), collections.length === 0 ? _jsx("p", { children: "\uBD80\uC5EC\uB41C \uCF58\uD150\uCE20 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }) : collections.map((collection) => _jsxs("button", { type: "button", "data-active": collection.id === selectedCollectionId, onClick: () => onSelectCollection(collection.id), children: [_jsx("strong", { children: collection.label ?? collection.name }), _jsx("small", { children: collection.id })] }, collection.id))] }), _jsx("button", { className: styles.secondaryButton, type: "button", onClick: () => void run(onLogout), children: "\uB85C\uADF8\uC544\uC6C3" })] }), _jsxs("div", { className: styles.content, children: [_jsxs("section", { className: styles.card, children: [_jsxs("div", { className: styles.sectionHeader, children: [_jsxs("div", { children: [_jsx("span", { children: "PROFILE" }), _jsx("h2", { children: "Realm \uD504\uB85C\uD544" })] }), _jsx("button", { className: styles.secondaryButton, type: "button", disabled: pending || profile === null, onClick: () => void run(async () => onProfileChange(await client.updateProfile({ expectedRevision: profile.revision, data: parseObject(profileSource) }))), children: "\uD504\uB85C\uD544 \uC800\uC7A5" })] }), _jsx("textarea", { "aria-label": "Profile JSON", rows: 6, value: profileSource, onChange: (event) => setProfileSource(event.target.value) })] }), _jsxs("section", { className: styles.card, children: [_jsxs("div", { className: styles.sectionHeader, children: [_jsxs("div", { children: [_jsx("span", { children: "AUTHORIZED CONTENT" }), _jsx("h2", { children: collections.find(({ id }) => id === selectedCollectionId)?.label ?? "콘텐츠" })] }), _jsxs("small", { children: [documents.length, " documents"] })] }), selectedCollectionId === "" ? _jsx("p", { className: styles.empty, children: "\uC5ED\uD560 \uBC14\uC778\uB529\uC744 \uBC1B\uC544\uC57C \uCEEC\uB809\uC158\uACFC \uBB38\uC11C\uB97C \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4." }) : _jsxs("div", { className: styles.documentLayout, children: [_jsx("div", { className: styles.documentList, children: documents.length === 0 ? _jsx("p", { className: styles.empty, children: "\uBB38\uC11C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." }) : documents.map((document) => _jsxs("button", { type: "button", onClick: () => { setEditing(document); setDocumentSource(JSON.stringify(document.data, null, 2)); }, children: [_jsx("strong", { children: String(document.data["title"] ?? document.id) }), _jsxs("small", { children: ["v", document.version, " \u00B7 ", document.displayState] })] }, document.id)) }), _jsxs("div", { className: styles.editor, children: [_jsx("h3", { children: editing ? "문서 수정" : "새 문서" }), _jsx("textarea", { "aria-label": "Document JSON", rows: 12, value: documentSource, onChange: (event) => setDocumentSource(event.target.value) }), _jsxs("div", { className: styles.actions, children: [editing ? _jsx("button", { className: styles.secondaryButton, type: "button", onClick: () => { setEditing(null); setDocumentSource("{}"); }, children: "\uCDE8\uC18C" }) : null, _jsx("button", { className: styles.primaryButton, type: "button", disabled: pending, onClick: () => void saveDocument(), children: editing ? "수정 저장" : "문서 생성" })] })] })] })] })] })] }));
}
function ErrorCard({ message }) {
    return _jsxs("section", { className: styles.authCard, children: [_jsx("h1", { children: "Community \uD654\uBA74\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4" }), _jsx("p", { children: message }), _jsx("button", { className: styles.primaryButton, type: "button", onClick: () => window.location.reload(), children: "\uB2E4\uC2DC \uC2DC\uB3C4" })] });
}
//# sourceMappingURL=community-page.js.map