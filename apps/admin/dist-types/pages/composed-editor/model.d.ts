import type { ComponentDefinition, ComposedPageDefinition, ComposedPageEventBinding, ConnectionDefinition, DataSourceDefinition, GridPlacement, PageStateDefinition } from "@xecms/admin-apps";
/** A component's placement is committed only when it fits and does not overlap. */
export declare function canPlace(page: ComposedPageDefinition, componentId: string, placement: GridPlacement): boolean;
/** Moves/resizes a component, rejecting the change if it would collide or overflow. */
export declare function updatePlacement(page: ComposedPageDefinition, componentId: string, placement: GridPlacement): ComposedPageDefinition;
/** Finds the first non-overlapping slot for a newly added component. */
export declare function firstFreePlacement(page: ComposedPageDefinition, width: number, height: number): GridPlacement;
export declare function addComponent(page: ComposedPageDefinition, component: Omit<ComponentDefinition, "placement">, size: {
    readonly width: number;
    readonly height: number;
}): ComposedPageDefinition;
export declare function removeComponent(page: ComposedPageDefinition, componentId: string): ComposedPageDefinition;
export declare function updateComponentProps(page: ComposedPageDefinition, componentId: string, props: Readonly<Record<string, unknown>>): ComposedPageDefinition;
export declare function updateComponentEvents(page: ComposedPageDefinition, componentId: string, events: readonly ComposedPageEventBinding[]): ComposedPageDefinition;
/** Adds a connection when it is well-formed (dedup by port pair). */
export declare function addConnection(page: ComposedPageDefinition, connection: ConnectionDefinition): ComposedPageDefinition;
export declare function removeConnection(page: ComposedPageDefinition, connectionId: string): ComposedPageDefinition;
export declare function addState(page: ComposedPageDefinition, state: PageStateDefinition): ComposedPageDefinition;
export declare function removeState(page: ComposedPageDefinition, stateId: string): ComposedPageDefinition;
export declare function updateState(page: ComposedPageDefinition, state: PageStateDefinition): ComposedPageDefinition;
export declare function addDataSource(page: ComposedPageDefinition, dataSource: DataSourceDefinition): ComposedPageDefinition;
export declare function removeDataSource(page: ComposedPageDefinition, dataSourceId: string): ComposedPageDefinition;
export declare function updateDataSource(page: ComposedPageDefinition, dataSource: DataSourceDefinition): ComposedPageDefinition;
export declare function nextStateId(page: ComposedPageDefinition): string;
export declare function nextDataSourceId(page: ComposedPageDefinition): string;
/** Replaces a page inside the manifest's page list. */
export declare function replacePage<T extends {
    readonly pages: readonly {
        readonly id: string;
    }[];
}>(manifest: T, pageId: string, next: ComposedPageDefinition): T;
//# sourceMappingURL=model.d.ts.map