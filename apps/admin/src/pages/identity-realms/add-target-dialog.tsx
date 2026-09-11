import { useState } from "react";
import { Badge, ConfirmDialog, TextInput } from "@xecms/ui";
import styles from "../../identity-realms.module.css";

/**
 * Searchable "add" picker. Configured rows live in the section table; every
 * remaining candidate is reachable only from here, so the table stays as short
 * as what is actually configured no matter how many candidates exist.
 */
export function AddTargetDialog<T>({ title, description, searchLabel, items, keyOf, labelOf, hintOf, disabledReasonOf, emptyText, onPick, onClose }: {
  readonly title: string;
  readonly description: string;
  readonly searchLabel: string;
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  readonly labelOf: (item: T) => string;
  readonly hintOf?: (item: T) => string | undefined;
  readonly disabledReasonOf?: (item: T) => string | undefined;
  readonly emptyText: string;
  readonly onPick: (item: T) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = needle === ""
    ? items
    : items.filter((item) => {
        const hint = hintOf?.(item);
        return labelOf(item).toLowerCase().includes(needle)
          || keyOf(item).toLowerCase().includes(needle)
          || (hint !== undefined && hint.toLowerCase().includes(needle));
      });
  // Long candidate lists stay usable: the list scrolls, and search narrows it.
  const shown = matches.slice(0, 50);

  return (
    <ConfirmDialog
      title={title}
      confirmLabel="닫기"
      onCancel={onClose}
      onConfirm={onClose}
    >
      <div className={styles.pickerDialog}>
        <p className={styles.compactHint}>{description}</p>
        <TextInput
          label={searchLabel}
          placeholder="이름으로 검색"
          value={query}
          onChange={setQuery}
        />
        {items.length === 0 ? (
          <p className={styles.pickerEmpty}>{emptyText}</p>
        ) : shown.length === 0 ? (
          <p className={styles.pickerEmpty}>검색 결과가 없습니다.</p>
        ) : (
          <ul className={styles.pickerList}>
            {shown.map((item) => {
              const disabledReason = disabledReasonOf?.(item);
              const hint = hintOf?.(item);
              return (
                <li key={keyOf(item)}>
                  <button
                    type="button"
                    className={styles.pickerRow}
                    disabled={disabledReason !== undefined}
                    onClick={() => onPick(item)}
                  >
                    <span className={styles.pickerRowMain}>
                      <strong>{labelOf(item)}</strong>
                      {hint !== undefined ? <span className={styles.secondaryLine}>{hint}</span> : null}
                    </span>
                    {disabledReason !== undefined ? (
                      <Badge tone="neutral">{disabledReason}</Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {matches.length > shown.length ? (
          <p className={styles.compactHint}>{matches.length}개 중 {shown.length}개 표시 — 검색으로 좁혀 주세요.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
