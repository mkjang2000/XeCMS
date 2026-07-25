import type { AdminPageDefinition } from "../types.js";
import type {
  ComponentDefinition,
  ComposedPageDefinition,
  ConnectionDefinition,
  DataSourceDefinition,
  PageStateDefinition,
} from "./types.js";

/**
 * Presets are pure templates: each returns a complete ComposedPageDefinition
 * built only from the same Page/Component/State/Data Source/Connection/Event
 * primitives the Builder produces by hand (D-19). A screen started from a Preset
 * is therefore indistinguishable, at the Runtime Contract, from one built from
 * scratch — this is the CPB-8 completion Gate, exercised by the preset tests.
 */

export interface PresetColumn {
  readonly fieldId: string;
  readonly label?: string;
  /** Set for sensitive fields so the list/detail masks them when required. */
  readonly maskPolicyId?: string;
}

interface PresetMeta {
  /** Unique-within-App page id, and prefix for the nodes it owns. */
  readonly pageId: string;
  readonly screenNo: string;
  readonly title: string;
  readonly menuLabel: string;
}

function protection(column: PresetColumn): { readonly mode: string; readonly maskPolicyId?: string } {
  return column.maskPolicyId === undefined
    ? { mode: "normal" }
    : { mode: "mask-when-required", maskPolicyId: column.maskPolicyId };
}

function emptyPage(meta: PresetMeta): ComposedPageDefinition {
  return {
    id: meta.pageId,
    type: "composed-page",
    screenNo: meta.screenNo,
    title: meta.title,
    menuLabel: meta.menuLabel,
    layout: { columns: 48, rowHeight: 8 },
    state: [],
    dataSources: [],
    components: [],
    connections: [],
  };
}

/** A search input + button, a results table, wired to a manual document-query. */
export function searchListPreset(input: {
  readonly meta: PresetMeta;
  readonly collectionId: string;
  readonly searchFieldId: string;
  readonly columns: readonly PresetColumn[];
}): ComposedPageDefinition {
  const p = input.meta.pageId;
  const state: PageStateDefinition[] = [
    { id: `${p}_state_search`, valueType: "string", initialValue: "" },
  ];
  const dataSources: DataSourceDefinition[] = [{
    id: `${p}_query`,
    type: "document-query",
    collectionId: input.collectionId,
    trigger: "manual",
    fields: input.columns.map((column) => column.fieldId),
    parameters: [{ id: "param_search", valueType: "string" }],
    filter: {
      type: "condition",
      field: { kind: "data", fieldId: input.searchFieldId },
      operator: "contains",
      value: { type: "parameter", parameterId: "param_search" },
    },
    limit: 20,
  }];
  const components: ComponentDefinition[] = [
    { id: `${p}_input`, kind: "core.input.text", placement: { x: 0, y: 0, width: 16, height: 5 }, props: { label: "검색" } },
    { id: `${p}_button`, kind: "core.button", placement: { x: 17, y: 0, width: 5, height: 5 }, props: { label: "조회", tone: "primary" } },
    {
      id: `${p}_table`, kind: "core.output.table", placement: { x: 0, y: 7, width: 48, height: 30 },
      props: { columns: input.columns.map((column, index) => ({ id: `column_${index}`, fieldId: column.fieldId, label: column.label ?? column.fieldId, protection: protection(column) })) },
    },
  ];
  const connections: ConnectionDefinition[] = [
    { id: `${p}_conn_input`, from: { nodeType: "component", nodeId: `${p}_input`, portId: "value" }, to: { nodeType: "state", nodeId: `${p}_state_search`, portId: "write" } },
    { id: `${p}_conn_param`, from: { nodeType: "state", nodeId: `${p}_state_search`, portId: "value" }, to: { nodeType: "data-source", nodeId: `${p}_query`, portId: "parameter:param_search" } },
    { id: `${p}_conn_exec`, from: { nodeType: "component", nodeId: `${p}_button`, portId: "clicked" }, to: { nodeType: "data-source", nodeId: `${p}_query`, portId: "execute" } },
    { id: `${p}_conn_rows`, from: { nodeType: "data-source", nodeId: `${p}_query`, portId: "rows" }, to: { nodeType: "component", nodeId: `${p}_table`, portId: "data" } },
  ];
  return { ...emptyPage(input.meta), state, dataSources, components, connections };
}

