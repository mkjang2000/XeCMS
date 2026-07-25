import { clampPlacement, placementsOverlap } from "@xecms/admin-runtime/geometry";
import type {
  ComponentDefinition,
  ComposedPageDefinition,
  ComposedPageEventBinding,
  ConnectionDefinition,
  DataSourceDefinition,
  GridPlacement,
  PageStateDefinition,
  PortReference,
} from "@xecms/admin-apps";

/** A component's placement is committed only when it fits and does not overlap. */
export function canPlace(
  page: ComposedPageDefinition,
  componentId: string,
  placement: GridPlacement,
): boolean {
  const clamped = clampPlacement(placement);
  if (clamped.x !== placement.x || clamped.y !== placement.y
    || clamped.width !== placement.width || clamped.height !== placement.height) {
    return false;
  }
  return page.components.every((component) =>
    component.id === componentId || !placementsOverlap(component.placement, placement));
}

/** Moves/resizes a component, rejecting the change if it would collide or overflow. */
export function updatePlacement(
  page: ComposedPageDefinition,
  componentId: string,
  placement: GridPlacement,
): ComposedPageDefinition {
  const clamped = clampPlacement(placement);
  if (!canPlace(page, componentId, clamped)) return page;
  return {
    ...page,
    components: page.components.map((component) =>
      component.id === componentId ? { ...component, placement: clamped } : component),
  };
}

/** Finds the first non-overlapping slot for a newly added component. */
export function firstFreePlacement(
  page: ComposedPageDefinition,
  width: number,
  height: number,
): GridPlacement {
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x + width <= 48; x += 1) {
      const candidate: GridPlacement = { x, y, width, height };
      if (page.components.every((component) => !placementsOverlap(component.placement, candidate))) {
        return candidate;
      }
    }
  }
  return { x: 0, y: 0, width, height };
}

export function addComponent(
  page: ComposedPageDefinition,
  component: Omit<ComponentDefinition, "placement">,
  size: { readonly width: number; readonly height: number },
): ComposedPageDefinition {
  const placement = firstFreePlacement(page, size.width, size.height);
  return { ...page, components: [...page.components, { ...component, placement }] };
}

export function removeComponent(
  page: ComposedPageDefinition,
  componentId: string,
): ComposedPageDefinition {
  return {
    ...page,
    components: page.components.filter((component) => component.id !== componentId),
    // Drop connections that referenced the removed component.
    connections: page.connections.filter((connection) =>
      !referencesNode(connection, "component", componentId)),
  };
}

export function updateComponentProps(
  page: ComposedPageDefinition,
  componentId: string,
  props: Readonly<Record<string, unknown>>,
): ComposedPageDefinition {
  return {
    ...page,
    components: page.components.map((component) =>
      component.id === componentId ? { ...component, props } : component),
  };
}

export function updateComponentEvents(
  page: ComposedPageDefinition,
  componentId: string,
  events: readonly ComposedPageEventBinding[],
): ComposedPageDefinition {
  return {
    ...page,
    components: page.components.map((component) =>
      component.id === componentId
        ? { ...component, events: events.length === 0 ? undefined : events }
        : component),
  };
}

function referencesNode(
  connection: ConnectionDefinition,
  nodeType: PortReference["nodeType"],
  nodeId: string,
): boolean {
  return (connection.from.nodeType === nodeType && connection.from.nodeId === nodeId)
    || (connection.to.nodeType === nodeType && connection.to.nodeId === nodeId);
}

/** Adds a connection when it is well-formed (dedup by port pair). */
export function addConnection(
  page: ComposedPageDefinition,
  connection: ConnectionDefinition,
): ComposedPageDefinition {
  const exists = page.connections.some((existing) =>
    samePort(existing.from, connection.from) && samePort(existing.to, connection.to));
  if (exists) return page;
  return { ...page, connections: [...page.connections, connection] };
}

export function removeConnection(
  page: ComposedPageDefinition,
  connectionId: string,
): ComposedPageDefinition {
  return { ...page, connections: page.connections.filter(({ id }) => id !== connectionId) };
}

function samePort(a: PortReference, b: PortReference): boolean {
  return a.nodeType === b.nodeType && a.nodeId === b.nodeId && a.portId === b.portId;
}

/** Drops every connection that referenced a removed node of the given type. */
function dropConnections(
  page: ComposedPageDefinition,
  nodeType: PortReference["nodeType"],
  nodeId: string,
): readonly ConnectionDefinition[] {
  return page.connections.filter((connection) => !referencesNode(connection, nodeType, nodeId));
}

export function addState(page: ComposedPageDefinition, state: PageStateDefinition): ComposedPageDefinition {
  return { ...page, state: [...page.state, state] };
}

export function removeState(page: ComposedPageDefinition, stateId: string): ComposedPageDefinition {
  return {
    ...page,
    state: page.state.filter((entry) => entry.id !== stateId),
    connections: dropConnections(page, "state", stateId),
  };
}

export function updateState(page: ComposedPageDefinition, state: PageStateDefinition): ComposedPageDefinition {
  return { ...page, state: page.state.map((entry) => (entry.id === state.id ? state : entry)) };
}

export function addDataSource(page: ComposedPageDefinition, dataSource: DataSourceDefinition): ComposedPageDefinition {
  return { ...page, dataSources: [...page.dataSources, dataSource] };
}

export function removeDataSource(page: ComposedPageDefinition, dataSourceId: string): ComposedPageDefinition {
  return {
    ...page,
    dataSources: page.dataSources.filter((source) => source.id !== dataSourceId),
    connections: dropConnections(page, "data-source", dataSourceId),
  };
}

export function updateDataSource(page: ComposedPageDefinition, dataSource: DataSourceDefinition): ComposedPageDefinition {
  return {
    ...page,
    dataSources: page.dataSources.map((source) => (source.id === dataSource.id ? dataSource : source)),
  };
}

function uniqueNodeId(prefix: string, existing: readonly { readonly id: string }[]): string {
  const ids = new Set(existing.map(({ id }) => id));
  let index = 1;
  while (ids.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

export function nextStateId(page: ComposedPageDefinition): string {
  return uniqueNodeId("state", page.state);
}

export function nextDataSourceId(page: ComposedPageDefinition): string {
  return uniqueNodeId("query", page.dataSources);
}

/** Replaces a page inside the manifest's page list. */
export function replacePage<T extends { readonly pages: readonly { readonly id: string }[] }>(
  manifest: T,
  pageId: string,
  next: ComposedPageDefinition,
): T {
  return {
    ...manifest,
    pages: manifest.pages.map((page) => (page.id === pageId ? next : page)),
  };
}
