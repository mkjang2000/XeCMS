import { ApplicationError } from "@xecms/application";
import type {
  DocumentQueryFieldReferenceDto,
  DocumentQueryFilterDto,
  DocumentQueryOperatorDto,
  DocumentQueryRequest,
  DocumentQueryScalarDto,
  DocumentQuerySortDto,
} from "@xecms/contracts";

export function parseDocumentQueryRequest(input: unknown): DocumentQueryRequest {
  const body = exactObject(
    input,
    ["cursor", "limit", "state", "fields", "filter", "sort"],
    "Document query",
  );
  const cursor = optionalString(body["cursor"], "cursor");
  const limit = optionalInteger(body["limit"], "limit");
  const state = body["state"];
  if (state !== undefined && state !== "active" && state !== "deleted") {
    invalid("state must be 'active' or 'deleted'.");
  }
  const fields = body["fields"] === undefined
    ? undefined
    : stringArray(body["fields"], "fields");
  const filter = body["filter"] === undefined
    ? undefined
    : parseFilter(body["filter"], "filter");
  const sort = body["sort"] === undefined
    ? undefined
    : array(body["sort"], "sort").map((value, index) =>
      parseSort(value, `sort[${index}]`));
  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
    ...(state === undefined ? {} : { state }),
    ...(fields === undefined ? {} : { fields }),
    ...(filter === undefined ? {} : { filter }),
    ...(sort === undefined ? {} : { sort }),
  };
}

function parseFilter(value: unknown, label: string): DocumentQueryFilterDto {
  const candidate = object(value, label);
  if (candidate["type"] === "group") {
    const body = exactObject(candidate, ["type", "operator", "filters"], label);
    const operator = body["operator"];
    if (operator !== "and" && operator !== "or") {
      invalid(`${label}.operator must be 'and' or 'or'.`);
    }
    return {
      type: "group",
      operator,
      filters: array(body["filters"], `${label}.filters`).map((item, index) =>
        parseFilter(item, `${label}.filters[${index}]`)),
    };
  }
  const body = exactObject(candidate, ["type", "field", "operator", "value"], label);
  if (body["type"] !== "condition") {
    invalid(`${label}.type must be 'condition' or 'group'.`);
  }
  const operator = body["operator"];
  if (
    typeof operator !== "string" ||
    !["eq", "ne", "lt", "lte", "gt", "gte", "contains", "startsWith", "in", "isNull", "isNotNull"]
      .includes(operator)
  ) {
    invalid(`${label}.operator is not supported.`);
  }
  const conditionValue = body["value"] === undefined
    ? undefined
    : parseValue(body["value"], `${label}.value`);
  return {
    type: "condition",
    field: parseField(body["field"], `${label}.field`),
    operator: operator as DocumentQueryOperatorDto,
    ...(conditionValue === undefined ? {} : { value: conditionValue }),
  };
}

function parseSort(value: unknown, label: string): DocumentQuerySortDto {
  const body = exactObject(value, ["field", "direction"], label);
  const direction = body["direction"];
  if (direction !== "asc" && direction !== "desc") {
    invalid(`${label}.direction must be 'asc' or 'desc'.`);
  }
  return {
    field: parseField(body["field"], `${label}.field`),
    direction,
  };
}

function parseField(value: unknown, label: string): DocumentQueryFieldReferenceDto {
  const candidate = object(value, label);
  if (candidate["kind"] === "system") {
    const body = exactObject(candidate, ["kind", "field"], label);
    const field = body["field"];
    if (!["id", "createdAt", "updatedAt", "version"].includes(String(field))) {
      invalid(`${label}.field is not a supported system field.`);
    }
    return {
      kind: "system",
      field: field as "id" | "createdAt" | "updatedAt" | "version",
    };
  }
  const body = exactObject(candidate, ["kind", "fieldId"], label);
  if (body["kind"] !== "data") {
    invalid(`${label}.kind must be 'system' or 'data'.`);
  }
  return { kind: "data", fieldId: requiredString(body["fieldId"], `${label}.fieldId`) };
}

function parseValue(
  value: unknown,
  label: string,
): DocumentQueryScalarDto | readonly DocumentQueryScalarDto[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => scalar(item, `${label}[${index}]`));
  }
  return scalar(value, label);
}

function scalar(value: unknown, label: string): DocumentQueryScalarDto {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return value;
  invalid(`${label} must be a finite JSON scalar.`);
}

function exactObject(
  input: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  const body = object(input, label);
  const extras = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    invalid(`${label} contains unknown fields: ${extras.join(", ")}.`);
  }
  return body;
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    invalid(`${label} must be a JSON object.`);
  }
  return input as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  return array(value, label).map((item, index) =>
    requiredString(item, `${label}[${index}]`));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(`${label} must be a safe integer.`);
  }
  return value;
}

function invalid(message: string): never {
  throw new ApplicationError("DOCUMENT_QUERY_INVALID", 400, message);
}

