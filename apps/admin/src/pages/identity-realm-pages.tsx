import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SCHEMA_NAME_ERROR_MESSAGE,
  SCHEMA_NAME_PATTERN,
  toAdminApiError,
  useAdminApi,
  documentDisplayStateLabel,
  type CollectionDetail,
  type CollectionField,
  type CollectionSummary,
  type CollectionEntitlementAction,
  type DocumentDisplayState,
  type GlobalIdentity,
  type IdentityRealm,
  type PageResult,
  type RealmCollectionEntitlement,
  type RealmCollectionEntitlementList,
  type RealmManagementDelegation,
  type RealmManagementDelegationList,
  type ManagementAction,
  type DelegationScopeRule,
  type RealmFullAccessBinding,
  type RealmFullAccessPage,
  type RealmMembership,
  type RealmMembershipStatus,
  type RealmOwnerStatus,
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
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { LoadError, PageLoading, RealmAuthorizationError } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { Tabs, TabDangerDot, type TabDef } from "../components/tabs.js";
import { Checklist, type StepDef } from "../components/stepper.js";
import { isRealmSetupIncomplete, ownerCandidateMemberships, realmSetupSteps, type RealmSetupStepId } from "./realm-setup.js";
import { DisplayModeGate, displayModeAtLeast, useDisplayMode, type DisplayMode } from "../display-mode.js";
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

type RealmDetailTab = "overview" | "members" | "profile" | "access";

function realmDetailTab(value: string | null): RealmDetailTab {
  return value === "members" || value === "profile" || value === "access" ? value : "overview";
}

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

function defaultProfileCollectionName(realmKey: string): string {
  const camel = realmKey.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase());
  const prefixed = /^[a-z]/.test(camel) ? camel : `realm${camel}`;
  return `${prefixed}Accounts`.slice(0, 64);
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
        title="사용자 공간 관리"
        description="계정의 로그인 자격 증명은 공유하되 소속·권한 대상·권한은 사용자 공간별로 분리합니다."
        actions={<>
          <DisplayModeGate minimum="advanced">
            <Button variant="secondary" onPress={() => navigate("/admin/realms/entitlements")}>접근 매트릭스</Button>
          </DisplayModeGate>
          <Button onPress={() => setCreating((value) => !value)}><Icon name="plus" size={17} />새 사용자 공간</Button>
        </>}
      />
      {creating ? (
        <CreateRealmForm
          isPending={create.isPending}
          error={create.error}
          onCancel={() => setCreating(false)}
          onSubmit={(input) => create.mutate(input)}
        />
      ) : null}
      {realms.isPending ? <PageLoading label="사용자 공간을 불러오는 중" /> : null}
      {realms.isError ? <RealmAuthorizationError error={realms.error} context="list" onRetry={() => void realms.refetch()} /> : null}
      {realms.data?.items.length === 0 ? (
        <EmptyState
          title="등록된 사용자 공간이 없습니다"
          description="첫 사용자 공간을 만들어 독립된 회원·고객 계정 영역을 구성하세요."
          action={<Button onPress={() => setCreating(true)}>새 사용자 공간</Button>}
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
        title="새 사용자 공간(Realm)"
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
            label="공간 Key (Realm Key)"
            value={key}
            onChange={(value) => setKey(value.toLocaleLowerCase("en-US"))}
            description="URL과 권한 namespace에 사용되는 변경 불가 slug입니다."
            placeholder="community"
            isRequired
          />
          <SelectField label="가입 정책" value={registration} options={registrationOptions} onChange={(value) => setRegistration(value as typeof registration)} />
          <SelectField
            label="운영자 계정 연결"
            value={provisioning}
            options={provisioningOptions}
            onChange={(value) => {
              const next = value as typeof provisioning;
              setProvisioning(next);
              if (next === "jit") setAcceptSystem(true);
            }}
          />
          <TextInput label="기본 역할 ID (Role IDs)" value={defaultRoles} onChange={setDefaultRoles} description="쉼표로 구분합니다. 비워 두면 로그인만 허용됩니다." />
        </div>
        <CheckboxField isSelected={acceptSystem} onChange={setAcceptSystem} isDisabled={provisioning === "jit"}>
          기존 운영자 계정의 소속 생성을 허용
        </CheckboxField>
        <MutationError error={error} />
        <div className={styles.formActions}>
          <Button type="button" variant="secondary" onPress={onCancel} isDisabled={isPending}>취소</Button>
          <Button type="submit" isDisabled={!valid || isPending}>{isPending ? "생성 중…" : "사용자 공간 생성"}</Button>
        </div>
      </form>
    </section>
  );
}

