import { describe, expect, it } from "vitest";

import { formatFieldValue } from "./composed-format.js";

describe("formatFieldValue", () => {
  it("returns an empty marker for null/undefined/empty", () => {
    for (const value of [null, undefined, ""]) {
      const result = formatFieldValue(value, "text");
      expect(result.empty).toBe(true);
      expect(result.text).toBe("—");
    }
  });

  it("renders booleans as a badge with a localized label", () => {
    expect(formatFieldValue(true, "boolean")).toMatchObject({ text: "예", kind: "badge" });
    expect(formatFieldValue(false, "boolean")).toMatchObject({ text: "아니오", kind: "badge" });
    expect(formatFieldValue("true", "boolean").text).toBe("예");
  });

  it("renders select/enum values as a badge", () => {
    expect(formatFieldValue("active", "select").kind).toBe("badge");
    expect(formatFieldValue("gold", "enum").kind).toBe("badge");
  });

  it("groups numbers with a thousands separator", () => {
    expect(formatFieldValue(1234567, "number").text).toBe((1234567).toLocaleString());
  });

  it("formats an ISO date without time", () => {
    const result = formatFieldValue("2026-07-23", "date");
    expect(result.kind).toBe("text");
    expect(result.text).not.toBe("2026-07-23T00:00:00.000Z");
  });

  it("treats textarea as long-text", () => {
    expect(formatFieldValue("line1\nline2", "textarea")).toMatchObject({ kind: "long-text" });
  });

  it("lets an explicit format override the field type", () => {
    // A text field displayed as a badge.
    expect(formatFieldValue("VIP", "text", "badge").kind).toBe("badge");
  });

  it("falls back to raw text for an unparseable date", () => {
    expect(formatFieldValue("not-a-date", "date").text).toBe("not-a-date");
  });

  it("renders relation and upload (media) values as read-only text", () => {
    // Relation stores a target id (or server-resolved label); shown as plain text.
    expect(formatFieldValue("doc_123", "relation")).toMatchObject({ kind: "text", text: "doc_123" });
    // Upload/media stores an id or list; read-only text, no thumbnail/download in composed outputs.
    expect(formatFieldValue(["med_1", "med_2"], "upload")).toMatchObject({ kind: "text", text: "med_1,med_2" });
  });
});
