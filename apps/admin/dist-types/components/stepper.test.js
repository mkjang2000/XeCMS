import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Checklist } from "./stepper.js";
afterEach(cleanup);
describe("Checklist", () => {
    it("renders each step with its status badge and marker", () => {
        render(_jsx(Checklist, { title: "\uC124\uC815 \uC9C4\uD589 \uC0C1\uD0DC", steps: [
                { id: "activate", label: "스키마·활성화", status: "done" },
                { id: "owner", label: "소유자 지정", status: "current" },
                { id: "admin", label: "관리자 지정", status: "blocked", description: "먼저 소속이 필요합니다." },
                { id: "access", label: "권한 설정", status: "todo" },
            ] }));
        expect(screen.getByText("설정 진행 상태")).toBeTruthy();
        expect(screen.getByText("완료")).toBeTruthy();
        expect(screen.getByText("진행할 차례")).toBeTruthy();
        expect(screen.getByText("먼저 필요")).toBeTruthy();
        expect(screen.getByText("대기")).toBeTruthy();
        expect(screen.getByText("먼저 소속이 필요합니다.")).toBeTruthy();
    });
    it("exposes step status on the list item for styling", () => {
        const { container } = render(_jsx(Checklist, { steps: [{ id: "a", label: "A", status: "current" }] }));
        expect(container.querySelector('[data-status="current"]')).toBeTruthy();
    });
    it("renders an action node when provided", () => {
        render(_jsx(Checklist, { steps: [{ id: "a", label: "A", status: "current", action: _jsx("button", { type: "button", children: "\uC774\uB3D9" }) }] }));
        expect(screen.getByRole("button", { name: "이동" })).toBeTruthy();
    });
});
//# sourceMappingURL=stepper.test.js.map