import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";
export interface DetailPanelProps {
    readonly component: ComponentDefinition;
    readonly collections: readonly CollectionSummaryDto[];
    readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
    readonly onRemove: () => void;
}
/** Inspector form for a `core.output.detail` component: Collection + Fields. */
export declare function DetailPanel({ component, collections, onChangeProps, onRemove }: DetailPanelProps): import("react").JSX.Element;
//# sourceMappingURL=detail-panel.d.ts.map