import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDefaultFieldRegistry,
  SCHEMA_NAME_ERROR_MESSAGE,
  SCHEMA_NAME_PATTERN,
  schemaIssuePathToFormPath,
  toAdminApiError,
  useAdminApi,
  type CollectionDetail,
  type CollectionDraftInput,
  type ContentFieldType,
  type IdentityRealm,
} from "@xecms/admin";
import { Button, Callout, CheckboxField, SelectField, TextAreaField, TextInput } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import {
  DisplayModeGate,
  displayModeAtLeast,
  useDisplayMode,
} from "../display-mode.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { queryKeys } from "../queries.js";

interface SchemaFieldValues {
  readonly preserved?: CollectionDraftInput["fields"][number];
  readonly persistentId: string | null;
  readonly relationId: string | null;
  readonly name: string;
  readonly label: string;
  readonly type: ContentFieldType;
  readonly required: boolean;
  readonly unique: boolean;
  readonly readOnly: boolean;
  readonly multiple: boolean;
  readonly minLength: string;
  readonly maxLength: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly integer: boolean;
  readonly optionsSource: string;
  readonly targetCollectionId: string;
  readonly cardinality: "one" | "many";
  readonly onDelete: "restrict" | "nullify" | "cascade";
  readonly componentId: string;
  readonly allowedComponentIds: string;
  readonly acceptedMimeTypes: string;
  readonly editor: string;
}

interface SchemaFormValues {
  readonly name: string;
  readonly label: string;
  readonly kind: "collection" | "singleton";
  readonly hierarchyEnabled: boolean;
  readonly maxDepth: string;
  readonly ordering: "manual" | "created-at" | "field";
  readonly orderingFieldId: string;
  readonly slugPath: boolean;
  readonly permissionInheritance: boolean;
  readonly authEnabled: boolean;
  readonly authRealmKey: string;
  readonly authIdentifierFieldIds: readonly string[];
  readonly authAcceptSystemIdentities: boolean;
  readonly authProvisioning: "explicit" | "jit";
  readonly authDefaultRoleIds: string;
  readonly fields: readonly SchemaFieldValues[];
}

const fieldTypes = createDefaultFieldRegistry().list().map(({ type, label }) => ({ value: type, label }));
const emptyField = (): SchemaFieldValues => ({
  persistentId: null,
  relationId: null,
  name: "",
  label: "",
  type: "text",
  required: false,
  unique: false,
  readOnly: false,
  multiple: false,
  minLength: "",
  maxLength: "",
  minimum: "",
  maximum: "",
  integer: false,
  optionsSource: "",
  targetCollectionId: "",
  cardinality: "one",
  onDelete: "restrict",
  componentId: "",
  allowedComponentIds: "",
  acceptedMimeTypes: "",
  editor: "",
});

