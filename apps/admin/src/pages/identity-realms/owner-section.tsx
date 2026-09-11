import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi, type GlobalIdentity, type IdentityRealm, type RealmMembership } from "@xecms/admin";
import { Badge, Button, Callout, CheckboxField, ConfirmDialog, SelectField, TextAreaField, TextInput } from "@xecms/ui";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { SectionHeader } from "../../components/page.js";
import { ownerCandidateMemberships } from "../realm-setup.js";
import { DisplayModeGate } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { MembershipStatusBadge, MutationError, type QueryResult, type OwnerQueryResult, IdValue } from "./shared.js";

export function RealmOwnerSection({ realm, owner, memberships, identities, systemRealmId }: {
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
