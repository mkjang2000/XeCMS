/** Storage envelope every rich-text value must keep — the server validates it. */
export const RICH_TEXT_FORMAT = "xecms.rich-text";
export const RICH_TEXT_FORMAT_VERSION = 2;

/**
 * One BlockNote block as it is persisted. The structural keys are fixed by the
 * server contract; the block vocabulary (`type`, `props`, inline `content`)
 * belongs to the editor.
 */
export interface RichTextBlock {
  readonly id: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly content?: unknown;
  readonly children?: readonly RichTextBlock[];
}

export interface RichTextDocument {
  readonly format: typeof RICH_TEXT_FORMAT;
  readonly formatVersion: typeof RICH_TEXT_FORMAT_VERSION;
  readonly content: readonly RichTextBlock[];
}

export function emptyRichTextDocument(): RichTextDocument {
  return { format: RICH_TEXT_FORMAT, formatVersion: RICH_TEXT_FORMAT_VERSION, content: [] };
}

/**
 * Reads a stored value into the block list BlockNote expects. Unknown shapes —
 * including retired v1 documents (ProseMirror node trees) that may still sit in
 * a database — degrade to an empty document rather than throwing: a value the
 * editor cannot represent must not take the whole document form down.
 */
export function richTextContentOf(value: unknown): readonly RichTextBlock[] {
  if (value === null || typeof value !== "object") return [];
  const record = value as { format?: unknown; formatVersion?: unknown; content?: unknown };
  if (record.format !== RICH_TEXT_FORMAT || record.formatVersion !== RICH_TEXT_FORMAT_VERSION) return [];
  return Array.isArray(record.content) ? (record.content as readonly RichTextBlock[]) : [];
}

/** Wraps editor output back into the storage envelope. */
export function toRichTextDocument(content: readonly RichTextBlock[]): RichTextDocument {
  return { format: RICH_TEXT_FORMAT, formatVersion: RICH_TEXT_FORMAT_VERSION, content };
}

/**
 * Structural equality that ignores object key order. PostgreSQL jsonb rewrites
 * key order, so a document that round-trips through the server rarely
 * stringifies identically to what the editor emitted. Comparing canonical forms
 * keeps such round trips from being mistaken for external edits, which would
 * re-seed the editor and throw the caret away.
 */
export function sameRichTextContent(a: readonly RichTextBlock[], b: readonly RichTextBlock[]): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) output[key] = canonicalize(record[key]);
    return output;
  }
  return value;
}
