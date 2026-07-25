import { Button } from "@xecms/ui";
import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";

import styles from "./composed-editor.module.css";

interface DetailFieldProp {
  readonly fieldId: string;
  readonly protection?: { readonly mode: string; readonly maskPolicyId?: string };
}

export interface DetailPanelProps {
  readonly component: ComponentDefinition;
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
  readonly onRemove: () => void;
}

/** Inspector form for a `core.output.detail` component: Collection + Fields. */
export function DetailPanel({ component, collections, onChangeProps, onRemove }: DetailPanelProps) {
  const collectionId = typeof component.props["collectionId"] === "string" ? component.props["collectionId"] : "";
  const detailFields = Array.isArray(component.props["fields"]) ? (component.props["fields"] as DetailFieldProp[]) : [];
  const collection = collections.find((entry) => entry.id === collectionId);
  const fields = collection?.fields ?? [];

  const setCollection = (nextId: string): void => {
    onChangeProps({ ...component.props, collectionId: nextId, fields: [] });
  };

  const toggleField = (fieldId: string, checked: boolean): void => {
    const next = checked
      ? [...detailFields, { fieldId, protection: { mode: "normal" } }]
      : detailFields.filter((field) => field.fieldId !== fieldId);
    onChangeProps({ ...component.props, fields: next });
  };

  return (
    <div className={styles.dataForm}>
      <h4>상세 {component.id}</h4>
      <label className={styles.dataField}>
        <span>Collection</span>
        <select value={collectionId} onChange={(event) => setCollection(event.target.value)}>
          <option value="">선택…</option>
          {collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.name}</option>)}
        </select>
      </label>
      <div className={styles.dataField}>
        <span>표시 Field</span>
        <div className={styles.checkList}>
          {fields.length === 0 ? <small>Collection을 먼저 선택하세요.</small> : fields.map((field) => (
            <label key={field.id}>
              <input type="checkbox" checked={detailFields.some((f) => f.fieldId === field.id)} onChange={(event) => toggleField(field.id, event.target.checked)} />
              {field.label ?? field.name} <small>({field.type})</small>
            </label>
          ))}
        </div>
      </div>
      <Button size="small" variant="secondary" onPress={onRemove}>Component 제거</Button>
    </div>
  );
}
