// @vitest-environment jsdom

import { createElement, createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionField } from "./api.js";
import { createDefaultFieldRegistry, FieldRegistry } from "./field-registry.js";

afterEach(cleanup);

const textField: CollectionField = {
  id: "field_title",
  name: "title",
  label: "제목",
  type: "text",
  required: true,
};

describe("FieldRegistry", () => {
  it("registers every M2 field editor in a stable order", () => {
    expect(createDefaultFieldRegistry().list().map(({ type }) => type)).toEqual([
      "text", "textarea", "number", "boolean", "date", "datetime", "select", "enum",
      "json", "object", "array", "component", "blocks", "rich-text", "relation", "upload",
    ]);
  });

  it("rejects duplicate registrations", () => {
    const definition = createDefaultFieldRegistry().get("text");
    const registry = new FieldRegistry().register(definition);
    expect(() => registry.register(definition)).toThrow("already registered");
  });

  it("renders a label from the schema and reports edits", async () => {
    const onChange = vi.fn();
    const inputRef = createRef<HTMLInputElement>();
    const user = userEvent.setup();
    const Editor = createDefaultFieldRegistry().get("text").Editor;
    render(createElement(Editor, {
      field: textField,
      value: "초안",
      name: "data.title",
      inputRef,
      onChange,
    }));

    const input = screen.getByRole("textbox", { name: "제목" });
    expect(input.getAttribute("name")).toBe("data.title");
    expect(inputRef.current).toBe(input);
    await user.clear(input);
    await user.type(input, "새 글");

    expect(onChange).toHaveBeenCalled();
  });

  it("can render a document snapshot as a disabled field", () => {
    const Editor = createDefaultFieldRegistry().get("text").Editor;
    render(createElement(Editor, {
      field: textField,
      value: "보관된 문서",
      onChange: vi.fn(),
      isDisabled: true,
    }));

    expect(screen.getByRole("textbox", { name: "제목" }).hasAttribute("disabled")).toBe(true);
  });

  it("does not commit malformed JSON from an object editor", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const Editor = createDefaultFieldRegistry().get("object").Editor;
    render(createElement(Editor, {
      field: { id: "fld_meta", name: "meta", label: "메타", type: "object", required: false },
      value: { ok: true },
      onChange,
    }));

    const input = screen.getByRole("textbox", { name: "메타" });
    await user.clear(input);
    await user.type(input, "not-json");
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/올바른 JSON/)).toBeTruthy();
  });
});
