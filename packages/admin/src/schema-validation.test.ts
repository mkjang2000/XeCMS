import { describe, expect, it } from "vitest";
import { isValidSchemaName, schemaIssuePathToFormPath } from "./schema-validation.js";

describe("Admin Schema name validation", () => {
  it.each(["posts", "publishedAt", "field2", `a${"B".repeat(63)}`])("accepts '%s'", (name) => {
    expect(isValidSchemaName(name)).toBe(true);
  });

  it.each(["PublishedAt", "published_at", "published-at", "2fields", `a${"b".repeat(64)}`])(
    "rejects '%s'",
    (name) => {
      expect(isValidSchemaName(name)).toBe(false);
    },
  );
});

describe("Schema issue path mapping", () => {
  it("maps full IR field paths to the visible field row", () => {
    expect(schemaIssuePathToFormPath("schema.collections.0.fields.2.name")).toBe("fields.2.name");
    expect(schemaIssuePathToFormPath("collections.0.fields.1.label")).toBe("fields.1.label");
  });

  it("maps the edited collection name and ignores unrelated paths", () => {
    expect(schemaIssuePathToFormPath("schema.collections.0.name")).toBe("name");
    expect(schemaIssuePathToFormPath("schema.formatVersion")).toBeNull();
  });
});
