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

  it("swaps only the Editor slot when the host app supplies an override", () => {
    const Injected = () => null;
    const base = createDefaultFieldRegistry().get("rich-text");
    const overridden = createDefaultFieldRegistry({ "rich-text": Injected }).get("rich-text");

    expect(overridden.Editor).toBe(Injected);
    // label and initialValue stay with the default definition.
    expect(overridden.label).toBe(base.label);
    expect(overridden.initialValue).toEqual(base.initialValue);
  });

  it("falls back to a read-only rich-text editor that cannot flatten formatting", async () => {
    const onChange = vi.fn();
    const richTextField: CollectionField = { id: "field_body", name: "body", label: "본문", type: "rich-text", required: false };
    const { Editor } = createDefaultFieldRegistry().get("rich-text");
    render(createElement(Editor, {
      field: richTextField,
      value: {
        format: "xecms.rich-text",
        formatVersion: 2,
        content: [{ id: "blk-1", type: "paragraph", props: {}, content: [{ type: "text", text: "서식 있는 본문", styles: {} }], children: [] }],
      },
      onChange,
    }));

    const input = screen.getByLabelText(/본문/) as HTMLTextAreaElement;
    expect(input.value).toContain("서식 있는 본문");
    // Disabled on purpose: a plain-text write-back would destroy marks and attrs.
    expect(input.disabled).toBe(true);
    await userEvent.type(input, "추가");
    expect(onChange).not.toHaveBeenCalled();
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
