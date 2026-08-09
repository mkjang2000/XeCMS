import {
  bool,
  choice,
  decodeAudience,
  decodeNavigation,
  decodePage,
  exact,
  fail,
  has,
  integer,
  list,
  literal,
  object,
  required,
  scalar,
  stringList,
  text,
  assertJsonCompatible,
  type Path,
  type UnknownRecord,
} from "../decode.js";
import { canonicalManifestValue } from "../normalize.js";
import type { AdminAppScalar } from "../types.js";
import { assertValidAdminAppManifestV2 } from "./validate.js";
import type {
  AdminAppManifestV2,
  AdminPageDefinitionV2,
  AppPresentationDefinition,
  ComposedAggregateDefinition,
  ComposedAggregateMeasure,
  ComponentDefinition,
  ComposedEffectDefinition,
  ComposedFieldReference,
  ComposedFilterOperator,
  ComposedPageDefinition,
  ComposedPageEventBinding,
  ComposedSortDefinition,
  ConnectionDefinition,
  DataSourceDefinition,
  DataSourceParameterDefinition,
  GridPlacement,
  PageStateDefinition,
  PageStateValueType,
  ParameterizedFilterExpression,
  ParameterizedFilterValue,
  PortReference,
  RuleCondition,
} from "./types.js";

const STATE_VALUE_TYPES = [
  "string", "number", "boolean", "date", "datetime", "string[]", "document-id",
] as const;
const FILTER_OPERATORS = [
  "eq", "ne", "lt", "lte", "gt", "gte", "contains", "startsWith", "in", "isNull", "isNotNull",
] as const;
const EVENT_NAMES = ["onLoad", "onClick", "onChange", "onRowSelect", "onSubmit", "onScan"] as const;
const EFFECT_KINDS = [
  "state.set", "state.reset", "data-source.execute", "data-source.reset", "await-query",
  "form.setField", "action.updateFields", "navigate", "action.execute",
] as const;
const STATE_CONDITION_OPS = ["eq", "ne", "empty", "notEmpty", "gt", "lt"] as const;
const QUERY_CONDITION_OPS = ["hasRows", "noRows", "countGt"] as const;
const CONDITION_TYPES = ["state", "field", "queryResult", "and", "or"] as const;
const MAX_CONDITION_DEPTH = 4;

export function decodeAdminAppManifestV2(input: unknown): AdminAppManifestV2 {
  assertJsonCompatible(input, [], new Set());
  const manifest = decodeManifestV2(input, []);
  assertValidAdminAppManifestV2(manifest);
  return canonicalManifestValue(manifest);
}

function decodeManifestV2(input: unknown, path: Path): AdminAppManifestV2 {
  const value = object(input, path);
  exact(value, [
    "format", "formatVersion", "id", "name", "key", "description", "icon",
    "audience", "presentation", "navigation", "pages", "startPageId",
  ], path);
  return {
    format: literal(required(value, "format", path), "xecms.admin-app", [...path, "format"]),
    formatVersion: literal(required(value, "formatVersion", path), 2, [...path, "formatVersion"]),
    id: text(required(value, "id", path), [...path, "id"]),
    name: text(required(value, "name", path), [...path, "name"]),
    key: text(required(value, "key", path), [...path, "key"]),
    ...(has(value, "description") ? { description: text(value["description"], [...path, "description"]) } : {}),
    ...(has(value, "icon") ? { icon: text(value["icon"], [...path, "icon"]) } : {}),
    audience: decodeAudience(required(value, "audience", path), [...path, "audience"]),
    presentation: decodePresentation(required(value, "presentation", path), [...path, "presentation"]),
    navigation: list(required(value, "navigation", path), [...path, "navigation"]).map(
      (item, index) => decodeNavigation(item, [...path, "navigation", index]),
    ),
    pages: list(required(value, "pages", path), [...path, "pages"]).map(
      (item, index) => decodePageV2(item, [...path, "pages", index]),
    ),
    startPageId: text(required(value, "startPageId", path), [...path, "startPageId"]),
  };
}

