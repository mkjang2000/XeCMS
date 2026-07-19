import { jsx as _jsx } from "react/jsx-runtime";
import { Navigate } from "react-router";
import { useDisplayMode } from "../../display-mode.js";
/** /admin/access 인덱스: 간단 모드는 등급 관리로, 그 외에는 레벨과 역할로 안내한다. */
export function AccessIndexRedirect() {
    const { mode } = useDisplayMode();
    return _jsx(Navigate, { to: mode === "basic" ? "grades" : "roles", replace: true });
}
//# sourceMappingURL=index-redirect.js.map