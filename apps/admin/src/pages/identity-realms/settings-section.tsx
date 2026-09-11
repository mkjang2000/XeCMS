import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi, type IdentityRealm } from "@xecms/admin";
import { Button, Callout, CheckboxField, SelectField, TextInput } from "@xecms/ui";
import { SectionHeader } from "../../components/page.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";
import { provisioningOptions, registrationOptions, commaValues, MutationError } from "./shared.js";

const statusOptions = [
  { value: "active", label: "활성" },
  { value: "disabled", label: "비활성" },
] as const;

export function RealmSettingsForm({ realm }: { readonly realm: IdentityRealm }) {
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
