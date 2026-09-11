import { fieldColumnName, quoteIdentifier } from "../identifiers.js";
import {
  type DocumentQueryFieldReference,
  type DocumentQueryFilter,
  type DocumentQueryScalar,
  type DocumentQuerySort,
} from "@xecms/application";
import { type CollectionDefinition, type FieldDefinition } from "@xecms/schema";

export function documentQueryFieldSql(
  reference: DocumentQueryFieldReference,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): string {
  if (reference.kind === "data") {
    return `p.${quoteIdentifier(fieldColumnName(fieldById.get(reference.fieldId)!.id))}`;
  }
  switch (reference.field) {
    case "id": return "p.id";
    case "createdAt": return "p.created_at";
    case "updatedAt": return "p.updated_at";
    case "version": return "p.aggregate_version";
  }
}

export function documentQuerySortAliasNames(
  collection: CollectionDefinition,
  count: number,
): readonly string[] {
  const reserved = new Set([
    ...collection.fields.map(({ name }) => name),
    "id",
    "aggregate_version",
    "created_at",
    "updated_at",
    "owner_subject_id",
    "current_draft_revision_id",
    "publication",
    "lifecycle",
    "deletion",
  ]);
  return Array.from({ length: count }, (_, index) => {
    let candidate = `__xecms_query_sort_${index}`;
    while (reserved.has(candidate)) candidate = `_${candidate}`;
    reserved.add(candidate);
    return candidate;
  });
}

export function documentQueryFilterSql(
  filter: DocumentQueryFilter,
  fieldById: ReadonlyMap<string, FieldDefinition>,
  parameters: unknown[],
): string {
  if (filter.type === "group") {
    const joiner = filter.operator === "and" ? " AND " : " OR ";
    return `(${filter.filters.map((child) =>
      documentQueryFilterSql(child, fieldById, parameters)).join(joiner)})`;
  }
  const column = documentQueryFieldSql(filter.field, fieldById);
  if (filter.operator === "isNull") return `${column} IS NULL`;
  if (filter.operator === "isNotNull") return `${column} IS NOT NULL`;
  if (filter.operator === "in") {
    const values = filter.value as readonly DocumentQueryScalar[];
    const nonNull = values.filter((value) => value !== null);
    const includesNull = nonNull.length !== values.length;
    if (nonNull.length === 0) return `${column} IS NULL`;
    const placeholder = pushQueryParameter(parameters, nonNull);
    const membership = `${column} = ANY(${placeholder})`;
    return includesNull ? `(${membership} OR ${column} IS NULL)` : membership;
  }
  const value = filter.value as DocumentQueryScalar;
  if (filter.operator === "eq" && value === null) return `${column} IS NULL`;
  if (filter.operator === "ne" && value === null) return `${column} IS NOT NULL`;
  const placeholder = pushQueryParameter(parameters, value);
  switch (filter.operator) {
    case "eq": return `${column} IS NOT DISTINCT FROM ${placeholder}`;
    case "ne": return `${column} IS DISTINCT FROM ${placeholder}`;
    case "lt": return `${column} < ${placeholder}`;
    case "lte": return `${column} <= ${placeholder}`;
    case "gt": return `${column} > ${placeholder}`;
    case "gte": return `${column} >= ${placeholder}`;
    case "contains": return `POSITION(${placeholder} IN ${column}) > 0`;
    case "startsWith": return `LEFT(${column}, char_length(${placeholder})) = ${placeholder}`;
  }
}

export function documentQueryCursorSql(
  expressions: readonly string[],
  sort: readonly DocumentQuerySort[],
  values: readonly DocumentQueryScalar[],
  parameters: unknown[],
): string {
  const placeholders = values.map((value) => pushQueryParameter(parameters, value));
  const branches = expressions.map((expression, index) => {
    const prefix = expressions.slice(0, index).map((prefixExpression, prefixIndex) =>
      `${prefixExpression} IS NOT DISTINCT FROM ${placeholders[prefixIndex]}`).join(" AND ");
    const value = values[index]!;
    if (value === null) return prefix === "" ? "FALSE" : `(${prefix} AND FALSE)`;
    const comparator = sort[index]!.direction === "asc" ? ">" : "<";
    const current = `(${expression} ${comparator} ${placeholders[index]} OR ${expression} IS NULL)`;
    return prefix === "" ? current : `(${prefix} AND ${current})`;
  });
  return `(${branches.join(" OR ")})`;
}

export function pushQueryParameter(parameters: unknown[], value: unknown): string {
  parameters.push(value);
  return `$${parameters.length}`;
}
