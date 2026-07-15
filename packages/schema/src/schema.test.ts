import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asComponentId,
  asFieldId,
  asRelationId,
  diffSchemas,
  validateSchema,
  type SchemaIrV1,
} from "./index.js";

function createSchema(): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [
      {
        id: asCollectionId("col_authors"),
        name: "authors",
        fields: [
          { id: asFieldId("fld_author_name"), name: "name", type: "text", required: true },
        ],
      },
      {
        id: asCollectionId("col_posts"),
        name: "posts",
        fields: [
          { id: asFieldId("fld_title"), name: "title", type: "text", required: true },
          {
            id: asFieldId("fld_author"),
            name: "author",
            type: "relation",
            relationId: asRelationId("rel_post_author"),
            cardinality: "one",
            targetCollectionId: asCollectionId("col_authors"),
          },
        ],
      },
    ],
  };
}

describe("validateSchema", () => {
  it("accepts a valid canonical schema", () => {
    expect(validateSchema(createSchema())).toEqual({ valid: true, issues: [] });
  });

  it("reports stable object ID collisions with a structured path", () => {
    const schema = createSchema();
    const invalid: SchemaIrV1 = {
      ...schema,
      collections: [
        schema.collections[0]!,
        {
          ...schema.collections[1]!,
          fields: [
            {
              id: asFieldId("fld_author_name"),
              name: "duplicateId",
              type: "text",
            },
          ],
        },
      ],
    };

    const result = validateSchema(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_OBJECT_ID",
        objectId: "fld_author_name",
        path: ["collections", 1, "fields", 0, "id"],
      }),
    );
  });

  it("rejects an unknown relation target", () => {
    const schema = createSchema();
    const invalid: SchemaIrV1 = {
      ...schema,
      collections: [
        schema.collections[0]!,
        {
          ...schema.collections[1]!,
          fields: [
            {
              id: asFieldId("fld_missing_relation"),
              name: "missing",
              type: "relation",
              relationId: asRelationId("rel_missing"),
              cardinality: "one",
              targetCollectionId: asCollectionId("col_missing"),
            },
          ],
        },
      ],
    };

    expect(validateSchema(invalid).issues).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_RELATION_TARGET", objectId: "fld_missing_relation" }),
    );
  });
});

describe("diffSchemas", () => {
  it("detects a field rename by stable ID without treating it as delete/create", () => {
    const before = createSchema();
    const posts = before.collections[1]!;
    const after: SchemaIrV1 = {
      ...before,
      collections: [
        before.collections[0]!,
        {
          ...posts,
          fields: [{ ...posts.fields[0]!, name: "headline" }, posts.fields[1]!],
        },
      ],
    };

    const changes = diffSchemas(before, after).filter(({ objectId }) => objectId === "fld_title");
    expect(changes).toEqual([
      expect.objectContaining({ kind: "object-renamed", severity: "safe", objectId: "fld_title" }),
    ]);
  });

  it("reports collection and field label changes without requiring a physical migration", () => {
    const before = createSchema();
    const posts = before.collections[1]!;
    const after: SchemaIrV1 = {
      ...before,
      collections: [
        before.collections[0]!,
        {
          ...posts,
          label: "게시물",
          fields: [{ ...posts.fields[0]!, label: "제목" }, posts.fields[1]!],
        },
      ],
    };

    expect(diffSchemas(before, after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "object-label-changed",
          objectId: "col_posts",
          severity: "safe",
          before: null,
          after: "게시물",
        }),
        expect.objectContaining({
          kind: "object-label-changed",
          objectId: "fld_title",
          severity: "safe",
          before: null,
          after: "제목",
        }),
      ]),
    );
  });

  it("marks field deletion and type changes as destructive", () => {
    const before = createSchema();
    const posts = before.collections[1]!;
    const after: SchemaIrV1 = {
      ...before,
      collections: [
        before.collections[0]!,
        {
          ...posts,
          fields: [
            { id: asFieldId("fld_title"), name: "title", type: "number", required: true },
          ],
        },
      ],
    };

    expect(diffSchemas(before, after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "field-type-changed",
          objectId: "fld_title",
          severity: "destructive",
        }),
        expect.objectContaining({
          kind: "object-deleted",
          objectId: "fld_author",
          severity: "destructive",
        }),
      ]),
    );
  });

  it("detects a nested field move by its immediate stable owner ID", () => {
    const child = { id: asFieldId("fld_child"), name: "child", type: "text" as const };
    const before: SchemaIrV1 = {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: asCollectionId("col_pages"),
          name: "pages",
          fields: [
            {
              id: asFieldId("fld_group_a"),
              name: "groupA",
              type: "object",
              fields: [child],
            },
            {
              id: asFieldId("fld_group_b"),
              name: "groupB",
              type: "object",
              fields: [],
            },
          ],
        },
      ],
    };
    const collection = before.collections[0]!;
    const groupA = collection.fields[0]!;
    const groupB = collection.fields[1]!;
    const after: SchemaIrV1 = {
      ...before,
      collections: [
        {
          ...collection,
          fields: [
            { ...groupA, fields: [] },
            { ...groupB, fields: [child] },
          ] as typeof collection.fields,
        },
      ],
    };

    expect(diffSchemas(before, after)).toContainEqual(
      expect.objectContaining({
        kind: "field-owner-changed",
        objectId: "fld_child",
        before: "fld_group_a",
        after: "fld_group_b",
        severity: "destructive",
      }),
    );
  });

  it("reports relation identity, target, cardinality, and delete-policy changes", () => {
    const before = createSchema();
    const posts = before.collections[1]!;
    const relation = posts.fields[1]!;
    if (relation.type !== "relation") {
      throw new Error("Fixture relation is missing.");
    }
    const after: SchemaIrV1 = {
      ...before,
      collections: [
        ...before.collections,
        {
          id: asCollectionId("col_categories"),
          name: "categories",
          fields: [],
        },
      ].map((collection) =>
        collection.id !== posts.id
          ? collection
          : {
              ...posts,
              fields: [
                posts.fields[0]!,
                {
                  ...relation,
                  relationId: asRelationId("rel_post_category"),
                  targetCollectionId: asCollectionId("col_categories"),
                  cardinality: "many" as const,
                  onDelete: "cascade" as const,
                },
              ],
            },
      ),
    };

    expect(diffSchemas(before, after)).toContainEqual(
      expect.objectContaining({
        kind: "relation-changed",
        objectId: "fld_author",
        severity: "risky",
        before: expect.objectContaining({
          relationId: "rel_post_author",
          targetCollectionId: "col_authors",
        }),
        after: expect.objectContaining({
          relationId: "rel_post_category",
          targetCollectionId: "col_categories",
        }),
      }),
    );
  });

  it("does not mutate frozen inputs and returns changes in deterministic ID order", () => {
    const before = createSchema();
    const after: SchemaIrV1 = {
      ...before,
      collections: before.collections.map((collection) => ({
        ...collection,
        fields: collection.fields.map((field) => ({ ...field, required: false })),
      })),
      components: [
        { id: asComponentId("cmp_seo"), name: "seo", fields: [] },
      ],
    };
    deepFreeze(before);
    deepFreeze(after);

    const first = diffSchemas(before, after);
    const second = diffSchemas(before, after);
    expect(second).toEqual(first);
    expect(first.map(({ objectId }) => String(objectId))).toEqual(
      [...first.map(({ objectId }) => String(objectId))].sort((left, right) =>
        left.localeCompare(right, "en-US"),
      ),
    );
  });
});

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  Object.values(value).forEach(deepFreeze);
  Object.freeze(value);
}
