import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposedPageEditor } from "./editor.js";
afterEach(cleanup);
function manifest() {
    return {
        format: "xecms.admin-app",
        formatVersion: 2,
        id: "ops",
        name: "Ops",
        key: "ops",
        audience: { type: "system" },
        presentation: { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" },
        navigation: [{ id: "nav_screen", label: "화면", pageId: "pg_screen" }],
        pages: [{
                id: "pg_screen",
                type: "composed-page",
                screenNo: "SCR-001",
                title: "화면",
                menuLabel: "화면",
                layout: { columns: 48, rowHeight: 8 },
                state: [],
                dataSources: [],
                components: [],
                connections: [],
            }],
        startPageId: "pg_screen",
    };
}
describe("ComposedPageEditor", () => {
    it("renders palette, canvas, and mode toggle", () => {
        render(_jsx(ComposedPageEditor, { manifest: manifest(), page: manifest().pages[0], onChange: () => { } }));
        expect(screen.getByRole("application", { name: "화면 편집 캔버스" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "배치" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "연결" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "짧은 텍스트" })).toBeTruthy();
    });
    it("adds a component from the palette into the manifest", async () => {
        const onChange = vi.fn();
        render(_jsx(ComposedPageEditor, { manifest: manifest(), page: manifest().pages[0], onChange: onChange }));
        await userEvent.click(screen.getByRole("button", { name: "짧은 텍스트" }));
        expect(onChange).toHaveBeenCalledTimes(1);
        const next = onChange.mock.calls[0][0];
        const page = next.pages[0];
        expect(page.components).toHaveLength(1);
        expect(page.components[0].kind).toBe("core.input.text");
    });
    it("switches to connect mode and locks the layout palette", async () => {
        render(_jsx(ComposedPageEditor, { manifest: manifest(), page: manifest().pages[0], onChange: () => { } }));
        await userEvent.click(screen.getByRole("tab", { name: "연결" }));
        expect(screen.getByLabelText("전체 연결 보기")).toBeTruthy();
        const palette = screen.getByRole("button", { name: "짧은 텍스트" });
        expect(palette.disabled).toBe(true);
    });
    it("keeps a component selected after clicking it (selection is not cleared on pointerup)", async () => {
        const withComponent = manifest();
        withComponent.pages[0].components = [
            { id: "cmp_input", kind: "core.input.text", placement: { x: 0, y: 0, width: 16, height: 5 }, props: { label: "고객명" } },
        ];
        render(_jsx(ComposedPageEditor, { manifest: withComponent, page: withComponent.pages[0], onChange: () => { } }));
        // Nothing selected yet → inspector shows the empty prompt.
        expect(screen.getByText("Component를 선택하세요.")).toBeTruthy();
        // Click (full press+release) the component cell.
        await userEvent.click(screen.getByRole("group", { name: /core.input.text/ }));
        // The inspector must now show the selected component's editable Label — and stay.
        expect(screen.queryByText("Component를 선택하세요.")).toBeNull();
        expect(screen.getByRole("button", { name: "Component 제거" })).toBeTruthy();
    });
});
//# sourceMappingURL=editor.test.js.map