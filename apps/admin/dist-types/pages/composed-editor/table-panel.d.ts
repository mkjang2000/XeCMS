import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";
export interface TablePanelProps {
    readonly component: ComponentDefinition;
    /** The Data Source (and thus Collection) whose rows this table renders, if wired. */
    readonly collectionId: string | undefined;
    readonly collections: readonly CollectionSummaryDto[];
    readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
    readonly onRemove: () => void;
}
/** Inspector form for a `core.output.table`: column editing (field/label/format). */
export declare function TablePanel({ component, collectionId, collections, onChangeProps, onRemove }: TablePanelProps): import("react").JSX.Element;
//# sourceMappingURL=table-panel.d.ts.map