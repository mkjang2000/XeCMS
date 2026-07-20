import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { MediaImage } from "./rich-text-image.js";
import { RichTextImageDialog } from "./rich-text-image-dialog.js";
import { RichTextLinkDialog } from "./rich-text-link-dialog.js";
import { RichTextToolbar } from "./rich-text-toolbar.js";
import { richTextContentOf, toRichTextDocument, withResolvedImageSources, } from "./rich-text-document.js";
import styles from "./rich-text-editor.module.css";
function fieldLabel(field) {
    return field.label?.trim() || field.name;
}
function imageFilesIn(list) {
    if (list === null)
        return [];
    return [...list.files].filter((file) => file.type.startsWith("image/"));
}
/**
 * TipTap-backed editor for `rich-text` fields.
 *
 * The stored format is ProseMirror JSON under a versioned envelope, so the tree
 * round-trips without a converter: marks, attrs and nesting survive an edit
 * untouched. (The previous textarea fallback flattened everything to plain text
 * and silently destroyed formatting on save.)
 */
export function RichTextEditor({ field, value, errorMessage, onChange, onBlur, isDisabled, mediaItems = [], onUploadMedia, canUploadMedia = false, }) {
    const readOnly = isDisabled === true || field.readOnly === true;
    const [showImageDialog, setShowImageDialog] = useState(false);
    const [linkDraft, setLinkDraft] = useState(null);
    const [isUploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    // Latest value written by this editor, used to tell our own updates apart from
    // an external change (refetch, revision restore) that must reset the content.
    const lastEmitted = useRef(null);
    // handleDrop/handlePaste are built before `editor` exists, so they reach the
    // live instance through this ref instead of closing over a stale value.
    const editorRef = useRef(null);
    // Selection captured before a dialog steals focus, so an insert lands where
    // the user was typing rather than over the whole document.
    const savedSelection = useRef(null);
    const storedContent = useMemo(() => richTextContentOf(value), [value]);
    const resolvedContent = useMemo(() => withResolvedImageSources(storedContent, mediaItems), [storedContent, mediaItems]);
    // Seeding the editor (mount, external reload) must never look like a user
    // edit: StrictMode's discarded first instance would otherwise emit its empty
    // document and overwrite the value the form just loaded.
    const seeding = useRef(true);
    const emit = useCallback((editor) => {
        if (seeding.current)
            return;
        const content = (editor.getJSON().content ?? []);
        const document = toRichTextDocument(content);
        lastEmitted.current = document.content;
        onChange(document);
    }, [onChange]);
    const canUpload = canUploadMedia && onUploadMedia !== undefined;
    // Dropping or pasting an image uploads it first and inserts only on success,
    // so a failed upload never leaves a placeholder node behind in the document.
    const uploadAndInsert = useCallback(async (editor, files) => {
        if (onUploadMedia === undefined)
            return;
        setUploadError(null);
        setUploading(true);
        try {
            for (const file of files) {
                const record = await onUploadMedia(file);
                editor.chain().focus().insertContent({
                    type: "image",
                    attrs: { mediaId: record.id, alt: record.fileName, src: record.contentUrl },
                }).run();
            }
        }
        catch (error) {
            setUploadError(error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.");
        }
        finally {
            setUploading(false);
        }
    }, [onUploadMedia]);
    const editor = useEditor({
        extensions: [
            StarterKit.configure({ link: { openOnClick: false } }),
            Underline,
            TextStyle,
            Color,
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            Table.configure({ resizable: true }),
            TableRow,
            TableHeader,
            TableCell,
            MediaImage,
        ],
        content: { type: "doc", content: resolvedContent },
        editable: !readOnly,
        // React 19 + StrictMode mounts twice; rendering on the first pass leaves a
        // detached editor whose later setContent never reaches the visible DOM.
        immediatelyRender: false,
        editorProps: {
            attributes: { class: styles.surface, "aria-label": fieldLabel(field) },
            handleDrop: (view, event) => {
                const files = imageFilesIn(event.dataTransfer);
                if (files.length === 0 || !canUpload || readOnly)
                    return false;
                event.preventDefault();
                const instance = editorRef.current;
                if (instance !== null)
                    void uploadAndInsert(instance, files);
                return true;
            },
            handlePaste: (view, event) => {
                const files = imageFilesIn(event.clipboardData);
                if (files.length === 0 || !canUpload || readOnly)
                    return false;
                event.preventDefault();
                const instance = editorRef.current;
                if (instance !== null)
                    void uploadAndInsert(instance, files);
                return true;
            },
        },
        onUpdate: ({ editor: instance }) => emit(instance),
        onBlur: () => onBlur?.(),
    });
    useEffect(() => { editorRef.current = editor; }, [editor]);
    useEffect(() => {
        editor?.setEditable(!readOnly);
    }, [editor, readOnly]);
    // Read at re-seed time only. Uploading an image refreshes the media list,
    // which rebuilds resolvedContent into a new array with identical meaning —
    // depending on it here would re-seed and wipe whatever was just typed.
    const resolvedRef = useRef(resolvedContent);
    resolvedRef.current = resolvedContent;
    // Re-seed only when the value changed outside this editor; resetting on our
    // own emissions would fight the cursor and loop.
    useEffect(() => {
        if (editor === null)
            return;
        if (lastEmitted.current !== null && sameTree(lastEmitted.current, storedContent)) {
            seeding.current = false;
            return;
        }
        lastEmitted.current = null;
        seeding.current = true;
        editor.commands.setContent({ type: "doc", content: resolvedRef.current }, { emitUpdate: false });
        seeding.current = false;
    }, [editor, storedContent]);
    const insertImage = (mediaId, alt, contentUrl) => {
        setShowImageDialog(false);
        if (editor === null)
            return;
        // src is display-only (stripped before saving), but including it here makes
        // a freshly uploaded image visible without waiting for the media refetch.
        const src = contentUrl ?? mediaItems.find((item) => item.id === mediaId)?.contentUrl;
        // Opening the dialog moved focus out of the editor, which leaves the stored
        // selection spanning the whole document — inserting there would replace the
        // entire body. Put the caret back where the user left it first.
        // Collapse to the caret before inserting. An untouched editor reports a
        // selection spanning the whole document, and inserting over that range
        // would replace the entire body instead of adding to it.
        const caret = savedSelection.current?.to ?? editor.state.doc.content.size;
        editor.chain()
            .focus()
            .setTextSelection(caret)
            .insertContent({ type: "image", attrs: { mediaId, alt, ...(src === undefined ? {} : { src }) } })
            .run();
    };
    const canInsertImage = !readOnly && (mediaItems.length > 0 || canUpload);
    return (_jsxs("div", { className: styles.field, children: [_jsxs("span", { className: styles.label, children: [fieldLabel(field), field.required ? _jsx("b", { "aria-hidden": "true", children: "*" }) : null] }), _jsxs("div", { className: styles.frame, "data-read-only": readOnly, children: [!readOnly && editor !== null ? (_jsx(RichTextToolbar, { editor: editor, label: fieldLabel(field), canInsertImage: canInsertImage, onInsertImage: () => {
                            savedSelection.current = { from: editor.state.selection.from, to: editor.state.selection.to };
                            setShowImageDialog(true);
                        }, onEditLink: () => {
                            const { from, to, empty } = editor.state.selection;
                            // A never-focused editor reports the whole document as selected;
                            // treating that as the user's choice would link the entire body.
                            const spansWholeDoc = from <= 1 && to >= editor.state.doc.content.size;
                            savedSelection.current = empty || spansWholeDoc ? null : { from, to };
                            setLinkDraft(editor.getAttributes("link")["href"] ?? "");
                        } })) : null, _jsx(EditorContent, { editor: editor, className: styles.body, "data-read-only": readOnly }), isUploading ? _jsx("div", { className: styles.uploadBar, role: "status", children: "\uC774\uBBF8\uC9C0 \uC5C5\uB85C\uB4DC \uC911\u2026" }) : null] }), uploadError !== null ? _jsx("small", { role: "alert", className: styles.error, children: uploadError }) : null, errorMessage ? _jsx("small", { role: "alert", className: styles.error, children: errorMessage }) : null, showImageDialog ? (_jsx(RichTextImageDialog, { mediaItems: mediaItems, canUpload: canUploadMedia && onUploadMedia !== undefined, ...(onUploadMedia === undefined ? {} : { onUpload: onUploadMedia }), onSelect: insertImage, onClose: () => setShowImageDialog(false) })) : null, linkDraft !== null && editor !== null ? (_jsx(RichTextLinkDialog, { initialHref: linkDraft, onSubmit: (href) => {
                    const at = savedSelection.current;
                    setLinkDraft(null);
                    editor.chain()
                        .focus()
                        .command(({ commands }) => (at === null ? true : commands.setTextSelection(at)))
                        .extendMarkRange("link")
                        .setLink({ href })
                        .run();
                }, onRemove: () => {
                    const at = savedSelection.current;
                    setLinkDraft(null);
                    editor.chain()
                        .focus()
                        .command(({ commands }) => (at === null ? true : commands.setTextSelection(at)))
                        .extendMarkRange("link")
                        .unsetLink()
                        .run();
                }, onClose: () => setLinkDraft(null) })) : null] }));
}
function sameTree(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
//# sourceMappingURL=rich-text-editor.js.map