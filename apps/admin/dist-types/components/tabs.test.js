import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabDangerDot } from "./tabs.js";
afterEach(cleanup);
describe("Tabs", () => {
    it("renders an accessible tablist and marks the active tab", () => {
        render(_jsx(Tabs, { ariaLabel: "\uC0C1\uC138 \uC601\uC5ED", active: "members", onChange: () => { }, tabs: [
                { id: "overview", label: "개요" },
                { id: "members", label: "사용자" },
            ] }));
        expect(screen.getByRole("tablist", { name: "상세 영역" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "사용자" }).getAttribute("aria-selected")).toBe("true");
        expect(screen.getByRole("tab", { name: "개요" }).getAttribute("aria-selected")).toBe("false");
    });
    it("calls onChange with the clicked tab id and disables tabs", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(_jsx(Tabs, { ariaLabel: "\uC0C1\uC138 \uC601\uC5ED", active: "overview", onChange: onChange, tabs: [
                { id: "overview", label: "개요" },
                { id: "profile", label: "프로필", disabled: true },
            ] }));
        await user.click(screen.getByRole("tab", { name: "프로필" }));
        expect(onChange).not.toHaveBeenCalled();
        const profile = screen.getByRole("tab", { name: "프로필" });
        expect(profile.disabled).toBe(true);
    });
    it("renders a badge marker inside the tab", () => {
        render(_jsx(Tabs, { ariaLabel: "\uC0C1\uC138 \uC601\uC5ED", active: "access", onChange: () => { }, tabs: [{ id: "access", label: "권한", badge: _jsx(TabDangerDot, { label: "\uC0AC\uC6A9 \uC911" }) }] }));
        expect(screen.getByLabelText("사용 중")).toBeTruthy();
    });
});
//# sourceMappingURL=tabs.test.js.map