function decodePresentation(input: unknown, path: Path): AppPresentationDefinition {
  const value = object(input, path);
  exact(value, ["layoutProfile", "menuPosition", "canvasAlignment"], path);
  return {
    layoutProfile: choice(required(value, "layoutProfile", path), ["16:9", "4:3"] as const, [...path, "layoutProfile"]),
    menuPosition: choice(required(value, "menuPosition", path), ["left", "right"] as const, [...path, "menuPosition"]),
    canvasAlignment: choice(
      required(value, "canvasAlignment", path),
      ["top-center", "top-left"] as const,
      [...path, "canvasAlignment"],
    ),
  };
}

function decodePageV2(input: unknown, path: Path): AdminPageDefinitionV2 {
  const value = object(input, path);
  if (value["type"] === "composed-page") return decodeComposedPage(value, path);
  // Generated Page types are reused verbatim from V1 (§4.1 mixed pages).
  return decodePage(input, path);
}

function decodeComposedPage(value: UnknownRecord, path: Path): ComposedPageDefinition {
  exact(value, [
    "id", "type", "screenNo", "title", "menuLabel", "layout",
    "state", "dataSources", "components", "connections", "events",
  ], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    type: literal(required(value, "type", path), "composed-page", [...path, "type"]),
    screenNo: text(required(value, "screenNo", path), [...path, "screenNo"]),
    title: text(required(value, "title", path), [...path, "title"]),
    menuLabel: text(required(value, "menuLabel", path), [...path, "menuLabel"]),
    layout: decodeLayout(required(value, "layout", path), [...path, "layout"]),
    state: list(required(value, "state", path), [...path, "state"]).map(
      (item, index) => decodeState(item, [...path, "state", index]),
    ),
    dataSources: list(required(value, "dataSources", path), [...path, "dataSources"]).map(
      (item, index) => decodeDataSource(item, [...path, "dataSources", index]),
    ),
    components: list(required(value, "components", path), [...path, "components"]).map(
      (item, index) => decodeComponent(item, [...path, "components", index]),
    ),
    connections: list(required(value, "connections", path), [...path, "connections"]).map(
      (item, index) => decodeConnection(item, [...path, "connections", index]),
    ),
    ...(has(value, "events") ? {
      events: list(value["events"], [...path, "events"]).map(
        (item, index) => decodeEvent(item, [...path, "events", index]),
      ),
    } : {}),
  };
}

function decodeLayout(input: unknown, path: Path): ComposedPageDefinition["layout"] {
  const value = object(input, path);
  exact(value, ["columns", "rowHeight"], path);
  return {
    columns: literal(required(value, "columns", path), 48, [...path, "columns"]),
    rowHeight: literal(required(value, "rowHeight", path), 8, [...path, "rowHeight"]),
  };
}

function decodeState(input: unknown, path: Path): PageStateDefinition {
  const value = object(input, path);
  exact(value, ["id", "valueType", "initialValue"], path);
  const valueType = choice(
    required(value, "valueType", path),
    STATE_VALUE_TYPES,
    [...path, "valueType"],
  ) as PageStateValueType;
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    valueType,
    initialValue: decodeStateInitialValue(value["initialValue"], valueType, [...path, "initialValue"]),
  };
}

function decodeStateInitialValue(
  input: unknown,
  valueType: PageStateValueType,
  path: Path,
): AdminAppScalar | readonly string[] {
  if (valueType === "string[]") return stringList(input, path);
  return scalar(input, path);
}

