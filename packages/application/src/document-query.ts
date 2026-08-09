import { createHash } from "node:crypto";
import type { CollectionDefinition, FieldDefinition } from "@xecms/schema";
import { ApplicationError } from "./errors.js";

export type DocumentQueryState = "active" | "deleted";
export type DocumentQuerySystemField = "id" | "createdAt" | "updatedAt" | "version";
export type DocumentQueryScalar = string | number | boolean | null;
export type DocumentQueryOperator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "startsWith"
  | "in"
  | "isNull"
  | "isNotNull";

export type DocumentQueryFieldReference =
  | { readonly kind: "system"; readonly field: DocumentQuerySystemField }
  | { readonly kind: "data"; readonly fieldId: string };

export type DocumentQueryFilter =
  | {
      readonly type: "condition";
      readonly field: DocumentQueryFieldReference;
      readonly operator: DocumentQueryOperator;
      readonly value?: DocumentQueryScalar | readonly DocumentQueryScalar[];
    }
  | {
      readonly type: "group";
      readonly operator: "and" | "or";
      readonly filters: readonly DocumentQueryFilter[];
    };

export interface DocumentQuerySort {
  readonly field: DocumentQueryFieldReference;
  readonly direction: "asc" | "desc";
}

export type DocumentQueryMeasure =
  | { readonly op: "count" }
  | { readonly op: "sum" | "avg"; readonly field: DocumentQueryFieldReference };

/**
 * A group-by aggregation (slG1). Rows are grouped by `groupBy` and reduced to a
 * single numeric `measure` per group. Only scalar stored/system fields may group;
 * sum/avg require a numeric field. Sensitive/masked Field exclusion is enforced at
 * the response boundary (the route), which knows the mask rules the engine does not.
 */
export interface DocumentQueryAggregate {
  readonly groupBy: DocumentQueryFieldReference;
  readonly measure: DocumentQueryMeasure;
}

export interface DocumentQueryInput {
  readonly cursor?: string;
  readonly limit?: number;
  readonly state?: DocumentQueryState;
  readonly fields?: readonly string[];
  readonly filter?: DocumentQueryFilter;
  readonly sort?: readonly DocumentQuerySort[];
  readonly aggregate?: DocumentQueryAggregate;
}

export interface NormalizedDocumentAggregate {
  readonly state: DocumentQueryState;
  readonly filter?: DocumentQueryFilter;
  readonly groupBy: DocumentQueryFieldReference;
  readonly measure: DocumentQueryMeasure;
  /** Cap on the number of groups returned (guards a runaway GROUP BY). */
  readonly limit: number;
}

/** One aggregated group: the group key value and its numeric measure. */
export interface DocumentAggregateGroup {
  readonly group: DocumentQueryScalar;
  readonly value: number;
}

const MAX_AGGREGATE_GROUPS = 200;

export interface NormalizedDocumentQuery {
  readonly limit: number;
  readonly state: DocumentQueryState;
  readonly fields?: readonly string[];
  readonly filter?: DocumentQueryFilter;
  readonly sort: readonly DocumentQuerySort[];
  readonly fingerprint: string;
  readonly cursorValues?: readonly DocumentQueryScalar[];
}

const DEFAULT_SORT: readonly DocumentQuerySort[] = Object.freeze([
  Object.freeze({
    field: Object.freeze({ kind: "system", field: "updatedAt" }),
    direction: "desc",
  }),
  Object.freeze({
    field: Object.freeze({ kind: "system", field: "id" }),
    direction: "asc",
  }),
]);
const MAX_FILTER_DEPTH = 4;
const MAX_FILTER_NODES = 24;
const MAX_IN_VALUES = 50;
const MAX_PROJECTED_FIELDS = 50;
const MAX_SORT_FIELDS = 3;
const MAX_CURSOR_LENGTH = 4096;
const MAX_STRING_VALUE_LENGTH = 2000;

