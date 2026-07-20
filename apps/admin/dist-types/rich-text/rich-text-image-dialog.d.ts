import type { MediaRecord } from "@xecms/admin";
/**
 * Picks an image for the body: either an existing library item or a file
 * uploaded on the spot.
 *
 * Upload deliberately inserts nothing until the server returns a media id — an
 * optimistic placeholder node would leave debris in the document when an upload
 * fails, and the document is the thing we must not corrupt.
 */
export declare function RichTextImageDialog({ mediaItems, canUpload, onUpload, onSelect, onClose }: {
    readonly mediaItems: readonly MediaRecord[];
    readonly canUpload: boolean;
    readonly onUpload?: (file: File) => Promise<MediaRecord>;
    readonly onSelect: (mediaId: string, alt: string, contentUrl?: string) => void;
    readonly onClose: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=rich-text-image-dialog.d.ts.map