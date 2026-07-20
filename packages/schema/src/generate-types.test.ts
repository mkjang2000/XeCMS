import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asComponentId,
  asFieldId,
  generateTypeScriptTypes,
  type SchemaIrV1,
} from "./index.js";

function generatorSchema(): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    components: [
      {
        id: asComponentId("cmp_seo"),
        name: "seo",
        fields: [
          { id: asFieldId("fld_description"), name: "description", type: "textarea", required: true },
        ],
      },
    ],
    collections: [
      {
        id: asCollectionId("col_posts"),
        name: "posts",
        fields: [
          { id: asFieldId("fld_title"), name: "title", type: "text", required: true },
          {
            id: asFieldId("fld_status"),
            name: "status",
            type: "enum",
            required: true,
            options: [
              { label: "Draft", value: "draft" },
              { label: "Published", value: "published" },
            ],
          },
          { id: asFieldId("fld_metadata"), name: "metadata", type: "json" },
          {
            id: asFieldId("fld_cards"),
            name: "cards",
            type: "array",
            fields: [
              { id: asFieldId("fld_card_title"), name: "title", type: "text", required: true },
            ],
          },
          {
            id: asFieldId("fld_seo"),
            name: "seo",
            type: "component",
            componentId: asComponentId("cmp_seo"),
          },
          { id: asFieldId("fld_body"), name: "body", type: "rich-text" },
        ],
      },
      {
        id: asCollectionId("col_site_settings"),
        name: "siteSettings",
        kind: "singleton",
        fields: [{ id: asFieldId("fld_site_name"), name: "siteName", type: "text", required: true }],
      },
    ],
  };
}

describe("deterministic TypeScript generation", () => {
  it("maps components, nested fields, literal options, rich text, and singleton names", () => {
    const output = generateTypeScriptTypes(generatorSchema());

    expect(output).toContain("export interface SeoComponent");
    expect(output).toContain('readonly "description": string;');
    expect(output).toContain("export interface PostsDocument");
    expect(output).toContain('readonly "status": "draft" | "published";');
    expect(output).toContain('readonly "metadata"?: SchemaJsonValue;');
    expect(output).toContain('readonly "seo"?: SeoComponent;');
    expect(output).toContain('readonly "body"?: RichTextDocumentV2;');
    expect(output).toContain('readonly "col_site_settings": SiteSettingsDocument;');
    expect(output).toContain('export type XeCmsRepeatableCollectionName = "posts";');
    expect(output).toContain('export type XeCmsSingletonName = "siteSettings";');
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
  });

  it("produces byte-identical output and has no volatile build metadata", () => {
    const schema = generatorSchema();
    const first = generateTypeScriptTypes(schema);
    const second = generateTypeScriptTypes(schema);

    expect(second).toBe(first);
    expect(first).not.toMatch(/generatedAt|revisionId|2026-/);
  });
});

