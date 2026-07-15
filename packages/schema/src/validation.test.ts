import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asComponentId,
  asFieldId,
  asRelationId,
  validateSchema,
  type CollectionId,
  type FieldDefinition,
  type FieldId,
  type RelationId,
  type SchemaIrV1,
} from "./index.js";

function schemaWith(field: FieldDefinition): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [
      {
        id: asCollectionId("col_posts"),
        name: "posts",
        fields: [field],
      },
    ],
  };
}

function issueCodes(schema: SchemaIrV1): readonly string[] {
  return validateSchema(schema).issues.map(({ code }) => code);
}

describe("Schema validation invariants", () => {
  it("enforces ID prefixes and graph-global uniqueness, including relation IDs", () => {
    const fieldId = "rel_shared" as FieldId;
    const relationId = "rel_shared" as RelationId;
    const schema = schemaWith({
      id: fieldId,
      name: "author",
      type: "relation",
      relationId,
      targetCollectionId: asCollectionId("col_posts"),
      cardinality: "one",
    });

    expect(validateSchema(schema).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_OBJECT_ID", path: ["collections", 0, "fields", 0, "id"] }),
        expect.objectContaining({
          code: "DUPLICATE_OBJECT_ID",
          path: ["collections", 0, "fields", 0, "relationId"],
        }),
      ]),
    );
  });

  it("validates relation ID format and target kind as well as target existence", () => {
    const schema = schemaWith({
      id: asFieldId("fld_author"),
      name: "author",
      type: "relation",
      relationId: "rel_Invalid" as RelationId,
      targetCollectionId: "fld_not_a_collection" as CollectionId,
      cardinality: "one",
    });

    expect(validateSchema(schema).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_OBJECT_ID", path: ["collections", 0, "fields", 0, "relationId"] }),
        expect.objectContaining({ code: "INVALID_OBJECT_ID", path: ["collections", 0, "fields", 0, "targetCollectionId"] }),
        expect.objectContaining({ code: "UNKNOWN_RELATION_TARGET" }),
      ]),
    );
  });

  it.each(["id", "createdAt", "UPDATEDAT", "revisionId"])(
    "rejects reserved field name %s case-insensitively",
    (name) => {
      const schema = schemaWith({ id: asFieldId("fld_reserved"), name, type: "text" });
      expect(issueCodes(schema)).toContain("INVALID_NAME");
    },
  );

  it("rejects prototype-sensitive schema names", () => {
    const schema = schemaWith({ id: asFieldId("fld_title"), name: "title", type: "text" });
    const invalid: SchemaIrV1 = {
      ...schema,
      collections: [{ ...schema.collections[0]!, name: "constructor" }],
    };
    expect(issueCodes(invalid)).toContain("INVALID_NAME");
  });

  it("accepts negative numeric bounds but validates bound order and default range", () => {
    const valid = schemaWith({
      id: asFieldId("fld_score"),
      name: "score",
      type: "number",
      minimum: -10,
      maximum: 10,
      defaultValue: -5,
    });
    expect(validateSchema(valid)).toEqual({ valid: true, issues: [] });

    const invalid = schemaWith({
      id: asFieldId("fld_score"),
      name: "score",
      type: "number",
      minimum: 10,
      maximum: -10,
      defaultValue: 20,
    });
    expect(issueCodes(invalid)).toEqual(
      expect.arrayContaining(["INVALID_RANGE", "INVALID_DEFAULT_VALUE"]),
    );
  });

  it("requires integral text/array ranges and validates defaults against them", () => {
    const text = schemaWith({
      id: asFieldId("fld_title"),
      name: "title",
      type: "text",
      minLength: 2.5,
      maxLength: 3,
      defaultValue: "x",
    });
    expect(issueCodes(text)).toEqual(
      expect.arrayContaining(["INVALID_RANGE", "INVALID_DEFAULT_VALUE"]),
    );
  });

  it.each([
    ["date", "2025-02-29"],
    ["datetime", "2026-07-14T12:30:00"],
    ["datetime", "2026-13-14T12:30:00Z"],
  ] as const)("rejects invalid %s default %s", (type, defaultValue) => {
    const schema = schemaWith({
      id: asFieldId("fld_time"),
      name: "time",
      type,
      defaultValue,
    });
    expect(issueCodes(schema)).toContain("INVALID_DEFAULT_VALUE");
  });

  it("validates scalar and multiple select defaults against configured options", () => {
    const scalar = schemaWith({
      id: asFieldId("fld_state"),
      name: "state",
      type: "select",
      options: [{ label: "Draft", value: "draft" }],
      defaultValue: "published",
    });
    const multiple = schemaWith({
      id: asFieldId("fld_state"),
      name: "state",
      type: "select",
      multiple: true,
      options: [{ label: "Draft", value: "draft" }],
      defaultValue: ["draft", "draft"],
    });
    expect(issueCodes(scalar)).toContain("INVALID_DEFAULT_VALUE");
    expect(issueCodes(multiple)).toContain("INVALID_DEFAULT_VALUE");
  });

  it("explicitly rejects localized fields while localization is outside M0", () => {
    const schema = schemaWith({
      id: asFieldId("fld_title"),
      name: "title",
      type: "text",
      localized: true,
    });
    expect(validateSchema(schema).issues).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_LOCALIZED",
        path: ["collections", 0, "fields", 0, "localized"],
      }),
    );
  });

  it("rejects non-JSON defaults when validation is called directly", () => {
    const schema = schemaWith({
      id: asFieldId("fld_json"),
      name: "payload",
      type: "json",
      defaultValue: { invalid: Number.NaN },
    });
    expect(issueCodes(schema)).toContain("INVALID_DEFAULT_VALUE");
  });

  it("rejects nullify on a required relation", () => {
    const schema = schemaWith({
      id: asFieldId("fld_parent"),
      name: "parent",
      type: "relation",
      relationId: asRelationId("rel_parent"),
      targetCollectionId: asCollectionId("col_posts"),
      cardinality: "one",
      required: true,
      onDelete: "nullify",
    });
    expect(issueCodes(schema)).toContain("INVALID_DEFAULT_VALUE");
  });

  it("validates upload field MIME allow-list patterns", () => {
    const valid = schemaWith({
      id: asFieldId("fld_image"),
      name: "image",
      type: "upload",
      acceptedMimeTypes: ["image/png", "image/*"],
    });
    expect(validateSchema(valid)).toEqual({ valid: true, issues: [] });

    const invalid = schemaWith({
      id: asFieldId("fld_image"),
      name: "image",
      type: "upload",
      acceptedMimeTypes: ["Image/PNG", "image/png; charset=utf-8", "image/png", "image/png"],
    });
    expect(validateSchema(invalid).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "INVALID_MIME_PATTERN",
        path: ["collections", 0, "fields", 0, "acceptedMimeTypes", 0],
      }),
      expect.objectContaining({
        code: "INVALID_MIME_PATTERN",
        path: ["collections", 0, "fields", 0, "acceptedMimeTypes", 1],
      }),
      expect.objectContaining({
        code: "INVALID_MIME_PATTERN",
        path: ["collections", 0, "fields", 0, "acceptedMimeTypes", 3],
      }),
    ]));
  });

  it("rejects relation and upload fields nested directly in objects and arrays", () => {
    const schema: SchemaIrV1 = {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: asCollectionId("col_assets"),
          name: "assets",
          fields: [],
        },
        {
          id: asCollectionId("col_posts"),
          name: "posts",
          fields: [
            {
              id: asFieldId("fld_metadata"),
              name: "metadata",
              type: "object",
              fields: [
                {
                  id: asFieldId("fld_nested_relation"),
                  name: "target",
                  type: "relation",
                  relationId: asRelationId("rel_nested_target"),
                  targetCollectionId: asCollectionId("col_assets"),
                  cardinality: "one",
                },
              ],
            },
            {
              id: asFieldId("fld_gallery"),
              name: "gallery",
              type: "array",
              fields: [
                {
                  id: asFieldId("fld_nested_upload"),
                  name: "image",
                  type: "upload",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(validateSchema(schema).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_NESTED_REFERENCE",
          objectId: "fld_nested_relation",
          path: ["collections", 1, "fields", 0, "fields", 0, "type"],
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_NESTED_REFERENCE",
          objectId: "fld_nested_upload",
          path: ["collections", 1, "fields", 1, "fields", 0, "type"],
        }),
      ]),
    );
  });

  it("rejects reference fields reached through component and blocks fields", () => {
    const schema: SchemaIrV1 = {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: asCollectionId("col_assets"),
          name: "assets",
          fields: [],
        },
        {
          id: asCollectionId("col_pages"),
          name: "pages",
          fields: [
            {
              id: asFieldId("fld_card"),
              name: "card",
              type: "component",
              componentId: asComponentId("cmp_card"),
            },
            {
              id: asFieldId("fld_content"),
              name: "content",
              type: "blocks",
              allowedComponentIds: [asComponentId("cmp_content_block")],
            },
          ],
        },
      ],
      components: [
        {
          id: asComponentId("cmp_card"),
          name: "card",
          fields: [
            {
              id: asFieldId("fld_component_relation"),
              name: "target",
              type: "relation",
              relationId: asRelationId("rel_component_target"),
              targetCollectionId: asCollectionId("col_assets"),
              cardinality: "one",
            },
          ],
        },
        {
          id: asComponentId("cmp_content_block"),
          name: "contentBlock",
          fields: [
            {
              id: asFieldId("fld_block_upload"),
              name: "image",
              type: "upload",
            },
          ],
        },
      ],
    };

    expect(validateSchema(schema).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_NESTED_REFERENCE",
          objectId: "fld_component_relation",
          path: ["components", 0, "fields", 0, "type"],
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_NESTED_REFERENCE",
          objectId: "fld_block_upload",
          path: ["components", 1, "fields", 0, "type"],
        }),
      ]),
    );
  });

  it("keeps top-level relation and upload fields supported", () => {
    const schema: SchemaIrV1 = {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: asCollectionId("col_assets"),
          name: "assets",
          fields: [],
        },
        {
          id: asCollectionId("col_posts"),
          name: "posts",
          fields: [
            {
              id: asFieldId("fld_author"),
              name: "author",
              type: "relation",
              relationId: asRelationId("rel_post_author"),
              targetCollectionId: asCollectionId("col_assets"),
              cardinality: "one",
            },
            {
              id: asFieldId("fld_cover"),
              name: "cover",
              type: "upload",
            },
          ],
        },
      ],
    };

    expect(validateSchema(schema)).toEqual({ valid: true, issues: [] });
  });
});
