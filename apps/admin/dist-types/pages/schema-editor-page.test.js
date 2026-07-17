import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider, } from "@xecms/admin";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider } from "../display-mode.js";
import { SchemaEditorPage } from "./schema-editor-page.js";
const contentRealm = {
    realmId: "rlm_community",
    realmKey: "community",
    name: "Community",
    kind: "content",
    status: "provisioning",
    authentication: {
        acceptSystemIdentities: true,
        provisioning: "jit",
        registration: "open",
        defaultRoleIds: ["role_member"],
    },
    revision: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    createdBy: "user_admin",
    updatedAt: "2026-07-15T00:00:00.000Z",
    updatedBy: "user_admin",
};
function collectionFixture(kind = "collection", eligibleIdentifier = true) {
    return {
        id: "col_members",
        name: "members",
        label: "Members",
        kind,
        status: "draft",
        hasPendingChanges: true,
        revisionId: null,
        draftVersion: "draft-1",
        fields: [
            {
                id: "fld_email",
                name: "email",
                label: "Email",
                type: "text",
                required: true,
                ...(eligibleIdentifier ? { unique: true } : {}),
            },
            {
                id: "fld_display_name",
                name: "displayName",
                label: "Display name",
                type: "text",
                required: true,
            },
        ],
    };
}
function renderEditor(input) {
    const collection = input.collection ?? collectionFixture();
    const updateDraft = vi.fn().mockImplementation(async (_collectionId, request) => ({
        ...collection,
        ...request.draft,
        draftVersion: "draft-2",
    }));
    const api = {
        collections: {
            list: vi.fn().mockResolvedValue({
                items: [{
                        id: collection.id,
                        name: collection.name,
                        label: collection.label,
                        status: collection.status,
                        hasPendingChanges: collection.hasPendingChanges,
                        fieldCount: collection.fields.length,
                        revisionId: collection.revisionId,
                    }],
            }),
            get: vi.fn().mockResolvedValue(collection),
            updateDraft,
        },
        identityRealms: {
            list: vi.fn().mockResolvedValue({ items: input.realms ?? [contentRealm] }),
        },
        settings: {
            diagnostics: vi.fn().mockResolvedValue({ schemaMode: "editable" }),
        },
    };
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    const router = createMemoryRouter([
        { path: "/admin/schema/:collectionId", element: _jsx(SchemaEditorPage, {}) },
        { path: "/admin/schema/:collectionId/changes", element: _jsx("h1", { children: "Schema review" }) },
    ], { initialEntries: [`/admin/schema/${collection.id}`] });
    render(_jsx(AdminApiProvider, { api: api, children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(DisplayModeProvider, { initialMode: "advanced", children: _jsx(RouterProvider, { router: router }) }) }) }));
    return { router, updateDraft, user: userEvent.setup() };
}
afterEach(cleanup);
describe("SchemaEditorPage Collection auth", () => {
    it("saves the exact CollectionAuthDefinition contract from a pre-created Content Realm", async () => {
        const { updateDraft, user } = renderEditor({});
        await screen.findByRole("heading", { name: "Members 스키마" });
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        const realmSelect = [...document.querySelectorAll("select")].find((select) => select.querySelector('option[value="community"]') !== null);
        expect(realmSelect).toBeDefined();
        await user.selectOptions(realmSelect, "community");
        await user.click(screen.getByRole("checkbox", { name: "Email · fld_email" }));
        const submit = screen.getByRole("button", { name: "변경 사항 검토" });
        expect(submit.disabled).toBe(false);
        await user.click(submit);
        await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
        const request = updateDraft.mock.calls[0]?.[1];
        expect(request.expectedDraftVersion).toBe("draft-1");
        expect(request.draft.auth).toStrictEqual({
            enabled: true,
            realmKey: "community",
            identifierFieldIds: ["fld_email"],
            acceptSystemIdentities: true,
            provisioning: "jit",
            defaultRoleIds: ["role_member"],
        });
        expect(request.draft.auth).not.toHaveProperty("registration");
        expect(await screen.findByRole("heading", { name: "Schema review" })).toBeTruthy();
    });
    it("immediately explains and blocks auth on a singleton", async () => {
        const { updateDraft, user } = renderEditor({ collection: collectionFixture("singleton") });
        await screen.findByRole("heading", { name: "Members 스키마" });
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        expect(await screen.findByText("싱글턴은 콘텐츠 계정 Profile Collection으로 사용할 수 없습니다.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "변경 사항 검토" }).disabled).toBe(true);
        expect(updateDraft).not.toHaveBeenCalled();
    });
    it("explains and blocks missing Realm and ineligible identifier fields", async () => {
        const { updateDraft, user } = renderEditor({
            collection: collectionFixture("collection", false),
            realms: [],
        });
        await screen.findByRole("heading", { name: "Members 스키마" });
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        expect(await screen.findByText("먼저 Identity Realm 화면에서 Content Realm을 생성해 주세요.")).toBeTruthy();
        expect(screen.getByText("먼저 생성된 Content Realm을 선택해 주세요.")).toBeTruthy();
        expect(screen.getByText("최상위 required + unique text 필드를 저장해 stable ID를 발급한 뒤 identifier로 선택해 주세요.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "변경 사항 검토" }).disabled).toBe(true);
        expect(updateDraft).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=schema-editor-page.test.js.map