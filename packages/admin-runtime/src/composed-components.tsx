import { Component, useState, type ReactNode } from "react";
import type { ComponentDefinition, RuleCondition } from "@xecms/admin-apps";

import { ChartOutput } from "./composed-chart.js";
import { evaluateCondition } from "./composed-effects.js";
import { formatFieldValue, type FormattedValue, type OutputFormat } from "./composed-format.js";
import { useComposedRuntime, type ComposedRuntimeContextValue } from "./composed-runtime.js";
import styles from "../src/runtime.module.css";

export interface ComposedComponentProps {
  readonly component: ComponentDefinition;
}

type ComposedComponent = (props: ComposedComponentProps) => ReactNode;

/**
 * Static Component registry for CPB-2. Components render from their props only;
 * data binding and Data Source execution arrive in CPB-4, so outputs show an
 * empty/placeholder state.
 */
const REGISTRY: Readonly<Record<string, ComposedComponent>> = {
  "core.input.text": TextInput,
  "core.input.number": NumberInput,
  "core.input.date": DateInput,
  "core.input.select": SelectInput,
  "core.input.scan": ScanInput,
  "core.input.adaptive": AdaptiveInput,
  "core.button": ButtonComponent,
  "core.form": FormComponent,
  "core.output.table": TableOutput,
  "core.output.cards": CardListOutput,
  "core.output.field": FieldValueOutput,
  "core.output.detail": DetailOutput,
  "core.output.chart": ChartOutput,
  "core.layout.title": TitleComponent,
  "core.layout.divider": DividerComponent,
};

export function renderComposedComponent(component: ComponentDefinition): ReactNode {
  const Renderer = REGISTRY[component.kind];
  if (Renderer === undefined) {
    // Non-core (namespaced) kinds resolve through the trusted Plugin registry;
    // everything else is an unknown Component and degrades safely.
    const RendererFor = component.kind.startsWith("core.") ? DegradedForKind : PluginSlot;
    return (
      <ComponentErrorBoundary kind={component.kind}>
        <RendererFor component={component} />
      </ComponentErrorBoundary>
    );
  }
  return (
    <ComponentErrorBoundary kind={component.kind}>
      <Renderer component={component} />
    </ComponentErrorBoundary>
  );
}

function DegradedForKind({ component }: ComposedComponentProps) {
  return <DegradedPlaceholder reason={`알 수 없는 Component '${component.kind}'`} />;
}

/**
 * Renders a trusted Plugin Component if one is registered for its kind. A
 * missing/disabled Plugin fails closed to a degraded placeholder — a Manifest
 * can reference a Plugin kind, but only a host-registered renderer ever runs.
 */
function PluginSlot({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const Renderer = runtime.pluginComponent(component.kind);
  if (Renderer === undefined) {
    return <DegradedPlaceholder reason={`사용할 수 없는 Plugin Component '${component.kind}'`} />;
  }
  return <>{Renderer({ component })}</>;
}

function textProp(component: ComponentDefinition, key: string, fallback = ""): string {
  const value = component.props[key];
  return typeof value === "string" ? value : fallback;
}

function TextInput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const label = textProp(component, "label", "텍스트");
  return (
    <label className={styles.composedField}>
      <span>{label}</span>
      <input
        type="text"
        aria-label={label}
        placeholder={textProp(component, "placeholder")}
        onChange={(event) => runtime.setInputValue(component.id, event.target.value)}
      />
    </label>
  );
}