export function normalizeDocumentQuery(
  collection: CollectionDefinition,
  input: DocumentQueryInput,
): NormalizedDocumentQuery {
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    queryInvalid("limit must be an integer between 1 and 100.");
  }
  const state = input.state ?? "active";
  if (state !== "active" && state !== "deleted") {
    queryInvalid("state must be 'active' or 'deleted'.");
  }
  const fieldById = new Map(collection.fields.map((field) => [String(field.id), field]));
  const fields = normalizeProjection(input.fields, fieldById);
  const filterCounter = { value: 0 };
  const filter = input.filter === undefined
    ? undefined
    : normalizeFilter(input.filter, fieldById, 1, filterCounter);
  const sort = normalizeSort(input.sort, fieldById);
  const fingerprint = documentQueryFingerprint({
    collectionId: String(collection.id),
    state,
    filter,
    sort,
  });
  if (input.cursor !== undefined && input.cursor.length > MAX_CURSOR_LENGTH) {
    queryCursorInvalid(`cursor cannot exceed ${MAX_CURSOR_LENGTH} characters.`);
  }
  const cursorValues = input.cursor === undefined
    ? undefined
    : decodeDocumentQueryCursor(input.cursor, fingerprint, sort, fieldById);
  return {
    limit,
    state,
    ...(fields === undefined ? {} : { fields }),
    ...(filter === undefined ? {} : { filter }),
    sort,
    fingerprint,
    ...(cursorValues === undefined ? {} : { cursorValues }),
  };
}

/**
 * Normalizes a group-by aggregation (slG1). Validates that `groupBy` is a scalar
 * stored/system field and that a sum/avg measure targets a numeric field; a
 * `count` measure needs no field. The filter is reused verbatim from the query
 * engine. Fails closed on anything unsupported.
 */
export function normalizeDocumentAggregate(
  collection: CollectionDefinition,
  input: DocumentQueryInput,
): NormalizedDocumentAggregate {
  if (input.aggregate === undefined) queryInvalid("aggregate is required.");
  const state = input.state ?? "active";
  if (state !== "active" && state !== "deleted") queryInvalid("state must be 'active' or 'deleted'.");
  const fieldById = new Map(collection.fields.map((field) => [String(field.id), field]));
  const filter = input.filter === undefined
    ? undefined
    : normalizeFilter(input.filter, fieldById, 1, { value: 0 });
  const groupBy = normalizeFieldReference(input.aggregate.groupBy, fieldById, "sort");
  assertFieldGroupable(groupBy, fieldById);
  const measure = normalizeMeasure(input.aggregate.measure, fieldById);
  return {
    state,
    ...(filter === undefined ? {} : { filter }),
    groupBy,
    measure,
    limit: MAX_AGGREGATE_GROUPS,
  };
}

function assertFieldGroupable(
  reference: DocumentQueryFieldReference,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): void {
  if (reference.kind === "system") return; // id/createdAt/updatedAt/version all group fine.
  const field = fieldById.get(reference.fieldId)!;
  if (!isScalarStoredField(field)) queryFieldUnsupported(reference.fieldId, field.type, "group by");
}

function normalizeMeasure(
  input: DocumentQueryMeasure,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): DocumentQueryMeasure {
  if (!input || typeof input !== "object") queryInvalid("aggregate measure must be an object.");
  if (input.op === "count") return Object.freeze({ op: "count" });
  if (input.op !== "sum" && input.op !== "avg") queryInvalid("aggregate measure op must be 'count', 'sum', or 'avg'.");
  const field = normalizeFieldReference(input.field, fieldById, "sort");
  // sum/avg only make sense on a numeric column.
  const numeric = field.kind === "system"
    ? systemFieldValueType(field.field) === "number"
    : fieldValueType(fieldById.get(field.fieldId)!) === "number";
  if (!numeric) {
    const label = field.kind === "system" ? field.field : field.fieldId;
    queryInvalid(`aggregate '${input.op}' requires a numeric field, but '${label}' is not numeric.`);
  }
  return Object.freeze({ op: input.op, field });
}

