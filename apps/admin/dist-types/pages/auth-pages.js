import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, LoadingIndicator, TextInput } from "@xecms/ui";
import { toAdminApiError, useAdminApi } from "@xecms/admin";
import { Icon } from "../components/icon.js";
import styles from "../auth.module.css";
import { queryKeys } from "../queries.js";
function AuthLayout({ title, description, children }) {
    return (_jsxs("main", { className: styles.authPage, children: [_jsxs("aside", { className: styles.authVisual, "aria-label": "XeCMS Admin Studio \uC18C\uAC1C", children: [_jsxs("div", { className: styles.visualBrand, children: [_jsx("span", { className: styles.brandMark, "aria-hidden": "true", children: "Xe" }), _jsx("span", { className: styles.brandName, children: "XeCMS Admin Studio" })] }), _jsxs("div", { className: styles.visualContent, children: [_jsx("span", { className: styles.visualEyebrow, children: "Structured content workspace" }), _jsx("h2", { children: "\uCF58\uD150\uCE20\uC758 \uAD6C\uC870\uC640 \uC6B4\uC601\uC744 \uD55C\uACF3\uC5D0\uC11C." }), _jsx("p", { children: "\uC2A4\uD0A4\uB9C8 \uC124\uACC4\uBD80\uD130 \uCF58\uD150\uCE20 \uAD00\uB9AC\uAE4C\uC9C0, \uAC1C\uBC1C\uC790\uC5D0\uAC8C \uD544\uC694\uD55C \uD750\uB984\uC744 \uBA85\uD655\uD558\uACE0 \uC548\uC804\uD558\uAC8C \uC5F0\uACB0\uD569\uB2C8\uB2E4." }), _jsxs("ul", { className: styles.featureList, children: [_jsxs("li", { children: [_jsx("span", { className: styles.featureIcon, children: _jsx(Icon, { name: "schema", size: 16 }) }), "\uC608\uCE21 \uAC00\uB2A5\uD55C \uC2A4\uD0A4\uB9C8 \uC124\uACC4"] }), _jsxs("li", { children: [_jsx("span", { className: styles.featureIcon, children: _jsx(Icon, { name: "database", size: 16 }) }), "\uAC80\uD1A0 \uAC00\uB2A5\uD55C \uB370\uC774\uD130\uBCA0\uC774\uC2A4 \uBCC0\uACBD"] }), _jsxs("li", { children: [_jsx("span", { className: styles.featureIcon, children: _jsx(Icon, { name: "shield", size: 16 }) }), "\uC6B4\uC601 \uACBD\uACC4\uB97C \uC9C0\uD0A4\uB294 \uC548\uC804\uD55C \uAE30\uBCF8\uAC12"] })] })] }), _jsx("span", { className: styles.visualFooter, children: "XeCMS \u00B7 Developer-first content management" })] }), _jsx("div", { className: styles.authContent, children: _jsxs("section", { className: styles.authCard, children: [_jsxs("header", { className: styles.authHeader, children: [_jsx("p", { className: styles.authEyebrow, children: "Workspace access" }), _jsx("h1", { children: title }), _jsx("p", { className: styles.muted, children: description })] }), children, _jsxs("footer", { className: styles.authFootnote, children: [_jsx(Icon, { name: "shield", size: 15 }), _jsx("span", { children: "\uBCF4\uD638\uB41C \uC138\uC158\uC73C\uB85C Admin Workspace\uC5D0 \uC5F0\uACB0\uD569\uB2C8\uB2E4." })] })] }) })] }));
}
export function SetupPage() {
    const api = useAdminApi();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const status = useQuery({ queryKey: queryKeys.bootstrap, queryFn: () => api.auth.getBootstrapStatus() });
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
            navigate("/admin/schema", { replace: true });
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
    if (status.isPending)
        return _jsx(AuthLayout, { title: "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", description: "XeCMS\uB97C \uC900\uBE44\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4.", children: _jsx(LoadingIndicator, {}) });
    if (status.isError)
        return _jsx(AuthLayout, { title: "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", description: "\uC11C\uBC84 \uC5F0\uACB0\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.", children: _jsx(Callout, { tone: "error", children: toAdminApiError(status.error).message }) });
    if (!status.data.required)
        return _jsx(Navigate, { to: "/admin/login", replace: true });
    const apiError = mutation.isError ? toAdminApiError(mutation.error) : null;
    return (_jsxs(AuthLayout, { title: "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", description: "\uC774 \uC791\uC5C5\uC740 \uBE48 \uC778\uC2A4\uD134\uC2A4\uC5D0\uC11C \uD55C \uBC88\uB9CC \uC218\uD589\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.", children: [apiError ? _jsx(Callout, { tone: "error", children: apiError.message }) : null, _jsxs("form", { "aria-label": "\uCD08\uAE30 \uAD00\uB9AC\uC790 \uC124\uC815", className: styles.form, onSubmit: handleSubmit((values) => mutation.mutate(values)), children: [_jsx(Controller, { control: control, name: "username", rules: { required: "사용자 이름을 입력해 주세요." }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uC0AC\uC6A9\uC790 \uC774\uB984", autoComplete: "username", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "password", rules: {
                            required: "비밀번호를 입력해 주세요.",
                            minLength: { value: 12, message: "비밀번호는 12자 이상이어야 합니다." },
                            maxLength: { value: 128, message: "비밀번호는 128자 이하여야 합니다." },
                        }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uBE44\uBC00\uBC88\uD638", type: "password", autoComplete: "new-password", isRequired: true, description: "12\uC790 \uC774\uC0C1 128\uC790 \uC774\uD558\uC758 \uACE0\uC720\uD55C \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.", errorMessage: fieldState.error?.message, ...field })) }), _jsx(Controller, { control: control, name: "passwordConfirmation", rules: {
                            required: "비밀번호를 다시 입력해 주세요.",
                            validate: (value) => value === watch("password") || "비밀번호가 일치하지 않습니다.",
                        }, render: ({ field: { ref, ...field }, fieldState }) => (_jsx(TextInput, { inputRef: ref, label: "\uBE44\uBC00\uBC88\uD638 \uD655\uC778", type: "password", autoComplete: "new-password", isRequired: true, errorMessage: fieldState.error?.message, ...field })) }), _jsx(Button, { type: "submit", isDisabled: mutation.isPending, children: mutation.isPending ? "생성 중…" : "초기 관리자 생성" })] })] }));
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
            navigate(result.passwordChangeRequired === true ? "/admin/password-change" : "/admin/schema", { replace: true });
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
        return _jsx(Navigate, { to: session.data.passwordChangeRequired === true ? "/admin/password-change" : "/admin/schema", replace: true });
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