function NumberInput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const label = textProp(component, "label", "숫자");
  return (
    <label className={styles.composedField}>
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        onChange={(event) => runtime.setInputValue(component.id, event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function DateInput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const label = textProp(component, "label", "날짜");
  return (
    <label className={styles.composedField}>
      <span>{label}</span>
      <input
        type="date"
        aria-label={label}
        onChange={(event) => runtime.setInputValue(component.id, event.target.value === "" ? "" : event.target.value)}
      />
    </label>
  );
}

/**
 * A field-desk scan input (CPB-WF 슬3). A barcode scanner types the code then
 * sends Enter, so the value is written to state on every keystroke and the
 * `onScan` rule chain fires on Enter — then the field clears for the next scan.
 * The rule chain (await-query + when) decides what the scan means (대출/반납 등).
 */
function ScanInput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const label = textProp(component, "label", "바코드 스캔");
  const [value, setValue] = useState("");
  const running = runtime.actionState.status === "running";
  const onScan = (): void => {
    if (value === "") return;
    runtime.runComponentEvent(component.id, "onScan");
    setValue("");
    runtime.setInputValue(component.id, "");
  };
  return (
    <label className={styles.composedField}>
      <span>{label}</span>
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        aria-label={label}
        placeholder={textProp(component, "placeholder", "바코드를 스캔하세요")}
        value={value}
        disabled={running}
        onChange={(event) => { setValue(event.target.value); runtime.setInputValue(component.id, event.target.value); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onScan(); } }}
      />
    </label>
  );
}

interface SelectOptionProp {
  readonly label?: string;
  readonly value: string;
}

function SelectInput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const label = textProp(component, "label", "선택");
  const options = Array.isArray(component.props["options"])
    ? (component.props["options"] as readonly SelectOptionProp[])
    : [];
  return (
    <label className={styles.composedField}>
      <span>{label}</span>
      <select aria-label={label} onChange={(event) => runtime.setInputValue(component.id, event.target.value)}>
        <option value="">전체</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}
      </select>
    </label>
  );
}

interface AdaptiveVariant {
  readonly id: string;
  readonly label?: string;
  readonly inputKind?: "text" | "number" | "date" | "select";
  readonly options?: readonly { readonly label?: string; readonly value: string }[];
}

/** An input whose editor and (via its active variant) query target both switch. */
function AdaptiveInput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const variants = Array.isArray(component.props["variants"])
    ? (component.props["variants"] as readonly AdaptiveVariant[])
    : [];
  const label = textProp(component, "label", "검색");
  const defaultVariantId = typeof component.props["defaultVariantId"] === "string"
    ? component.props["defaultVariantId"] : variants[0]?.id;
  const [activeId, setActiveId] = useState<string | undefined>(defaultVariantId);
  const active = variants.find((variant) => variant.id === activeId) ?? variants[0];

  const switchVariant = (nextId: string): void => {
    setActiveId(nextId);
    // Switching resets the value so a hidden variant's value never lingers.
    runtime.setAdaptiveValue(component.id, nextId, "");
  };

  if (active === undefined) {
    return <label className={styles.composedField}><span>{label}</span><input disabled aria-label={label} /></label>;
  }

  const kind = active.inputKind ?? "text";
  const onValue = (value: unknown): void => runtime.setAdaptiveValue(component.id, active.id, value);

  return (
    <div className={styles.composedField}>
      <div className={styles.adaptiveHeader}>
        <span>{label}</span>
        <select aria-label={`${label} 형식`} value={active.id} onChange={(event) => switchVariant(event.target.value)}>
          {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label ?? variant.id}</option>)}
        </select>
      </div>
      {kind === "select" ? (
        <select aria-label={label} onChange={(event) => onValue(event.target.value)}>
          <option value="">선택…</option>
          {(active.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}
        </select>
      ) : kind === "number" ? (
        <input type="number" aria-label={label} onChange={(event) => onValue(event.target.value === "" ? "" : Number(event.target.value))} />
      ) : kind === "date" ? (
        <input type="date" aria-label={label} onChange={(event) => onValue(event.target.value)} />
      ) : (
        <input type="text" aria-label={label} onChange={(event) => onValue(event.target.value)} />
      )}
    </div>
  );
}

