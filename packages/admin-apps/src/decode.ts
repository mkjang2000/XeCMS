import { AdminAppManifestDecodeError } from "./errors.js";
import { normalizeAdminAppManifestUnchecked } from "./normalize.js";
import type {
  AdminAppActionReference,
  AdminAppColumnDefinition,
  AdminAppDocumentQuery,
  AdminAppFieldReference,
  AdminAppFilterDefinition,
  AdminAppFilterExpression,
  AdminAppFilterOperator,
  AdminAppManifestV1,
  AdminAppPageLinkDefinition,
  AdminAppScalar,
  AdminAppSortDefinition,
  AdminNavigationItem,
  AdminPageDefinition,
  DashboardWidgetDefinition,
  DetailLayoutDefinition,
  DetailPanelDefinition,
  FormLayoutDefinition,
  FormLayoutNode,
  FormTabDefinition,
  PermissionReference,
  VisibilityCondition,
} from "./types.js";
import { assertValidAdminAppManifest } from "./validate.js";

type Path = readonly (string | number)[];
type UnknownRecord = Readonly<Record<string, unknown>>;

export function decodeAdminAppManifest(input: unknown): AdminAppManifestV1 {
  assertJsonCompatible(input, [], new Set());
  const manifest = decodeManifest(input, []);
  assertValidAdminAppManifest(manifest);
  return normalizeAdminAppManifestUnchecked(manifest);
}

export function parseAdminAppManifest(serialized: string): AdminAppManifestV1 {
  let input: unknown;
  try {
    input = JSON.parse(serialized) as unknown;
  } catch (error: unknown) {
    fail(
      "INVALID_JSON_SYNTAX",
      `Admin App Manifest is not valid JSON.${error instanceof Error ? ` ${error.message}` : ""}`,
      [],
    );
  }
  return decodeAdminAppManifest(input);
}

function decodeManifest(input: unknown, path: Path): AdminAppManifestV1 {
  const value = object(input, path);
  exact(value, [
    "format", "formatVersion", "id", "name", "key", "description", "icon",
    "audience", "navigation", "pages", "startPageId",
  ], path);
  return {
    format: literal(required(value, "format", path), "xecms.admin-app", [...path, "format"]),
    formatVersion: literal(required(value, "formatVersion", path), 1, [...path, "formatVersion"]),
    id: text(required(value, "id", path), [...path, "id"]),
    name: text(required(value, "name", path), [...path, "name"]),
    key: text(required(value, "key", path), [...path, "key"]),
    ...(has(value, "description") ? { description: text(value["description"], [...path, "description"]) } : {}),
    ...(has(value, "icon") ? { icon: text(value["icon"], [...path, "icon"]) } : {}),
    audience: decodeAudience(required(value, "audience", path), [...path, "audience"]),
    navigation: list(required(value, "navigation", path), [...path, "navigation"]).map(
      (item, index) => decodeNavigation(item, [...path, "navigation", index]),
    ),
    pages: list(required(value, "pages", path), [...path, "pages"]).map(
      (item, index) => decodePage(item, [...path, "pages", index]),
    ),
    startPageId: text(required(value, "startPageId", path), [...path, "startPageId"]),
  };
}

function decodeAudience(input: unknown, path: Path): AdminAppManifestV1["audience"] {
  const value = object(input, path);
  if (value["type"] === "system") {
    exact(value, ["type"], path);
    return { type: "system" };
  }
  if (value["type"] === "content-realm") {
    exact(value, ["type", "realmId"], path);
    return {
      type: "content-realm",
      realmId: text(required(value, "realmId", path), [...path, "realmId"]),
    };
  }
  fail("INVALID_LITERAL", "audience.type must be 'system' or 'content-realm'.", [...path, "type"]);
}