/** Search + list on the left, and a detail panel that follows the selected row. */
export function masterDetailPreset(input: {
  readonly meta: PresetMeta;
  readonly collectionId: string;
  readonly searchFieldId: string;
  readonly listColumns: readonly PresetColumn[];
  readonly detailFields: readonly PresetColumn[];
}): ComposedPageDefinition {
  const base = searchListPreset({
    meta: input.meta, collectionId: input.collectionId, searchFieldId: input.searchFieldId, columns: input.listColumns,
  });
  const p = input.meta.pageId;
  // Narrow the table to the left half and add a selection state + detail panel.
  const table = base.components.map((component) =>
    component.id === `${p}_table`
      ? { ...component, placement: { x: 0, y: 7, width: 30, height: 30 } }
      : component);
  const state: PageStateDefinition[] = [
    ...base.state,
    { id: `${p}_state_selected`, valueType: "document-id", initialValue: null },
  ];
  const detail: ComponentDefinition = {
    id: `${p}_detail`, kind: "core.output.detail", placement: { x: 31, y: 7, width: 17, height: 30 },
    props: { collectionId: input.collectionId, fields: input.detailFields.map((field) => ({ fieldId: field.fieldId, protection: protection(field) })) },
  };
  const connections: ConnectionDefinition[] = [
    ...base.connections,
    { id: `${p}_conn_select`, from: { nodeType: "component", nodeId: `${p}_table`, portId: "selectedDocumentId" }, to: { nodeType: "state", nodeId: `${p}_state_selected`, portId: "write" } },
    { id: `${p}_conn_detail`, from: { nodeType: "state", nodeId: `${p}_state_selected`, portId: "value" }, to: { nodeType: "component", nodeId: `${p}_detail`, portId: "documentId" } },
  ];
  return { ...base, state, components: [...table, detail], connections };
}

/**
 * master/detail plus an input form and a "저장" button whose onClick create/update
 * Action targets the selected document. Its permission is enforced by the server.
 */
export function viewEditPreset(input: {
  readonly meta: PresetMeta;
  readonly collectionId: string;
  readonly searchFieldId: string;
  readonly listColumns: readonly PresetColumn[];
  readonly detailFields: readonly PresetColumn[];
  readonly formFieldIds: readonly string[];
}): ComposedPageDefinition {
  const base = masterDetailPreset({
    meta: input.meta, collectionId: input.collectionId, searchFieldId: input.searchFieldId,
    listColumns: input.listColumns, detailFields: input.detailFields,
  });
  const p = input.meta.pageId;
  const form: ComponentDefinition = {
    id: `${p}_form`, kind: "core.form", placement: { x: 31, y: 38, width: 17, height: 20 },
    props: { collectionId: input.collectionId, label: "입력", fields: input.formFieldIds.map((fieldId) => ({ fieldId, inputKind: "text" })) },
  };
  const saveButton: ComponentDefinition = {
    id: `${p}_save`, kind: "core.button", placement: { x: 23, y: 0, width: 6, height: 5 }, props: { label: "저장", tone: "primary" },
    events: [{
      id: `${p}_evt_save`, event: "onClick",
      effects: [
        { id: `${p}_fx_update`, kind: "action.execute", args: { actionId: "core.action.update", collectionId: input.collectionId, formComponentId: `${p}_form`, documentStateId: `${p}_state_selected` } },
        { id: `${p}_fx_refresh`, kind: "data-source.execute", args: { dataSourceId: `${p}_query` } },
      ],
    }],
  };
  return { ...base, components: [...base.components, form, saveButton] };
}

/**
 * Copies a Generated Page (collection-list / document-detail) into a new
 * Composed Page so it can be edited freely on the canvas. The original Generated
 * Page is untouched — the result carries a fresh id (`meta.pageId`), owns its own
 * nodes, and produces the same Runtime Contract as a hand-built screen. Returns
 * null for page types with no straightforward composed equivalent yet.
 */
export function convertGeneratedToComposed(
  page: AdminPageDefinition,
  meta: PresetMeta,
): ComposedPageDefinition | null {
  if (page.type === "collection-list") {
    const columns: PresetColumn[] = page.columns.flatMap((column) =>
      column.field.kind === "data"
        ? [{ fieldId: column.field.fieldId, ...(column.label === undefined ? {} : { label: column.label }) }]
        : []);
    if (columns.length === 0) return null;
    return searchListPreset({
      meta, collectionId: page.collectionId, searchFieldId: columns[0]!.fieldId, columns,
    });
  }
  if (page.type === "document-detail") {
    const fieldIds = page.layout.panels.flatMap((panel) =>
      panel.type === "summary" || panel.type === "field-group" ? panel.fieldIds : []);
    if (fieldIds.length === 0) return null;
    return detailOnlyPage(meta, page.collectionId, fieldIds);
  }
  return null;
}

/** A detail-only Composed Page whose document id is a Page State (settable later). */
function detailOnlyPage(
  meta: PresetMeta,
  collectionId: string,
  fieldIds: readonly string[],
): ComposedPageDefinition {
  const p = meta.pageId;
  const state: PageStateDefinition[] = [
    { id: `${p}_state_selected`, valueType: "document-id", initialValue: null },
  ];
  const detail: ComponentDefinition = {
    id: `${p}_detail`, kind: "core.output.detail", placement: { x: 0, y: 0, width: 24, height: 40 },
    props: { collectionId, fields: fieldIds.map((fieldId) => ({ fieldId, protection: { mode: "normal" } })) },
  };
  const connections: ConnectionDefinition[] = [
    { id: `${p}_conn_detail`, from: { nodeType: "state", nodeId: `${p}_state_selected`, portId: "value" }, to: { nodeType: "component", nodeId: `${p}_detail`, portId: "documentId" } },
  ];
  return { ...emptyPage(meta), state, components: [detail], connections };
}
