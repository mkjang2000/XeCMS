import type { ComposedPageDefinition, ConnectionDefinition } from "@xecms/admin-apps";

/**
 * The wiring graph derived from a Composed Page's connections. It answers the
 * questions the runtime asks: which state does an input write, which Data Source
 * does a button execute, which parameters feed a Data Source, and which output
 * consumes a Data Source's rows.
 */
export interface WiringGraph {
  /** component id -> state ids its `value` port writes. */
  readonly inputTargets: ReadonlyMap<string, readonly string[]>;
  /** component id -> data-source ids its `clicked` port executes. */
  readonly clickTargets: ReadonlyMap<string, readonly string[]>;
  /** data-source id -> { parameterId -> state id } feeding its parameters. */
  readonly parameterSources: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** component id -> data-source id whose `rows` feed its `data` input. */
  readonly rowsSource: ReadonlyMap<string, string>;
  /** component id -> state ids its `selectedDocumentId` port writes (row select). */
  readonly selectedDocumentTargets: ReadonlyMap<string, readonly string[]>;
  /**
   * component id -> { fieldId -> state ids } its `selectedField:<fieldId>` port
   * writes on row select. Carries a *field value* of the selected row (not the
   * document id) so it can feed another Data Source's parameter (cross-schema).
   */
  readonly selectedFieldTargets: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  /** component id -> state id whose `value` feeds its `documentId` input (detail). */
  readonly documentIdSource: ReadonlyMap<string, string>;
  /** adaptive input id -> { variantId -> state ids its `value:<variantId>` writes }. */
  readonly variantTargets: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

export function buildWiringGraph(page: ComposedPageDefinition): WiringGraph {
  const inputTargets = new Map<string, string[]>();
  const clickTargets = new Map<string, string[]>();
  const parameterSources = new Map<string, Map<string, string>>();
  const rowsSource = new Map<string, string>();
  const selectedDocumentTargets = new Map<string, string[]>();
  const selectedFieldTargets = new Map<string, Map<string, string[]>>();
  const documentIdSource = new Map<string, string>();
  const variantTargets = new Map<string, Map<string, string[]>>();

  for (const connection of page.connections) {
    const { from, to } = connection;
    // input.value → state.write
    if (from.nodeType === "component" && from.portId === "value"
      && to.nodeType === "state" && to.portId === "write") {
      push(inputTargets, from.nodeId, to.nodeId);
    }
    // adaptive.value:<variantId> → state.write
    if (from.nodeType === "component" && from.portId.startsWith("value:")
      && to.nodeType === "state" && to.portId === "write") {
      const variantId = from.portId.slice("value:".length);
      const byVariant = variantTargets.get(from.nodeId) ?? new Map<string, string[]>();
      const states = byVariant.get(variantId) ?? [];
      states.push(to.nodeId);
      byVariant.set(variantId, states);
      variantTargets.set(from.nodeId, byVariant);
    }
    // button.clicked → data-source.execute
    if (from.nodeType === "component" && from.portId === "clicked"
      && to.nodeType === "data-source" && to.portId === "execute") {
      push(clickTargets, from.nodeId, to.nodeId);
    }
    // state.value → data-source.parameter:<id>
    if (from.nodeType === "state" && from.portId === "value"
      && to.nodeType === "data-source" && to.portId.startsWith("parameter:")) {
      const parameterId = to.portId.slice("parameter:".length);
      const map = parameterSources.get(to.nodeId) ?? new Map<string, string>();
      map.set(parameterId, from.nodeId);
      parameterSources.set(to.nodeId, map);
    }
    // data-source.rows → component.data
    if (from.nodeType === "data-source" && from.portId === "rows"
      && to.nodeType === "component" && to.portId === "data") {
      rowsSource.set(to.nodeId, from.nodeId);
    }
    // table.selectedDocumentId → state.write (row selection)
    if (from.nodeType === "component" && from.portId === "selectedDocumentId"
      && to.nodeType === "state" && to.portId === "write") {
      push(selectedDocumentTargets, from.nodeId, to.nodeId);
    }
    // table.selectedField:<fieldId> → state.write (row's field value → state)
    if (from.nodeType === "component" && from.portId.startsWith("selectedField:")
      && to.nodeType === "state" && to.portId === "write") {
      const fieldId = from.portId.slice("selectedField:".length);
      const byField = selectedFieldTargets.get(from.nodeId) ?? new Map<string, string[]>();
      const states = byField.get(fieldId) ?? [];
      states.push(to.nodeId);
      byField.set(fieldId, states);
      selectedFieldTargets.set(from.nodeId, byField);
    }
    // state.value → component.documentId (detail input)
    if (from.nodeType === "state" && from.portId === "value"
      && to.nodeType === "component" && to.portId === "documentId") {
      documentIdSource.set(to.nodeId, from.nodeId);
    }
  }

  return {
    inputTargets, clickTargets, parameterSources, rowsSource,
    selectedDocumentTargets, selectedFieldTargets, documentIdSource, variantTargets,
  };
}

/** { fieldId -> state ids } written by a component's selectedField ports. */
export function selectedFieldStatesFor(
  graph: WiringGraph,
  componentId: string,
): ReadonlyMap<string, readonly string[]> {
  return graph.selectedFieldTargets.get(componentId) ?? new Map();
}

/** State ids written by a specific variant of an adaptive input. */
export function variantStatesFor(
  graph: WiringGraph,
  componentId: string,
  variantId: string,
): readonly string[] {
  return graph.variantTargets.get(componentId)?.get(variantId) ?? [];
}

/** All state ids any variant of an adaptive input can write (for reset on switch). */
export function allVariantStatesFor(graph: WiringGraph, componentId: string): readonly string[] {
  const byVariant = graph.variantTargets.get(componentId);
  if (byVariant === undefined) return [];
  return [...new Set([...byVariant.values()].flat())];
}

/** Collects the current Page State values a Data Source's parameters resolve to. */
export function collectParameters(
  graph: WiringGraph,
  dataSourceId: string,
  state: ReadonlyMap<string, unknown>,
): Readonly<Record<string, unknown>> {
  const bindings = graph.parameterSources.get(dataSourceId);
  if (bindings === undefined) return {};
  const parameters: Record<string, unknown> = {};
  for (const [parameterId, stateId] of bindings) {
    parameters[parameterId] = state.get(stateId);
  }
  return parameters;
}

/** A change on the given input component maps to writes on these state ids. */
export function statesWrittenBy(graph: WiringGraph, componentId: string): readonly string[] {
  return graph.inputTargets.get(componentId) ?? [];
}

/** Data Sources a button component executes on click. */
export function dataSourcesExecutedBy(graph: WiringGraph, componentId: string): readonly string[] {
  return graph.clickTargets.get(componentId) ?? [];
}

/** The Data Source whose rows feed the given output component, if any. */
export function rowsSourceFor(graph: WiringGraph, componentId: string): string | undefined {
  return graph.rowsSource.get(componentId);
}

/** State ids a table component writes when a row is selected. */
export function selectedDocumentStatesFor(graph: WiringGraph, componentId: string): readonly string[] {
  return graph.selectedDocumentTargets.get(componentId) ?? [];
}

/** The state id feeding a detail component's `documentId` input, if any. */
export function documentIdStateFor(graph: WiringGraph, componentId: string): string | undefined {
  return graph.documentIdSource.get(componentId);
}

/** Data Sources with an `on-load` trigger that should run once on mount. */
export function onLoadDataSources(page: ComposedPageDefinition): readonly string[] {
  return page.dataSources.filter((source) => source.trigger === "on-load").map(({ id }) => id);
}

/**
 * `on-change` Data Sources whose parameters read from the given state id, so a
 * change to that state re-runs them (debounced). Returns { id, debounceMs }.
 */
export function onChangeDataSourcesForState(
  page: ComposedPageDefinition,
  graph: WiringGraph,
  stateId: string,
): readonly { readonly id: string; readonly debounceMs: number }[] {
  const result: { readonly id: string; readonly debounceMs: number }[] = [];
  for (const source of page.dataSources) {
    if (source.trigger !== "on-change") continue;
    const bindings = graph.parameterSources.get(source.id);
    if (bindings === undefined) continue;
    if ([...bindings.values()].includes(stateId)) {
      result.push({ id: source.id, debounceMs: source.debounceMs ?? 300 });
    }
  }
  return result;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

export type { ConnectionDefinition };