function decodeDataSource(input: unknown, path: Path): DataSourceDefinition {
  const value = object(input, path);
  if (value["type"] !== "document-query") {
    fail("UNKNOWN_DATA_SOURCE_TYPE", `Unknown data source type '${String(value["type"])}'.`, [...path, "type"]);
  }
  exact(value, [
    "id", "type", "collectionId", "trigger", "debounceMs", "fields", "parameters", "filter", "sort", "limit", "aggregate",
  ], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    type: "document-query",
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    trigger: choice(required(value, "trigger", path), ["on-load", "manual", "on-change"] as const, [...path, "trigger"]),
    ...(has(value, "debounceMs") ? { debounceMs: integer(value["debounceMs"], [...path, "debounceMs"]) } : {}),
    fields: stringList(required(value, "fields", path), [...path, "fields"]),
    ...(has(value, "parameters") ? {
      parameters: list(value["parameters"], [...path, "parameters"]).map(
        (item, index) => decodeParameter(item, [...path, "parameters", index]),
      ),
    } : {}),
    ...(has(value, "filter") ? { filter: decodeFilter(value["filter"], [...path, "filter"]) } : {}),
    ...(has(value, "sort") ? { sort: decodeSorts(value["sort"], [...path, "sort"]) } : {}),
    limit: integer(required(value, "limit", path), [...path, "limit"]),
    ...(has(value, "aggregate") ? { aggregate: decodeAggregate(value["aggregate"], [...path, "aggregate"]) } : {}),
  };
}

function decodeAggregate(input: unknown, path: Path): ComposedAggregateDefinition {
  const value = object(input, path);
  exact(value, ["groupBy", "measure"], path);
  return {
    groupBy: decodeFieldReference(required(value, "groupBy", path), [...path, "groupBy"]),
    measure: decodeMeasure(required(value, "measure", path), [...path, "measure"]),
  };
}

function decodeMeasure(input: unknown, path: Path): ComposedAggregateMeasure {
  const value = object(input, path);
  const op = choice(required(value, "op", path), ["count", "sum", "avg"] as const, [...path, "op"]);
  if (op === "count") {
    exact(value, ["op"], path);
    return { op: "count" };
  }
  exact(value, ["op", "field"], path);
  return { op, field: decodeFieldReference(required(value, "field", path), [...path, "field"]) };
}

