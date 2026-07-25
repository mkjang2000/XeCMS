import { clampPlacement, placementsOverlap } from "@xecms/admin-runtime/geometry";
/** A component's placement is committed only when it fits and does not overlap. */
export function canPlace(page, componentId, placement) {
    const clamped = clampPlacement(placement);
    if (clamped.x !== placement.x || clamped.y !== placement.y
        || clamped.width !== placement.width || clamped.height !== placement.height) {
        return false;
    }
    return page.components.every((component) => component.id === componentId || !placementsOverlap(component.placement, placement));
}
/** Moves/resizes a component, rejecting the change if it would collide or overflow. */
export function updatePlacement(page, componentId, placement) {
    const clamped = clampPlacement(placement);
    if (!canPlace(page, componentId, clamped))
        return page;
    return {
        ...page,
        components: page.components.map((component) => component.id === componentId ? { ...component, placement: clamped } : component),
    };
}
/** Finds the first non-overlapping slot for a newly added component. */
export function firstFreePlacement(page, width, height) {
    for (let y = 0; y < 512; y += 1) {
        for (let x = 0; x + width <= 48; x += 1) {
            const candidate = { x, y, width, height };
            if (page.components.every((component) => !placementsOverlap(component.placement, candidate))) {
                return candidate;
            }
        }
    }
    return { x: 0, y: 0, width, height };
}
export function addComponent(page, component, size) {
    const placement = firstFreePlacement(page, size.width, size.height);
    return { ...page, components: [...page.components, { ...component, placement }] };
}
export function removeComponent(page, componentId) {
    return {
        ...page,
        components: page.components.filter((component) => component.id !== componentId),
        // Drop connections that referenced the removed component.
        connections: page.connections.filter((connection) => !referencesNode(connection, "component", componentId)),
    };
}
export function updateComponentProps(page, componentId, props) {
    return {
        ...page,
        components: page.components.map((component) => component.id === componentId ? { ...component, props } : component),
    };
}
export function updateComponentEvents(page, componentId, events) {
    return {
        ...page,
        components: page.components.map((component) => component.id === componentId
            ? { ...component, events: events.length === 0 ? undefined : events }
            : component),
    };
}
function referencesNode(connection, nodeType, nodeId) {
    return (connection.from.nodeType === nodeType && connection.from.nodeId === nodeId)
        || (connection.to.nodeType === nodeType && connection.to.nodeId === nodeId);
}
/** Adds a connection when it is well-formed (dedup by port pair). */
export function addConnection(page, connection) {
    const exists = page.connections.some((existing) => samePort(existing.from, connection.from) && samePort(existing.to, connection.to));
    if (exists)
        return page;
    return { ...page, connections: [...page.connections, connection] };
}
export function removeConnection(page, connectionId) {
    return { ...page, connections: page.connections.filter(({ id }) => id !== connectionId) };
}
function samePort(a, b) {
    return a.nodeType === b.nodeType && a.nodeId === b.nodeId && a.portId === b.portId;
}
/** Drops every connection that referenced a removed node of the given type. */
function dropConnections(page, nodeType, nodeId) {
    return page.connections.filter((connection) => !referencesNode(connection, nodeType, nodeId));
}
export function addState(page, state) {
    return { ...page, state: [...page.state, state] };
}
export function removeState(page, stateId) {
    return {
        ...page,
        state: page.state.filter((entry) => entry.id !== stateId),
        connections: dropConnections(page, "state", stateId),
    };
}
export function updateState(page, state) {
    return { ...page, state: page.state.map((entry) => (entry.id === state.id ? state : entry)) };
}
export function addDataSource(page, dataSource) {
    return { ...page, dataSources: [...page.dataSources, dataSource] };
}
export function removeDataSource(page, dataSourceId) {
    return {
        ...page,
        dataSources: page.dataSources.filter((source) => source.id !== dataSourceId),
        connections: dropConnections(page, "data-source", dataSourceId),
    };
}
export function updateDataSource(page, dataSource) {
    return {
        ...page,
        dataSources: page.dataSources.map((source) => (source.id === dataSource.id ? dataSource : source)),
    };
}
function uniqueNodeId(prefix, existing) {
    const ids = new Set(existing.map(({ id }) => id));
    let index = 1;
    while (ids.has(`${prefix}_${index}`))
        index += 1;
    return `${prefix}_${index}`;
}
export function nextStateId(page) {
    return uniqueNodeId("state", page.state);
}
export function nextDataSourceId(page) {
    return uniqueNodeId("query", page.dataSources);
}
/** Replaces a page inside the manifest's page list. */
export function replacePage(manifest, pageId, next) {
    return {
        ...manifest,
        pages: manifest.pages.map((page) => (page.id === pageId ? next : page)),
    };
}
//# sourceMappingURL=model.js.map