import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asFieldId,
  createSchemaIdGenerator,
  SchemaIdGenerationError,
} from "./index.js";

describe("Schema object ID contract", () => {
  it("adds the correct kind prefix to an injected deterministic token source", () => {
    const tokens = ["001", "002", "003", "004"];
    const generator = createSchemaIdGenerator(() => tokens.shift()!);

    expect(generator.next("collection")).toBe("col_001");
    expect(generator.next("field")).toBe("fld_002");
    expect(generator.next("relation")).toBe("rel_003");
    expect(generator.next("component")).toBe("cmp_004");
  });

  it("rejects reuse for the lifetime of a generator", () => {
    const generator = createSchemaIdGenerator(() => "same");
    expect(generator.next("field")).toBe("fld_same");
    expect(() => generator.next("field")).toThrowError(SchemaIdGenerationError);
  });

  it.each(["", "UPPER", "has.dot", " leading", "x".repeat(97)])(
    "rejects invalid generated token %j",
    (token) => {
      const generator = createSchemaIdGenerator(() => token);
      expect(() => generator.next("collection")).toThrowError(SchemaIdGenerationError);
    },
  );

  it("makes branded ID conversion enforce the full runtime format", () => {
    expect(asCollectionId("col_valid-id_1")).toBe("col_valid-id_1");
    expect(asFieldId("fld_valid_1")).toBe("fld_valid_1");
    expect(() => asCollectionId("fld_wrong_kind")).toThrow(TypeError);
    expect(() => asCollectionId("col_Invalid")).toThrow(TypeError);
  });
});
