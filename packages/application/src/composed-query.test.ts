import { describe, expect, it } from "vitest";
import type { DocumentQueryDataSource } from "@xecms/admin-apps";

import { resolveComposedQuery } from "./composed-query.js";

function dataSource(overrides: Partial<DocumentQueryDataSource> = {}): DocumentQueryDataSource {
  return {
    id: "query_customers",
    type: "document-query",
    collectionId: "col_customers",
    trigger: "manual",
    fields: ["fld_customer_name", "fld_customer_email"],
    parameters: [{ id: "param_name", valueType: "string" }],
    filter: {
      type: "condition",
      field: { kind: "data", fieldId: "fld_customer_name" },
      operator: "contains",
      value: { type: "parameter", parameterId: "param_name" },
    },
    limit: 20,
    ...overrides,
  };
}

describe("resolveComposedQuery", () => {
  it("substitutes a bound parameter value into the filter", () => {
    const input = resolveComposedQuery({
      dataSource: dataSource(),
      parameters: { param_name: "Alice" },
    });
    expect(input).toMatchObject({
      limit: 20,
      fields: ["fld_customer_name", "fld_customer_email"],
      filter: {
        type: "condition",
        field: { kind: "data", fieldId: "fld_customer_name" },
        operator: "contains",
        value: "Alice",
      },
    });
  });

  it("passes through cursor and literal values", () => {
    const input = resolveComposedQuery({
      dataSource: dataSource({
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_customer_name" },
          operator: "eq",
          value: { type: "literal", value: "fixed" },
        },
      }),
      parameters: {},
      cursor: "abc",
    });
    expect(input.cursor).toBe("abc");
    expect(input.filter).toMatchObject({ value: "fixed" });
  });

  it("drops a condition whose parameter is absent or empty (inactive variant)", () => {
    // Absent → the whole (single-condition) filter drops out.
    expect(resolveComposedQuery({ dataSource: dataSource(), parameters: {} }).filter).toBeUndefined();
    // Empty string counts as unfilled too.
    expect(resolveComposedQuery({ dataSource: dataSource(), parameters: { param_name: "" } }).filter).toBeUndefined();
  });

  it("fails closed when the parameter is not declared on the Data Source", () => {
    expect(() => resolveComposedQuery({
      dataSource: dataSource({ parameters: [] }),
      parameters: { param_name: "Alice" },
    })).toThrow(expect.objectContaining({ code: "COMPOSED_QUERY_PARAMETER_INVALID" }));
  });

  it("keeps only the active variant's condition in an OR group", () => {
    // Two adaptive variants (name/age); only the name parameter is filled.
    const adaptive = dataSource({
      parameters: [
        { id: "param_name", valueType: "string" },
        { id: "param_age", valueType: "number" },
      ],
      filter: {
        type: "group",
        operator: "or",
        filters: [
          { type: "condition", field: { kind: "data", fieldId: "fld_customer_name" }, operator: "contains", value: { type: "parameter", parameterId: "param_name" } },
          { type: "condition", field: { kind: "data", fieldId: "fld_customer_age" }, operator: "eq", value: { type: "parameter", parameterId: "param_age" } },
        ],
      },
    });
    const input = resolveComposedQuery({ dataSource: adaptive, parameters: { param_name: "Bob", param_age: "" } });
    // Only the name condition survives; the age condition (empty) is dropped,
    // and a single-child group collapses to that condition.
    expect(input.filter).toMatchObject({ type: "condition", field: { fieldId: "fld_customer_name" }, value: "Bob" });
  });

  it("resolves nested group filters, keeping literal conditions", () => {
    const input = resolveComposedQuery({
      dataSource: dataSource({
        filter: {
          type: "group",
          operator: "and",
          filters: [
            { type: "condition", field: { kind: "data", fieldId: "fld_customer_name" }, operator: "contains", value: { type: "parameter", parameterId: "param_name" } },
            { type: "condition", field: { kind: "system", field: "id" }, operator: "isNotNull" },
          ],
        },
      }),
      parameters: { param_name: "Bob" },
    });
    expect(input.filter).toMatchObject({
      type: "group",
      filters: [{ value: "Bob" }, { operator: "isNotNull" }],
    });
  });

  it("passes an aggregate definition through unchanged (slG1)", () => {
    const input = resolveComposedQuery({
      dataSource: dataSource({
        aggregate: { groupBy: { kind: "data", fieldId: "fld_customer_name" }, measure: { op: "count" } },
      }),
      parameters: { param_name: "Alice" },
    });
    expect(input.aggregate).toEqual({
      groupBy: { kind: "data", fieldId: "fld_customer_name" },
      measure: { op: "count" },
    });
    // The parameterized filter is still resolved alongside the aggregate.
    expect(input.filter).toMatchObject({ value: "Alice" });
  });
});