function ButtonComponent({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const label = textProp(component, "label", "실행");
  const tone = component.props["tone"] === "primary" ? styles.composedButtonPrimary : undefined;
  const hasEvents = (component.events ?? []).some((event) => event.event === "onClick");
  const running = runtime.actionState.status === "running";
  return (
    <button
      type="button"
      className={[styles.composedButton, tone].filter(Boolean).join(" ")}
      disabled={running}
      onClick={() => {
        // Event effects take precedence; fall back to the connection-based
        // "clicked → data-source.execute" for buttons without explicit events.
        if (hasEvents) runtime.runComponentEvent(component.id, "onClick");
        else runtime.runFromComponent(component.id);
      }}
    >
      {running ? "처리 중…" : label}
    </button>
  );
}

interface FormFieldProp {
  readonly fieldId?: string;
  readonly label?: string;
  readonly inputKind?: "text" | "number" | "date" | "textarea";
}

/**
 * Groups field inputs whose values are collected into one form-data object,
 * keyed by Field name, for a create/update Action (CPB-7 슬라이스 2). Each input
 * writes to the runtime's per-component form state; the Action effect reads it.
 */
function FormComponent({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const fields = Array.isArray(component.props["fields"])
    ? (component.props["fields"] as readonly FormFieldProp[])
    : [];
  const title = textProp(component, "label", "입력");
  const running = runtime.actionState.status === "running";

  return (
    <div className={styles.composedForm} aria-label={title}>
      <div className={styles.composedFormTitle}>{title}</div>
      {fields.length === 0 ? (
        <div className={styles.composedEmpty}>입력할 Field가 없습니다.</div>
      ) : (
        fields.map((field, index) => {
          const fieldName = field.fieldId === undefined ? undefined : runtime.fieldName(field.fieldId);
          const label = field.label ?? (field.fieldId === undefined ? "필드" : (fieldName ?? field.fieldId));
          // Without a resolvable Field name the input cannot be part of the data payload.
          if (fieldName === undefined) {
            return <div key={field.fieldId ?? index} className={styles.composedEmpty}>알 수 없는 Field {field.fieldId ?? ""}</div>;
          }
          const value = runtime.formFieldValue(component.id, fieldName);
          const stringValue = typeof value === "string" || typeof value === "number" ? String(value) : "";
          const onValue = (next: unknown): void => runtime.setFormFieldValue(component.id, fieldName, next);
          const kind = field.inputKind ?? "text";
          return (
            <label key={field.fieldId ?? index} className={styles.composedField}>
              <span>{label}</span>
              {kind === "textarea" ? (
                <textarea aria-label={label} value={stringValue} disabled={running} onChange={(event) => onValue(event.target.value)} />
              ) : kind === "number" ? (
                <input type="number" aria-label={label} value={stringValue} disabled={running} onChange={(event) => onValue(event.target.value === "" ? "" : Number(event.target.value))} />
              ) : kind === "date" ? (
                <input type="date" aria-label={label} value={stringValue} disabled={running} onChange={(event) => onValue(event.target.value)} />
              ) : (
                <input type="text" aria-label={label} value={stringValue} disabled={running} onChange={(event) => onValue(event.target.value)} />
              )}
            </label>
          );
        })
      )}
    </div>
  );
}

interface ColumnProp {
  readonly id?: string;
  readonly label?: string;
  readonly fieldId?: string;
  readonly format?: OutputFormat;
}

/**
 * Evaluates an output's `highlightWhen` condition (CPB-WF 슬4) against one row.
 * Field conditions read the row's data by Field name; state/query conditions
 * still see Page State. Returns false for a malformed/absent condition.
 */
function rowHighlighted(
  highlightWhen: unknown,
  row: { readonly data: Readonly<Record<string, unknown>> },
  runtime: ComposedRuntimeContextValue,
): boolean {
  if (typeof highlightWhen !== "object" || highlightWhen === null) return false;
  return evaluateCondition(highlightWhen as RuleCondition, {
    stateValue: (stateId) => runtime.stateValue(stateId),
    lastQueryRowCount: undefined,
    fieldValue: (fieldId) => {
      const name = runtime.fieldName(fieldId);
      return name === undefined ? undefined : row.data[name];
    },
  });
}

/** Renders a formatted value with its badge/long-text presentation. */
function FormattedCell({ value }: { readonly value: FormattedValue }) {
  if (value.kind === "badge") return <span className={styles.composedBadge}>{value.text}</span>;
  if (value.kind === "long-text") return <span className={styles.composedLongText}>{value.text}</span>;
  return <>{value.text}</>;
}

function TableOutput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const columns = Array.isArray(component.props["columns"])
    ? (component.props["columns"] as readonly ColumnProp[])
    : [];
  const source = runtime.dataSourceForOutput(component.id);
  const cell = (row: { readonly data: Readonly<Record<string, unknown>> }, column: ColumnProp): FormattedValue => {
    const name = column.fieldId === undefined ? undefined : runtime.fieldName(column.fieldId);
    const value = name === undefined ? undefined : row.data[name];
    const type = column.fieldId === undefined ? undefined : runtime.fieldType(column.fieldId);
    return formatFieldValue(value, type, column.format ?? "auto");
  };
  return (
    <div className={styles.composedTable} role="table" aria-label="목록">
      <div className={styles.composedTableHead} role="row">
        {columns.map((column, index) => (
          <span key={column.id ?? index} role="columnheader">{column.label ?? column.fieldId ?? "열"}</span>
        ))}
      </div>
      {source?.status === "loading" ? (
        <div className={styles.composedEmpty}>불러오는 중…</div>
      ) : source?.status === "error" ? (
        <div className={styles.composedEmpty}>조회에 실패했습니다. {source.error}</div>
      ) : source === undefined || source.rows.length === 0 ? (
        <div className={styles.composedEmpty}>표시할 데이터가 없습니다.</div>
      ) : (
        <>
          {source.rows.map((row) => (
            <div
              key={row.id}
              className={[
                styles.composedTableRow,
                runtime.selectedRowId(component.id) === row.id ? styles.composedTableRowSelected : "",
                rowHighlighted(component.props["highlightWhen"], row, runtime) ? styles.composedRowHighlight : "",
              ].filter(Boolean).join(" ")}
              role="row"
              tabIndex={0}
              onClick={() => runtime.selectRow(component.id, row)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); runtime.selectRow(component.id, row); } }}
            >
              {columns.map((column, index) => (
                <span key={column.id ?? index} role="cell"><FormattedCell value={cell(row, column)} /></span>
              ))}
            </div>
          ))}
          {source.hasNextPage ? (
            <button type="button" className={styles.composedNextPage} onClick={() => runtime.nextPage(component.id)}>다음 페이지</button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Rows rendered as cards instead of table rows (image/summary-oriented lists). */
function CardListOutput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const columns = Array.isArray(component.props["columns"])
    ? (component.props["columns"] as readonly ColumnProp[])
    : [];
  const source = runtime.dataSourceForOutput(component.id);
  const cell = (row: { readonly data: Readonly<Record<string, unknown>> }, column: ColumnProp): FormattedValue => {
    const name = column.fieldId === undefined ? undefined : runtime.fieldName(column.fieldId);
    const value = name === undefined ? undefined : row.data[name];
    const type = column.fieldId === undefined ? undefined : runtime.fieldType(column.fieldId);
    return formatFieldValue(value, type, column.format ?? "auto");
  };
  return (
    <div className={styles.composedCards} aria-label="목록">
      {source?.status === "loading" ? (
        <div className={styles.composedEmpty}>불러오는 중…</div>
      ) : source?.status === "error" ? (
        <div className={styles.composedEmpty}>조회에 실패했습니다. {source.error}</div>
      ) : source === undefined || source.rows.length === 0 ? (
        <div className={styles.composedEmpty}>표시할 데이터가 없습니다.</div>
      ) : (
        source.rows.map((row) => (
          <div
            key={row.id}
            className={[
              styles.composedCard,
              runtime.selectedRowId(component.id) === row.id ? styles.composedCardSelected : "",
              rowHighlighted(component.props["highlightWhen"], row, runtime) ? styles.composedRowHighlight : "",
            ].filter(Boolean).join(" ")}
            role="button"
            tabIndex={0}
            onClick={() => runtime.selectRow(component.id, row)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); runtime.selectRow(component.id, row); } }}
          >
            {columns.map((column, index) => (
              <div key={column.id ?? index} className={styles.composedCardRow}>
                <span className={styles.composedCardLabel}>{column.label ?? column.fieldId ?? ""}</span>
                <FormattedCell value={cell(row, column)} />
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

interface DetailFieldProp {
  readonly fieldId?: string;
}

/** Shows a single Field of the bound document, large (a "라벨 + 값" tile). */
function FieldValueOutput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const fieldId = typeof component.props["fieldId"] === "string" ? component.props["fieldId"] : undefined;
  const label = textProp(component, "label", fieldId === undefined ? "필드" : (runtime.fieldName(fieldId) ?? fieldId));
  const detail = runtime.detailForComponent(component);
  const data = detail.status === "success" ? detail.document?.data : undefined;
  const name = fieldId === undefined ? undefined : runtime.fieldName(fieldId);
  const value = name === undefined || data === undefined ? undefined : data[name];
  const type = fieldId === undefined ? undefined : runtime.fieldType(fieldId);
  const formatted = formatFieldValue(value, type);
  return (
    <div className={styles.composedFieldValue} aria-label={label}>
      <span className={styles.composedFieldValueLabel}>{label}</span>
      <strong className={styles.composedFieldValueText}>{formatted.empty ? "—" : formatted.text}</strong>
    </div>
  );
}

function DetailOutput({ component }: ComposedComponentProps) {
  const runtime = useComposedRuntime();
  const fields = Array.isArray(component.props["fields"])
    ? (component.props["fields"] as readonly DetailFieldProp[])
    : [];
  const detail = runtime.detailForComponent(component);
  const data = detail.status === "success" ? detail.document?.data : undefined;
  const cell = (fieldId: string | undefined): FormattedValue => {
    const name = fieldId === undefined ? undefined : runtime.fieldName(fieldId);
    const value = name === undefined || data === undefined ? undefined : data[name];
    const type = fieldId === undefined ? undefined : runtime.fieldType(fieldId);
    return formatFieldValue(value, type);
  };
  return (
    <dl className={styles.composedDetail} aria-label="상세">
      {detail.status === "loading" ? (
        <div className={styles.composedEmpty}>불러오는 중…</div>
      ) : detail.status === "error" ? (
        <div className={styles.composedEmpty}>조회에 실패했습니다. {detail.error}</div>
      ) : detail.status === "empty" || detail.document === null || detail.document === undefined ? (
        <div className={styles.composedEmpty}>선택된 항목이 없습니다.</div>
      ) : fields.length === 0 ? (
        <div className={styles.composedEmpty}>표시할 Field가 없습니다.</div>
      ) : (
        fields.map((field, index) => (
          <div key={field.fieldId ?? index}>
            <dt>{field.fieldId === undefined ? "필드" : (runtime.fieldName(field.fieldId) ?? field.fieldId)}</dt>
            <dd><FormattedCell value={cell(field.fieldId)} /></dd>
          </div>
        ))
      )}
    </dl>
  );
}

function TitleComponent({ component }: ComposedComponentProps) {
  return <h2 className={styles.composedTitle}>{textProp(component, "text", "제목")}</h2>;
}

function DividerComponent() {
  return <hr className={styles.composedDivider} aria-hidden="true" />;
}

function DegradedPlaceholder({ reason }: { readonly reason: string }) {
  return (
    <div className={styles.composedDegraded} role="note">
      <strong>표시할 수 없는 Component</strong>
      <span>{reason}</span>
    </div>
  );
}

/** Isolates a single Component's failure so the App shell keeps rendering. */
class ComponentErrorBoundary extends Component<
  { readonly kind: string; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  public constructor(props: { readonly kind: string; readonly children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  public static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return <DegradedPlaceholder reason={`Component '${this.props.kind}' 렌더링에 실패했습니다.`} />;
    }
    return this.props.children;
  }
}
