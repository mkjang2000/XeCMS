import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { FormatIcon } from "./format-icons.js";
import styles from "./rich-text-editor.module.css";
const MARK_ACTIONS = [
    { id: "bold", icon: "bold", label: "굵게", shortcut: "Ctrl+B", isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { id: "italic", icon: "italic", label: "기울임", shortcut: "Ctrl+I", isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { id: "underline", icon: "underline", label: "밑줄", shortcut: "Ctrl+U", isActive: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
    { id: "strike", icon: "strike", label: "취소선", isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
    { id: "code", icon: "code", label: "인라인 코드", isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
];
const LIST_ACTIONS = [
    { id: "bulletList", icon: "bulletList", label: "글머리 목록", isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: "orderedList", icon: "orderedList", label: "번호 목록", isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: "blockquote", icon: "blockquote", label: "인용", isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
];
const ALIGN_ACTIONS = [
    { id: "alignLeft", icon: "alignLeft", label: "왼쪽 정렬", isActive: (e) => e.isActive({ textAlign: "left" }), run: (e) => e.chain().focus().setTextAlign("left").run() },
    { id: "alignCenter", icon: "alignCenter", label: "가운데 정렬", isActive: (e) => e.isActive({ textAlign: "center" }), run: (e) => e.chain().focus().setTextAlign("center").run() },
    { id: "alignRight", icon: "alignRight", label: "오른쪽 정렬", isActive: (e) => e.isActive({ textAlign: "right" }), run: (e) => e.chain().focus().setTextAlign("right").run() },
];
const BLOCK_TYPES = [
    { id: "paragraph", label: "본문", isActive: (e) => e.isActive("paragraph"), run: (e) => e.chain().focus().setParagraph().run() },
    { id: "h1", label: "제목 1", isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: "h2", label: "제목 2", isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: "h3", label: "제목 3", isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: "codeBlock", label: "코드 블록", isActive: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];
// Kept small on purpose: a full picker invites inconsistent documents.
const TEXT_COLORS = [
    { value: "", label: "기본" },
    { value: "#d92d20", label: "빨강" },
    { value: "#dc6803", label: "주황" },
    { value: "#039855", label: "초록" },
    { value: "#1570ef", label: "파랑" },
    { value: "#6938ef", label: "보라" },
    { value: "#667085", label: "회색" },
];
function ToolbarButton({ editor, action }) {
    const active = action.isActive?.(editor) ?? false;
    const title = action.shortcut === undefined ? action.label : `${action.label} (${action.shortcut})`;
    return (_jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": action.label, "aria-pressed": active, title: title, onMouseDown: (event) => event.preventDefault(), onClick: () => action.run(editor), children: _jsx(FormatIcon, { name: action.icon }) }));
}
/** Closes a popover on outside click or Escape. */
function useDismiss(onDismiss) {
    const ref = useRef(null);
    useEffect(() => {
        const onPointerDown = (event) => {
            if (ref.current !== null && !ref.current.contains(event.target))
                onDismiss();
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape")
                onDismiss();
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [onDismiss]);
    return ref;
}
function BlockTypeMenu({ editor }) {
    const [open, setOpen] = useState(false);
    const ref = useDismiss(() => setOpen(false));
    const current = BLOCK_TYPES.find((type) => type.isActive(editor)) ?? BLOCK_TYPES[0];
    return (_jsxs("div", { className: styles.menu, ref: ref, children: [_jsxs("button", { type: "button", className: styles.menuTrigger, "aria-haspopup": "menu", "aria-expanded": open, title: "\uBB38\uB2E8 \uC2A4\uD0C0\uC77C", onMouseDown: (event) => event.preventDefault(), onClick: () => setOpen((previous) => !previous), children: [_jsx("span", { children: current.label }), _jsx(FormatIcon, { name: "chevronDown", size: 14 })] }), open ? (_jsx("div", { className: styles.menuPanel, role: "menu", children: BLOCK_TYPES.map((type) => (_jsx("button", { type: "button", role: "menuitemradio", "aria-checked": type.isActive(editor), className: `${styles.menuItem} ${styles[`block_${type.id}`] ?? ""}`, onMouseDown: (event) => event.preventDefault(), onClick: () => { type.run(editor); setOpen(false); }, children: type.label }, type.id))) })) : null] }));
}
function ColorMenu({ editor }) {
    const [open, setOpen] = useState(false);
    const ref = useDismiss(() => setOpen(false));
    const current = editor.getAttributes("textStyle")["color"] ?? "";
    return (_jsxs("div", { className: styles.menu, ref: ref, children: [_jsxs("button", { type: "button", className: styles.menuTrigger, "aria-haspopup": "menu", "aria-expanded": open, "aria-label": "\uAE00\uC790 \uC0C9", title: "\uAE00\uC790 \uC0C9", onMouseDown: (event) => event.preventDefault(), onClick: () => setOpen((previous) => !previous), children: [_jsx("span", { className: styles.colorGlyph, style: { color: current === "" ? "var(--xe-color-text)" : current }, children: "A" }), _jsx(FormatIcon, { name: "chevronDown", size: 14 })] }), open ? (_jsx("div", { className: styles.colorPanel, role: "menu", children: TEXT_COLORS.map((color) => (_jsx("button", { type: "button", role: "menuitemradio", "aria-checked": current === color.value, "aria-label": color.label, title: color.label, className: styles.colorSwatch, "data-selected": current === color.value, style: color.value === "" ? undefined : { background: color.value }, onMouseDown: (event) => event.preventDefault(), onClick: () => {
                        if (color.value === "")
                            editor.chain().focus().unsetColor().run();
                        else
                            editor.chain().focus().setColor(color.value).run();
                        setOpen(false);
                    }, children: color.value === "" ? "A" : "" }, color.value || "default"))) })) : null] }));
}
export function RichTextToolbar({ editor, label, canInsertImage, onInsertImage, onEditLink }) {
    const linkActive = editor.isActive("link");
    return (_jsxs("div", { className: styles.toolbar, role: "toolbar", "aria-label": `${label} 서식`, children: [_jsx(BlockTypeMenu, { editor: editor }), _jsx("span", { className: styles.divider }), MARK_ACTIONS.map((action) => _jsx(ToolbarButton, { editor: editor, action: action }, action.id)), _jsx(ColorMenu, { editor: editor }), _jsx("span", { className: styles.divider }), LIST_ACTIONS.map((action) => _jsx(ToolbarButton, { editor: editor, action: action }, action.id)), _jsx("span", { className: styles.divider }), ALIGN_ACTIONS.map((action) => _jsx(ToolbarButton, { editor: editor, action: action }, action.id)), _jsx("span", { className: styles.divider }), _jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": linkActive ? "링크 편집" : "링크", "aria-pressed": linkActive, title: "\uB9C1\uD06C", onMouseDown: (event) => event.preventDefault(), onClick: onEditLink, children: _jsx(FormatIcon, { name: "link" }) }), linkActive ? (_jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": "\uB9C1\uD06C \uC81C\uAC70", title: "\uB9C1\uD06C \uC81C\uAC70", onMouseDown: (event) => event.preventDefault(), onClick: () => editor.chain().focus().unsetLink().run(), children: _jsx(FormatIcon, { name: "unlink" }) })) : null, _jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": "\uC774\uBBF8\uC9C0", title: "\uC774\uBBF8\uC9C0 \uB123\uAE30", disabled: !canInsertImage, onMouseDown: (event) => event.preventDefault(), onClick: onInsertImage, children: _jsx(FormatIcon, { name: "image" }) }), _jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": "\uD45C", title: "\uD45C \uB123\uAE30 (3\u00D73)", onMouseDown: (event) => event.preventDefault(), onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), children: _jsx(FormatIcon, { name: "table" }) }), _jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": "\uAD6C\uBD84\uC120", title: "\uAD6C\uBD84\uC120", onMouseDown: (event) => event.preventDefault(), onClick: () => editor.chain().focus().setHorizontalRule().run(), children: _jsx(FormatIcon, { name: "rule" }) }), _jsx("span", { className: styles.toolbarGap }), _jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": "\uC2E4\uD589 \uCDE8\uC18C", title: "\uC2E4\uD589 \uCDE8\uC18C (Ctrl+Z)", disabled: !editor.can().undo(), onMouseDown: (event) => event.preventDefault(), onClick: () => editor.chain().focus().undo().run(), children: _jsx(FormatIcon, { name: "undo" }) }), _jsx("button", { type: "button", className: styles.toolbarButton, "aria-label": "\uB2E4\uC2DC \uC2E4\uD589", title: "\uB2E4\uC2DC \uC2E4\uD589 (Ctrl+Shift+Z)", disabled: !editor.can().redo(), onMouseDown: (event) => event.preventDefault(), onClick: () => editor.chain().focus().redo().run(), children: _jsx(FormatIcon, { name: "redo" }) })] }));
}
//# sourceMappingURL=rich-text-toolbar.js.map