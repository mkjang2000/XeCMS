import type { DocumentFieldEditorProps } from "@xecms/admin";
/**
 * TipTap-backed editor for `rich-text` fields.
 *
 * The stored format is ProseMirror JSON under a versioned envelope, so the tree
 * round-trips without a converter: marks, attrs and nesting survive an edit
 * untouched. (The previous textarea fallback flattened everything to plain text
 * and silently destroyed formatting on save.)
 */
export declare function RichTextEditor({ field, value, errorMessage, onChange, onBlur, isDisabled, mediaItems, onUploadMedia, canUploadMedia, }: DocumentFieldEditorProps): import("react").JSX.Element;
//# sourceMappingURL=rich-text-editor.d.ts.map