function toFormValues(collection?: CollectionDetail): SchemaFormValues {
  return {
    name: collection?.name ?? "",
    label: collection?.label ?? "",
    kind: collection?.kind ?? "collection",
    hierarchyEnabled: collection?.hierarchy?.enabled ?? false,
    maxDepth: collection?.hierarchy?.maxDepth === undefined ? "" : String(collection.hierarchy.maxDepth),
    ordering: collection?.hierarchy?.ordering ?? "manual",
    orderingFieldId: collection?.hierarchy?.orderingFieldId ?? "",
    slugPath: collection?.hierarchy?.slugPath ?? false,
    permissionInheritance: collection?.hierarchy?.permissionInheritance ?? true,
    authEnabled: collection?.auth?.enabled === true,
    authRealmKey: collection?.auth?.realmKey ?? "",
    authIdentifierFieldIds: collection?.auth?.identifierFieldIds ?? [],
    authAcceptSystemIdentities: collection?.auth?.acceptSystemIdentities ?? true,
    authProvisioning: collection?.auth?.provisioning ?? "explicit",
    authDefaultRoleIds: (collection?.auth?.defaultRoleIds ?? []).join(", "),
    fields: collection?.fields.map((field) => ({
      ...emptyField(),
      preserved: field,
      persistentId: field.id,
      relationId: field.relationId ?? null,
      name: field.name,
      label: field.label ?? "",
      type: field.type,
      required: field.required,
      unique: field.unique ?? false,
      readOnly: field.readOnly ?? false,
      multiple: field.multiple ?? false,
      minLength: field.minLength === undefined ? "" : String(field.minLength),
      maxLength: field.maxLength === undefined ? "" : String(field.maxLength),
      minimum: field.minimum === undefined ? "" : String(field.minimum),
      maximum: field.maximum === undefined ? "" : String(field.maximum),
      integer: field.integer ?? false,
      optionsSource: (field.options ?? []).map(({ label, value }) => `${value} = ${label}`).join("\n"),
      targetCollectionId: field.targetCollectionId ?? "",
      cardinality: field.cardinality ?? "one",
      onDelete: field.onDelete ?? "restrict",
      componentId: field.componentId ?? "",
      allowedComponentIds: (field.allowedComponentIds ?? []).join(", "),
      acceptedMimeTypes: (field.acceptedMimeTypes ?? []).join(", "),
      editor: field.editor ?? "",
    })) ?? [emptyField()],
  };
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function commaValues(source: string): readonly string[] {
  return source.split(",").map((item) => item.trim()).filter(Boolean);
}

function duplicateValue(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

function eligibleIdentifierFields(values: SchemaFormValues): readonly SchemaFieldValues[] {
  return values.fields.filter((field) =>
    field.persistentId !== null
    && field.type === "text"
    && field.required
    && field.unique);
}

function authConfigurationMessages(
  values: SchemaFormValues,
  realms: readonly IdentityRealm[],
  collectionId: string | undefined,
  realmListUnavailable: boolean,
): readonly string[] {
  if (!values.authEnabled) return [];
  const messages: string[] = [];
  const eligibleIds = new Set(
    eligibleIdentifierFields(values).flatMap(({ persistentId }) =>
      persistentId === null ? [] : [persistentId]),
  );
  const selectedRealm = realms.find(({ realmKey }) => realmKey === values.authRealmKey);
  if (values.kind === "singleton") {
    messages.push("싱글턴은 콘텐츠 계정 Profile Collection으로 사용할 수 없습니다.");
  }
  if (realmListUnavailable) {
    messages.push("Realm 목록을 확인할 수 없어 인증 설정을 저장할 수 없습니다.");
  } else if (!values.authRealmKey) {
    messages.push("먼저 생성된 Content Realm을 선택해 주세요.");
  } else if (selectedRealm === undefined || selectedRealm.kind !== "content") {
    messages.push("선택한 Realm key와 일치하는 Content Realm이 없습니다.");
  } else {
    if (selectedRealm.status === "disabled") {
      messages.push("비활성화된 Realm에는 Profile Collection을 연결할 수 없습니다.");
    }
    if (
      selectedRealm.profileCollectionId !== undefined
      && selectedRealm.profileCollectionId !== collectionId
    ) {
      messages.push("선택한 Realm에는 이미 다른 Profile Collection이 연결되어 있습니다.");
    }
  }
  if (eligibleIds.size === 0) {
    messages.push("최상위 required + unique text 필드를 저장해 stable ID를 발급한 뒤 identifier로 선택해 주세요.");
  } else if (values.authIdentifierFieldIds.length === 0) {
    messages.push("로그인 identifier 필드를 한 개 이상 선택해 주세요.");
  }
  const invalidIdentifier = values.authIdentifierFieldIds.find((fieldId) => !eligibleIds.has(fieldId));
  if (invalidIdentifier !== undefined) {
    messages.push(`Identifier '${invalidIdentifier}'는 더 이상 required + unique text 조건을 충족하지 않습니다.`);
  }
  if (values.authProvisioning === "jit" && !values.authAcceptSystemIdentities) {
    messages.push("JIT provisioning은 System Identity 허용을 함께 사용해야 합니다.");
  }
  const duplicateRoleId = duplicateValue(commaValues(values.authDefaultRoleIds));
  if (duplicateRoleId !== undefined) {
    messages.push(`기본 Role ID '${duplicateRoleId}'가 중복되었습니다.`);
  }
  return messages;
}

function parseOptions(source: string) {
  return source.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    const value = (separator < 0 ? line : line.slice(0, separator)).trim();
    const label = (separator < 0 ? line : line.slice(separator + 1)).trim();
    return { value, label: label || value };
  });
}

