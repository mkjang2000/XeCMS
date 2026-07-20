/** Storage envelope every rich-text value must keep — the server validates it. */
export const RICH_TEXT_FORMAT = "xecms.rich-text";
export const RICH_TEXT_FORMAT_VERSION = 2;
export function emptyRichTextDocument() {
    return { format: RICH_TEXT_FORMAT, formatVersion: RICH_TEXT_FORMAT_VERSION, content: [] };
}
/**
 * Reads a stored value into the block list BlockNote expects. Unknown shapes —
 * including retired v1 documents (ProseMirror node trees) that may still sit in
 * a database — degrade to an empty document rather than throwing: a value the
 * editor cannot represent must not take the whole document form down.
 */
export function richTextContentOf(value) {
    if (value === null || typeof value !== "object")
        return [];
    const record = value;
    if (record.format !== RICH_TEXT_FORMAT || record.formatVersion !== RICH_TEXT_FORMAT_VERSION)
        return [];
    return Array.isArray(record.content) ? record.content : [];
}
/** Wraps editor output back into the storage envelope. */
export function toRichTextDocument(content) {
    return { format: RICH_TEXT_FORMAT, formatVersion: RICH_TEXT_FORMAT_VERSION, content };
}
/**
 * Structural equality that ignores object key order. PostgreSQL jsonb rewrites
 * key order, so a document that round-trips through the server rarely
 * stringifies identically to what the editor emitted. Comparing canonical forms
 * keeps such round trips from being mistaken for external edits, which would
 * re-seed the editor and throw the caret away.
 */
export function sameRichTextContent(a, b) {
    return canonicalJson(a) === canonicalJson(b);
}
function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
        const record = value;
        const output = {};
        for (const key of Object.keys(record).sort())
            output[key] = canonicalize(record[key]);
        return output;
    }
    return value;
}
//# sourceMappingURL=rich-text-document.js.map