import { useRef, useState } from "react";
import { ConfirmDialog, TextInput } from "@xecms/ui";
import type { MediaRecord } from "@xecms/admin";
import { FormatIcon } from "./format-icons.js";
import styles from "./rich-text-editor.module.css";

/**
 * Picks an image for the body: either an existing library item or a file
 * uploaded on the spot.
 *
 * Upload deliberately inserts nothing until the server returns a media id — an
 * optimistic placeholder node would leave debris in the document when an upload
 * fails, and the document is the thing we must not corrupt.
 */
export function RichTextImageDialog({ mediaItems, canUpload, onUpload, onSelect, onClose }: {
  readonly mediaItems: readonly MediaRecord[];
  readonly canUpload: boolean;
  readonly onUpload?: (file: File) => Promise<MediaRecord>;
  readonly onSelect: (mediaId: string, alt: string, contentUrl?: string) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setUploading] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const images = mediaItems.filter(
    (item) => item.mimeType.startsWith("image/") && item.status === "available",
  );
  const needle = query.trim().toLowerCase();
  const matches = needle === ""
    ? images
    : images.filter((item) => item.fileName.toLowerCase().includes(needle));
  const shown = matches.slice(0, 50);

  const upload = async (file: File) => {
    if (onUpload === undefined || isUploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const record = await onUpload(file);
      // The media list has not refetched yet, so hand the URL over directly.
      onSelect(record.id, record.fileName, record.contentUrl);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ConfirmDialog
      title="이미지 넣기"
      // Choosing happens by clicking a row, so the footer only needs a way out.
      confirmLabel="닫기"
      hideCancel
      onCancel={onClose}
      onConfirm={onClose}
    >
      <div className={styles.pickerDialog}>
        {canUpload ? (
          <>
            <div
              className={styles.pickerUpload}
              data-dragging={isDragging}
              role="button"
              tabIndex={0}
              aria-label="이미지 업로드"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
                if (file !== undefined) void upload(file);
              }}
            >
              <span className={styles.pickerUploadIcon}><FormatIcon name="image" size={24} /></span>
              <span className={styles.pickerUploadTitle}>
                {isUploading ? "업로드 중…" : "이미지를 끌어다 놓거나 클릭해 선택"}
              </span>
              <span className={styles.pickerHint}>미디어 라이브러리에 저장된 뒤 본문에 삽입됩니다.</span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              disabled={isUploading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) void upload(file);
              }}
            />
          </>
        ) : null}
        {uploadError !== null ? <p className={styles.pickerError} role="alert">{uploadError}</p> : null}

        <TextInput label="이미지 검색" placeholder="파일 이름으로 검색" value={query} onChange={setQuery} />
        {images.length === 0 ? (
          <p className={styles.pickerEmpty}>
            {canUpload
              ? "라이브러리에 이미지가 없습니다. 위에서 새 이미지를 올려 주세요."
              : "먼저 미디어 라이브러리에 이미지를 업로드해 주세요."}
          </p>
        ) : shown.length === 0 ? (
          <p className={styles.pickerEmpty}>검색 결과가 없습니다.</p>
        ) : (
          <ul className={styles.pickerList}>
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.pickerRow}
                  disabled={isUploading}
                  onClick={() => onSelect(item.id, item.fileName)}
                >
                  <img src={item.contentUrl} alt="" loading="lazy" className={styles.pickerThumb} />
                  <span className={styles.pickerName}>{item.fileName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {matches.length > shown.length ? (
          <p className={styles.pickerHint}>{matches.length}개 중 {shown.length}개 표시 — 검색으로 좁혀 주세요.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