function toDraft(values: SchemaFormValues): CollectionDraftInput {
  const hierarchy = values.hierarchyEnabled ? {
    enabled: true as const,
    ...(optionalNumber(values.maxDepth) === undefined ? {} : { maxDepth: optionalNumber(values.maxDepth) }),
    ordering: values.ordering,
    ...(values.ordering === "field" && values.orderingFieldId.trim()
      ? { orderingFieldId: values.orderingFieldId.trim() }
      : {}),
    ...(values.slugPath ? { slugPath: true } : {}),
    permissionInheritance: values.permissionInheritance,
  } : undefined;
  const auth = values.authEnabled ? {
    enabled: true as const,
    realmKey: values.authRealmKey,
    identifierFieldIds: [...values.authIdentifierFieldIds],
    acceptSystemIdentities: values.authAcceptSystemIdentities,
    provisioning: values.authProvisioning,
    defaultRoleIds: commaValues(values.authDefaultRoleIds),
  } : undefined;
  return {
    name: values.name.trim(),
    ...(values.label.trim() ? { label: values.label.trim() } : {}),
    kind: values.kind,
    ...(hierarchy ? { hierarchy } : {}),
    ...(auth ? { auth } : {}),
    fields: values.fields.map((field) => ({
      ...field.preserved,
      ...(field.persistentId ? { id: field.persistentId } : {}),
      name: field.name.trim(),
      ...(field.label.trim() ? { label: field.label.trim() } : {}),
      type: field.type,
      required: field.required,
      ...(field.unique ? { unique: true } : {}),
      ...(field.readOnly ? { readOnly: true } : {}),
      ...((field.type === "text" || field.type === "textarea") && optionalNumber(field.minLength) !== undefined
        ? { minLength: optionalNumber(field.minLength) }
        : {}),
      ...((field.type === "text" || field.type === "textarea") && optionalNumber(field.maxLength) !== undefined
        ? { maxLength: optionalNumber(field.maxLength) }
        : {}),
      ...(field.type === "number" && optionalNumber(field.minimum) !== undefined ? { minimum: optionalNumber(field.minimum) } : {}),
      ...(field.type === "number" && optionalNumber(field.maximum) !== undefined ? { maximum: optionalNumber(field.maximum) } : {}),
      ...(field.type === "number" && field.integer ? { integer: true } : {}),
      ...(field.type === "select" || field.type === "enum" ? { options: parseOptions(field.optionsSource) } : {}),
      ...((field.type === "select" || field.type === "enum" || field.type === "upload") && field.multiple ? { multiple: true } : {}),
      ...(field.type === "relation" ? {
        ...(field.relationId ? { relationId: field.relationId } : {}),
        targetCollectionId: field.targetCollectionId,
        cardinality: field.cardinality,
        onDelete: field.onDelete,
      } : {}),
      ...(field.type === "component" ? { componentId: field.componentId, multiple: field.multiple } : {}),
      ...(field.type === "blocks" ? { allowedComponentIds: commaValues(field.allowedComponentIds) } : {}),
      ...(field.type === "upload" && commaValues(field.acceptedMimeTypes).length
        ? { acceptedMimeTypes: commaValues(field.acceptedMimeTypes) }
        : {}),
      ...(field.type === "rich-text" && field.editor.trim() ? { editor: field.editor.trim() } : {}),
    })),
  };
}

function FieldAdvanced({ control, index, collectionOptions }: {
  readonly control: Control<SchemaFormValues>;
  readonly index: number;
  readonly collectionOptions: readonly { readonly value: string; readonly label: string }[];
}) {
  const type = useWatch({ control, name: `fields.${index}.type` });
  return (
    <div className={styles.schemaAdvancedGrid}>
      {(type === "text" || type === "textarea") ? (
        <>
          <Controller control={control} name={`fields.${index}.minLength`} render={({ field }) => <TextInput {...field} type="number" label="최소 길이" />} />
          <Controller control={control} name={`fields.${index}.maxLength`} render={({ field }) => <TextInput {...field} type="number" label="최대 길이" />} />
        </>
      ) : null}
      {type === "number" ? (
        <>
          <Controller control={control} name={`fields.${index}.minimum`} render={({ field }) => <TextInput {...field} type="number" label="최솟값" />} />
          <Controller control={control} name={`fields.${index}.maximum`} render={({ field }) => <TextInput {...field} type="number" label="최댓값" />} />
          <Controller control={control} name={`fields.${index}.integer`} render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>정수만 허용</CheckboxField>} />
        </>
      ) : null}
      {(type === "select" || type === "enum") ? (
        <>
          <Controller
            control={control}
            name={`fields.${index}.optionsSource`}
            rules={{ validate: (value) => parseOptions(value).length > 0 || "선택지를 한 개 이상 입력해 주세요." }}
            render={({ field, fieldState }) => (
              <TextAreaField {...field} label="선택지" description="한 줄에 value = 표시 이름 형식" rows={5} errorMessage={fieldState.error?.message} />
            )}
          />
          <Controller control={control} name={`fields.${index}.multiple`} render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>여러 값 허용</CheckboxField>} />
        </>
      ) : null}
      {type === "relation" ? (
        <>
          <Controller control={control} name={`fields.${index}.targetCollectionId`} rules={{ required: "대상 컬렉션을 선택해 주세요." }} render={({ field, fieldState }) => (
            collectionOptions.length ? (
              <SelectField {...field} label="대상 컬렉션" options={[{ value: "", label: "대상 선택" }, ...collectionOptions]} isRequired errorMessage={fieldState.error?.message} />
            ) : (
              <TextInput {...field} label="대상 컬렉션 stable ID" description="첫 컬렉션을 저장한 뒤 선택 목록을 사용할 수 있습니다." isRequired errorMessage={fieldState.error?.message} />
            )
          )} />
          <Controller control={control} name={`fields.${index}.cardinality`} render={({ field }) => (
            <SelectField {...field} label="카디널리티" options={[{ value: "one", label: "하나" }, { value: "many", label: "여러 개" }]} />
          )} />
          <Controller control={control} name={`fields.${index}.onDelete`} render={({ field }) => (
            <SelectField {...field} label="대상 삭제 시" options={[
              { value: "restrict", label: "삭제 차단" },
              { value: "nullify", label: "참조 제거" },
              { value: "cascade", label: "함께 삭제" },
            ]} />
          )} />
        </>
      ) : null}
      {type === "upload" ? (
        <>
          <Controller control={control} name={`fields.${index}.multiple`} render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>여러 파일 허용</CheckboxField>} />
          <Controller control={control} name={`fields.${index}.acceptedMimeTypes`} render={({ field }) => <TextInput {...field} label="허용 MIME" description="예: image/*, application/pdf" />} />
        </>
      ) : null}
      {type === "component" ? (
        <>
          <Controller control={control} name={`fields.${index}.componentId`} rules={{ required: "컴포넌트 ID를 입력해 주세요." }} render={({ field, fieldState }) => <TextInput {...field} label="컴포넌트 stable ID" isRequired errorMessage={fieldState.error?.message} />} />
          <Controller control={control} name={`fields.${index}.multiple`} render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>반복 가능</CheckboxField>} />
        </>
      ) : null}
      {type === "blocks" ? (
        <Controller control={control} name={`fields.${index}.allowedComponentIds`} render={({ field }) => <TextInput {...field} label="허용 컴포넌트 ID" description="쉼표로 구분합니다." />} />
      ) : null}
      {type === "rich-text" ? (
        <Controller control={control} name={`fields.${index}.editor`} render={({ field }) => <TextInput {...field} label="에디터 어댑터" placeholder="기본 portable editor" />} />
      ) : null}
      <Controller control={control} name={`fields.${index}.unique`} render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>고유 값</CheckboxField>} />
      <Controller control={control} name={`fields.${index}.readOnly`} render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>읽기 전용</CheckboxField>} />
    </div>
  );
}

