/** Storage envelope every rich-text value must keep — the server validates it. */
export declare const RICH_TEXT_FORMAT = "xecms.rich-text";
export declare const RICH_TEXT_FORMAT_VERSION = 2;
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
export declare function emptyRichTextDocument(): RichTextDocument;
/**
 * Reads a stored value into the block list BlockNote expects. Unknown shapes —
 * including retired v1 documents (ProseMirror node trees) that may still sit in
 * a database — degrade to an empty document rather than throwing: a value the
 * editor cannot represent must not take the whole document form down.
 */
export declare function richTextContentOf(value: unknown): readonly RichTextBlock[];
/** Wraps editor output back into the storage envelope. */
export declare function toRichTextDocument(content: readonly RichTextBlock[]): RichTextDocument;
/**
 * Structural equality that ignores object key order. PostgreSQL jsonb rewrites
 * key order, so a document that round-trips through the server rarely
 * stringifies identically to what the editor emitted. Comparing canonical forms
 * keeps such round trips from being mistaken for external edits, which would
 * re-seed the editor and throw the caret away.
 */
export declare function sameRichTextContent(a: readonly RichTextBlock[], b: readonly RichTextBlock[]): boolean;
//# sourceMappingURL=rich-text-document.d.ts.map