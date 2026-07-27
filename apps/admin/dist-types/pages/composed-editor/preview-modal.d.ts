import type { AdminAppManifestV2 } from "@xecms/admin-apps";
import type { CollectionSummaryDto } from "@xecms/client";
export interface PreviewModalProps {
    readonly manifest: AdminAppManifestV2;
    readonly collections: readonly CollectionSummaryDto[];
    /** The page to open first (usually the one being edited). */
    readonly initialPageId: string;
    readonly schemaRevisionId: string | null;
    readonly onClose: () => void;
}
/**
 * Runs the EDITING (unsaved) manifest against real data in a modal, using a
 * synthesized runtime DTO + a client-side query resolver. Reads are live; every
 * mutation is blocked (Preview never writes). This lets a "전산 사용자" verify a
 * screen's wiring — search → list → detail, cross-schema lookups — before saving.
 */
export declare function PreviewModal({ manifest, collections, initialPageId, schemaRevisionId, onClose }: PreviewModalProps): import("react").JSX.Element;
//# sourceMappingURL=preview-modal.d.ts.map