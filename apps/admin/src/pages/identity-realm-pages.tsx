import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SCHEMA_NAME_ERROR_MESSAGE,
  SCHEMA_NAME_PATTERN,
  toAdminApiError,
  useAdminApi,
  type CollectionDetail,
  type CollectionField,
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

import { LoadError, PageLoading, RealmAuthorizationError } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
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
      {realms.isError ? <RealmAuthorizationError error={realms.error} context="list" onRetry={() => void realms.refetch()} /> : null}
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
  const queryClient = useQueryClient();
  const { mode } = useDisplayMode();
  const [profileSetupOpen, setProfileSetupOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<RealmDetailTab>("overview");
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
    enabled: realmId !== undefined && isContent && detailTab === "access" && displayModeAtLeast(mode, "advanced"),
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

  if (realmId === undefined) return <Page><Callout tone="error">Realm ID가 없습니다.</Callout></Page>;
  if (realm.isPending) return <Page><PageLoading label="Realm 상세 정보를 불러오는 중" /></Page>;
  if (realm.isError) return <Page><RealmAuthorizationError error={realm.error} context="detail" onRetry={() => void realm.refetch()} /></Page>;

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
              <strong>기본 인증 스키마를 만들면 Realm을 바로 활성화할 수 있습니다.</strong>
              <p>로그인 identifier와 기본 Profile 필드를 확인하면 Collection 생성, stable ID 발급, Realm 연결과 Schema 적용을 한 번에 처리합니다.</p>
              <div className={styles.formActions}>
                <Button onPress={() => setProfileSetupOpen(true)}>기본 인증 스키마 생성</Button>
                <Button variant="secondary" onPress={() => navigate("/admin/schema/new")}>직접 설계</Button>
              </div>
            </Callout>
          ) : null}
          {realm.data.status === "disabled" ? (
            <Callout tone="warning"><strong>이 Realm은 비활성 상태입니다.</strong> 신규 세션, Membership provisioning과 Full Access grant가 차단됩니다.</Callout>
          ) : null}
          <RealmDetailTabs
            active={detailTab}
            hasProfile={realm.data.profileCollectionId !== undefined}
            onChange={setDetailTab}
          />
          {detailTab === "overview" ? <RealmSettingsForm realm={realm.data} /> : null}
          {detailTab === "members" ? (
            <MembershipSection
              realm={realm.data}
              memberships={memberships}
              identities={identities}
              systemRealmId={realms.data?.items.find(({ kind }) => kind === "system")?.realmId ?? "rlm_system"}
            />
          ) : null}
          {detailTab === "profile" && realm.data.profileCollectionId !== undefined ? (
            <RealmProfileFieldsSection realm={realm.data} />
          ) : null}
          {detailTab === "access" ? (
            <>
              <RealmAccessOverview realm={realm.data} mode={mode} />
              {displayModeAtLeast(mode, "advanced") ? <FullAccessSection realm={realm.data} memberships={memberships.data?.items ?? []} bindings={fullAccess} identities={identities.data?.items ?? []} /> : null}
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

function RealmDetailTabs({ active, hasProfile, onChange }: {
  readonly active: RealmDetailTab;
  readonly hasProfile: boolean;
  readonly onChange: (tab: RealmDetailTab) => void;
}) {
  const tabs: readonly { readonly id: RealmDetailTab; readonly label: string; readonly disabled?: boolean }[] = [
    { id: "overview", label: "개요" },
    { id: "members", label: "사용자" },
    { id: "profile", label: "프로필 필드", disabled: !hasProfile },
    { id: "access", label: "권한" },
  ];
  return (
    <div className={styles.detailTabs} role="tablist" aria-label="Realm 상세 영역">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
        >{tab.label}</button>
      ))}
    </div>
  );
}

