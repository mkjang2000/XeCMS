import { describe, expect, it } from "vitest";

import {
  assertMaskedFilterOperatorAllowed,
  assertMaskedSortAllowed,
} from "./masked-query-guard.js";

describe("masked query guard", () => {
  it("rejects every filter operator on a masked Field by default", () => {
    for (const operator of ["eq", "contains", "startsWith", "gt", "in", "isNull"] as const) {
      expect(() => assertMaskedFilterOperatorAllowed("email", operator))
        .toThrow(expect.objectContaining({ code: "MASKED_FIELD_FILTER_FORBIDDEN", status: 403 }));
    }
  });

  it("rejects sorting on a masked Field by default", () => {
    expect(() => assertMaskedSortAllowed("email"))
      .toThrow(expect.objectContaining({ code: "MASKED_FIELD_SORT_FORBIDDEN", status: 403 }));
  });

  it("permits only explicitly allowlisted operators and sortability", () => {
    expect(() => assertMaskedFilterOperatorAllowed("email", "eq", {
      filterOperators: ["eq", "isNull"],
    })).not.toThrow();
    expect(() => assertMaskedFilterOperatorAllowed("email", "contains", {
      filterOperators: ["eq", "isNull"],
    })).toThrow(expect.objectContaining({ code: "MASKED_FIELD_FILTER_FORBIDDEN" }));
    expect(() => assertMaskedSortAllowed("email", { sortable: true })).not.toThrow();
  });
});
