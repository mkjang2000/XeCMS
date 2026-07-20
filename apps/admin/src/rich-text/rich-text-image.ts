import Image from "@tiptap/extension-image";

/**
 * Image node that stores a media library id rather than a URL.
 *
 * `contentUrl` depends on the API base URL, so freezing an absolute URL into the
 * document would break every stored image the moment the deployment moves. The
 * `mediaId` is the durable truth; `src` is filled in at render time by looking
 * the id up in the media list, and is deliberately not persisted.
 */
export const MediaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-media-id"),
        renderHTML: (attributes) => {
          const mediaId = attributes["mediaId"];
          return typeof mediaId === "string" && mediaId !== "" ? { "data-media-id": mediaId } : {};
        },
      },
      // Kept out of the stored document: resolved from mediaId when rendering.
      src: {
        default: null as string | null,
        renderHTML: (attributes) => {
          const src = attributes["src"];
          return typeof src === "string" && src !== "" ? { src } : {};
        },
      },
    };
  },
});
