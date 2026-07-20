import "@blocknote/mantine/style.css";
import type { DocumentFieldEditorProps } from "@xecms/admin";
/**
 * BlockNote-backed editor for `rich-text` fields.
 *
 * The stored format is the BlockNote block tree under the versioned v2
 * envelope, so documents round-trip without a converter. Formatting toolbar,
 * slash menu, tables and drag handles come from BlockNote; this wrapper owns
 * the form contract (value in / document out) and the media integration.
 */
export declare function RichTextEditor({ field, value, errorMessage, onChange, onBlur, isDisabled, mediaItems, onUploadMedia, canUploadMedia, }: DocumentFieldEditorProps): import("react").JSX.Element;
//# sourceMappingURL=rich-text-editor.d.ts.map