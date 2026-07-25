/**
 * Formats a masked Field value for display in a Composed Page output. The value
 * has already passed the server masking/access boundary; formatting is purely
 * presentational. Field type drives the default; an explicit `format` overrides.
 */
export type OutputFormat =
  | "auto" | "text" | "long-text" | "number" | "date" | "datetime" | "boolean" | "badge";

export interface FormattedValue {
  readonly text: string;
  /** Rendering hint: plain text, a boolean/enum badge, or multiline long text. */
  readonly kind: "text" | "badge" | "long-text";
  readonly empty: boolean;
}

const EMPTY: FormattedValue = { text: "—", kind: "text", empty: true };

export function formatFieldValue(
  value: unknown,
  fieldType: string | undefined,
  format: OutputFormat = "auto",
): FormattedValue {
  if (value === null || value === undefined || value === "") return EMPTY;
  const effective = format === "auto" ? defaultFormat(fieldType) : format;
  switch (effective) {
    case "boolean":
      return badge(booleanLabel(value));
    case "badge":
      return badge(String(value));
    case "date":
      return text(formatDate(value, false));
    case "datetime":
      return text(formatDate(value, true));
    case "number":
      return text(formatNumber(value));
    case "long-text":
      return { text: String(value), kind: "long-text", empty: false };
    case "text":
    default:
      return text(String(value));
  }
}

function defaultFormat(fieldType: string | undefined): OutputFormat {
  switch (fieldType) {
    case "boolean": return "boolean";
    case "number": return "number";
    case "date": return "date";
    case "datetime": return "datetime";
    case "textarea": return "long-text";
    case "select":
    case "enum": return "badge";
    default: return "text";
  }
}

function text(value: string): FormattedValue {
  return { text: value, kind: "text", empty: false };
}

function badge(value: string): FormattedValue {
  return { text: value, kind: "badge", empty: false };
}

function booleanLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (value === "true") return "예";
  if (value === "false") return "아니오";
  return String(value);
}

function formatNumber(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : String(value);
}

/** Formats an ISO date/datetime string; falls back to the raw value if unparseable. */
function formatDate(value: unknown, withTime: boolean): string {
  if (typeof value !== "string") return String(value);
  const parsed = new Date(withTime ? value : `${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return withTime
    ? parsed.toLocaleString()
    : parsed.toLocaleDateString();
}
