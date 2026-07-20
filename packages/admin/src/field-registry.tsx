import { useEffect, useMemo, useState, type ComponentType, type Ref } from "react";
import { CheckboxField, SelectField, TextAreaField, TextInput } from "@xecms/ui";
import type { CollectionField, ContentFieldType, MediaRecord } from "./api.js";
import styles from "../src/document-fields.module.css";

export interface DocumentChoice {
  readonly value: string;
  readonly label: string;
}

export interface DocumentFieldEditorProps {
  readonly field: CollectionField;
  readonly value: unknown;
  readonly errorMessage?: string;
  readonly onChange: (value: unknown) => void;
  readonly onBlur?: () => void;
  readonly name?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly isDisabled?: boolean;
  readonly relationOptions?: readonly DocumentChoice[];
  readonly mediaItems?: readonly MediaRecord[];
  /**
   * Uploads a file to the media library and resolves with the stored record.
   * Supplied by the host app so this package stays free of API wiring; editors
   * that can accept files (rich text) offer upload only when it is present.
   */
  readonly onUploadMedia?: (file: File) => Promise<MediaRecord>;
  /** False when the signed-in user lacks `media.action.upload`. */
  readonly canUploadMedia?: boolean;
}

export interface FieldAdminDefinition {
  readonly type: ContentFieldType;
  readonly label: string;
  readonly initialValue: unknown;
  readonly Editor: ComponentType<DocumentFieldEditorProps>;
}

export class FieldRegistry {
  readonly #definitions = new Map<ContentFieldType, FieldAdminDefinition>();

