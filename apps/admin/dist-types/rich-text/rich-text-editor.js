import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from "@blocknote/core";
import { ko } from "@blocknote/core/locales";
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote, } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { MediaLibraryContext, mediaImageSpec, mediaRecordMap } from "./media-image-block.js";
import { RichTextImageDialog } from "./rich-text-image-dialog.js";
import { useResizableHeight } from "./use-resizable-height.js";
import { richTextContentOf, sameRichTextContent, toRichTextDocument, } from "./rich-text-document.js";
import styles from "./rich-text-editor.module.css";
// URL-storing file blocks are cut from the schema: persisted URLs rot when the
// deployment moves, so images go through the mediaId-based block instead.
const { audio: _audio, image: _image, video: _video, file: _file, ...retainedBlockSpecs } = defaultBlockSpecs;
const editorSchema = BlockNoteSchema.create({
    blockSpecs: { ...retainedBlockSpecs, mediaImage: mediaImageSpec() },
});
// Matches the editor body's min-height in CSS; the resize handle never shrinks
// below it, so the toolbar and a first line always stay visible.
const MIN_BODY_HEIGHT = 208;
function fieldLabel(field) {
    return field.label?.trim() || field.name;
}
function imageFilesIn(list) {
    if (list === null)
        return [];
    return [...list.files].filter((file) => file.type.startsWith("image/"));
}
/**
 * BlockNote-backed editor for `rich-text` fields.
 *
 * The stored format is the BlockNote block tree under the versioned v2
 * envelope, so documents round-trip without a converter. Formatting toolbar,
 * slash menu, tables and drag handles come from BlockNote; this wrapper owns
 * the form contract (value in / document out) and the media integration.
 */