export function IdentityRealmDetailPage() {
  const { realmId } = useParams();
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mode } = useDisplayMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profileSetupOpen, setProfileSetupOpen] = useState(false);
  const [detailTab, setDetailTabState] = useState<RealmDetailTab>(() => realmDetailTab(searchParams.get("tab")));
  const setDetailTab = (tab: RealmDetailTab) => {
    setDetailTabState(tab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === "overview") next.delete("tab");
      else next.set("tab", tab);
      return next;
    }, { replace: true });
  };
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
  const owner = useQuery({
    queryKey: queryKeys.realmOwner(realmId ?? "missing"),
    queryFn: () => api.identityRealms.getOwner(realmId!),
    enabled: realmId !== undefined && isContent,
    retry: false,
  });
  const fullAccess = useQuery({
    queryKey: queryKeys.realmFullAccess(realmId ?? "missing"),
    queryFn: () => api.identityRealms.listFullAccess(realmId!),
    enabled: realmId !== undefined && isContent,
    retry: false,
  });
  const createProfileSchema = useMutation({
    mutationFn: (input: {
      readonly collectionName: string;
      readonly collectionLabel: string;
      readonly identifierFieldName: string;
      readonly includeDisplayName: boolean;
    }) => api.identityRealms.createProfileSchema(realmId!, input),
    onSuccess: async (nextRealm) => {
      queryClient.setQueryData(queryKeys.identityRealm(nextRealm.realmId), nextRealm);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.identityRealms }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collections }),
      ]);
      setProfileSetupOpen(false);
    },
  });

  if (realmId === undefined) return <Page><Callout tone="error">공간 ID가 없습니다.</Callout></Page>;
  if (realm.isPending) return <Page><PageLoading label="사용자 공간 상세 정보를 불러오는 중" /></Page>;
  if (realm.isError) return <Page><RealmAuthorizationError error={realm.error} context="detail" onRetry={() => void realm.refetch()} /></Page>;

  return (
    <Page>
      <PageHeader
        eyebrow={realm.data.kind === "system" ? "운영자 공간(System Realm)" : "사용자 공간(Content Realm)"}
        title={realm.data.name}
        description={realm.data.kind === "system"
          ? "CMS 운영 계정과 Admin 세션의 보호된 운영자 공간입니다."
          : "계정의 로그인 자격 증명과 이 공간의 소속·권한 대상·프로필 연결을 관리합니다."}
        actions={<>
          <RealmStatusBadge realm={realm.data} />
          <Button variant="secondary" onPress={() => navigate("/admin/realms")}>목록으로</Button>
        </>}
      />
      <RealmIdentitySummary realm={realm.data} />
      {realm.data.kind === "system" ? (
        <Callout tone="info"><strong>운영자 공간은 이 화면에서 수정하지 않습니다.</strong> 사용자 공간에 운영 계정을 연결해도 운영 권한이 전파되지는 않습니다.</Callout>
      ) : (
        <>
          <RealmSetupChecklist
            realm={realm.data}
            owner={owner.data}
            memberships={memberships.data?.items}
            ownerCandidateCount={ownerCandidateMemberships({
              memberships: memberships.data?.items,
              identities: identities.data?.items,
              owner: owner.data,
              systemRealmId: realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system",
            }).length}
            onOpenProfileSetup={() => setProfileSetupOpen(true)}
            onGoMembers={() => setDetailTab("members")}
            onGoAccess={() => navigate(`/admin/realms/${encodeURIComponent(realm.data.realmId)}/access/${mode === "basic" ? "grades" : "roles"}`)}
          />
          {realm.data.status === "provisioning" && displayModeAtLeast(mode, "advanced") ? (
            <Callout tone="info">
              고급: 직접 Schema를 설계하려면 <Button size="small" variant="quiet" onPress={() => navigate("/admin/schema/new")}>스키마 편집기로 이동</Button>하세요.
            </Callout>
          ) : null}
          {realm.data.status === "disabled" ? (
            <Callout tone="warning"><strong>이 사용자 공간은 비활성 상태입니다.</strong> 신규 세션, 소속 provisioning과 Full Access grant가 차단됩니다.</Callout>
          ) : null}
          <RealmDetailTabs
            active={detailTab}
            hasProfile={realm.data.profileCollectionId !== undefined}
            fullAccessActive={(fullAccess.data?.activeBinding !== undefined && isActiveFullAccess(fullAccess.data.activeBinding))
              || fullAccess.data?.items.some(isActiveFullAccess) === true}
            onChange={setDetailTab}
          />
          {detailTab === "overview" ? <RealmSettingsForm realm={realm.data} /> : null}
          {detailTab === "members" ? (
            <>
              <RealmOwnerSection
                realm={realm.data}
                owner={owner}
                memberships={memberships}
                identities={identities}
                systemRealmId={realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system"}
              />
              <MembershipSection
                realm={realm.data}
                owner={owner}
                memberships={memberships}
                identities={identities}
                systemRealmId={realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system"}
              />
            </>
          ) : null}
          {detailTab === "profile" && realm.data.profileCollectionId !== undefined ? (
            <RealmProfileFieldsSection realm={realm.data} />
          ) : null}
          {detailTab === "access" ? (
            <>
              <RealmAccessOverview realm={realm.data} mode={mode} />
              <CollectionEntitlementSection realm={realm.data} mode={mode} />
              <DisplayModeGate minimum="advanced">
                <RealmManagementDelegationSection realm={realm.data} realms={realms.data?.items ?? []} />
              </DisplayModeGate>
              <FullAccessSection realm={realm.data} bindings={fullAccess} mode={mode} />
            </>
          ) : null}
          {profileSetupOpen ? (
            <ProfileSchemaSetupDialog
              realm={realm.data}
              error={createProfileSchema.error}
              isPending={createProfileSchema.isPending}
              onCancel={() => { setProfileSetupOpen(false); createProfileSchema.reset(); }}
              onConfirm={(input) => createProfileSchema.mutate(input)}
            />
          ) : null}
        </>
      )}
    </Page>
  );
}

const STEP_LABEL: Record<RealmSetupStepId, string> = {
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
function RealmSetupChecklist({
  realm, owner, memberships, ownerCandidateCount, onOpenProfileSetup, onGoMembers, onGoAccess,
}: {
  readonly realm: IdentityRealm;
  readonly owner: RealmOwnerStatus | undefined;
  readonly memberships: readonly RealmMembership[] | undefined;
  readonly ownerCandidateCount: number;
  readonly onOpenProfileSetup: () => void;
  readonly onGoMembers: () => void;
  readonly onGoAccess: () => void;
}) {
  const steps = realmSetupSteps({ realm, owner, memberships, ownerCandidateCount });
  if (!isRealmSetupIncomplete(steps)) return null;
  const byId = new Map(steps.map((step) => [step.id, step.status]));

  const stepDefs: StepDef[] = steps.map((step): StepDef => {
    const base = { id: step.id, label: STEP_LABEL[step.id], status: step.status };
    if (step.id === "activate" && step.status !== "done") {
      return {
        ...base,
        description: "로그인 identifier와 기본 Profile 필드를 정하면 Collection 생성·연결·활성화를 한 번에 처리합니다.",
        action: <Button size="small" onPress={onOpenProfileSetup}>기본 인증 스키마 생성</Button>,
      };
    }
    if (step.id === "owner" && step.status === "blocked") {
      return {
        ...base,
        description: "소유자로 지정할 활성 사용자가 아직 없습니다. ‘사용자’ 탭에서 새 사용자를 만들거나 기존 운영자를 연결하세요.",
        action: <Button size="small" variant="secondary" onPress={onGoMembers}>사용자 탭으로 이동</Button>,
      };
    }
    if (step.id === "owner" && step.status === "current") {
      return {
        ...base,
        description: "이 공간의 사람 최고관리자를 지정해 운영 연속성을 확보하세요.",
        action: <Button size="small" onPress={onGoMembers}>소유자 지정하러 가기</Button>,
      };
    }
    if (step.id === "administrator" && step.status === "current") {
      return {
        ...base,
        description: "공간을 활성화해도 만든 본인은 권한 화면에 들어갈 수 없습니다. ‘사용자’ 탭에서 본인(또는 담당자)을 관리자로 지정하세요.",
        action: <Button size="small" onPress={onGoMembers}>관리자 지정하러 가기</Button>,
      };
    }
    if (step.id === "access" && step.status === "current") {
      return {
        ...base,
        description: "이제 권한 등급·역할·배정을 구성할 수 있습니다.",
        action: <Button size="small" variant="secondary" onPress={onGoAccess}>권한 구성으로 이동</Button>,
      };
    }
    return base;
  });

  const tone = byId.get("owner") === "blocked" ? "warning" : "info";
  return (
    <Callout tone={tone}>
      <Checklist title="설정 진행 상태" steps={stepDefs} />
    </Callout>
  );
}

function RealmDetailTabs({ active, hasProfile, fullAccessActive, onChange }: {
  readonly active: RealmDetailTab;
  readonly hasProfile: boolean;
  readonly fullAccessActive: boolean;
  readonly onChange: (tab: RealmDetailTab) => void;
}) {
  const tabs: readonly TabDef<RealmDetailTab>[] = [
    { id: "overview", label: "개요" },
    { id: "members", label: "사용자" },
    { id: "profile", label: "프로필 필드", disabled: !hasProfile },
    { id: "access", label: "권한", badge: fullAccessActive ? <TabDangerDot label="Full Access 사용 중" /> : undefined },
  ];
  return <Tabs ariaLabel="사용자 공간 상세 영역" tabs={tabs} active={active} onChange={onChange} />;
}

function RealmAccessOverview({ realm, mode }: { readonly realm: IdentityRealm; readonly mode: DisplayMode }) {
  const navigate = useNavigate();
  const target = mode === "basic" ? "grades" : "roles";
  return (
    <section className={styles.panel} aria-labelledby="realm-access-overview-title">
      <SectionHeader
        id="realm-access-overview-title"
        title="사용자 공간 권한"
        description="이 사용자 공간 안에서 사용할 권한 등급, 역할과 사용자 배정을 관리합니다."
        actions={<Button
          onPress={() => navigate(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/${target}`)}
          isDisabled={realm.status !== "active"}
        >사용자 공간 권한 관리</Button>}
      />
      <p className={styles.compactHint}>일반 권한은 역할과 Scope로 관리합니다. Full Access는 CMS Owner가 기간을 정해 정책을 직접 복구할 때만 사용합니다.</p>
    </section>
  );
}

function ProfileSchemaSetupDialog({ realm, error, isPending, onCancel, onConfirm }: {
  readonly realm: IdentityRealm;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (input: {
    readonly collectionName: string;
    readonly collectionLabel: string;
    readonly identifierFieldName: string;
    readonly includeDisplayName: boolean;
  }) => void;
}) {
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
  return (
    <ConfirmDialog
      title="기본 인증 스키마 생성"
      confirmLabel="생성하고 사용자 공간 활성화"
      isPending={isPending}
      isConfirmDisabled={collectionName.trim() === ""
        || collectionLabel.trim() === ""
        || identifierFieldName.trim() === ""
        || collectionNameError !== undefined
        || identifierFieldNameError !== undefined}
      onCancel={onCancel}
      onConfirm={() => onConfirm({
        collectionName: collectionName.trim(),
        collectionLabel: collectionLabel.trim(),
        identifierFieldName: identifierFieldName.trim(),
        includeDisplayName,
      })}
    >
      <div className={styles.dialogStack}>
        <p><strong>{realm.name}</strong> 사용자 공간의 Profile Collection을 생성하고 즉시 Schema에 적용합니다.</p>
        <TextInput label="Collection 이름" value={collectionName} onChange={setCollectionName} description="API와 저장소에서 사용하는 영문 이름입니다." maxLength={64} errorMessage={collectionNameError} isRequired />
        <TextInput label="표시 이름" value={collectionLabel} onChange={setCollectionLabel} isRequired />
        <TextInput
          label="로그인 ID 필드명"
          value={identifierFieldName}
          onChange={setIdentifierFieldName}
          description="예: loginId, email, username. 필수·고유 text 필드로 생성됩니다."
          maxLength={64}
          errorMessage={identifierFieldNameError}
          isRequired
        />
        <CheckboxField isSelected={includeDisplayName} onChange={setIncludeDisplayName}>사용자 표시 이름(displayName) 필드 추가</CheckboxField>
        <Callout tone="info">이 작업은 현재 Schema에 다른 미적용 변경이 없을 때만 실행되며, 생성과 적용이 끝나면 사용자 공간이 활성화됩니다.</Callout>
        {errorMessage ? <Callout tone="error">{errorMessage}</Callout> : null}
      </div>
    </ConfirmDialog>
  );
}

function RealmProfileFieldsSection({ realm }: { readonly realm: IdentityRealm }) {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const collectionId = realm.profileCollectionId!;
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
    mutationFn: (input: { readonly name: string; readonly label: string; readonly type: "text" | "textarea" }) =>
      api.identityRealms.createProfileField(realm.realmId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.collectionApplied(collectionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collectionDraft(collectionId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collections }),
      ]);
      setAdding(false);
    },
  });

  return (
    <section className={styles.panel} aria-labelledby="realm-profile-fields-title">
      <SectionHeader
        id="realm-profile-fields-title"
        title="사용자 프로필 필드"
        description="이 사용자 공간 회원의 Profile 문서에 저장되는 기본 정보를 관리합니다."
        actions={<div className={styles.rowActions}>
          <Button
            variant="secondary"
            onPress={() => navigate(`/admin/schema/${encodeURIComponent(collectionId)}`)}
          >스키마에서 자세히 편집</Button>
          <Button
            isDisabled={!editable}
            onPress={() => { createField.reset(); setAdding(true); }}
          >프로필 필드 추가</Button>
        </div>}
      />
      {profile.isPending ? <PageLoading label="사용자 프로필 필드를 불러오는 중" /> : null}
      {profile.isError ? <LoadError error={profile.error} onRetry={() => void profile.refetch()} /> : null}
      {profile.data ? <ProfileFieldList collection={profile.data} /> : null}
      {realm.status === "disabled" ? (
        <Callout tone="warning">프로필 필드를 추가하려면 먼저 사용자 공간 설정에서 상태를 활성으로 변경해 주세요.</Callout>
      ) : diagnostics.data && !editable ? (
        <Callout tone="warning">Schema mode가 <strong>{diagnostics.data.schemaMode}</strong>이므로 이 화면에서 필드를 추가할 수 없습니다.</Callout>
      ) : null}
      <p className={styles.compactHint}>
        여기서는 데이터 손실 위험이 없는 선택형 text 필드만 바로 추가합니다. 삭제, 타입 변경, 필수값 전환, 관계·중첩 필드는 Schema Builder에서 검토합니다.
      </p>
      {adding && profile.data ? (
        <AddProfileFieldDialog
          collection={profile.data}
          error={createField.error}
          isPending={createField.isPending}
          onCancel={() => { setAdding(false); createField.reset(); }}
          onConfirm={(input) => createField.mutate(input)}
        />
      ) : null}
    </section>
  );
}

function ProfileFieldList({ collection }: { readonly collection: CollectionDetail }) {
  const identifierIds = new Set(collection.auth?.identifierFieldIds ?? []);
  return (
    <ul className={styles.profileFieldList} aria-label="사용자 프로필 필드 목록">
      {collection.fields.map((field) => {
        const identifier = identifierIds.has(field.id);
        return (
          <li key={field.id} className={styles.profileFieldItem}>
            <div className={styles.profileFieldIdentity}>
              <strong>{field.label || field.name}</strong>
              <code>{field.name}</code>
            </div>
            <div className={styles.profileFieldBadges}>
              {identifier ? <Badge tone="info">로그인 ID · 보호됨</Badge> : <Badge tone="neutral">프로필</Badge>}
              <Badge tone="neutral">{profileFieldTypeLabel(field)}</Badge>
              <Badge tone={field.required ? "warning" : "neutral"}>{field.required ? "필수" : "선택"}</Badge>
              {field.unique ? <Badge tone="neutral">고유</Badge> : null}
            </div>
            <DisplayModeGate minimum="advanced"><code className={styles.profileFieldStableId}>{field.id}</code></DisplayModeGate>
          </li>
        );
      })}
    </ul>
  );
}

function profileFieldTypeLabel(field: CollectionField): string {
  switch (field.type) {
    case "text": return "한 줄 text";
    case "textarea": return "여러 줄 text";
    default: return field.type;
  }
}

function AddProfileFieldDialog({ collection, error, isPending, onCancel, onConfirm }: {
  readonly collection: CollectionDetail;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (input: { readonly name: string; readonly label: string; readonly type: "text" | "textarea" }) => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"text" | "textarea">("text");
  const trimmedName = name.trim();
  const duplicate = collection.fields.some(
    (field) => field.name.toLocaleLowerCase("en-US") === trimmedName.toLocaleLowerCase("en-US"),
  );
  const nameError = trimmedName !== "" && !SCHEMA_NAME_PATTERN.test(trimmedName)
    ? SCHEMA_NAME_ERROR_MESSAGE
    : duplicate ? "같은 필드명이 이미 있습니다." : undefined;
  const converted = error === null || error === undefined ? null : toAdminApiError(error);
  const errorMessage = converted?.code === "SCHEMA_QUICK_SETUP_DRAFT_CONFLICT"
    ? "적용되지 않은 다른 스키마 변경 사항이 있습니다. 먼저 Schema Builder에서 적용하거나 버려 주세요."
    : converted?.code === "PROFILE_FIELD_NAME_CONFLICT"
      ? "같은 필드명이 이미 있습니다. 최신 스키마를 확인해 주세요."
      : converted?.message;
  return (
    <ConfirmDialog
      title="프로필 필드 추가"
      confirmLabel="필드 추가하고 적용"
      isPending={isPending}
      isConfirmDisabled={trimmedName === "" || label.trim() === "" || nameError !== undefined}
      onCancel={onCancel}
      onConfirm={() => onConfirm({ name: trimmedName, label: label.trim(), type })}
    >
      <div className={styles.dialogStack}>
        <TextInput
          label="필드명"
          value={name}
          onChange={setName}
          description="예: nickname, phone, introduction"
          maxLength={64}
          errorMessage={nameError}
          isRequired
        />
        <TextInput label="표시 이름" value={label} onChange={setLabel} isRequired />
        <SelectField
          label="입력 형태"
          value={type}
          onChange={(value) => setType(value as "text" | "textarea")}
          options={[
            { value: "text", label: "한 줄 text" },
            { value: "textarea", label: "여러 줄 text" },
          ]}
        />
        <Callout tone="info">새 필드는 기존 회원 데이터에 영향을 주지 않도록 선택 입력으로 생성됩니다.</Callout>
        {errorMessage ? <Callout tone="error">{errorMessage}</Callout> : null}
      </div>
    </ConfirmDialog>
  );
}

function RealmIdentitySummary({ realm }: { readonly realm: IdentityRealm }) {
  return (
    <section className={styles.summaryGrid} aria-label="사용자 공간 식별 정보">
      <div><span>Realm ID</span><code>{realm.realmId}</code></div>
      <div><span>Realm Key</span><code>{realm.realmKey}</code></div>
      <div><span>Profile Collection ID</span><code>{realm.profileCollectionId ?? "연결 대기"}</code></div>
      <div><span>공간 버전 (Revision)</span><strong>{realm.revision}</strong></div>
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
      <SectionHeader id="realm-settings-title" title="사용자 공간 설정" description={`공간 버전 ${realm.revision}을 기준으로 충돌 없이 저장합니다.`} />
      {editable ? null : (
        <Callout tone="info">Auth Collection을 연결해 사용자 공간이 활성화되기 전까지는 설정을 변경할 수 없습니다. 위 안내에 따라 스키마를 적용해 주세요.</Callout>
      )}
      <form className={styles.formStack} onSubmit={(event) => { event.preventDefault(); if (editable) save.mutate(); }}>
        <div className={styles.settingsFieldGrid}>
          <TextInput label="표시 이름" value={name} onChange={setName} isDisabled={!editable} isRequired />
          <SelectField label="상태" value={status} options={statusOptions} onChange={(value) => setStatus(value as typeof status)} isDisabled={!editable} />
          <SelectField label="가입 정책" value={registration} options={registrationOptions} onChange={(value) => setRegistration(value as typeof registration)} isDisabled={!editable} />
          <SelectField
            label="운영자 계정 provisioning"
            value={provisioning}
            options={provisioningOptions}
            onChange={(value) => {
              const next = value as typeof provisioning;
              setProvisioning(next);
              if (next === "jit") setAcceptSystem(true);
            }}
            isDisabled={!editable}
          />
          <TextInput label="기본 역할 ID (Role IDs)" value={defaultRoles} onChange={setDefaultRoles} description="새 소속의 권한 대상에 적용할 Role ID를 쉼표로 구분합니다." isDisabled={!editable} />
        </div>
        <CheckboxField isSelected={acceptSystem} onChange={setAcceptSystem} isDisabled={!editable || provisioning === "jit"}>
          운영자 계정이 이 사용자 공간의 소속을 가질 수 있음
        </CheckboxField>
        {converted?.status === 409 ? (
          <Callout tone="warning"><strong>다른 관리자가 먼저 사용자 공간을 변경했습니다.</strong> 최신 버전을 다시 불러온 뒤 입력해 주세요.</Callout>
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
type OwnerQueryResult = ReturnType<typeof useQuery<RealmOwnerStatus>>;
type FullAccessQueryResult = ReturnType<typeof useQuery<RealmFullAccessPage>>;

function RealmOwnerSection({ realm, owner, memberships, identities, systemRealmId }: {
  readonly realm: IdentityRealm;
  readonly owner: OwnerQueryResult;
  readonly memberships: QueryResult<RealmMembership>;
  readonly identities: QueryResult<GlobalIdentity>;
  readonly systemRealmId: string;
}) {
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
        expectedPolicyRevision: owner.data!.policyRevision,
        reason: reason.trim(),
        password,
      };
      if (operation === "assign") return api.identityRealms.assignOwner(realm.realmId, base);
      if (operation === "recover") return api.identityRealms.recoverOwner(realm.realmId, base);
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

  return (
    <section className={styles.panel} aria-labelledby="realm-owner-title" data-owner-status={owner.data?.status}>
      <SectionHeader
        id="realm-owner-title"
        title="사용자 공간 소유자(Realm Owner)"
        description="이 사용자 공간의 실제 사람 최고관리자와 운영 연속성을 관리합니다."
        actions={owner.data ? (
          <Button
            variant={owner.data.status === "healthy" ? "secondary" : "danger"}
            onPress={openDialog}
            isDisabled={realm.status !== "active" || candidates.length === 0}
          >{operationLabel}</Button>
        ) : undefined}
      />
      {owner.isPending ? <PageLoading label="사용자 공간 소유자 상태를 불러오는 중" /> : null}
      {owner.isError ? <LoadError error={owner.error} onRetry={() => void owner.refetch()} /> : null}
      {owner.data?.status === "healthy" && owner.data.owner ? (
        <div className={styles.ownerSummary}>
          <div>
            <strong>{owner.data.owner.primaryIdentifier}</strong>
            <span>대표 소유자</span>
          </div>
          <div className={styles.rowActions}>
            <Badge tone={owner.data.owner.identityActive ? "success" : "danger"}>{owner.data.owner.identityActive ? "계정 활성" : "계정 비활성"}</Badge>
            <MembershipStatusBadge status={owner.data.owner.membershipStatus} />
          </div>
          <DisplayModeGate minimum="advanced">
            <IdValue label="Global Identity ID" value={owner.data.owner.globalIdentityId} />
            <IdValue label="소유자 권한 대상 ID (Subject)" value={owner.data.owner.subjectId} />
          </DisplayModeGate>
        </div>
      ) : null}
      {owner.data?.status === "ownerless" ? (
        <Callout tone="error"><strong>운영 소유자가 없습니다.</strong> 활성 사용자를 만들거나 운영자를 연결한 뒤 소유자를 지정해야 이 사용자 공간의 정상적인 권한 관리 주체가 생깁니다.</Callout>
      ) : null}
      {owner.data?.status === "invalid" ? (
        <Callout tone="error"><strong>사용자 공간 소유자 상태가 손상되었습니다.</strong> {owner.data.issueCode ? <code>{owner.data.issueCode}</code> : null} 적격 운영자를 선택해 복구하세요.</Callout>
      ) : null}
      {owner.data && candidates.length === 0 ? (
        <p className={styles.compactHint}>소유자로 지정할 다른 활성 사용자가 없습니다. 아래에서 새 사용자를 만들거나 기존 운영자를 연결하세요.</p>
      ) : null}
      {dialogOpen && owner.data ? (
        <ConfirmDialog
          title={operationLabel}
          confirmLabel={operationLabel}
          danger={operation !== "assign"}
          isPending={changeOwner.isPending}
          isConfirmDisabled={targetMembershipId === "" || reason.trim() === "" || password === ""}
          onCancel={() => { setDialogOpen(false); changeOwner.reset(); }}
          onConfirm={() => changeOwner.mutate()}
        >
          <div className={styles.dialogStack}>
            <p>CMS Owner 자신은 대상이 될 수 없습니다. 서버가 대상 계정, 소속과 사람 권한 대상을 다시 검증합니다.</p>
            <SelectField
              label="새 사용자 공간 소유자"
              value={targetMembershipId}
              options={candidates.map((membership) => ({
                value: membership.membershipId,
                label: `${(membership.identity ?? identityById.get(membership.globalIdentityId))?.primaryIdentifier ?? membership.globalIdentityId} · ${membership.membershipId}`,
              }))}
              onChange={setTargetMembershipId}
            />
            <TextAreaField label="변경 사유" value={reason} onChange={setReason} rows={3} isRequired />
            {operation === "transfer" ? (
              <div className={styles.dialogStack}>
                <CheckboxField isSelected={revokePreviousSessions} onChange={setRevokePreviousSessions}>기존 소유자의 활성 세션 폐기</CheckboxField>
                <CheckboxField isSelected={suspendPreviousMembership} onChange={setSuspendPreviousMembership}>기존 소유자의 소속도 함께 정지</CheckboxField>
              </div>
            ) : null}
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
            <MutationError error={changeOwner.error} />
          </div>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function MembershipSection({ realm, owner, memberships, identities, systemRealmId }: {
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

function IdValue({ label, value }: { readonly label: string; readonly value: string }) {
  return <span className={styles.idValue}><span>{label}</span><code>{value}</code></span>;
}

function localDateTimeAfter(minutes: number): string {
  const value = new Date(Date.now() + minutes * 60_000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isActiveFullAccess(binding: RealmFullAccessBinding): boolean {
  return binding.revokedAt === undefined && Date.parse(binding.validUntil) > Date.now();
}

function remainingFullAccessTime(validUntil: string): string {
  const remainingMinutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
  if (remainingMinutes < 60) return `${remainingMinutes}분 후 만료`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes === 0 ? `${hours}시간 후 만료` : `${hours}시간 ${minutes}분 후 만료`;
}

/**
 * UI grouping of the 11 canonical content actions. The model keeps them
 * separate (no information loss); the operator toggles them in meaningful
 * bundles. Each group maps to a set of `CollectionAction`s that are granted or
 * removed together.
 */
const ENTITLEMENT_ACTION_GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly actions: readonly CollectionEntitlementAction[];
  readonly advanced?: boolean;
}[] = [
  { id: "read", label: "조회", hint: "목록·상세 보기", actions: ["list", "read"] },
  { id: "create", label: "작성", hint: "새 문서 생성", actions: ["create"] },
  { id: "update", label: "수정", hint: "기존 문서 편집", actions: ["update"] },
  { id: "delete", label: "삭제", hint: "문서 삭제", actions: ["delete"] },
  { id: "publish", label: "발행", hint: "발행·발행 취소", actions: ["publish", "unpublish"] },
  {
    id: "lifecycle",
    label: "생명주기",
    hint: "영구 삭제·복원·리비전",
    actions: ["purge", "restore", "revision.read", "revision.restore"],
    advanced: true,
  },
];

function entitlementActionSummary(actions: readonly CollectionEntitlementAction[]): string {
  const set = new Set(actions);
  const labels = ENTITLEMENT_ACTION_GROUPS
    .filter((group) => group.actions.some((action) => set.has(action)))
    .map((group) => group.label);
  return labels.length === 0 ? "없음" : labels.join(" · ");
}

/**
 * Searchable "add" picker. Configured rows live in the section table; every
 * remaining candidate is reachable only from here, so the table stays as short
 * as what is actually configured no matter how many candidates exist.
 */
function AddTargetDialog<T>({ title, description, searchLabel, items, keyOf, labelOf, hintOf, disabledReasonOf, emptyText, onPick, onClose }: {
  readonly title: string;
  readonly description: string;
  readonly searchLabel: string;
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  readonly labelOf: (item: T) => string;
  readonly hintOf?: (item: T) => string | undefined;
  readonly disabledReasonOf?: (item: T) => string | undefined;
  readonly emptyText: string;
  readonly onPick: (item: T) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = needle === ""
    ? items
    : items.filter((item) => {
        const hint = hintOf?.(item);
        return labelOf(item).toLowerCase().includes(needle)
          || keyOf(item).toLowerCase().includes(needle)
          || (hint !== undefined && hint.toLowerCase().includes(needle));
      });
  // Long candidate lists stay usable: the list scrolls, and search narrows it.
  const shown = matches.slice(0, 50);

  return (
    <ConfirmDialog
      title={title}
      confirmLabel="닫기"
      onCancel={onClose}
      onConfirm={onClose}
    >
      <div className={styles.pickerDialog}>
        <p className={styles.compactHint}>{description}</p>
        <TextInput
          label={searchLabel}
          placeholder="이름으로 검색"
          value={query}
          onChange={setQuery}
        />
        {items.length === 0 ? (
          <p className={styles.pickerEmpty}>{emptyText}</p>
        ) : shown.length === 0 ? (
          <p className={styles.pickerEmpty}>검색 결과가 없습니다.</p>
        ) : (
          <ul className={styles.pickerList}>
            {shown.map((item) => {
              const disabledReason = disabledReasonOf?.(item);
              const hint = hintOf?.(item);
              return (
                <li key={keyOf(item)}>
                  <button
                    type="button"
                    className={styles.pickerRow}
                    disabled={disabledReason !== undefined}
                    onClick={() => onPick(item)}
                  >
                    <span className={styles.pickerRowMain}>
                      <strong>{labelOf(item)}</strong>
                      {hint !== undefined ? <span className={styles.secondaryLine}>{hint}</span> : null}
                    </span>
                    {disabledReason !== undefined ? (
                      <Badge tone="neutral">{disabledReason}</Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > shown.length ? (
          <p className={styles.compactHint}>{matches.length}개 중 {shown.length}개 표시 — 검색으로 좁혀 주세요.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

/**
 * CMS-level collection access ceiling for one Realm. The ceiling only removes
 * access — final access = Realm policy AND this ceiling — and a collection with
 * no row here is unreachable once enforcement is on (fail-closed). Editable by
 * the CMS Owner only.
 */
function CollectionEntitlementSection({ realm, mode }: {
  readonly realm: IdentityRealm;
  readonly mode: DisplayMode;
}) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{
    readonly collection: CollectionSummary;
    readonly current: RealmCollectionEntitlement | undefined;
  } | null>(null);
  const [removing, setRemoving] = useState<RealmCollectionEntitlement | null>(null);
  const [adding, setAdding] = useState(false);

  const entitlements = useQuery({
    queryKey: queryKeys.realmEntitlements(realm.realmId),
    queryFn: () => api.identityRealms.listCollectionEntitlements(realm.realmId),
  });
  const collections = useQuery({
    queryKey: queryKeys.collections,
    queryFn: () => api.collections.list(),
  });
  const realms = useQuery({
    queryKey: queryKeys.identityRealms,
    queryFn: () => api.identityRealms.list(),
  });

  const byCollectionId = new Map(
    (entitlements.data?.entitlements ?? []).map((e) => [e.collectionId, e] as const),
  );
  // Auth (profile) collections owned by OTHER realms — these can never be exposed
  // here (they hold another realm's account data). The server enforces this too.
  const foreignAuthCollectionIds = new Set(
    (realms.data?.items ?? [])
      .filter((r) => r.realmId !== realm.realmId && r.profileCollectionId !== undefined)
      .map((r) => r.profileCollectionId as string),
  );

  const allCollections = collections.data?.items ?? [];
  const collectionById = new Map(allCollections.map((c) => [c.id, c] as const));
  const ownAuthCollection = realm.profileCollectionId === undefined
    ? undefined
    : collectionById.get(realm.profileCollectionId);
  // Rows = what is actually configured (plus the always-allowed Auth collection).
  // Everything else lives behind the add picker, so the table never grows with
  // the number of collections in the workspace.
  const configured = allCollections.filter(
    (c) => c.id !== realm.profileCollectionId
      && byCollectionId.has(c.id)
      && !foreignAuthCollectionIds.has(c.id),
  );
  // Rows on another realm's Auth collection predate the server-side block (or were
  // written directly). They grant nothing legitimate, so they are surfaced as
  // stray entries to clear out — never as an editable ceiling.
  const strayForeignAuth = allCollections.filter(
    (c) => byCollectionId.has(c.id) && foreignAuthCollectionIds.has(c.id),
  );
  const addable = allCollections.filter(
    (c) => c.id !== realm.profileCollectionId
      && !byCollectionId.has(c.id)
      && !foreignAuthCollectionIds.has(c.id),
  );
  const unconfiguredCount = allCollections.length - configured.length
    - strayForeignAuth.length - (ownAuthCollection === undefined ? 0 : 1);

  return (
    <section className={styles.panel} aria-labelledby="realm-entitlement-title">
      <SectionHeader
        id="realm-entitlement-title"
        title="접근 가능한 콘텐츠"
        description="이 사용자 공간이 다룰 수 있는 콘텐츠와 그 범위를 CMS에서 정합니다. 공간 안에서 아무리 넓게 권한을 줘도 여기서 정한 범위를 넘지 못합니다."
        actions={
          <Button
            size="small"
            variant="secondary"
            isDisabled={realm.status !== "active" || addable.length === 0}
            onPress={() => setAdding(true)}
          >콘텐츠 추가</Button>
        }
      />
      <Callout tone="info">
        허용하지 않은 콘텐츠는 공간 안에서 권한을 줬더라도 접근할 수 없습니다.
      </Callout>
      {entitlements.isPending || collections.isPending ? (
        <PageLoading label="Collection 접근 상한을 불러오는 중" />
      ) : null}
      {entitlements.isError ? (
        <LoadError error={entitlements.error} onRetry={() => void entitlements.refetch()} />
      ) : null}
      {collections.isError ? (
        <LoadError error={collections.error} onRetry={() => void collections.refetch()} />
      ) : null}
      {collections.data && allCollections.length === 0 ? (
        <EmptyState title="콘텐츠 유형이 없습니다" description="스키마에서 콘텐츠 유형(Collection)을 먼저 만들면 여기에서 접근 범위를 정할 수 있습니다." />
      ) : null}
      {collections.data && allCollections.length > 0 && configured.length === 0
        && strayForeignAuth.length === 0 && ownAuthCollection === undefined ? (
        <EmptyState
          title="허용한 콘텐츠가 없습니다"
          description="이 공간은 아직 어떤 콘텐츠에도 접근할 수 없습니다. 「콘텐츠 추가」로 접근을 허용할 콘텐츠를 고르세요."
        />
      ) : null}
      {strayForeignAuth.length > 0 ? (
        <Callout tone="warning">
          다른 사용자 공간의 인증 스키마에 남아 있는 접근 설정 {strayForeignAuth.length}개가 있습니다.
          지금은 적용되지 않지만, 남겨둘 이유가 없으니 제거해 주세요.
        </Callout>
      ) : null}
      {collections.data && allCollections.length > 0
        && (configured.length > 0 || strayForeignAuth.length > 0 || ownAuthCollection !== undefined) ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.entitlementTable}`}>
            <thead>
              <tr>
                <th>콘텐츠 유형</th>
                <th>허용 작업</th>
                <th>조건</th>
                <th>필드</th>
                <th className={styles.entitlementActionsHead}>작업</th>
              </tr>
            </thead>
            <tbody>
              {/* The realm's own Auth (profile) collection is always accessible —
                  it can never be gated, so the ceiling controls don't apply. */}
              {ownAuthCollection !== undefined ? (
                <tr key={ownAuthCollection.id} data-has-entitlement>
                  <td>
                    <div className={styles.entitlementName}>
                      <span className={styles.entitlementNameRow}>
                        <strong>{ownAuthCollection.label ?? ownAuthCollection.name}</strong>
                        <Badge tone="info">인증 스키마</Badge>
                      </span>
                      <DisplayModeGate minimum="advanced">
                        <IdValue label="Collection ID" value={ownAuthCollection.id} />
                      </DisplayModeGate>
                    </div>
                  </td>
                  <td><Badge tone="success">항상 허용</Badge></td>
                  <td className={styles.entitlementMuted}>—</td>
                  <td className={styles.entitlementMuted}>—</td>
                  <td><span className={styles.compactHint}>공간 로그인·프로필에 필요해 제한할 수 없습니다.</span></td>
                </tr>
              ) : null}
              {configured.map((collection) => {
                const current = byCollectionId.get(collection.id) as RealmCollectionEntitlement;
                return (
                  <tr key={collection.id} data-has-entitlement>
                    <td>
                      <div className={styles.entitlementName}>
                        <span className={styles.entitlementNameRow}>
                          <strong>{collection.label ?? collection.name}</strong>
                        </span>
                        <DisplayModeGate minimum="advanced">
                          <IdValue label="Collection ID" value={collection.id} />
                        </DisplayModeGate>
                      </div>
                    </td>
                    <td><span className={styles.entitlementActions}>{entitlementActionSummary(current.actions)}</span></td>
                    <td>{entitlementConstraintSummary(current)}</td>
                    <td>{entitlementFieldSummary(current)}</td>
                    <td>
                      <div className={styles.entitlementRowActions}>
                        <Button
                          size="small"
                          variant="secondary"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setEditing({ collection, current })}
                        >편집</Button>
                        <Button
                          size="small"
                          variant="danger"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setRemoving(current)}
                        >제거</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Stray rows on another realm's Auth collection: not a ceiling, so
                  they are shown as ineffective and offer removal only. */}
              {strayForeignAuth.map((collection) => {
                const current = byCollectionId.get(collection.id) as RealmCollectionEntitlement;
                return (
                  <tr key={collection.id} data-stray-entitlement>
                    <td>
                      <div className={styles.entitlementName}>
                        <span className={styles.entitlementNameRow}>
                          <strong>{collection.label ?? collection.name}</strong>
                          <Badge tone="danger">다른 공간 인증 스키마</Badge>
                        </span>
                        <DisplayModeGate minimum="advanced">
                          <IdValue label="Collection ID" value={collection.id} />
                        </DisplayModeGate>
                      </div>
                    </td>
                    <td colSpan={3}>
                      <span className={styles.compactHint}>
                        다른 공간의 계정·프로필 데이터라 접근이 열리지 않습니다. 남아 있는 설정이니 제거해 주세요.
                      </span>
                    </td>
                    <td>
                      <div className={styles.entitlementRowActions}>
                        <Button
                          size="small"
                          variant="danger"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setRemoving(current)}
                        >제거</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {collections.data && unconfiguredCount > 0 ? (
        <p className={styles.compactHint}>
          나머지 콘텐츠 {unconfiguredCount}개는 이 공간에서 접근할 수 없습니다.
        </p>
      ) : null}
      {adding ? (
        <AddTargetDialog
          title="접근을 허용할 콘텐츠"
          description="고른 콘텐츠의 허용 범위를 이어서 정합니다. 목록에 없는 콘텐츠는 이미 설정되었거나 접근할 수 없는 콘텐츠입니다."
          searchLabel="콘텐츠 유형 검색"
          items={addable}
          keyOf={(c) => c.id}
          labelOf={(c) => c.label ?? c.name}
          hintOf={(c) => c.name}
          emptyText="추가할 수 있는 콘텐츠가 없습니다."
          onClose={() => setAdding(false)}
          onPick={(collection) => {
            setAdding(false);
            setEditing({ collection, current: undefined });
          }}
        />
      ) : null}
      {editing ? (
        <EntitlementEditDialog
          realm={realm}
          collection={editing.collection}
          current={editing.current}
          mode={mode}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            queryClient.setQueryData<RealmCollectionEntitlementList>(
              queryKeys.realmEntitlements(realm.realmId),
              (previous) => mergeEntitlement(previous, saved),
            );
            setEditing(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.collectionEntitlements(saved.collectionId),
            });
          }}
        />
      ) : null}
      {removing ? (
        <EntitlementRemoveDialog
          realm={realm}
          entitlement={removing}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            const collectionId = removing.collectionId;
            queryClient.setQueryData<RealmCollectionEntitlementList>(
              queryKeys.realmEntitlements(realm.realmId),
              (previous) => previous === undefined ? previous : {
                ...previous,
                entitlements: previous.entitlements.filter((e) => e.collectionId !== collectionId),
              },
            );
            setRemoving(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.collectionEntitlements(collectionId),
            });
          }}
        />
      ) : null}
    </section>
  );
}

function entitlementConstraintSummary(entitlement: RealmCollectionEntitlement): string {
  const parts: string[] = [];
  if (entitlement.constraint?.ownerOnly === true) parts.push("본인 소유만");
  if (entitlement.constraint?.statuses && entitlement.constraint.statuses.length > 0) {
    parts.push(`상태: ${entitlement.constraint.statuses.join(", ")}`);
  }
  return parts.length === 0 ? "제한 없음" : parts.join(" · ");
}

function entitlementFieldSummary(entitlement: RealmCollectionEntitlement): string {
  const read = entitlement.readableFields;
  const write = entitlement.writableFields;
  if (read === undefined && write === undefined) return "전체";
  const readText = read === undefined ? "전체" : `${read.length}개`;
  const writeText = write === undefined ? "전체" : `${write.length}개`;
  return `읽기 ${readText} · 쓰기 ${writeText}`;
}

/** Optimistically merge a saved entitlement into the cached realm list. */
function mergeEntitlement(
  previous: RealmCollectionEntitlementList | undefined,
  saved: RealmCollectionEntitlement,
): RealmCollectionEntitlementList {
  if (previous === undefined) return { status: null, entitlements: [saved] };
  const others = previous.entitlements.filter((e) => e.collectionId !== saved.collectionId);
  return { ...previous, entitlements: [...others, saved] };
}

/** Display states an operator can gate on. `deleted` is excluded — deleted documents aren't an access target. */
const SELECTABLE_DISPLAY_STATES: readonly DocumentDisplayState[] = [
  "draft",
  "published",
  "published-with-draft",
  "archived",
];

function toggleInSet<T>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(value); else next.delete(value);
  return next;
}

function EntitlementEditDialog({ realm, collection, current, mode, onClose, onSaved }: {
  readonly realm: IdentityRealm;
  readonly collection: CollectionSummary;
  readonly current: RealmCollectionEntitlement | undefined;
  readonly mode: DisplayMode;
  readonly onClose: () => void;
  readonly onSaved: (saved: RealmCollectionEntitlement) => void | Promise<void>;
}) {
  const api = useAdminApi();
  const advanced = displayModeAtLeast(mode, "advanced");
  const [selectedActions, setSelectedActions] = useState<ReadonlySet<CollectionEntitlementAction>>(
    () => new Set(current?.actions ?? []),
  );
  const [ownerOnly, setOwnerOnly] = useState(current?.constraint?.ownerOnly === true);
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(
    () => new Set(current?.constraint?.statuses ?? []),
  );
  const [limitReadable, setLimitReadable] = useState(current?.readableFields !== undefined);
  const [readable, setReadable] = useState<ReadonlySet<string>>(
    () => new Set(current?.readableFields ?? []),
  );
  const [limitWritable, setLimitWritable] = useState(current?.writableFields !== undefined);
  const [writable, setWritable] = useState<ReadonlySet<string>>(
    () => new Set(current?.writableFields ?? []),
  );
  const [password, setPassword] = useState("");

  // The applied schema gives the real field list so the operator picks rather than types.
  const detail = useQuery({
    queryKey: [...queryKeys.collections, collection.id, "applied"] as const,
    queryFn: () => api.collections.getApplied(collection.id),
    enabled: advanced,
  });
  const fields = detail.data?.fields ?? [];

  const toggleGroup = (groupActions: readonly CollectionEntitlementAction[], on: boolean) => {
    setSelectedActions((previous) => {
      const next = new Set(previous);
      for (const action of groupActions) {
        if (on) next.add(action); else next.delete(action);
      }
      return next;
    });
  };
  // Writing a field the ceiling won't let you read is forbidden; keep writable ⊆ readable in the UI too.
  const setReadableField = (name: string, on: boolean) => {
    setReadable((previous) => toggleInSet(previous, name, on));
    if (!on) setWritable((previous) => toggleInSet(previous, name, false));
  };

  const save = useMutation({
    mutationFn: () => {
      const actions = ENTITLEMENT_ACTION_GROUPS
        .flatMap((group) => group.actions)
        .filter((action) => selectedActions.has(action));
      const readableFields = limitReadable ? [...readable] : undefined;
      const writableFields = limitWritable ? [...writable] : undefined;
      const statusList = [...statuses];
      const constraint = ownerOnly || statusList.length > 0
        ? {
            ...(ownerOnly ? { ownerOnly: true } : {}),
            ...(statusList.length > 0 ? { statuses: statusList } : {}),
          }
        : undefined;
      return api.identityRealms.putCollectionEntitlement(realm.realmId, collection.id, {
        actions,
        ...(readableFields === undefined ? {} : { readableFields }),
        ...(writableFields === undefined ? {} : { writableFields }),
        ...(constraint === undefined ? {} : { constraint }),
        expectedRevision: current?.revision ?? null,
        password,
      });
    },
    onSuccess: (saved) => { void onSaved(saved); },
  });

  const hasAction = (groupActions: readonly CollectionEntitlementAction[]): boolean =>
    groupActions.some((action) => selectedActions.has(action));

  return (
    <ConfirmDialog
      title={`${collection.label ?? collection.name} — 접근 허용 범위`}
      confirmLabel={current === undefined ? "허용" : "저장"}
      isPending={save.isPending}
      isConfirmDisabled={password === ""}
      onCancel={() => { onClose(); save.reset(); }}
      onConfirm={() => save.mutate()}
    >
      <div className={styles.entitlementDialog}>
        <p className={styles.compactHint}>여기서 고른 범위가 이 공간의 <strong>최대치</strong>입니다. 공간 안에서 더 넓게 주더라도 넘지 못합니다.</p>

        <div className={styles.entitlementGroup}>
          <h4>허용 작업</h4>
          <div className={styles.entitlementCheckGrid}>
            {ENTITLEMENT_ACTION_GROUPS
              .filter((group) => group.advanced !== true || advanced)
              .map((group) => (
                <CheckboxField
                  key={group.id}
                  isSelected={hasAction(group.actions)}
                  onChange={(on) => toggleGroup(group.actions, on)}
                >{group.label} <span className={styles.secondaryLine}>{group.hint}</span></CheckboxField>
              ))}
          </div>
        </div>

        <DisplayModeGate minimum="advanced">
          <div className={styles.entitlementGroup}>
            <h4>조건</h4>
            <CheckboxField isSelected={ownerOnly} onChange={setOwnerOnly}>본인이 작성한 문서만</CheckboxField>
            <p className={styles.compactHint}>특정 상태의 문서로만 제한 (아무것도 안 고르면 모든 상태 허용)</p>
            <div className={styles.entitlementCheckGrid}>
              {SELECTABLE_DISPLAY_STATES.map((state) => (
                <CheckboxField
                  key={state}
                  isSelected={statuses.has(state)}
                  onChange={(on) => setStatuses((previous) => toggleInSet(previous, state, on))}
                >{documentDisplayStateLabel(state)}</CheckboxField>
              ))}
            </div>
          </div>

          <div className={styles.entitlementGroup}>
            <h4>필드 범위</h4>
            {detail.isPending ? <PageLoading label="필드 목록을 불러오는 중" /> : null}
            {detail.isError ? <LoadError error={detail.error} onRetry={() => void detail.refetch()} /> : null}
            <CheckboxField isSelected={limitReadable} onChange={setLimitReadable}>읽을 수 있는 필드를 제한</CheckboxField>
            {limitReadable && fields.length > 0 ? (
              <div className={styles.entitlementCheckGrid}>
                {fields.map((field) => (
                  <CheckboxField
                    key={field.id}
                    isSelected={readable.has(field.name)}
                    onChange={(on) => setReadableField(field.name, on)}
                  >{field.label ?? field.name}</CheckboxField>
                ))}
              </div>
            ) : null}
            <CheckboxField isSelected={limitWritable} onChange={setLimitWritable}>쓸 수 있는 필드를 제한</CheckboxField>
            {limitWritable && fields.length > 0 ? (
              <div className={styles.entitlementCheckGrid}>
                {fields.map((field) => {
                  const readAllowed = !limitReadable || readable.has(field.name);
                  return (
                    <CheckboxField
                      key={field.id}
                      isSelected={writable.has(field.name)}
                      isDisabled={!readAllowed}
                      onChange={(on) => setWritable((previous) => toggleInSet(previous, field.name, on))}
                    >{field.label ?? field.name}{readAllowed ? "" : " (읽기 미허용)"}</CheckboxField>
                  );
                })}
              </div>
            ) : null}
            <p className={styles.compactHint}>쓰기는 읽기를 허용한 필드에서만 켤 수 있습니다.</p>
          </div>
        </DisplayModeGate>

        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={save.error} />
      </div>
    </ConfirmDialog>
  );
}

function EntitlementRemoveDialog({ realm, entitlement, onClose, onRemoved }: {
  readonly realm: IdentityRealm;
  readonly entitlement: RealmCollectionEntitlement;
  readonly onClose: () => void;
  readonly onRemoved: () => void | Promise<void>;
}) {
  const api = useAdminApi();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.identityRealms.deleteCollectionEntitlement(realm.realmId, entitlement.collectionId, {
      expectedRevision: entitlement.revision,
      password,
    }),
    onSuccess: () => { void onRemoved(); },
  });
  return (
    <ConfirmDialog
      title="접근 허용 제거"
      confirmLabel="제거"
      danger
      isPending={remove.isPending}
      isConfirmDisabled={password === ""}
      onCancel={() => { onClose(); remove.reset(); }}
      onConfirm={() => remove.mutate()}
    >
      <div className={styles.dialogStack}>
        <Callout tone="warning"><strong>허용을 제거하면 이 공간은 이 콘텐츠에 더 이상 접근할 수 없습니다.</strong> 다시 열려면 허용을 새로 설정해야 합니다.</Callout>
        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={remove.error} />
      </div>
    </ConfirmDialog>
  );
}

