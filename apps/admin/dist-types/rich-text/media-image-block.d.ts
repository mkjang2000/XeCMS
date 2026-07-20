import type { MediaRecord } from "@xecms/admin";
/**
 * Media records the editor can resolve, keyed by media id. Provided by the
 * field editor so block views re-render when the library refetches.
 */
export declare const MediaLibraryContext: import("react").Context<ReadonlyMap<string, MediaRecord>>;
export declare function mediaRecordMap(items: readonly MediaRecord[]): ReadonlyMap<string, MediaRecord>;
/**
 * Image block that stores a media library id rather than a URL.
 *
 * `contentUrl` depends on the API base URL, so freezing an absolute URL into
 * the document would break every stored image the moment the deployment moves.
 * The `mediaId` is the durable truth; the URL is looked up at render time and
 * never persisted, which is also why this replaces BlockNote's own image block
 * (that one serializes its `url` prop).
 */
export declare const mediaImageSpec: (options?: undefined) => import("@blocknote/core").BlockSpec<"mediaImage", {
    readonly mediaId: {
        readonly default: "";
    };
    readonly alt: {
        readonly default: "";
    };
}, "none">;
//# sourceMappingURL=media-image-block.d.ts.map