import type { ComponentDefinition, ComposedPageDefinition, ConnectionDefinition, DataSourceDefinition, PageStateDefinition, PortReference } from "@xecms/admin-apps";
export type PortDirection = "out" | "in";
export type PortValueType = "string" | "number" | "boolean" | "date" | "datetime" | "document-id" | "document[]" | "event" | "any";
export interface PortSpec {
    readonly portId: string;
    readonly label: string;
    readonly direction: PortDirection;
    readonly valueType: PortValueType;
    /** Input ports that reject more than one inbound connection. */
    readonly single?: boolean;
}
export declare function componentPorts(component: ComponentDefinition): readonly PortSpec[];
export declare function statePorts(state: PageStateDefinition): readonly PortSpec[];
export declare function dataSourcePorts(source: DataSourceDefinition): readonly PortSpec[];
export declare function portsFor(page: ComposedPageDefinition, reference: Pick<PortReference, "nodeType" | "nodeId">): readonly PortSpec[];
export declare function findPort(page: ComposedPageDefinition, reference: PortReference): PortSpec | undefined;
/** Value types connect when equal, or when either side accepts anything. */
export declare function typesCompatible(from: PortValueType, to: PortValueType): boolean;
export interface ConnectionAttempt {
    readonly from: PortReference;
    readonly to: PortReference;
}
/** Whether a proposed connection is valid without mutating the page. */
export declare function canConnect(page: ComposedPageDefinition, attempt: ConnectionAttempt): boolean;
export declare function newConnectionId(existing: readonly ConnectionDefinition[]): string;
//# sourceMappingURL=ports.d.ts.map