/** UI grouping of management actions the CMS may delegate. */
const MANAGEMENT_ACTION_ITEMS: readonly {
  readonly action: ManagementAction;
  readonly label: string;
}[] = [
  { action: "identity.credentials.reset", label: "비밀번호 재설정" },
  { action: "identity.disable", label: "계정 비활성/재활성" },
  { action: "identity.session.revoke", label: "세션 폐기" },
  { action: "identity.update", label: "계정 정보 수정" },
  { action: "membership.suspend", label: "소속 정지" },
  { action: "membership.reactivate", label: "소속 재활성" },
  { action: "membership.provision", label: "소속 부여" },
];

function delegationActionSummary(delegation: RealmManagementDelegation): string {
  const labels = MANAGEMENT_ACTION_ITEMS
    .filter((item) => delegation.actions.includes(item.action))
    .map((item) => item.label);
  return labels.length === 0 ? "없음" : labels.join(" · ");
}

/**
 * Cross-realm user administration: which OTHER realms this realm's operators may
 * administer, and how (per-action any/all). Declared by the CMS Owner. Read here
 * as `managingRealmId = realm`.
 */
function RealmManagementDelegationSection({ realm, realms }: {
  readonly realm: IdentityRealm;
  readonly realms: readonly IdentityRealm[];
}) {
  const api = useAdminApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{
    readonly managedRealm: IdentityRealm;
    readonly current: RealmManagementDelegation | undefined;
  } | null>(null);
  const [removing, setRemoving] = useState<RealmManagementDelegation | null>(null);
  const [adding, setAdding] = useState(false);

  const delegations = useQuery({
    queryKey: queryKeys.realmDelegations(realm.realmId),
    queryFn: () => api.identityRealms.listManagementDelegations(realm.realmId),
  });

  // Candidate managed realms: other active content realms in the workspace.
  const candidates = realms.filter(
    (r) => r.kind === "content" && r.realmId !== realm.realmId,
  );
  const byManagedId = new Map(
    (delegations.data?.delegations ?? []).map((d) => [d.managedRealmId, d] as const),
  );
  const realmName = new Map(realms.map((r) => [r.realmId, r.name] as const));
  // Only realms with an actual delegation get a row; the rest sit in the picker.
  const delegated = candidates.filter((r) => byManagedId.has(r.realmId));
  const addable = candidates.filter((r) => !byManagedId.has(r.realmId));

  return (
    <section className={styles.panel} aria-labelledby="realm-delegation-title">
      <SectionHeader
        id="realm-delegation-title"
        title="다른 공간 사용자 관리 위임"
        description="이 공간의 관리자가 다른 공간의 사용자를 어디까지 관리할 수 있는지 CMS에서 정합니다. (비밀번호 재설정·계정 잠금 해제 등)"
        actions={
          <Button
            size="small"
            variant="secondary"
            isDisabled={realm.status !== "active" || addable.length === 0}
            onPress={() => setAdding(true)}
          >위임 추가</Button>
        }
      />
      <Callout tone="info">
        여기서 허용한 범위 안에서만, 이 공간의 사용자 관리 권한자가 대상 공간 사용자를 관리할 수 있습니다. CMS 계정은 대상이 되지 않습니다.
      </Callout>
      {delegations.isPending ? <PageLoading label="관리 위임을 불러오는 중" /> : null}
      {delegations.isError ? (
        <LoadError error={delegations.error} onRetry={() => void delegations.refetch()} />
      ) : null}
      {candidates.length === 0 ? (
        <EmptyState title="위임할 다른 공간이 없습니다" description="같은 워크스페이스에 다른 사용자 공간이 있어야 관리 위임을 설정할 수 있습니다." />
      ) : delegated.length === 0 ? (
        <EmptyState
          title="위임한 공간이 없습니다"
          description="이 공간의 관리자는 다른 공간의 사용자를 관리할 수 없습니다. 「위임 추가」로 대상 공간을 고르세요."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.entitlementTable}`}>
            <thead>
              <tr>
                <th>대상 공간</th>
                <th>허용 관리 작업</th>
                <th>판정</th>
                <th className={styles.entitlementActionsHead}>작업</th>
              </tr>
            </thead>
            <tbody>
              {delegated.map((managedRealm) => {
                const current = byManagedId.get(managedRealm.realmId) as RealmManagementDelegation;
                return (
                  <tr key={managedRealm.realmId} data-has-entitlement>
                    <td>
                      <div className={styles.entitlementName}>
                        <span className={styles.entitlementNameRow}>
                          <strong>{managedRealm.name}</strong>
                        </span>
                        <DisplayModeGate minimum="advanced">
                          <IdValue label="Realm ID" value={managedRealm.realmId} />
                        </DisplayModeGate>
                      </div>
                    </td>
                    <td><span className={styles.entitlementActions}>{delegationActionSummary(current)}</span></td>
                    <td>{delegationScopeSummary(current)}</td>
                    <td>
                      <div className={styles.entitlementRowActions}>
                        <Button
                          size="small"
                          variant="secondary"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setEditing({ managedRealm, current })}
                        >편집</Button>
                        <Button
                          size="small"
                          variant="danger"
                          isDisabled={realm.status !== "active"}
                          onPress={() => setRemoving(current)}
                        >제거</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {addable.length > 0 && delegated.length > 0 ? (
        <p className={styles.compactHint}>
          나머지 공간 {addable.length}개는 이 공간이 관리할 수 없습니다.
        </p>
      ) : null}
      {adding ? (
        <AddTargetDialog
          title="사용자 관리를 위임할 공간"
          description="고른 공간에 대해 허용할 관리 작업을 이어서 정합니다."
          searchLabel="사용자 공간 검색"
          items={addable}
          keyOf={(r) => r.realmId}
          labelOf={(r) => r.name}
          hintOf={(r) => r.realmKey}
          emptyText="위임을 추가할 수 있는 공간이 없습니다."
          onClose={() => setAdding(false)}
          onPick={(managedRealm) => {
            setAdding(false);
            setEditing({ managedRealm, current: undefined });
          }}
        />
      ) : null}
      {editing ? (
        <DelegationEditDialog
          managingRealm={realm}
          managedRealm={editing.managedRealm}
          current={editing.current}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            queryClient.setQueryData<RealmManagementDelegationList>(
              queryKeys.realmDelegations(realm.realmId),
              (previous) => mergeDelegation(previous, saved, realm.realmId),
            );
            setEditing(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.managedByDelegations(saved.managedRealmId),
            });
          }}
        />
      ) : null}
      {removing ? (
        <DelegationRemoveDialog
          managingRealm={realm}
          delegation={removing}
          managedRealmName={realmName.get(removing.managedRealmId) ?? removing.managedRealmId}
          onClose={() => setRemoving(null)}
          onRemoved={async () => {
            const managedRealmId = removing.managedRealmId;
            queryClient.setQueryData<RealmManagementDelegationList>(
              queryKeys.realmDelegations(realm.realmId),
              (previous) => previous === undefined ? previous : {
                ...previous,
                delegations: previous.delegations.filter((d) => d.managedRealmId !== managedRealmId),
              },
            );
            setRemoving(null);
            await queryClient.invalidateQueries({
              queryKey: queryKeys.managedByDelegations(managedRealmId),
            });
          }}
        />
      ) : null}
    </section>
  );
}

function delegationScopeSummary(delegation: RealmManagementDelegation): string {
  const rules = new Set(delegation.actions.map((a) => delegation.scopeByAction[a] ?? "all"));
  if (rules.size === 0) return "—";
  if (rules.size > 1) return "작업별 상이";
  return rules.has("any") ? "느슨(하나라도 관리 대상)" : "엄격(모든 소속 관리 대상)";
}

function mergeDelegation(
  previous: RealmManagementDelegationList | undefined,
  saved: RealmManagementDelegation,
  managingRealmId: string,
): RealmManagementDelegationList {
  if (previous === undefined) return { managingRealmId, delegations: [saved] };
  const others = previous.delegations.filter((d) => d.managedRealmId !== saved.managedRealmId);
  return { ...previous, delegations: [...others, saved] };
}

function DelegationEditDialog({ managingRealm, managedRealm, current, onClose, onSaved }: {
  readonly managingRealm: IdentityRealm;
  readonly managedRealm: IdentityRealm;
  readonly current: RealmManagementDelegation | undefined;
  readonly onClose: () => void;
  readonly onSaved: (saved: RealmManagementDelegation) => void | Promise<void>;
}) {
  const api = useAdminApi();
  const [actions, setActions] = useState<ReadonlySet<ManagementAction>>(
    () => new Set(current?.actions ?? []),
  );
  const [scopeByAction, setScopeByAction] = useState<Readonly<Partial<Record<ManagementAction, DelegationScopeRule>>>>(
    () => ({ ...(current?.scopeByAction ?? {}) }),
  );
  const [password, setPassword] = useState("");

  const toggleAction = (action: ManagementAction, on: boolean) => {
    setActions((previous) => {
      const next = new Set(previous);
      if (on) next.add(action); else next.delete(action);
      return next;
    });
  };
  const setScope = (action: ManagementAction, rule: DelegationScopeRule) =>
    setScopeByAction((previous) => ({ ...previous, [action]: rule }));

  const save = useMutation({
    mutationFn: () => {
      const selected = MANAGEMENT_ACTION_ITEMS
        .map((item) => item.action)
        .filter((action) => actions.has(action));
      const scope: Partial<Record<ManagementAction, DelegationScopeRule>> = {};
      for (const action of selected) scope[action] = scopeByAction[action] ?? "all";
      return api.identityRealms.putManagementDelegation(managingRealm.realmId, managedRealm.realmId, {
        actions: selected,
        scopeByAction: scope,
        expectedRevision: current?.revision ?? null,
        password,
      });
    },
    onSuccess: (saved) => { void onSaved(saved); },
  });

  return (
    <ConfirmDialog
      title={`${managedRealm.name} 사용자 관리 위임`}
      confirmLabel={current === undefined ? "위임" : "저장"}
      isPending={save.isPending}
      isConfirmDisabled={password === "" || actions.size === 0}
      onCancel={() => { onClose(); save.reset(); }}
      onConfirm={() => save.mutate()}
    >
      <div className={styles.entitlementDialog}>
        <p className={styles.compactHint}><strong>{managingRealm.name}</strong>의 사용자 관리 권한자가 <strong>{managedRealm.name}</strong> 사용자에게 할 수 있는 작업을 고릅니다.</p>
        <div className={styles.entitlementGroup}>
          <h4>허용 관리 작업</h4>
          {MANAGEMENT_ACTION_ITEMS.map((item) => (
            <div key={item.action}>
              <CheckboxField
                isSelected={actions.has(item.action)}
                onChange={(on) => toggleAction(item.action, on)}
              >{item.label}</CheckboxField>
              {actions.has(item.action) ? (
                <SelectField
                  label={`${item.label} 판정`}
                  value={scopeByAction[item.action] ?? "all"}
                  options={[
                    { value: "all", label: "엄격 — 대상의 모든 소속이 관리 대상일 때만" },
                    { value: "any", label: "느슨 — 대상의 소속 중 하나라도 관리 대상이면" },
                  ]}
                  onChange={(value) => setScope(item.action, value as DelegationScopeRule)}
                />
              ) : null}
            </div>
          ))}
        </div>
        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={save.error} />
      </div>
    </ConfirmDialog>
  );
}

function DelegationRemoveDialog({ managingRealm, delegation, managedRealmName, onClose, onRemoved }: {
  readonly managingRealm: IdentityRealm;
  readonly delegation: RealmManagementDelegation;
  readonly managedRealmName: string;
  readonly onClose: () => void;
  readonly onRemoved: () => void | Promise<void>;
}) {
  const api = useAdminApi();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => api.identityRealms.deleteManagementDelegation(
      managingRealm.realmId, delegation.managedRealmId, {
        expectedRevision: delegation.revision,
        password,
      }),
    onSuccess: () => { void onRemoved(); },
  });
  return (
    <ConfirmDialog
      title="관리 위임 제거"
      confirmLabel="제거"
      danger
      isPending={remove.isPending}
      isConfirmDisabled={password === ""}
      onCancel={() => { onClose(); remove.reset(); }}
      onConfirm={() => remove.mutate()}
    >
      <div className={styles.dialogStack}>
        <Callout tone="warning"><strong>{managingRealm.name}가 {managedRealmName} 사용자를 더 이상 관리할 수 없게 됩니다.</strong></Callout>
        <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
        <MutationError error={remove.error} />
      </div>
    </ConfirmDialog>
  );
}

function FullAccessSection({ realm, bindings, mode }: {
  readonly realm: IdentityRealm;
  readonly bindings: FullAccessQueryResult;
  readonly mode: DisplayMode;
}) {
  const api = useAdminApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [password, setPassword] = useState("");
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<RealmFullAccessBinding | null>(null);
  const [revokePassword, setRevokePassword] = useState("");
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.realmFullAccess(realm.realmId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.realmAuthorization(realm.realmId) }),
  ]);
  const grant = useMutation({
    mutationFn: () => api.identityRealms.grantFullAccess(realm.realmId, {
      reason: reason.trim(),
      password,
      validUntil: localInstant(validUntil)!,
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
    mutationFn: () => api.identityRealms.revokeFullAccess(realm.realmId, revoking!.bindingId, revokePassword),
    onSuccess: async () => {
      setRevoking(null);
      setRevokePassword("");
      await refresh();
    },
  });
  const listedActiveBindings = bindings.data?.items.filter(isActiveFullAccess) ?? [];
  const activeBindings = bindings.data?.activeBinding !== undefined
    && isActiveFullAccess(bindings.data.activeBinding)
    && !listedActiveBindings.some(({ bindingId }) => bindingId === bindings.data!.activeBinding!.bindingId)
    ? [bindings.data.activeBinding, ...listedActiveBindings]
    : listedActiveBindings;
  const currentBinding = bindings.data?.activeBinding !== undefined && isActiveFullAccess(bindings.data.activeBinding)
    ? bindings.data.activeBinding
    : undefined;
  useEffect(() => {
    if (currentBinding === undefined) return;
    const delay = Math.max(0, Date.parse(currentBinding.validUntil) - Date.now()) + 100;
    const timer = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.realmFullAccess(realm.realmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.realmAuthorization(realm.realmId) });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentBinding?.bindingId, currentBinding?.validUntil, queryClient, realm.realmId]);
  const expiryTime = validUntil === "" ? Number.NaN : Date.parse(localInstant(validUntil)!);
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

  return (
    <section className={`${styles.panel} ${styles.fullAccessPanel}`} data-active={activeBindings.length > 0} aria-labelledby="full-access-title">
      <SectionHeader
        id="full-access-title"
        title="사용자 공간 Full Access"
        description="CMS Owner가 제한된 시간 동안 이 사용자 공간의 Admin Studio 정책을 직접 복구하는 비상 접근입니다."
        actions={<>
          <Button size="small" variant="secondary" onPress={() => navigate(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/audit`)}>감사 로그</Button>
          <Button
            variant="danger"
            onPress={openGrantDialog}
            isDisabled={realm.status === "disabled" || currentBinding !== undefined}
          >{currentBinding ? "Full Access 사용 중" : "Full Access 시작"}</Button>
        </>}
      />
      <p className={styles.compactHint}>사용자 공간 소속이나 Content API 권한은 만들지 않습니다. 일반 운영은 사람 소유자와 역할 연결로 처리하세요.</p>
      {bindings.isPending ? <PageLoading label="Full Access 상태를 불러오는 중" /> : null}
      {bindings.isError ? <LoadError error={bindings.error} onRetry={() => void bindings.refetch()} /> : null}
      {activeBindings.length > 0 ? (
        <div className={styles.fullAccessActiveList}>
          {activeBindings.map((binding) => (
            <article key={binding.bindingId} className={styles.fullAccessActiveItem}>
              <div>
                <Badge tone="danger">Full Access 사용 중</Badge>
                <strong>{remainingFullAccessTime(binding.validUntil)}</strong>
                <span>{binding.reason}</span>
              </div>
              <div>
                <span>System Identity <code>{binding.systemIdentityId}</code></span>
                <span>{formatInstant(binding.createdAt)} 시작 · {formatInstant(binding.validUntil)} 만료</span>
              </div>
              <Button size="small" variant="danger" onPress={() => { setRevoking(binding); setRevokePassword(""); }}>즉시 해제</Button>
            </article>
          ))}
        </div>
      ) : bindings.data ? (
        <div className={styles.fullAccessInactive}><Badge tone="neutral">비활성</Badge><span>현재 사용 중인 Full Access가 없습니다.</span></div>
      ) : null}
      {displayModeAtLeast(mode, "advanced") && bindings.data && bindings.data.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>System Identity</th><th>발급 사유</th><th>발급자</th><th>유효 기간</th><th>상태</th><th /></tr></thead>
            <tbody>{bindings.data.items.map((binding) => {
              const expired = binding.terminationReason === "expired"
                || Date.parse(binding.validUntil) <= Date.now();
              const revoked = binding.terminationReason === "revoked"
                || (binding.revokedAt !== undefined && !expired);
              return (
                <tr key={binding.bindingId}>
                  <td><IdValue label="System Identity ID" value={binding.systemIdentityId} /><IdValue label="Full Access Binding ID" value={binding.bindingId} /></td>
                  <td>{binding.reason}</td>
                  <td><IdValue label="Global Identity ID" value={binding.grantedByGlobalIdentityId} /></td>
                  <td>{formatInstant(binding.createdAt)}<span className={styles.secondaryLine}>만료 {formatInstant(binding.validUntil)}</span></td>
                  <td>{expired ? <Badge tone="warning">만료됨</Badge> : revoked ? <Badge tone="neutral">해지됨</Badge> : <Badge tone="danger">활성 Full Access</Badge>}</td>
                  <td>{!revoked && !expired ? <Button size="small" variant="danger" onPress={() => { setRevoking(binding); setRevokePassword(""); }}>즉시 해제</Button> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : null}
      <MutationError error={revoke.error} />
      {granting ? (
        <ConfirmDialog
          title="사용자 공간 Full Access 시작"
          confirmLabel="Full Access 시작"
          danger
          isPending={grant.isPending}
          isConfirmDisabled={!expiryValid || reason.trim() === "" || password === ""}
          onCancel={() => { setGranting(false); grant.reset(); }}
          onConfirm={() => grant.mutate()}
        >
          <div className={styles.dialogStack}>
            <Callout tone="warning"><strong>비상 정책 복구에만 사용하세요.</strong> 현재 로그인한 CMS Owner의 System Identity에만 적용되며 Content API에는 적용되지 않습니다.</Callout>
            <div className={styles.fullAccessPresets} aria-label="Full Access 기간 선택">
              {[15, 30, 60].map((minutes) => <Button key={minutes} size="small" variant="secondary" onPress={() => setValidUntil(localDateTimeAfter(minutes))}>{minutes === 60 ? "1시간" : `${minutes}분`}</Button>)}
            </div>
            <TextInput label="만료 시각" type="datetime-local" value={validUntil} onChange={setValidUntil} description="미래 시각을 필수로 지정하며 최대 4시간까지 허용됩니다." isRequired />
            {validUntil !== "" && !expiryValid ? <Callout tone="error">만료 시각은 현재보다 이후이고 4시간 이내여야 합니다.</Callout> : null}
            <TextAreaField label="접근 사유" value={reason} onChange={setReason} rows={3} isRequired />
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
            <MutationError error={grant.error} />
          </div>
        </ConfirmDialog>
      ) : null}
      {revoking ? (
        <ConfirmDialog
          title="사용자 공간 Full Access 즉시 해제"
          confirmLabel="즉시 해제"
          danger
          isPending={revoke.isPending}
          isConfirmDisabled={revokePassword === ""}
          onCancel={() => { setRevoking(null); setRevokePassword(""); }}
          onConfirm={() => revoke.mutate()}
        >
          <div className={styles.dialogStack}>
            <p><code>{revoking.systemIdentityId}</code> System Identity의 Realm Full Access를 즉시 해제합니다.</p>
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={revokePassword} onChange={setRevokePassword} isRequired />
          </div>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/**
 * Cross-space access matrix: rows are collections, columns are Content Realms,
 * each cell shows the ceiling (allowed actions) for that (collection, realm)
 * pair. The reverse endpoint (`listEntitlementsForCollection`) fills one row per
 * collection with a single request. Read-only overview; editing stays on the
 * per-space "권한" tab, reachable by clicking a cell.
 */
export function RealmEntitlementMatrixPage() {
  const api = useAdminApi();
  const navigate = useNavigate();

  const realms = useQuery({ queryKey: queryKeys.identityRealms, queryFn: () => api.identityRealms.list() });
  const collections = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });

  // Only Content Realms are gated; the System realm never appears.
  const contentRealms = (realms.data?.items ?? []).filter((r) => r.kind === "content");
  const collectionItems = collections.data?.items ?? [];

  // One reverse query per collection → a full matrix row.
  const rowQueries = useQueries({
    queries: collectionItems.map((collection) => ({
      queryKey: queryKeys.collectionEntitlements(collection.id),
      queryFn: () => api.identityRealms.listEntitlementsForCollection(collection.id),
    })),
  });

  // collectionId → (realmId → entitlement)
  const byCollection = new Map<string, Map<string, RealmCollectionEntitlement>>();
  collectionItems.forEach((collection, index) => {
    const result = rowQueries[index]?.data;
    byCollection.set(
      collection.id,
      new Map((result?.entitlements ?? []).map((e) => [e.realmId, e] as const)),
    );
  });

  // collectionId → the realm that owns it as its Auth (profile) collection.
  const authOwnerByCollection = new Map<string, string>();
  for (const r of contentRealms) {
    if (r.profileCollectionId !== undefined) authOwnerByCollection.set(r.profileCollectionId, r.realmId);
  }

  const loading = realms.isPending || collections.isPending || rowQueries.some((q) => q.isPending);
  const rowError = rowQueries.find((q) => q.isError);

  return (
    <Page>
      <PageHeader
        eyebrow="Access"
        title="콘텐츠 접근 매트릭스"
        description="어떤 사용자 공간이 어떤 콘텐츠에 접근할 수 있는지 한눈에 봅니다. 셀을 누르면 해당 공간의 접근 설정으로 이동합니다."
        actions={<Button variant="secondary" onPress={() => navigate("/admin/realms")}>사용자 공간 목록</Button>}
      />
      {realms.isError ? <LoadError error={realms.error} onRetry={() => void realms.refetch()} /> : null}
      {collections.isError ? <LoadError error={collections.error} onRetry={() => void collections.refetch()} /> : null}
      {rowError !== undefined ? <LoadError error={rowError.error} onRetry={() => void rowError.refetch()} /> : null}
      {loading ? <PageLoading label="접근 매트릭스를 불러오는 중" /> : null}
      {!loading && contentRealms.length === 0 ? (
        <EmptyState title="사용자 공간이 없습니다" description="먼저 사용자 공간을 만들면 접근 매트릭스가 채워집니다." />
      ) : null}
      {!loading && contentRealms.length > 0 && collectionItems.length === 0 ? (
        <EmptyState title="콘텐츠 유형이 없습니다" description="스키마에서 콘텐츠 유형을 먼저 만들어 주세요." />
      ) : null}
      {!loading && contentRealms.length > 0 && collectionItems.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.entitlementMatrix}`}>
            <thead>
              <tr>
                <th className={styles.entitlementMatrixCorner}>콘텐츠 유형</th>
                {contentRealms.map((realm) => (
                  <th key={realm.realmId}>
                    <Link to={`/admin/realms/${encodeURIComponent(realm.realmId)}?tab=access`}>{realm.name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {collectionItems.map((collection) => (
                <tr key={collection.id}>
                  <th scope="row" className={styles.entitlementMatrixRowHead}>
                    {collection.label ?? collection.name}
                  </th>
                  {contentRealms.map((realm) => {
                    const authOwnerId = authOwnerByCollection.get(collection.id);
                    const isAuth = authOwnerId === realm.realmId;
                    // Another realm's Auth collection is never accessible here.
                    const isForeignAuth = authOwnerId !== undefined && authOwnerId !== realm.realmId;
                    const entitlement = byCollection.get(collection.id)?.get(realm.realmId);
                    return (
                      <td
                        key={realm.realmId}
                        className={styles.entitlementMatrixCell}
                        data-access={
                          isAuth ? "guaranteed"
                            : isForeignAuth ? "blocked"
                            : entitlement !== undefined ? "allowed" : "none"
                        }
                      >
                        <Link
                          to={`/admin/realms/${encodeURIComponent(realm.realmId)}?tab=access`}
                          aria-label={`${realm.name} · ${collection.label ?? collection.name} 접근 설정`}
                        >
                          {isAuth ? (
                            <Badge tone="success">항상 허용</Badge>
                          ) : isForeignAuth ? (
                            <span className={styles.entitlementMatrixNone}>접근 불가</span>
                          ) : entitlement !== undefined ? (
                            <span className={styles.entitlementMatrixActions}>{entitlementActionSummary(entitlement.actions)}</span>
                          ) : (
                            <span className={styles.entitlementMatrixNone}>접근 안 함</span>
                          )}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  );
}
