import type { ComposedPageDefinition, ConnectionDefinition, PortReference } from "@xecms/admin-apps";
import { type PortSpec } from "./ports.js";
export interface ConnectionOverlayProps {
    readonly page: ComposedPageDefinition;
    readonly selectedConnectionId: string | null;
    readonly highlightNodeId: string | null;
    readonly showAll: boolean;
    readonly onSelectConnection: (id: string) => void;
}
/** SVG overlay drawing typed connection lines between node anchors. */
export declare function ConnectionOverlay({ page, selectedConnectionId, highlightNodeId, showAll, onSelectConnection, }: ConnectionOverlayProps): import("react").JSX.Element;
export interface NodeStripProps {
    readonly page: ComposedPageDefinition;
    readonly selectedNodeId: string | null;
    readonly pendingFrom: PortReference | null;
    readonly onSelectNode: (nodeType: "state" | "data-source", nodeId: string) => void;
    readonly onPortClick: (reference: PortReference, spec: PortSpec) => void;
    readonly canConnect: (attempt: {
        readonly from: PortReference;
        readonly to: PortReference;
    }) => boolean;
}
/** Non-visual State / Data Source node boxes rendered in the reserved strip. */
export declare function NodeStrip({ page, selectedNodeId, pendingFrom, onSelectNode, onPortClick, canConnect }: NodeStripProps): import("react").JSX.Element;
export declare function connectionSummary(connection: ConnectionDefinition): string;
//# sourceMappingURL=connections.d.ts.map