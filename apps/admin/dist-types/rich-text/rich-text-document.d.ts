import type { MediaRecord } from "@xecms/admin";
/** Storage envelope every rich-text value must keep — the server validates it. */
export declare const RICH_TEXT_FORMAT = "xecms.rich-text";
export declare const RICH_TEXT_FORMAT_VERSION = 1;
export interface RichTextNode {
    readonly type: string;
    readonly attrs?: Record<string, unknown>;
    readonly content?: readonly RichTextNode[];
    readonly text?: string;
    readonly marks?: readonly {
        readonly type: string;
        readonly attrs?: Record<string, unknown>;
    }[];
}
export interface RichTextDocument {
    readonly format: typeof RICH_TEXT_FORMAT;
    readonly formatVersion: typeof RICH_TEXT_FORMAT_VERSION;
    readonly content: readonly RichTextNode[];
}
export declare function emptyRichTextDocument(): RichTextDocument;
/**
 * Reads a stored value into the node list ProseMirror expects. Unknown shapes
 * degrade to an empty document rather than throwing — a malformed value must not
 * take the whole document form down.
 */
export declare function richTextContentOf(value: unknown): readonly RichTextNode[];
/**
 * Wraps editor output back into the storage envelope.
 *
 * Image `src` is stripped here: it is derived from `mediaId` at render time and
 * points at a deployment-specific URL, so persisting it would rot the document.
 */
export declare function toRichTextDocument(content: readonly RichTextNode[]): RichTextDocument;
/**
 * Fills in `src` from the media library so stored `mediaId`s become viewable.
 * An id with no matching record keeps `src` empty, which the node view renders
 * as a visible "missing media" placeholder instead of a broken image.
 */
export declare function withResolvedImageSources(content: readonly RichTextNode[], mediaItems: readonly MediaRecord[]): readonly RichTextNode[];
//# sourceMappingURL=rich-text-document.d.ts.map