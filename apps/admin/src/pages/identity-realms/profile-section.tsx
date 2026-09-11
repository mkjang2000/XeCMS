import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SCHEMA_NAME_ERROR_MESSAGE, SCHEMA_NAME_PATTERN, toAdminApiError, useAdminApi, type CollectionDetail, type CollectionField, type IdentityRealm } from "@xecms/admin";
import { Badge, Button, Callout, CheckboxField, ConfirmDialog, SelectField, TextInput } from "@xecms/ui";
import { useNavigate } from "react-router";
import { LoadError, PageLoading } from "../../components/async-state.js";
import { SectionHeader } from "../../components/page.js";
import { DisplayModeGate } from "../../display-mode.js";
import { queryKeys } from "../../queries.js";
import styles from "../../identity-realms.module.css";

function defaultProfileCollectionName(realmKey: string): string {
  const camel = realmKey.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase());
  const prefixed = /^[a-z]/.test(camel) ? camel : `realm${camel}`;
  return `${prefixed}Accounts`.slice(0, 64);
}

export function ProfileSchemaSetupDialog({ realm, error, isPending, onCancel, onConfirm }: {
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

export function RealmProfileFieldsSection({ realm }: { readonly realm: IdentityRealm }) {
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
