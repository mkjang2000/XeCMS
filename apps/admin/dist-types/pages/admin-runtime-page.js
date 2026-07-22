import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { AdminRuntimeApiError, AdminRuntimeShell, loadAdminAppRuntime, } from "@xecms/admin-runtime";
import {} from "@xecms/client";
import { useLocation, useNavigate, useParams } from "react-router";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { xecmsClient } from "../xecms-client.js";
import styles from "../runtime-entry.module.css";
export function AdminRuntimePage() {
    const { appKey = "" } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const [runtime, setRuntime] = useState(null);
    const [audience, setAudience] = useState(() => storedAudience(appKey));
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [switchingAccount, setSwitchingAccount] = useState(false);
    const [accountSwitchError, setAccountSwitchError] = useState(null);
    const basePath = `/apps/${encodeURIComponent(appKey)}`;
    const relativePath = location.pathname.slice(basePath.length).replace(/^\/+/, "");
    const reload = async () => {
        setLoading(true);
        setError(null);
        try {
            const loaded = await loadAdminAppRuntime(appKey);
            setRuntime(loaded);
            const hint = loaded.user.realmKey === undefined
                ? { type: "system" }
                : {
                    type: "content-realm",
                    realmId: loaded.user.realmId,
                    realmKey: loaded.user.realmKey,
                    name: loaded.user.realmKey,
                };
            rememberAudience(appKey, hint);
            setAudience(hint);
        }
        catch (caught) {
            const next = caught instanceof AdminRuntimeApiError
                ? caught
                : new AdminRuntimeApiError(0, "UNKNOWN_ERROR", caught instanceof Error ? caught.message : "App을 열 수 없습니다.");
            const hint = audienceFromProblem(next);
            if (hint !== null) {
                rememberAudience(appKey, hint);
                setAudience(hint);
            }
            setRuntime(null);
            setError(next);
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => { void reload(); }, [appKey]);
    const switchAccount = async () => {
        if (audience === null)
            return;
        setSwitchingAccount(true);
        setAccountSwitchError(null);
        try {
            if (audience.type === "system") {
                const session = await xecmsClient.auth.getSession();
                if (session.user !== null)
                    await xecmsClient.auth.logout();
            }
            else {
                const realm = xecmsClient.contentRealms.forRealm(audience.realmKey);
                const session = await realm.getSession();
                if (session.authenticated)
                    await realm.logout();
            }
            await reload();
        }
        catch (caught) {
            setAccountSwitchError(caught instanceof Error ? caught.message : "로그아웃에 실패했습니다.");
        }
        finally {
            setSwitchingAccount(false);
        }
    };
    if (loading)
        return _jsx(EntryLayout, { children: _jsx(LoadingIndicator, { label: "App\uC744 \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (runtime !== null)
        return (_jsx(AdminRuntimeShell, { runtime: runtime, relativePath: relativePath, navigate: (path, replace = false) => navigate(`${basePath}/${path}`, { replace }), onSessionEnded: () => void reload() }));
    if (error?.status === 401 && audience !== null)
        return (_jsx(EntryLayout, { children: _jsx(RuntimeLogin, { audience: audience, appKey: appKey, onAuthenticated: reload }) }));
    if (error?.status === 403)
        return (_jsx(EntryLayout, { children: _jsxs(Message, { title: "App \uC811\uADFC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uAD00\uB9AC\uC790\uC5D0\uAC8C \uC774 App\uC758 admin-app.access \uAD8C\uD55C\uC744 \uC694\uCCAD\uD558\uAC70\uB098, \uAD8C\uD55C\uC774 \uC788\uB294 \uB2E4\uB978 \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.", children: [accountSwitchError ? _jsx(Callout, { tone: "error", children: accountSwitchError }) : null, audience !== null ? (_jsx(Button, { onPress: () => void switchAccount(), isDisabled: switchingAccount, children: switchingAccount ? "로그아웃 중…" : "로그아웃 후 다른 계정으로 로그인" })) : null] }) }));
    if (error?.status === 404)
        return _jsx(EntryLayout, { children: _jsx(Message, { title: "App\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4", description: "\uC8FC\uC18C\uAC00 \uC62C\uBC14\uB978\uC9C0, App\uC774 \uD65C\uC131 \uC0C1\uD0DC\uC778\uC9C0 \uD655\uC778\uD574 \uC8FC\uC138\uC694." }) });
    return _jsx(EntryLayout, { children: _jsx(Message, { title: "App\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4", description: error?.message ?? "잠시 후 다시 시도해 주세요.", retry: () => void reload() }) });
}
function RuntimeLogin({ audience, appKey, onAuthenticated }) {
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const client = useMemo(() => xecmsClient, []);
    const submit = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            if (audience.type === "system") {
                const result = await client.auth.login({ username: identifier, password });
                if (result.passwordChangeRequired === true) {
                    window.location.href = `/admin/password-change?returnTo=${encodeURIComponent(`/apps/${appKey}`)}`;
                    return;
                }
            }
            else {
                await client.contentRealms.forRealm(audience.realmKey).login({ identifier, password });
            }
            await onAuthenticated();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
        }
        finally {
            setPending(false);
        }
    };
    return _jsxs("section", { className: styles.loginCard, children: [_jsxs("header", { children: [_jsx("span", { children: "XeCMS Custom Admin App" }), _jsx("h1", { children: audience.type === "system" ? "운영 계정으로 로그인" : `${audience.name} 로그인` }), _jsx("p", { children: audience.type === "system" ? "System Realm 계정을 사용합니다." : `${audience.realmKey} Realm 멤버십이 필요합니다.` })] }), error ? _jsx(Callout, { tone: "error", children: error }) : null, _jsxs("form", { onSubmit: (event) => void submit(event), children: [_jsxs("label", { children: [_jsx("span", { children: audience.type === "system" ? "사용자 이름" : "식별자" }), _jsx("input", { autoComplete: "username", value: identifier, onChange: (event) => setIdentifier(event.target.value), required: true })] }), _jsxs("label", { children: [_jsx("span", { children: "\uBE44\uBC00\uBC88\uD638" }), _jsx("input", { type: "password", autoComplete: "current-password", value: password, onChange: (event) => setPassword(event.target.value), required: true })] }), _jsx(Button, { type: "submit", isDisabled: pending, children: pending ? "로그인 중…" : "로그인" })] })] });
}
function EntryLayout({ children }) {
    return _jsxs("main", { className: styles.entry, children: [_jsxs("div", { className: styles.entryBrand, children: ["XeCMS ", _jsx("span", { children: "Apps" })] }), children] });
}
function Message({ title, description, retry, children }) {
    return _jsxs("section", { className: styles.message, children: [_jsx("h1", { children: title }), _jsx("p", { children: description }), children, retry ? _jsx(Button, { onPress: retry, children: "\uB2E4\uC2DC \uC2DC\uB3C4" }) : null] });
}
function audienceFromProblem(error) {
    const details = error.problem?.details;
    if (typeof details !== "object" || details === null || Array.isArray(details))
        return null;
    const candidate = details["audience"];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
        return null;
    const audience = candidate;
    if (audience["type"] === "system")
        return { type: "system" };
    if (audience["type"] === "content-realm" && typeof audience["realmId"] === "string"
        && typeof audience["realmKey"] === "string" && typeof audience["name"] === "string") {
        return { type: "content-realm", realmId: audience["realmId"], realmKey: audience["realmKey"], name: audience["name"] };
    }
    return null;
}
function rememberAudience(appKey, audience) {
    try {
        sessionStorage.setItem(`xecms:admin-app:${appKey}:audience`, JSON.stringify(audience));
    }
    catch { /* storage is optional */ }
}
function storedAudience(appKey) {
    try {
        const source = sessionStorage.getItem(`xecms:admin-app:${appKey}:audience`);
        if (source === null)
            return null;
        const parsed = JSON.parse(source);
        return parsed.type === "system" || parsed.type === "content-realm" ? parsed : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=admin-runtime-page.js.map