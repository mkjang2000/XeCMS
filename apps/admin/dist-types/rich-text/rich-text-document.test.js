import { describe, expect, it } from "vitest";
import { emptyRichTextDocument, richTextContentOf, toRichTextDocument, withResolvedImageSources, } from "./rich-text-document.js";
function mediaRecord(id, contentUrl) {
    return {
        id,
        fileName: `${id}.png`,
        mimeType: "image/png",
        size: 1,
        checksum: "sum",
        storageKey: `key/${id}`,
        createdAt: "2026-07-20T00:00:00.000Z",
        createdBy: "usr_admin",
        status: "available",
        contentUrl,
    };
}
describe("rich text document round trip", () => {
    // The previous textarea editor flattened everything to plain text and wrote it
    // back as bare paragraphs, silently destroying formatting. This is the exact
    // inverse: a document with marks, attrs and nesting must survive untouched.
    it("preserves marks, attrs and nesting through a round trip", () => {
        const content = [
            {
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "text", text: "공지" }],
            },
            {
                type: "paragraph",
                content: [
                    { type: "text", text: "굵고 ", marks: [{ type: "bold" }] },
                    {
                        type: "text",
                        text: "링크된 글자",
                        marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }],
                    },
                ],
            },
            {
                type: "bulletList",
                content: [
                    {
                        type: "listItem",
                        content: [{ type: "paragraph", content: [{ type: "text", text: "첫째" }] }],
                    },
                ],
            },
        ];
        const document = toRichTextDocument(content);
        expect(document.format).toBe("xecms.rich-text");
        expect(document.formatVersion).toBe(1);
        expect(document.content).toEqual(content);
        // And reading it back yields the same tree again.
        expect(richTextContentOf(document)).toEqual(content);
    });
    it("keeps mediaId but never persists the derived image src", () => {
        const content = [
            { type: "image", attrs: { mediaId: "med_1", alt: "표지", src: "http://localhost:3000/media/med_1/content" },
            },
        ];
        const document = toRichTextDocument(content);
        // src is deployment-specific: storing it would rot when the host changes.
        expect(document.content).toEqual([{ type: "image", attrs: { mediaId: "med_1", alt: "표지" } }]);
    });
    it("strips a nested image src too", () => {
        const content = [
            {
                type: "blockquote",
                content: [{ type: "image", attrs: { mediaId: "med_2", src: "http://host/x" } }],
            },
        ];
        expect(toRichTextDocument(content).content).toEqual([
            { type: "blockquote", content: [{ type: "image", attrs: { mediaId: "med_2" } }] },
        ]);
    });
    it("resolves image sources from the media library at render time", () => {
        const content = [
            { type: "image", attrs: { mediaId: "med_1", alt: "표지" } },
        ];
        const resolved = withResolvedImageSources(content, [mediaRecord("med_1", "http://host/med_1")]);
        expect(resolved).toEqual([
            { type: "image", attrs: { mediaId: "med_1", alt: "표지", src: "http://host/med_1" } },
        ]);
    });
    it("leaves src empty for a media id that no longer exists", () => {
        const content = [{ type: "image", attrs: { mediaId: "med_gone" } }];
        const resolved = withResolvedImageSources(content, []);
        // Rendered as a visible placeholder rather than a broken image.
        expect(resolved).toEqual([{ type: "image", attrs: { mediaId: "med_gone" } }]);
    });
    it("reads malformed stored values as an empty document", () => {
        expect(richTextContentOf(null)).toEqual([]);
        expect(richTextContentOf("문자열")).toEqual([]);
        expect(richTextContentOf({})).toEqual([]);
        expect(richTextContentOf({ content: "배열 아님" })).toEqual([]);
    });
    it("produces an empty document with the envelope intact", () => {
        expect(emptyRichTextDocument()).toEqual({
            format: "xecms.rich-text",
            formatVersion: 1,
            content: [],
        });
        expect(toRichTextDocument([]).content).toEqual([]);
    });
});
//# sourceMappingURL=rich-text-document.test.js.map