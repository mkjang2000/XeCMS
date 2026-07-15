import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { toAdminApiError } from "@xecms/admin";
export function PageLoading({ label = "페이지를 불러오는 중" }) {
    return _jsx(LoadingIndicator, { label: label });
}
export function LoadError({ error, onRetry }) {
    const apiError = toAdminApiError(error);
    return (_jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: "\uC694\uCCAD\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." }), " ", apiError.message, onRetry ? _jsx("div", { children: _jsx(Button, { variant: "quiet", onPress: onRetry, children: "\uB2E4\uC2DC \uC2DC\uB3C4" }) }) : null] }));
}
export function ConflictNotice({ onReload }) {
    return (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uB2E4\uB978 \uBCC0\uACBD\uC774 \uBA3C\uC800 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4." }), " \uD604\uC7AC \uC785\uB825\uC744 \uB36E\uC5B4\uC4F0\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uCD5C\uC2E0 \uBC84\uC804\uC744 \uBD88\uB7EC\uC628 \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", _jsx("div", { children: _jsx(Button, { variant: "quiet", onPress: onReload, children: "\uCD5C\uC2E0 \uBC84\uC804 \uBD88\uB7EC\uC624\uAE30" }) })] }));
}
//# sourceMappingURL=async-state.js.map