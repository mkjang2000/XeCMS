import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  toAdminApiError,
  useAdminApi,
  type GlobalIdentity,
  type IdentityRealm,
  type PageResult,
  type RealmFullAccessBinding,
  type RealmMembership,
  type RealmMembershipStatus,
} from "@xecms/admin";
import {
  Badge,
  Button,
  Callout,
  CheckboxField,
  ConfirmDialog,
  EmptyState,
  SelectField,
  TextAreaField,
  TextInput,
} from "@xecms/ui";
import { Link, useNavigate, useParams } from "react-router";

import { LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { queryKeys } from "../queries.js";
import styles from "../identity-realms.module.css";

const provisioningOptions = [
  { value: "explicit", label: "명시적 승인" },
  { value: "jit", label: "첫 로그인 시 JIT" },
] as const;

const registrationOptions = [
  { value: "closed", label: "가입 닫힘" },
  { value: "open", label: "가입 허용" },
] as const;

const statusOptions = [
  { value: "active", label: "활성" },
  { value: "disabled", label: "비활성" },
] as const;

function commaValues(value: string): readonly string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function localInstant(value: string): string | undefined {
  return value === "" ? undefined : new Date(value).toISOString();
}

function formatInstant(value?: string): string {
  if (value === undefined) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function RealmStatusBadge({ realm }: { readonly realm: IdentityRealm }) {
  if (realm.kind === "system") return <Badge tone="info">System</Badge>;
  switch (realm.status) {
    case "active": return <Badge tone="success">활성</Badge>;
    case "provisioning": return <Badge tone="warning">프로비저닝 중</Badge>;
    case "disabled": return <Badge tone="danger">비활성</Badge>;
  }
}

function MembershipStatusBadge({ status }: { readonly status: RealmMembershipStatus }) {
  switch (status) {
    case "active": return <Badge tone="success">활성</Badge>;
    case "pending": return <Badge tone="warning">프로비저닝 중</Badge>;
    case "suspended": return <Badge tone="danger">정지</Badge>;
  }
}

function MutationError({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  const converted = toAdminApiError(error);
  return <Callout tone="error"><strong>{converted.message}</strong> <span className={styles.errorCode}>{converted.code}</span></Callout>;
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

  return (
    <Page>
      <PageHeader
        eyebrow="Identity federation"
        title="Identity Realms"
        description="Global Identity의 자격 증명은 공유하되 Membership, Subject와 권한은 Realm별로 분리합니다."
        actions={<Button onPress={() => setCreating((value) => !value)}><Icon name="plus" size={17} />새 Content Realm</Button>}
      />
      {creating ? (
        <CreateRealmForm
          isPending={create.isPending}
          error={create.error}
          onCancel={() => setCreating(false)}
          onSubmit={(input) => create.mutate(input)}
        />
      ) : null}
      {realms.isPending ? <PageLoading label="Identity Realm을 불러오는 중" /> : null}
      {realms.isError ? <LoadError error={realms.error} onRetry={() => void realms.refetch()} /> : null}
      {realms.data?.items.length === 0 ? (
        <EmptyState
          title="등록된 Realm이 없습니다"
          description="첫 Content Realm을 만들어 독립된 회원·고객 계정 영역을 구성하세요."
          action={<Button onPress={() => setCreating(true)}>새 Content Realm</Button>}
        />
      ) : null}
      {realms.data && realms.data.items.length > 0 ? (
        <div className={styles.realmGrid}>
          {realms.data.items.map((realm) => (
            <Link
              className={styles.realmCard}
              key={realm.realmId}
              to={`/admin/realms/${encodeURIComponent(realm.realmId)}`}
            >
              <div className={styles.realmCardHeader}>
                <span className={styles.realmIcon}><Icon name="identity" size={20} /></span>
                <RealmStatusBadge realm={realm} />
              </div>
              <div className={styles.realmCardBody}>
                <h2>{realm.name}</h2>
                <code>{realm.realmKey}</code>
              </div>
              <dl className={styles.compactFacts}>
                <div><dt>Realm ID</dt><dd>{realm.realmId}</dd></div>
                <div><dt>Revision</dt><dd>{realm.revision}</dd></div>
                {realm.kind === "content" ? <div><dt>Profile Collection</dt><dd>{realm.profileCollectionId ?? "연결 대기"}</dd></div> : null}
              </dl>
              <div className={styles.realmCardFooter}>
                <span>{realm.kind === "system" ? "CMS 운영 계정 영역" : realm.authentication.registration === "open" ? "공개 가입 허용" : "관리자 승인형"}</span>
                <Icon name="arrowRight" size={14} />
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

function CreateRealmForm({ onSubmit, onCancel, isPending, error }: {
  readonly onSubmit: (input: Parameters<ReturnType<typeof useAdminApi>["identityRealms"]["create"]>[0]) => void;
  readonly onCancel: () => void;
  readonly isPending: boolean;
  readonly error: unknown;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [acceptSystem, setAcceptSystem] = useState(true);
  const [provisioning, setProvisioning] = useState<"explicit" | "jit">("explicit");
  const [registration, setRegistration] = useState<"closed" | "open">("closed");
  const [defaultRoles, setDefaultRoles] = useState("");
  const valid = name.trim() !== "" && /^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/.test(key) &&
    (provisioning !== "jit" || acceptSystem);

  return (
    <section className={styles.formCard} aria-labelledby="create-realm-title">
      <SectionHeader
        id="create-realm-title"
        title="새 Content Realm"
        description="Profile Collection 연결은 Schema auth 설정이 적용될 때 완료됩니다."
      />
      <form className={styles.formStack} onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSubmit({
          key,
          name: name.trim(),
          acceptSystemIdentities: acceptSystem,
          provisioning,
          registration,
          defaultRoleIds: commaValues(defaultRoles),
        });
      }}>
        <div className={styles.fieldGrid}>
          <TextInput label="표시 이름" value={name} onChange={setName} placeholder="Community" isRequired />
          <TextInput
            label="Realm Key"
            value={key}
            onChange={(value) => setKey(value.toLocaleLowerCase("en-US"))}
            description="URL과 권한 namespace에 사용되는 변경 불가 slug입니다."
            placeholder="community"
            isRequired
          />
          <SelectField label="가입 정책" value={registration} options={registrationOptions} onChange={(value) => setRegistration(value as typeof registration)} />
          <SelectField
            label="System Identity 연결"
            value={provisioning}
            options={provisioningOptions}
            onChange={(value) => {
              const next = value as typeof provisioning;
              setProvisioning(next);
              if (next === "jit") setAcceptSystem(true);
            }}
          />
          <TextInput label="기본 Role IDs" value={defaultRoles} onChange={setDefaultRoles} description="쉼표로 구분합니다. 비워 두면 로그인만 허용됩니다." />
        </div>
        <CheckboxField isSelected={acceptSystem} onChange={setAcceptSystem} isDisabled={provisioning === "jit"}>
          기존 System Global Identity의 Membership 생성을 허용
        </CheckboxField>
        <MutationError error={error} />
        <div className={styles.formActions}>
          <Button type="button" variant="secondary" onPress={onCancel} isDisabled={isPending}>취소</Button>
          <Button type="submit" isDisabled={!valid || isPending}>{isPending ? "생성 중…" : "Realm 생성"}</Button>
        </div>
      </form>
    </section>
  );
}

export function IdentityRealmDetailPage() {
  const { realmId } = useParams();
  const api = useAdminApi();
  const navigate = useNavigate();
  const realm = useQuery({
    queryKey: queryKeys.identityRealm(realmId ?? "missing"),
    queryFn: () => api.identityRealms.get(realmId!),
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
    queryFn: () => api.identityRealms.listMemberships(realmId!),
    enabled: realmId !== undefined && isContent,
  });
  const fullAccess = useQuery({
    queryKey: queryKeys.realmFullAccess(realmId ?? "missing"),
    queryFn: () => api.identityRealms.listFullAccess(realmId!),
    enabled: realmId !== undefined && isContent,
  });

  if (realmId === undefined) return <Page><Callout tone="error">Realm ID가 없습니다.</Callout></Page>;
  if (realm.isPending) return <Page><PageLoading label="Realm 상세 정보를 불러오는 중" /></Page>;
  if (realm.isError) return <Page><LoadError error={realm.error} onRetry={() => void realm.refetch()} /></Page>;

  return (
    <Page>
      <PageHeader
        eyebrow={realm.data.kind === "system" ? "System identity realm" : "Content identity realm"}
        title={realm.data.name}
        description={realm.data.kind === "system"
          ? "CMS 운영 계정과 Admin 세션의 보호된 System Realm입니다."
          : "Global Identity 자격 증명과 이 Realm의 Membership·Subject·Profile 연결을 관리합니다."}
        actions={<>
          <RealmStatusBadge realm={realm.data} />
          {realm.data.kind === "content" && realm.data.status === "active" ? (
            <Button onPress={() => navigate(`/admin/realms/${encodeURIComponent(realm.data.realmId)}/access/roles`)}>Realm 권한 관리</Button>
          ) : null}
          <Button variant="secondary" onPress={() => navigate("/admin/realms")}>목록으로</Button>
        </>}
      />
      <RealmIdentitySummary realm={realm.data} />
      {realm.data.kind === "system" ? (
        <Callout tone="info"><strong>System Realm은 이 화면에서 수정하지 않습니다.</strong> Content Realm에 운영 계정을 연결해도 System 권한이 전파되지는 않습니다.</Callout>
      ) : (
        <>
          {realm.data.status === "provisioning" ? (
            <Callout tone="warning">
              <strong>아직 활성화되지 않았습니다. 한 단계가 더 필요합니다.</strong>
              <p>이 Realm은 <strong>Auth Collection을 연결하고 스키마를 적용(Apply)</strong>하는 순간 자동으로 활성화됩니다. 기다린다고 저절로 활성화되지는 않습니다.</p>
              <ol className={styles.provisioningSteps}>
                <li>스키마 빌더에서 로그인 계정을 담을 Collection을 만들거나 엽니다.</li>
                <li>그 Collection의 <strong>Auth</strong> 설정에서 Realm Key <code>{realm.data.realmKey}</code>를 지정합니다.</li>
                <li>스키마를 <strong>Apply</strong>하면 Profile Collection이 연결되고 이 Realm이 활성 상태로 전환됩니다.</li>
              </ol>
              <Button onPress={() => navigate("/admin/schema")}>스키마 빌더로 이동</Button>
            </Callout>
          ) : null}
          {realm.data.status === "disabled" ? (
            <Callout tone="warning"><strong>이 Realm은 비활성 상태입니다.</strong> 신규 세션, Membership provisioning과 Full Access grant가 차단됩니다.</Callout>
          ) : null}
          <RealmSettingsForm realm={realm.data} />
          <MembershipSection
            realm={realm.data}
            memberships={memberships}
            identities={identities}
            systemRealmId={realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system"}
          />
          <FullAccessSection realm={realm.data} memberships={memberships.data?.items ?? []} bindings={fullAccess} identities={identities.data?.items ?? []} />
        </>
      )}
    </Page>
  );
}

function RealmIdentitySummary({ realm }: { readonly realm: IdentityRealm }) {
  return (
    <section className={styles.summaryGrid} aria-label="Realm 식별 정보">
      <div><span>Realm ID</span><code>{realm.realmId}</code></div>
      <div><span>Realm Key</span><code>{realm.realmKey}</code></div>
      <div><span>Profile Collection ID</span><code>{realm.profileCollectionId ?? "연결 대기"}</code></div>
      <div><span>Realm Revision</span><strong>{realm.revision}</strong></div>
    </section>
  );
}

function RealmSettingsForm({ realm }: { readonly realm: IdentityRealm }) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(realm.name);
  const [status, setStatus] = useState<"active" | "disabled">(realm.status === "disabled" ? "disabled" : "active");
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

  return (
    <section className={styles.panel} aria-labelledby="realm-settings-title">
      <SectionHeader id="realm-settings-title" title="Realm 설정" description={`Realm Revision ${realm.revision}을 기준으로 충돌 없이 저장합니다.`} />
      {editable ? null : (
        <Callout tone="info">Auth Collection을 연결해 Realm이 활성화되기 전까지는 설정을 변경할 수 없습니다. 위 안내에 따라 스키마를 적용해 주세요.</Callout>
      )}
      <form className={styles.formStack} onSubmit={(event) => { event.preventDefault(); if (editable) save.mutate(); }}>
        <div className={styles.fieldGrid}>
          <TextInput label="표시 이름" value={name} onChange={setName} isDisabled={!editable} isRequired />
          <SelectField label="상태" value={status} options={statusOptions} onChange={(value) => setStatus(value as typeof status)} isDisabled={!editable} />
          <SelectField label="가입 정책" value={registration} options={registrationOptions} onChange={(value) => setRegistration(value as typeof registration)} isDisabled={!editable} />
          <SelectField
            label="System Identity provisioning"
            value={provisioning}
            options={provisioningOptions}
            onChange={(value) => {
              const next = value as typeof provisioning;
              setProvisioning(next);
              if (next === "jit") setAcceptSystem(true);
            }}
            isDisabled={!editable}
          />
          <TextInput label="기본 Role IDs" value={defaultRoles} onChange={setDefaultRoles} description="새 Membership Subject에 적용할 Role ID를 쉼표로 구분합니다." isDisabled={!editable} />
        </div>
        <CheckboxField isSelected={acceptSystem} onChange={setAcceptSystem} isDisabled={!editable || provisioning === "jit"}>
          System Global Identity가 이 Realm의 Membership을 가질 수 있음
        </CheckboxField>
        {converted?.status === 409 ? (
          <Callout tone="warning"><strong>다른 관리자가 먼저 Realm을 변경했습니다.</strong> 최신 Revision을 다시 불러온 뒤 입력해 주세요.</Callout>
        ) : <MutationError error={save.error} />}
        <div className={styles.formActions}>
          <Button type="submit" isDisabled={!editable || name.trim() === "" || save.isPending || (provisioning === "jit" && !acceptSystem)}>
            {save.isPending ? "저장 중…" : `Revision ${realm.revision} 기준 저장`}
          </Button>
        </div>
      </form>
    </section>
  );
}

type QueryResult<T> = ReturnType<typeof useQuery<PageResult<T>>>;

function MembershipSection({ realm, memberships, identities, systemRealmId }: {
  readonly realm: IdentityRealm;
  readonly memberships: QueryResult<RealmMembership>;
  readonly identities: QueryResult<GlobalIdentity>;
  readonly systemRealmId: string;
}) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [identityId, setIdentityId] = useState("");
  const [profileSource, setProfileSource] = useState("{}");
  const [password, setPassword] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.realmMemberships(realm.realmId) });
  const provision = useMutation({
    mutationFn: (profile: Readonly<Record<string, unknown>>) => api.identityRealms.provisionMembership(realm.realmId, {
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
  const changeStatus = useMutation({
    mutationFn: (input: { readonly membership: RealmMembership; readonly status: "active" | "suspended" }) =>
      input.status === "active"
        ? api.identityRealms.reactivateMembership(realm.realmId, input.membership.membershipId, input.membership.revision)
        : api.identityRealms.suspendMembership(realm.realmId, input.membership.membershipId, input.membership.revision),
    onSuccess: refresh,
  });
  const membershipIdentityIds = new Set(memberships.data?.items.map(({ globalIdentityId }) => globalIdentityId));
  const candidates = identities.data?.items.filter((identity) =>
    identity.disabledAt === undefined &&
    identity.originRealmId === systemRealmId &&
    !membershipIdentityIds.has(identity.globalIdentityId)) ?? [];
  const identityById = new Map(identities.data?.items.map((identity) => [identity.globalIdentityId, identity]));
  const canProvision = realm.status === "active" && realm.authentication.acceptSystemIdentities;

  const submitProvision = (event: FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    try {
      const value = JSON.parse(profileSource) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        setProfileError("Profile은 JSON object여야 합니다.");
        return;
      }
      provision.mutate(value as Readonly<Record<string, unknown>>);
    } catch {
      setProfileError("유효한 JSON object를 입력해 주세요.");
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="membership-title">
      <SectionHeader id="membership-title" title="Realm Memberships" description="Global Identity와 이 Realm 전용 Subject·Profile Document의 연결입니다." />
      {!realm.authentication.acceptSystemIdentities ? <Callout tone="warning">System Identity provisioning이 설정에서 비활성화되어 있습니다.</Callout> : null}
      {identities.isError ? <LoadError error={identities.error} onRetry={() => void identities.refetch()} /> : null}
      <form className={styles.provisionForm} onSubmit={submitProvision}>
        <div className={styles.fieldGrid}>
          <SelectField
            label="System Global Identity"
            value={identityId}
            options={candidates.map((identity) => ({
              value: identity.globalIdentityId,
              label: `${identity.primaryIdentifier} · ${identity.globalIdentityId}`,
            }))}
            description="Global Identity ID를 선택합니다. Membership ID나 Subject ID가 아닙니다."
            onChange={setIdentityId}
            isDisabled={!canProvision || identities.isPending || candidates.length === 0}
          />
          <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isDisabled={!canProvision} isRequired />
        </div>
        <TextAreaField
          label="초기 Profile JSON"
          value={profileSource}
          onChange={setProfileSource}
          rows={4}
          errorMessage={profileError ?? undefined}
          description="Profile Collection Schema 검증을 통과해야 합니다."
          isDisabled={!canProvision}
        />
        <MutationError error={provision.error} />
        <div className={styles.formActions}>
          <Button type="submit" isDisabled={!canProvision || identityId === "" || password === "" || provision.isPending}>
            {provision.isPending ? "프로비저닝 중…" : "Membership 명시적 생성"}
          </Button>
        </div>
      </form>
      {memberships.isPending ? <PageLoading label="Membership을 불러오는 중" /> : null}
      {memberships.isError ? <LoadError error={memberships.error} onRetry={() => void memberships.refetch()} /> : null}
      {memberships.data?.items.length === 0 ? <EmptyState title="Membership이 없습니다" description="System Identity를 명시적으로 연결하거나 가입/JIT 로그인을 사용하세요." /> : null}
      {memberships.data && memberships.data.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Global Identity</th><th>Realm Subject</th><th>Profile Document</th><th>상태</th><th>생성 방식</th><th>Revision</th><th /></tr></thead>
            <tbody>
              {memberships.data.items.map((membership) => {
                const identity = membership.identity ?? identityById.get(membership.globalIdentityId);
                return (
                  <tr key={membership.membershipId}>
                    <td><strong>{identity?.primaryIdentifier ?? "Identifier 미제공"}</strong><IdValue label="Global Identity ID" value={membership.globalIdentityId} /><IdValue label="Membership ID" value={membership.membershipId} /></td>
                    <td><IdValue label="Subject ID" value={membership.subjectId} /></td>
                    <td><IdValue label="Profile Document ID" value={membership.profileDocumentId ?? "프로비저닝 중"} /></td>
                    <td><MembershipStatusBadge status={membership.status} /></td>
                    <td>{provisionedByLabel(membership.provisionedBy)}</td>
                    <td>{membership.revision}</td>
                    <td>
                      {membership.status === "active" ? (
                        <Button size="small" variant="danger" isDisabled={realm.status !== "active" || changeStatus.isPending} onPress={() => changeStatus.mutate({ membership, status: "suspended" })}>정지</Button>
                      ) : membership.status === "suspended" ? (
                        <Button size="small" variant="secondary" isDisabled={realm.status !== "active" || changeStatus.isPending} onPress={() => changeStatus.mutate({ membership, status: "active" })}>재활성화</Button>
                      ) : <Badge tone="warning">완료 대기</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <MutationError error={changeStatus.error} />
    </section>
  );
}

function provisionedByLabel(value: RealmMembership["provisionedBy"]): string {
  switch (value) {
    case "explicit": return "관리자 명시적 생성";
    case "invitation": return "초대";
    case "jit": return "JIT 로그인";
    case "account-link": return "계정 연결";
    case "signup": return "가입";
  }
}

function IdValue({ label, value }: { readonly label: string; readonly value: string }) {
  return <span className={styles.idValue}><span>{label}</span><code>{value}</code></span>;
}

function FullAccessSection({ realm, memberships, bindings, identities }: {
  readonly realm: IdentityRealm;
  readonly memberships: readonly RealmMembership[];
  readonly bindings: QueryResult<RealmFullAccessBinding>;
  readonly identities: readonly GlobalIdentity[];
}) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [subjectId, setSubjectId] = useState("");
  const [reason, setReason] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [password, setPassword] = useState("");
  const [revoking, setRevoking] = useState<RealmFullAccessBinding | null>(null);
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
    mutationFn: () => api.identityRealms.revokeFullAccess(realm.realmId, revoking!.bindingId, revokePassword),
    onSuccess: async () => {
      setRevoking(null);
      setRevokePassword("");
      await refresh();
    },
  });
  const identityById = new Map(identities.map((identity) => [identity.globalIdentityId, identity]));
  const activeMemberships = memberships.filter(({ status }) => status === "active");

  return (
    <section className={styles.panel} aria-labelledby="full-access-title">
      <SectionHeader id="full-access-title" title="Realm Full Access" description="현재와 미래의 이 Realm 리소스에만 적용되는 별도 보호 바인딩입니다." />
      <Callout tone="warning"><strong>복구와 초기 설정에만 사용하세요.</strong> 일반 운영 권한은 Realm Role Binding으로 부여해야 하며, grant와 revoke 모두 현재 System 계정 비밀번호를 재검증합니다.</Callout>
      <form className={styles.formStack} onSubmit={(event) => { event.preventDefault(); grant.mutate(); }}>
        <div className={styles.fieldGrid}>
          <SelectField
            label="대상 Realm Subject"
            value={subjectId}
            options={activeMemberships.map((membership) => ({
              value: membership.subjectId,
              label: `${identityById.get(membership.globalIdentityId)?.primaryIdentifier ?? membership.globalIdentityId} · Subject ${membership.subjectId}`,
            }))}
            description="Global Identity ID가 아닌 이 Realm의 Subject ID에 부여합니다."
            onChange={setSubjectId}
            isDisabled={realm.status !== "active" || activeMemberships.length === 0}
          />
          <TextInput label="만료 시각" type="datetime-local" value={validUntil} onChange={setValidUntil} description="비워 두면 revoke할 때까지 유지됩니다." isDisabled={realm.status !== "active"} />
          <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isDisabled={realm.status !== "active"} isRequired />
        </div>
        <TextAreaField label="부여 사유" value={reason} onChange={setReason} rows={3} isDisabled={realm.status !== "active"} isRequired />
        <MutationError error={grant.error} />
        <div className={styles.formActions}>
          <Button type="submit" isDisabled={realm.status !== "active" || subjectId === "" || reason.trim() === "" || password === "" || grant.isPending}>{grant.isPending ? "부여 중…" : "Full Access 부여"}</Button>
        </div>
      </form>
      {bindings.isPending ? <PageLoading label="Full Access 바인딩을 불러오는 중" /> : null}
      {bindings.isError ? <LoadError error={bindings.error} onRetry={() => void bindings.refetch()} /> : null}
      {bindings.data?.items.length === 0 ? <EmptyState title="Full Access 바인딩이 없습니다" description="필요한 Role과 Scope만 부여하는 상태가 가장 안전합니다." /> : null}
      {bindings.data && bindings.data.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>대상 Subject</th><th>부여 사유</th><th>부여자</th><th>유효 기간</th><th>상태</th><th /></tr></thead>
            <tbody>{bindings.data.items.map((binding) => {
              const revoked = binding.revokedAt !== undefined;
              const expired = binding.validUntil !== undefined && Date.parse(binding.validUntil) <= Date.now();
              return (
                <tr key={binding.bindingId}>
                  <td><IdValue label="Subject ID" value={binding.subjectId} /><IdValue label="Full Access Binding ID" value={binding.bindingId} /></td>
                  <td>{binding.reason}</td>
                  <td><IdValue label="Global Identity ID" value={binding.grantedByGlobalIdentityId} /><IdValue label="Subject ID" value={binding.grantedBySubjectId} /></td>
                  <td>{formatInstant(binding.createdAt)}<span className={styles.secondaryLine}>만료 {formatInstant(binding.validUntil)}</span></td>
                  <td>{revoked ? <Badge tone="neutral">해지됨</Badge> : expired ? <Badge tone="warning">만료됨</Badge> : <Badge tone="danger">활성 Full Access</Badge>}</td>
                  <td>{!revoked ? <Button size="small" variant="danger" onPress={() => { setRevoking(binding); setRevokePassword(""); }}>해지</Button> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : null}
      <MutationError error={revoke.error} />
      {revoking ? (
        <ConfirmDialog
          title="Realm Full Access 해지"
          confirmLabel="Full Access 해지"
          danger
          isPending={revoke.isPending}
          isConfirmDisabled={revokePassword === ""}
          onCancel={() => { setRevoking(null); setRevokePassword(""); }}
          onConfirm={() => revoke.mutate()}
        >
          <div className={styles.dialogStack}>
            <p><code>{revoking.subjectId}</code> Subject의 Full Access를 해지합니다.</p>
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={revokePassword} onChange={setRevokePassword} isRequired />
          </div>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
