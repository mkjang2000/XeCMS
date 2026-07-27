import { AdminAppManifestValidationError, type AdminAppIssue } from "../errors.js";
import type {
  ComponentDefinition,
  ComposedPageDefinition,
  ConnectionDefinition,
  DataSourceDefinition,
  GridPlacement,
  PageStateDefinition,
  ParameterizedFilterExpression,
  PortReference,
  AdminAppManifestV2,
  AdminPageDefinitionV2,
} from "./types.js";

type Path = readonly (string | number)[];

/** App id/key are kebab-case (back the DB manifest_id/app_key columns). */
const KEBAB_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Composed Page node ids allow snake_case and kebab (e.g. pg_customer_search, nav-x). */
const NODE_ID = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const SCREEN_NO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const COLLECTION_ID = /^col_[a-z0-9][a-z0-9_-]{0,95}$/;
const FIELD_ID = /^fld_[a-z0-9][a-z0-9_-]{0,95}$/;
const GRID_COLUMNS = 48;

/** Port direction: outputs may only connect to inputs (§4.8). */
type PortDirection = "out" | "in";

export function validateAdminAppManifestV2(manifest: AdminAppManifestV2): {
  readonly valid: boolean;
  readonly issues: readonly AdminAppIssue[];
} {
  const issues: AdminAppIssue[] = [];
  if (manifest.format !== "xecms.admin-app" || manifest.formatVersion !== 2) {
    add(issues, "INVALID_MANIFEST", "format and formatVersion must identify Admin App Manifest V2.", []);
  }
  // App id and key are kebab-case (they back the DB manifest_id/app_key columns).
  if (manifest.id.length > 64 || !KEBAB_ID.test(manifest.id)) {
    add(issues, "INVALID_PORTABLE_ID", "App ID must be lowercase kebab-case with at most 64 characters.", ["id"]);
  }
  if (manifest.key.length > 64 || !KEBAB_ID.test(manifest.key)) {
    add(issues, "INVALID_PORTABLE_ID", "App key must be lowercase kebab-case with at most 64 characters.", ["key"]);
  }

  const pageIds = new Set<string>();
  const screenNumbers = new Set<string>();
  manifest.pages.forEach((page, index) => {
    const path = ["pages", index] as const;
    if (pageIds.has(page.id)) add(issues, "DUPLICATE_PAGE_ID", `Page id '${page.id}' is duplicated.`, path);
    pageIds.add(page.id);
    if (page.type === "composed-page") {
      validateComposedPage(issues, page, path, screenNumbers);
    }
  });

  if (!pageIds.has(manifest.startPageId)) {
    add(issues, "INVALID_START_PAGE", `startPageId '${manifest.startPageId}' does not reference a page.`, ["startPageId"]);
  }
  manifest.navigation.forEach((item, index) => {
    if (item.pageId !== undefined && !pageIds.has(item.pageId)) {
      add(issues, "INVALID_NAVIGATION_TARGET", `Navigation references unknown page '${item.pageId}'.`, ["navigation", index, "pageId"]);
    }
  });

  return { valid: issues.length === 0, issues };
}

export function assertValidAdminAppManifestV2(manifest: AdminAppManifestV2): void {
  const { valid, issues } = validateAdminAppManifestV2(manifest);
  if (!valid) throw new AdminAppManifestValidationError(issues);
}

function validateComposedPage(
  issues: AdminAppIssue[],
  page: ComposedPageDefinition,
  path: Path,
  screenNumbers: Set<string>,
): void {
  nodeId(issues, page.id, [...path, "id"], "Page id");
  if (!SCREEN_NO.test(page.screenNo)) {
    add(issues, "INVALID_SCREEN_NO", `screenNo '${page.screenNo}' must be 1-32 chars of [A-Za-z0-9_-].`, [...path, "screenNo"]);
  } else if (screenNumbers.has(page.screenNo)) {
    add(issues, "DUPLICATE_SCREEN_NO", `screenNo '${page.screenNo}' is duplicated within the App.`, [...path, "screenNo"]);
  }
  screenNumbers.add(page.screenNo);

  // Node id uniqueness across state, data sources, and components.
  const stateIds = collectIds(issues, page.state, [...path, "state"], "state");
  const dataSourceIds = collectIds(issues, page.dataSources, [...path, "dataSources"], "data source");
  const componentIds = collectIds(issues, page.components, [...path, "components"], "component");

  page.state.forEach((state, index) => validateState(issues, state, [...path, "state", index]));
  page.dataSources.forEach((source, index) =>
    validateDataSource(issues, source, [...path, "dataSources", index], stateIds));
  page.components.forEach((component, index) =>
    validatePlacement(issues, component.placement, [...path, "components", index, "placement"]));
  validateNoOverlap(issues, page.components, [...path, "components"]);

  validateConnections(issues, page, [...path, "connections"], {
    stateIds, dataSourceIds, componentIds,
  });
}

