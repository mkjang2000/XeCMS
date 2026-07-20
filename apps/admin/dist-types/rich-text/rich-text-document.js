/** Storage envelope every rich-text value must keep — the server validates it. */
export const RICH_TEXT_FORMAT = "xecms.rich-text";
export const RICH_TEXT_FORMAT_VERSION = 1;
export function emptyRichTextDocument() {
    return { format: RICH_TEXT_FORMAT, formatVersion: RICH_TEXT_FORMAT_VERSION, content: [] };
}
/**
 * Reads a stored value into the node list ProseMirror expects. Unknown shapes
 * degrade to an empty document rather than throwing — a malformed value must not
 * take the whole document form down.
 */
export function richTextContentOf(value) {
    if (value === null || typeof value !== "object")
        return [];
    const content = value.content;
    return Array.isArray(content) ? content : [];
}
/**
 * Wraps editor output back into the storage envelope.
 *
 * Image `src` is stripped here: it is derived from `mediaId` at render time and
 * points at a deployment-specific URL, so persisting it would rot the document.
 */
export function toRichTextDocument(content) {
    return {
        format: RICH_TEXT_FORMAT,
        formatVersion: RICH_TEXT_FORMAT_VERSION,
        content: content.map(stripDerivedAttrs),
    };
}
function stripDerivedAttrs(node) {
    const children = node.content?.map(stripDerivedAttrs);
    const attrs = node.type === "image" ? withoutSrc(node.attrs) : node.attrs;
    return {
        ...node,
        ...(attrs === undefined ? {} : { attrs }),
        ...(children === undefined ? {} : { content: children }),
    };
}
function withoutSrc(attrs) {
    if (attrs === undefined)
        return undefined;
    const { src: _src, ...rest } = attrs;
    return rest;
}
/**
 * Fills in `src` from the media library so stored `mediaId`s become viewable.
 * An id with no matching record keeps `src` empty, which the node view renders
 * as a visible "missing media" placeholder instead of a broken image.
 */
export function withResolvedImageSources(content, mediaItems) {
    if (content.length === 0)
        return content;
    const urlById = new Map(mediaItems.map((item) => [item.id, item.contentUrl]));
    const resolve = (node) => {
        const children = node.content?.map(resolve);
        if (node.type !== "image") {
            return children === undefined ? node : { ...node, content: children };
        }
        const mediaId = node.attrs?.["mediaId"];
        const src = typeof mediaId === "string" ? urlById.get(mediaId) : undefined;
        return {
            ...node,
            attrs: { ...node.attrs, ...(src === undefined ? {} : { src }) },
            ...(children === undefined ? {} : { content: children }),
        };
    };
    return content.map(resolve);
}
//# sourceMappingURL=rich-text-document.js.map