import type {
  DocumentQueryDataSource,
  ParameterizedFilterExpression,
} from "@xecms/admin-apps";

import { ApplicationError } from "./errors.js";
import type {
  DocumentQueryFilter,
  DocumentQueryInput,
  DocumentQueryScalar,
  DocumentQuerySort,
} from "./document-query.js";

export type ComposedQueryParameterValue =
  | DocumentQueryScalar
  | readonly DocumentQueryScalar[];

export interface ResolveComposedQueryInput {
  readonly dataSource: DocumentQueryDataSource;
  /** Page State values bound to the Data Source parameters (parameterId -> value). */
  readonly parameters: Readonly<Record<string, ComposedQueryParameterValue>>;
  readonly cursor?: string;
}

/**
 * Resolves a Composed Page `document-query` Data Source plus the current Page
 * State parameter values into the normalized {@link DocumentQueryInput} the
 * server engine executes. Parameter references are substituted with their bound
 * values; a missing parameter fails closed rather than silently widening the query.
 */
export function resolveComposedQuery(input: ResolveComposedQueryInput): DocumentQueryInput {
  const declared = new Set((input.dataSource.parameters ?? []).map(({ id }) => id));
  const filter = input.dataSource.filter === undefined
    ? undefined
    : resolveFilter(input.dataSource.filter, input.parameters, declared);
  const sort = input.dataSource.sort?.map((item): DocumentQuerySort => ({
    field: item.field,
    direction: item.direction,
  }));
  return {
    limit: input.dataSource.limit,
    fields: [...input.dataSource.fields],
    ...(filter === undefined ? {} : { filter }),
    ...(sort === undefined || sort.length === 0 ? {} : { sort }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

/**
 * Resolves a parameterized filter, substituting bound Page State values. A
 * condition bound to a parameter that is absent/empty is DROPPED rather than
 * failed — this is how an adaptive input's inactive variants stay out of the
 * query (only the active variant's parameter has a value). A filter referencing
 * a parameter the Data Source never declared still fails closed. Returns
 * `undefined` when the whole expression resolves to nothing.
 */
function resolveFilter(
  filter: ParameterizedFilterExpression,
  parameters: Readonly<Record<string, ComposedQueryParameterValue>>,
  declared: ReadonlySet<string>,
): DocumentQueryFilter | undefined {
  if (filter.type === "group") {
    const children = filter.filters
      .map((child) => resolveFilter(child, parameters, declared))
      .filter((child): child is DocumentQueryFilter => child !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { type: "group", operator: filter.operator, filters: children };
  }
  if (filter.value === undefined) {
    return { type: "condition", field: filter.field, operator: filter.operator };
  }
  const resolved = resolveValue(filter.value, parameters, declared);
  if (resolved === DROP) return undefined;
  return {
    type: "condition",
    field: filter.field,
    operator: filter.operator,
    value: resolved,
  };
}

const DROP = Symbol("drop-condition");

function resolveValue(
  value: NonNullable<Extract<ParameterizedFilterExpression, { type: "condition" }>["value"]>,
  parameters: Readonly<Record<string, ComposedQueryParameterValue>>,
  declared: ReadonlySet<string>,
): DocumentQueryScalar | readonly DocumentQueryScalar[] | typeof DROP {
  if (value.type === "literal") return value.value;
  if (!declared.has(value.parameterId)) {
    invalid(`Filter references undeclared parameter '${value.parameterId}'.`);
  }
  const provided = parameters[value.parameterId];
  // Absent or empty (unfilled variant) → drop this condition entirely.
  if (provided === undefined || provided === null || provided === "") return DROP;
  return provided;
}

function invalid(message: string): never {
  throw new ApplicationError("COMPOSED_QUERY_PARAMETER_INVALID", 422, message);
}
