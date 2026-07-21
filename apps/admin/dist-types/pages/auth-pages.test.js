import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AdminApiProvider } from "@xecms/admin";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SetupPage } from "./auth-pages.js";
function setupApi(ownerExists = false) {
    let status = { required: !ownerExists, templateRequired: true };
    let user = ownerExists ? { id: "owner", username: "owner" } : null;
    const applySetupTemplate = vi.fn(async () => {
        status = { required: false, templateRequired: false };
        return { revisionId: "rev_setup" };
    });
    const api = {
        auth: {
            getBootstrapStatus: vi.fn(async () => status),
            getSession: vi.fn(async () => ({ user, schemaRevisionId: null })),
            bootstrap: vi.fn(async (credentials) => {
                user = { id: "owner", username: credentials.username };
                status = { required: false, templateRequired: true };
                return { user };
            }),
            applySetupTemplate,
        },
    };
    return { api, applySetupTemplate };
}
function renderSetup(api) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(_jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(MemoryRouter, { initialEntries: ["/admin/setup"], children: _jsxs(Routes, { children: [_jsx(Route, { path: "/admin/setup", element: _jsx(SetupPage, {}) }), _jsx(Route, { path: "/admin/schema", element: _jsx("div", { children: "Schema ready" }) }), _jsx(Route, { path: "/admin/login", element: _jsx("div", { children: "Login required" }) })] }) }) }) }));
}
describe("initial setup wizard", () => {
    it("creates the owner, customizes optional modules and applies the selected template", async () => {
        const user = userEvent.setup();
        const { api, applySetupTemplate } = setupApi();
        renderSetup(api);
        await user.type(await screen.findByRole("textbox", { name: /사용자 이름/ }), "owner");
        await user.type(screen.getByLabelText(/^비밀번호\s*\*$/i), "Strong-Owner-Password-2026!");
        await user.type(screen.getByLabelText(/비밀번호 확인/), "Strong-Owner-Password-2026!");
        await user.click(screen.getByRole("button", { name: "관리자 생성 후 계속" }));
        await user.click(await screen.findByRole("button", { name: /블로그/ }));
        await user.click(screen.getByRole("button", { name: "이 템플릿으로 계속" }));
        const categories = screen.getByRole("checkbox", { name: "카테고리" });
        await user.click(categories);
        const postsLabel = screen.getByLabelText("posts 표시 이름");
        await user.clear(postsLabel);
        await user.type(postsLabel, "게시물");
        await user.click(screen.getByRole("button", { name: "구성 확인" }));
        expect(screen.queryByText(/categories ·/)).toBeNull();
        await user.click(screen.getByRole("button", { name: "템플릿 적용하고 시작" }));
        expect(await screen.findByText("Schema ready")).not.toBeNull();
        expect(applySetupTemplate).toHaveBeenCalledWith({
            starter: "blog",
            enabledModuleIds: ["pages"],
            collectionLabels: { col_blog_posts: "게시물", col_blog_pages: "Pages" },
        });
    });
    it("resumes at template selection when an owner exists without an active schema", async () => {
        const { api } = setupApi(true);
        renderSetup(api);
        expect(await screen.findByRole("button", { name: /빈 프로젝트/ })).not.toBeNull();
        expect(screen.queryByLabelText("사용자 이름")).toBeNull();
    });
});
//# sourceMappingURL=auth-pages.test.js.map