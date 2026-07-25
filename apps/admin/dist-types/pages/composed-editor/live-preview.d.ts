import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";
/**
 * Renders a single Component with the real runtime renderer so the Builder shows
 * actual input/table/detail/form chrome (with empty/placeholder data) instead of
 * a kind+label stub. It wraps the Component in a one-component page and a mock
 * client — no live runtime, schema access, or network is involved.
 */
export declare function LivePreviewCell({ component, collections }: {
    readonly component: ComponentDefinition;
    readonly collections: readonly CollectionSummaryDto[];
}): import("react").JSX.Element;
//# sourceMappingURL=live-preview.d.ts.map