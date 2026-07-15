import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import { calculateLastPage } from "@xecms/admin";
import styles from "../app.module.css";
export function DocumentPagination({ page, pageSize, total, onChange, }) {
    if (total === 0)
        return null;
    const lastPage = calculateLastPage(total, pageSize);
    return (_jsxs("div", { className: styles.pagination, role: "group", "aria-label": "\uBB38\uC11C \uD398\uC774\uC9C0", children: [_jsx(Button, { variant: "secondary", isDisabled: page <= 1, onPress: () => onChange(page - 1), children: "\uC774\uC804 \uD398\uC774\uC9C0" }), _jsxs("span", { "aria-live": "polite", children: [page, " / ", lastPage, " \uD398\uC774\uC9C0"] }), _jsx(Button, { variant: "secondary", isDisabled: page >= lastPage, onPress: () => onChange(page + 1), children: "\uB2E4\uC74C \uD398\uC774\uC9C0" })] }));
}
//# sourceMappingURL=document-pagination.js.map