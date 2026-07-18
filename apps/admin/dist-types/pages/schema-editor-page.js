import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { flushSync } from "react-dom";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDefaultFieldRegistry, SCHEMA_NAME_ERROR_MESSAGE, SCHEMA_NAME_PATTERN, schemaIssuePathToFormPath, toAdminApiError, useAdminApi, } from "@xecms/admin";
import { Button, Callout, CheckboxField, SelectField, TextAreaField, TextInput } from "@xecms/ui";
import styles from "../app.module.css";
import { ConflictNotice, LoadError, PageLoading } from "../components/async-state.js";
import { Icon } from "../components/icon.js";
import { DisplayModeGate, displayModeAtLeast, useDisplayMode, } from "../display-mode.js";
import { Page, PageHeader, SectionHeader } from "../components/page.js";
import { UnsavedChangesGuard } from "../components/unsaved-guard.js";
import { queryKeys } from "../queries.js";
const fieldTypes = createDefaultFieldRegistry().list().map(({ type, label }) => ({ value: type, label }));
const emptyField = () => ({
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
function toFormValues(collection) {
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
function optionalNumber(value) {
    if (!value.trim())
        return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
function commaValues(source) {
    return source.split(",").map((item) => item.trim()).filter(Boolean);
}
function duplicateValue(values) {
    return values.find((value, index) => values.indexOf(value) !== index);
}
function eligibleIdentifierFields(values) {
    return values.fields.filter((field) => field.persistentId !== null
        && field.type === "text"
        && field.required
        && field.unique);
}
function authConfigurationMessages(values, realms, collectionId, realmListUnavailable) {
    if (!values.authEnabled)
        return [];
    const messages = [];
    const eligibleIds = new Set(eligibleIdentifierFields(values).flatMap(({ persistentId }) => persistentId === null ? [] : [persistentId]));
    const selectedRealm = realms.find(({ realmKey }) => realmKey === values.authRealmKey);
    if (values.kind === "singleton") {
        messages.push("싱글턴은 콘텐츠 계정 Profile Collection으로 사용할 수 없습니다.");
    }
    if (realmListUnavailable) {
        messages.push("Realm 목록을 확인할 수 없어 인증 설정을 저장할 수 없습니다.");
    }
    else if (!values.authRealmKey) {
        messages.push("먼저 생성된 Content Realm을 선택해 주세요.");
    }
    else if (selectedRealm === undefined || selectedRealm.kind !== "content") {
        messages.push("선택한 Realm key와 일치하는 Content Realm이 없습니다.");
    }
    else {
        if (selectedRealm.status === "disabled") {
            messages.push("비활성화된 Realm에는 Profile Collection을 연결할 수 없습니다.");
        }
        if (selectedRealm.profileCollectionId !== undefined
            && selectedRealm.profileCollectionId !== collectionId) {
            messages.push("선택한 Realm에는 이미 다른 Profile Collection이 연결되어 있습니다.");
        }
    }
    if (eligibleIds.size === 0) {
        messages.push("최상위 required + unique text 필드를 저장해 stable ID를 발급한 뒤 identifier로 선택해 주세요.");
    }
    else if (values.authIdentifierFieldIds.length === 0) {
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
function parseOptions(source) {
    return source.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.indexOf("=");
        const value = (separator < 0 ? line : line.slice(0, separator)).trim();
        const label = (separator < 0 ? line : line.slice(separator + 1)).trim();
        return { value, label: label || value };
    });
}
function toDraft(values) {
    const hierarchy = values.hierarchyEnabled ? {
        enabled: true,
        ...(optionalNumber(values.maxDepth) === undefined ? {} : { maxDepth: optionalNumber(values.maxDepth) }),
        ordering: values.ordering,
        ...(values.ordering === "field" && values.orderingFieldId.trim()
            ? { orderingFieldId: values.orderingFieldId.trim() }
            : {}),
        ...(values.slugPath ? { slugPath: true } : {}),
        permissionInheritance: values.permissionInheritance,
    } : undefined;
    const auth = values.authEnabled ? {
        enabled: true,
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
function FieldAdvanced({ control, index, collectionOptions }) {
    const type = useWatch({ control, name: `fields.${index}.type` });
    return (_jsxs("div", { className: styles.schemaAdvancedGrid, children: [(type === "text" || type === "textarea") ? (_jsxs(_Fragment, { children: [_jsx(Controller, { control: control, name: `fields.${index}.minLength`, render: ({ field }) => _jsx(TextInput, { ...field, type: "number", label: "\uCD5C\uC18C \uAE38\uC774" }) }), _jsx(Controller, { control: control, name: `fields.${index}.maxLength`, render: ({ field }) => _jsx(TextInput, { ...field, type: "number", label: "\uCD5C\uB300 \uAE38\uC774" }) })] })) : null, type === "number" ? (_jsxs(_Fragment, { children: [_jsx(Controller, { control: control, name: `fields.${index}.minimum`, render: ({ field }) => _jsx(TextInput, { ...field, type: "number", label: "\uCD5C\uC19F\uAC12" }) }), _jsx(Controller, { control: control, name: `fields.${index}.maximum`, render: ({ field }) => _jsx(TextInput, { ...field, type: "number", label: "\uCD5C\uB313\uAC12" }) }), _jsx(Controller, { control: control, name: `fields.${index}.integer`, render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uC815\uC218\uB9CC \uD5C8\uC6A9" }) })] })) : null, (type === "select" || type === "enum") ? (_jsxs(_Fragment, { children: [_jsx(Controller, { control: control, name: `fields.${index}.optionsSource`, rules: { validate: (value) => parseOptions(value).length > 0 || "선택지를 한 개 이상 입력해 주세요." }, render: ({ field, fieldState }) => (_jsx(TextAreaField, { ...field, label: "\uC120\uD0DD\uC9C0", description: "\uD55C \uC904\uC5D0 value = \uD45C\uC2DC \uC774\uB984 \uD615\uC2DD", rows: 5, errorMessage: fieldState.error?.message })) }), _jsx(Controller, { control: control, name: `fields.${index}.multiple`, render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uC5EC\uB7EC \uAC12 \uD5C8\uC6A9" }) })] })) : null, type === "relation" ? (_jsxs(_Fragment, { children: [_jsx(Controller, { control: control, name: `fields.${index}.targetCollectionId`, rules: { required: "대상 컬렉션을 선택해 주세요." }, render: ({ field, fieldState }) => (collectionOptions.length ? (_jsx(SelectField, { ...field, label: "\uB300\uC0C1 \uCEEC\uB809\uC158", options: [{ value: "", label: "대상 선택" }, ...collectionOptions], isRequired: true, errorMessage: fieldState.error?.message })) : (_jsx(TextInput, { ...field, label: "\uB300\uC0C1 \uCEEC\uB809\uC158 stable ID", description: "\uCCAB \uCEEC\uB809\uC158\uC744 \uC800\uC7A5\uD55C \uB4A4 \uC120\uD0DD \uBAA9\uB85D\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", isRequired: true, errorMessage: fieldState.error?.message }))) }), _jsx(Controller, { control: control, name: `fields.${index}.cardinality`, render: ({ field }) => (_jsx(SelectField, { ...field, label: "\uCE74\uB514\uB110\uB9AC\uD2F0", options: [{ value: "one", label: "하나" }, { value: "many", label: "여러 개" }] })) }), _jsx(Controller, { control: control, name: `fields.${index}.onDelete`, render: ({ field }) => (_jsx(SelectField, { ...field, label: "\uB300\uC0C1 \uC0AD\uC81C \uC2DC", options: [
                                { value: "restrict", label: "삭제 차단" },
                                { value: "nullify", label: "참조 제거" },
                                { value: "cascade", label: "함께 삭제" },
                            ] })) })] })) : null, type === "upload" ? (_jsxs(_Fragment, { children: [_jsx(Controller, { control: control, name: `fields.${index}.multiple`, render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uC5EC\uB7EC \uD30C\uC77C \uD5C8\uC6A9" }) }), _jsx(Controller, { control: control, name: `fields.${index}.acceptedMimeTypes`, render: ({ field }) => _jsx(TextInput, { ...field, label: "\uD5C8\uC6A9 MIME", description: "\uC608: image/*, application/pdf" }) })] })) : null, type === "component" ? (_jsxs(_Fragment, { children: [_jsx(Controller, { control: control, name: `fields.${index}.componentId`, rules: { required: "컴포넌트 ID를 입력해 주세요." }, render: ({ field, fieldState }) => _jsx(TextInput, { ...field, label: "\uCEF4\uD3EC\uB10C\uD2B8 stable ID", isRequired: true, errorMessage: fieldState.error?.message }) }), _jsx(Controller, { control: control, name: `fields.${index}.multiple`, render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uBC18\uBCF5 \uAC00\uB2A5" }) })] })) : null, type === "blocks" ? (_jsx(Controller, { control: control, name: `fields.${index}.allowedComponentIds`, render: ({ field }) => _jsx(TextInput, { ...field, label: "\uD5C8\uC6A9 \uCEF4\uD3EC\uB10C\uD2B8 ID", description: "\uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4." }) })) : null, type === "rich-text" ? (_jsx(Controller, { control: control, name: `fields.${index}.editor`, render: ({ field }) => _jsx(TextInput, { ...field, label: "\uC5D0\uB514\uD130 \uC5B4\uB311\uD130", placeholder: "\uAE30\uBCF8 portable editor" }) })) : null, _jsx(Controller, { control: control, name: `fields.${index}.unique`, render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uACE0\uC720 \uAC12" }) }), _jsx(Controller, { control: control, name: `fields.${index}.readOnly`, render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uC77D\uAE30 \uC804\uC6A9" }) })] }));
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
        queryFn: () => api.collections.get(collectionId),
        enabled: !isNew,
    });
    const collections = useQuery({ queryKey: queryKeys.collections, queryFn: () => api.collections.list() });
    const realms = useQuery({ queryKey: queryKeys.identityRealms, queryFn: () => api.identityRealms.list() });
    const diagnostics = useQuery({
        queryKey: queryKeys.diagnostics,
        queryFn: () => api.settings.diagnostics(),
    });
    const editable = diagnostics.data?.schemaMode === "editable";
    const { control, handleSubmit, reset, setError, setValue, formState: { errors, isDirty } } = useForm({ defaultValues: toFormValues() });
    const { fields, append, remove } = useFieldArray({ control, name: "fields", keyName: "formKey" });
    const hierarchyEnabled = useWatch({ control, name: "hierarchyEnabled" });
    const ordering = useWatch({ control, name: "ordering" });
    const watchedValues = useWatch({ control });
    const contentRealms = (realms.data?.items ?? []).filter(({ kind }) => kind === "content");
    const selectedRealm = contentRealms.find(({ realmKey }) => realmKey === watchedValues.authRealmKey);
    const identifierCandidates = eligibleIdentifierFields(watchedValues);
    const authBlockingMessages = watchedValues.authEnabled ? [
        ...(realms.isPending ? ["Realm 목록을 불러오는 동안 인증 설정 저장을 잠시 기다려 주세요."] : []),
        ...authConfigurationMessages(watchedValues, contentRealms, collectionId, realms.isError),
    ] : [];
    // Deadlock: auth requires an identifier, an identifier needs a stable Field ID,
    // and a Field ID is only issued on save — but auth blocks the save. It resolves
    // the moment a required+unique text field exists but has not been saved yet, so
    // saving the fields once (without auth) breaks the cycle.
    const pendingIdentifierField = (watchedValues.fields ?? []).some((field) => field.persistentId === null && field.type === "text" && field.required && field.unique);
    const identifierNeedsSave = watchedValues.authEnabled
        && identifierCandidates.length === 0
        && pendingIdentifierField;
    useEffect(() => {
        if (collectionQuery.data)
            reset(toFormValues(collectionQuery.data));
    }, [collectionQuery.data, reset]);
    const mutation = useMutation({
        mutationFn: async (values) => {
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
                : api.collections.updateDraft(collectionId, { draft, expectedDraftVersion: collectionQuery.data.draftVersion });
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
        mutationFn: async (values) => {
            const normalizedNames = values.fields.map(({ name }) => name.trim());
            const duplicateIndex = normalizedNames.findIndex((name, index) => normalizedNames.indexOf(name) !== index);
            if (duplicateIndex >= 0) {
                setError(`fields.${duplicateIndex}.name`, { message: "같은 이름의 필드가 이미 있습니다." });
                throw new Error("DUPLICATE_FIELD_NAME");
            }
            const draft = toDraft({ ...values, authEnabled: false });
            const collection = isNew
                ? await api.collections.create(draft)
                : await api.collections.updateDraft(collectionId, { draft, expectedDraftVersion: collectionQuery.data.draftVersion });
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
    });
    const reloadLatest = async () => {
        const result = await collectionQuery.refetch();
        if (result.data)
            reset(toFormValues(result.data));
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
    if (!isNew && collectionQuery.isPending)
        return _jsx(Page, { children: _jsx(PageLoading, { label: "\uC2A4\uD0A4\uB9C8\uB97C \uBD88\uB7EC\uC624\uB294 \uC911" }) });
    if (!isNew && collectionQuery.isError)
        return _jsx(Page, { children: _jsx(LoadError, { error: collectionQuery.error, onRetry: () => void collectionQuery.refetch() }) });
    return (_jsxs(Page, { children: [_jsx(PageHeader, { eyebrow: "Schema builder", title: isNew ? "새 콘텐츠 타입" : `${collectionQuery.data?.label || collectionQuery.data?.name} 스키마`, description: "\uAC04\uB2E8\uD55C \uD544\uB4DC\uB294 \uC2DC\uAC01 \uD3B8\uC9D1\uAE30\uB85C, \uC911\uCCA9 \uAD6C\uC870\uC640 \uC7AC\uC0AC\uC6A9 \uCEF4\uD3EC\uB10C\uD2B8\uB294 canonical manifest\uC5D0\uC11C \uC644\uC804\uD788 \uC81C\uC5B4\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", actions: _jsx(DisplayModeGate, { minimum: "advanced", children: _jsx(Button, { variant: "secondary", onPress: () => navigate("/admin/schema/tools"), children: "Manifest \u00B7 TypeScript" }) }) }), diagnostics.data && !editable ? (_jsxs(Callout, { tone: "warning", children: ["Schema mode\uAC00 ", _jsx("strong", { children: diagnostics.data.schemaMode }), "\uC774\uBBC0\uB85C \uC774 \uD654\uBA74\uC758 \uC800\uC7A5\uACFC \uC801\uC6A9\uC774 \uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4."] })) : null, isVersionConflict ? _jsx(ConflictNotice, { onReload: () => void reloadLatest() }) : null, mutationError && !isVersionConflict && mutationError.message !== "DUPLICATE_FIELD_NAME" && mutationError.message !== "INVALID_AUTH_CONFIGURATION" ? _jsx(LoadError, { error: mutationError }) : null, !displayModeAtLeast(mode, "advanced") && authBlockingMessages.length > 0 ? (_jsxs(Callout, { tone: "warning", children: ["\uC228\uACA8\uC9C4 \uCF58\uD150\uCE20 \uACC4\uC815 \uC778\uC99D \uC124\uC815\uC744 \uAC80\uD1A0\uD574\uC57C \uD569\uB2C8\uB2E4. \uC0C1\uB2E8 \uD45C\uC2DC \uBAA8\uB4DC\uB97C", _jsx("strong", { children: " Advanced" }), "\uB85C \uC804\uD658\uD574 \uBB38\uC81C\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694."] })) : null, _jsxs("form", { className: styles.formStack, onSubmit: handleSubmit((values) => mutation.mutate(values)), children: [_jsxs("section", { className: styles.card, "aria-labelledby": "collection-settings-heading", children: [_jsx(SectionHeader, { id: "collection-settings-heading", title: "\uCF58\uD150\uCE20 \uD0C0\uC785 \uC124\uC815", description: "API \uC2DD\uBCC4\uC790, \uCF58\uD150\uCE20 \uC720\uD615\uACFC \uACC4\uCE35 \uB3D9\uC791\uC744 \uC124\uC815\uD569\uB2C8\uB2E4." }), _jsxs("div", { className: styles.collectionIdentityGrid, children: [_jsx(Controller, { control: control, name: "name", rules: { required: "컬렉션 이름을 입력해 주세요.", pattern: { value: SCHEMA_NAME_PATTERN, message: SCHEMA_NAME_ERROR_MESSAGE } }, render: ({ field: { ref, ...field }, fieldState }) => _jsx(TextInput, { inputRef: ref, label: "\uC774\uB984", description: "API\uC640 \uC800\uC7A5\uC18C\uC5D0\uC11C \uC720\uC9C0\uB418\uB294 \uC774\uB984\uC785\uB2C8\uB2E4.", isRequired: true, maxLength: 64, errorMessage: fieldState.error?.message, ...field }) }), _jsx(Controller, { control: control, name: "label", render: ({ field: { ref, ...field } }) => _jsx(TextInput, { inputRef: ref, label: "\uD45C\uC2DC \uC774\uB984", ...field }) }), _jsx(Controller, { control: control, name: "kind", render: ({ field }) => _jsx(SelectField, { ...field, label: "\uC720\uD615", options: [{ value: "collection", label: "컬렉션 · 여러 문서" }, { value: "singleton", label: "싱글턴 · 문서 하나" }] }) })] }), _jsx(DisplayModeGate, { minimum: "standard", children: _jsxs("div", { className: styles.hierarchyPanel, children: [_jsx(Controller, { control: control, name: "hierarchyEnabled", render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uACC4\uCE35\uD615 \uCF58\uD150\uCE20 \uC0AC\uC6A9" }) }), hierarchyEnabled ? (_jsxs("div", { className: styles.settingsGrid, children: [_jsx(Controller, { control: control, name: "maxDepth", rules: { min: { value: 1, message: "1 이상의 깊이를 입력해 주세요." } }, render: ({ field, fieldState }) => _jsx(TextInput, { ...field, type: "number", label: "\uCD5C\uB300 \uAE4A\uC774", description: "\uBE44\uC6B0\uBA74 \uC81C\uD55C\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", errorMessage: fieldState.error?.message }) }), _jsx(Controller, { control: control, name: "ordering", render: ({ field }) => _jsx(SelectField, { ...field, label: "\uC815\uB82C \uBC29\uC2DD", options: [{ value: "manual", label: "수동 정렬" }, { value: "created-at", label: "생성일" }, { value: "field", label: "특정 필드" }] }) }), ordering === "field" ? _jsx(Controller, { control: control, name: "orderingFieldId", rules: { required: "정렬 필드 stable ID를 입력해 주세요." }, render: ({ field, fieldState }) => _jsx(TextInput, { ...field, label: "\uC815\uB82C \uD544\uB4DC stable ID", isRequired: true, errorMessage: fieldState.error?.message }) }) : null, _jsx(Controller, { control: control, name: "slugPath", render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "slug \uACBD\uB85C \uC0AC\uC6A9" }) }), _jsx(Controller, { control: control, name: "permissionInheritance", render: ({ field }) => _jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uBD80\uBAA8 \uAD8C\uD55C \uC0C1\uC18D" }) })] })) : null] }) })] }), _jsx(DisplayModeGate, { minimum: "advanced", children: _jsxs("section", { className: styles.card, "aria-labelledby": "collection-auth-heading", children: [_jsx(SectionHeader, { id: "collection-auth-heading", title: "\uCF58\uD150\uCE20 \uACC4\uC815 \uC778\uC99D", description: "\uC774 Collection\uC744 \uC0AC\uC804\uC5D0 \uC0DD\uC131\uB41C Content Realm\uC758 Profile\uACFC \uB85C\uADF8\uC778 identifier\uB85C \uC5F0\uACB0\uD569\uB2C8\uB2E4." }), _jsxs("div", { className: styles.authPanel, children: [_jsx(Controller, { control: control, name: "authEnabled", render: ({ field }) => (_jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "\uCF58\uD150\uCE20 \uACC4\uC815 \uC778\uC99D \uC0AC\uC6A9" })) }), watchedValues.authEnabled ? (_jsxs(_Fragment, { children: [realms.isError ? (_jsx(Callout, { tone: "error", children: "Realm \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. Identity Realm \uD654\uBA74\uACFC \uC5F0\uACB0 \uC0C1\uD0DC\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." })) : null, !realms.isPending && !realms.isError && contentRealms.length === 0 ? (_jsx(Callout, { tone: "warning", children: "\uBA3C\uC800 Identity Realm \uD654\uBA74\uC5D0\uC11C Content Realm\uC744 \uC0DD\uC131\uD574 \uC8FC\uC138\uC694." })) : null, _jsxs("div", { className: styles.settingsGrid, children: [_jsx(Controller, { control: control, name: "authRealmKey", render: ({ field, fieldState }) => (_jsx(SelectField, { label: "Content Realm", description: "Schema\uC5D0\uB294 Realm ID\uAC00 \uC544\uB2C8\uB77C \uBCC0\uACBD\uB418\uC9C0 \uC54A\uB294 Realm key\uB97C \uC800\uC7A5\uD569\uB2C8\uB2E4.", value: field.value, onChange: (realmKey) => {
                                                                    field.onChange(realmKey);
                                                                    const realm = contentRealms.find((candidate) => candidate.realmKey === realmKey);
                                                                    if (realm !== undefined) {
                                                                        setValue("authAcceptSystemIdentities", realm.authentication.acceptSystemIdentities, { shouldDirty: true });
                                                                        setValue("authProvisioning", realm.authentication.provisioning, {
                                                                            shouldDirty: true,
                                                                        });
                                                                        setValue("authDefaultRoleIds", realm.authentication.defaultRoleIds.join(", "), { shouldDirty: true });
                                                                    }
                                                                }, options: [
                                                                    { value: "", label: realms.isPending ? "Realm 불러오는 중…" : "Realm 선택" },
                                                                    ...contentRealms.map((realm) => ({
                                                                        value: realm.realmKey,
                                                                        label: `${realm.name} · ${realm.realmKey} · ${realm.status}`,
                                                                    })),
                                                                ], isRequired: true, isDisabled: realms.isPending || realms.isError, errorMessage: fieldState.error?.message })) }), _jsx(Controller, { control: control, name: "authProvisioning", render: ({ field }) => (_jsx(SelectField, { ...field, label: "Membership provisioning", options: [
                                                                    { value: "explicit", label: "Explicit · 관리자 승인/초대" },
                                                                    { value: "jit", label: "JIT · 첫 로그인 시 생성" },
                                                                ] })) }), _jsx(Controller, { control: control, name: "authDefaultRoleIds", render: ({ field }) => (_jsx(TextInput, { ...field, label: "\uAE30\uBCF8 Realm Role ID", description: "Membership \uD65C\uC131\uD654 \uC2DC Realm root scope\uC5D0 \uBD80\uC5EC\uD560 Role ID\uB97C \uC27C\uD45C\uB85C \uAD6C\uBD84\uD569\uB2C8\uB2E4. \uBE44\uC6B0\uBA74 \uC790\uB3D9 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." })) })] }), _jsx(Controller, { control: control, name: "authAcceptSystemIdentities", render: ({ field }) => (_jsx(CheckboxField, { isSelected: field.value, onChange: field.onChange, children: "System Identity\uC758 \uC774 Realm \uB85C\uADF8\uC778 \uD5C8\uC6A9" })) }), _jsxs("div", { className: styles.authIdentifierSection, children: [_jsxs("div", { children: [_jsx("h3", { children: "\uB85C\uADF8\uC778 identifier" }), _jsx("p", { children: "\uCD5C\uC0C1\uC704 required + unique text \uD544\uB4DC\uB9CC \uC120\uD0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })] }), identifierCandidates.length > 0 ? (_jsx(Controller, { control: control, name: "authIdentifierFieldIds", render: ({ field }) => (_jsx("div", { className: styles.authIdentifierList, children: identifierCandidates.map((candidate) => {
                                                                    const fieldId = candidate.persistentId;
                                                                    return (_jsxs(CheckboxField, { isSelected: field.value.includes(fieldId), onChange: (selected) => field.onChange(selected
                                                                            ? [...field.value, fieldId]
                                                                            : field.value.filter((value) => value !== fieldId)), children: [candidate.label || candidate.name, " \u00B7 ", fieldId] }, fieldId));
                                                                }) })) })) : (_jsx(Callout, { tone: "warning", children: "\uC120\uD0DD \uAC00\uB2A5\uD55C \uD544\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. text \uD544\uB4DC\uC5D0 \uD544\uC218\u00B7\uACE0\uC720 \uAC12 \uC870\uAC74\uC744 \uC9C0\uC815\uD558\uACE0 \uCD08\uC548\uC744 \uD55C \uBC88 \uC800\uC7A5\uD574 stable ID\uB97C \uBC1C\uAE09\uD574 \uC8FC\uC138\uC694." }))] }), selectedRealm !== undefined ? (_jsxs(Callout, { tone: "info", children: ["\uAC00\uC785 \uACF5\uAC1C \uC5EC\uBD80\uB294 Realm \uC124\uC815\uC774 source of truth\uC785\uB2C8\uB2E4. \uD604\uC7AC ", _jsx("strong", { children: selectedRealm.authentication.registration === "open" ? "Open" : "Closed" }), "\uC774\uBA70 \uC774 Schema JSON\uC5D0\uB294 registration\uC744 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. Realm\uC758 \uD604\uC7AC provisioning\uACFC Role \uC124\uC815\uC740 \uC120\uD0DD \uC2DC \uD3B8\uC9D1\uAE30\uC5D0 \uBCF5\uC0AC\uB418\uBA70 Schema \uC801\uC6A9 \uB2E8\uACC4\uC5D0\uC11C \uD568\uAED8 \uAC80\uD1A0\uB429\uB2C8\uB2E4."] })) : null] })) : (_jsx("p", { className: styles.authHint, children: "\uBE44\uD65C\uC131\uD654\uD558\uBA74 \uC800\uC7A5 JSON\uC5D0\uC11C `auth` \uAC1D\uCCB4 \uC804\uCCB4\uB97C \uC0DD\uB7B5\uD569\uB2C8\uB2E4." }))] })] }) }), _jsxs("section", { className: styles.card, "aria-labelledby": "fields-heading", children: [_jsx(SectionHeader, { id: "fields-heading", title: "\uD544\uB4DC", description: "M2\uC758 \uBAA8\uB4E0 \uD544\uB4DC \uC720\uD615\uC744 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", actions: _jsxs(Button, { type: "button", variant: "secondary", onPress: () => append(emptyField()), children: [_jsx(Icon, { name: "plus", size: 16 }), "\uD544\uB4DC \uCD94\uAC00"] }) }), fields.map((field, index) => (_jsxs("fieldset", { className: styles.fieldset, "aria-label": `필드 ${index + 1}`, children: [_jsxs("legend", { children: ["\uD544\uB4DC ", index + 1] }), _jsxs("div", { className: styles.fieldGrid, children: [_jsx(Controller, { control: control, name: `fields.${index}.name`, rules: { required: "필드 이름을 입력해 주세요.", pattern: { value: SCHEMA_NAME_PATTERN, message: SCHEMA_NAME_ERROR_MESSAGE } }, render: ({ field: { ref, ...input }, fieldState }) => _jsx(TextInput, { inputRef: ref, label: "\uD544\uB4DC \uC774\uB984", isRequired: true, maxLength: 64, errorMessage: fieldState.error?.message, ...input }) }), _jsx(Controller, { control: control, name: `fields.${index}.label`, render: ({ field: { ref, ...input } }) => _jsx(TextInput, { inputRef: ref, label: "\uD544\uB4DC \uB808\uC774\uBE14", ...input }) }), _jsx(Controller, { control: control, name: `fields.${index}.type`, render: ({ field: input }) => _jsx(SelectField, { label: "\uD544\uB4DC \uC720\uD615", options: fieldTypes, value: input.value, onChange: input.onChange }) })] }), _jsxs("div", { className: styles.fieldFooter, children: [_jsx(Controller, { control: control, name: `fields.${index}.required`, render: ({ field: input }) => _jsx(CheckboxField, { isSelected: input.value, onChange: input.onChange, children: "\uD544\uC218 \uD544\uB4DC" }) }), _jsx(Button, { type: "button", variant: "quiet", onPress: () => remove(index), isDisabled: fields.length === 1, children: "\uD544\uB4DC \uC0AD\uC81C" })] }), _jsxs("details", { className: styles.advanced, children: [_jsx("summary", { children: "\uC720\uD615\uBCC4 \uC124\uC815\uACFC \uC81C\uC57D \uC870\uAC74" }), _jsx(FieldAdvanced, { control: control, index: index, collectionOptions: collectionOptions }), _jsx(DisplayModeGate, { minimum: "advanced", children: _jsxs("code", { children: ["Field ID: ", field.persistentId ?? "초안 저장 시 서버가 발급", field.relationId ? ` · Relation ID: ${field.relationId}` : ""] }) })] })] }, field.formKey))), _jsx(DisplayModeGate, { minimum: "advanced", children: collections.data?.items.length ? (_jsxs(Callout, { tone: "info", children: ["\uAD00\uACC4 \uB300\uC0C1 ID: ", collections.data.items.map((item) => `${item.label || item.name} = ${item.id}`).join(" · ")] })) : null }), errors.fields?.root?.message ? _jsx(Callout, { tone: "error", children: errors.fields.root.message }) : null] }), identifierNeedsSave ? (_jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "\uB85C\uADF8\uC778 identifier\uB85C \uC4F0\uB824\uBA74 \uD544\uB4DC\uC5D0 \uBA3C\uC800 stable ID\uAC00 \uBC1C\uAE09\uB418\uC5B4\uC57C \uD569\uB2C8\uB2E4." }), _jsx("p", { children: "\uD544\uC218\u00B7\uACE0\uC720 text \uD544\uB4DC\uB294 \uC900\uBE44\uB410\uC9C0\uB9CC, \uC778\uC99D(auth)\uC774 \uCF1C\uC838 \uC788\uC73C\uBA74 identifier\uAC00 \uC5C6\uC5B4 \uC800\uC7A5\uC774 \uB9C9\uD788\uACE0, \uC800\uC7A5\uC744 \uD574\uC57C stable ID\uAC00 \uC0DD\uAE30\uB294 \uAD50\uCC29 \uC0C1\uD0DC\uC785\uB2C8\uB2E4. \uC544\uB798 \uBC84\uD2BC\uC73C\uB85C \uC778\uC99D \uC124\uC815\uC744 \uC7A0\uC2DC \uBE7C\uACE0 \uD544\uB4DC\uB9CC \uC800\uC7A5\uD574 stable ID\uB97C \uBC1C\uAE09\uBC1B\uC740 \uB4A4, \uB3CC\uC544\uC640\uC11C identifier\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694." }), _jsx(Button, { type: "button", onPress: () => void handleSubmit((values) => saveFieldsMutation.mutate(values))(), isDisabled: !editable || saveFieldsMutation.isPending, children: saveFieldsMutation.isPending ? "필드 저장 중…" : "필드 먼저 저장하고 ID 발급" })] })) : reviewBlockers.length > 0 ? (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\u2018\uBCC0\uACBD \uC0AC\uD56D \uAC80\uD1A0\u2019\uB97C \uC9C4\uD589\uD558\uB824\uBA74 \uBA3C\uC800 \uC544\uB798\uB97C \uD574\uACB0\uD574 \uC8FC\uC138\uC694." }), _jsx("ul", { className: styles.reviewBlockers, children: reviewBlockers.map((reason) => _jsx("li", { children: reason }, reason)) })] })) : null, _jsxs("div", { className: styles.schemaFormActions, children: [_jsx(Button, { type: "submit", isDisabled: reviewDisabled, children: mutation.isPending ? "초안 저장 중…" : "변경 사항 검토" }), _jsx(Button, { type: "button", variant: "secondary", isDisabled: mutation.isPending, onPress: () => navigate("/admin/schema"), children: "\uCDE8\uC18C" })] })] }), _jsx(UnsavedChangesGuard, { when: isDirty && !mutation.isPending })] }));
}
//# sourceMappingURL=schema-editor-page.js.map