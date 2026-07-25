import { Button } from "@xecms/ui";
import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";

import styles from "./composed-editor.module.css";

interface FormFieldProp {
  readonly fieldId: string;
  readonly inputKind?: "text" | "number" | "date" | "textarea";
}

const KINDS = ["text", "number", "date", "textarea"] as const;

export interface FormPanelProps {
  readonly component: ComponentDefinition;
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
  readonly onRemove: () => void;
}

/**
 * Inspector for a `core.form` component: pick a Collection and the Fields to
 * collect. The form's values feed a create/update Action, whose permission the
 * server enforces — this panel only configures which inputs are shown.
 */
export function FormPanel({ component, collections, onChangeProps, onRemove }: FormPanelProps) {
  const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
  const collectionId = typeof component.props["collectionId"] === "string" ? component.props["collectionId"] : "";
  const formFields = Array.isArray(component.props["fields"]) ? (component.props["fields"] as FormFieldProp[]) : [];
  const collection = collections.find((entry) => entry.id === collectionId);
  const fields = collection?.fields ?? [];

  const setCollection = (nextId: string): void => onChangeProps({ ...component.props, collectionId: nextId, fields: [] });

  const toggleField = (fieldId: string, checked: boolean): void => {
    const next = checked
      ? [...formFields, { fieldId }]
      : formFields.filter((field) => field.fieldId !== fieldId);
    onChangeProps({ ...component.props, fields: next });
  };

  const patchKind = (fieldId: string, inputKind: FormFieldProp["inputKind"]): void => {
    onChangeProps({
      ...component.props,
      fields: formFields.map((field) => (field.fieldId === fieldId ? { ...field, inputKind } : field)),
    });
  };

  return (
    <div className={styles.dataForm}>
      <h4>입력 폼 {component.id}</h4>
      <label className={styles.dataField}>
        <span>제목</span>
        <input value={label} onChange={(event) => onChangeProps({ ...component.props, label: event.target.value })} />
      </label>
      <label className={styles.dataField}>
        <span>Collection</span>
        <select value={collectionId} onChange={(event) => setCollection(event.target.value)}>
          <option value="">선택…</option>
          {collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.name}</option>)}
        </select>
      </label>
      <div className={styles.dataField}>
        <span>입력 Field</span>
        <div className={styles.checkList}>
          {fields.length === 0 ? <small>Collection을 먼저 선택하세요.</small> : fields.map((field) => {
            const active = formFields.find((f) => f.fieldId === field.id);
            return (
              <div key={field.id}>
                <label>
                  <input type="checkbox" checked={active !== undefined} onChange={(event) => toggleField(field.id, event.target.checked)} />
                  {field.label ?? field.name} <small>({field.type})</small>
                </label>
                {active !== undefined ? (
                  <select value={active.inputKind ?? "text"} onChange={(event) => patchKind(field.id, event.target.value as FormFieldProp["inputKind"])}>
                    {KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <Button size="small" variant="secondary" onPress={onRemove}>Component 제거</Button>
    </div>
  );
}
