import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi, type IdentityRealm, type RealmFullAccessBinding, type RealmFullAccessPage } from "@xecms/admin";
import { Badge, Button, Callout, ConfirmDialog, TextAreaField, TextInput } from "@xecms/ui";
import { useNavigate } from "react-router";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { SectionHeader } from "../../components/page.js";
import { displayModeAtLeast, type DisplayMode } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { MutationError, IdValue } from "./shared.js";

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

type FullAccessQueryResult = ReturnType<typeof useQuery<RealmFullAccessPage>>;

function localDateTimeAfter(minutes: number): string {
  const value = new Date(Date.now() + minutes * 60_000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function isActiveFullAccess(binding: RealmFullAccessBinding): boolean {
  return binding.revokedAt === undefined && Date.parse(binding.validUntil) > Date.now();
}

function remainingFullAccessTime(validUntil: string): string {
  const remainingMinutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
  if (remainingMinutes < 60) return `${remainingMinutes}분 후 만료`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes === 0 ? `${hours}시간 후 만료` : `${hours}시간 ${minutes}분 후 만료`;
}

export function FullAccessSection({ realm, bindings, mode }: {
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