export function encodeDocumentQueryCursor(
  fingerprint: string,
  values: readonly DocumentQueryScalar[],
): string {
  const payload = JSON.stringify({ version: 1, fingerprint, values });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function canonicalDocumentQueryScalar(value: unknown): DocumentQueryScalar {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError("Document query cursor values must be finite JSON scalar values.");
}

function normalizeProjection(
  input: readonly string[] | undefined,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): readonly string[] | undefined {
  if (input === undefined) return undefined;
  if (input.length > MAX_PROJECTED_FIELDS) {
    queryInvalid(`fields cannot contain more than ${MAX_PROJECTED_FIELDS} entries.`);
  }
  const seen = new Set<string>();
  const fields = input.map((fieldId) => {
    if (typeof fieldId !== "string" || fieldId.trim() === "") {
      queryInvalid("fields must contain non-empty Field IDs.");
    }
    if (!fieldById.has(fieldId)) queryFieldUnknown(fieldId);
    if (seen.has(fieldId)) queryInvalid(`fields contains duplicate Field ID '${fieldId}'.`);
    seen.add(fieldId);
    return fieldId;
  });
  return Object.freeze(fields);
}

function normalizeSort(
  input: readonly DocumentQuerySort[] | undefined,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): readonly DocumentQuerySort[] {
  if (input !== undefined && input.length > MAX_SORT_FIELDS) {
    queryInvalid(`sort cannot contain more than ${MAX_SORT_FIELDS} entries.`);
  }
  const source = input === undefined || input.length === 0 ? DEFAULT_SORT : input;
  const seen = new Set<string>();
  const sort = source.map((item) => {
    if (item.direction !== "asc" && item.direction !== "desc") {
      queryInvalid("sort direction must be 'asc' or 'desc'.");
    }
    const field = normalizeFieldReference(item.field, fieldById, "sort");
    assertFieldSupportsSort(field, fieldById);
    const key = fieldKey(field);
    if (seen.has(key)) queryInvalid(`sort contains duplicate field '${key}'.`);
    seen.add(key);
    return Object.freeze({ field, direction: item.direction });
  });
  if (!seen.has("system:id")) {
    sort.push(Object.freeze({
      field: Object.freeze({ kind: "system", field: "id" }),
      direction: "asc",
    }));
  }
  return Object.freeze(sort);
}

function normalizeFilter(
  input: DocumentQueryFilter,
  fieldById: ReadonlyMap<string, FieldDefinition>,
  depth: number,
  counter: { value: number },
): DocumentQueryFilter {
  counter.value += 1;
  if (counter.value > MAX_FILTER_NODES) {
    queryInvalid(`filter cannot contain more than ${MAX_FILTER_NODES} nodes.`);
  }
  if (depth > MAX_FILTER_DEPTH) {
    queryInvalid(`filter cannot be nested deeper than ${MAX_FILTER_DEPTH} levels.`);
  }
  if (input.type === "group") {
    if (input.operator !== "and" && input.operator !== "or") {
      queryInvalid("filter group operator must be 'and' or 'or'.");
    }
    if (!Array.isArray(input.filters) || input.filters.length < 1) {
      queryInvalid("filter groups must contain at least one child.");
    }
    return Object.freeze({
      type: "group",
      operator: input.operator,
      filters: Object.freeze(input.filters.map((filter) =>
        normalizeFilter(filter, fieldById, depth + 1, counter))),
    });
  }
  if (input.type !== "condition") queryInvalid("filter type must be 'condition' or 'group'.");
  const field = normalizeFieldReference(input.field, fieldById, "filter");
  const definition = field.kind === "data" ? fieldById.get(field.fieldId)! : undefined;
  assertOperatorSupported(field, definition, input.operator);
  const value = normalizeConditionValue(input.operator, input.value, field, definition);
  return Object.freeze({
    type: "condition",
    field,
    operator: input.operator,
    ...(value === undefined ? {} : { value }),
  });
}

function normalizeFieldReference(
  input: DocumentQueryFieldReference,
  fieldById: ReadonlyMap<string, FieldDefinition>,
  usage: "filter" | "sort",
): DocumentQueryFieldReference {
  if (!input || typeof input !== "object") queryInvalid(`${usage} field must be an object.`);
  if (input.kind === "system") {
    if (!["id", "createdAt", "updatedAt", "version"].includes(input.field)) {
      queryInvalid(`Unknown system field '${String(input.field)}'.`);
    }
    return Object.freeze({ kind: "system", field: input.field });
  }
  if (input.kind === "data") {
    if (typeof input.fieldId !== "string" || input.fieldId.trim() === "") {
      queryInvalid(`${usage} data fieldId must be a non-empty string.`);
    }
    if (!fieldById.has(input.fieldId)) queryFieldUnknown(input.fieldId);
    return Object.freeze({ kind: "data", fieldId: input.fieldId });
  }
  queryInvalid(`${usage} field kind must be 'system' or 'data'.`);
}

function assertFieldSupportsSort(
  reference: DocumentQueryFieldReference,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): void {
  if (reference.kind === "system") return;
  const field = fieldById.get(reference.fieldId)!;
  if (!isScalarStoredField(field)) queryFieldUnsupported(reference.fieldId, field.type, "sort");
}

function assertOperatorSupported(
  reference: DocumentQueryFieldReference,
  field: FieldDefinition | undefined,
  operator: DocumentQueryOperator,
): void {
  const category = reference.kind === "system"
    ? systemFieldCategory(reference.field)
    : fieldCategory(field!);
  const common = new Set<DocumentQueryOperator>(["eq", "ne", "in", "isNull", "isNotNull"]);
  if (common.has(operator)) return;
  if (category === "ordered" && ["lt", "lte", "gt", "gte"].includes(operator)) return;
  if (category === "text" && ["contains", "startsWith"].includes(operator)) return;
  if (reference.kind === "data") {
    queryFieldUnsupported(reference.fieldId, field!.type, `operator '${operator}'`);
  }
  queryInvalid(`Operator '${operator}' is not supported for system field '${reference.field}'.`);
}

function normalizeConditionValue(
  operator: DocumentQueryOperator,
  input: DocumentQueryScalar | readonly DocumentQueryScalar[] | undefined,
  reference: DocumentQueryFieldReference,
  field: FieldDefinition | undefined,
): DocumentQueryScalar | readonly DocumentQueryScalar[] | undefined {
  if (operator === "isNull" || operator === "isNotNull") {
    if (input !== undefined) queryInvalid(`Operator '${operator}' does not accept a value.`);
    return undefined;
  }
  if (operator === "in") {
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_IN_VALUES) {
      queryInvalid(`Operator 'in' requires between 1 and ${MAX_IN_VALUES} values.`);
    }
    return Object.freeze(input.map((value) => normalizeScalar(value, reference, field)));
  }
  if (Array.isArray(input) || input === undefined) {
    queryInvalid(`Operator '${operator}' requires one scalar value.`);
  }
  if ((operator === "contains" || operator === "startsWith") && typeof input !== "string") {
    queryInvalid(`Operator '${operator}' requires a string value.`);
  }
  if (input === null && operator !== "eq" && operator !== "ne") {
    queryInvalid(`Operator '${operator}' does not accept null; use isNull or isNotNull.`);
  }
  return normalizeScalar(input, reference, field);
}

