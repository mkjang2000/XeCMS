/**
 * Image node that stores a media library id rather than a URL.
 *
 * `contentUrl` depends on the API base URL, so freezing an absolute URL into the
 * document would break every stored image the moment the deployment moves. The
 * `mediaId` is the durable truth; `src` is filled in at render time by looking
 * the id up in the media list, and is deliberately not persisted.
 */
export declare const MediaImage: import("@tiptap/core").Node<import("@tiptap/extension-image").ImageOptions, any>;
//# sourceMappingURL=rich-text-image.d.ts.map