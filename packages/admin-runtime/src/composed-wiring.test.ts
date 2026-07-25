import { describe, expect, it } from "vitest";
import type { ComposedPageDefinition } from "@xecms/admin-apps";

import {
  allVariantStatesFor,
  buildWiringGraph,
  collectParameters,
  dataSourcesExecutedBy,
  documentIdStateFor,
  onChangeDataSourcesForState,
  onLoadDataSources,
  rowsSourceFor,
  selectedDocumentStatesFor,
  statesWrittenBy,
  variantStatesFor,
} from "./composed-wiring.js";

function page(): ComposedPageDefinition {
  return {
    id: "pg", type: "composed-page", screenNo: "S-1", title: "t", menuLabel: "t",
    layout: { columns: 48, rowHeight: 8 },
    state: [{ id: "state_name", valueType: "string", initialValue: "" }],
    dataSources: [{
      id: "query_x", type: "document-query", collectionId: "col_c", trigger: "manual",
      fields: ["fld_a"], parameters: [{ id: "param_name", valueType: "string" }], limit: 20,
    }],
    components: [
      { id: "cmp_input", kind: "core.input.text", placement: { x: 0, y: 0, width: 16, height: 5 }, props: {} },
      { id: "cmp_button", kind: "core.button", placement: { x: 17, y: 0, width: 5, height: 5 }, props: {} },
      { id: "cmp_table", kind: "core.output.table", placement: { x: 0, y: 7, width: 30, height: 30 }, props: {} },
    ],
    connections: [
      { id: "c1", from: { nodeType: "component", nodeId: "cmp_input", portId: "value" }, to: { nodeType: "state", nodeId: "state_name", portId: "write" } },
      { id: "c2", from: { nodeType: "state", nodeId: "state_name", portId: "value" }, to: { nodeType: "data-source", nodeId: "query_x", portId: "parameter:param_name" } },
      { id: "c3", from: { nodeType: "component", nodeId: "cmp_button", portId: "clicked" }, to: { nodeType: "data-source", nodeId: "query_x", portId: "execute" } },
      { id: "c4", from: { nodeType: "data-source", nodeId: "query_x", portId: "rows" }, to: { nodeType: "component", nodeId: "cmp_table", portId: "data" } },
    ],
  };
}

describe("composed wiring graph", () => {
  it("maps the search → list flow", () => {
    const graph = buildWiringGraph(page());
    expect(statesWrittenBy(graph, "cmp_input")).toEqual(["state_name"]);
    expect(dataSourcesExecutedBy(graph, "cmp_button")).toEqual(["query_x"]);
    expect(rowsSourceFor(graph, "cmp_table")).toBe("query_x");
  });

  it("collects data-source parameters from current state", () => {
    const graph = buildWiringGraph(page());
    const state = new Map<string, unknown>([["state_name", "Alice"]]);
    expect(collectParameters(graph, "query_x", state)).toEqual({ param_name: "Alice" });
  });

  it("reports on-load data sources", () => {
    const base = page();
    const loaded: ComposedPageDefinition = {
      ...base,
      dataSources: base.dataSources.map((source) => ({ ...source, trigger: "on-load" as const })),
    };
    expect(onLoadDataSources(loaded)).toEqual(["query_x"]);
    expect(onLoadDataSources(base)).toEqual([]);
  });

  it("maps table row selection to state and detail documentId input", () => {
    const master: ComposedPageDefinition = {
      ...page(),
      state: [
        { id: "state_name", valueType: "string", initialValue: "" },
        { id: "state_selected", valueType: "document-id", initialValue: null },
      ],
      components: [
        ...page().components,
        { id: "cmp_detail", kind: "core.output.detail", placement: { x: 31, y: 7, width: 17, height: 30 }, props: {} },
      ],
      connections: [
        ...page().connections,
        { id: "c5", from: { nodeType: "component", nodeId: "cmp_table", portId: "selectedDocumentId" }, to: { nodeType: "state", nodeId: "state_selected", portId: "write" } },
        { id: "c6", from: { nodeType: "state", nodeId: "state_selected", portId: "value" }, to: { nodeType: "component", nodeId: "cmp_detail", portId: "documentId" } },
      ],
    };
    const graph = buildWiringGraph(master);
    expect(selectedDocumentStatesFor(graph, "cmp_table")).toEqual(["state_selected"]);
    expect(documentIdStateFor(graph, "cmp_detail")).toBe("state_selected");
  });

  it("maps adaptive input variant value ports to states", () => {
    const adaptive: ComposedPageDefinition = {
      ...page(),
      state: [
        { id: "state_name", valueType: "string", initialValue: "" },
        { id: "state_age", valueType: "number", initialValue: null },
      ],
      components: [
        { id: "cmp_adaptive", kind: "core.input.adaptive", placement: { x: 0, y: 0, width: 16, height: 5 }, props: {} },
      ],
      connections: [
        { id: "va", from: { nodeType: "component", nodeId: "cmp_adaptive", portId: "value:v_name" }, to: { nodeType: "state", nodeId: "state_name", portId: "write" } },
        { id: "vb", from: { nodeType: "component", nodeId: "cmp_adaptive", portId: "value:v_age" }, to: { nodeType: "state", nodeId: "state_age", portId: "write" } },
      ],
    };
    const graph = buildWiringGraph(adaptive);
    expect(variantStatesFor(graph, "cmp_adaptive", "v_name")).toEqual(["state_name"]);
    expect(variantStatesFor(graph, "cmp_adaptive", "v_age")).toEqual(["state_age"]);
    expect([...allVariantStatesFor(graph, "cmp_adaptive")].sort()).toEqual(["state_age", "state_name"]);
  });

  it("finds on-change data sources a state change should re-run", () => {
    const base = page();
    const onChange: ComposedPageDefinition = {
      ...base,
      dataSources: base.dataSources.map((source) => ({ ...source, trigger: "on-change" as const, debounceMs: 500 })),
    };
    const graph = buildWiringGraph(onChange);
    expect(onChangeDataSourcesForState(onChange, graph, "state_name")).toEqual([{ id: "query_x", debounceMs: 500 }]);
    // Manual trigger (base) is never re-run on change.
    expect(onChangeDataSourcesForState(base, buildWiringGraph(base), "state_name")).toEqual([]);
  });
});