  register(definition: FieldAdminDefinition): this {
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Admin field type '${definition.type}' is already registered.`);
    }
    this.#definitions.set(definition.type, Object.freeze({ ...definition }));
    return this;
  }

  get(type: ContentFieldType): FieldAdminDefinition {
    const definition = this.#definitions.get(type);
    if (definition === undefined) throw new Error(`Admin field type '${type}' is not registered.`);
    return definition;
  }

  list(): readonly FieldAdminDefinition[] {
    return Object.freeze([...this.#definitions.values()]);
  }
}

function fieldLabel(field: CollectionField): string {
  return field.label?.trim() || field.name;
}

function TextEditor({ field, value, errorMessage, onChange, onBlur, name, inputRef, isDisabled }: DocumentFieldEditorProps) {
  return (
    <TextInput
      label={fieldLabel(field)}
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
      onBlur={onBlur}
      name={name}
      inputRef={inputRef}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
    />
  );
}

function TextareaEditor({ field, value, errorMessage, onChange, onBlur, name, isDisabled }: DocumentFieldEditorProps) {
  return (
    <TextAreaField
      label={fieldLabel(field)}
      value={typeof value === "string" ? value : ""}
      onChange={onChange}
      onBlur={onBlur}
      name={name}
      rows={7}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
    />
  );
}

function NumberEditor({ field, value, errorMessage, onChange, onBlur, name, inputRef, isDisabled }: DocumentFieldEditorProps) {
  return (
    <TextInput
      label={fieldLabel(field)}
      type="number"
      value={typeof value === "number" ? String(value) : ""}
      onChange={(next) => onChange(next === "" ? null : Number(next))}
      onBlur={onBlur}
      name={name}
      inputRef={inputRef}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
    />
  );
}

function BooleanEditor({ field, value, onChange, isDisabled }: DocumentFieldEditorProps) {
  return (
    <div className={styles.booleanField}>
      <CheckboxField isSelected={value === true} onChange={onChange} isDisabled={isDisabled || field.readOnly}>
        {fieldLabel(field)}
      </CheckboxField>
    </div>
  );
}

function DateTimeEditor({ field, value, errorMessage, onChange, onBlur, name, inputRef, isDisabled }: DocumentFieldEditorProps) {
  const display = typeof value === "string" && value !== "" ? toLocalDateTime(value) : "";
  return (
    <TextInput
      label={fieldLabel(field)}
      type="datetime-local"
      value={display}
      onChange={(next) => onChange(next === "" ? null : new Date(next).toISOString())}
      onBlur={onBlur}
      name={name}
      inputRef={inputRef}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
    />
  );
}

function DateEditor({ field, value, errorMessage, onChange, onBlur, name, isDisabled }: DocumentFieldEditorProps) {
  return (
    <label className={styles.nativeField}>
      <span>{fieldLabel(field)}{field.required ? <b aria-hidden="true">*</b> : null}</span>
      <input
        type="date"
        value={typeof value === "string" ? value.slice(0, 10) : ""}
        name={name}
        required={field.required}
        disabled={isDisabled || field.readOnly}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value || null)}
      />
      {errorMessage ? <small role="alert">{errorMessage}</small> : null}
    </label>
  );
}

function SelectEditor({ field, value, errorMessage, onChange, isDisabled }: DocumentFieldEditorProps) {
  const options = field.options ?? [];
  if (field.multiple) {
    const selected = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    return (
      <label className={styles.nativeField}>
        <span>{fieldLabel(field)}{field.required ? <b aria-hidden="true">*</b> : null}</span>
        <select
          multiple
          value={[...selected]}
          required={field.required}
          disabled={isDisabled || field.readOnly}
          onChange={(event) => onChange([...event.currentTarget.selectedOptions].map(({ value: option }) => option))}
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <em>Ctrl/⌘ 키로 여러 값을 선택할 수 있습니다.</em>
        {errorMessage ? <small role="alert">{errorMessage}</small> : null}
      </label>
    );
  }
  return (
    <SelectField
      label={fieldLabel(field)}
      value={typeof value === "string" ? value : ""}
      options={[{ value: "", label: "선택하지 않음" }, ...options]}
      onChange={(next) => onChange(next || null)}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
    />
  );
}

function formattedJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2) ?? "null";
}

function JsonEditor({ field, value, errorMessage, onChange, onBlur, isDisabled }: DocumentFieldEditorProps) {
  const fallback = field.type === "array" || field.type === "blocks" || (field.type === "component" && field.multiple) ? [] : {};
  const [source, setSource] = useState(() => formattedJson(value, fallback));
  const [parseError, setParseError] = useState<string>();
  useEffect(() => setSource(formattedJson(value, fallback)), [value, field.type, field.multiple]);
  const commit = () => {
    try {
      const parsed: unknown = JSON.parse(source);
      setParseError(undefined);
      onChange(parsed);
      onBlur?.();
    } catch {
      setParseError("올바른 JSON 형식으로 입력해 주세요.");
    }
  };
  return (
    <TextAreaField
      label={fieldLabel(field)}
      description="JSON 형식으로 저장됩니다. 입력값은 형식 검증을 통과한 경우에만 반영됩니다."
      value={source}
      onChange={setSource}
      onBlur={commit}
      rows={10}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={parseError ?? errorMessage}
    />
  );
}

/**
 * Flattens a rich-text tree to plain text. Read-only: marks, attrs and nesting
 * are dropped, so this must never feed a write path — see RichTextFallbackEditor.
 */
function richTextPlainValue(value: unknown): string {
  if (!value || typeof value !== "object" || !("content" in value) || !Array.isArray(value.content)) return "";
  const collect = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    if ("text" in node && typeof node.text === "string") return node.text;
    if ("content" in node && Array.isArray(node.content)) return node.content.map(collect).join("");
    return "";
  };
  return value.content.map(collect).join("\n");
}

/**
 * Fallback shown when the host app registers no rich-text editor. It is
 * deliberately read-only: a plain-text round trip would silently discard marks,
 * attrs and nested nodes on the next save, which is worse than not editing.
 */
function RichTextFallbackEditor({ field, value, errorMessage, name }: DocumentFieldEditorProps) {
  return (
    <TextAreaField
      label={fieldLabel(field)}
      description="이 환경에는 리치 텍스트 편집기가 설정되지 않아 내용을 볼 수만 있습니다. 서식이 지워지지 않도록 편집은 막혀 있습니다."
      value={richTextPlainValue(value)}
      onChange={() => undefined}
      name={name}
      rows={9}
      isRequired={field.required}
      isDisabled
      errorMessage={errorMessage}
    />
  );
}

function RelationEditor({ field, value, errorMessage, onChange, isDisabled, relationOptions = [] }: DocumentFieldEditorProps) {
  const options = useMemo(() => [{ value: "", label: "연결하지 않음" }, ...relationOptions], [relationOptions]);
  if (field.cardinality === "many") {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return (
      <label className={styles.nativeField}>
        <span>{fieldLabel(field)}{field.required ? <b aria-hidden="true">*</b> : null}</span>
        <select
          multiple
          value={selected}
          required={field.required}
          disabled={isDisabled || field.readOnly}
          onChange={(event) => onChange([...event.currentTarget.selectedOptions].map(({ value: option }) => option))}
        >
          {relationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {relationOptions.length === 0 ? <em>대상 컬렉션에 선택할 문서가 없습니다.</em> : null}
        {errorMessage ? <small role="alert">{errorMessage}</small> : null}
      </label>
    );
  }
  return (
    <SelectField
      label={fieldLabel(field)}
      value={typeof value === "string" ? value : ""}
      options={options}
      onChange={(next) => onChange(next || null)}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
      description={relationOptions.length === 0 ? "대상 컬렉션에 선택할 문서가 없습니다." : undefined}
    />
  );
}

function UploadEditor({ field, value, errorMessage, onChange, isDisabled, mediaItems = [] }: DocumentFieldEditorProps) {
  if (field.multiple) {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return (
      <label className={styles.nativeField}>
        <span>{fieldLabel(field)}{field.required ? <b aria-hidden="true">*</b> : null}</span>
        <select
          multiple
          value={selected}
          required={field.required}
          disabled={isDisabled || field.readOnly}
          onChange={(event) => onChange([...event.currentTarget.selectedOptions].map(({ value: option }) => option))}
        >
          {mediaItems.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.mimeType}</option>)}
        </select>
        <em>미디어 라이브러리에 업로드된 파일을 연결합니다.</em>
        {errorMessage ? <small role="alert">{errorMessage}</small> : null}
      </label>
    );
  }
  return (
    <SelectField
      label={fieldLabel(field)}
      value={typeof value === "string" ? value : ""}
      options={[
        { value: "", label: "파일을 연결하지 않음" },
        ...mediaItems.map((item) => ({ value: item.id, label: `${item.fileName} · ${item.mimeType}` })),
      ]}
      onChange={(next) => onChange(next || null)}
      isRequired={field.required}
      isDisabled={isDisabled || field.readOnly}
      errorMessage={errorMessage}
      description={mediaItems.length === 0 ? "먼저 미디어 라이브러리에 파일을 업로드해 주세요." : undefined}
    />
  );
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Editor components supplied by the host app, keyed by field type. Only the
 * Editor slot is replaced — `label` and `initialValue` stay with the default
 * definition so a heavier editor (rich text) can live outside this package.
 */
export type FieldEditorOverrides = Partial<Record<ContentFieldType, ComponentType<DocumentFieldEditorProps>>>;

const DEFAULT_FIELD_DEFINITIONS: readonly FieldAdminDefinition[] = [
  { type: "text", label: "텍스트", initialValue: "", Editor: TextEditor },
  { type: "textarea", label: "긴 텍스트", initialValue: "", Editor: TextareaEditor },
  { type: "number", label: "숫자", initialValue: null, Editor: NumberEditor },
  { type: "boolean", label: "참/거짓", initialValue: false, Editor: BooleanEditor },
  { type: "date", label: "날짜", initialValue: "", Editor: DateEditor },
  { type: "datetime", label: "날짜 및 시간", initialValue: "", Editor: DateTimeEditor },
  { type: "select", label: "선택", initialValue: null, Editor: SelectEditor },
  { type: "enum", label: "열거형", initialValue: null, Editor: SelectEditor },
  { type: "json", label: "JSON", initialValue: {}, Editor: JsonEditor },
  { type: "object", label: "객체", initialValue: {}, Editor: JsonEditor },
  { type: "array", label: "배열", initialValue: [], Editor: JsonEditor },
  { type: "component", label: "컴포넌트", initialValue: {}, Editor: JsonEditor },
  { type: "blocks", label: "블록", initialValue: [], Editor: JsonEditor },
  { type: "rich-text", label: "리치 텍스트", initialValue: { format: "xecms.rich-text", formatVersion: 1, content: [] }, Editor: RichTextFallbackEditor },
  { type: "relation", label: "관계", initialValue: null, Editor: RelationEditor },
  { type: "upload", label: "업로드", initialValue: null, Editor: UploadEditor },
];

export function createDefaultFieldRegistry(overrides: FieldEditorOverrides = {}): FieldRegistry {
  const registry = new FieldRegistry();
  for (const definition of DEFAULT_FIELD_DEFINITIONS) {
    const Editor = overrides[definition.type];
    registry.register(Editor === undefined ? definition : { ...definition, Editor });
  }
  return registry;
}
