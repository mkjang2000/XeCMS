import type { MediaRecord } from "@xecms/admin";

/** Storage envelope every rich-text value must keep — the server validates it. */
export const RICH_TEXT_FORMAT = "xecms.rich-text";
export const RICH_TEXT_FORMAT_VERSION = 1;

export interface RichTextNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly RichTextNode[];
  readonly text?: string;
  readonly marks?: readonly { readonly type: string; readonly attrs?: Record<string, unknown> }[];
}

export interface RichTextDocument {
  readonly format: typeof RICH_TEXT_FORMAT;
  readonly formatVersion: typeof RICH_TEXT_FORMAT_VERSION;
  readonly content: readonly RichTextNode[];
}

export function emptyRichTextDocument(): RichTextDocument {
  return { format: RICH_TEXT_FORMAT, formatVersion: RICH_TEXT_FORMAT_VERSION, content: [] };
}

/**
 * Reads a stored value into the node list ProseMirror expects. Unknown shapes
 * degrade to an empty document rather than throwing — a malformed value must not
 * take the whole document form down.
 */
export function richTextContentOf(value: unknown): readonly RichTextNode[] {
  if (value === null || typeof value !== "object") return [];
  const content = (value as { content?: unknown }).content;
  return Array.isArray(content) ? (content as readonly RichTextNode[]) : [];
}

/**
 * Wraps editor output back into the storage envelope.
 *
 * Image `src` is stripped here: it is derived from `mediaId` at render time and
 * points at a deployment-specific URL, so persisting it would rot the document.
 */
export function toRichTextDocument(content: readonly RichTextNode[]): RichTextDocument {
  return {
    format: RICH_TEXT_FORMAT,
    formatVersion: RICH_TEXT_FORMAT_VERSION,
    content: content.map(stripDerivedAttrs),
  };
}

function stripDerivedAttrs(node: RichTextNode): RichTextNode {
  const children = node.content?.map(stripDerivedAttrs);
  const attrs = node.type === "image" ? withoutSrc(node.attrs) : node.attrs;
  return {
    ...node,
    ...(attrs === undefined ? {} : { attrs }),
    ...(children === undefined ? {} : { content: children }),
  };
}

function withoutSrc(attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (attrs === undefined) return undefined;
  const { src: _src, ...rest } = attrs;
  return rest;
}

/**
 * Fills in `src` from the media library so stored `mediaId`s become viewable.
 * An id with no matching record keeps `src` empty, which the node view renders
 * as a visible "missing media" placeholder instead of a broken image.
 */
export function withResolvedImageSources(
  content: readonly RichTextNode[],
  mediaItems: readonly MediaRecord[],
): readonly RichTextNode[] {
  if (content.length === 0) return content;
  const urlById = new Map(mediaItems.map((item) => [item.id, item.contentUrl] as const));
  const resolve = (node: RichTextNode): RichTextNode => {
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
