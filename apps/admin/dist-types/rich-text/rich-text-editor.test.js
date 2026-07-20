import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./rich-text-editor.js";
afterEach(cleanup);
const field = {
    id: "fld_body",
    name: "body",
    label: "본문",
    type: "rich-text",
    required: false,
};
const storedDocument = {
    format: "xecms.rich-text",
    formatVersion: 1,
    content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "저장된 제목" }] },
        { type: "paragraph", content: [{ type: "text", text: "저장된 본문" }] },
    ],
};
describe("RichTextEditor", () => {
    it("shows a value that arrives after the first render", async () => {
        // The document query resolves after mount, so the editor is created with an
        // empty value and must pick the loaded content up.
        function Host() {
            const [value, setValue] = useState({
                format: "xecms.rich-text",
                formatVersion: 1,
                content: [],
            });
            return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => setValue(storedDocument), children: "load" }), _jsx(RichTextEditor, { field: field, value: value, onChange: vi.fn() })] }));
        }
        render(_jsx(Host, {}));
        screen.getByRole("button", { name: "load" }).click();
        await waitFor(() => {
            expect(screen.getByText("저장된 제목")).toBeTruthy();
            expect(screen.getByText("저장된 본문")).toBeTruthy();
        });
    });
    it("renders a value present on first render", async () => {
        render(_jsx(RichTextEditor, { field: field, value: storedDocument, onChange: vi.fn() }));
        await waitFor(() => {
            expect(screen.getByText("저장된 제목")).toBeTruthy();
        });
    });
    it("never reports an empty document while seeding", async () => {
        // StrictMode mounts twice; the discarded first editor used to emit its empty
        // document and wipe the value the form had just loaded, so a saved document
        // reopened blank.
        const onChange = vi.fn();
        render(_jsx(StrictMode, { children: _jsx(RichTextEditor, { field: field, value: storedDocument, onChange: onChange }) }));
        await waitFor(() => expect(screen.getByText("저장된 제목")).toBeTruthy());
        const wipedValue = onChange.mock.calls.find(([document]) => document.content.length === 0);
        expect(wipedValue).toBeUndefined();
    });
    it("keeps the body when the media list refreshes after an upload", async () => {
        // Uploading invalidates the media query, so mediaItems arrives as a new
        // array. That must not re-seed the editor: everything typed since the last
        // form sync — including the image just inserted — would be wiped.
        const media = (id) => ({
            id,
            fileName: `${id}.png`,
            mimeType: "image/png",
            size: 1,
            checksum: "sum",
            storageKey: `key/${id}`,
            createdAt: "2026-07-20T00:00:00.000Z",
            createdBy: "usr_admin",
            status: "available",
            contentUrl: `http://host/${id}`,
        });
        function Host() {
            const [items, setItems] = useState([media("med_1")]);
            return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => setItems([media("med_1"), media("med_2")]), children: "refresh" }), _jsx(RichTextEditor, { field: field, value: storedDocument, onChange: vi.fn(), mediaItems: items })] }));
        }
        render(_jsx(Host, {}));
        await waitFor(() => expect(screen.getByText("저장된 제목")).toBeTruthy());
        screen.getByRole("button", { name: "refresh" }).click();
        await waitFor(() => expect(screen.getByText("저장된 제목")).toBeTruthy());
        expect(screen.getByText("저장된 본문")).toBeTruthy();
    });
    it("adds an inserted image without replacing the body", async () => {
        // An editor that was never focused reports a selection spanning the whole
        // document. Inserting over that range replaced the entire body, so picking
        // an image wiped everything the user had written.
        const onChange = vi.fn();
        render(_jsx(RichTextEditor, { field: field, value: storedDocument, onChange: onChange, mediaItems: [{
                    id: "med_1",
                    fileName: "cover.png",
                    mimeType: "image/png",
                    size: 1,
                    checksum: "sum",
                    storageKey: "key/med_1",
                    createdAt: "2026-07-20T00:00:00.000Z",
                    createdBy: "usr_admin",
                    status: "available",
                    contentUrl: "http://host/med_1",
                }] }));
        await waitFor(() => expect(screen.getByText("저장된 제목")).toBeTruthy());
        screen.getByRole("button", { name: "이미지" }).click();
        (await screen.findByRole("button", { name: /cover\.png/ })).click();
        await waitFor(() => {
            const latest = onChange.mock.calls.at(-1)?.[0];
            expect(latest?.content.some((node) => node.type === "image")).toBe(true);
        });
        // The original heading and paragraph must still be there.
        expect(screen.getByText("저장된 제목")).toBeTruthy();
        expect(screen.getByText("저장된 본문")).toBeTruthy();
    });
    it("re-seeds after the form resets to a reloaded document", async () => {
        // Real sequence: user types (editor emits), the document is saved and the
        // form resets from the server response. The editor must show that value.
        const empty = { format: "xecms.rich-text", formatVersion: 1, content: [] };
        function Host() {
            const [value, setValue] = useState(empty);
            return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => setValue(empty), children: "clear" }), _jsx("button", { type: "button", onClick: () => setValue(storedDocument), children: "reload" }), _jsx(RichTextEditor, { field: field, value: value, onChange: setValue })] }));
        }
        render(_jsx(Host, {}));
        // Simulate the editor having emitted at least once, then an external reload.
        screen.getByRole("button", { name: "clear" }).click();
        screen.getByRole("button", { name: "reload" }).click();
        await waitFor(() => {
            expect(screen.getByText("저장된 제목")).toBeTruthy();
        });
    });
});
//# sourceMappingURL=rich-text-editor.test.js.map