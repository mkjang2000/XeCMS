import { createContext, useContext } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import type { MediaRecord } from "@xecms/admin";
import styles from "./rich-text-editor.module.css";

/**
 * Media records the editor can resolve, keyed by media id. Provided by the
 * field editor so block views re-render when the library refetches.
 */
export const MediaLibraryContext = createContext<ReadonlyMap<string, MediaRecord>>(new Map());

export function mediaRecordMap(items: readonly MediaRecord[]): ReadonlyMap<string, MediaRecord> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Image block that stores a media library id rather than a URL.
 *
 * `contentUrl` depends on the API base URL, so freezing an absolute URL into
 * the document would break every stored image the moment the deployment moves.
 * The `mediaId` is the durable truth; the URL is looked up at render time and
 * never persisted, which is also why this replaces BlockNote's own image block
 * (that one serializes its `url` prop).
 */
export const mediaImageSpec = createReactBlockSpec(
  {
    type: "mediaImage",
    propSchema: {
      mediaId: { default: "" },
      alt: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const library = useContext(MediaLibraryContext);
      const { mediaId, alt } = block.props;
      const record = mediaId === "" ? undefined : library.get(mediaId);
      if (record === undefined) {
        return (
          <span className={styles.missingMedia} role="img" aria-label={alt || "미디어 없음"}>
            미디어를 찾을 수 없습니다{mediaId === "" ? "" : ` (id: ${mediaId})`}
          </span>
        );
      }
      return <img className={styles.mediaImage} src={record.contentUrl} alt={alt} />;
    },
  },
);
