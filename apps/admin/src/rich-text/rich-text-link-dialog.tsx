import { useState } from "react";
import { ConfirmDialog, TextInput } from "@xecms/ui";
import styles from "./rich-text-editor.module.css";

/** Replaces window.prompt so link editing looks like the rest of the studio. */
export function RichTextLinkDialog({ initialHref, onSubmit, onRemove, onClose }: {
  readonly initialHref: string;
  readonly onSubmit: (href: string) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}) {
  const [href, setHref] = useState(initialHref);
  const trimmed = href.trim();
  const isEditing = initialHref !== "";

  return (
    <ConfirmDialog
      title={isEditing ? "링크 편집" : "링크 넣기"}
      confirmLabel={isEditing ? "저장" : "넣기"}
      cancelLabel={isEditing ? "링크 제거" : "취소"}
      isConfirmDisabled={trimmed === ""}
      onCancel={() => { if (isEditing) onRemove(); else onClose(); }}
      onConfirm={() => { if (trimmed !== "") onSubmit(trimmed); }}
    >
      <div className={styles.linkDialog}>
        <TextInput
          label="링크 주소"
          placeholder="https://example.com"
          value={href}
          onChange={setHref}
          autoFocus
        />
        <p className={styles.pickerHint}>
          선택한 글자에 링크가 걸립니다. 주소는 https:// 로 시작하는 것을 권장합니다.
        </p>
      </div>
    </ConfirmDialog>
  );
}
