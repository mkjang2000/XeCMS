import { describe, expect, it } from "vitest";

import {
  ContentValidationError,
  asCollectionId,
  asComponentId,
  asFieldId,
  decodeCollectionData,
  validateCollectionData,
  type SchemaIrV1,
} from "./index.js";

function breadthSchema(): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    components: [
      {
        id: asComponentId("cmp_seo"),
        name: "seo",
        fields: [
          {
            id: asFieldId("fld_seo_description"),
            name: "description",
            type: "textarea",
            required: true,
            maxLength: 160,
          },
          { id: asFieldId("fld_seo_meta"), name: "meta", type: "json" },
        ],
      },
    ],
    collections: [
      {
        id: asCollectionId("col_site_settings"),
        name: "siteSettings",
        kind: "singleton",
        fields: [
          { id: asFieldId("fld_title"), name: "title", type: "text", required: true },
          { id: asFieldId("fld_summary"), name: "summary", type: "textarea", minLength: 2 },
          { id: asFieldId("fld_launch_date"), name: "launchDate", type: "date", required: true },
          {
            id: asFieldId("fld_theme"),
            name: "theme",
            type: "enum",
            options: [
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
            ],
            defaultValue: "light",
          },
          {
            id: asFieldId("fld_tags"),
            name: "tags",
            type: "select",
            multiple: true,
            options: [
              { label: "CMS", value: "cms" },
              { label: "TypeScript", value: "typescript" },
            ],
          },
          { id: asFieldId("fld_payload"), name: "payload", type: "json" },
          {
            id: asFieldId("fld_address"),
            name: "address",
            type: "object",
            fields: [
              { id: asFieldId("fld_city"), name: "city", type: "text", required: true },
            ],
          },
          {
            id: asFieldId("fld_links"),
            name: "links",
            type: "array",
            minItems: 1,
            fields: [
              { id: asFieldId("fld_link_label"), name: "label", type: "text", required: true },
            ],
          },
          {
            id: asFieldId("fld_seo"),
            name: "seo",
            type: "component",
            componentId: asComponentId("cmp_seo"),
            required: true,
          },
          {
            id: asFieldId("fld_sections"),
            name: "sections",
            type: "component",
            componentId: asComponentId("cmp_seo"),
            repeatable: true,
          },
          { id: asFieldId("fld_body"), name: "body", type: "rich-text", editor: "xecms.basic" },
        ],
      },
    ],
  };
}

describe("M2 collection data contract", () => {
  it("decodes singleton data, nested objects, reusable components, defaults, and rich text", () => {
    const result = decodeCollectionData(breadthSchema(), "siteSettings", {
      title: "XeCMS",
      summary: "Modern CMS",
      launchDate: "2026-07-15",
      tags: ["cms", "typescript"],
      payload: { z: -0, a: [true, null] },
      address: { city: "Seoul" },
      links: [{ label: "Docs" }],
      seo: { description: "Reusable component", meta: { robots: "index" } },
      sections: [{ description: "First" }, { description: "Second" }],
      body: {
        format: "xecms.rich-text",
        formatVersion: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
          },
        ],
      },
    });

    expect(result).toEqual({
      title: "XeCMS",
      summary: "Modern CMS",
      launchDate: "2026-07-15",
      theme: "light",
      tags: ["cms", "typescript"],
      payload: { a: [true, null], z: 0 },
      address: { city: "Seoul" },
      links: [{ label: "Docs" }],
      seo: { description: "Reusable component", meta: { robots: "index" } },
      sections: [{ description: "First" }, { description: "Second" }],
      body: {
        format: "xecms.rich-text",
        formatVersion: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
          },
        ],
      },
    });
  });

  it("collects unknown, required, range, option, nested, and rich-text issues", () => {
    const result = validateCollectionData(breadthSchema(), "col_site_settings", {
      surprise: true,
      title: 42,
      summary: "x",
      launchDate: "2026-02-30",
      theme: "system",
      tags: ["cms", "cms"],
      address: {},
      links: [],
      seo: { description: 1 },
      body: {
        format: "xecms.rich-text",
        formatVersion: 1,
        content: [{ type: "text", content: [], text: "invalid" }],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_FIELD", path: ["data", "surprise"] }),
        expect.objectContaining({ code: "INVALID_CONTENT_TYPE", path: ["data", "title"] }),
        expect.objectContaining({ code: "FIELD_CONSTRAINT_FAILED", path: ["data", "summary"] }),
        expect.objectContaining({ code: "FIELD_REQUIRED", path: ["data", "address", "city"] }),
        expect.objectContaining({ code: "FIELD_CONSTRAINT_FAILED", path: ["data", "links"] }),
        expect.objectContaining({ code: "INVALID_RICH_TEXT" }),
      ]),
    );
    expect(() => decodeCollectionData(breadthSchema(), "siteSettings", {})).toThrow(
      ContentValidationError,
    );
  });

  it("rejects non-JSON objects and preserves prototype-sensitive JSON keys safely", () => {
    expect(
      validateCollectionData(breadthSchema(), "siteSettings", {
        title: "XeCMS",
        launchDate: "2026-07-15",
        seo: { description: "SEO" },
        payload: new Date(),
      }).issues,
    ).toContainEqual(expect.objectContaining({ path: ["data", "payload"] }));

    const payload = JSON.parse('{"__proto__":{"safe":true},"constructor":"value"}') as unknown;
    const decoded = decodeCollectionData(breadthSchema(), "siteSettings", {
      title: "XeCMS",
      launchDate: "2026-07-15",
      seo: { description: "SEO" },
      payload,
    });
    const value = decoded["payload"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect((Object.prototype as Record<string, unknown>)["safe"]).toBeUndefined();
  });
});

