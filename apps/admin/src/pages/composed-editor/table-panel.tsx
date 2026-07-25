import { Button } from "@xecms/ui";
import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";

import styles from "./composed-editor.module.css";

interface ColumnProp {
  readonly id: string;
  readonly fieldId?: string;
  readonly label?: string;
  readonly format?: string;
  readonly protection?: { readonly mode: string; readonly maskPolicyId?: string };
}

const FORMATS = ["auto", "text", "long-text", "number", "date", "datetime", "boolean", "badge"] as const;

export interface TablePanelProps {
  readonly component: ComponentDefinition;
  /** The Data Source (and thus Collection) whose rows this table renders, if wired. */
  readonly collectionId: string | undefined;
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
  readonly onRemove: () => void;
}

/** Inspector form for a `core.output.table`: column editing (field/label/format). */
export function TablePanel({ component, collectionId, collections, onChangeProps, onRemove }: TablePanelProps) {
  const columns = Array.isArray(component.props["columns"]) ? (component.props["columns"] as ColumnProp[]) : [];
  const collection = collections.find((entry) => entry.id === collectionId);
  const fields = collection?.fields ?? [];

  const setColumns = (next: readonly ColumnProp[]): void => onChangeProps({ ...component.props, columns: next });

  const addColumn = (): void => {
    const existing = new Set(columns.map((c) => c.id));
    let index = columns.length + 1;
    while (existing.has(`column_${index}`)) index += 1;
    setColumns([...columns, { id: `column_${index}`, protection: { mode: "normal" } }]);
  };

  const patchColumn = (id: string, patch: Partial<ColumnProp>): void => {
    setColumns(columns.map((column) => (column.id === id ? { ...column, ...patch } : column)));
  };

  const removeColumn = (id: string): void => setColumns(columns.filter((column) => column.id !== id));

  return (
    <div className={styles.dataForm}>
      <h4>목록 {component.id}</h4>
      {collectionId === undefined ? (
        <p className={styles.inspectorEmpty}>Data Source(rows)를 연결하면 그 Collection의 Field로 열을 구성할 수 있습니다.</p>
      ) : null}
      {columns.map((column) => (
        <div key={column.id} className={styles.dataField} style={{ borderTop: "1px solid var(--xe-color-border,#eee)", paddingTop: "0.4rem" }}>
          <div className={styles.dataFieldRow}>
            <select value={column.fieldId ?? ""} onChange={(event) => patchColumn(column.id, { fieldId: event.target.value || undefined })}>
              <option value="">Field 선택…</option>
              {fields.map((field) => <option key={field.id} value={field.id}>{field.label ?? field.name}</option>)}
            </select>
            <select value={column.format ?? "auto"} onChange={(event) => patchColumn(column.id, { format: event.target.value })}>
              {FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
            </select>
          </div>
          <input placeholder="열 제목(선택)" value={column.label ?? ""} onChange={(event) => patchColumn(column.id, { label: event.target.value || undefined })} />
          <button type="button" onClick={() => removeColumn(column.id)}>열 제거</button>
        </div>
      ))}
      <Button size="small" variant="secondary" onPress={addColumn}>+ 열</Button>
      <Button size="small" variant="secondary" onPress={onRemove}>Component 제거</Button>
    </div>
  );
}
