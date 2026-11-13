import type { ComponentDefinition, ComposedPageDefinition, ConnectionDefinition, DataSourceDefinition, PageStateDefinition, PortReference } from "../v2/types.js";
import type { BlockFieldDefinition, PageAuthoringDefinition } from "./types.js";

export type CompiledPageBody = Pick<ComposedPageDefinition, "components" | "state" | "dataSources" | "connections">;

/** Deterministic IDs are an output detail; no caller parses them to recover blocks. */
export function blockNodeId(blockId: string, role: string): string { return `block_${blockId}_${role}`; }

/** Compile even incomplete drafts; validation reports missing inputs separately. */
export function compilePageAuthoring(source: PageAuthoringDefinition): CompiledPageBody {
  const components: ComponentDefinition[] = [];
  const state: PageStateDefinition[] = [];
  const dataSources: DataSourceDefinition[] = [];
  const connections: ConnectionDefinition[] = [];
  const blocks = new Map(source.blocks.map((block) => [block.id, block]));
  const port = (blockId: string, role: string, nodeType: PortReference["nodeType"], portId: string): PortReference =>
    ({ nodeId: blockNodeId(blockId, role), nodeType, portId });
  const link = (blockId: string, role: string, from: PortReference, to: PortReference): void => {
    connections.push({ id: blockNodeId(blockId, role), from, to });
  };
  for (const block of source.blocks) {
    const id = (role: string) => blockNodeId(block.id, role);
    const placement = block.placement;
    if (block.kind === "search") {
      components.push(
        { id: id("input"), kind: "core.input.text", placement: { ...placement, width: placement.width - 6 }, props: { label: block.title } },
        { id: id("submit"), kind: "core.button", placement: { ...placement, x: placement.x + placement.width - 5, width: 5 }, props: { label: "조회" } },
      );
      state.push({ id: id("value"), valueType: "string", initialValue: "" });
      link(block.id, "valuebinding", port(block.id, "input", "component", "value"), port(block.id, "value", "state", "write"));
    } else if (block.kind === "list") {
      const search = block.input === undefined ? undefined : blocks.get(block.input.blockId);
      const connected = search?.kind === "search";
      dataSources.push({ id: id("query"), type: "document-query", collectionId: block.collectionId,
        fields: block.fields.map((field) => field.fieldId), trigger: block.input === undefined ? "on-load" : "manual", limit: block.limit,
        ...(connected ? { parameters: [{ id: "search", valueType: "string" }], filter: {
          type: "condition", field: { kind: "data", fieldId: search.fieldId }, operator: "contains",
          value: { type: "parameter", parameterId: "search" },
        } } : {}),
      });
      components.push({ id: id("view"), kind: "core.output.table", placement,
        props: { collectionId: block.collectionId, label: block.title, columns: block.fields.map((field) => ({ ...outputField(field), id: field.fieldId })) } });
      link(block.id, "rows", port(block.id, "query", "data-source", "rows"), port(block.id, "view", "component", "data"));
      if (connected) {
        link(block.id, "parameter", port(search.id, "value", "state", "value"), port(block.id, "query", "data-source", "parameter:search"));
        link(block.id, "execute", port(search.id, "submit", "component", "clicked"), port(block.id, "query", "data-source", "execute"));
      }
    } else if (block.kind === "chart") {
      components.push({ id: id("view"), kind: "core.output.chart", placement, props: { label: block.title, measureLabel: "건수" } });
      dataSources.push({ id: id("query"), type: "document-query", collectionId: block.collectionId, fields: [],
        trigger: "on-load", limit: 100, aggregate: { groupBy: { kind: "data", fieldId: block.groupFieldId }, measure: { op: "count" } } });
      link(block.id, "rows", port(block.id, "query", "data-source", "rows"), port(block.id, "view", "component", "data"));
    } else {
      const selected = block.input === undefined ? undefined : blocks.get(block.input.blockId);
      if (selected?.kind === "list") {
        state.push({ id: id("selection"), valueType: "document-id", initialValue: null });
        link(block.id, "selected", port(selected.id, "view", "component", "selectedDocumentId"), port(block.id, "selection", "state", "write"));
        link(block.id, "document", port(block.id, "selection", "state", "value"), port(block.id, "view", "component", "documentId"));
      }
      if (block.kind === "detail") {
        components.push({ id: id("view"), kind: "core.output.detail", placement,
          props: { label: block.title, collectionId: block.collectionId, fields: block.fields.map(outputField) } });
      } else {
        components.push({ id: id("view"), kind: "core.form", placement: { ...placement, height: placement.height - 6 },
          props: { label: block.title, collectionId: block.collectionId, mode: block.mode, fields: block.fields.map((field) => ({ ...outputField(field), inputKind: field.inputKind })) } });
        components.push({ id: id("submit"), kind: "core.button", placement: { ...placement, y: placement.y + placement.height - 5, height: 5 }, props: { label: "저장" },
          events: [{ id: id("save"), event: "onClick", effects: [{ id: id("action"), kind: "action.execute", args: {
            actionId: block.mode === "create" ? "core.action.create" : "core.action.update", collectionId: block.collectionId,
            formComponentId: id("view"), ...(block.mode === "update" ? { documentStateId: id("selection") } : {}),
          } }, ...(selected?.kind === "list" ? [{ id: id("refresh"), kind: "data-source.execute" as const, args: { dataSourceId: blockNodeId(selected.id, "query") } }] : [])] }],
        });
      }
    }
  }
  return { components, state, dataSources, connections };
}

function outputField(field: BlockFieldDefinition) {
  return { fieldId: field.fieldId, label: field.label,
    protection: field.maskPolicyId === undefined ? { mode: "normal" } : { mode: "mask-when-required", maskPolicyId: field.maskPolicyId } };
}

export function withPageAuthoring(page: ComposedPageDefinition, authoring: PageAuthoringDefinition): ComposedPageDefinition {
  // Page events belong to the legacy graph. A new authoring source owns all behavior.
  const { events: _, ...base } = page;
  return { ...base, authoring, ...compilePageAuthoring(authoring) };
}
