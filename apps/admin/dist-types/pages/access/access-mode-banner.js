import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge, Button, Callout } from "@xecms/ui";
import { useNavigate } from "react-router";
import styles from "../../authorization.module.css";
import { authorizationAccessMode } from "./workspace.js";
function remainingLabel(validUntil) {
    if (validUntil === undefined)
        return null;
    const minutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
    if (minutes < 60)
        return `${minutes}분 후 만료`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours}시간 후 만료` : `${hours}시간 ${rest}분 후 만료`;
}
export function AccessModeBanner({ policy, realmId }) {
    const navigate = useNavigate();
    if (realmId === undefined)
        return null;
    const mode = authorizationAccessMode(policy, realmId);
    const openFullAccess = () => navigate(`/admin/realms/${encodeURIComponent(realmId)}?tab=access`);
    if (mode === "cms-owner-readonly") {
        return (_jsxs(Callout, { tone: "info", children: [_jsx("strong", { children: "CMS Owner \uC77D\uAE30 \uC804\uC6A9 \uBCF4\uAE30" }), _jsx("div", { children: "Realm \uC6B4\uC601 \uC0C1\uD0DC\uB97C \uAC10\uB3C5\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC815\uCC45\uC744 \uC9C1\uC811 \uBCC0\uACBD\uD558\uB824\uBA74 \uAE30\uAC04 \uC81C\uD55C Full Access\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4." }), _jsx("div", { children: _jsx(Button, { variant: "danger", onPress: openFullAccess, children: "Full Access \uC2DC\uC791" }) })] }));
    }
    if (mode === "realm-full-access") {
        return (_jsxs("div", { className: styles.fullAccessModeBanner, role: "status", children: [_jsxs("div", { children: [_jsx(Badge, { tone: "danger", children: "Full Access \uC0AC\uC6A9 \uC911" }), _jsx("strong", { children: remainingLabel(policy.administration?.fullAccessValidUntil) ?? "기간 제한 접근" })] }), _jsx("span", { children: "CMS Owner \uBE44\uC0C1 \uAD00\uB9AC \uBAA8\uB4DC\uC785\uB2C8\uB2E4. \uBAA8\uB4E0 \uC815\uCC45 \uBCC0\uACBD\uC774 \uBCC4\uB3C4 \uAC10\uC0AC \uC774\uBCA4\uD2B8\uB85C \uAE30\uB85D\uB429\uB2C8\uB2E4." }), _jsx(Button, { size: "small", variant: "danger", onPress: openFullAccess, children: "\uC0C1\uD0DC\u00B7\uD574\uC81C" })] }));
    }
    return null;
}
//# sourceMappingURL=access-mode-banner.js.map