export function RichTextEditor({ field, value, errorMessage, onChange, onBlur, isDisabled, mediaItems = [], onUploadMedia, canUploadMedia = false, }) {
    const readOnly = isDisabled === true || field.readOnly === true;
    const [showImageDialog, setShowImageDialog] = useState(false);
    const [isUploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const containerRef = useRef(null);
    const bodyRef = useRef(null);
    const { height, onHandlePointerDown, isResizing } = useResizableHeight(bodyRef, field.id, MIN_BODY_HEIGHT);
    // Latest content emitted by this editor, used to tell our own updates apart
    // from an external change (refetch, revision restore) that must reset it.
    const lastEmitted = useRef(null);
    // True while replaceBlocks runs so the resulting onChange is not emitted as
    // a user edit (which would mark the form dirty on every reload).
    const seeding = useRef(false);
    const mediaLibrary = useMemo(() => mediaRecordMap(mediaItems), [mediaItems]);
    const editor = useCreateBlockNote({
        schema: editorSchema,
        dictionary: ko,
        initialContent: initialBlocksOf(value),
    }, []);
    const emit = useCallback(() => {
        if (seeding.current)
            return;
        const document = toRichTextDocument(editor.document);
        lastEmitted.current = document.content;
        onChange(document);
    }, [editor, onChange]);
    // Re-seed only when the value changed outside this editor. Comparing
    // canonical forms means a jsonb round trip (same content, reordered keys)
    // does not count as an external change.
    useEffect(() => {
        const stored = richTextContentOf(value);
        if (lastEmitted.current !== null && sameRichTextContent(lastEmitted.current, stored))
            return;
        if (lastEmitted.current === null && sameRichTextContent(editor.document, stored))
            return;
        lastEmitted.current = null;
        seeding.current = true;
        try {
            const blocks = representableBlocks(stored);
            editor.replaceBlocks(editor.document, blocks.length > 0 ? blocks : [{ type: "paragraph" }]);
        }
        finally {
            seeding.current = false;
        }
    }, [editor, value]);
    // BlockNote offers no prop for it, and the e2e suite (plus screen readers)
    // addresses the editing surface by its accessible name.
    useEffect(() => {
        const surface = containerRef.current?.querySelector("[contenteditable]");
        if (surface instanceof HTMLElement)
            surface.setAttribute("aria-label", fieldLabel(field));
    }, [editor, field, readOnly]);
    const canUpload = canUploadMedia && onUploadMedia !== undefined;
    const canInsertImage = !readOnly && (mediaItems.length > 0 || canUpload);
    const insertImage = useCallback((mediaId, alt, _contentUrl) => {
        setShowImageDialog(false);
        const cursor = editor.getTextCursorPosition();
        editor.insertBlocks([{ type: "mediaImage", props: { mediaId, alt } }], cursor.block, "after");
        editor.focus();
    }, [editor]);
    // Dropping or pasting an image uploads it first and inserts only on success,
    // so a failed upload never leaves a placeholder block behind in the document.
    const uploadAndInsert = useCallback(async (files) => {
        if (onUploadMedia === undefined)
            return;
        setUploadError(null);
        setUploading(true);
        try {
            for (const file of files) {
                const record = await onUploadMedia(file);
                insertImage(record.id, record.fileName);
            }
        }
        catch (error) {
            setUploadError(error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.");
        }
        finally {
            setUploading(false);
        }
    }, [onUploadMedia, insertImage]);
    // Capture phase, so image files are claimed before BlockNote's own file
    // handling sees them (its default file blocks are not in the schema).
    const claimImageFiles = useCallback((event) => {
        if (!canUpload || readOnly)
            return;
        const transfer = "dataTransfer" in event ? event.dataTransfer : event.clipboardData;
        const files = imageFilesIn(transfer);
        if (files.length === 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        void uploadAndInsert(files);
    }, [canUpload, readOnly, uploadAndInsert]);
    const slashMenuItems = useCallback(async (query) => {
        const items = getDefaultReactSlashMenuItems(editor);
        if (canInsertImage) {
            items.push({
                title: "이미지",
                subtext: "미디어 라이브러리에서 삽입",
                aliases: ["image", "img", "이미지", "사진", "그림"],
                group: ko.slash_menu.image.group,
                icon: _jsx(ImageGlyph, {}),
                onItemClick: () => setShowImageDialog(true),
            });
        }
        return filterSuggestionItems(items, query);
    }, [editor, canInsertImage]);
    return (_jsxs("div", { className: styles.field, children: [_jsxs("span", { className: styles.label, children: [fieldLabel(field), field.required ? _jsx("b", { "aria-hidden": "true", children: "*" }) : null] }), _jsxs("div", { ref: containerRef, className: styles.frame, "data-read-only": readOnly, "data-resizing": isResizing, onDropCapture: claimImageFiles, onPasteCapture: claimImageFiles, children: [_jsx("div", { ref: bodyRef, className: styles.body, 
                        // Before the first resize height is null → natural auto-growing height.
                        style: height === null ? undefined : { height, overflowY: "auto" }, children: _jsx(MediaLibraryContext.Provider, { value: mediaLibrary, children: _jsx(BlockNoteView, { editor: editor, theme: "light", editable: !readOnly, slashMenu: false, onChange: emit, onBlur: onBlur, children: _jsx(SuggestionMenuController, { triggerCharacter: "/", getItems: slashMenuItems }) }) }) }), isUploading ? _jsx("div", { className: styles.uploadBar, role: "status", children: "\uC774\uBBF8\uC9C0 \uC5C5\uB85C\uB4DC \uC911\u2026" }) : null, !readOnly ? (_jsx("div", { className: styles.resizeHandle, role: "separator", "aria-orientation": "horizontal", "aria-label": "\uBCF8\uBB38 \uB192\uC774 \uC870\uC808", title: "\uB4DC\uB798\uADF8\uD574\uC11C \uB192\uC774 \uC870\uC808", onPointerDown: onHandlePointerDown, children: _jsx("span", { className: styles.resizeGrip, "aria-hidden": "true" }) })) : null] }), uploadError !== null ? _jsx("small", { role: "alert", className: styles.error, children: uploadError }) : null, errorMessage ? _jsx("small", { role: "alert", className: styles.error, children: errorMessage }) : null, showImageDialog ? (_jsx(RichTextImageDialog, { mediaItems: mediaItems, canUpload: canUpload, ...(onUploadMedia === undefined ? {} : { onUpload: onUploadMedia }), onSelect: insertImage, onClose: () => setShowImageDialog(false) })) : null] }));
}
function initialBlocksOf(value) {
    const stored = representableBlocks(richTextContentOf(value));
    return stored.length > 0 ? stored : undefined;
}
/**
 * Drops blocks the current schema cannot represent (a retired block type, a
 * malformed entry): BlockNote throws on unknown node types, and one bad block
 * must not take the whole document form down.
 */
function representableBlocks(blocks) {
    const known = new Set(Object.keys(editorSchema.blockSchema));
    const keep = (list) => list
        .filter((block) => typeof block.type === "string" && known.has(block.type))
        .map((block) => (Array.isArray(block.children) ? { ...block, children: keep(block.children) } : block));
    return keep(blocks);
}
function ImageGlyph() {
    return (_jsxs("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", "aria-hidden": "true", children: [_jsx("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }), _jsx("circle", { cx: "9", cy: "10", r: "1.8" }), _jsx("path", { d: "m5 18 5-5 3 3 3.5-3.5L21 17" })] }));
}
//# sourceMappingURL=rich-text-editor.js.map