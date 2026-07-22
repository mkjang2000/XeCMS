import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AdminRuntimeApiError,
  AdminRuntimeShell,
  loadAdminAppRuntime,
} from "@xecms/admin-runtime";
import { type AdminAppRuntimeDto } from "@xecms/client";
import { useLocation, useNavigate, useParams } from "react-router";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { xecmsClient } from "../xecms-client.js";
import styles from "../runtime-entry.module.css";

type AudienceHint =
  | { readonly type: "system" }
  | { readonly type: "content-realm"; readonly realmId: string; readonly realmKey: string; readonly name: string };

export function AdminRuntimePage() {
  const { appKey = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [runtime, setRuntime] = useState<AdminAppRuntimeDto | null>(null);
  const [audience, setAudience] = useState<AudienceHint | null>(() => storedAudience(appKey));
  const [error, setError] = useState<AdminRuntimeApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null);
  const basePath = `/apps/${encodeURIComponent(appKey)}`;
  const relativePath = location.pathname.slice(basePath.length).replace(/^\/+/, "");

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const loaded = await loadAdminAppRuntime(appKey);
      setRuntime(loaded);
      const hint: AudienceHint = loaded.user.realmKey === undefined
        ? { type: "system" }
        : {
            type: "content-realm",
            realmId: loaded.user.realmId,
            realmKey: loaded.user.realmKey,
            name: loaded.user.realmKey,
          };
      rememberAudience(appKey, hint); setAudience(hint);
    } catch (caught) {
      const next = caught instanceof AdminRuntimeApiError
        ? caught
        : new AdminRuntimeApiError(0, "UNKNOWN_ERROR", caught instanceof Error ? caught.message : "App을 열 수 없습니다.");
      const hint = audienceFromProblem(next);
      if (hint !== null) { rememberAudience(appKey, hint); setAudience(hint); }
      setRuntime(null); setError(next);
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, [appKey]);

  const switchAccount = async () => {
    if (audience === null) return;
    setSwitchingAccount(true); setAccountSwitchError(null);
    try {
      if (audience.type === "system") {
        const session = await xecmsClient.auth.getSession();
        if (session.user !== null) await xecmsClient.auth.logout();
      } else {
        const realm = xecmsClient.contentRealms.forRealm(audience.realmKey);
        const session = await realm.getSession();
        if (session.authenticated) await realm.logout();
      }
      await reload();
    } catch (caught) {
      setAccountSwitchError(caught instanceof Error ? caught.message : "로그아웃에 실패했습니다.");
    } finally { setSwitchingAccount(false); }
  };

  if (loading) return <EntryLayout><LoadingIndicator label="App을 불러오는 중" /></EntryLayout>;
  if (runtime !== null) return (
    <AdminRuntimeShell
      runtime={runtime}
      relativePath={relativePath}
      navigate={(path, replace = false) => navigate(`${basePath}/${path}`, { replace })}
      onSessionEnded={() => void reload()}
    />
  );
  if (error?.status === 401 && audience !== null) return (
    <EntryLayout>
      <RuntimeLogin audience={audience} appKey={appKey} onAuthenticated={reload} />
    </EntryLayout>
  );
  if (error?.status === 403) return (
    <EntryLayout>
      <Message title="App 접근 권한이 없습니다" description="관리자에게 이 App의 admin-app.access 권한을 요청하거나, 권한이 있는 다른 계정으로 로그인해 주세요.">
        {accountSwitchError ? <Callout tone="error">{accountSwitchError}</Callout> : null}
        {audience !== null ? (
          <Button onPress={() => void switchAccount()} isDisabled={switchingAccount}>
            {switchingAccount ? "로그아웃 중…" : "로그아웃 후 다른 계정으로 로그인"}
          </Button>
        ) : null}
      </Message>
    </EntryLayout>
  );
  if (error?.status === 404) return <EntryLayout><Message title="App을 찾을 수 없습니다" description="주소가 올바른지, App이 활성 상태인지 확인해 주세요." /></EntryLayout>;
  return <EntryLayout><Message title="App을 열 수 없습니다" description={error?.message ?? "잠시 후 다시 시도해 주세요."} retry={() => void reload()} /></EntryLayout>;
}

function RuntimeLogin({ audience, appKey, onAuthenticated }: {
  readonly audience: AudienceHint;
  readonly appKey: string;
  readonly onAuthenticated: () => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(() => xecmsClient, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError(null);
    try {
      if (audience.type === "system") {
        const result = await client.auth.login({ username: identifier, password });
        if (result.passwordChangeRequired === true) {
          window.location.href = `/admin/password-change?returnTo=${encodeURIComponent(`/apps/${appKey}`)}`;
          return;
        }
      } else {
        await client.contentRealms.forRealm(audience.realmKey).login({ identifier, password });
      }
      await onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
    } finally { setPending(false); }
  };
  return <section className={styles.loginCard}>
    <header><span>XeCMS Custom Admin App</span><h1>{audience.type === "system" ? "운영 계정으로 로그인" : `${audience.name} 로그인`}</h1>
      <p>{audience.type === "system" ? "System Realm 계정을 사용합니다." : `${audience.realmKey} Realm 멤버십이 필요합니다.`}</p></header>
    {error ? <Callout tone="error">{error}</Callout> : null}
    <form onSubmit={(event) => void submit(event)}>
      <label><span>{audience.type === "system" ? "사용자 이름" : "식별자"}</span><input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>
      <label><span>비밀번호</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <Button type="submit" isDisabled={pending}>{pending ? "로그인 중…" : "로그인"}</Button>
    </form>
  </section>;
}

function EntryLayout({ children }: { readonly children: React.ReactNode }) {
  return <main className={styles.entry}><div className={styles.entryBrand}>XeCMS <span>Apps</span></div>{children}</main>;
}

function Message({ title, description, retry, children }: {
  readonly title: string;
  readonly description: string;
  readonly retry?: () => void;
  readonly children?: React.ReactNode;
}) {
  return <section className={styles.message}><h1>{title}</h1><p>{description}</p>{children}{retry ? <Button onPress={retry}>다시 시도</Button> : null}</section>;
}

function audienceFromProblem(error: AdminRuntimeApiError): AudienceHint | null {
  const details = error.problem?.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return null;
  const candidate = (details as Readonly<Record<string, unknown>>)["audience"];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
  const audience = candidate as Readonly<Record<string, unknown>>;
  if (audience["type"] === "system") return { type: "system" };
  if (audience["type"] === "content-realm" && typeof audience["realmId"] === "string"
    && typeof audience["realmKey"] === "string" && typeof audience["name"] === "string") {
    return { type: "content-realm", realmId: audience["realmId"], realmKey: audience["realmKey"], name: audience["name"] };
  }
  return null;
}

function rememberAudience(appKey: string, audience: AudienceHint): void {
  try { sessionStorage.setItem(`xecms:admin-app:${appKey}:audience`, JSON.stringify(audience)); } catch { /* storage is optional */ }
}

function storedAudience(appKey: string): AudienceHint | null {
  try {
    const source = sessionStorage.getItem(`xecms:admin-app:${appKey}:audience`);
    if (source === null) return null;
    const parsed = JSON.parse(source) as AudienceHint;
    return parsed.type === "system" || parsed.type === "content-realm" ? parsed : null;
  } catch { return null; }
}
