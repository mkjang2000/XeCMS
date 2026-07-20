import { describe, expect, it } from "vitest";
import { RICH_TEXT_FORMAT, RICH_TEXT_FORMAT_VERSION, emptyRichTextDocument, richTextContentOf, sameRichTextContent, toRichTextDocument, } from "./rich-text-document.js";
const paragraph = (id, text) => ({
    id,
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
});
describe("rich-text document envelope", () => {
    it("wraps blocks in the versioned storage envelope", () => {
        const blocks = [paragraph("blk-1", "본문")];
        expect(toRichTextDocument(blocks)).toEqual({
            format: RICH_TEXT_FORMAT,
            formatVersion: RICH_TEXT_FORMAT_VERSION,
            content: blocks,
        });
        expect(RICH_TEXT_FORMAT_VERSION).toBe(2);
    });
    it("starts empty", () => {
        expect(emptyRichTextDocument()).toEqual({
            format: "xecms.rich-text",
            formatVersion: 2,
            content: [],
        });
    });
    it("reads stored content and degrades malformed values to an empty document", () => {
        const blocks = [paragraph("blk-1", "본문")];
        expect(richTextContentOf({ format: RICH_TEXT_FORMAT, formatVersion: 2, content: blocks })).toBe(blocks);
        expect(richTextContentOf(null)).toEqual([]);
        expect(richTextContentOf("문자열")).toEqual([]);
        expect(richTextContentOf({ content: "배열 아님" })).toEqual([]);
        expect(richTextContentOf(undefined)).toEqual([]);
    });
});
describe("sameRichTextContent", () => {
    it("treats a jsonb round trip (reordered keys) as the same content", () => {
        // PostgreSQL jsonb rewrites object key order; the semantic content is
        // unchanged and must not count as an external edit.
        const emitted = [paragraph("blk-1", "본문")];
        const roundTripped = JSON.parse(JSON.stringify(emitted, (_key, value) => {
            if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                const record = value;
                return Object.fromEntries(Object.keys(record).sort().reverse().map((entry) => [entry, record[entry]]));
            }
            return value;
        }));
        expect(JSON.stringify(roundTripped)).not.toBe(JSON.stringify(emitted));
        expect(sameRichTextContent(emitted, roundTripped)).toBe(true);
    });
    it("detects genuinely different content", () => {
        expect(sameRichTextContent([paragraph("blk-1", "본문")], [paragraph("blk-1", "다른 본문")])).toBe(false);
        expect(sameRichTextContent([paragraph("blk-1", "본문")], [])).toBe(false);
        // Same text under a different block id is still a different document.
        expect(sameRichTextContent([paragraph("blk-1", "본문")], [paragraph("blk-2", "본문")])).toBe(false);
    });
});
//# sourceMappingURL=rich-text-document.test.js.map