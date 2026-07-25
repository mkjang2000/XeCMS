import type { CollectionSummaryDto } from "@xecms/client";
import type { DataSourceDefinition, DocumentQueryDataSource } from "@xecms/admin-apps";
export interface DataSourcePanelProps {
    readonly dataSource: DocumentQueryDataSource;
    readonly collections: readonly CollectionSummaryDto[];
    readonly onChange: (dataSource: DataSourceDefinition) => void;
    readonly onRemove: () => void;
}
export declare function DataSourcePanel({ dataSource, collections, onChange, onRemove }: DataSourcePanelProps): import("react").JSX.Element;
//# sourceMappingURL=data-source-panel.d.ts.map