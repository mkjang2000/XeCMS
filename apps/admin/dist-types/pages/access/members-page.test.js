import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider } from "@xecms/admin";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider } from "../../display-mode.js";
import { AccessMembersPage } from "./members-page.js";
import { seedPolicy } from "./test-fixtures.js";
afterEach(cleanup);
function renderPage(policy, authorization = {}) {
    const api = {
        authorization: { getPolicy: vi.fn().mockResolvedValue(policy), ...authorization },
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
            path: "/admin/access/members",
            element: _jsx(AccessMembersPage, {}),
        }], { initialEntries: ["/admin/access/members"] });
    render(_jsx(AdminApiProvider, { api: api, children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(DisplayModeProvider, { initialMode: "basic", children: _jsx(RouterProvider, { router: router }) }) }) }));
    return api.authorization;
}
async function confirmGradeChange(user) {
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "등급 적용" }));
}
describe("AccessMembersPage", () => {
    it("updates an existing simple binding and creates a root-wide binding for an ungraded member", async () => {
        const policy = seedPolicy();
        const next = { ...policy, revision: 8 };
        const updateBinding = vi.fn().mockResolvedValue(next);
        const createBinding = vi.fn().mockResolvedValue(next);
        renderPage(policy, { updateBinding, createBinding });
        const user = userEvent.setup();
        await user.selectOptions(await screen.findByLabelText("Editor Kim 등급"), "level-viewer");
        await confirmGradeChange(user);
        expect(updateBinding).toHaveBeenCalledWith("binding-editor", {
            expectedPolicyRevision: 7,
            subjectId: "subject-editor",
            roleId: "role-viewer",
            resourceId: "root",
            propagation: "self-and-children",
            validFrom: undefined,
            validUntil: undefined,
            constraints: undefined,
        });
        await user.selectOptions(screen.getByLabelText("Newbie 등급"), "level-editor");
        await confirmGradeChange(user);
        expect(createBinding).toHaveBeenCalledWith({
            expectedPolicyRevision: 8,
            subjectId: "subject-new",
            roleId: "role-editor",
            resourceId: "root",
            propagation: "self-and-children",
        });
    });
    it("shows inherited group access as complex and removes the destructive selector", async () => {
        renderPage(seedPolicy());
        const row = await screen.findByRole("article", { name: "Grouped 멤버" });
        expect(within(row).getByText("그룹을 통해 권한을 받고 있어요.")).toBeTruthy();
        expect(within(row).getByRole("button", { name: "표준 모드에서 관리" })).toBeTruthy();
        expect(within(row).queryByRole("combobox")).toBeNull();
    });
    it("excludes protected Owner and Public grades from editable member options", async () => {
        renderPage(seedPolicy());
        const select = await screen.findByLabelText("Editor Kim 등급");
        const options = within(select).getAllByRole("option").map((option) => option.textContent);
        expect(options).not.toContain("Owner");
        expect(options).not.toContain("Public");
        expect(options).toContain("Editors");
        expect(options).toContain("Viewers");
    });
});
//# sourceMappingURL=members-page.test.js.map