export function SchemaEditorPage() {
  const api = useAdminApi();
  const { mode } = useDisplayMode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { collectionId } = useParams();
  const isNew = collectionId === undefined;
  const collectionQuery = useQuery({
    queryKey: queryKeys.collectionDraft(collectionId ?? "new"),
    queryFn: () => api.collections.get(collectionId!),
    enabled: !isNew,
  });
  const collections = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });
  const realms = useQuery({ queryKey: queryKeys.identityRealms, queryFn: () => api.identityRealms.list() });
  const diagnostics = useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: () => api.settings.diagnostics(),
  });
  const editable = diagnostics.data?.schemaMode === "editable";
  const [stableIdSaveActive, setStableIdSaveActive] = useState(false);
  const { control, handleSubmit, reset, setError, setValue, formState: { errors, isDirty } } = useForm<SchemaFormValues>({ defaultValues: toFormValues() });
  const { fields, append, remove } = useFieldArray({ control, name: "fields", keyName: "formKey" });
  const hierarchyEnabled = useWatch({ control, name: "hierarchyEnabled" });
  const ordering = useWatch({ control, name: "ordering" });
  const watchedValues = useWatch({ control }) as SchemaFormValues;
  const contentRealms = (realms.data?.items ?? []).filter(({ kind }) => kind === "content");
  const selectedRealm = contentRealms.find(({ realmKey }) =>
    realmKey === watchedValues.authRealmKey);
  const identifierCandidates = eligibleIdentifierFields(watchedValues);
  const authBlockingMessages = watchedValues.authEnabled ? [
    ...(realms.isPending ? ["Realm 목록을 불러오는 동안 인증 설정 저장을 잠시 기다려 주세요."] : []),
    ...authConfigurationMessages(watchedValues, contentRealms, collectionId, realms.isError),
  ] : [];
  // Deadlock: auth requires an identifier, an identifier needs a stable Field ID,
  // and a Field ID is only issued on save — but auth blocks the save. It resolves
  // the moment a required+unique text field exists but has not been saved yet, so
  // saving the fields once (without auth) breaks the cycle.
  const pendingIdentifierField = (watchedValues.fields ?? []).some((field) =>
    field.persistentId === null && field.type === "text" && field.required && field.unique);
  const identifierNeedsSave = watchedValues.authEnabled
    && identifierCandidates.length === 0
    && pendingIdentifierField;

  useEffect(() => {
    if (collectionQuery.data) reset(toFormValues(collectionQuery.data));
  }, [collectionQuery.data, reset]);

  const mutation = useMutation({
    mutationFn: async (values: SchemaFormValues) => {
      const normalizedNames = values.fields.map(({ name }) => name.trim());
      const duplicateIndex = normalizedNames.findIndex((name, index) => normalizedNames.indexOf(name) !== index);
      if (duplicateIndex >= 0) {
        setError(`fields.${duplicateIndex}.name`, { message: "같은 이름의 필드가 이미 있습니다." });
        throw new Error("DUPLICATE_FIELD_NAME");
      }
      const authIssues = [
        ...(realms.isPending ? ["Realm 목록을 불러오는 동안 인증 설정을 저장할 수 없습니다."] : []),
        ...authConfigurationMessages(values, contentRealms, collectionId, realms.isError),
      ];
      if (authIssues.length > 0) {
        setError("authRealmKey", { message: authIssues[0] });
        throw new Error("INVALID_AUTH_CONFIGURATION");
      }
      const draft = toDraft(values);
      return isNew
        ? api.collections.create(draft)
        : api.collections.updateDraft(collectionId, { draft, expectedDraftVersion: collectionQuery.data!.draftVersion });
    },
    onSuccess: async (collection) => {
      flushSync(() => reset(toFormValues(collection)));
      await queryClient.invalidateQueries({ queryKey: queryKeys.collections });
      queryClient.setQueryData(queryKeys.collectionDraft(collection.id), collection);
      navigate(`/admin/schema/${collection.id}/changes`);
    },
    onError: (error) => {
      const apiError = toAdminApiError(error);
      let shouldFocus = true;
      Object.entries(apiError.fieldErrors).forEach(([path, message]) => {
        const formPath = schemaIssuePathToFormPath(path);
        if (formPath !== null) {
          setError(formPath, { message }, { shouldFocus });
          shouldFocus = false;
        }
      });
    },
  });

  // Breaks the auth identifier deadlock: persist the fields with auth temporarily
  // omitted so the server issues stable Field IDs, then restore the auth settings
  // the operator had entered so they can pick the now-eligible identifier.
  const saveFieldsMutation = useMutation({
    mutationFn: async (values: SchemaFormValues) => {
      const normalizedNames = values.fields.map(({ name }) => name.trim());
      const duplicateIndex = normalizedNames.findIndex((name, index) => normalizedNames.indexOf(name) !== index);
      if (duplicateIndex >= 0) {
        setError(`fields.${duplicateIndex}.name`, { message: "같은 이름의 필드가 이미 있습니다." });
        throw new Error("DUPLICATE_FIELD_NAME");
      }
      const draft = toDraft({ ...values, authEnabled: false });
      const collection = isNew
        ? await api.collections.create(draft)
        : await api.collections.updateDraft(collectionId, { draft, expectedDraftVersion: collectionQuery.data!.draftVersion });
      return { collection, previousAuth: values };
    },
    onSuccess: async ({ collection, previousAuth }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.collections });
      queryClient.setQueryData(queryKeys.collectionDraft(collection.id), collection);
      if (isNew) {
        // A brand-new collection now has an ID; move onto its editable draft URL.
        navigate(`/admin/schema/${collection.id}`);
      }
      // Re-apply the fields (now carrying stable IDs) and restore the auth intent.
      flushSync(() => reset(toFormValues(collection)));
      setValue("authEnabled", true, { shouldDirty: true });
      setValue("authRealmKey", previousAuth.authRealmKey, { shouldDirty: true });
      setValue("authAcceptSystemIdentities", previousAuth.authAcceptSystemIdentities, { shouldDirty: true });
      setValue("authProvisioning", previousAuth.authProvisioning, { shouldDirty: true });
      setValue("authDefaultRoleIds", previousAuth.authDefaultRoleIds, { shouldDirty: true });
    },
    onError: (error) => {
      const apiError = toAdminApiError(error);
      let shouldFocus = true;
      Object.entries(apiError.fieldErrors).forEach(([path, message]) => {
        const formPath = schemaIssuePathToFormPath(path);
        if (formPath !== null) {
          setError(formPath, { message }, { shouldFocus });
          shouldFocus = false;
        }
      });
    },
    onSettled: () => setStableIdSaveActive(false),
  });

  const reloadLatest = async () => {
    const result = await collectionQuery.refetch();
    if (result.data) reset(toFormValues(result.data));
    mutation.reset();
  };
  const mutationError = mutation.isError ? toAdminApiError(mutation.error) : null;
  const isVersionConflict = mutationError?.status === 409 && mutationError.code === "SCHEMA_DRAFT_CONFLICT";
  // Every reason the "변경 사항 검토" button is disabled, surfaced next to it so
  // the operator never has to guess why nothing happens when it is greyed out.
  const authReviewBlockers = authBlockingMessages.length === 0
    ? []
    : displayModeAtLeast(mode, "advanced")
      ? authBlockingMessages
      : ["콘텐츠 계정 인증 설정에 해결할 항목이 있습니다. 상단 표시 모드를 Advanced로 전환해 확인해 주세요."];
  const reviewBlockers = [
    ...(diagnostics.isPending || editable ? [] : ["현재 스키마가 편집 불가 상태입니다. 활성 초안이 없거나 다른 작업이 진행 중일 수 있습니다."]),
    ...(mutation.isPending ? ["초안을 저장하는 중입니다."] : []),
    ...authReviewBlockers,
  ];
  const reviewDisabled = reviewBlockers.length > 0 || diagnostics.isPending;
  const collectionOptions = (collections.data?.items ?? []).map((item) => ({
    value: item.id,
    label: `${item.label || item.name} · ${item.id}`,
  }));

  if (!isNew && collectionQuery.isPending) return <Page><PageLoading label="스키마를 불러오는 중" /></Page>;
  if (!isNew && collectionQuery.isError) return <Page><LoadError error={collectionQuery.error} onRetry={() => void collectionQuery.refetch()} /></Page>;

  return (
    <Page>
      <PageHeader
        eyebrow="Schema builder"
        title={isNew ? "새 콘텐츠 타입" : `${collectionQuery.data?.label || collectionQuery.data?.name} 스키마`}
        description="간단한 필드는 시각 편집기로, 중첩 구조와 재사용 컴포넌트는 canonical manifest에서 완전히 제어할 수 있습니다."
        actions={<DisplayModeGate minimum="advanced"><Button variant="secondary" onPress={() => navigate("/admin/schema/tools")}>Manifest · TypeScript</Button></DisplayModeGate>}
      />
      {diagnostics.data && !editable ? (
        <Callout tone="warning">
          Schema mode가 <strong>{diagnostics.data.schemaMode}</strong>이므로 이 화면의 저장과 적용이 잠겨 있습니다.
        </Callout>
      ) : null}
      {isVersionConflict ? <ConflictNotice onReload={() => void reloadLatest()} /> : null}
      {mutationError && !isVersionConflict && mutationError.message !== "DUPLICATE_FIELD_NAME" && mutationError.message !== "INVALID_AUTH_CONFIGURATION" ? <LoadError error={mutationError} /> : null}
      {!displayModeAtLeast(mode, "advanced") && authBlockingMessages.length > 0 ? (
        <Callout tone="warning">
          숨겨진 콘텐츠 계정 인증 설정을 검토해야 합니다. 상단 표시 모드를
          <strong> Advanced</strong>로 전환해 문제를 확인해 주세요.
        </Callout>
      ) : null}
      <form className={styles.formStack} onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <section className={styles.card} aria-labelledby="collection-settings-heading">
          <SectionHeader id="collection-settings-heading" title="콘텐츠 타입 설정" description="API 식별자, 콘텐츠 유형과 계층 동작을 설정합니다." />
          <div className={styles.collectionIdentityGrid}>
            <Controller control={control} name="name" rules={{ required: "컬렉션 이름을 입력해 주세요.", pattern: { value: SCHEMA_NAME_PATTERN, message: SCHEMA_NAME_ERROR_MESSAGE } }} render={({ field: { ref, ...field }, fieldState }) => <TextInput inputRef={ref} label="이름" description="API와 저장소에서 유지되는 이름입니다." isRequired maxLength={64} errorMessage={fieldState.error?.message} {...field} />} />
            <Controller control={control} name="label" render={({ field: { ref, ...field } }) => <TextInput inputRef={ref} label="표시 이름" {...field} />} />
            <Controller control={control} name="kind" render={({ field }) => <SelectField {...field} label="유형" options={[{ value: "collection", label: "컬렉션 · 여러 문서" }, { value: "singleton", label: "싱글턴 · 문서 하나" }]} />} />
          </div>
          <DisplayModeGate minimum="standard"><div className={styles.hierarchyPanel}>
            <Controller control={control} name="hierarchyEnabled" render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>계층형 콘텐츠 사용</CheckboxField>} />
            {hierarchyEnabled ? (
              <div className={styles.settingsGrid}>
                <Controller control={control} name="maxDepth" rules={{ min: { value: 1, message: "1 이상의 깊이를 입력해 주세요." } }} render={({ field, fieldState }) => <TextInput {...field} type="number" label="최대 깊이" description="비우면 제한하지 않습니다." errorMessage={fieldState.error?.message} />} />
                <Controller control={control} name="ordering" render={({ field }) => <SelectField {...field} label="정렬 방식" options={[{ value: "manual", label: "수동 정렬" }, { value: "created-at", label: "생성일" }, { value: "field", label: "특정 필드" }]} />} />
                {ordering === "field" ? <Controller control={control} name="orderingFieldId" rules={{ required: "정렬 필드 stable ID를 입력해 주세요." }} render={({ field, fieldState }) => <TextInput {...field} label="정렬 필드 stable ID" isRequired errorMessage={fieldState.error?.message} />} /> : null}
                <Controller control={control} name="slugPath" render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>slug 경로 사용</CheckboxField>} />
                <Controller control={control} name="permissionInheritance" render={({ field }) => <CheckboxField isSelected={field.value} onChange={field.onChange}>부모 권한 상속</CheckboxField>} />
              </div>
            ) : null}
          </div></DisplayModeGate>
        </section>

        <DisplayModeGate minimum="advanced"><section className={styles.card} aria-labelledby="collection-auth-heading">
          <SectionHeader
            id="collection-auth-heading"
            title="콘텐츠 계정 인증"
            description="이 Collection을 사전에 생성된 Content Realm의 Profile과 로그인 identifier로 연결합니다."
          />
          <div className={styles.authPanel}>
            <Controller control={control} name="authEnabled" render={({ field }) => (
              <CheckboxField isSelected={field.value} onChange={field.onChange}>
                콘텐츠 계정 인증 사용
              </CheckboxField>
            )} />
            {watchedValues.authEnabled ? (
              <>
                {realms.isError ? (
                  <Callout tone="error">Realm 목록을 불러오지 못했습니다. Identity Realm 화면과 연결 상태를 확인해 주세요.</Callout>
                ) : null}
                {!realms.isPending && !realms.isError && contentRealms.length === 0 ? (
                  <Callout tone="warning">먼저 Identity Realm 화면에서 Content Realm을 생성해 주세요.</Callout>
                ) : null}
                <div className={styles.settingsGrid}>
                  <Controller
                    control={control}
                    name="authRealmKey"
                    render={({ field, fieldState }) => (
                      <SelectField
                        label="Content Realm"
                        description="Schema에는 Realm ID가 아니라 변경되지 않는 Realm key를 저장합니다."
                        value={field.value}
                        onChange={(realmKey) => {
                          field.onChange(realmKey);
                          const realm = contentRealms.find((candidate) =>
                            candidate.realmKey === realmKey);
                          if (realm !== undefined) {
                            setValue(
                              "authAcceptSystemIdentities",
                              realm.authentication.acceptSystemIdentities,
                              { shouldDirty: true },
                            );
                            setValue("authProvisioning", realm.authentication.provisioning, {
                              shouldDirty: true,
                            });
                            setValue(
                              "authDefaultRoleIds",
                              realm.authentication.defaultRoleIds.join(", "),
                              { shouldDirty: true },
                            );
                          }
                        }}
                        options={[
                          { value: "", label: realms.isPending ? "Realm 불러오는 중…" : "Realm 선택" },
                          ...contentRealms.map((realm) => ({
                            value: realm.realmKey,
                            label: `${realm.name} · ${realm.realmKey} · ${realm.status}`,
                          })),
                        ]}
                        isRequired
                        isDisabled={realms.isPending || realms.isError}
                        errorMessage={fieldState.error?.message}
                      />
                    )}
                  />
                  <Controller control={control} name="authProvisioning" render={({ field }) => (
                    <SelectField
                      {...field}
                      label="Membership provisioning"
                      options={[
                        { value: "explicit", label: "Explicit · 관리자 승인/초대" },
                        { value: "jit", label: "JIT · 첫 로그인 시 생성" },
                      ]}
                    />
                  )} />
                  <Controller control={control} name="authDefaultRoleIds" render={({ field }) => (
                    <TextInput
                      {...field}
                      label="기본 Realm Role ID"
                      description="Membership 활성화 시 Realm root scope에 부여할 Role ID를 쉼표로 구분합니다. 비우면 자동 권한이 없습니다."
                    />
                  )} />
                </div>
                <Controller control={control} name="authAcceptSystemIdentities" render={({ field }) => (
                  <CheckboxField isSelected={field.value} onChange={field.onChange}>
                    System Identity의 이 Realm 로그인 허용
                  </CheckboxField>
                )} />

                <div className={styles.authIdentifierSection}>
                  <div>
                    <h3>로그인 identifier</h3>
                    <p>최상위 required + unique text 필드만 선택할 수 있습니다.</p>
                  </div>
                  {identifierCandidates.length > 0 ? (
                    <Controller control={control} name="authIdentifierFieldIds" render={({ field }) => (
                      <div className={styles.authIdentifierList}>
                        {identifierCandidates.map((candidate) => {
                          const fieldId = candidate.persistentId!;
                          return (
                            <CheckboxField
                              key={fieldId}
                              isSelected={field.value.includes(fieldId)}
                              onChange={(selected) => field.onChange(selected
                                ? [...field.value, fieldId]
                                : field.value.filter((value) => value !== fieldId))}
                            >
                              {candidate.label || candidate.name} · {fieldId}
                            </CheckboxField>
                          );
                        })}
                      </div>
                    )} />
                  ) : (
                    <Callout tone="warning">
                      선택 가능한 필드가 없습니다. text 필드에 필수·고유 값 조건을 지정하고 초안을 한 번 저장해 stable ID를 발급해 주세요.
                    </Callout>
                  )}
                </div>

                {selectedRealm !== undefined ? (
                  <Callout tone="info">
                    가입 공개 여부는 Realm 설정이 source of truth입니다. 현재 <strong>{selectedRealm.authentication.registration === "open" ? "Open" : "Closed"}</strong>이며 이 Schema JSON에는 registration을 저장하지 않습니다. Realm의 현재 provisioning과 Role 설정은 선택 시 편집기에 복사되며 Schema 적용 단계에서 함께 검토됩니다.
                  </Callout>
                ) : null}
              </>
            ) : (
              <p className={styles.authHint}>비활성화하면 저장 JSON에서 `auth` 객체 전체를 생략합니다.</p>
            )}
          </div>
        </section></DisplayModeGate>

        <section className={styles.card} aria-labelledby="fields-heading">
          <SectionHeader id="fields-heading" title="필드" description="M2의 모든 필드 유형을 추가할 수 있습니다." actions={<Button type="button" variant="secondary" onPress={() => append(emptyField())}><Icon name="plus" size={16} />필드 추가</Button>} />
          {fields.map((field, index) => (
            <fieldset key={field.formKey} className={styles.fieldset} aria-label={`필드 ${index + 1}`}>
              <legend>필드 {index + 1}</legend>
              <div className={styles.fieldGrid}>
                <Controller control={control} name={`fields.${index}.name`} rules={{ required: "필드 이름을 입력해 주세요.", pattern: { value: SCHEMA_NAME_PATTERN, message: SCHEMA_NAME_ERROR_MESSAGE } }} render={({ field: { ref, ...input }, fieldState }) => <TextInput inputRef={ref} label="필드 이름" isRequired maxLength={64} errorMessage={fieldState.error?.message} {...input} />} />
                <Controller control={control} name={`fields.${index}.label`} render={({ field: { ref, ...input } }) => <TextInput inputRef={ref} label="필드 레이블" {...input} />} />
                <Controller control={control} name={`fields.${index}.type`} render={({ field: input }) => <SelectField label="필드 유형" options={fieldTypes} value={input.value} onChange={input.onChange} />} />
              </div>
              <div className={styles.fieldFooter}>
                <Controller control={control} name={`fields.${index}.required`} render={({ field: input }) => <CheckboxField isSelected={input.value} onChange={input.onChange}>필수 필드</CheckboxField>} />
                <Button type="button" variant="quiet" onPress={() => remove(index)} isDisabled={fields.length === 1}>필드 삭제</Button>
              </div>
              <details className={styles.advanced}>
                <summary>유형별 설정과 제약 조건</summary>
                <FieldAdvanced control={control} index={index} collectionOptions={collectionOptions} />
                <DisplayModeGate minimum="advanced"><code>Field ID: {field.persistentId ?? "초안 저장 시 서버가 발급"}{field.relationId ? ` · Relation ID: ${field.relationId}` : ""}</code></DisplayModeGate>
              </details>
            </fieldset>
          ))}
          <DisplayModeGate minimum="advanced">{collections.data?.items.length ? (
            <Callout tone="info">관계 대상 ID: {collections.data.items.map((item) => `${item.label || item.name} = ${item.id}`).join(" · ")}</Callout>
          ) : null}</DisplayModeGate>
          {errors.fields?.root?.message ? <Callout tone="error">{errors.fields.root.message}</Callout> : null}
        </section>
        {identifierNeedsSave ? (
          <Callout tone="info">
            <strong>로그인 identifier로 쓰려면 필드에 먼저 stable ID가 발급되어야 합니다.</strong>
            <p>필수·고유 text 필드는 준비됐지만, 인증(auth)이 켜져 있으면 identifier가 없어 저장이 막히고, 저장을 해야 stable ID가 생기는 교착 상태입니다. 아래 버튼으로 인증 설정을 잠시 빼고 필드만 저장해 stable ID를 발급받은 뒤, 돌아와서 identifier를 선택해 주세요.</p>
            <Button
              type="button"
              onPress={() => {
                flushSync(() => setStableIdSaveActive(true));
                void handleSubmit(
                  (values) => saveFieldsMutation.mutate(values),
                  () => setStableIdSaveActive(false),
                )();
              }}
              isDisabled={!editable || stableIdSaveActive || saveFieldsMutation.isPending}
            >
              {stableIdSaveActive || saveFieldsMutation.isPending ? "필드 저장 중…" : "필드 먼저 저장하고 ID 발급"}
            </Button>
          </Callout>
        ) : reviewBlockers.length > 0 ? (
          <Callout tone="warning">
            <strong>‘변경 사항 검토’를 진행하려면 먼저 아래를 해결해 주세요.</strong>
            <ul className={styles.reviewBlockers}>
              {reviewBlockers.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </Callout>
        ) : null}
        <div className={styles.schemaFormActions}>
          <Button type="submit" isDisabled={reviewDisabled}>{mutation.isPending ? "초안 저장 중…" : "변경 사항 검토"}</Button>
          <Button type="button" variant="secondary" isDisabled={mutation.isPending || stableIdSaveActive || saveFieldsMutation.isPending} onPress={() => navigate("/admin/schema")}>취소</Button>
        </div>
      </form>
      <UnsavedChangesGuard when={isDirty && !mutation.isPending && !stableIdSaveActive && !saveFieldsMutation.isPending} />
    </Page>
  );
}
