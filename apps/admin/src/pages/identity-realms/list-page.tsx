import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@xecms/admin";
import { Button, CheckboxField, EmptyState, SelectField, TextInput } from "@xecms/ui";
import { Link, useNavigate } from "react-router";
import { PageLoading, RealmAuthorizationError } from "../../components/async-state.js";
import { Icon } from "../../components/icon.js";
import { Page, PageHeader, SectionHeader } from "../../components/page.js";
import { DisplayModeGate } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { provisioningOptions, registrationOptions, commaValues, RealmStatusBadge, MutationError } from "./shared.js";

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
