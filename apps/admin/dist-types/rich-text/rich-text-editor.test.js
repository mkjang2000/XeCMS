import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
// jsdom lacks the layout APIs BlockNote's floating UI and Mantine query.
// Stubs are enough: menus never open in these tests, layout is irrelevant.
class ResizeObserverStub {
    observe() { }
    unobserve() { }
    disconnect() { }
}
globalThis.ResizeObserver ??= ResizeObserverStub;
window.matchMedia ??= ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
}));
Element.prototype.scrollIntoView ??= () => undefined;
const { RichTextEditor } = await import("./rich-text-editor.js");
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
    formatVersion: 2,
    content: [
        { id: "blk-1", type: "heading", props: { level: 1 }, content: [{ type: "text", text: "저장된 제목", styles: {} }], children: [] },
        { id: "blk-2", type: "paragraph", props: {}, content: [{ type: "text", text: "저장된 본문", styles: {} }], children: [] },
    ],
};
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
describe("RichTextEditor", () => {
    it("renders a value present on first render and labels the surface", async () => {
        render(_jsx(RichTextEditor, { field: field, value: storedDocument, onChange: vi.fn() }));
        await waitFor(() => {
            expect(screen.getByText("저장된 제목")).toBeTruthy();
            expect(screen.getByText("저장된 본문")).toBeTruthy();
        });
        const surface = document.querySelector('[contenteditable]');
        expect(surface?.getAttribute("aria-label")).toBe("본문");
    });
    it("shows a value that arrives after the first render", async () => {
        // The document query resolves after mount, so the editor is created with an
        // empty value and must pick the loaded content up.
        function Host() {
            const [value, setValue] = useState({ format: "xecms.rich-text", formatVersion: 2, content: [] });
            return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => setValue(storedDocument), children: "load" }), _jsx(RichTextEditor, { field: field, value: value, onChange: vi.fn() })] }));
        }
        render(_jsx(Host, {}));
        screen.getByRole("button", { name: "load" }).click();
        await waitFor(() => {
            expect(screen.getByText("저장된 제목")).toBeTruthy();
            expect(screen.getByText("저장된 본문")).toBeTruthy();
        });
    });
    it("never reports an edit while seeding", async () => {
        // StrictMode mounts twice; a seeding pass that leaked through onChange
        // would wipe the value the form had just loaded (or mark it dirty).
        const onChange = vi.fn();
        render(_jsx(StrictMode, { children: _jsx(RichTextEditor, { field: field, value: storedDocument, onChange: onChange }) }));
        await waitFor(() => expect(screen.getByText("저장된 제목")).toBeTruthy());
        expect(onChange).not.toHaveBeenCalled();
    });
    it("keeps the body when the media list refreshes after an upload", async () => {
        // Uploading invalidates the media query, so mediaItems arrives as a new
        // array. That must not re-seed the editor: everything typed since the last
        // form sync — including the image just inserted — would be wiped.
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
    it("resolves media image blocks through the library and flags missing ids", async () => {
        const value = {
            format: "xecms.rich-text",
            formatVersion: 2,
            content: [
                { id: "blk-1", type: "mediaImage", props: { mediaId: "med_1", alt: "표지" }, children: [] },
                { id: "blk-2", type: "mediaImage", props: { mediaId: "med_gone", alt: "삭제된 그림" }, children: [] },
            ],
        };
        render(_jsx(RichTextEditor, { field: field, value: value, onChange: vi.fn(), mediaItems: [media("med_1")] }));
        await waitFor(() => {
            const resolved = screen.getByAltText("표지");
            expect(resolved.src).toBe("http://host/med_1");
            // The unresolved id renders a visible placeholder, not a broken image.
            expect(screen.getByText(/미디어를 찾을 수 없습니다/)).toBeTruthy();
        });
    });
    it("opens a retired v1 document as empty instead of crashing", async () => {
        // The database can still hold v1 bodies (ProseMirror node trees) written
        // before the BlockNote migration. Feeding those nodes to BlockNote threw
        // ("isInGroup" of undefined) and took the whole document form down.
        const legacyV1 = {
            format: "xecms.rich-text",
            formatVersion: 1,
            content: [
                { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "옛 제목" }] },
                { type: "image", attrs: { mediaId: "med_1" } },
            ],
        };
        function Host() {
            const [value, setValue] = useState({ format: "xecms.rich-text", formatVersion: 2, content: [] });
            return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => setValue(legacyV1), children: "load-legacy" }), _jsx(RichTextEditor, { field: field, value: value, onChange: vi.fn() })] }));
        }
        render(_jsx(Host, {}));
        screen.getByRole("button", { name: "load-legacy" }).click();
        // Renders an (empty) editor surface; the v1 nodes are not representable.
        await waitFor(() => {
            expect(document.querySelector('[contenteditable]')).toBeTruthy();
        });
        expect(screen.queryByText("옛 제목")).toBeNull();
    });
    it("drops unknown block types instead of crashing", async () => {
        const withUnknown = {
            format: "xecms.rich-text",
            formatVersion: 2,
            content: [
                { id: "blk-1", type: "paragraph", props: {}, content: [{ type: "text", text: "살아남는 문단", styles: {} }], children: [] },
                { id: "blk-2", type: "retiredCustomBlock", props: {}, children: [] },
            ],
        };
        render(_jsx(RichTextEditor, { field: field, value: withUnknown, onChange: vi.fn() }));
        await waitFor(() => expect(screen.getByText("살아남는 문단")).toBeTruthy());
    });
    it("re-seeds after the form resets to a reloaded document", async () => {
        // Real sequence: user types (editor emits), the document is saved and the
        // form resets from the server response. The editor must show that value.
        const empty = { format: "xecms.rich-text", formatVersion: 2, content: [] };
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