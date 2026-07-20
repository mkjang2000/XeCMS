import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from "@blocknote/core";
import { ko } from "@blocknote/core/locales";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import type { DocumentFieldEditorProps, MediaRecord } from "@xecms/admin";
import { MediaLibraryContext, mediaImageSpec, mediaRecordMap } from "./media-image-block.js";
import { RichTextImageDialog } from "./rich-text-image-dialog.js";
import {
  richTextContentOf,
  sameRichTextContent,
  toRichTextDocument,
  type RichTextBlock,
} from "./rich-text-document.js";
import styles from "./rich-text-editor.module.css";

// URL-storing file blocks are cut from the schema: persisted URLs rot when the
// deployment moves, so images go through the mediaId-based block instead.
const { audio: _audio, image: _image, video: _video, file: _file, ...retainedBlockSpecs } = defaultBlockSpecs;

const editorSchema = BlockNoteSchema.create({
  blockSpecs: { ...retainedBlockSpecs, mediaImage: mediaImageSpec() },
});

type EditorPartialBlock = typeof editorSchema.PartialBlock;

function fieldLabel(field: DocumentFieldEditorProps["field"]): string {
  return field.label?.trim() || field.name;
}

function imageFilesIn(list: DataTransfer | null): readonly File[] {
  if (list === null) return [];
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
export function RichTextEditor({
  field,
  value,
  errorMessage,
  onChange,
  onBlur,
  isDisabled,
  mediaItems = [],
  onUploadMedia,
  canUploadMedia = false,
}: DocumentFieldEditorProps) {
  const readOnly = isDisabled === true || field.readOnly === true;
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [isUploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest content emitted by this editor, used to tell our own updates apart
  // from an external change (refetch, revision restore) that must reset it.
  const lastEmitted = useRef<readonly RichTextBlock[] | null>(null);
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
    if (seeding.current) return;
    const document = toRichTextDocument(editor.document as unknown as readonly RichTextBlock[]);
    lastEmitted.current = document.content;
    onChange(document);
  }, [editor, onChange]);

  // Re-seed only when the value changed outside this editor. Comparing
  // canonical forms means a jsonb round trip (same content, reordered keys)
  // does not count as an external change.
  useEffect(() => {
    const stored = richTextContentOf(value);
    if (lastEmitted.current !== null && sameRichTextContent(lastEmitted.current, stored)) return;
    if (lastEmitted.current === null && sameRichTextContent(editor.document as unknown as readonly RichTextBlock[], stored)) return;
    lastEmitted.current = null;
    seeding.current = true;
    try {
      const blocks = representableBlocks(stored);
      editor.replaceBlocks(
        editor.document,
        blocks.length > 0 ? (blocks as unknown as EditorPartialBlock[]) : [{ type: "paragraph" }],
      );
    } finally {
      seeding.current = false;
    }
  }, [editor, value]);

  // BlockNote offers no prop for it, and the e2e suite (plus screen readers)
  // addresses the editing surface by its accessible name.
  useEffect(() => {
    const surface = containerRef.current?.querySelector("[contenteditable]");
    if (surface instanceof HTMLElement) surface.setAttribute("aria-label", fieldLabel(field));
  }, [editor, field, readOnly]);

  const canUpload = canUploadMedia && onUploadMedia !== undefined;
  const canInsertImage = !readOnly && (mediaItems.length > 0 || canUpload);

  const insertImage = useCallback((mediaId: string, alt: string, _contentUrl?: string) => {
    setShowImageDialog(false);
    const cursor = editor.getTextCursorPosition();
    editor.insertBlocks([{ type: "mediaImage", props: { mediaId, alt } }], cursor.block, "after");
    editor.focus();
  }, [editor]);

  // Dropping or pasting an image uploads it first and inserts only on success,
  // so a failed upload never leaves a placeholder block behind in the document.
  const uploadAndInsert = useCallback(async (files: readonly File[]) => {
    if (onUploadMedia === undefined) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const record: MediaRecord = await onUploadMedia(file);
        insertImage(record.id, record.fileName);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }, [onUploadMedia, insertImage]);

  // Capture phase, so image files are claimed before BlockNote's own file
  // handling sees them (its default file blocks are not in the schema).
  const claimImageFiles = useCallback((event: React.DragEvent | React.ClipboardEvent) => {
    if (!canUpload || readOnly) return;
    const transfer = "dataTransfer" in event ? event.dataTransfer : event.clipboardData;
    const files = imageFilesIn(transfer);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadAndInsert(files);
  }, [canUpload, readOnly, uploadAndInsert]);

  const slashMenuItems = useCallback(async (query: string) => {
    const items = getDefaultReactSlashMenuItems(editor);
    if (canInsertImage) {
      items.push({
        title: "이미지",
        subtext: "미디어 라이브러리에서 삽입",
        aliases: ["image", "img", "이미지", "사진", "그림"],
        group: ko.slash_menu.image.group,
        icon: <ImageGlyph />,
        onItemClick: () => setShowImageDialog(true),
      });
    }
    return filterSuggestionItems(items, query);
  }, [editor, canInsertImage]);

  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {fieldLabel(field)}
        {field.required ? <b aria-hidden="true">*</b> : null}
      </span>
      <div
        ref={containerRef}
        className={styles.frame}
        data-read-only={readOnly}
        onDropCapture={claimImageFiles}
        onPasteCapture={claimImageFiles}
      >
        <MediaLibraryContext.Provider value={mediaLibrary}>
          <BlockNoteView
            editor={editor}
            theme="light"
            editable={!readOnly}
            slashMenu={false}
            onChange={emit}
            onBlur={onBlur}
          >
            <SuggestionMenuController triggerCharacter="/" getItems={slashMenuItems} />
          </BlockNoteView>
        </MediaLibraryContext.Provider>
        {isUploading ? <div className={styles.uploadBar} role="status">이미지 업로드 중…</div> : null}
      </div>
      {uploadError !== null ? <small role="alert" className={styles.error}>{uploadError}</small> : null}
      {errorMessage ? <small role="alert" className={styles.error}>{errorMessage}</small> : null}
      {showImageDialog ? (
        <RichTextImageDialog
          mediaItems={mediaItems}
          canUpload={canUpload}
          {...(onUploadMedia === undefined ? {} : { onUpload: onUploadMedia })}
          onSelect={insertImage}
          onClose={() => setShowImageDialog(false)}
        />
      ) : null}
    </div>
  );
}

function initialBlocksOf(value: unknown): EditorPartialBlock[] | undefined {
  const stored = representableBlocks(richTextContentOf(value));
  return stored.length > 0 ? (stored as unknown as EditorPartialBlock[]) : undefined;
}

/**
 * Drops blocks the current schema cannot represent (a retired block type, a
 * malformed entry): BlockNote throws on unknown node types, and one bad block
 * must not take the whole document form down.
 */
function representableBlocks(blocks: readonly RichTextBlock[]): readonly RichTextBlock[] {
  const known = new Set(Object.keys(editorSchema.blockSchema));
  const keep = (list: readonly RichTextBlock[]): RichTextBlock[] => list
    .filter((block) => typeof block.type === "string" && known.has(block.type))
    .map((block) => (Array.isArray(block.children) ? { ...block, children: keep(block.children) } : block));
  return keep(blocks);
}

function ImageGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m5 18 5-5 3 3 3.5-3.5L21 17" />
    </svg>
  );
}
