import { describe, expect, it } from "vitest";

import {
  decodeSchema,
  parseSchema,
  SchemaDecodeError,
  SchemaValidationError,
} from "./index.js";

function rawSchema(): Record<string, unknown> {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [
      {
        id: "col_posts",
        name: "posts",
        fields: [{ id: "fld_title", name: "title", type: "text" }],
      },
    ],
  };
}

function firstField(schema: Record<string, unknown>): Record<string, unknown> {
  const collections = schema["collections"] as Record<string, unknown>[];
  return (collections[0]!["fields"] as Record<string, unknown>[])[0]!;
}

describe("decodeSchema", () => {
  it("strictly decodes and canonicalizes an unknown JSON value", () => {
    const input = rawSchema();
    const decoded = decodeSchema(input);

    expect(decoded).toEqual({
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: "col_posts",
          name: "posts",
          fields: [{ id: "fld_title", name: "title", type: "text" }],
        },
      ],
    });
    expect(decoded).not.toBe(input);
  });

  it("preserves human-readable collection labels independently from API names", () => {
    const input = rawSchema();
    const collection = (input["collections"] as Record<string, unknown>[])[0]!;
    collection["label"] = "게시물";

    expect(decodeSchema(input).collections[0]).toEqual(
      expect.objectContaining({ name: "posts", label: "게시물" }),
    );
  });

  it("rejects unknown properties at the manifest and field boundaries", () => {
    const root = { ...rawSchema(), surprise: true };
    expectDecodeIssue(root, "UNKNOWN_PROPERTY", ["surprise"]);

    const nested = rawSchema();
    firstField(nested)["minLenght"] = 3;
    expectDecodeIssue(nested, "UNKNOWN_PROPERTY", [
      "collections",
      0,
      "fields",
      0,
      "minLenght",
    ]);
  });

  it("rejects an unknown field type explicitly", () => {
    const input = rawSchema();
    firstField(input)["type"] = "magic";
    expectDecodeIssue(input, "UNKNOWN_FIELD_TYPE", ["collections", 0, "fields", 0, "type"]);
  });

  it.each([
    ["undefined", undefined],
    ["function", () => "not-json"],
    ["Date", new Date("2026-01-01T00:00:00.000Z")],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a %s anywhere in the input graph", (_label, invalidValue) => {
    const input = rawSchema();
    firstField(input)["label"] = invalidValue;
    expectDecodeIssue(input, "INVALID_JSON_VALUE", ["collections", 0, "fields", 0, "label"]);
  });

  it("rejects circular and sparse input graphs instead of coercing them", () => {
    const circular = rawSchema();
    circular["self"] = circular;
    expectDecodeIssue(circular, "INVALID_JSON_VALUE", ["self"]);

    const sparse = rawSchema();
    const fields = new Array(1) as unknown[];
    (sparse["collections"] as Record<string, unknown>[])[0]!["fields"] = fields;
    expectDecodeIssue(sparse, "INVALID_JSON_VALUE", ["collections", 0, "fields", 0]);
  });

  it("separates structural decoding errors from semantic validation errors", () => {
    const input = rawSchema();
    firstField(input)["name"] = "id";
    expect(() => decodeSchema(input)).toThrowError(SchemaValidationError);
  });

  it("parses JSON text through the strict decoder and reports invalid syntax", () => {
    expect(parseSchema(JSON.stringify(rawSchema()))).toEqual(decodeSchema(rawSchema()));
    expectDecodeCallIssue(() => parseSchema("{"), "INVALID_JSON_SYNTAX", []);
  });
});

function expectDecodeIssue(
  input: unknown,
  code: string,
  path: readonly (string | number)[],
): void {
  expectDecodeCallIssue(() => decodeSchema(input), code, path);
}

function expectDecodeCallIssue(
  call: () => unknown,
  code: string,
  path: readonly (string | number)[],
): void {
  try {
    call();
    throw new Error("Expected decoding to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SchemaDecodeError);
    expect((error as SchemaDecodeError).issues[0]).toEqual(
      expect.objectContaining({ code, path }),
    );
  }
}
