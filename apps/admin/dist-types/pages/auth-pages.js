import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, CheckboxField, LoadingIndicator, TextInput } from "@xecms/ui";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import { STARTER_TEMPLATES, starterSchema, starterTemplate } from "@xecms/schema";
import { Icon } from "../components/icon.js";
import styles from "../auth.module.css";
import { queryKeys } from "../queries.js";
function defaultCollectionLabel(collection) {
    return collection.label ?? collection.name;
}
function AuthLayout({ title, description, children, wide = false }) {
    return (_jsxs("main", { className: styles.authPage, children: [_jsxs("aside", { className: styles.authVisual, "aria-label": "XeCMS Admin Studio \uC18C\uAC1C", children: [_jsxs("div", { className: styles.visualBrand, children: [_jsx("span", { className: styles.brandMark, "aria-hidden": "true", children: "Xe" }), _jsx("span", { className: styles.brandName, children: "XeCMS Admin Studio" })] }), _jsxs("div", { className: styles.visualContent, children: [_jsx("span", { className: styles.visualEyebrow, children: "Structured content workspace" }), _jsx("h2", { children: "\uCF58\uD150\uCE20\uC758 \uAD6C\uC870\uC640 \uC6B4\uC601\uC744 \uD55C\uACF3\uC5D0\uC11C." }), _jsx("p", { children: "\uC2A4\uD0A4\uB9C8 \uC124\uACC4\uBD80\uD130 \uCF58\uD150\uCE20 \uAD00\uB9AC\uAE4C\uC9C0, \uAC1C\uBC1C\uC790\uC5D0\uAC8C \uD544\uC694\uD55C \uD750\uB984\uC744 \uBA85\uD655\uD558\uACE0 \uC548\uC804\uD558\uAC8C \uC5F0\uACB0\uD569\uB2C8\uB2E4." }), _jsxs("ul", { className: styles.featureList, children: [_jsxs("li", { children: [_jsx("span", { className: styles.featureIcon, children: _jsx(Icon, { name: "schema", size: 16 }) }), "\uC608\uCE21 \uAC00\uB2A5\uD55C \uC2A4\uD0A4\uB9C8 \uC124\uACC4"] }), _jsxs("li", { children: [_jsx("span", { className: styles.featureIcon, children: _jsx(Icon, { name: "database", size: 16 }) }), "\uAC80\uD1A0 \uAC00\uB2A5\uD55C \uB370\uC774\uD130\uBCA0\uC774\uC2A4 \uBCC0\uACBD"] }), _jsxs("li", { children: [_jsx("span", { className: styles.featureIcon, children: _jsx(Icon, { name: "shield", size: 16 }) }), "\uC6B4\uC601 \uACBD\uACC4\uB97C \uC9C0\uD0A4\uB294 \uC548\uC804\uD55C \uAE30\uBCF8\uAC12"] })] })] }), _jsx("span", { className: styles.visualFooter, children: "XeCMS \u00B7 Developer-first content management" })] }), _jsx("div", { className: styles.authContent, children: _jsxs("section", { className: `${styles.authCard} ${wide ? styles.authCardWide : ""}`, children: [_jsxs("header", { className: styles.authHeader, children: [_jsx("p", { className: styles.authEyebrow, children: "Workspace access" }), _jsx("h1", { children: title }), _jsx("p", { className: styles.muted, children: description })] }), children, _jsxs("footer", { className: styles.authFootnote, children: [_jsx(Icon, { name: "shield", size: 15 }), _jsx("span", { children: "\uBCF4\uD638\uB41C \uC138\uC158\uC73C\uB85C Admin Workspace\uC5D0 \uC5F0\uACB0\uD569\uB2C8\uB2E4." })] })] }) })] }));
}
export function SetupPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const status = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => api.auth.getBootstrapStatus() });
    const session = useQuery({
        queryKey: queryKeys.session,
        queryFn: () => api.auth.getSession(),
        enabled: status.data?.required === false,
        retry: false,
    });
    const [step, setStep] = useState("account");
    const [selectedStarter, setSelectedStarter] = useState("minimal");
    const [enabledModuleIds, setEnabledModuleIds] = useState([]);
    const [collectionLabels, setCollectionLabels] = useState({});
    const { control, handleSubmit, watch, setError, setFocus } = useForm({
        defaultValues: { username: "", password: "", passwordConfirmation: "" },
    });
    const mutation = useMutation({
        mutationFn: ({ username, password }) => api.auth.bootstrap({ username, password }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
                queryClient.invalidateQueries({ queryKey: queryKeys.session }),
            ]);
            setStep("template");
        },
        onError: (error) => {
            const apiError = toAdminApiError(error);
            let focused = false;
            Object.entries(apiError.fieldErrors).forEach(([path, message]) => {
                if (path.endsWith("username")) {
                    setError("username", { message }, { shouldFocus: !focused });
                    focused = true;
                }
                else if (path.endsWith("password")) {
                    setError("password", { message }, { shouldFocus: !focused });
                    focused = true;
                }
            });
            if (!focused)
                setFocus("username");
        },
    });
    const applyTemplate = useMutation({
        mutationFn: () => api.auth.applySetupTemplate({
            starter: selectedStarter,
            enabledModuleIds,
            collectionLabels: Object.fromEntries(starterSchema(selectedStarter, { enabledModuleIds }).collections.map((collection) => [
                String(collection.id),
                collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection),
            ])),
        }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
                queryClient.invalidateQueries({ queryKey: queryKeys.session }),
            ]);
            navigate("/admin/schema", { replace: true });
        },
    });
    useEffect(() => {
        if (status.data?.required === false && status.data.templateRequired && session.data?.user) {
            setStep((current) => current === "account" ? "template" : current);
        }
    }, [session.data?.user, status.data?.required, status.data?.templateRequired]);
    if (status.isPending)
        return _jsx(AuthLayout, { title: "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", description: "XeCMS\uB97C \uC900\uBE44\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.", children: _jsx(LoadingIndicator, {}) });
    if (status.isError)
        return _jsx(AuthLayout, { title: "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", description: "\uC11C\uBC84 \uC5F0\uACB0\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", children: _jsx(Callout, { tone: "error", children: toAdminApiError(status.error).message }) });
    if (!status.data.required && session.isPending)
        return _jsx(AuthLayout, { title: "\uCD08\uAE30 \uC124\uC815 \uACC4\uC18D\uD558\uAE30", description: "\uC124\uC815 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.", children: _jsx(LoadingIndicator, {}) });
    if (!status.data.required && session.data?.user === null)
        return _jsx(Navigate, { to: "/admin/login", replace: true });
    if (!status.data.templateRequired)
        return _jsx(Navigate, { to: "/admin/schema", replace: true });
    const apiError = mutation.isError ? toAdminApiError(mutation.error) : null;
    const selectedTemplate = starterTemplate(selectedStarter);
    const previewSchema = starterSchema(selectedStarter, { enabledModuleIds });
    const labelsValid = previewSchema.collections.every((collection) => {
        const value = collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection);
        return value.trim().length >= 1 && value.trim().length <= 80;
    });
    const steps = ["관리자 계정", "템플릿 선택", "간단 커스텀", "확인 및 적용"];
    const currentStep = { account: 0, template: 1, customize: 2, review: 3 }[step];
    const chooseStarter = (starter) => {
        const template = starterTemplate(starter);
        setSelectedStarter(starter);
        setEnabledModuleIds(template.modules.filter(({ defaultEnabled }) => defaultEnabled).map(({ id }) => id));
        setCollectionLabels({});
    };
    return (_jsxs(AuthLayout, { wide: true, title: "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", description: "\uAD00\uB9AC\uC790 \uACC4\uC815\uACFC \uCCAB \uCF58\uD150\uCE20 \uAD6C\uC870\uB97C \uB2E8\uACC4\uBCC4\uB85C \uAD6C\uC131\uD569\uB2C8\uB2E4.", children: [_jsx("ol", { className: styles.setupProgress, "aria-label": "\uCD08\uAE30 \uC124\uC815 \uC9C4\uD589 \uB2E8\uACC4", children: steps.map((label, index) => _jsxs("li", { "data-state": index < currentStep ? "done" : index === currentStep ? "current" : "todo", children: [_jsx("span", { children: index < currentStep ? "✓" : index + 1 }), _jsx("strong", { children: label })] }, label)) }), step === "account" ? _jsxs(_Fragment, { children: [apiError ? _jsx(Callout, { tone: "error", children: apiError.message }) : null, _jsxs("form", { "aria-label": "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", className: styles.form, onSubmit: handleSubmit((values) => mutation.mutate(values)), children: [_jsx(Controller, { control: control, name: "username", rules: { required: "사용자 이름을 입력해 주세요." }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uC0AC\uC6A9\uC790 \uC774\uB984", autoComplete: "username", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "password", rules: {
                                    required: "비밀번호를 입력해 주세요.",
                                    minLength: { value: 12, message: "비밀번호는 12자 이상이어야 합니다." },
                                    maxLength: { value: 128, message: "비밀번호는 128자 이하여야 합니다." },
                                }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", isRequired: true, description: "12\uC790 \uC774\uC0C1 128\uC790 \uC774\uD558\uC758 \uACE0\uC720\uD55C \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.", errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "passwordConfirmation", rules: {
                                    required: "비밀번호를 다시 입력해 주세요.",
                                    validate: (value) => value === watch("password") || "비밀번호가 일치하지 않습니다.",
                                }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uBE44\uBC00\uBC88\uD638 \uD655\uC778", type: "password", autoComplete: "new-password", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Button, { type: "submit", isDisabled: mutation.isPending, children: mutation.isPending ? "생성 중…" : "관리자 생성 후 계속" })] })] }) : null, step === "template" ? _jsxs("div", { className: styles.setupBody, children: [_jsx("div", { className: styles.templateGrid, children: STARTER_TEMPLATES.map((template) => _jsxs("button", { type: "button", className: styles.templateCard, "data-selected": selectedStarter === template.id, "aria-pressed": selectedStarter === template.id, onClick: () => chooseStarter(template.id), children: [_jsx("span", { className: styles.templateMark, children: template.id === "minimal" ? "＋" : template.id === "blog" ? "B" : "C" }), _jsx("strong", { children: template.label }), _jsx("small", { children: template.description })] }, template.id)) }), _jsx("div", { className: styles.setupActions, children: _jsx(Button, { onPress: () => setStep("customize"), children: "\uC774 \uD15C\uD50C\uB9BF\uC73C\uB85C \uACC4\uC18D" }) })] }) : null, step === "customize" ? _jsxs("div", { className: styles.setupBody, children: [_jsxs("div", { className: styles.customizeSection, children: [_jsxs("h2", { children: [selectedTemplate.label, " \uAD6C\uC131"] }), selectedTemplate.modules.length === 0
                                ? _jsx(Callout, { tone: "info", children: "\uBE48 \uD504\uB85C\uC81D\uD2B8\uB294 \uC120\uD0DD \uAE30\uB2A5 \uC5C6\uC774 \uC2DC\uC791\uD569\uB2C8\uB2E4. \uC124\uCE58 \uD6C4 Schema \uD3B8\uC9D1\uAE30\uC5D0\uC11C \uCEEC\uB809\uC158\uC744 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })
                                : _jsx("div", { className: styles.moduleList, children: selectedTemplate.modules.map((module) => _jsxs("div", { className: styles.moduleOption, children: [_jsx(CheckboxField, { isSelected: enabledModuleIds.includes(module.id), onChange: (selected) => setEnabledModuleIds((current) => selected
                                                    ? [...current, module.id]
                                                    : current.filter((id) => id !== module.id)), children: _jsx("strong", { children: module.label }) }), _jsx("p", { children: module.description })] }, module.id)) })] }), previewSchema.collections.length > 0 ? _jsxs("div", { className: styles.customizeSection, children: [_jsx("h2", { children: "\uCEEC\uB809\uC158 \uD45C\uC2DC \uC774\uB984" }), _jsx("p", { children: "\uCF54\uB4DC\uC5D0\uC11C \uC0AC\uC6A9\uD558\uB294 \uAE30\uC220 \uC774\uB984\uACFC ID\uB294 \uC720\uC9C0\uB418\uACE0 Admin\uC5D0 \uBCF4\uC774\uB294 \uC774\uB984\uB9CC \uBC14\uB01D\uB2C8\uB2E4." }), _jsx("div", { className: styles.labelGrid, children: previewSchema.collections.map((collection) => _jsx(TextInput, { label: `${collection.name} 표시 이름`, value: collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection), onChange: (value) => setCollectionLabels((current) => ({ ...current, [String(collection.id)]: value })), errorMessage: (() => { const value = collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection); return value.trim().length < 1 || value.trim().length > 80 ? "1자 이상 80자 이하로 입력해 주세요." : undefined; })() }, collection.id)) })] }) : null, _jsxs("div", { className: styles.setupActions, children: [_jsx(Button, { variant: "secondary", onPress: () => setStep("template"), children: "\uC774\uC804" }), _jsx(Button, { isDisabled: !labelsValid, onPress: () => setStep("review"), children: "\uAD6C\uC131 \uD655\uC778" })] })] }) : null, step === "review" ? _jsxs("div", { className: styles.setupBody, children: [_jsxs("div", { className: styles.reviewPanel, children: [_jsx("span", { children: "\uC120\uD0DD\uD55C \uD15C\uD50C\uB9BF" }), _jsx("strong", { children: selectedTemplate.label }), _jsx("span", { children: "\uC0DD\uC131\uD560 \uCEEC\uB809\uC158" }), _jsxs("strong", { children: [previewSchema.collections.length, "\uAC1C"] })] }), previewSchema.collections.length > 0 ? _jsx("ul", { className: styles.collectionReview, children: previewSchema.collections.map((collection) => _jsxs("li", { children: [_jsx("strong", { children: collectionLabels[String(collection.id)] ?? defaultCollectionLabel(collection) }), _jsxs("span", { children: [collection.name, " \u00B7 \uD544\uB4DC ", collection.fields.length, "\uAC1C"] })] }, collection.id)) }) : _jsx(Callout, { tone: "info", children: "\uCEEC\uB809\uC158 \uC5C6\uB294 \uBE48 Schema revision\uC744 \uC0DD\uC131\uD569\uB2C8\uB2E4." }), _jsx(Callout, { tone: "warning", children: "\uC801\uC6A9 \uD6C4\uC5D0\uB3C4 Schema \uD3B8\uC9D1\uAE30\uC5D0\uC11C \uAD6C\uC870\uB97C \uD655\uC7A5\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. setup\uC5D0\uC11C\uB294 \uC548\uC804\uD55C \uCD08\uAE30 \uAD6C\uC131\uB9CC \uC81C\uACF5\uD569\uB2C8\uB2E4." }), applyTemplate.isError ? _jsx(Callout, { tone: "error", children: toAdminApiError(applyTemplate.error).message }) : null, _jsxs("div", { className: styles.setupActions, children: [_jsx(Button, { variant: "secondary", onPress: () => setStep("customize"), isDisabled: applyTemplate.isPending, children: "\uC774\uC804" }), _jsx(Button, { onPress: () => applyTemplate.mutate(), isDisabled: applyTemplate.isPending, children: applyTemplate.isPending ? "적용 중…" : "템플릿 적용하고 시작" })] })] }) : null] }));
}
export function LoginPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const status = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => api.auth.getBootstrapStatus() });
    const session = useQuery({ queryKey: queryKeys.session, queryFn: () => api.auth.getSession(), retry: false });
    const { control, handleSubmit, setError, setFocus } = useForm({
        defaultValues: { username: "", password: "" },
    });
    const mutation = useMutation({
        mutationFn: (credentials) => api.auth.login(credentials),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.session });
            navigate(result.passwordChangeRequired === true
                ? "/admin/password-change"
                : status.data?.templateRequired ? "/admin/setup" : "/admin/schema", { replace: true });
        },
        onError: (error) => {
            const apiError = toAdminApiError(error);
            if (apiError.status === 401) {
                setError("username", { message: "사용자 이름 또는 비밀번호가 올바르지 않습니다." });
                setFocus("username");
            }
        },
    });
    useEffect(() => {
        if (mutation.isError && toAdminApiError(mutation.error).status !== 401)
            setFocus("username");
    }, [mutation.error, mutation.isError, setFocus]);
    if (status.data?.required)
        return _jsx(Navigate, { to: "/admin/setup", replace: true });
    if (session.data?.user)
        return _jsx(Navigate, { to: session.data.passwordChangeRequired === true
                ? "/admin/password-change"
                : status.data?.templateRequired || session.data.schemaRevisionId === null ? "/admin/setup" : "/admin/schema", replace: true });
    const apiError = mutation.isError ? toAdminApiError(mutation.error) : null;
    return (_jsxs(AuthLayout, { title: "Admin Studio \uB85C\uADF8\uC778", description: "XeCMS \uC6B4\uC601 \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD558\uC138\uC694.", children: [apiError && apiError.status !== 401 ? _jsx(Callout, { tone: "error", children: apiError.message }) : null, _jsxs("form", { "aria-label": "\uB85C\uADF8\uC778", className: styles.form, onSubmit: handleSubmit((values) => mutation.mutate(values)), children: [_jsx(Controller, { control: control, name: "username", rules: { required: "사용자 이름을 입력해 주세요." }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uC0AC\uC6A9\uC790 \uC774\uB984", autoComplete: "username", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "password", rules: { required: "비밀번호를 입력해 주세요." }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Button, { type: "submit", isDisabled: mutation.isPending, children: mutation.isPending ? "로그인 중…" : "로그인" })] })] }));
}
export function PasswordChangePage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { control, handleSubmit, watch } = useForm({
        defaultValues: { currentPassword: "", newPassword: "", confirmation: "" },
    });
    const mutation = useMutation({
        mutationFn: ({ currentPassword, newPassword }) => api.auth.changePassword({ currentPassword, newPassword }),
        onSuccess: () => {
            queryClient.clear();
            navigate("/admin/login", { replace: true });
        },
    });
    return (_jsxs(AuthLayout, { title: "\uC784\uC2DC \uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD", description: "Admin \uC791\uC5C5\uC744 \uACC4\uC18D\uD558\uB824\uBA74 \uBCF8\uC778\uB9CC \uC544\uB294 \uC0C8 \uBE44\uBC00\uBC88\uD638\uB85C \uBCC0\uACBD\uD558\uC138\uC694.", children: [mutation.isError ? _jsx(Callout, { tone: "error", children: toAdminApiError(mutation.error).message }) : null, _jsxs("form", { "aria-label": "\uC784\uC2DC \uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD", className: styles.form, onSubmit: handleSubmit((values) => mutation.mutate(values)), children: [_jsx(Controller, { control: control, name: "currentPassword", rules: { required: "현재 비밀번호를 입력해 주세요." }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uD604\uC7AC \uC784\uC2DC \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "current-password", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "newPassword", rules: { required: "새 비밀번호를 입력해 주세요.", minLength: { value: 12, message: "12자 이상이어야 합니다." }, maxLength: { value: 128, message: "128자 이하여야 합니다." } }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uC0C8 \uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "confirmation", rules: { required: "새 비밀번호를 다시 입력해 주세요.", validate: (value) => value === watch("newPassword") || "비밀번호가 일치하지 않습니다." }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uC0C8 \uBE44\uBC00\uBC88\uD638 \uD655\uC778", type: "password", autoComplete: "new-password", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Button, { type: "submit", isDisabled: mutation.isPending, children: mutation.isPending ? "변경 중…" : "비밀번호 변경" })] })] }));
}
//# sourceMappingURL=auth-pages.js.map