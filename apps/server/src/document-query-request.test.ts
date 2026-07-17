import { describe, expect, it } from "vitest";
import { ApplicationError } from "@xecms/application";
import { parseDocumentQueryRequest } from "./document-query-request.js";

describe("Document query request parser", () => {
  it("strictly parses a nested query body", () => {
    expect(parseDocumentQueryRequest({
      limit: 20,
      fields: ["fld_title"],
      filter: {
        type: "group",
        operator: "and",
        filters: [{
          type: "condition",
          field: { kind: "data", fieldId: "fld_title" },
          operator: "contains",
          value: "XeCMS",
        }],
      },
      sort: [{
        field: { kind: "system", field: "updatedAt" },
        direction: "desc",
      }],
    })).toEqual({
      limit: 20,
      fields: ["fld_title"],
      filter: {
        type: "group",
        operator: "and",
        filters: [{
          type: "condition",
          field: { kind: "data", fieldId: "fld_title" },
          operator: "contains",
          value: "XeCMS",
        }],
      },
      sort: [{
        field: { kind: "system", field: "updatedAt" },
        direction: "desc",
      }],
    });
  });

  it("rejects unknown properties and non-scalar values", () => {
    expectCode(() => parseDocumentQueryRequest({ arbitrarySql: "SELECT 1" }));
    expectCode(() => parseDocumentQueryRequest({
      filter: {
        type: "condition",
        field: { kind: "data", fieldId: "fld_title" },
        operator: "eq",
        value: { nested: true },
      },
    }));
  });
});

function expectCode(run: () => unknown): void {
  try {
    run();
    throw new Error("Expected parser to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect((error as ApplicationError).code).toBe("DOCUMENT_QUERY_INVALID");
    expect((error as ApplicationError).status).toBe(400);
  }
}

