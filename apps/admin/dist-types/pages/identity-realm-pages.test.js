import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider, } from "@xecms/admin";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityRealmDetailPage } from "./identity-realm-pages.js";
function contentRealm(overrides = {}) {
    return {
        realmId: "rlm_testre",
        realmKey: "testre",
        name: "Test Realm",
        kind: "content",
        status: "provisioning",
        authentication: {
            acceptSystemIdentities: false,
            provisioning: "explicit",
            registration: "closed",
            defaultRoleIds: [],
        },
        revision: 1,
        ...overrides,
    };
}
function renderDetail(realm) {
    const api = {
        identityRealms: {
            get: vi.fn().mockResolvedValue(realm),
            list: vi.fn().mockResolvedValue({ items: [realm], nextCursor: undefined }),
            listGlobalIdentities: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
            listMemberships: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
            listFullAccess: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
        },
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
            path: "/admin/realms/:realmId",
            element: _jsx(IdentityRealmDetailPage, {}),
        }], { initialEntries: [`/admin/realms/${realm.realmId}`] });
    render(_jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(RouterProvider, { router: router }) }) }));
}
afterEach(cleanup);
describe("IdentityRealmDetailPage provisioning guidance", () => {
    it("tells a provisioning Realm exactly how to activate, naming its Realm Key", async () => {
        renderDetail(contentRealm({ status: "provisioning", realmKey: "testre" }));
        // The activation is a required, explicit next step — not a background wait.
        expect(await screen.findByText(/한 단계가 더 필요합니다/)).toBeTruthy();
        expect(screen.getByText(/기다린다고 저절로 활성화되지는 않습니다/)).toBeTruthy();
        // The Realm Key the user must reference in the Auth Collection is shown
        // inside the activation steps (it also appears in the summary grid).
        const step = screen.getByText(/를 지정합니다/).closest("li");
        expect(step?.textContent).toContain("testre");
        // A direct path to the place where activation actually happens.
        expect(screen.getByRole("button", { name: "스키마 빌더로 이동" })).toBeTruthy();
        // The settings form explains why it is locked instead of just disabling silently.
        expect(screen.getByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeTruthy();
    });
    it("drops the provisioning guidance once the Realm is active", async () => {
        renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }));
        // Wait until the detail view has rendered.
        expect(await screen.findByText("Realm 설정")).toBeTruthy();
        expect(screen.queryByText(/한 단계가 더 필요합니다/)).toBeNull();
        expect(screen.queryByRole("button", { name: "스키마 빌더로 이동" })).toBeNull();
        expect(screen.queryByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeNull();
    });
});
//# sourceMappingURL=identity-realm-pages.test.js.map