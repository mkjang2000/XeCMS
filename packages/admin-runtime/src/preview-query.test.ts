import { describe, expect, it } from "vitest";
import type { DocumentQueryDataSource } from "@xecms/admin-apps";

import { resolvePreviewQuery } from "./preview-query.js";

function dataSource(overrides: Partial<DocumentQueryDataSource> = {}): DocumentQueryDataSource {
  return {
    id: "query_members",
    type: "document-query",
    collectionId: "col_members",
    trigger: "manual",
    fields: ["fld_member_name", "fld_member_code"],
    parameters: [{ id: "param_name", valueType: "string" }],
    filter: {
      type: "condition",
      field: { kind: "data", fieldId: "fld_member_name" },
      operator: "contains",
      value: { type: "parameter", parameterId: "param_name" },
    },
    limit: 20,
    ...overrides,
  };
}

// Mirrors @xecms/application's resolveComposedQuery — the Preview resolves the
// editing manifest client-side, so the two must stay behaviourally identical.
describe("resolvePreviewQuery", () => {
  it("substitutes a bound parameter into the content-query filter", () => {
    const request = resolvePreviewQuery(dataSource(), { param_name: "Alice" });
    expect(request).toMatchObject({
      limit: 20,
      fields: ["fld_member_name", "fld_member_code"],
      filter: {
        type: "condition",
        field: { kind: "data", fieldId: "fld_member_name" },
        operator: "contains",
        value: "Alice",
      },
    });
  });

  it("passes cursor through and keeps literal values", () => {
    const request = resolvePreviewQuery(
      dataSource({
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_member_name" },
          operator: "eq",
          value: { type: "literal", value: "fixed" },
        },
      }),
      {},
      "cursor-1",
    );
    expect(request.cursor).toBe("cursor-1");
    expect(request.filter).toMatchObject({ value: "fixed" });
  });

  it("drops a condition whose parameter is absent or empty", () => {
    expect(resolvePreviewQuery(dataSource(), {}).filter).toBeUndefined();
    expect(resolvePreviewQuery(dataSource(), { param_name: "" }).filter).toBeUndefined();
  });

  it("fails closed when the filter references an undeclared parameter", () => {
    expect(() => resolvePreviewQuery(dataSource({ parameters: [] }), { param_name: "Alice" }))
      .toThrow(/param_name/);
  });

  it("collapses a group to the single surviving (active variant) condition", () => {
    const adaptive = dataSource({
      parameters: [
        { id: "param_name", valueType: "string" },
        { id: "param_age", valueType: "number" },
      ],
      filter: {
        type: "group",
        operator: "or",
        filters: [
          { type: "condition", field: { kind: "data", fieldId: "fld_member_name" }, operator: "contains", value: { type: "parameter", parameterId: "param_name" } },
          { type: "condition", field: { kind: "data", fieldId: "fld_member_age" }, operator: "eq", value: { type: "parameter", parameterId: "param_age" } },
        ],
      },
    });
    const request = resolvePreviewQuery(adaptive, { param_name: "Bob", param_age: "" });
    expect(request.filter).toMatchObject({ type: "condition", field: { fieldId: "fld_member_name" }, value: "Bob" });
  });
});
