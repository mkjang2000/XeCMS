import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider, } from "@xecms/admin";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    let createdCollection;
    const create = vi.fn().mockImplementation(async (draft) => {
        createdCollection = {
            ...draft,
            id: "col_created",
            status: "draft",
            hasPendingChanges: true,
            revisionId: null,
            draftVersion: "draft-created-1",
            fields: draft.fields.map((field, index) => ({
                ...field,
                id: field.id ?? `fld_created_${index + 1}`,
            })),
        };
        return createdCollection;
    });
    const updateDraft = vi.fn().mockImplementation(async (_collectionId, request) => ({
        ...collection,
        ...request.draft,
        draftVersion: "draft-2",
    }));
    const getCollection = vi.fn().mockImplementation(async (collectionId) => createdCollection?.id === collectionId ? createdCollection : collection);
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
            get: getCollection,
            create,
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
        { path: "/admin/schema/new", element: _jsx(SchemaEditorPage, {}) },
        { path: "/admin/schema/:collectionId", element: _jsx(SchemaEditorPage, {}) },
        { path: "/admin/schema/:collectionId/changes", element: _jsx("h1", { children: "Schema review" }) },
    ], { initialEntries: [input.isNew ? "/admin/schema/new" : `/admin/schema/${collection.id}`] });
    render(_jsx(AdminApiProvider, { api: api, children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(DisplayModeProvider, { initialMode: "advanced", children: _jsx(RouterProvider, { router: router }) }) }) }));
    return { create, getCollection, router, updateDraft, user: userEvent.setup() };
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
    it("surfaces why the review button is disabled right next to it", async () => {
        const { user } = renderEditor({ collection: collectionFixture("singleton") });
        await screen.findByRole("heading", { name: "Members 스키마" });
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        // A single, explicit summary tells the operator what to fix before the
        // greyed-out button will engage — no guessing.
        const summary = await screen.findByText("‘변경 사항 검토’를 진행하려면 먼저 아래를 해결해 주세요.");
        const callout = summary.closest("div");
        expect(callout?.textContent).toContain("싱글턴은 콘텐츠 계정 Profile Collection으로 사용할 수 없습니다.");
        expect(screen.getByRole("button", { name: "변경 사항 검토" }).disabled).toBe(true);
    });
    it("breaks the identifier deadlock by saving fields once without auth", async () => {
        // Existing saved fields are not unique, so there is no eligible identifier;
        // the operator adds a new required+unique text field, which has no stable ID
        // yet — the classic deadlock.
        const { updateDraft, user } = renderEditor({ collection: collectionFixture("collection", false) });
        await screen.findByRole("heading", { name: "Members 스키마" });
        await user.click(screen.getByRole("button", { name: "필드 추가" }));
        const newField = screen.getByRole("group", { name: "필드 3" });
        const scoped = within(newField);
        await user.type(scoped.getByRole("textbox", { name: "필드 이름" }), "loginId");
        await user.click(scoped.getByRole("checkbox", { name: "필수 필드" }));
        await user.click(scoped.getByText("유형별 설정과 제약 조건"));
        await user.click(scoped.getByRole("checkbox", { name: "고유 값" }));
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        const realmSelect = [...document.querySelectorAll("select")].find((select) => select.querySelector('option[value="community"]') !== null);
        await user.selectOptions(realmSelect, "community");
        // Instead of a dead-end message, an actionable escape hatch appears.
        const breakButton = await screen.findByRole("button", { name: "필드 먼저 저장하고 ID 발급" });
        await user.click(breakButton);
        // The draft is persisted with auth omitted so the server issues stable IDs.
        await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
        const request = updateDraft.mock.calls[0]?.[1];
        expect(request.draft.auth).toBeUndefined();
    });
    it("moves a newly created draft to its stable URL without an unsaved-changes prompt", async () => {
        const { create, getCollection, router, user } = renderEditor({ isNew: true });
        await screen.findByRole("heading", { name: "새 콘텐츠 타입" });
        await user.type(screen.getByRole("textbox", { name: "이름" }), "members");
        const firstField = screen.getByRole("group", { name: "필드 1" });
        const scoped = within(firstField);
        await user.type(scoped.getByRole("textbox", { name: "필드 이름" }), "loginId");
        await user.click(scoped.getByRole("checkbox", { name: "필수 필드" }));
        await user.click(scoped.getByText("유형별 설정과 제약 조건"));
        await user.click(scoped.getByRole("checkbox", { name: "고유 값" }));
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        const realmSelect = [...document.querySelectorAll("select")].find((select) => select.querySelector('option[value="community"]') !== null);
        await user.selectOptions(realmSelect, "community");
        await user.click(screen.getByRole("button", { name: "필드 먼저 저장하고 ID 발급" }));
        await waitFor(() => expect(router.state.location.pathname).toBe("/admin/schema/col_created"));
        expect(screen.queryByRole("heading", { name: "저장하지 않은 변경 사항" })).toBeNull();
        expect(create).toHaveBeenCalledTimes(1);
        expect(await screen.findByRole("checkbox", { name: "loginId · fld_created_1" })).toBeTruthy();
        await waitFor(() => expect(getCollection).toHaveBeenCalledWith("col_created"));
        await waitFor(() => expect(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }).checked).toBe(true));
    });
    it("explains and blocks missing Realm and ineligible identifier fields", async () => {
        const { updateDraft, user } = renderEditor({
            collection: collectionFixture("collection", false),
            realms: [],
        });
        await screen.findByRole("heading", { name: "Members 스키마" });
        await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
        expect(await screen.findByText("먼저 사용자 공간 관리 화면에서 사용자 공간을 생성해 주세요.")).toBeTruthy();
        expect(screen.getByText("먼저 생성된 사용자 공간을 선택해 주세요.")).toBeTruthy();
        expect(screen.getByText("최상위 required + unique text 필드를 저장해 stable ID를 발급한 뒤 identifier로 선택해 주세요.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "변경 사항 검토" }).disabled).toBe(true);
        expect(updateDraft).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=schema-editor-page.test.js.map