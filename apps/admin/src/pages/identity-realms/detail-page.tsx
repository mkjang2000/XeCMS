import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi, type IdentityRealm } from "@xecms/admin";
import { Button, Callout } from "@xecms/ui";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { Tabs, TabDangerDot, type TabDef } from "../../components/tabs.js";
import { ownerCandidateMemberships } from "../realm-setup.js";
import { DisplayModeGate, displayModeAtLeast, useDisplayMode, type DisplayMode } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { CollectionEntitlementSection } from "./entitlement-section.js";
import { isActiveFullAccess, FullAccessSection } from "./full-access-section.js";
import { RealmManagementDelegationSection } from "./management-delegation-section.js";
import { MembershipSection } from "./membership-section.js";
import { RealmOwnerSection } from "./owner-section.js";
import { ProfileSchemaSetupDialog, RealmProfileFieldsSection } from "./profile-section.js";
import { RealmSettingsForm } from "./settings-section.js";
import { RealmSetupChecklist } from "./setup-checklist.js";
import { RealmStatusBadge } from "./shared.js";

type RealmDetailTab = "overview" | "members" | "profile" | "access";

function realmDetailTab(value: string | null): RealmDetailTab {
  return value === "members" || value === "profile" || value === "access" ? value : "overview";
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
