import type {
  DocumentQueryDataSource,
  ParameterizedFilterExpression,
} from "@xecms/admin-apps";
import type {
  DocumentQueryFilterDto,
  DocumentQueryRequest,
  DocumentQueryScalarDto,
} from "@xecms/contracts";

export type PreviewQueryParameterValue =
  | DocumentQueryScalarDto
  | readonly DocumentQueryScalarDto[];

/**
 * Client-side twin of `@xecms/application`'s `resolveComposedQuery`. The editor
 * Preview resolves the EDITING (unsaved) manifest's Data Source + current Page
 * State parameters into the content-query request, then calls the plain content
 * query API — the applied-manifest runtime route can't see unsaved changes, and
 * `apps/admin` may not import `@xecms/application` (M1 boundary). The masking and
 * permission boundaries are still enforced server-side by the content query API.
 */
export function resolvePreviewQuery(
  dataSource: DocumentQueryDataSource,
  parameters: Readonly<Record<string, PreviewQueryParameterValue>>,
  cursor?: string,
): DocumentQueryRequest {
  const declared = new Set((dataSource.parameters ?? []).map(({ id }) => id));
  const filter = dataSource.filter === undefined
    ? undefined
    : resolveFilter(dataSource.filter, parameters, declared);
  const sort = dataSource.sort?.map((item) => ({
    field: item.field,
    direction: item.direction,
  }));
  return {
    limit: dataSource.limit,
    fields: [...dataSource.fields],
    ...(filter === undefined ? {} : { filter }),
    ...(sort === undefined || sort.length === 0 ? {} : { sort }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

const DROP = Symbol("drop-condition");

function resolveFilter(
  filter: ParameterizedFilterExpression,
  parameters: Readonly<Record<string, PreviewQueryParameterValue>>,
  declared: ReadonlySet<string>,
): DocumentQueryFilterDto | undefined {
  if (filter.type === "group") {
    const children = filter.filters
      .map((child) => resolveFilter(child, parameters, declared))
      .filter((child): child is DocumentQueryFilterDto => child !== undefined);
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { type: "group", operator: filter.operator, filters: children };
  }
  if (filter.value === undefined) {
    return { type: "condition", field: filter.field, operator: filter.operator };
  }
  const resolved = resolveValue(filter.value, parameters, declared);
  if (resolved === DROP) return undefined;
  return { type: "condition", field: filter.field, operator: filter.operator, value: resolved };
}

function resolveValue(
  value: NonNullable<Extract<ParameterizedFilterExpression, { type: "condition" }>["value"]>,
  parameters: Readonly<Record<string, PreviewQueryParameterValue>>,
  declared: ReadonlySet<string>,
): DocumentQueryScalarDto | readonly DocumentQueryScalarDto[] | typeof DROP {
  if (value.type === "literal") return value.value as DocumentQueryScalarDto | readonly DocumentQueryScalarDto[];
  if (!declared.has(value.parameterId)) {
    throw new Error(`필터가 선언되지 않은 파라미터 '${value.parameterId}'를 참조합니다.`);
  }
  const provided = parameters[value.parameterId];
  // Absent or empty (unfilled variant) → drop this condition entirely.
  if (provided === undefined || provided === null || provided === "") return DROP;
  return provided;
}