function validateState(issues: AdminAppIssue[], state: PageStateDefinition, path: Path): void {
  nodeId(issues, state.id, [...path, "id"], "State id");
}

function validateDataSource(
  issues: AdminAppIssue[],
  source: DataSourceDefinition,
  path: Path,
  _stateIds: ReadonlySet<string>,
): void {
  nodeId(issues, source.id, [...path, "id"], "Data source id");
  if (!COLLECTION_ID.test(source.collectionId)) {
    add(issues, "INVALID_COLLECTION_REFERENCE", `'${source.collectionId}' is not a stable Collection ID.`, [...path, "collectionId"]);
  }
  source.fields.forEach((fieldId, index) => {
    if (!FIELD_ID.test(fieldId)) add(issues, "INVALID_FIELD_REFERENCE", `'${fieldId}' is not a stable Field ID.`, [...path, "fields", index]);
  });
  if (!Number.isInteger(source.limit) || source.limit < 1 || source.limit > 100) {
    add(issues, "INVALID_QUERY_LIMIT", "Data source limit must be an integer between 1 and 100.", [...path, "limit"]);
  }
  // Query parameters must reference declared parameters only.
  const parameterIds = new Set((source.parameters ?? []).map(({ id }) => id));
  if (source.filter !== undefined) {
    validateFilter(issues, source.filter, [...path, "filter"], parameterIds);
  }
}

function validateFilter(
  issues: AdminAppIssue[],
  filter: ParameterizedFilterExpression,
  path: Path,
  parameterIds: ReadonlySet<string>,
): void {
  if (filter.type === "group") {
    filter.filters.forEach((child, index) => validateFilter(issues, child, [...path, "filters", index], parameterIds));
    return;
  }
  if (filter.field.kind === "data" && !FIELD_ID.test(filter.field.fieldId)) {
    add(issues, "INVALID_FIELD_REFERENCE", `'${filter.field.fieldId}' is not a stable Field ID.`, [...path, "field", "fieldId"]);
  }
  if (filter.value?.type === "parameter" && !parameterIds.has(filter.value.parameterId)) {
    add(issues, "UNKNOWN_QUERY_PARAMETER", `Filter references undeclared parameter '${filter.value.parameterId}'.`, [...path, "value", "parameterId"]);
  }
}

function validatePlacement(issues: AdminAppIssue[], placement: GridPlacement, path: Path): void {
  const { x, y, width, height } = placement;
  if (!Number.isInteger(x) || x < 0 || x > GRID_COLUMNS - 1) {
    add(issues, "INVALID_PLACEMENT", `placement.x must be an integer in 0..${GRID_COLUMNS - 1}.`, [...path, "x"]);
  }
  if (!Number.isInteger(y) || y < 0) add(issues, "INVALID_PLACEMENT", "placement.y must be a non-negative integer.", [...path, "y"]);
  if (!Number.isInteger(width) || width < 1 || width > GRID_COLUMNS) {
    add(issues, "INVALID_PLACEMENT", `placement.width must be an integer in 1..${GRID_COLUMNS}.`, [...path, "width"]);
  }
  if (!Number.isInteger(height) || height < 1) add(issues, "INVALID_PLACEMENT", "placement.height must be a positive integer.", [...path, "height"]);
  if (Number.isInteger(x) && Number.isInteger(width) && x + width > GRID_COLUMNS) {
    add(issues, "INVALID_PLACEMENT", `placement.x + width must not exceed ${GRID_COLUMNS}.`, [...path, "width"]);
  }
}

/** Components may not overlap (D-02). Rectangles intersect when they overlap on both axes. */
function validateNoOverlap(issues: AdminAppIssue[], components: readonly ComponentDefinition[], path: Path): void {
  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      if (rectanglesOverlap(components[i]!.placement, components[j]!.placement)) {
        add(issues, "COMPONENT_OVERLAP",
          `Components '${components[i]!.id}' and '${components[j]!.id}' overlap.`,
          [...path, j, "placement"]);
      }
    }
  }
}

function rectanglesOverlap(a: GridPlacement, b: GridPlacement): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

interface NodeIndex {
  readonly stateIds: ReadonlySet<string>;
  readonly dataSourceIds: ReadonlySet<string>;
  readonly componentIds: ReadonlySet<string>;
}

