import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { FormatIcon, type FormatIconName } from "./format-icons.js";
import styles from "./rich-text-editor.module.css";

interface ToolbarAction {
  readonly id: string;
  readonly icon: FormatIconName;
  readonly label: string;
  readonly shortcut?: string;
  readonly isActive?: (editor: Editor) => boolean;
  readonly run: (editor: Editor) => void;
}

const MARK_ACTIONS: readonly ToolbarAction[] = [
  { id: "bold", icon: "bold", label: "굵게", shortcut: "Ctrl+B", isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { id: "italic", icon: "italic", label: "기울임", shortcut: "Ctrl+I", isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { id: "underline", icon: "underline", label: "밑줄", shortcut: "Ctrl+U", isActive: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
  { id: "strike", icon: "strike", label: "취소선", isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
  { id: "code", icon: "code", label: "인라인 코드", isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
];

const LIST_ACTIONS: readonly ToolbarAction[] = [
  { id: "bulletList", icon: "bulletList", label: "글머리 목록", isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "orderedList", icon: "orderedList", label: "번호 목록", isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "blockquote", icon: "blockquote", label: "인용", isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
];

const ALIGN_ACTIONS: readonly ToolbarAction[] = [
  { id: "alignLeft", icon: "alignLeft", label: "왼쪽 정렬", isActive: (e) => e.isActive({ textAlign: "left" }), run: (e) => e.chain().focus().setTextAlign("left").run() },
  { id: "alignCenter", icon: "alignCenter", label: "가운데 정렬", isActive: (e) => e.isActive({ textAlign: "center" }), run: (e) => e.chain().focus().setTextAlign("center").run() },
  { id: "alignRight", icon: "alignRight", label: "오른쪽 정렬", isActive: (e) => e.isActive({ textAlign: "right" }), run: (e) => e.chain().focus().setTextAlign("right").run() },
];

const BLOCK_TYPES = [
  { id: "paragraph", label: "본문", isActive: (e: Editor) => e.isActive("paragraph"), run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { id: "h1", label: "제목 1", isActive: (e: Editor) => e.isActive("heading", { level: 1 }), run: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "h2", label: "제목 2", isActive: (e: Editor) => e.isActive("heading", { level: 2 }), run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", label: "제목 3", isActive: (e: Editor) => e.isActive("heading", { level: 3 }), run: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "codeBlock", label: "코드 블록", isActive: (e: Editor) => e.isActive("codeBlock"), run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
] as const;

// Kept small on purpose: a full picker invites inconsistent documents.
const TEXT_COLORS = [
  { value: "", label: "기본" },
  { value: "#d92d20", label: "빨강" },
  { value: "#dc6803", label: "주황" },
  { value: "#039855", label: "초록" },
  { value: "#1570ef", label: "파랑" },
  { value: "#6938ef", label: "보라" },
  { value: "#667085", label: "회색" },
] as const;

function ToolbarButton({ editor, action }: { readonly editor: Editor; readonly action: ToolbarAction }) {
  const active = action.isActive?.(editor) ?? false;
  const title = action.shortcut === undefined ? action.label : `${action.label} (${action.shortcut})`;
  return (
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label={action.label}
      aria-pressed={active}
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => action.run(editor)}
    >
      <FormatIcon name={action.icon} />
    </button>
  );
}

/** Closes a popover on outside click or Escape. */
function useDismiss(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
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

function BlockTypeMenu({ editor }: { readonly editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(() => setOpen(false));
  const current = BLOCK_TYPES.find((type) => type.isActive(editor)) ?? BLOCK_TYPES[0];

  return (
    <div className={styles.menu} ref={ref}>
      <button
        type="button"
        className={styles.menuTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        title="문단 스타일"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span>{current.label}</span>
        <FormatIcon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className={styles.menuPanel} role="menu">
          {BLOCK_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              role="menuitemradio"
              aria-checked={type.isActive(editor)}
              className={`${styles.menuItem} ${styles[`block_${type.id}`] ?? ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { type.run(editor); setOpen(false); }}
            >{type.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ColorMenu({ editor }: { readonly editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(() => setOpen(false));
  const current = (editor.getAttributes("textStyle")["color"] as string | undefined) ?? "";

  return (
    <div className={styles.menu} ref={ref}>
      <button
        type="button"
        className={styles.menuTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="글자 색"
        title="글자 색"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.colorGlyph} style={{ color: current === "" ? "var(--xe-color-text)" : current }}>A</span>
        <FormatIcon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className={styles.colorPanel} role="menu">
          {TEXT_COLORS.map((color) => (
            <button
              key={color.value || "default"}
              type="button"
              role="menuitemradio"
              aria-checked={current === color.value}
              aria-label={color.label}
              title={color.label}
              className={styles.colorSwatch}
              data-selected={current === color.value}
              style={color.value === "" ? undefined : { background: color.value }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (color.value === "") editor.chain().focus().unsetColor().run();
                else editor.chain().focus().setColor(color.value).run();
                setOpen(false);
              }}
            >{color.value === "" ? "A" : ""}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RichTextToolbar({ editor, label, canInsertImage, onInsertImage, onEditLink }: {
  readonly editor: Editor;
  readonly label: string;
  readonly canInsertImage: boolean;
  readonly onInsertImage: () => void;
  readonly onEditLink: () => void;
}) {
  const linkActive = editor.isActive("link");

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={`${label} 서식`}>
      <BlockTypeMenu editor={editor} />
      <span className={styles.divider} />
      {MARK_ACTIONS.map((action) => <ToolbarButton key={action.id} editor={editor} action={action} />)}
      <ColorMenu editor={editor} />
      <span className={styles.divider} />
      {LIST_ACTIONS.map((action) => <ToolbarButton key={action.id} editor={editor} action={action} />)}
      <span className={styles.divider} />
      {ALIGN_ACTIONS.map((action) => <ToolbarButton key={action.id} editor={editor} action={action} />)}
      <span className={styles.divider} />
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label={linkActive ? "링크 편집" : "링크"}
        aria-pressed={linkActive}
        title="링크"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onEditLink}
      ><FormatIcon name="link" /></button>
      {linkActive ? (
        <button
          type="button"
          className={styles.toolbarButton}
          aria-label="링크 제거"
          title="링크 제거"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().unsetLink().run()}
        ><FormatIcon name="unlink" /></button>
      ) : null}
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label="이미지"
        title="이미지 넣기"
        disabled={!canInsertImage}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onInsertImage}
      ><FormatIcon name="image" /></button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label="표"
        title="표 넣기 (3×3)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      ><FormatIcon name="table" /></button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label="구분선"
        title="구분선"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      ><FormatIcon name="rule" /></button>
      <span className={styles.toolbarGap} />
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label="실행 취소"
        title="실행 취소 (Ctrl+Z)"
        disabled={!editor.can().undo()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().undo().run()}
      ><FormatIcon name="undo" /></button>
      <button
        type="button"
        className={styles.toolbarButton}
        aria-label="다시 실행"
        title="다시 실행 (Ctrl+Shift+Z)"
        disabled={!editor.can().redo()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().redo().run()}
      ><FormatIcon name="redo" /></button>
    </div>
  );
}
