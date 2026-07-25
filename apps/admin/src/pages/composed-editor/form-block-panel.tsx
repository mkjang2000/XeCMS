import { Button } from "@xecms/ui";
import type { CollectionSummaryDto } from "@xecms/client";
import type { ComposedPageDefinition } from "@xecms/admin-apps";

import {
  blockFields,
  blockKindLabel,
  blockLabels,
  blockSearchField,
  isSearchBlock,
  reconfigureBlock,
  setComponentLabel,
  type FormBlock,
  type FormBlockField,
} from "./form-blocks.js";
import styles from "./composed-editor.module.css";

export interface FormBlockPanelProps {
  readonly page: ComposedPageDefinition;
  readonly block: FormBlock;
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChange: (next: ComposedPageDefinition) => void;
  readonly onRemove: () => void;
}

const KIND_HELP: Partial<Readonly<Record<FormBlock["kind"], string>>> = {
  search: "스키마에서 조건에 맞는 행을 찾아, 연결된 폼으로 결과를 넘깁니다.",
  "date-search": "시작~끝 날짜 범위로 검색합니다.",
  "select-search": "정해진 값 중 하나를 골라 검색합니다. 선택 항목은 아래 목록에서 편집하세요.",
  "number-search": "최소~최대 숫자 범위로 검색합니다.",
  "multi-search": "여러 필드를 동시에(AND) 검색합니다.",
  list: "여러 행을 표로 보여줍니다. 검색폼에 연결하면 검색 결과를 표시합니다.",
  cards: "여러 행을 카드로 보여줍니다. 검색폼에 연결하면 검색 결과를 표시합니다.",
  detail: "한 행의 상세를 보여줍니다. 검색폼·목록에 연결하면 선택한 행을 표시합니다.",
  field: "한 필드 값을 크게 보여줍니다. 목록·검색폼에 연결하세요.",
  "input-form": "새 행을 입력해 저장합니다.",
  "item-actions": "선택한 행을 수정하거나 삭제합니다. 목록에 연결해 대상을 지정하세요.",
};

function kindHelp(kind: FormBlock["kind"]): string {
  return KIND_HELP[kind] ?? "";
}

/**
 * The block-level inspector — the primary editing surface for a "전산 사용자".
 * It speaks in schemas and fields, never ports or state; reconfiguring rebuilds
 * the block's atoms in place (`reconfigureBlock`) under the same block id.
 */
export function FormBlockPanel({ page, block, collections, onChange, onRemove }: FormBlockPanelProps) {
  const collectionId = block.collectionId ?? "";
  const collection = collections.find((entry) => entry.id === collectionId);
  const fields = blockFields(page, block);
  const searchFieldId = blockSearchField(page, block);
  const selectedIds = new Set(fields.map((field) => field.fieldId));
  const labels = blockLabels(page, block);

  const apply = (nextFields: readonly FormBlockField[], nextCollectionId = collectionId, nextSearchField = searchFieldId): void => {
    onChange(reconfigureBlock(page, block, {
      collectionId: nextCollectionId,
      fields: nextFields,
      ...(nextSearchField === undefined ? {} : { searchFieldId: nextSearchField }),
    }));
  };

  const changeCollection = (nextId: string): void => {
    // Switching schema resets fields/search (they reference the old schema).
    onChange(reconfigureBlock(page, block, { collectionId: nextId, fields: [] }));
  };

  const toggleField = (fieldId: string, label: string, checked: boolean): void => {
    const next = checked
      ? [...fields, { fieldId, label }]
      : fields.filter((field) => field.fieldId !== fieldId);
    apply(next, collectionId, checked ? searchFieldId : (searchFieldId === fieldId ? undefined : searchFieldId));
  };

  return (
    <div className={styles.dataForm}>
      <h4>{blockKindLabel(block.kind)}</h4>
      <p className={styles.inspectorEmpty}>{kindHelp(block.kind)}</p>

      <label className={styles.dataField}>
        <span>스키마</span>
        <select value={collectionId} onChange={(event) => changeCollection(event.target.value)}>
          <option value="">선택…</option>
          {collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.name}</option>)}
        </select>
      </label>

      {isSearchBlock(block.kind) ? (
        <label className={styles.dataField}>
          <span>검색할 필드</span>
          <select value={searchFieldId ?? ""} onChange={(event) => apply(fields, collectionId, event.target.value || undefined)}>
            <option value="">선택…</option>
            {(collection?.fields ?? []).map((field) => <option key={field.id} value={field.id}>{field.label ?? field.name}</option>)}
          </select>
        </label>
      ) : null}

      {block.kind === "item-actions" ? (
        <p className={styles.inspectorEmpty}>이 폼은 목록에 연결한 뒤, 선택된 행을 수정·삭제합니다. 필드 설정은 필요 없습니다.</p>
      ) : (
        <div className={styles.dataField}>
          <span>{block.kind === "input-form" ? "입력 필드" : block.kind === "field" ? "표시할 필드(1개)" : "표시 필드"}</span>
          <div className={styles.checkList}>
            {collection === undefined ? <small>스키마를 먼저 선택하세요.</small>
              : collection.fields.length === 0 ? <small>이 스키마에는 필드가 없습니다.</small>
                : collection.fields.map((field) => (
                  <label key={field.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(field.id)}
                      onChange={(event) => toggleField(field.id, field.label ?? field.name, event.target.checked)}
                    />
                    {field.label ?? field.name} <small>({field.type})</small>
                  </label>
                ))}
          </div>
        </div>
      )}

      {labels.length > 0 ? (
        <div className={styles.dataField}>
          <span>텍스트</span>
          {labels.map((entry) => (
            <div key={entry.componentId} className={styles.dataField}>
              <small>{entry.role}</small>
              <input value={entry.value} onChange={(event) => onChange(setComponentLabel(page, entry.componentId, event.target.value))} />
            </div>
          ))}
        </div>
      ) : null}

      <Button size="small" variant="secondary" onPress={onRemove}>폼 제거</Button>
    </div>
  );
}
