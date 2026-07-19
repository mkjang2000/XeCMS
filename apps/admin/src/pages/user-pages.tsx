import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi, type ManagedIdentity } from "@xecms/admin";
import {
  Badge,
  Button,
  Callout,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  SelectField,
  TextInput,
  TextAreaField,
} from "@xecms/ui";
import { Link, useNavigate, useParams } from "react-router";

import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { DisplayModeGate, displayModeAtLeast, useDisplayMode } from "../display-mode.js";
import { queryKeys } from "../queries.js";
import styles from "../identity-realms.module.css";

function IdentityStatus({ identity }: { readonly identity: ManagedIdentity }) {
  if (identity.status === "disabled") return <Badge tone="danger">비활성</Badge>;
  if (identity.isOwner) return <Badge tone="info">Owner</Badge>;
  return <Badge tone="success">활성</Badge>;
}

function ErrorCallout({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  const converted = toAdminApiError(error);
  return <Callout tone="error"><strong>{converted.message}</strong> <code>{converted.code}</code></Callout>;
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(value));
}

export function UserListPage() {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mode } = useDisplayMode();
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [creating, setCreating] = useState(false);
  const [createKind, setCreateKind] = useState<"human" | "service">("human");
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
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setQuery(searchDraft.trim());
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Users & access"
        title="사용자"
        description="계정의 상태와 사용자 공간 소속을 한곳에서 관리합니다. 계정을 만들어도 역할은 자동 부여되지 않습니다."
        actions={<>
          <Button variant="secondary" onPress={() => { setCreateKind("service"); setCreating(true); }}><Icon name="plus" size={17} />서비스 계정 생성</Button>
          <Button onPress={() => { setCreateKind("human"); setCreating(true); }}><Icon name="plus" size={17} />운영 계정 생성</Button>
        </>}
      />
      {creating ? (
        <section className={styles.formCard} aria-labelledby="create-user-title">
          <SectionHeader id="create-user-title" title={createKind === "human" ? "새 운영 계정" : "새 서비스 계정"} description={createKind === "human" ? "임시 비밀번호는 첫 로그인 후 변경 대상이 됩니다." : "서비스 계정은 password login을 할 수 없으며 역할과 API key를 별도로 구성합니다."} />
          <form className={styles.formStack} onSubmit={(event) => {
            event.preventDefault();
            if (identifier.trim() === "" || (createKind === "human" && temporaryPassword.length < 12)) return;
            create.mutate();
          }}>
            <div className={styles.fieldGrid}>
              <TextInput label={createKind === "human" ? "로그인 식별자" : "서비스 식별자"} value={identifier} onChange={setIdentifier} placeholder={createKind === "human" ? "editor.user" : "search.indexer"} isRequired />
              {createKind === "human" ? <TextInput label="임시 비밀번호" type="password" autoComplete="new-password" value={temporaryPassword} onChange={setTemporaryPassword} description="12자 이상" isRequired /> : null}
            </div>
            <ErrorCallout error={create.error} />
            <div className={styles.formActions}>
              <Button variant="secondary" onPress={() => setCreating(false)}>취소</Button>
              <Button type="submit" isDisabled={create.isPending || identifier.trim() === "" || (createKind === "human" && temporaryPassword.length < 12)}>{create.isPending ? "생성 중…" : createKind === "human" ? "계정 생성" : "서비스 계정 생성"}</Button>
            </div>
          </form>
        </section>
      ) : null}
      <section className={styles.panel} aria-labelledby="user-list-title">
        <SectionHeader id="user-list-title" title="계정 목록" description="식별자와 활성 상태로 검색할 수 있습니다." />
        <form className={styles.fieldGrid} onSubmit={submitSearch}>
          <TextInput label="식별자 검색" value={searchDraft} onChange={setSearchDraft} placeholder="이름 일부" />
          <SelectField label="상태" value={status} options={[
            { value: "all", label: "전체" },
            { value: "active", label: "활성" },
            { value: "disabled", label: "비활성" },
          ]} onChange={(value) => setStatus(value as typeof status)} />
          <div className={styles.formActions}><Button type="submit" variant="secondary">검색</Button></div>
        </form>
        {identities.isPending ? <PageLoading label="사용자를 불러오는 중" /> : null}
        {identities.isError ? <LoadError error={identities.error} onRetry={() => void identities.refetch()} /> : null}
        {identities.data?.items.length === 0 ? <EmptyState title="조건에 맞는 사용자가 없습니다" description="검색 조건을 바꾸거나 새 운영 계정을 만드세요." /> : null}
        {identities.data && identities.data.items.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>계정</th><th>종류</th><th>상태</th><th>소속</th><th>최근 변경</th></tr></thead>
              <tbody>{identities.data.items.map((identity) => (
                <tr key={identity.identityId}>
                  <td><Link to={`/admin/users/${encodeURIComponent(identity.identityId)}`}><strong>{identity.primaryIdentifier}</strong></Link>{displayModeAtLeast(mode, "advanced") ? <span className={styles.secondaryLine}>{identity.identityId}</span> : null}</td>
                  <td>{identity.kind === "human" ? "사람" : "서비스"}</td>
                  <td><IdentityStatus identity={identity} /></td>
                  <td>{identity.memberships.length}개</td>
                  <td>{formatInstant(identity.updatedAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </Page>
  );
}

export function UserDetailPage() {
  const { identityId } = useParams();
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mode } = useDisplayMode();
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [revokeApiKeys, setRevokeApiKeys] = useState(false);
  const [revokeSessionId, setRevokeSessionId] = useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferReason, setTransferReason] = useState("");
  const [transferPassword, setTransferPassword] = useState("");
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyScopes, setApiKeyScopes] = useState("");
  const [apiKeyExpiresAt, setApiKeyExpiresAt] = useState("");
  const [createdApiKeySecret, setCreatedApiKeySecret] = useState<string | null>(null);
  const [revokeApiKeyId, setRevokeApiKeyId] = useState<string | null>(null);
  const [sessionView, setSessionView] = useState<"active" | "history">("active");
  const [sessionPage, setSessionPage] = useState(1);
  const [credentialTokenPurpose, setCredentialTokenPurpose] = useState<"invitation" | "password-reset" | null>(null);
  const [credentialTokenPassword, setCredentialTokenPassword] = useState("");
  const [createdCredentialToken, setCreatedCredentialToken] = useState<{ readonly secret: string; readonly expiresAt: string } | null>(null);
  const identity = useQuery({
    queryKey: queryKeys.identity(identityId ?? "missing"),
    queryFn: () => api.identities.get(identityId!),
    enabled: identityId !== undefined,
  });
  const sessions = useQuery({
    queryKey: queryKeys.identitySessions(identityId ?? "missing", sessionView, sessionPage),
    queryFn: () => api.identities.listSessions(identityId!, {
      status: sessionView,
      page: sessionPage,
      pageSize: 10,
    }),
    enabled: identityId !== undefined,
  });
  const apiKeys = useQuery({
    queryKey: queryKeys.identityApiKeys(identityId ?? "missing"),
    queryFn: () => api.identities.listApiKeys(identityId!),
    enabled: identityId !== undefined && identity.data?.kind === "service",
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["identities"] });
  };
  const update = useMutation({
    mutationFn: () => api.identities.update(identityId!, {
      expectedRevision: identity.data!.revision,
      primaryIdentifier: (identifier ?? identity.data!.primaryIdentifier).trim(),
    }),
    onSuccess: async () => { setIdentifier(null); await refresh(); },
  });
  const statusMutation = useMutation({
    mutationFn: () => identity.data!.status === "active"
      ? api.identities.disable(identityId!, identity.data!.revision)
      : api.identities.reactivate(identityId!, identity.data!.revision),
    onSuccess: async () => { setConfirmStatus(false); await refresh(); },
  });
  const resetCredentials = useMutation({
    mutationFn: () => api.identities.resetCredentials(identityId!, {
      expectedRevision: identity.data!.revision,
      temporaryPassword,
      currentPassword,
      revokeApiKeys,
    }),
    onSuccess: async () => {
      setResetOpen(false); setTemporaryPassword(""); setCurrentPassword(""); setRevokeApiKeys(false);
      await refresh();
      setSessionPage(1);
      await queryClient.invalidateQueries({ queryKey: queryKeys.identitySessionsRoot(identityId!) });
    },
  });
  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => api.identities.revokeSession(sessionId),
    onSuccess: async () => {
      setRevokeSessionId(null);
      setSessionPage(1);
      await queryClient.invalidateQueries({ queryKey: queryKeys.identitySessionsRoot(identityId!) });
    },
  });
  const revokeAllSessions = useMutation({
    mutationFn: () => api.identities.revokeAllSessions(identityId!),
    onSuccess: async () => {
      setRevokeAllOpen(false);
      setSessionPage(1);
      await queryClient.invalidateQueries({ queryKey: queryKeys.identitySessionsRoot(identityId!) });
    },
  });
  const transferOwner = useMutation({
    mutationFn: () => api.identities.transferOwner({
      targetIdentityId: identityId!, reason: transferReason, currentPassword: transferPassword,
    }),
    onSuccess: () => {
      queryClient.clear();
      navigate("/admin/login", { replace: true });
    },
  });
  const createApiKey = useMutation({
    mutationFn: () => api.identities.createApiKey(identityId!, {
      name: apiKeyName,
      scopes: [...new Set(apiKeyScopes.split(",").map((scope) => scope.trim()).filter(Boolean))],
      ...(apiKeyExpiresAt === "" ? {} : { expiresAt: new Date(apiKeyExpiresAt).toISOString() }),
    }),
    onSuccess: async (key) => {
      setApiKeyOpen(false); setApiKeyName(""); setApiKeyScopes(""); setApiKeyExpiresAt("");
      setCreatedApiKeySecret(key.secret);
      await queryClient.invalidateQueries({ queryKey: queryKeys.identityApiKeys(identityId!) });
    },
  });
  const revokeApiKey = useMutation({
    mutationFn: (apiKeyId: string) => api.identities.revokeApiKey(apiKeyId),
    onSuccess: async () => {
      setRevokeApiKeyId(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.identityApiKeys(identityId!) });
    },
  });
  const createCredentialToken = useMutation({
    mutationFn: () => {
      const input = { expectedRevision: identity.data!.revision, currentPassword: credentialTokenPassword };
      return credentialTokenPurpose === "invitation"
        ? api.identities.createInvitation(identityId!, input)
        : api.identities.createResetToken(identityId!, input);
    },
    onSuccess: async (token) => {
      setCredentialTokenPurpose(null); setCredentialTokenPassword("");
      setCreatedCredentialToken({ secret: token.secret, expiresAt: token.expiresAt });
      await refresh();
    },
  });
  const createSystemMembership = useMutation({
    mutationFn: () => api.identities.createSystemMembership(identityId!, identity.data!.revision),
    onSuccess: refresh,
  });
  if (identity.isPending) return <Page><PageLoading label="사용자 상세를 불러오는 중" /></Page>;
  if (identity.isError || identity.data === undefined) return <Page><LoadError error={identity.error} onRetry={() => void identity.refetch()} /></Page>;
  const current = identity.data;
  const nextIdentifier = identifier ?? current.primaryIdentifier;
  return (
    <Page>
      <PageHeader
        eyebrow="Users & access"
        title={current.primaryIdentifier}
        description={displayModeAtLeast(mode, "advanced")
          ? current.identityId
          : current.kind === "human" ? "운영 계정" : "서비스 계정"}
        actions={<IdentityStatus identity={current} />}
      />
      <div className={styles.summaryGrid}>
        <div><span>종류</span><strong>{current.kind === "human" ? "사람" : "서비스"}</strong></div>
        <DisplayModeGate minimum="advanced"><div><span>Identity revision</span><strong>{current.revision}</strong></div></DisplayModeGate>
        <DisplayModeGate minimum="advanced"><div><span>Credential version</span><strong>{current.credentialVersion}</strong></div></DisplayModeGate>
        <div><span>소속</span><strong>{current.memberships.length}</strong></div>
      </div>
      <section className={styles.panel} aria-labelledby="identity-settings-title">
        <SectionHeader id="identity-settings-title" title="계정 설정" description="identifier 변경은 로그인 식별자와 운영자 공간 권한 대상 표시명을 함께 갱신합니다." />
        <div className={styles.fieldGrid}>
          <TextInput label="로그인 식별자" value={nextIdentifier} onChange={setIdentifier} isDisabled={current.status === "disabled"} />
        </div>
        <ErrorCallout error={update.error ?? statusMutation.error ?? transferOwner.error} />
        <div className={styles.formActions}>
          {!current.isOwner && current.kind === "human" && current.status === "active" ? <Button variant="secondary" onPress={() => setTransferOpen(true)}>CMS 소유자로 이전</Button> : null}
          <Button variant={current.status === "active" ? "danger" : "secondary"} onPress={() => setConfirmStatus(true)} isDisabled={current.isOwner}>{current.status === "active" ? "계정 비활성화" : "계정 재활성화"}</Button>
          <Button onPress={() => update.mutate()} isDisabled={update.isPending || nextIdentifier.trim() === current.primaryIdentifier || nextIdentifier.trim() === ""}>변경 저장</Button>
        </div>
      </section>
      {current.kind === "human" ? (
        <section className={styles.panel} aria-labelledby="credentials-title">
          <SectionHeader id="credentials-title" title="Credential & session" description="활성 session만 기본 표시합니다. 폐기·만료 이력은 별도 페이지에서 조회할 수 있습니다." />
          <div className={styles.formActions}>
            <Button variant="secondary" onPress={() => setCredentialTokenPurpose("invitation")} isDisabled={current.status === "disabled"}>초대 token 발급</Button>
            <Button variant="secondary" onPress={() => setCredentialTokenPurpose("password-reset")} isDisabled={current.isOwner || current.status === "disabled"}>Reset token 발급</Button>
            <Button variant="secondary" onPress={() => setResetOpen(true)} isDisabled={current.isOwner || current.status === "disabled"}>임시 비밀번호 재설정</Button>
            <Button variant="danger" onPress={() => setRevokeAllOpen(true)} isDisabled={sessionView !== "active" || (sessions.data?.total ?? 0) === 0}>모든 session 폐기</Button>
          </div>
          {createdCredentialToken !== null ? (
            <Callout tone="warning"><strong>지금 한 번만 표시됩니다.</strong><br /><code>{createdCredentialToken.secret}</code><br />만료: {formatInstant(createdCredentialToken.expiresAt)}<br /><Button size="small" variant="quiet" onPress={() => setCreatedCredentialToken(null)}>확인</Button></Callout>
          ) : null}
          <div className={styles.viewSwitcher} role="group" aria-label="Session 표시 범위">
            <Button size="small" variant={sessionView === "active" ? "secondary" : "quiet"} onPress={() => { setSessionView("active"); setSessionPage(1); }}>활성 session</Button>
            <Button size="small" variant={sessionView === "history" ? "secondary" : "quiet"} onPress={() => { setSessionView("history"); setSessionPage(1); }}>폐기·만료 이력</Button>
          </div>
          {sessions.isPending ? <PageLoading label="Session을 불러오는 중" /> : null}
          {sessions.isError ? <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} /> : null}
          {sessions.data?.items.length === 0 ? <EmptyState
            title={sessionView === "active" ? "활성 session이 없습니다" : "폐기·만료 이력이 없습니다"}
            description={sessionView === "active" ? "로그인하면 관리 가능한 활성 session이 표시됩니다." : "폐기되거나 만료된 session이 생기면 이곳에 표시됩니다."}
          /> : null}
          {sessions.data && sessions.data.items.length > 0 ? (
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>{displayModeAtLeast(mode, "advanced") ? "Audience / Realm" : "로그인 위치"}</th><th>인증</th><th>만료</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>{sessions.data.items.map((session) => <tr key={session.sessionId}>
                <td><strong>{session.audience === "admin" ? "Admin" : "Content"}{session.current ? " · 현재" : ""}</strong><span className={styles.secondaryLine}>{session.realmName}</span></td>
                <td>{formatInstant(session.authenticatedAt)}</td>
                <td>{formatInstant(session.expiresAt)}</td>
                <td>{session.revokedAt !== undefined
                  ? <Badge tone="neutral">폐기됨</Badge>
                  : Date.parse(session.expiresAt) <= Date.now()
                    ? <Badge tone="neutral">만료됨</Badge>
                    : <Badge tone="success">활성</Badge>}</td>
                <td>{session.revokedAt === undefined && Date.parse(session.expiresAt) > Date.now()
                  ? <Button size="small" variant="danger" onPress={() => setRevokeSessionId(session.sessionId)}>폐기</Button>
                  : <span className={styles.secondaryLine}>{session.revokeReason ?? (session.revokedAt === undefined ? "자동 만료" : formatInstant(session.revokedAt))}</span>}</td>
              </tr>)}</tbody>
            </table></div>
          ) : null}
          {sessions.data && sessions.data.total > sessions.data.pageSize ? (
            <div className={styles.pagination} role="group" aria-label="Session 이력 페이지">
              <Button size="small" variant="quiet" isDisabled={sessions.data.page <= 1} onPress={() => setSessionPage((page) => Math.max(1, page - 1))}>이전</Button>
              <span>{sessions.data.page} / {Math.ceil(sessions.data.total / sessions.data.pageSize)} · 총 {sessions.data.total}건</span>
              <Button size="small" variant="quiet" isDisabled={sessions.data.page * sessions.data.pageSize >= sessions.data.total} onPress={() => setSessionPage((page) => page + 1)}>다음</Button>
            </div>
          ) : null}
          <ErrorCallout error={resetCredentials.error ?? createCredentialToken.error ?? revokeSession.error ?? revokeAllSessions.error} />
        </section>
      ) : null}
      {current.kind === "service" ? (
        <section className={styles.panel} aria-labelledby="api-keys-title">
          <SectionHeader id="api-keys-title" title="API keys" description="실제 허용 권한은 서비스 계정 권한 대상의 역할 권한과 key scope의 교집합입니다." />
          <div className={styles.formActions}><Button onPress={() => setApiKeyOpen(true)} isDisabled={current.status === "disabled"}><Icon name="plus" size={16} />API key 생성</Button></div>
          {createdApiKeySecret !== null ? (
            <Callout tone="warning"><strong>지금 한 번만 표시됩니다.</strong><br /><code>{createdApiKeySecret}</code><br /><Button size="small" variant="quiet" onPress={() => setCreatedApiKeySecret(null)}>확인</Button></Callout>
          ) : null}
          {apiKeys.isPending ? <PageLoading label="API key를 불러오는 중" /> : null}
          {apiKeys.isError ? <LoadError error={apiKeys.error} onRetry={() => void apiKeys.refetch()} /> : null}
          {apiKeys.data?.items.length === 0 ? <EmptyState title="API key가 없습니다" description="Role binding을 먼저 구성한 뒤 최소 scope의 key를 생성하세요." /> : null}
          {apiKeys.data && apiKeys.data.items.length > 0 ? (
            <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>이름 / Prefix</th><th>Scopes</th><th>생성</th><th>최근 사용</th><th>작업</th></tr></thead>
              <tbody>{apiKeys.data.items.map((key) => <tr key={key.apiKeyId}>
                <td><strong>{key.name}</strong><span className={styles.secondaryLine}>{key.prefix}</span></td>
                <td>{key.scopes.length > 0 ? <code>{key.scopes.join(", ")}</code> : "권한 없음(기본 거부)"}</td>
                <td>{formatInstant(key.createdAt)}</td>
                <td>{key.lastUsedAt === undefined ? "—" : formatInstant(key.lastUsedAt)}</td>
                <td>{key.revokedAt === undefined ? <Button size="small" variant="danger" onPress={() => setRevokeApiKeyId(key.apiKeyId)}>폐기</Button> : <Badge tone="neutral">폐기됨</Badge>}</td>
              </tr>)}</tbody>
            </table></div>
          ) : null}
          <ErrorCallout error={createApiKey.error ?? revokeApiKey.error} />
        </section>
      ) : null}
      <section className={styles.panel} aria-labelledby="memberships-title">
        <SectionHeader id="memberships-title" title="사용자 공간 소속(Membership)" description="소속 상태와 연결된 권한 대상을 확인합니다." />
        {current.kind === "human" && current.status === "active" && !current.memberships.some(({ realmKind }) => realmKind === "system") ? (
          <div className={styles.formActions}><Button onPress={() => createSystemMembership.mutate()} isDisabled={createSystemMembership.isPending}>운영 계정으로 승격</Button></div>
        ) : null}
        <ErrorCallout error={createSystemMembership.error} />
        {current.memberships.length === 0 ? <EmptyState title="소속이 없습니다" description="사용자 공간 상세에서 명시적으로 provisioning할 수 있습니다." /> : (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>사용자 공간</th><th>상태</th>{displayModeAtLeast(mode, "advanced") ? <th>권한 대상</th> : null}<th>Profile</th></tr></thead>
            <tbody>{current.memberships.map((membership) => <tr key={membership.membershipId}>
              <td><strong>{membership.realmName}</strong>{displayModeAtLeast(mode, "advanced") ? <span className={styles.secondaryLine}>{membership.realmKey}</span> : null}</td>
              <td><Badge tone={membership.status === "active" ? "success" : membership.status === "pending" ? "warning" : "danger"}>{membership.status}</Badge></td>
              {displayModeAtLeast(mode, "advanced") ? <td><code>{membership.subjectId}</code></td> : null}
              <td>{membership.profileDocumentId ?? "—"}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
      {confirmStatus ? (
        <ConfirmDialog
          title={current.status === "active" ? "계정 비활성화" : "계정 재활성화"}
          confirmLabel={current.status === "active" ? "비활성화" : "재활성화"}
          danger={current.status === "active"}
          isPending={statusMutation.isPending}
          onCancel={() => setConfirmStatus(false)}
          onConfirm={() => statusMutation.mutate()}
        >
          <p><strong>{current.primaryIdentifier}</strong>의 {current.status === "active" ? "모든 활성 session과 API key를 폐기합니다." : "계정만 활성화하며 기존 session은 복원하지 않습니다."}</p>
        </ConfirmDialog>
      ) : null}
      {resetOpen ? (
        <ConfirmDialog
          title="임시 비밀번호 재설정"
          confirmLabel="Credential 재설정"
          danger
          isPending={resetCredentials.isPending}
          isConfirmDisabled={temporaryPassword.length < 12 || currentPassword === ""}
          onCancel={() => setResetOpen(false)}
          onConfirm={() => resetCredentials.mutate()}
        >
          <div className={styles.dialogStack}>
            <p><strong>{current.primaryIdentifier}</strong>의 기존 session이 모두 폐기되고 다음 로그인 후 password 변경이 필요합니다.</p>
            <TextInput label="새 임시 비밀번호" type="password" autoComplete="new-password" value={temporaryPassword} onChange={setTemporaryPassword} isRequired />
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} isRequired />
            <CheckboxField isSelected={revokeApiKeys} onChange={setRevokeApiKeys}>이 Identity의 API key도 모두 폐기</CheckboxField>
          </div>
        </ConfirmDialog>
      ) : null}
      {credentialTokenPurpose !== null ? (
        <ConfirmDialog
          title={credentialTokenPurpose === "invitation" ? "초대 token 발급" : "비밀번호 reset token 발급"}
          confirmLabel="Token 발급"
          danger={credentialTokenPurpose === "password-reset"}
          isPending={createCredentialToken.isPending}
          isConfirmDisabled={credentialTokenPassword === ""}
          onCancel={() => setCredentialTokenPurpose(null)}
          onConfirm={() => createCredentialToken.mutate()}
        >
          <div className={styles.dialogStack}>
            <p>원문 token은 생성 직후 한 번만 표시됩니다. {credentialTokenPurpose === "password-reset" ? "기존 session은 즉시 폐기됩니다." : "새 token을 만들면 이전 미사용 token은 폐기됩니다."}</p>
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={credentialTokenPassword} onChange={setCredentialTokenPassword} isRequired />
          </div>
        </ConfirmDialog>
      ) : null}
      {revokeSessionId !== null ? (
        <ConfirmDialog title="Session 폐기" confirmLabel="폐기" danger isPending={revokeSession.isPending} onCancel={() => setRevokeSessionId(null)} onConfirm={() => revokeSession.mutate(revokeSessionId)}>
          <p>선택한 session은 응답이 완료된 직후부터 더 이상 인증에 사용할 수 없습니다.</p>
        </ConfirmDialog>
      ) : null}
      {revokeAllOpen ? (
        <ConfirmDialog title="모든 session 폐기" confirmLabel="모두 폐기" danger isPending={revokeAllSessions.isPending} onCancel={() => setRevokeAllOpen(false)} onConfirm={() => revokeAllSessions.mutate()}>
          <p><strong>{current.primaryIdentifier}</strong>의 Admin·Content session을 모두 폐기합니다.</p>
        </ConfirmDialog>
      ) : null}
      {transferOpen ? (
        <ConfirmDialog
          title="CMS 소유자(Owner) 이전"
          confirmLabel="소유자 이전"
          danger
          isPending={transferOwner.isPending}
          isConfirmDisabled={transferReason.trim().length < 3 || transferPassword === ""}
          onCancel={() => setTransferOpen(false)}
          onConfirm={() => transferOwner.mutate()}
        >
          <div className={styles.dialogStack}>
            <p><strong>{current.primaryIdentifier}</strong>에게 CMS 최고관리자 권한을 이전합니다. 모든 Admin session이 폐기되어 다시 로그인해야 합니다.</p>
            <TextAreaField label="이전 사유" value={transferReason} onChange={setTransferReason} rows={3} isRequired />
            <TextInput label="현재 소유자 비밀번호" type="password" autoComplete="current-password" value={transferPassword} onChange={setTransferPassword} isRequired />
          </div>
        </ConfirmDialog>
      ) : null}
      {apiKeyOpen ? (
        <ConfirmDialog
          title="API key 생성"
          confirmLabel="Key 생성"
          isPending={createApiKey.isPending}
          isConfirmDisabled={apiKeyName.trim() === ""}
          onCancel={() => setApiKeyOpen(false)}
          onConfirm={() => createApiKey.mutate()}
        >
          <div className={styles.dialogStack}>
            <TextInput label="Key 이름" value={apiKeyName} onChange={setApiKeyName} placeholder="Production reader" isRequired />
            <TextInput label="Permission scopes" value={apiKeyScopes} onChange={setApiKeyScopes} description="쉼표로 구분합니다. 비우면 아무 권한도 없습니다(기본 거부)." placeholder="content.list, content.read" />
            <TextInput label="만료 시각" type="datetime-local" value={apiKeyExpiresAt} onChange={setApiKeyExpiresAt} />
          </div>
        </ConfirmDialog>
      ) : null}
      {revokeApiKeyId !== null ? (
        <ConfirmDialog title="API key 폐기" confirmLabel="Key 폐기" danger isPending={revokeApiKey.isPending} onCancel={() => setRevokeApiKeyId(null)} onConfirm={() => revokeApiKey.mutate(revokeApiKeyId)}>
          <p>폐기된 원문 key는 즉시 인증에 사용할 수 없고 다시 활성화할 수 없습니다.</p>
        </ConfirmDialog>
      ) : null}
    </Page>
  );
}