function RealmAccessOverview({ realm, mode }: { readonly realm: IdentityRealm; readonly mode: DisplayMode }) {
  const navigate = useNavigate();
  const target = mode === "basic" ? "grades" : "roles";
  return (
    <section className={styles.panel} aria-labelledby="realm-access-overview-title">
      <SectionHeader
        id="realm-access-overview-title"
        title="Realm 권한"
        description="이 Realm 안에서 사용할 등급, 역할과 사용자 배정을 관리합니다."
        actions={<Button
          onPress={() => navigate(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/${target}`)}
          isDisabled={realm.status !== "active"}
        >Realm 권한 관리</Button>}
      />
      <p className={styles.compactHint}>일반 권한은 역할과 Scope로 관리합니다. Full Access는 Advanced 모드에서 복구 목적으로만 제공됩니다.</p>
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
      confirmLabel="생성하고 Realm 활성화"
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
        <p><strong>{realm.name}</strong> Realm의 Profile Collection을 생성하고 즉시 Schema에 적용합니다.</p>
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
        <Callout tone="info">이 작업은 현재 Schema에 다른 미적용 변경이 없을 때만 실행되며, 생성과 적용이 끝나면 Realm이 활성화됩니다.</Callout>
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
        description="이 Realm 회원의 Profile 문서에 저장되는 기본 정보를 관리합니다."
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
        <Callout tone="warning">프로필 필드를 추가하려면 먼저 Realm 설정에서 상태를 활성으로 변경해 주세요.</Callout>
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
        <div className={styles.settingsFieldGrid}>
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
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newProfileSource, setNewProfileSource] = useState("{}");
  const [newReauthPassword, setNewReauthPassword] = useState("");
  const [newProfileError, setNewProfileError] = useState<string | null>(null);
  const [membershipAction, setMembershipAction] = useState<"register" | "provision" | null>(null);
  const [promoting, setPromoting] = useState<RealmMembership | null>(null);
  const [promoteReauthPassword, setPromoteReauthPassword] = useState("");
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
        description="이 Realm에 연결된 사용자를 확인하고 필요한 연결 작업을 실행합니다."
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
        <Callout tone="warning">이 Realm이 활성 상태가 되어야 사용자를 연결할 수 있습니다.</Callout>
      ) : null}
      {identities.isError ? <LoadError error={identities.error} onRetry={() => void identities.refetch()} /> : null}
      {!realm.authentication.acceptSystemIdentities ? (
        <p className={styles.compactHint}>기존 운영자 연결은 Realm 설정에서 System Identity Membership을 허용하면 사용할 수 있습니다.</p>
      ) : realm.status === "active" && !identities.isPending && candidates.length === 0 ? (
        <p className={styles.compactHint}>연결 가능한 운영자 계정이 없습니다.</p>
      ) : null}
      {memberships.isPending ? <PageLoading label="Membership을 불러오는 중" /> : null}
      {memberships.isError ? <LoadError error={memberships.error} onRetry={() => void memberships.refetch()} /> : null}
      {memberships.data?.items.length === 0 ? <EmptyState title="연결된 사용자가 없습니다" description="상단 작업으로 사용자를 연결하거나 일반 사용자가 가입/JIT 로그인하면 여기에 표시됩니다." /> : null}
      {memberships.data && memberships.data.items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.membershipTable}`}>
            <thead><tr><th>사용자</th><th>Realm Subject</th><th>Profile</th><th>상태</th><th>연결 방식</th><th>작업</th></tr></thead>
            <tbody>
              {memberships.data.items.map((membership) => {
                const identity = membership.identity ?? identityById.get(membership.globalIdentityId);
                return (
                  <tr key={membership.membershipId}>
                    <td>
                      <strong>{identity?.primaryIdentifier ?? "Identifier 미제공"}</strong>
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
                        {membership.status === "active" && realm.kind === "content" ? (
                          <Button size="small" variant="secondary" isDisabled={realm.status !== "active" || promote.isPending} onPress={() => { setPromoting(membership); setPromoteReauthPassword(""); }}>관리자로 지정</Button>
                        ) : null}
                        {membership.status === "active" ? (
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
          title="Realm 관리자로 지정"
          confirmLabel="관리자로 지정"
          isPending={promote.isPending}
          isConfirmDisabled={promoteReauthPassword === ""}
          onCancel={() => { setPromoting(null); setPromoteReauthPassword(""); }}
          onConfirm={() => promote.mutate(promoting)}
        >
          <div className={styles.dialogStack}>
            <p><strong>{(promoting.identity ?? identityById.get(promoting.globalIdentityId))?.primaryIdentifier ?? promoting.subjectId}</strong> 님에게 이 Realm의 <strong>관리자(content-administrator)</strong> 권한을 부여합니다. 이후 이 계정으로 “Realm 권한 관리” 화면에 들어가 권한을 직접 관리할 수 있습니다.</p>
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
  const [granting, setGranting] = useState(false);
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
  const identityById = new Map(identities.map((identity) => [identity.globalIdentityId, identity]));
  const activeMemberships = memberships.filter(({ status }) => status === "active");

  return (
    <section className={styles.panel} aria-labelledby="full-access-title">
      <SectionHeader
        id="full-access-title"
        title="Realm Full Access"
        description="현재와 미래의 이 Realm 리소스에만 적용되는 별도 보호 바인딩입니다."
        actions={<Button
          variant="danger"
          onPress={() => { grant.reset(); setGranting(true); }}
          isDisabled={realm.status !== "active" || activeMemberships.length === 0}
        >Full Access 부여</Button>}
      />
      <Callout tone="warning"><strong>복구와 초기 설정에만 사용하세요.</strong> 일반 운영 권한은 Realm Role Binding으로 부여해야 하며, grant와 revoke 모두 현재 System 계정 비밀번호를 재검증합니다.</Callout>
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
      {granting ? (
        <ConfirmDialog
          title="Realm Full Access 부여"
          confirmLabel="Full Access 부여"
          danger
          isPending={grant.isPending}
          isConfirmDisabled={subjectId === "" || reason.trim() === "" || password === ""}
          onCancel={() => { setGranting(false); grant.reset(); }}
          onConfirm={() => grant.mutate()}
        >
          <div className={styles.dialogStack}>
            <Callout tone="warning">이 권한은 복구와 초기 설정에만 사용해야 합니다.</Callout>
            <SelectField
              label="대상 Realm Subject"
              value={subjectId}
              options={activeMemberships.map((membership) => ({
                value: membership.subjectId,
                label: `${identityById.get(membership.globalIdentityId)?.primaryIdentifier ?? membership.globalIdentityId} · Subject ${membership.subjectId}`,
              }))}
              onChange={setSubjectId}
            />
            <TextInput label="만료 시각" type="datetime-local" value={validUntil} onChange={setValidUntil} description="비워 두면 해지할 때까지 유지됩니다." />
            <TextAreaField label="부여 사유" value={reason} onChange={setReason} rows={3} isRequired />
            <TextInput label="현재 System 계정 비밀번호" type="password" autoComplete="current-password" value={password} onChange={setPassword} isRequired />
            <MutationError error={grant.error} />
          </div>
        </ConfirmDialog>
      ) : null}
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
