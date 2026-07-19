import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { toAdminApiError } from "@xecms/admin";
import { useNavigate } from "react-router";
export function PageLoading({ label = "페이지를 불러오는 중" }) {
    return _jsx(LoadingIndicator, { label: label });
}
export function LoadError({ error, onRetry }) {
    const apiError = toAdminApiError(error);
    return (_jsxs(Callout, { tone: "error", children: [_jsx("strong", { children: "\uC694\uCCAD\uC744 \uC644\uB8CC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." }), " ", apiError.message, onRetry ? _jsx("div", { children: _jsx(Button, { variant: "quiet", onPress: onRetry, children: "\uB2E4\uC2DC \uC2DC\uB3C4" }) }) : null] }));
}
/**
 * Content Realm의 권한/멤버십 화면은 진입 자체가 권한을 요구한다. Realm을 만든
 * 직후의 운영자는 이 Realm의 정책을 볼 권한도, 멤버십도 없어서 서버가 다음 중
 * 하나로 거부한다 — 부트스트랩 데드락:
 *   - `AUTHORIZATION_DENIED` (getPolicy가 authorization.read를 요구, NO_PERMISSION)
 *   - `REALM_MEMBERSHIP_REQUIRED` (그 Realm의 활성 멤버가 아님)
 *   - realm 목록/상세는 `authorization.manage`를 요구 → 역시 NO_PERMISSION
 * 이 경우 (영어 원문) 일반 오류 대신, 탈출구를 한국어로 안내한다.
 */
export function isRealmBootstrapDenial(error) {
    const apiError = toAdminApiError(error);
    if (apiError.status !== 403)
        return false;
    if (apiError.code === "REALM_MEMBERSHIP_REQUIRED")
        return true;
    if (apiError.code !== "AUTHORIZATION_DENIED")
        return false;
    const details = apiError.details;
    // getPolicy/manage 거부는 reasonCode NO_PERMISSION으로 나온다. reasonCode가
    // 없더라도 AUTHORIZATION_DENIED(403)면 부트스트랩 안내를 보여주는 편이 안전하다.
    return details?.decision?.reasonCode === undefined
        || details.decision.reasonCode === "NO_PERMISSION";
}
/**
 * Realm 권한/멤버십 화면에서 로드가 실패했을 때, 부트스트랩 데드락이면 탈출
 * 안내를, 아니면 일반 오류를 렌더한다. `context`로 화면 맥락에 맞는 문구/CTA를 고른다.
 */
export function RealmAuthorizationError({ error, onRetry, context, realmId }) {
    const navigate = useNavigate();
    if (!isRealmBootstrapDenial(error))
        return _jsx(LoadError, { error: error, onRetry: onRetry });
    // System 워크스페이스(realm 스코프 아님)의 권한 화면은 이 데드락과 무관하다.
    // realmId가 없으면 realm 부트스트랩 안내 대신 일반 오류를 보여준다.
    if (context === "policy" && realmId === undefined)
        return _jsx(LoadError, { error: error, onRetry: onRetry });
    if (context === "list") {
        return (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uAD00\uB9AC\uD560 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }), _jsxs("div", { children: ["\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uBAA9\uB85D\uC744 \uBCF4\uACE0 \uAD00\uB9AC\uD558\uB824\uBA74 \uC6B4\uC601 \uACC4\uC815\uC5D0 ", _jsx("code", { children: "authorization.manage" }), " \uAD8C\uD55C\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uAD8C\uD55C\uC774 \uC788\uB294 \uC6B4\uC601\uC790\uC5D0\uAC8C \uC5ED\uD560 \uBC30\uC815\uC744 \uC694\uCCAD\uD558\uC138\uC694."] }), _jsx("div", { children: _jsx(Button, { variant: "quiet", onPress: onRetry, children: "\uB2E4\uC2DC \uC2DC\uB3C4" }) })] }));
    }
    if (context === "detail") {
        return (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uAD00\uB9AC\uD560 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4." }), _jsxs("div", { children: ["\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC0C1\uC138\uB97C \uBCF4\uB824\uBA74 \uC6B4\uC601 \uACC4\uC815\uC5D0 ", _jsx("code", { children: "authorization.manage" }), " \uAD8C\uD55C\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uAD8C\uD55C\uC774 \uC788\uB294 \uC6B4\uC601\uC790\uC5D0\uAC8C \uC5ED\uD560 \uBC30\uC815\uC744 \uC694\uCCAD\uD558\uC138\uC694."] }), _jsx("div", { children: _jsx(Button, { variant: "quiet", onPress: () => navigate("/admin/realms"), children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uBAA9\uB85D\uC73C\uB85C" }) })] }));
    }
    // context === "policy"
    return (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uC774 \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 \uAD8C\uD55C\uC744 \uAD00\uB9AC\uD560 \uAD8C\uD55C\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4." }), _jsxs("div", { children: ["\uC0AC\uC6A9\uC790 \uACF5\uAC04\uC744 \uB9CC\uB4E0 \uC9C1\uD6C4\uC5D0\uB294 \uC6B4\uC601\uC790 \uACC4\uC815\uC5D0 \uC774 \uACF5\uAC04\uC758 \uAD8C\uD55C \uC815\uCC45\uC744 \uBCFC \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC0AC\uC6A9\uC790 \uACF5\uAC04\uC758 ", _jsx("strong", { children: "\u201C\uC0AC\uC6A9\uC790 \uD560\uB2F9\u201D" }), "\uC5D0\uC11C \uBCF8\uC778(\uB610\uB294 \uB2F4\uB2F9\uC790)\uC744 ", _jsx("strong", { children: "\u201C\uAD00\uB9AC\uC790\uB85C \uC9C0\uC815\u201D" }), "\uD558\uBA74 \uC774 \uD654\uBA74\uC5D0 \uB4E4\uC5B4\uC62C \uC218 \uC788\uC2B5\uB2C8\uB2E4."] }), _jsxs("div", { children: [realmId !== undefined ? (_jsx(Button, { onPress: () => navigate(`/admin/realms/${encodeURIComponent(realmId)}`), children: "\uC0AC\uC6A9\uC790 \uACF5\uAC04 \uC0C1\uC138\uB85C \uC774\uB3D9\uD574 \uAD00\uB9AC\uC790 \uC9C0\uC815" })) : null, _jsx(Button, { variant: "quiet", onPress: onRetry, children: "\uB2E4\uC2DC \uC2DC\uB3C4" })] })] }));
}
export function ConflictNotice({ onReload }) {
    return (_jsxs(Callout, { tone: "warning", children: [_jsx("strong", { children: "\uB2E4\uB978 \uBCC0\uACBD\uC774 \uBA3C\uC800 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4." }), " \uD604\uC7AC \uC785\uB825\uC744 \uB36E\uC5B4\uC4F0\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4. \uCD5C\uC2E0 \uBC84\uC804\uC744 \uBD88\uB7EC\uC628 \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", _jsx("div", { children: _jsx(Button, { variant: "quiet", onPress: onReload, children: "\uCD5C\uC2E0 \uBC84\uC804 \uBD88\uB7EC\uC624\uAE30" }) })] }));
}
//# sourceMappingURL=async-state.js.map