import { describe, expect, it } from "vitest";

import {
  decodeSchema,
  parseSchema,
  serializeSchema,
  validateSchema,
  type SchemaIrV1,
} from "./index.js";

function rawBreadthManifest(): unknown {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    components: [
      {
        id: "cmp_card",
        name: "card",
        label: "Card",
        fields: [
          { id: "fld_card_title", name: "title", type: "text", required: true },
        ],
      },
    ],
    collections: [
      {
        id: "col_settings",
        name: "settings",
        kind: "singleton",
        fields: [
          { id: "fld_summary", name: "summary", type: "textarea", maxLength: 500 },
          { id: "fld_launch_date", name: "launchDate", type: "date" },
          {
            id: "fld_theme",
            name: "theme",
            type: "select",
            options: [{ label: "Dark", value: "dark" }],
          },
          {
            id: "fld_state",
            name: "state",
            type: "enum",
            options: [{ label: "Ready", value: "ready" }],
          },
          { id: "fld_config", name: "config", type: "json", defaultValue: { enabled: true } },
          {
            id: "fld_address",
            name: "address",
            type: "object",
            fields: [{ id: "fld_city", name: "city", type: "text" }],
          },
          {
            id: "fld_items",
            name: "items",
            type: "array",
            minItems: 1,
            fields: [{ id: "fld_item_name", name: "name", type: "text" }],
          },
          {
            id: "fld_card",
            name: "card",
            type: "component",
            componentId: "cmp_card",
          },
          { id: "fld_body", name: "body", type: "rich-text", editor: "xecms.basic" },
        ],
      },
    ],
  };
}

describe("M2-B Schema IR breadth", () => {
  it("strictly decodes and canonically round-trips every activated M2-B field", () => {
    const decoded = decodeSchema(rawBreadthManifest());
    const serialized = serializeSchema(decoded);

    expect(decoded.collections[0]).toMatchObject({ kind: "singleton" });
    expect(decoded.components?.[0]).toMatchObject({ id: "cmp_card", name: "card" });
    expect(decoded.collections[0]!.fields.map(({ type }) => type)).toEqual([
      "textarea",
      "date",
      "select",
      "enum",
      "json",
      "object",
      "array",
      "component",
      "rich-text",
    ]);
    expect(parseSchema(serialized)).toEqual(decoded);
    expect(serializeSchema(parseSchema(serialized))).toBe(serialized);
  });

  it("rejects singleton hierarchy and invalid reusable-component/rich-text contracts", () => {
    const decoded = decodeSchema(rawBreadthManifest());
    const collection = decoded.collections[0]!;
    const invalid: SchemaIrV1 = {
      ...decoded,
      collections: [
        {
          ...collection,
          hierarchy: { enabled: true },
          fields: [
            ...collection.fields,
            {
              id: "fld_invalid_editor" as typeof collection.fields[number]["id"],
              name: "invalidEditor",
              type: "rich-text",
              editor: "contains whitespace",
            },
          ],
        },
      ],
    };

    expect(validateSchema(invalid).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_HIERARCHY" }),
        expect.objectContaining({ code: "INVALID_RICH_TEXT_EDITOR" }),
      ]),
    );
  });

  it("rejects empty and duplicate blocks component allowlists", () => {
    const decoded = decodeSchema(rawBreadthManifest());
    const collection = decoded.collections[0]!;
    const componentId = decoded.components![0]!.id;
    const invalid: SchemaIrV1 = {
      ...decoded,
      collections: [
        {
          ...collection,
          kind: "collection",
          fields: [
            {
              id: "fld_empty_blocks" as typeof collection.fields[number]["id"],
              name: "emptyBlocks",
              type: "blocks",
              allowedComponentIds: [],
            },
            {
              id: "fld_duplicate_blocks" as typeof collection.fields[number]["id"],
              name: "duplicateBlocks",
              type: "blocks",
              allowedComponentIds: [componentId, componentId],
            },
          ],
        },
      ],
    };

    expect(validateSchema(invalid).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_COMPONENT_TARGET", objectId: "fld_empty_blocks" }),
        expect.objectContaining({ code: "DUPLICATE_COMPONENT_TARGET", objectId: "fld_duplicate_blocks" }),
      ]),
    );
  });
});