function validateConnections(
  issues: AdminAppIssue[],
  page: ComposedPageDefinition,
  path: Path,
  index: NodeIndex,
): void {
  const connectionIds = new Set<string>();
  const inboundSingle = new Set<string>(); // single-input ports already connected
  const edges: Array<readonly [string, string]> = []; // node-level edges for cycle detection

  page.connections.forEach((connection, i) => {
    const itemPath = [...path, i] as const;
    if (connectionIds.has(connection.id)) {
      add(issues, "DUPLICATE_CONNECTION_ID", `Connection id '${connection.id}' is duplicated.`, [...itemPath, "id"]);
    }
    connectionIds.add(connection.id);

    const fromOk = validatePortExists(issues, connection.from, [...itemPath, "from"], index);
    const toOk = validatePortExists(issues, connection.to, [...itemPath, "to"], index);
    if (!fromOk || !toOk) return;

    // Direction: from must be an output port, to must be an input port.
    if (portDirection(connection.from) !== "out") {
      add(issues, "INVALID_CONNECTION_DIRECTION", "A connection must start at an output port.", [...itemPath, "from"]);
    }
    if (portDirection(connection.to) !== "in") {
      add(issues, "INVALID_CONNECTION_DIRECTION", "A connection must end at an input port.", [...itemPath, "to"]);
    }
    // Single-input ports reject duplicate inbound connections.
    const inboundKey = `${connection.to.nodeType}\0${connection.to.nodeId}\0${connection.to.portId}`;
    if (inboundSingle.has(inboundKey)) {
      add(issues, "DUPLICATE_INBOUND_CONNECTION", `Input port '${connection.to.portId}' on '${connection.to.nodeId}' already has a connection.`, [...itemPath, "to"]);
    }
    inboundSingle.add(inboundKey);

    edges.push([connection.from.nodeId, connection.to.nodeId]);
  });

  if (hasCycle(edges)) {
    add(issues, "CONNECTION_CYCLE", "Connections must not form a dependency cycle.", path);
  }
}

function validatePortExists(
  issues: AdminAppIssue[],
  port: PortReference,
  path: Path,
  index: NodeIndex,
): boolean {
  const known = port.nodeType === "state" ? index.stateIds
    : port.nodeType === "data-source" ? index.dataSourceIds
    : index.componentIds;
  if (!known.has(port.nodeId)) {
    add(issues, "DANGLING_CONNECTION", `Connection references unknown ${port.nodeType} '${port.nodeId}'.`, [...path, "nodeId"]);
    return false;
  }
  return true;
}

/** Output ports read a value/emit an event; input ports receive one (§4.8). */
function portDirection(port: PortReference): PortDirection {
  if (port.nodeType === "state") return port.portId === "value" ? "out" : "in"; // "write" is input
  if (port.nodeType === "data-source") {
    if (port.portId === "rows" || port.portId === "row" || port.portId === "state") return "out";
    return "in"; // execute / reset / parameter:*
  }
  // component: heuristic on well-known port names; unknown treated as output-capable value port.
  if (port.portId === "clicked" || port.portId === "value" || port.portId === "selectedDocumentId"
    || port.portId.startsWith("value:") || port.portId.startsWith("selectedField:")
    || port.portId.startsWith("out:")) return "out";
  if (port.portId === "data" || port.portId === "documentId" || port.portId.startsWith("in:")) return "in";
  return "out";
}

function hasCycle(edges: readonly (readonly [string, string])[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of edges) {
    if (from === to) return true;
    (adjacency.get(from) ?? adjacency.set(from, []).get(from)!).push(to);
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string): boolean => {
    const current = state.get(node);
    if (current === "visiting") return true;
    if (current === "done") return false;
    state.set(node, "visiting");
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    state.set(node, "done");
    return false;
  };
  for (const node of adjacency.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

function collectIds(
  issues: AdminAppIssue[],
  nodes: readonly { readonly id: string }[],
  path: Path,
  label: string,
): ReadonlySet<string> {
  const seen = new Set<string>();
  nodes.forEach((node, index) => {
    if (seen.has(node.id)) add(issues, "DUPLICATE_NODE_ID", `Duplicate ${label} id '${node.id}'.`, [...path, index, "id"]);
    seen.add(node.id);
  });
  return seen;
}

function nodeId(issues: AdminAppIssue[], value: string, path: Path, label: string): void {
  if (value.length > 64 || !NODE_ID.test(value)) {
    add(issues, "INVALID_PORTABLE_ID", `${label} must be lowercase kebab/underscore with at most 64 characters.`, path);
  }
}

function add(issues: AdminAppIssue[], code: string, message: string, path: Path): void {
  issues.push({ code, message, path });
}