function normalizeScalar(
  input: unknown,
  reference: DocumentQueryFieldReference,
  field: FieldDefinition | undefined,
): DocumentQueryScalar {
  if (input === null) return null;
  const category = reference.kind === "system"
    ? systemFieldValueType(reference.field)
    : fieldValueType(field!);
  if (category === "string" && typeof input === "string") {
    if (input.length > MAX_STRING_VALUE_LENGTH) {
      queryInvalid(`Query string values cannot exceed ${MAX_STRING_VALUE_LENGTH} characters.`);
    }
    assertTemporalString(input, reference, field);
    return input;
  }
  if (category === "number" && typeof input === "number" && Number.isFinite(input)) {
    if (
      reference.kind === "system" &&
      reference.field === "version" &&
      (!Number.isSafeInteger(input) || input < 1)
    ) {
      queryInvalid("Query values for 'system:version' must be positive safe integers.");
    }
    return input;
  }
  if (category === "boolean" && typeof input === "boolean") return input;
  queryInvalid(`Query value for '${fieldKey(reference)}' must be ${category} or null.`);
}

function assertTemporalString(
  input: string,
  reference: DocumentQueryFieldReference,
  field: FieldDefinition | undefined,
): void {
  const type = reference.kind === "system"
    ? (reference.field === "createdAt" || reference.field === "updatedAt" ? "datetime" : undefined)
    : field?.type;
  if (type === "date") {
    const timestamp = Date.parse(`${input}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== input
    ) {
      queryInvalid(`Query value for '${fieldKey(reference)}' must be an ISO date.`);
    }
  }
  if (type === "datetime" && !Number.isFinite(Date.parse(input))) {
    queryInvalid(`Query value for '${fieldKey(reference)}' must be an ISO datetime.`);
  }
}

function decodeDocumentQueryCursor(
  cursor: string,
  fingerprint: string,
  sort: readonly DocumentQuerySort[],
  fieldById: ReadonlyMap<string, FieldDefinition>,
): readonly DocumentQueryScalar[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    queryCursorInvalid("cursor is not valid base64url JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    queryCursorInvalid("cursor payload must be an object.");
  }
  const payload = parsed as Record<string, unknown>;
  if (payload["version"] !== 1 || payload["fingerprint"] !== fingerprint) {
    queryCursorInvalid("cursor does not belong to this collection, filter, state, or sort.");
  }
  if (!Array.isArray(payload["values"]) || payload["values"].length !== sort.length) {
    queryCursorInvalid("cursor sort value count is invalid.");
  }
  return Object.freeze(payload["values"].map((value, index) => {
    const item = sort[index]!;
    if (value === null) return null;
    const field = item.field.kind === "data" ? fieldById.get(item.field.fieldId)! : undefined;
    return normalizeScalar(value, item.field, field);
  }));
}

function documentQueryFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fieldKey(reference: DocumentQueryFieldReference): string {
  return reference.kind === "system" ? `system:${reference.field}` : `data:${reference.fieldId}`;
}

function systemFieldCategory(field: DocumentQuerySystemField): "text" | "ordered" {
  return field === "id" ? "text" : "ordered";
}

function fieldCategory(field: FieldDefinition): "text" | "ordered" | "boolean" {
  if (!isScalarStoredField(field)) queryFieldUnsupported(String(field.id), field.type, "filter");
  if (["text", "textarea", "select", "enum", "relation", "upload"].includes(field.type)) return "text";
  if (field.type === "boolean") return "boolean";
  return "ordered";
}

function systemFieldValueType(field: DocumentQuerySystemField): "string" | "number" {
  return field === "version" ? "number" : "string";
}

function fieldValueType(field: FieldDefinition): "string" | "number" | "boolean" {
  if (!isScalarStoredField(field)) queryFieldUnsupported(String(field.id), field.type, "value");
  if (field.type === "number") return "number";
  if (field.type === "boolean") return "boolean";
  return "string";
}

function isScalarStoredField(field: FieldDefinition): boolean {
  if (["text", "textarea", "number", "boolean", "date", "datetime"].includes(field.type)) return true;
  if ((field.type === "select" || field.type === "enum") && field.multiple !== true) return true;
  if (field.type === "relation" && field.cardinality === "one") return true;
  return field.type === "upload" && field.multiple !== true;
}

function queryInvalid(message: string): never {
  throw new ApplicationError("DOCUMENT_QUERY_INVALID", 422, message);
}

function queryCursorInvalid(message: string): never {
  throw new ApplicationError("DOCUMENT_QUERY_CURSOR_INVALID", 400, message);
}

function queryFieldUnknown(fieldId: string): never {
  throw new ApplicationError(
    "DOCUMENT_QUERY_FIELD_UNKNOWN",
    422,
    `Document query references unknown Field '${fieldId}'.`,
  );
}

function queryFieldUnsupported(fieldId: string, type: string, operation: string): never {
  throw new ApplicationError(
    "DOCUMENT_QUERY_FIELD_UNSUPPORTED",
    422,
    `Field '${fieldId}' of type '${type}' does not support document query ${operation}.`,
  );
}
