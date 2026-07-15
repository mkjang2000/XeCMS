import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "@xecms/ui";
export function UnsavedChangesGuard({ when }) {
    const blocker = useBlocker(when);
    useEffect(() => {
        if (!when)
            return;
        const preventUnload = (event) => event.preventDefault();
        window.addEventListener("beforeunload", preventUnload);
        return () => window.removeEventListener("beforeunload", preventUnload);
    }, [when]);
    if (blocker.state !== "blocked")
        return null;
    return (_jsx(ConfirmDialog, { title: "\uC800\uC7A5\uD558\uC9C0 \uC54A\uC740 \uBCC0\uACBD \uC0AC\uD56D", confirmLabel: "\uBCC0\uACBD \uC0AC\uD56D \uBC84\uB9AC\uAE30", danger: true, onCancel: () => blocker.reset(), onConfirm: () => blocker.proceed(), children: "\uC774 \uD398\uC774\uC9C0\uB97C \uB098\uAC00\uBA74 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC740 \uBCC0\uACBD \uC0AC\uD56D\uC774 \uC0AC\uB77C\uC9D1\uB2C8\uB2E4." }));
}
//# sourceMappingURL=unsaved-guard.js.map