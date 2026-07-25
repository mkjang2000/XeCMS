import { Button } from "@xecms/ui";
import type { ComponentDefinition } from "@xecms/admin-apps";

import styles from "./composed-editor.module.css";

interface VariantProp {
  readonly id: string;
  readonly label?: string;
  readonly inputKind?: "text" | "number" | "date" | "select";
}

const KINDS = ["text", "number", "date", "select"] as const;

export interface AdaptivePanelProps {
  readonly component: ComponentDefinition;
  readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
  readonly onRemove: () => void;
}

/**
 * Inspector form for a `core.input.adaptive` component. Each variant becomes an
 * output port (`value:<id>`) the Builder wires to a State → Data Source
 * parameter; the runtime fills only the active variant so hidden values never
 * reach the query.
 */
export function AdaptivePanel({ component, onChangeProps, onRemove }: AdaptivePanelProps) {
  const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
  const variants = Array.isArray(component.props["variants"]) ? (component.props["variants"] as VariantProp[]) : [];

  const setVariants = (next: readonly VariantProp[]): void => onChangeProps({ ...component.props, variants: next });

  const addVariant = (): void => {
    const existing = new Set(variants.map((v) => v.id));
    let index = variants.length + 1;
    while (existing.has(`v_${index}`)) index += 1;
    const id = `v_${index}`;
    setVariants([...variants, { id, label: `형식 ${index}`, inputKind: "text" }]);
  };

  const patchVariant = (id: string, patch: Partial<VariantProp>): void => {
    setVariants(variants.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));
  };

  const removeVariant = (id: string): void => setVariants(variants.filter((variant) => variant.id !== id));

  return (
    <div className={styles.dataForm}>
      <h4>적응형 검색 {component.id}</h4>
      <label className={styles.dataField}>
        <span>Label</span>
        <input value={label} onChange={(event) => onChangeProps({ ...component.props, label: event.target.value })} />
      </label>
      <div className={styles.dataField}>
        <span>형식(variant)</span>
        <p className={styles.inspectorEmpty}>각 형식은 출력 Port로 노출됩니다. 연결 모드에서 State→Data Source 파라미터로 연결하세요.</p>
        {variants.map((variant) => (
          <div key={variant.id} className={styles.dataField} style={{ borderTop: "1px solid var(--xe-color-border,#eee)", paddingTop: "0.4rem" }}>
            <div className={styles.dataFieldRow}>
              <input placeholder="이름" value={variant.label ?? ""} onChange={(event) => patchVariant(variant.id, { label: event.target.value || undefined })} />
              <select value={variant.inputKind ?? "text"} onChange={(event) => patchVariant(variant.id, { inputKind: event.target.value as VariantProp["inputKind"] })}>
                {KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </div>
            <code>value:{variant.id}</code>
            <button type="button" onClick={() => removeVariant(variant.id)}>형식 제거</button>
          </div>
        ))}
        <Button size="small" variant="secondary" onPress={addVariant}>+ 형식</Button>
      </div>
      <Button size="small" variant="secondary" onPress={onRemove}>Component 제거</Button>
    </div>
  );
}