function decodeNavigation(input: unknown, path: Path): AdminNavigationItem {
  const value = object(input, path);
  exact(value, ["id", "label", "icon", "pageId", "children", "visibility"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    label: text(required(value, "label", path), [...path, "label"]),
    ...(has(value, "icon") ? { icon: text(value["icon"], [...path, "icon"]) } : {}),
    ...(has(value, "pageId") ? { pageId: text(value["pageId"], [...path, "pageId"]) } : {}),
    ...(has(value, "children") ? {
      children: list(value["children"], [...path, "children"]).map(
        (item, index) => decodeNavigation(item, [...path, "children", index]),
      ),
    } : {}),
    ...(has(value, "visibility") ? {
      visibility: decodeVisibility(value["visibility"], [...path, "visibility"]),
    } : {}),
  };
}

function decodeVisibility(input: unknown, path: Path): VisibilityCondition {
  const value = object(input, path);
  exact(value, ["allPermissions", "anyPermissions", "documentStatuses"], path);
  return {
    ...(has(value, "allPermissions") ? {
      allPermissions: list(value["allPermissions"], [...path, "allPermissions"]).map(
        (item, index) => decodePermission(item, [...path, "allPermissions", index]),
      ),
    } : {}),
    ...(has(value, "anyPermissions") ? {
      anyPermissions: list(value["anyPermissions"], [...path, "anyPermissions"]).map(
        (item, index) => decodePermission(item, [...path, "anyPermissions", index]),
      ),
    } : {}),
    ...(has(value, "documentStatuses") ? {
      documentStatuses: stringList(value["documentStatuses"], [...path, "documentStatuses"]),
    } : {}),
  };
}

function decodePermission(input: unknown, path: Path): PermissionReference {
  const value = object(input, path);
  exact(value, ["action", "resourceId"], path);
  return {
    action: text(required(value, "action", path), [...path, "action"]),
    resourceId: text(required(value, "resourceId", path), [...path, "resourceId"]),
  };
}

function decodePage(input: unknown, path: Path): AdminPageDefinition {
  const value = object(input, path);
  switch (value["type"]) {
    case "collection-list": return decodeCollectionListPage(value, path);
    case "document-form": return decodeDocumentFormPage(value, path);
    case "document-detail": return decodeDocumentDetailPage(value, path);
    case "singleton": return decodeSingletonPage(value, path);
    case "dashboard": return decodeDashboardPage(value, path);
    case "plugin-page": return decodePluginPage(value, path);
    default: fail("UNKNOWN_PAGE_TYPE", `Unknown page type '${String(value["type"])}'.`, [...path, "type"]);
  }
}

function decodeCollectionListPage(value: UnknownRecord, path: Path): AdminPageDefinition {
  exact(value, [
    "id", "type", "collectionId", "title", "columns", "fixedFilter", "availableFilters",
    "defaultSort", "rowActions", "bulkActions", "rowClick",
  ], path);
  return {
    id: pageId(value, path),
    type: "collection-list",
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    ...optionalText(value, "title", path),
    columns: list(required(value, "columns", path), [...path, "columns"]).map(
      (item, index) => decodeColumn(item, [...path, "columns", index]),
    ),
    ...(has(value, "fixedFilter") ? { fixedFilter: decodeFilter(value["fixedFilter"], [...path, "fixedFilter"]) } : {}),
    ...(has(value, "availableFilters") ? {
      availableFilters: list(value["availableFilters"], [...path, "availableFilters"]).map(
        (item, index) => decodeAvailableFilter(item, [...path, "availableFilters", index]),
      ),
    } : {}),
    ...(has(value, "defaultSort") ? { defaultSort: decodeSorts(value["defaultSort"], [...path, "defaultSort"]) } : {}),
    ...optionalActions(value, "rowActions", path),
    ...optionalActions(value, "bulkActions", path),
    ...(has(value, "rowClick") ? { rowClick: decodePageLink(value["rowClick"], [...path, "rowClick"]) } : {}),
  };
}

function decodeDocumentFormPage(value: UnknownRecord, path: Path): AdminPageDefinition {
  exact(value, ["id", "type", "collectionId", "mode", "layout", "actions"], path);
  return {
    id: pageId(value, path),
    type: "document-form",
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    mode: choice(required(value, "mode", path), ["create", "edit", "create-or-edit"] as const, [...path, "mode"]),
    layout: decodeFormLayout(required(value, "layout", path), [...path, "layout"]),
    ...optionalActions(value, "actions", path),
  };
}

function decodeDocumentDetailPage(value: UnknownRecord, path: Path): AdminPageDefinition {
  exact(value, ["id", "type", "collectionId", "title", "layout", "actions"], path);
  return {
    id: pageId(value, path), type: "document-detail",
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    ...optionalText(value, "title", path),
    layout: decodeDetailLayout(required(value, "layout", path), [...path, "layout"]),
    ...optionalActions(value, "actions", path),
  };
}

function decodeSingletonPage(value: UnknownRecord, path: Path): AdminPageDefinition {
  exact(value, ["id", "type", "collectionId", "title", "layout", "actions"], path);
  return {
    id: pageId(value, path), type: "singleton",
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    ...optionalText(value, "title", path),
    layout: decodeFormLayout(required(value, "layout", path), [...path, "layout"]),
    ...optionalActions(value, "actions", path),
  };
}

function decodeDashboardPage(value: UnknownRecord, path: Path): AdminPageDefinition {
  exact(value, ["id", "type", "title", "widgets"], path);
  return {
    id: pageId(value, path), type: "dashboard", ...optionalText(value, "title", path),
    widgets: list(required(value, "widgets", path), [...path, "widgets"]).map(
      (item, index) => decodeWidget(item, [...path, "widgets", index]),
    ),
  };
}

function decodePluginPage(value: UnknownRecord, path: Path): AdminPageDefinition {
  exact(value, ["id", "type", "title", "extensionId"], path);
  return {
    id: pageId(value, path), type: "plugin-page", ...optionalText(value, "title", path),
    extensionId: text(required(value, "extensionId", path), [...path, "extensionId"]),
  };
}

function pageId(value: UnknownRecord, path: Path): string {
  return text(required(value, "id", path), [...path, "id"]);
}

function decodeColumn(input: unknown, path: Path): AdminAppColumnDefinition {
  const value = object(input, path);
  exact(value, ["id", "field", "label", "width", "rendererId"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    field: decodeFieldReference(required(value, "field", path), [...path, "field"]),
    ...optionalText(value, "label", path),
    ...(has(value, "width") ? { width: integer(value["width"], [...path, "width"]) } : {}),
    ...(has(value, "rendererId") ? { rendererId: text(value["rendererId"], [...path, "rendererId"]) } : {}),
  };
}

function decodeAvailableFilter(input: unknown, path: Path): AdminAppFilterDefinition {
  const value = object(input, path);
  exact(value, ["id", "label", "field", "operators"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    label: text(required(value, "label", path), [...path, "label"]),
    field: decodeFieldReference(required(value, "field", path), [...path, "field"]),
    ...(has(value, "operators") ? {
      operators: list(value["operators"], [...path, "operators"]).map(
        (item, index) => decodeFilterOperator(item, [...path, "operators", index]),
      ),
    } : {}),
  };
}

function decodeFieldReference(input: unknown, path: Path): AdminAppFieldReference {
  const value = object(input, path);
  if (value["kind"] === "data") {
    exact(value, ["kind", "fieldId"], path);
    return { kind: "data", fieldId: text(required(value, "fieldId", path), [...path, "fieldId"]) };
  }
  if (value["kind"] === "system") {
    exact(value, ["kind", "field"], path);
    return {
      kind: "system",
      field: choice(required(value, "field", path), ["id", "createdAt", "updatedAt", "version"] as const, [...path, "field"]),
    };
  }
  fail("INVALID_LITERAL", "field.kind must be 'data' or 'system'.", [...path, "kind"]);
}

function decodeFilter(input: unknown, path: Path): AdminAppFilterExpression {
  const value = object(input, path);
  if (value["type"] === "group") {
    exact(value, ["type", "operator", "filters"], path);
    return {
      type: "group",
      operator: choice(required(value, "operator", path), ["and", "or"] as const, [...path, "operator"]),
      filters: list(required(value, "filters", path), [...path, "filters"]).map(
        (item, index) => decodeFilter(item, [...path, "filters", index]),
      ),
    };
  }
  if (value["type"] === "condition") {
    exact(value, ["type", "field", "operator", "value"], path);
    return {
      type: "condition",
      field: decodeFieldReference(required(value, "field", path), [...path, "field"]),
      operator: decodeFilterOperator(required(value, "operator", path), [...path, "operator"]),
      ...(has(value, "value") ? { value: decodeFilterValue(value["value"], [...path, "value"]) } : {}),
    };
  }
  fail("INVALID_LITERAL", "filter.type must be 'condition' or 'group'.", [...path, "type"]);
}

const FILTER_OPERATORS = [
  "eq", "ne", "lt", "lte", "gt", "gte", "contains", "startsWith", "in", "isNull", "isNotNull",
] as const;

function decodeFilterOperator(input: unknown, path: Path): AdminAppFilterOperator {
  return choice(input, FILTER_OPERATORS, path);
}

function decodeFilterValue(
  input: unknown,
  path: Path,
): AdminAppScalar | readonly AdminAppScalar[] {
  if (Array.isArray(input)) return input.map((item, index) => scalar(item, [...path, index]));
  return scalar(input, path);
}

function decodeSorts(input: unknown, path: Path): readonly AdminAppSortDefinition[] {
  return list(input, path).map((item, index) => {
    const itemPath = [...path, index] as const;
    const value = object(item, itemPath);
    exact(value, ["field", "direction"], itemPath);
    return {
      field: decodeFieldReference(required(value, "field", itemPath), [...itemPath, "field"]),
      direction: choice(required(value, "direction", itemPath), ["asc", "desc"] as const, [...itemPath, "direction"]),
    };
  });
}

function decodeAction(input: unknown, path: Path): AdminAppActionReference {
  const value = object(input, path);
  exact(value, ["id", "label", "visibility", "confirmation"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    ...optionalText(value, "label", path),
    ...(has(value, "visibility") ? { visibility: decodeVisibility(value["visibility"], [...path, "visibility"]) } : {}),
    ...(has(value, "confirmation") ? { confirmation: decodeConfirmation(value["confirmation"], [...path, "confirmation"]) } : {}),
  };
}

function decodeConfirmation(input: unknown, path: Path): NonNullable<AdminAppActionReference["confirmation"]> {
  const value = object(input, path);
  exact(value, ["title", "message", "danger"], path);
  return {
    title: text(required(value, "title", path), [...path, "title"]),
    message: text(required(value, "message", path), [...path, "message"]),
    ...(has(value, "danger") ? { danger: bool(value["danger"], [...path, "danger"]) } : {}),
  };
}

function decodePageLink(input: unknown, path: Path): AdminAppPageLinkDefinition {
  const value = object(input, path);
  exact(value, ["pageId", "documentIdFrom"], path);
  return {
    pageId: text(required(value, "pageId", path), [...path, "pageId"]),
    ...(has(value, "documentIdFrom") ? {
      documentIdFrom: literal(value["documentIdFrom"], "row", [...path, "documentIdFrom"]),
    } : {}),
  };
}

function decodeFormLayout(input: unknown, path: Path): FormLayoutDefinition {
  const value = object(input, path);
  exact(value, ["nodes"], path);
  return {
    nodes: list(required(value, "nodes", path), [...path, "nodes"]).map(
      (item, index) => decodeFormNode(item, [...path, "nodes", index]),
    ),
  };
}

function decodeFormNode(input: unknown, path: Path): FormLayoutNode {
  const value = object(input, path);
  switch (value["type"]) {
    case "field": {
      exact(value, ["id", "type", "fieldId", "label", "description", "width", "hidden", "readOnly", "widgetId", "when"], path);
      return {
        id: text(required(value, "id", path), [...path, "id"]), type: "field",
        fieldId: text(required(value, "fieldId", path), [...path, "fieldId"]),
        ...optionalText(value, "label", path), ...optionalText(value, "description", path),
        ...(has(value, "width") ? { width: choice(value["width"], ["full", "half", "third"] as const, [...path, "width"]) } : {}),
        ...(has(value, "hidden") ? { hidden: bool(value["hidden"], [...path, "hidden"]) } : {}),
        ...(has(value, "readOnly") ? { readOnly: bool(value["readOnly"], [...path, "readOnly"]) } : {}),
        ...(has(value, "widgetId") ? { widgetId: text(value["widgetId"], [...path, "widgetId"]) } : {}),
        ...(has(value, "when") ? { when: decodeFilter(value["when"], [...path, "when"]) } : {}),
      };
    }
    case "section": {
      exact(value, ["id", "type", "title", "description", "columns", "children"], path);
      return {
        id: text(required(value, "id", path), [...path, "id"]), type: "section",
        ...optionalText(value, "title", path), ...optionalText(value, "description", path),
        ...(has(value, "columns") ? { columns: choice(value["columns"], [1, 2, 3] as const, [...path, "columns"]) } : {}),
        children: decodeFormChildren(required(value, "children", path), [...path, "children"]),
      };
    }
    case "tabs": {
      exact(value, ["id", "type", "tabs"], path);
      return {
        id: text(required(value, "id", path), [...path, "id"]), type: "tabs",
        tabs: list(required(value, "tabs", path), [...path, "tabs"]).map(
          (item, index) => decodeTab(item, [...path, "tabs", index]),
        ),
      };
    }
    case "collapse": {
      exact(value, ["id", "type", "title", "initiallyOpen", "children"], path);
      return {
        id: text(required(value, "id", path), [...path, "id"]), type: "collapse",
        title: text(required(value, "title", path), [...path, "title"]),
        ...(has(value, "initiallyOpen") ? { initiallyOpen: bool(value["initiallyOpen"], [...path, "initiallyOpen"]) } : {}),
        children: decodeFormChildren(required(value, "children", path), [...path, "children"]),
      };
    }
    default: fail("UNKNOWN_LAYOUT_TYPE", `Unknown form layout type '${String(value["type"])}'.`, [...path, "type"]);
  }
}

function decodeFormChildren(input: unknown, path: Path): readonly FormLayoutNode[] {
  return list(input, path).map((item, index) => decodeFormNode(item, [...path, index]));
}

function decodeTab(input: unknown, path: Path): FormTabDefinition {
  const value = object(input, path);
  exact(value, ["id", "label", "children"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    label: text(required(value, "label", path), [...path, "label"]),
    children: decodeFormChildren(required(value, "children", path), [...path, "children"]),
  };
}

function decodeDetailLayout(input: unknown, path: Path): DetailLayoutDefinition {
  const value = object(input, path);
  exact(value, ["panels"], path);
  return {
    panels: list(required(value, "panels", path), [...path, "panels"]).map(
      (item, index) => decodePanel(item, [...path, "panels", index]),
    ),
  };
}

function decodePanel(input: unknown, path: Path): DetailPanelDefinition {
  const value = object(input, path);
  const id = text(required(value, "id", path), [...path, "id"]);
  switch (value["type"]) {
    case "summary":
      exact(value, ["id", "type", "fieldIds"], path);
      return { id, type: "summary", fieldIds: stringList(required(value, "fieldIds", path), [...path, "fieldIds"]) };
    case "field-group":
      exact(value, ["id", "type", "title", "fieldIds"], path);
      return { id, type: "field-group", ...optionalText(value, "title", path), fieldIds: stringList(required(value, "fieldIds", path), [...path, "fieldIds"]) };
    case "relation":
      exact(value, ["id", "type", "relationId", "title"], path);
      return { id, type: "relation", relationId: text(required(value, "relationId", path), [...path, "relationId"]), ...optionalText(value, "title", path) };
    case "revisions": exact(value, ["id", "type"], path); return { id, type: "revisions" };
    case "audit": exact(value, ["id", "type"], path); return { id, type: "audit" };
    case "plugin":
      exact(value, ["id", "type", "extensionId"], path);
      return { id, type: "plugin", extensionId: text(required(value, "extensionId", path), [...path, "extensionId"]) };
    default: fail("UNKNOWN_PANEL_TYPE", `Unknown detail panel type '${String(value["type"])}'.`, [...path, "type"]);
  }
}

function decodeWidget(input: unknown, path: Path): DashboardWidgetDefinition {
  const value = object(input, path);
  exact(value, ["id", "widgetId", "title", "width", "query", "action", "visibility"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    widgetId: text(required(value, "widgetId", path), [...path, "widgetId"]),
    ...optionalText(value, "title", path),
    ...(has(value, "width") ? { width: choice(value["width"], [1, 2, 3, 4, 6, 8, 12] as const, [...path, "width"]) } : {}),
    ...(has(value, "query") ? { query: decodeQuery(value["query"], [...path, "query"]) } : {}),
    ...(has(value, "action") ? { action: decodeAction(value["action"], [...path, "action"]) } : {}),
    ...(has(value, "visibility") ? { visibility: decodeVisibility(value["visibility"], [...path, "visibility"]) } : {}),
  };
}

function decodeQuery(input: unknown, path: Path): AdminAppDocumentQuery {
  const value = object(input, path);
  exact(value, ["collectionId", "limit", "fields", "filter", "sort", "state"], path);
  return {
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    limit: integer(required(value, "limit", path), [...path, "limit"]),
    ...(has(value, "fields") ? { fields: stringList(value["fields"], [...path, "fields"]) } : {}),
    ...(has(value, "filter") ? { filter: decodeFilter(value["filter"], [...path, "filter"]) } : {}),
    ...(has(value, "sort") ? { sort: decodeSorts(value["sort"], [...path, "sort"]) } : {}),
    ...(has(value, "state") ? { state: choice(value["state"], ["active", "deleted"] as const, [...path, "state"]) } : {}),
  };
}

function optionalActions(value: UnknownRecord, key: string, path: Path): Record<string, readonly AdminAppActionReference[]> {
  if (!has(value, key)) return {};
  return {
    [key]: list(value[key], [...path, key]).map((item, index) => decodeAction(item, [...path, key, index])),
  };
}

function optionalText(value: UnknownRecord, key: string, path: Path): Record<string, string> {
  return has(value, key) ? { [key]: text(value[key], [...path, key]) } : {};
}

function object(input: unknown, path: Path): UnknownRecord {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_INPUT_TYPE", "Expected a JSON object.", path);
  }
  return input as UnknownRecord;
}

function list(input: unknown, path: Path): readonly unknown[] {
  if (!Array.isArray(input)) fail("INVALID_INPUT_TYPE", "Expected an array.", path);
  return input;
}

function stringList(input: unknown, path: Path): readonly string[] {
  return list(input, path).map((item, index) => text(item, [...path, index]));
}

function exact(value: UnknownRecord, keys: readonly string[], path: Path): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail("UNKNOWN_PROPERTY", `Unknown property '${key}'.`, [...path, key]);
  }
}

function required(value: UnknownRecord, key: string, path: Path): unknown {
  if (!has(value, key)) fail("MISSING_PROPERTY", `Missing required property '${key}'.`, [...path, key]);
  return value[key];
}

function has(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(input: unknown, path: Path): string {
  if (typeof input !== "string") fail("INVALID_INPUT_TYPE", "Expected a string.", path);
  return input;
}

function bool(input: unknown, path: Path): boolean {
  if (typeof input !== "boolean") fail("INVALID_INPUT_TYPE", "Expected a boolean.", path);
  return input;
}

function integer(input: unknown, path: Path): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input)) {
    fail("INVALID_INPUT_TYPE", "Expected a safe integer.", path);
  }
  return input;
}

function scalar(input: unknown, path: Path): AdminAppScalar {
  if (input === null || typeof input === "string" || typeof input === "boolean" ||
    (typeof input === "number" && Number.isFinite(input))) return input;
  fail("INVALID_INPUT_TYPE", "Expected a finite JSON scalar.", path);
}

function literal<const TValue extends string | number>(input: unknown, expected: TValue, path: Path): TValue {
  if (input !== expected) fail("INVALID_LITERAL", `Expected ${JSON.stringify(expected)}.`, path);
  return expected;
}

function choice<const TValue extends readonly (string | number)[]>(input: unknown, values: TValue, path: Path): TValue[number] {
  if (!values.includes(input as never)) fail("INVALID_LITERAL", `Expected one of: ${values.join(", ")}.`, path);
  return input as TValue[number];
}

function assertJsonCompatible(input: unknown, path: Path, active: Set<object>): void {
  if (input === null || typeof input === "string" || typeof input === "boolean") return;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) fail("INVALID_JSON_VALUE", "JSON numbers must be finite.", path);
    return;
  }
  if (typeof input !== "object") fail("INVALID_JSON_VALUE", `Values of type '${typeof input}' are not valid JSON.`, path);
  if (active.has(input)) fail("INVALID_JSON_VALUE", "Circular references are not valid JSON.", path);
  active.add(input);
  if (Array.isArray(input)) {
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(input, index)) fail("INVALID_JSON_VALUE", "Sparse arrays are not valid JSON.", [...path, index]);
      assertJsonCompatible(input[index], [...path, index], active);
    }
  } else {
    const prototype = Object.getPrototypeOf(input) as unknown;
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_JSON_VALUE", "Only plain objects are accepted.", path);
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") fail("INVALID_JSON_VALUE", "Symbol properties are not valid JSON.", path);
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        fail("INVALID_JSON_VALUE", "Accessors and non-enumerable properties are not accepted.", [...path, key]);
      }
      assertJsonCompatible((input as UnknownRecord)[key], [...path, key], active);
    }
  }
  active.delete(input);
}

function fail(code: string, message: string, path: Path): never {
  throw new AdminAppManifestDecodeError([{ code, message, path }]);
}
