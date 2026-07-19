import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@xecms/ui";
import { DisplayModeProvider, ModeChangeNotice, useDisplayMode } from "./display-mode.js";
function Harness() {
    const { mode, setMode } = useDisplayMode();
    return (_jsxs("div", { children: [_jsx("span", { "data-testid": "mode", children: mode }), _jsx(ModeChangeNotice, {}), _jsx(Button, { onPress: () => setMode("standard", { auto: true }), children: "\uC790\uB3D9 \uC0C1\uD5A5" }), _jsx(Button, { onPress: () => setMode("advanced"), children: "\uC218\uB3D9 \uC0C1\uD5A5" })] }));
}
function renderHarness() {
    render(_jsx(DisplayModeProvider, { initialMode: "basic", children: _jsx(Harness, {}) }));
}
afterEach(cleanup);
describe("ModeChangeNotice", () => {
    it("shows a revert banner after an automatic mode raise and undoes it", async () => {
        const user = userEvent.setup();
        renderHarness();
        expect(screen.queryByRole("status")).toBeNull();
        await user.click(screen.getByRole("button", { name: "자동 상향" }));
        expect(screen.getByTestId("mode").textContent).toBe("standard");
        // Banner offers to revert to the previous (basic) mode.
        const revert = screen.getByRole("button", { name: "간단으로 되돌리기" });
        expect(revert).toBeTruthy();
        await user.click(revert);
        expect(screen.getByTestId("mode").textContent).toBe("basic");
        expect(screen.queryByRole("status")).toBeNull();
    });
    it("does not show the banner for a manual mode change", async () => {
        const user = userEvent.setup();
        renderHarness();
        await user.click(screen.getByRole("button", { name: "수동 상향" }));
        expect(screen.getByTestId("mode").textContent).toBe("advanced");
        expect(screen.queryByRole("status")).toBeNull();
    });
    it("clears the banner when the mode is later changed manually", async () => {
        const user = userEvent.setup();
        renderHarness();
        await user.click(screen.getByRole("button", { name: "자동 상향" }));
        expect(screen.getByRole("status")).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "수동 상향" }));
        expect(screen.queryByRole("status")).toBeNull();
    });
});
//# sourceMappingURL=display-mode.notice.test.js.map