function decodeParameter(input: unknown, path: Path): DataSourceParameterDefinition {
  const value = object(input, path);
  exact(value, ["id", "valueType"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    valueType: choice(required(value, "valueType", path), STATE_VALUE_TYPES, [...path, "valueType"]) as PageStateValueType,
  };
}

function decodeFilter(input: unknown, path: Path): ParameterizedFilterExpression {
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

function decodeFilterValue(input: unknown, path: Path): ParameterizedFilterValue {
  const value = object(input, path);
  if (value["type"] === "parameter") {
    exact(value, ["type", "parameterId"], path);
    return { type: "parameter", parameterId: text(required(value, "parameterId", path), [...path, "parameterId"]) };
  }
  if (value["type"] === "literal") {
    exact(value, ["type", "value"], path);
    const raw = required(value, "value", path);
    return {
      type: "literal",
      value: Array.isArray(raw)
        ? raw.map((item, index) => scalar(item, [...path, "value", index]))
        : scalar(raw, [...path, "value"]),
    };
  }
  fail("INVALID_LITERAL", "filter value.type must be 'literal' or 'parameter'.", [...path, "type"]);
}

function decodeFieldReference(input: unknown, path: Path): ComposedFieldReference {
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

function decodeFilterOperator(input: unknown, path: Path): ComposedFilterOperator {
  return choice(input, FILTER_OPERATORS, path);
}

function decodeSorts(input: unknown, path: Path): readonly ComposedSortDefinition[] {
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

function decodeComponent(input: unknown, path: Path): ComponentDefinition {
  const value = object(input, path);
  exact(value, ["id", "kind", "placement", "props", "bindings", "events"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    kind: text(required(value, "kind", path), [...path, "kind"]),
    placement: decodePlacement(required(value, "placement", path), [...path, "placement"]),
    props: object(required(value, "props", path), [...path, "props"]),
    ...(has(value, "bindings") ? { bindings: object(value["bindings"], [...path, "bindings"]) } : {}),
    ...(has(value, "events") ? {
      events: list(value["events"], [...path, "events"]).map(
        (item, index) => decodeEvent(item, [...path, "events", index]),
      ),
    } : {}),
  };
}

function decodePlacement(input: unknown, path: Path): GridPlacement {
  const value = object(input, path);
  exact(value, ["x", "y", "width", "height"], path);
  return {
    x: integer(required(value, "x", path), [...path, "x"]),
    y: integer(required(value, "y", path), [...path, "y"]),
    width: integer(required(value, "width", path), [...path, "width"]),
    height: integer(required(value, "height", path), [...path, "height"]),
  };
}

function decodeConnection(input: unknown, path: Path): ConnectionDefinition {
  const value = object(input, path);
  exact(value, ["id", "from", "to"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    from: decodePort(required(value, "from", path), [...path, "from"]),
    to: decodePort(required(value, "to", path), [...path, "to"]),
  };
}

function decodePort(input: unknown, path: Path): PortReference {
  const value = object(input, path);
  exact(value, ["nodeType", "nodeId", "portId"], path);
  return {
    nodeType: choice(required(value, "nodeType", path), ["component", "state", "data-source"] as const, [...path, "nodeType"]),
    nodeId: text(required(value, "nodeId", path), [...path, "nodeId"]),
    portId: text(required(value, "portId", path), [...path, "portId"]),
  };
}

function decodeEvent(input: unknown, path: Path): ComposedPageEventBinding {
  const value = object(input, path);
  exact(value, ["id", "event", "effects"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    event: choice(required(value, "event", path), EVENT_NAMES, [...path, "event"]),
    effects: list(required(value, "effects", path), [...path, "effects"]).map(
      (item, index) => decodeEffect(item, [...path, "effects", index]),
    ),
  };
}

function decodeEffect(input: unknown, path: Path): ComposedEffectDefinition {
  const value = object(input, path);
  exact(value, ["id", "kind", "args", "when"], path);
  return {
    id: text(required(value, "id", path), [...path, "id"]),
    kind: choice(required(value, "kind", path), EFFECT_KINDS, [...path, "kind"]),
    ...(has(value, "args") ? { args: object(value["args"], [...path, "args"]) } : {}),
    ...(has(value, "when") ? { when: decodeRuleCondition(value["when"], [...path, "when"], 0) } : {}),
  };
}

/** Decodes a declarative effect guard (CPB-WF). Bounded depth; no arbitrary code. */
function decodeRuleCondition(input: unknown, path: Path, depth: number): RuleCondition {
  if (depth > MAX_CONDITION_DEPTH) fail("CONDITION_TOO_DEEP", `조건 중첩이 너무 깊습니다(최대 ${MAX_CONDITION_DEPTH}단계).`, path);
  const value = object(input, path);
  const type = choice(required(value, "type", path), CONDITION_TYPES, [...path, "type"]);
  if (type === "state") {
    exact(value, ["type", "stateId", "op", "value"], path);
    const op = choice(required(value, "op", path), STATE_CONDITION_OPS, [...path, "op"]);
    return {
      type: "state",
      stateId: text(required(value, "stateId", path), [...path, "stateId"]),
      op,
      ...(has(value, "value") ? { value: scalar(value["value"], [...path, "value"]) } : {}),
    };
  }
  if (type === "field") {
    exact(value, ["type", "fieldId", "op", "value"], path);
    const op = choice(required(value, "op", path), STATE_CONDITION_OPS, [...path, "op"]);
    return {
      type: "field",
      fieldId: text(required(value, "fieldId", path), [...path, "fieldId"]),
      op,
      ...(has(value, "value") ? { value: scalar(value["value"], [...path, "value"]) } : {}),
    };
  }
  if (type === "queryResult") {
    exact(value, ["type", "source", "op", "value"], path);
    return {
      type: "queryResult",
      source: literal(required(value, "source", path), "lastQuery", [...path, "source"]),
      op: choice(required(value, "op", path), QUERY_CONDITION_OPS, [...path, "op"]),
      ...(has(value, "value") ? { value: integer(value["value"], [...path, "value"]) } : {}),
    };
  }
  // "and" / "or"
  exact(value, ["type", "conditions"], path);
  return {
    type,
    conditions: list(required(value, "conditions", path), [...path, "conditions"]).map(
      (item, index) => decodeRuleCondition(item, [...path, "conditions", index], depth + 1),
    ),
  };
}
