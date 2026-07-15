import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asFieldId,
  normalizeSchema,
  parseSchema,
  serializeSchema,
  type SchemaIrV1,
} from "./index.js";

function canonicalFixture(jsonDefault: unknown): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    components: [],
    collections: [
      {
        id: asCollectionId("col_posts"),
        name: "posts",
        label: "Posts",
        kind: "collection",
        fields: [
          {
            id: asFieldId("fld_metadata"),
            name: "metadata",
            type: "json",
            required: false,
            unique: false,
            readOnly: false,
            defaultValue: jsonDefault,
          },
          {
            id: asFieldId("fld_publish_at"),
            name: "publishAt",
            type: "datetime",
            defaultValue: "2026-07-14T12:30:00+09:00",
          },
        ],
      },
    ],
  };
}

describe("canonical Schema IR", () => {
  it("normalizes defaults, datetime offsets, negative zero, and JSON object keys", () => {
    const schema = canonicalFixture({ z: -0, a: { y: 2, x: 1 } });
    const normalized = normalizeSchema(schema);

    expect(normalized).toEqual({
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: "col_posts",
          name: "posts",
          label: "Posts",
          fields: [
            {
              id: "fld_metadata",
              name: "metadata",
              type: "json",
              defaultValue: { a: { x: 1, y: 2 }, z: 0 },
            },
            {
              id: "fld_publish_at",
              name: "publishAt",
              type: "datetime",
              defaultValue: "2026-07-14T03:30:00.000Z",
            },
          ],
        },
      ],
    });
  });

  it("serializes semantically equal property insertion orders identically", () => {
    const left = canonicalFixture({ z: 1, a: { y: 2, x: 3 } });
    const right = canonicalFixture({ a: { x: 3, y: 2 }, z: 1 });

    expect(serializeSchema(left)).toBe(serializeSchema(right));
    expect(serializeSchema(left)).toBe(serializeSchema(left));
  });

  it("round-trips canonical serialization without drift", () => {
    const normalized = normalizeSchema(canonicalFixture({ b: [3, 2, 1], a: null }));
    const serialized = serializeSchema(normalized);
    const decoded = parseSchema(serialized);

    expect(decoded).toEqual(normalized);
    expect(serializeSchema(decoded)).toBe(serialized);
  });

  it("preserves special JSON keys without prototype mutation", () => {
    const specialKeys = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"content-value"}',
    ) as unknown;
    const serialized = serializeSchema(canonicalFixture(specialKeys));
    const decoded = parseSchema(serialized);
    const defaultValue = (
      decoded.collections[0]!.fields[0] as Extract<
        (typeof decoded.collections)[number]["fields"][number],
        { type: "json" }
      >
    ).defaultValue as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(defaultValue, "__proto__")).toBe(true);
    expect(defaultValue["__proto__"]).toEqual({ polluted: true });
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("preserves user-visible array order", () => {
    const schema = canonicalFixture({ values: ["third", "first", "second"] });
    const normalized = normalizeSchema(schema);
    const values = (
      normalized.collections[0]!.fields[0] as Extract<
        (typeof normalized.collections)[number]["fields"][number],
        { type: "json" }
      >
    ).defaultValue as { values: string[] };

    expect(values.values).toEqual(["third", "first", "second"]);
    expect(normalized.collections[0]!.fields.map(({ id }) => id)).toEqual([
      "fld_metadata",
      "fld_publish_at",
    ]);
  });

  it("does not mutate even deeply frozen input and returns detached nested values", () => {
    const schema = canonicalFixture({ outer: { b: 2, a: 1 } });
    deepFreeze(schema);

    const normalized = normalizeSchema(schema);
    expect(normalized).not.toBe(schema);
    expect(normalized.collections).not.toBe(schema.collections);
    expect(normalized.collections[0]!.fields).not.toBe(schema.collections[0]!.fields);
    expect(schema).toEqual(canonicalFixture({ outer: { b: 2, a: 1 } }));
  });
});

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  Object.freeze(value);
}
