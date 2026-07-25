import type { CollectionSummaryDto } from "@xecms/client";
import type { ComposedPageDefinition } from "@xecms/admin-apps";
import { type FormBlock } from "./form-blocks.js";
export interface FormBlockPanelProps {
    readonly page: ComposedPageDefinition;
    readonly block: FormBlock;
    readonly collections: readonly CollectionSummaryDto[];
    readonly onChange: (next: ComposedPageDefinition) => void;
    readonly onRemove: () => void;
}
/**
 * The block-level inspector — the primary editing surface for a "전산 사용자".
 * It speaks in schemas and fields, never ports or state; reconfiguring rebuilds
 * the block's atoms in place (`reconfigureBlock`) under the same block id.
 */
export declare function FormBlockPanel({ page, block, collections, onChange, onRemove }: FormBlockPanelProps): import("react").JSX.Element;
//# sourceMappingURL=form-block-panel.d.ts.map