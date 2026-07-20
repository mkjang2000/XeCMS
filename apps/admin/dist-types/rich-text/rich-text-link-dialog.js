import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { ConfirmDialog, TextInput } from "@xecms/ui";
import styles from "./rich-text-editor.module.css";
/** Replaces window.prompt so link editing looks like the rest of the studio. */
export function RichTextLinkDialog({ initialHref, onSubmit, onRemove, onClose }) {
    const [href, setHref] = useState(initialHref);
    const trimmed = href.trim();
    const isEditing = initialHref !== "";
    return (_jsx(ConfirmDialog, { title: isEditing ? "링크 편집" : "링크 넣기", confirmLabel: isEditing ? "저장" : "넣기", cancelLabel: isEditing ? "링크 제거" : "취소", isConfirmDisabled: trimmed === "", onCancel: () => { if (isEditing)
            onRemove();
        else
            onClose(); }, onConfirm: () => { if (trimmed !== "")
            onSubmit(trimmed); }, children: _jsxs("div", { className: styles.linkDialog, children: [_jsx(TextInput, { label: "\uB9C1\uD06C \uC8FC\uC18C", placeholder: "https://example.com", value: href, onChange: setHref, autoFocus: true }), _jsx("p", { className: styles.pickerHint, children: "\uC120\uD0DD\uD55C \uAE00\uC790\uC5D0 \uB9C1\uD06C\uAC00 \uAC78\uB9BD\uB2C8\uB2E4. \uC8FC\uC18C\uB294 https:// \uB85C \uC2DC\uC791\uD558\uB294 \uAC83\uC744 \uAD8C\uC7A5\uD569\uB2C8\uB2E4." })] }) }));
}
//# sourceMappingURL=rich-text-link-dialog.js.map