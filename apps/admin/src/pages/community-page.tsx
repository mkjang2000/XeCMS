import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createXeCmsClient,
  XeCmsApiError,
  type CollectionSummaryDto,
  type ContentRealmMetadataDto,
  type ContentRealmProfileDto,
  type ContentSessionDto,
  type DocumentRecordDto,
} from "@xecms/client";
import { useParams } from "react-router";
import styles from "../community.module.css";

function errorMessage(error: unknown): string {
  if (error instanceof XeCmsApiError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

function parseObject(source: string): Readonly<Record<string, unknown>> {
  const value = JSON.parse(source) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("JSON object를 입력해 주세요.");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function CommunityPage() {
  const { realmKey = "" } = useParams();
  const client = useMemo(() => createXeCmsClient().contentRealms.forRealm(realmKey), [realmKey]);
  const [metadata, setMetadata] = useState<ContentRealmMetadataDto | null>(null);
  const [session, setSession] = useState<ContentSessionDto | null>(null);
  const [profile, setProfile] = useState<ContentRealmProfileDto | null>(null);
  const [collections, setCollections] = useState<readonly CollectionSummaryDto[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [documents, setDocuments] = useState<readonly DocumentRecordDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } else {
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
        if (!current) return;
        setMetadata(nextMetadata);
        setSession(nextSession);
        if (nextSession.authenticated) {
          const [nextProfile, nextCollections] = await Promise.all([
            client.getProfile(),
            client.listCollections(),
          ]);
          if (!current) return;
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

  if (loading) return <main className={styles.center}><div className={styles.loading}>사용자 공간을 불러오는 중…</div></main>;
  if (metadata === null || session === null) {
    return <main className={styles.center}><ErrorCard message={error ?? "사용자 공간을 불러올 수 없습니다."} /></main>;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>XeCMS · Community</span>
          <h1>{metadata.name}</h1>
          <p><code>{metadata.realmKey}</code> Realm의 독립 계정·프로필·콘텐츠 권한 검증 화면입니다.</p>
        </div>
        <span className={styles.realmBadge}>{session.authenticated ? "SIGNED IN" : "GUEST"}</span>
      </header>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {session.authenticated ? (
        <CommunityWorkspace
          client={client}
          session={session}
          profile={profile}
          collections={collections}
          selectedCollectionId={selectedCollectionId}
          documents={documents}
          onSelectCollection={setSelectedCollectionId}
          onDocumentsChange={setDocuments}
          onProfileChange={setProfile}
          onError={setError}
          onLogout={async () => { await client.logout(); await refreshIdentity(); }}
        />
      ) : (
        <AuthenticationPanel
          metadata={metadata}
          onAuthenticate={async (mode, identifier, password, profileSource) => {
            setError(null);
            if (mode === "signup") {
              await client.signup({ identifier, password, profile: parseObject(profileSource) });
            } else {
              await client.login({
                identifier,
                password,
                ...(metadata.acceptSystemIdentities && metadata.provisioning === "jit"
                  ? { jitProfile: parseObject(profileSource) }
                  : {}),
              });
            }
            await refreshIdentity();
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

function AuthenticationPanel({ metadata, onAuthenticate, onError }: {
  readonly metadata: ContentRealmMetadataDto;
  readonly onAuthenticate: (mode: "login" | "signup", identifier: string, password: string, profile: string) => Promise<void>;
  readonly onError: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState("{\n  \"displayName\": \"\"\n}");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await onAuthenticate(mode, identifier.trim(), password, profile);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className={styles.authCard} aria-label="사용자 공간 인증">
      <div className={styles.tabs}>
        <button type="button" data-active={mode === "login"} onClick={() => setMode("login")}>로그인</button>
        <button type="button" data-active={mode === "signup"} disabled={metadata.registration !== "open"} onClick={() => setMode("signup")}>회원가입</button>
      </div>
      <form onSubmit={(event) => void submit(event)} className={styles.form}>
        <label><span>Identifier</span><input name="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>
        <label><span>비밀번호</span><input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {mode === "signup" || (metadata.acceptSystemIdentities && metadata.provisioning === "jit") ? <label><span>{mode === "signup" ? "Profile JSON" : "JIT Profile JSON"}</span><textarea name="profile" rows={7} value={profile} onChange={(event) => setProfile(event.target.value)} /></label> : null}
        <button className={styles.primaryButton} type="submit" disabled={pending || !identifier.trim() || !password}>{pending ? "처리 중…" : mode === "signup" ? "계정 만들기" : "로그인"}</button>
      </form>
      <p className={styles.help}>식별 필드: {metadata.identifierFieldIds.join(", ")} · 가입 정책: {metadata.registration}</p>
    </section>
  );
}

function CommunityWorkspace({ client, session, profile, collections, selectedCollectionId, documents, onSelectCollection, onDocumentsChange, onProfileChange, onError, onLogout }: {
  readonly client: ReturnType<ReturnType<typeof createXeCmsClient>["contentRealms"]["forRealm"]>;
  readonly session: Extract<ContentSessionDto, { readonly authenticated: true }>;
  readonly profile: ContentRealmProfileDto | null;
  readonly collections: readonly CollectionSummaryDto[];
  readonly selectedCollectionId: string;
  readonly documents: readonly DocumentRecordDto[];
  readonly onSelectCollection: (id: string) => void;
  readonly onDocumentsChange: (documents: readonly DocumentRecordDto[]) => void;
  readonly onProfileChange: (profile: ContentRealmProfileDto) => void;
  readonly onError: (message: string | null) => void;
  readonly onLogout: () => Promise<void>;
}) {
  const [profileSource, setProfileSource] = useState(() => JSON.stringify(profile?.data ?? {}, null, 2));
  const [documentSource, setDocumentSource] = useState("{\n  \"title\": \"\"\n}");
  const [editing, setEditing] = useState<DocumentRecordDto | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => setProfileSource(JSON.stringify(profile?.data ?? {}, null, 2)), [profile]);
  const run = async (operation: () => Promise<void>) => {
    setPending(true); onError(null);
    try { await operation(); } catch (caught) { onError(errorMessage(caught)); } finally { setPending(false); }
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
  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.identity}><span>Content Subject</span><strong>{session.subjectId}</strong><small>Membership r{session.membershipRevision}</small></div>
        <nav aria-label="허용된 컬렉션">
          <h2>접근 가능한 콘텐츠</h2>
          {collections.length === 0 ? <p>부여된 콘텐츠 권한이 없습니다.</p> : collections.map((collection) => <button type="button" key={collection.id} data-active={collection.id === selectedCollectionId} onClick={() => onSelectCollection(collection.id)}><strong>{collection.label ?? collection.name}</strong><small>{collection.id}</small></button>)}
        </nav>
        <button className={styles.secondaryButton} type="button" onClick={() => void run(onLogout)}>로그아웃</button>
      </aside>
      <div className={styles.content}>
        <section className={styles.card}>
          <div className={styles.sectionHeader}><div><span>PROFILE</span><h2>Realm 프로필</h2></div><button className={styles.secondaryButton} type="button" disabled={pending || profile === null} onClick={() => void run(async () => onProfileChange(await client.updateProfile({ expectedRevision: profile!.revision, data: parseObject(profileSource) })))}>프로필 저장</button></div>
          <textarea aria-label="Profile JSON" rows={6} value={profileSource} onChange={(event) => setProfileSource(event.target.value)} />
        </section>
        <section className={styles.card}>
          <div className={styles.sectionHeader}><div><span>AUTHORIZED CONTENT</span><h2>{collections.find(({ id }) => id === selectedCollectionId)?.label ?? "콘텐츠"}</h2></div><small>{documents.length} documents</small></div>
          {selectedCollectionId === "" ? <p className={styles.empty}>역할 바인딩을 받아야 컬렉션과 문서를 볼 수 있습니다.</p> : <div className={styles.documentLayout}>
            <div className={styles.documentList}>{documents.length === 0 ? <p className={styles.empty}>문서가 없습니다.</p> : documents.map((document) => <button type="button" key={document.id} onClick={() => { setEditing(document); setDocumentSource(JSON.stringify(document.data, null, 2)); }}><strong>{String(document.data["title"] ?? document.id)}</strong><small>v{document.version} · {document.displayState}</small></button>)}</div>
            <div className={styles.editor}><h3>{editing ? "문서 수정" : "새 문서"}</h3><textarea aria-label="Document JSON" rows={12} value={documentSource} onChange={(event) => setDocumentSource(event.target.value)} /><div className={styles.actions}>{editing ? <button className={styles.secondaryButton} type="button" onClick={() => { setEditing(null); setDocumentSource("{}"); }}>취소</button> : null}<button className={styles.primaryButton} type="button" disabled={pending} onClick={() => void saveDocument()}>{editing ? "수정 저장" : "문서 생성"}</button></div></div>
          </div>}
        </section>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { readonly message: string }) {
  return <section className={styles.authCard}><h1>Community 화면을 열 수 없습니다</h1><p>{message}</p><button className={styles.primaryButton} type="button" onClick={() => window.location.reload()}>다시 시도</button></section>;
}
