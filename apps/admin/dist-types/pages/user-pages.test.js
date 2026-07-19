import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider } from "@xecms/admin";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider } from "../display-mode.js";
import { UserDetailPage } from "./user-pages.js";
function humanIdentity() {
    return {
        identityId: "usr_alice", workspaceId: "wrk_default", kind: "human",
        primaryIdentifier: "alice", originRealmId: "rlm_system", isOwner: false, status: "active",
        credentialVersion: 3, passwordChangeRequired: false, revision: 7,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
        memberships: [
            { membershipId: "mem_1", realmId: "rlm_community", realmKey: "community", realmName: "Community", realmKind: "content", subjectId: "subject:usr_alice:community", status: "active" },
        ],
    };
}
function renderDetail(mode) {
    const api = {
        identities: {
            get: vi.fn().mockResolvedValue(humanIdentity()),
            listSessions: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
            listApiKeys: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
        },
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{ path: "/admin/users/:identityId", element: _jsx(UserDetailPage, {}) }], { initialEntries: ["/admin/users/usr_alice"] });
    render(_jsx(DisplayModeProvider, { initialMode: mode, children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(RouterProvider, { router: router }) }) }) }));
}
afterEach(cleanup);
describe("UserDetailPage display-mode gating", () => {
    it("hides revision/credential-version/subject internals in basic mode", async () => {
        renderDetail("basic");
        expect(await screen.findByText("계정 설정")).toBeTruthy();
        expect(screen.queryByText("Identity revision")).toBeNull();
        expect(screen.queryByText("Credential version")).toBeNull();
        // Membership subject column header is hidden.
        expect(screen.queryByText("권한 대상")).toBeNull();
        // Raw subject id is not rendered.
        expect(screen.queryByText("subject:usr_alice:community")).toBeNull();
        // Essential controls remain available in basic mode.
        expect(screen.getByText("소속")).toBeTruthy();
    });
    it("reveals the same internals in advanced mode", async () => {
        renderDetail("advanced");
        expect(await screen.findByText("계정 설정")).toBeTruthy();
        await waitFor(() => expect(screen.getByText("Identity revision")).toBeTruthy());
        expect(screen.getByText("Credential version")).toBeTruthy();
        expect(screen.getByText("권한 대상")).toBeTruthy();
        expect(screen.getByText("subject:usr_alice:community")).toBeTruthy();
    });
});
//# sourceMappingURL=user-pages.test.js.map