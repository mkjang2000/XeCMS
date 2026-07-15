import { jsx as _jsx } from "react/jsx-runtime";
import { documentDisplayStateLabel } from "@xecms/admin";
import { Badge } from "@xecms/ui";
const tones = {
    draft: "info",
    published: "success",
    "published-with-draft": "warning",
    archived: "neutral",
    deleted: "danger",
};
export function DocumentStatus({ state, announce = false, }) {
    const label = documentDisplayStateLabel(state);
    return (_jsx("span", { role: announce ? "status" : undefined, "aria-label": `문서 상태: ${label}`, children: _jsx(Badge, { tone: tones[state], children: label }) }));
}
//# sourceMappingURL=document-status.js.map