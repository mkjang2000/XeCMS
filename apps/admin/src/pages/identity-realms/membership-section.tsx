import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi, type GlobalIdentity, type IdentityRealm, type RealmMembership } from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, EmptyState, SelectField, TextAreaField, TextInput } from "@xecms/ui";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { SectionHeader } from "../../components/page.js";
import { DisplayModeGate } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { MembershipStatusBadge, MutationError, type QueryResult, type OwnerQueryResult, IdValue } from "./shared.js";

export function MembershipSection({ realm, owner, memberships, identities, systemRealmId }: {
  readonly realm: IdentityRealm;
  readonly owner: OwnerQueryResult;
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
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newProfileSource, setNewProfileSource] = useState("{}");
  const [newReauthPassword, setNewReauthPassword] = useState("");
  const [newProfileError, setNewProfileError] = useState<string | null>(null);
  const [membershipAction, setMembershipAction] = useState<"register" | "provision" | null>(null);
  const [promoting, setPromoting] = useState<RealmMembership | null>(null);
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
    mutationFn: (profile: Readonly<Record<string, unknown>>) => api.identityRealms.provisionMembership(realm.realmId, {
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
    mutationFn: (profile: Readonly<Record<string, unknown>>) => api.identityRealms.registerMembership(realm.realmId, {
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
    mutationFn: (input: { readonly membership: RealmMembership; readonly status: "active" | "suspended" }) =>
      input.status === "active"
        ? api.identityRealms.reactivateMembership(realm.realmId, input.membership.membershipId, input.membership.revision)
        : api.identityRealms.suspendMembership(realm.realmId, input.membership.membershipId, input.membership.revision),
    onSuccess: refresh,
  });
  const promote = useMutation({
    mutationFn: (membership: RealmMembership) =>
      api.identityRealms.grantRealmAdministrator(realm.realmId, membership.membershipId, {
        reauthPassword: promoteReauthPassword,
      }),
    onSuccess: async () => {
      setPromoting(null);
      setPromoteReauthPassword("");
      await refresh();
    },
  });
  const membershipIdentityIds = new Set(memberships.data?.items.map(({ globalIdentityId }) => globalIdentityId));
  const candidates = identities.data?.items.filter((identity) =>
    identity.disabledAt === undefined &&
    identity.originRealmId === systemRealmId &&
    !membershipIdentityIds.has(identity.globalIdentityId)) ?? [];
  const identityById = new Map(identities.data?.items.map((identity) => [identity.globalIdentityId, identity]));
  const canProvision = realm.status === "active" && realm.authentication.acceptSystemIdentities;
  // A brand-new content user is not a System account, so acceptSystemIdentities
  // is irrelevant here — only that the Realm is active.
  const canRegister = realm.status === "active";

  const parseProfile = (source: string, setError: (message: string | null) => void): Readonly<Record<string, unknown>> | null => {
    setError(null);
    try {
      const value = JSON.parse(source) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        setError("Profile은 JSON object여야 합니다.");
        return null;
      }
      return value as Readonly<Record<string, unknown>>;
    } catch {
      setError("유효한 JSON object를 입력해 주세요.");
      return null;
    }
  };

  const submitProvision = () => {
    const profile = parseProfile(profileSource, setProfileError);
    if (profile !== null) provision.mutate(profile);
  };

  const submitRegister = () => {
    const profile = parseProfile(newProfileSource, setNewProfileError);
    if (profile !== null) register.mutate(profile);
  };

  return (
    <section className={styles.panel} aria-labelledby="membership-title">
      <SectionHeader
        id="membership-title"
        title="사용자 할당"
        description="이 사용자 공간에 연결된 사용자를 확인하고 필요한 연결 작업을 실행합니다."
        actions={<div className={styles.rowActions}>
          <Button
            onPress={() => { register.reset(); setNewProfileError(null); setMembershipAction("register"); }}
            isDisabled={!canRegister}
          >새 사용자</Button>
          <Button
            variant="secondary"
            onPress={() => { provision.reset(); setProfileError(null); setMembershipAction("provision"); }}
            isDisabled={!canProvision || identities.isPending || candidates.length === 0}
          >기존 운영자 연결</Button>
        </div>}
      />
      {realm.status !== "active" ? (
        <Callout tone="warning">이 사용자 공간이 활성 상태가 되어야 사용자를 연결할 수 있습니다.</Callout>
      ) : null}
      {identities.isError ? <LoadError error={identities.error} onRetry={() => void identities.refetch()} /> : null}
      {!realm.authentication.acceptSystemIdentities ? (
        <p className={styles.compactHint}>기존 운영자 연결은 사용자 공간 설정에서 운영자 계정 소속을 허용하면 사용할 수 있습니다.</p>
      ) : realm.status === "active" && !identities.isPending && candidates.length === 0 ? (
        <p className={styles.compactHint}>연결 가능한 운영자 계정이 없습니다.</p>
      ) : null}
      {memberships.isPending ? <PageLoading label="소속을 불러오는 중" /> : null}
      {memberships.isError ? <LoadError error={memberships.error} onRetry={() => void memberships.refetch()} /> : null}
      {memberships.data?.items.length === 0 ? <EmptyState title="연결된 사용자가 없습니다" description="상단 작업으로 사용자를 연결하거나 일반 사용자가 가입/JIT 로그인하면 여기에 표시됩니다." /> : null}
      {memberships.data && memberships.data.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.membershipTable}`}>
            <thead><tr><th>사용자</th><th>Realm Subject</th><th>Profile</th><th>상태</th><th>연결 방식</th><th>작업</th></tr></thead>
            <tbody>
              {memberships.data.items.map((membership) => {
                const identity = membership.identity ?? identityById.get(membership.globalIdentityId);
                const isOwner = owner.data?.status === "healthy"
                  && owner.data.owner?.membershipId === membership.membershipId;
                const isAdministrator = membership.realmAdministrator === true;
                return (
                  <tr key={membership.membershipId}>
                    <td>
                      <strong>{identity?.primaryIdentifier ?? "Identifier 미제공"}</strong>
                      {isOwner ? <Badge tone="primary">소유자</Badge> : null}
                      {isAdministrator ? <Badge tone="info">관리자</Badge> : null}
                      <DisplayModeGate minimum="advanced">
                        <IdValue label="Global Identity ID" value={membership.globalIdentityId} />
                        <IdValue label="Membership ID" value={membership.membershipId} />
                      </DisplayModeGate>
                    </td>
                    <td><code className={styles.compactCode}>{membership.subjectId}</code></td>
                    <td><code className={styles.compactCode}>{membership.profileDocumentId ?? "프로비저닝 중"}</code></td>
                    <td><MembershipStatusBadge status={membership.status} /></td>
                    <td>{provisionedByLabel(membership.provisionedBy)}<span className={styles.secondaryLine}>Revision {membership.revision}</span></td>
                    <td>
                      <div className={styles.rowActions}>
                        {membership.status === "active" && realm.kind === "content" && !isAdministrator && !isOwner ? (
                          <Button size="small" variant="secondary" isDisabled={realm.status !== "active" || promote.isPending} onPress={() => { setPromoting(membership); setPromoteReauthPassword(""); }}>관리자로 지정</Button>
                        ) : null}
                        {isOwner ? (
                          <span className={styles.compactHint}>소유자는 위 소유자 교체·복구로 관리</span>
                        ) : membership.status === "active" ? (
                          <Button size="small" variant="danger" isDisabled={realm.status !== "active" || changeStatus.isPending} onPress={() => changeStatus.mutate({ membership, status: "suspended" })}>정지</Button>
                        ) : membership.status === "suspended" ? (
                          <Button size="small" variant="secondary" isDisabled={realm.status !== "active" || changeStatus.isPending} onPress={() => changeStatus.mutate({ membership, status: "active" })}>재활성화</Button>
                        ) : <Badge tone="warning">완료 대기</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <MutationError error={changeStatus.error} />
      {membershipAction === "register" ? (
        <ConfirmDialog
          title="새 사용자 만들어 연결"
          confirmLabel="새 사용자 생성 후 연결"
          isPending={register.isPending}
          isConfirmDisabled={!canRegister || newIdentifier.trim() === "" || newPassword === "" || newReauthPassword === ""}
          onCancel={() => { setMembershipAction(null); register.reset(); }}
          onConfirm={submitRegister}
        >
          <div className={styles.dialogStack}>
            <p>새 로그인 계정을 만들고 곧바로 이 Realm에 연결합니다.</p>
            <div className={styles.dialogFieldGrid}>
              <TextInput label="로그인 identifier" value={newIdentifier} onChange={setNewIdentifier} description="예: 이메일 또는 사용자명" isRequired />
              <TextInput label="초기 비밀번호" type="password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} description="12자 이상" isRequired />
            </div>
            <TextInput label="현재 관리자 비밀번호" type="password" autoComplete="current-password" value={newReauthPassword} onChange={setNewReauthPassword} description="본인 확인을 위해 필요합니다." isRequired />
            <DisplayModeGate minimum="standard">
              <details className={styles.optionalDetails}>
                <summary>초기 Profile JSON</summary>
                <TextAreaField
                  label="초기 Profile JSON"
                  value={newProfileSource}
                  onChange={setNewProfileSource}
                  rows={4}
                  errorMessage={newProfileError ?? undefined}
                  description="비워 둘 수 있으며 Profile Collection Schema 검증을 통과해야 합니다."
                />
              </details>
            </DisplayModeGate>
            <MutationError error={register.error} />
          </div>
        </ConfirmDialog>
      ) : null}
      {membershipAction === "provision" ? (
        <ConfirmDialog
          title="기존 운영자 계정 연결"
          confirmLabel="운영자 계정 연결"
          isPending={provision.isPending}
          isConfirmDisabled={!canProvision || identityId === "" || password === ""}
          onCancel={() => { setMembershipAction(null); provision.reset(); }}
          onConfirm={submitProvision}
        >
          <div className={styles.dialogStack}>
            <p>기존 System 운영자 계정을 이 Realm의 Membership으로 연결합니다.</p>
            <SelectField
              label="연결할 운영자(System) 계정"
              value={identityId}
              options={candidates.map((identity) => ({
                value: identity.globalIdentityId,
                label: `${identity.primaryIdentifier} · ${identity.globalIdentityId}`,
              }))}
              onChange={setIdentityId}
            />
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
            <DisplayModeGate minimum="standard">
              <details className={styles.optionalDetails}>
                <summary>초기 Profile JSON</summary>
                <TextAreaField
                  label="초기 Profile JSON"
                  value={profileSource}
                  onChange={setProfileSource}
                  rows={4}
                  errorMessage={profileError ?? undefined}
                  description="비워 둘 수 있으며 Profile Collection Schema 검증을 통과해야 합니다."
                />
              </details>
            </DisplayModeGate>
            <MutationError error={provision.error} />
          </div>
        </ConfirmDialog>
      ) : null}
      {promoting ? (
        <ConfirmDialog
          title="공간 관리자로 지정"
          confirmLabel="관리자로 지정"
          isPending={promote.isPending}
          isConfirmDisabled={promoteReauthPassword === ""}
          onCancel={() => { setPromoting(null); setPromoteReauthPassword(""); }}
          onConfirm={() => promote.mutate(promoting)}
        >
          <div className={styles.dialogStack}>
            <p><strong>{(promoting.identity ?? identityById.get(promoting.globalIdentityId))?.primaryIdentifier ?? promoting.subjectId}</strong> 님에게 이 사용자 공간의 <strong>관리자(content-administrator)</strong> 권한을 부여합니다. 이후 이 계정으로 “사용자 공간 권한 관리” 화면에 들어가 권한을 직접 관리할 수 있습니다.</p>
            <MutationError error={promote.error} />
            <TextInput label="현재 관리자 비밀번호" type="password" autoComplete="current-password" value={promoteReauthPassword} onChange={setPromoteReauthPassword} description="본인 확인을 위해 현재 로그인한 관리자 비밀번호를 입력합니다." isRequired />
          </div>
        </ConfirmDialog>
      ) : null}
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
