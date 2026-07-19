import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider, AdminApiError, } from "@xecms/admin";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider } from "../display-mode.js";
import { IdentityRealmDetailPage, IdentityRealmListPage, RealmEntitlementMatrixPage } from "./identity-realm-pages.js";
Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
});
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
const profileCollection = {
    id: "col_profile",
    name: "testreAccounts",
    label: "Test Realm Accounts",
    status: "applied",
    hasPendingChanges: false,
    revisionId: "rev_profile",
    draftVersion: "rev:rev_profile",
    auth: {
        enabled: true,
        realmKey: "testre",
        identifierFieldIds: ["fld_login_id"],
        acceptSystemIdentities: false,
        provisioning: "explicit",
        defaultRoleIds: [],
    },
    fields: [
        { id: "fld_login_id", name: "loginId", label: "Login ID", type: "text", required: true, unique: true },
        { id: "fld_display_name", name: "displayName", label: "Display name", type: "text", required: false },
    ],
};
function renderDetail(realm, memberships = [], mode = "basic", ownerStatus = { realmId: "rlm_testre", status: "ownerless", policyRevision: 1 }) {
    const registerMembership = vi.fn().mockResolvedValue({});
    const grantRealmAdministrator = vi.fn().mockResolvedValue({});
    const createProfileSchema = vi.fn().mockResolvedValue({
        ...realm,
        status: "active",
        profileCollectionId: "col_profile",
    });
    const createProfileField = vi.fn().mockResolvedValue(realm);
    const listFullAccess = vi.fn().mockResolvedValue({ items: [] });
    const grantFullAccess = vi.fn().mockResolvedValue({});
    const revokeFullAccess = vi.fn().mockResolvedValue({});
    const listCollectionEntitlements = vi.fn().mockResolvedValue({ status: null, entitlements: [] });
    const putCollectionEntitlement = vi.fn().mockResolvedValue({
        workspaceId: "wrk_default",
        realmId: realm.realmId,
        collectionId: "col_profile",
        actions: ["list", "read"],
        revision: 1,
        updatedAt: "2026-07-19T00:00:00.000Z",
        updatedBy: "usr_admin",
    });
    const deleteCollectionEntitlement = vi.fn().mockResolvedValue(undefined);
    const otherRealm = contentRealm({ realmId: "rlm_portal", realmKey: "portal", name: "업무포털", status: "active", profileCollectionId: "col_portal_auth" });
    const listManagementDelegations = vi.fn().mockResolvedValue({ managingRealmId: realm.realmId, delegations: [] });
    const listManagedByDelegations = vi.fn().mockResolvedValue({ managedRealmId: realm.realmId, delegations: [] });
    const putManagementDelegation = vi.fn().mockResolvedValue({
        workspaceId: "wrk_default",
        managingRealmId: realm.realmId,
        managedRealmId: "rlm_portal",
        actions: ["identity.credentials.reset"],
        scopeByAction: { "identity.credentials.reset": "any" },
        revision: 1,
        updatedAt: "2026-07-19T00:00:00.000Z",
        updatedBy: "usr_admin",
    });
    const deleteManagementDelegation = vi.fn().mockResolvedValue(undefined);
    const getOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, ...ownerStatus });
    const assignOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "healthy", policyRevision: 2 });
    const transferOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "healthy", policyRevision: 2 });
    const recoverOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "healthy", policyRevision: 2 });
    const globalIdentities = memberships.flatMap((item) => {
        const identity = item.identity;
        return identity === undefined ? [] : [identity];
    });
    const api = {
        identityRealms: {
            get: vi.fn().mockResolvedValue(realm),
            list: vi.fn().mockResolvedValue({ items: [realm, otherRealm], nextCursor: undefined }),
            listGlobalIdentities: vi.fn().mockResolvedValue({ items: globalIdentities, nextCursor: undefined }),
            listMemberships: vi.fn().mockResolvedValue({ items: memberships, nextCursor: undefined }),
            listFullAccess,
            grantFullAccess,
            revokeFullAccess,
            listCollectionEntitlements,
            putCollectionEntitlement,
            deleteCollectionEntitlement,
            listManagementDelegations,
            listManagedByDelegations,
            putManagementDelegation,
            deleteManagementDelegation,
            getOwner,
            assignOwner,
            transferOwner,
            recoverOwner,
            createProfileSchema,
            createProfileField,
            registerMembership,
            grantRealmAdministrator,
        },
        collections: {
            getApplied: vi.fn().mockResolvedValue(profileCollection),
            list: vi.fn().mockResolvedValue({
                items: [
                    { id: "col_profile", name: "testreAccounts", label: "Test Realm Accounts", status: "applied", hasPendingChanges: false, fieldCount: 2, revisionId: "rev_profile" },
                    { id: "col_articles", name: "articles", label: "Articles", status: "applied", hasPendingChanges: false, fieldCount: 3, revisionId: "rev_a" },
                    { id: "col_portal_auth", name: "portalAccounts", label: "Portal Accounts", status: "applied", hasPendingChanges: false, fieldCount: 2, revisionId: "rev_portal" },
                ],
            }),
        },
        settings: {
            diagnostics: vi.fn().mockResolvedValue({ schemaMode: "editable" }),
        },
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([
        { path: "/admin/realms/:realmId", element: _jsx(IdentityRealmDetailPage, {}) },
        { path: "/admin/realms/:realmId/access/grades", element: _jsx("div", { children: "Realm \uB4F1\uAE09 \uD654\uBA74" }) },
        { path: "/admin/realms/:realmId/access/roles", element: _jsx("div", { children: "Realm \uC5ED\uD560 \uD654\uBA74" }) },
    ], { initialEntries: [`/admin/realms/${realm.realmId}`] });
    render(_jsx(DisplayModeProvider, { initialMode: mode, children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(RouterProvider, { router: router }) }) }) }));
    return { createProfileSchema, createProfileField, registerMembership, grantRealmAdministrator, getOwner, listFullAccess, grantFullAccess, listCollectionEntitlements, putCollectionEntitlement, deleteCollectionEntitlement, listManagementDelegations, putManagementDelegation, deleteManagementDelegation, assignOwner, router, user: userEvent.setup() };
}
afterEach(cleanup);
describe("IdentityRealmDetailPage provisioning guidance", () => {
    it("creates the provisioning Realm's Profile Schema with a directly entered login field name", async () => {
        const { createProfileSchema, user } = renderDetail(contentRealm({ status: "provisioning", realmKey: "testre" }));
        expect(await screen.findByText("설정 진행 상태")).toBeTruthy();
        expect(screen.getByText("1. 스키마 연결 · 활성화")).toBeTruthy();
        expect(screen.getByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "기본 인증 스키마 생성" }));
        const dialog = await screen.findByRole("dialog");
        const identifierField = within(dialog).getByRole("textbox", { name: "로그인 ID 필드명" });
        expect(identifierField.value).toBe("loginId");
        await user.clear(identifierField);
        await user.type(identifierField, "memberEmail");
        await user.click(within(dialog).getByRole("button", { name: "생성하고 사용자 공간 활성화" }));
        await waitFor(() => expect(createProfileSchema).toHaveBeenCalledTimes(1));
        expect(createProfileSchema).toHaveBeenCalledWith("rlm_testre", {
            collectionName: "testreAccounts",
            collectionLabel: "Test Realm Accounts",
            identifierFieldName: "memberEmail",
            includeDisplayName: true,
        });
    });
    it("creates a new user and assigns it to an active Realm", async () => {
        const { registerMembership, user } = renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }));
        await user.click(await screen.findByRole("tab", { name: "사용자" }));
        await user.click(await screen.findByRole("button", { name: "새 사용자" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("heading", { name: "새 사용자 만들어 연결" })).toBeTruthy();
        await user.type(within(dialog).getByRole("textbox", { name: "로그인 identifier" }), "new.user@example.com");
        // Required fields render a "*" inside the label, so match on a prefix.
        await user.type(within(dialog).getByLabelText(/초기 비밀번호/), "new-user-initial-pw");
        await user.type(within(dialog).getByLabelText(/현재 관리자 비밀번호/), "admin-pw");
        await user.click(within(dialog).getByRole("button", { name: "새 사용자 생성 후 연결" }));
        await waitFor(() => expect(registerMembership).toHaveBeenCalledTimes(1));
        expect(registerMembership).toHaveBeenCalledWith("rlm_testre", expect.objectContaining({
            identifier: "new.user@example.com",
            password: "new-user-initial-pw",
            reauthPassword: "admin-pw",
            profile: {},
        }));
    });
    it("shows the protected login field and adds a safe optional Profile field", async () => {
        const { createProfileField, user } = renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }));
        await user.click(await screen.findByRole("tab", { name: "프로필 필드" }));
        expect(await screen.findByRole("heading", { name: "사용자 프로필 필드" })).toBeTruthy();
        expect(await screen.findByText("로그인 ID · 보호됨")).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "프로필 필드 추가" }));
        const dialog = await screen.findByRole("dialog");
        await user.type(within(dialog).getByRole("textbox", { name: "필드명" }), "nickname");
        await user.type(within(dialog).getByRole("textbox", { name: "표시 이름" }), "닉네임");
        await user.click(within(dialog).getByRole("button", { name: "필드 추가하고 적용" }));
        await waitFor(() => expect(createProfileField).toHaveBeenCalledTimes(1));
        expect(createProfileField).toHaveBeenCalledWith("rlm_testre", {
            name: "nickname",
            label: "닉네임",
            type: "text",
        });
    });
    it("promotes an active member to Realm administrator via re-authentication", async () => {
        const membership = {
            membershipId: "mem_1",
            globalIdentityId: "gid_1",
            realmId: "rlm_testre",
            subjectId: "subject:user:gid_1",
            status: "active",
            provisionedBy: "signup",
            revision: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            identity: { globalIdentityId: "gid_1", primaryIdentifier: "member@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        };
        const { grantRealmAdministrator, getOwner, user } = renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }), [membership]);
        await user.click(await screen.findByRole("tab", { name: "사용자" }));
        await waitFor(() => expect(getOwner).toHaveBeenCalledTimes(1));
        const promoteButton = await screen.findByRole("button", { name: "관리자로 지정" });
        await user.click(promoteButton);
        // A re-authentication dialog gates the promotion.
        const dialog = await screen.findByRole("dialog");
        await user.type(within(dialog).getByLabelText(/현재 관리자 비밀번호/), "admin-pw");
        await user.click(within(dialog).getByRole("button", { name: "관리자로 지정" }));
        await waitFor(() => expect(grantRealmAdministrator).toHaveBeenCalledTimes(1));
        expect(grantRealmAdministrator).toHaveBeenCalledWith("rlm_testre", "mem_1", { reauthPassword: "admin-pw" });
        // The promotion advances the policy revision, so the Owner status (and its
        // cached policyRevision used by the Owner-assign CAS) must be refetched.
        await waitFor(() => expect(getOwner).toHaveBeenCalledTimes(2));
    });
    it("marks administrator/owner members with a badge and hides the promote button", async () => {
        const adminMember = {
            membershipId: "mem_admin", globalIdentityId: "gid_admin", realmId: "rlm_testre",
            subjectId: "subject:user:gid_admin", status: "active", provisionedBy: "account-link", revision: 2,
            createdAt: "2026-01-01T00:00:00.000Z", realmAdministrator: true,
            identity: { globalIdentityId: "gid_admin", kind: "human", primaryIdentifier: "admin@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        };
        const ownerMember = {
            membershipId: "mem_owner", globalIdentityId: "gid_owner", realmId: "rlm_testre",
            subjectId: "subject:user:gid_owner", status: "active", provisionedBy: "account-link", revision: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            identity: { globalIdentityId: "gid_owner", kind: "human", primaryIdentifier: "owner@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        };
        const plainMember = {
            membershipId: "mem_plain", globalIdentityId: "gid_plain", realmId: "rlm_testre",
            subjectId: "subject:user:gid_plain", status: "active", provisionedBy: "signup", revision: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            identity: { globalIdentityId: "gid_plain", kind: "human", primaryIdentifier: "plain@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        };
        const { user } = renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }), [ownerMember, adminMember, plainMember], "basic", { status: "healthy", policyRevision: 3, owner: { globalIdentityId: "gid_owner", membershipId: "mem_owner", subjectId: "subject:user:gid_owner", primaryIdentifier: "owner@example.com", identityActive: true, membershipStatus: "active" } });
        await user.click(await screen.findByRole("tab", { name: "사용자" }));
        await screen.findByText("admin@example.com");
        // Role badges are shown for owner and administrator rows.
        expect(screen.getByText("소유자")).toBeTruthy();
        expect(screen.getByText("관리자")).toBeTruthy();
        // The promote button appears only for the plain member — one, not three.
        expect(screen.getAllByRole("button", { name: "관리자로 지정" })).toHaveLength(1);
    });
    it("assigns an active System operator as the first human Realm Owner", async () => {
        const membership = {
            membershipId: "mem_owner_candidate",
            globalIdentityId: "gid_owner_candidate",
            realmId: "rlm_testre",
            subjectId: "subject:user:gid_owner_candidate",
            status: "active",
            provisionedBy: "account-link",
            revision: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            identity: { globalIdentityId: "gid_owner_candidate", kind: "human", primaryIdentifier: "realm.owner@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        };
        const { assignOwner, user } = renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }), [membership]);
        await user.click(await screen.findByRole("tab", { name: "사용자" }));
        await user.click(await screen.findByRole("button", { name: "소유자 지정" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByLabelText("새 사용자 공간 소유자"));
        await user.click(await screen.findByRole("option", { name: /realm\.owner@example\.com/ }));
        await user.type(within(dialog).getByLabelText(/변경 사유/), "Initial Realm owner");
        await user.type(within(dialog).getByLabelText(/현재 System 계정 비밀번호/), "admin-pw");
        await user.click(within(dialog).getByRole("button", { name: "소유자 지정" }));
        await waitFor(() => expect(assignOwner).toHaveBeenCalledTimes(1));
        expect(assignOwner).toHaveBeenCalledWith("rlm_testre", {
            targetMembershipId: "mem_owner_candidate",
            expectedPolicyRevision: 1,
            reason: "Initial Realm owner",
            password: "admin-pw",
        });
    });
    it("drops the provisioning guidance once the Realm is active", async () => {
        renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }));
        // Wait until the detail view has rendered.
        expect(await screen.findByText("사용자 공간 설정")).toBeTruthy();
        // Active realm: the activation step is complete, so its setup CTA is gone.
        expect(screen.queryByRole("button", { name: "기본 인증 스키마 생성" })).toBeNull();
        expect(screen.queryByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeNull();
    });
    it("previews the bootstrap deadlock: warns to appoint an administrator once an Owner exists", async () => {
        // active + healthy owner + no administrator membership → administrator step is current.
        renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }), [], "basic", { status: "healthy", policyRevision: 3, owner: { globalIdentityId: "gid_o", membershipId: "mem_o", subjectId: "s_o", primaryIdentifier: "owner@example.com", identityActive: true, membershipStatus: "active" } });
        expect(await screen.findByText("설정 진행 상태")).toBeTruthy();
        // Preventive deadlock guidance appears on the detail page, before the operator is bounced.
        expect(await screen.findByText(/만든 본인은 권한 화면에 들어갈 수 없습니다/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "관리자 지정하러 가기" })).toBeTruthy();
    });
    it("hides the checklist once setup is complete (owner + administrator)", async () => {
        const adminMembership = {
            membershipId: "mem_admin", globalIdentityId: "gid_admin", realmId: "rlm_testre",
            subjectId: "subj_admin", status: "active", provisionedBy: "account-link", revision: 1,
            createdAt: "2026-01-01T00:00:00.000Z", realmAdministrator: true,
            identity: { globalIdentityId: "gid_admin", kind: "human", primaryIdentifier: "admin@example.com", originRealmId: "rlm_system", credentialVersion: 1 },
        };
        renderDetail(contentRealm({ status: "active", profileCollectionId: "col_profile" }), [adminMembership], "basic", { status: "healthy", policyRevision: 3, owner: { globalIdentityId: "gid_admin", membershipId: "mem_admin", subjectId: "subj_admin", primaryIdentifier: "admin@example.com", identityActive: true, membershipStatus: "active" } });
        expect(await screen.findByText("사용자 공간 설정")).toBeTruthy();
        await waitFor(() => expect(screen.queryByText("설정 진행 상태")).toBeNull());
    });
});
describe("IdentityRealmDetailPage 표시 모드", () => {
    const activeRealm = contentRealm({ status: "active", profileCollectionId: "col_profile" });
    it("keeps basic mode focused and routes Realm authorization to grades", async () => {
        const { listFullAccess, router, user } = renderDetail(activeRealm, [], "basic");
        await screen.findByText("사용자 공간 설정");
        expect(screen.queryByLabelText("초기 Profile JSON")).toBeNull();
        expect(screen.queryByRole("heading", { name: "사용자 공간 Full Access" })).toBeNull();
        await waitFor(() => expect(listFullAccess).toHaveBeenCalledWith("rlm_testre"));
        await user.click(screen.getByRole("tab", { name: "권한" }));
        await user.click(screen.getByRole("button", { name: "사용자 공간 권한 관리" }));
        await waitFor(() => expect(router.state.location.pathname).toBe("/admin/realms/rlm_testre/access/grades"));
    });
    it("shows profile JSON in standard mode and routes authorization to roles", async () => {
        const { listFullAccess, router, user } = renderDetail(activeRealm, [], "standard");
        await user.click(await screen.findByRole("tab", { name: "사용자" }));
        expect(screen.queryByLabelText("초기 Profile JSON")).toBeNull();
        await user.click(screen.getByRole("button", { name: "새 사용자" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByText("초기 Profile JSON", { selector: "summary" }));
        expect(within(dialog).getByLabelText("초기 Profile JSON")).toBeTruthy();
        await user.click(within(dialog).getByRole("button", { name: "취소" }));
        expect(screen.queryByRole("heading", { name: "사용자 공간 Full Access" })).toBeNull();
        await waitFor(() => expect(listFullAccess).toHaveBeenCalledWith("rlm_testre"));
        await user.click(screen.getByRole("tab", { name: "권한" }));
        await user.click(screen.getByRole("button", { name: "사용자 공간 권한 관리" }));
        await waitFor(() => expect(router.state.location.pathname).toBe("/admin/realms/rlm_testre/access/roles"));
    });
    it("shows Full Access in every display mode while keeping history advanced", async () => {
        const { listFullAccess, user } = renderDetail(activeRealm, [], "advanced");
        await user.click(await screen.findByRole("tab", { name: "권한" }));
        expect(await screen.findByRole("heading", { name: "사용자 공간 Full Access" })).toBeTruthy();
        expect(listFullAccess).toHaveBeenCalledWith("rlm_testre");
    });
    it("sets a collection access ceiling from the access tab", async () => {
        const { listCollectionEntitlements, putCollectionEntitlement, user } = renderDetail(activeRealm, [], "basic");
        await user.click(await screen.findByRole("tab", { name: "권한" }));
        expect(await screen.findByRole("heading", { name: "접근 가능한 콘텐츠" })).toBeTruthy();
        expect(listCollectionEntitlements).toHaveBeenCalledWith("rlm_testre");
        // A collection with no ceiling row reads as not-accessed (fail-closed).
        expect(await screen.findByText("접근 안 함")).toBeTruthy();
        await user.click(await screen.findByRole("button", { name: "허용 설정" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("checkbox", { name: /조회/ }));
        await user.type(within(dialog).getByLabelText(/현재 System 계정 비밀번호/), "admin-pw");
        await user.click(within(dialog).getByRole("button", { name: "허용" }));
        await waitFor(() => expect(putCollectionEntitlement).toHaveBeenCalledTimes(1));
        expect(putCollectionEntitlement).toHaveBeenCalledWith("rlm_testre", "col_articles", {
            actions: ["list", "read"],
            expectedRevision: null,
            password: "admin-pw",
        });
    });
    it("marks the realm's own Auth collection as always allowed and non-editable", async () => {
        const { putCollectionEntitlement, user } = renderDetail(activeRealm, [], "basic");
        await user.click(await screen.findByRole("tab", { name: "권한" }));
        // The Auth (profile) collection row is guaranteed access, not a ceiling to edit.
        const authRow = (await screen.findByText("Test Realm Accounts")).closest("tr");
        expect(authRow).not.toBeNull();
        expect(within(authRow).getByText("항상 허용")).toBeTruthy();
        expect(within(authRow).queryByRole("button", { name: "허용 설정" })).toBeNull();
        expect(within(authRow).queryByRole("button", { name: "제거" })).toBeNull();
        expect(putCollectionEntitlement).not.toHaveBeenCalled();
    });
    it("blocks exposing another realm's Auth collection through a ceiling", async () => {
        const { user } = renderDetail(activeRealm, [], "basic");
        await user.click(await screen.findByRole("tab", { name: "권한" }));
        // The portal realm's Auth collection appears but is closed, not editable.
        const foreignRow = (await screen.findByText("Portal Accounts")).closest("tr");
        expect(within(foreignRow).getByText("다른 공간 인증 스키마")).toBeTruthy();
        expect(within(foreignRow).getByText("접근 불가")).toBeTruthy();
        expect(within(foreignRow).queryByRole("button", { name: "허용 설정" })).toBeNull();
    });
    it("delegates cross-realm user management from the access tab (advanced)", async () => {
        const { listManagementDelegations, putManagementDelegation, user } = renderDetail(activeRealm, [], "advanced");
        await user.click(await screen.findByRole("tab", { name: "권한" }));
        expect(await screen.findByRole("heading", { name: "다른 공간 사용자 관리 위임" })).toBeTruthy();
        expect(listManagementDelegations).toHaveBeenCalledWith("rlm_testre");
        // The other content realm appears as a delegation target with no delegation yet.
        const targetRow = (await screen.findByText("업무포털")).closest("tr");
        expect(within(targetRow).getByText("위임 없음")).toBeTruthy();
        await user.click(within(targetRow).getByRole("button", { name: "위임 설정" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("checkbox", { name: /비밀번호 재설정/ }));
        await user.type(within(dialog).getByLabelText(/현재 System 계정 비밀번호/), "admin-pw");
        await user.click(within(dialog).getByRole("button", { name: "위임" }));
        await waitFor(() => expect(putManagementDelegation).toHaveBeenCalledTimes(1));
        expect(putManagementDelegation).toHaveBeenCalledWith("rlm_testre", "rlm_portal", {
            actions: ["identity.credentials.reset"],
            scopeByAction: { "identity.credentials.reset": "all" },
            expectedRevision: null,
            password: "admin-pw",
        });
    });
    it("starts Full Access for the current System Identity without a Realm Subject", async () => {
        const { grantFullAccess, user } = renderDetail(activeRealm, [], "basic");
        await user.click(await screen.findByRole("tab", { name: "권한" }));
        await user.click(await screen.findByRole("button", { name: "Full Access 시작" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByLabelText(/대상 Realm Subject/)).toBeNull();
        await user.type(within(dialog).getByLabelText(/접근 사유/), "Owner policy recovery");
        await user.type(within(dialog).getByLabelText(/현재 System 계정 비밀번호/), "admin-pw");
        await user.click(within(dialog).getByRole("button", { name: "Full Access 시작" }));
        await waitFor(() => expect(grantFullAccess).toHaveBeenCalledTimes(1));
        expect(grantFullAccess).toHaveBeenCalledWith("rlm_testre", {
            reason: "Owner policy recovery",
            password: "admin-pw",
            validUntil: expect.any(String),
        });
    });
});
describe("Realm 권한 부트스트랩 안내 (목록·상세)", () => {
    const denied = new AdminApiError({
        status: 403,
        code: "AUTHORIZATION_DENIED",
        message: "Authorization denied: NO_PERMISSION.",
        details: { decision: { reasonCode: "NO_PERMISSION" } },
    });
    it("guides the operator when the Realm list itself is denied", async () => {
        const api = {
            identityRealms: { list: vi.fn().mockRejectedValue(denied) },
        };
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const router = createMemoryRouter([{
                path: "/admin/realms",
                element: _jsx(IdentityRealmListPage, {}),
            }], { initialEntries: ["/admin/realms"] });
        render(_jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(RouterProvider, { router: router }) }) }));
        expect(await screen.findByText(/사용자 공간을 관리할 권한이 없습니다/)).toBeTruthy();
        // The raw English server message must not leak.
        expect(screen.queryByText(/Authorization denied/)).toBeNull();
    });
    it("guides the operator back to the list when a Realm detail is denied", async () => {
        const api = {
            identityRealms: {
                get: vi.fn().mockRejectedValue(denied),
                list: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
                listGlobalIdentities: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
                listMemberships: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
                listFullAccess: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
            },
        };
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const router = createMemoryRouter([{
                path: "/admin/realms/:realmId",
                element: _jsx(IdentityRealmDetailPage, {}),
            }], { initialEntries: ["/admin/realms/rlm_testre"] });
        render(_jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(RouterProvider, { router: router }) }) }));
        expect(await screen.findByText(/이 사용자 공간을 관리할 권한이 없습니다/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "사용자 공간 목록으로" })).toBeTruthy();
    });
});
describe("RealmEntitlementMatrixPage", () => {
    function renderMatrix() {
        const listRealms = vi.fn().mockResolvedValue({
            items: [
                { realmId: "rlm_sys", realmKey: "system", name: "System", kind: "system", status: "active", authentication: { acceptSystemIdentities: true, provisioning: "explicit", registration: "closed", defaultRoleIds: [] }, revision: 1 },
                { realmId: "rlm_a", realmKey: "a", name: "공간 A", kind: "content", status: "active", profileCollectionId: "col_a_auth", authentication: { acceptSystemIdentities: false, provisioning: "jit", registration: "open", defaultRoleIds: [] }, revision: 1 },
                { realmId: "rlm_b", realmKey: "b", name: "공간 B", kind: "content", status: "active", authentication: { acceptSystemIdentities: false, provisioning: "jit", registration: "open", defaultRoleIds: [] }, revision: 1 },
            ],
        });
        const listCollections = vi.fn().mockResolvedValue({
            items: [
                { id: "col_articles", name: "articles", label: "Articles", status: "applied", hasPendingChanges: false, fieldCount: 3, revisionId: "rev_a" },
                { id: "col_a_auth", name: "aAccounts", label: "A Accounts", status: "applied", hasPendingChanges: false, fieldCount: 2, revisionId: "rev_auth" },
            ],
        });
        const listEntitlementsForCollection = vi.fn(async (collectionId) => {
            if (collectionId === "col_articles") {
                return {
                    collectionId,
                    entitlements: [
                        { workspaceId: "wrk", realmId: "rlm_a", collectionId, actions: ["list", "read"], revision: 1, updatedAt: "2026-07-19T00:00:00.000Z", updatedBy: "cms" },
                    ],
                };
            }
            return { collectionId, entitlements: [] };
        });
        const api = {
            identityRealms: { list: listRealms, listEntitlementsForCollection },
            collections: { list: listCollections },
        };
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const router = createMemoryRouter([
            { path: "/admin/realms/entitlements", element: _jsx(RealmEntitlementMatrixPage, {}) },
            { path: "/admin/realms/:realmId", element: _jsx("div", { children: "\uACF5\uAC04 \uC0C1\uC138" }) },
            { path: "/admin/realms", element: _jsx("div", { children: "\uACF5\uAC04 \uBAA9\uB85D" }) },
        ], { initialEntries: ["/admin/realms/entitlements"] });
        render(_jsx(DisplayModeProvider, { initialMode: "advanced", children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(AdminApiProvider, { api: api, children: _jsx(RouterProvider, { router: router }) }) }) }));
        return { listEntitlementsForCollection };
    }
    it("renders a collection × content-realm matrix and marks each cell's access", async () => {
        const { listEntitlementsForCollection } = renderMatrix();
        // Content realms are columns; the System realm is excluded.
        expect(await screen.findByRole("link", { name: "공간 A" })).toBeTruthy();
        expect(screen.getByRole("link", { name: "공간 B" })).toBeTruthy();
        expect(screen.queryByText("System")).toBeNull();
        // One reverse request per collection.
        expect(listEntitlementsForCollection).toHaveBeenCalledWith("col_articles");
        expect(listEntitlementsForCollection).toHaveBeenCalledWith("col_a_auth");
        // Articles row: A has a read ceiling, B has none.
        const articlesRow = (await screen.findByText("Articles")).closest("tr");
        expect(within(articlesRow).getByText(/조회/)).toBeTruthy();
        expect(within(articlesRow).getByText("접근 안 함")).toBeTruthy();
        // A Accounts is A's own Auth collection → guaranteed for A only.
        const authRow = (await screen.findByText("A Accounts")).closest("tr");
        expect(within(authRow).getByText("항상 허용")).toBeTruthy();
        // B cannot access another realm's Auth collection at all → blocked.
        expect(within(authRow).getByText("접근 불가")).toBeTruthy();
    });
});
//# sourceMappingURL=identity-realm-pages.test.js.map