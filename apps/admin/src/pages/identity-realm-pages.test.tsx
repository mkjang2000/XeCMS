// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  AdminApiError,
  type AdminApi,
  type CollectionDetail,
  type IdentityRealm,
} from "@xecms/admin";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider, type DisplayMode } from "../display-mode.js";
import { IdentityRealmDetailPage, IdentityRealmListPage } from "./identity-realm-pages.js";

Object.defineProperty(globalThis, "CSS", {
  configurable: true,
  value: { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
});

function contentRealm(overrides: Partial<IdentityRealm> = {}): IdentityRealm {
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

const profileCollection: CollectionDetail = {
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

function renderDetail(realm: IdentityRealm, memberships: readonly unknown[] = [], mode: DisplayMode = "basic") {
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
  const getOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "ownerless", policyRevision: 1 });
  const assignOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "healthy", policyRevision: 2 });
  const transferOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "healthy", policyRevision: 2 });
  const recoverOwner = vi.fn().mockResolvedValue({ realmId: realm.realmId, status: "healthy", policyRevision: 2 });
  const globalIdentities = memberships.flatMap((item) => {
    const identity = (item as { readonly identity?: unknown }).identity;
    return identity === undefined ? [] : [identity];
  });
  const api = {
    identityRealms: {
      get: vi.fn().mockResolvedValue(realm),
      list: vi.fn().mockResolvedValue({ items: [realm], nextCursor: undefined }),
      listGlobalIdentities: vi.fn().mockResolvedValue({ items: globalIdentities, nextCursor: undefined }),
      listMemberships: vi.fn().mockResolvedValue({ items: memberships, nextCursor: undefined }),
      listFullAccess,
      grantFullAccess,
      revokeFullAccess,
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
    },
    settings: {
      diagnostics: vi.fn().mockResolvedValue({ schemaMode: "editable" }),
    },
  } as unknown as AdminApi;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([
    { path: "/admin/realms/:realmId", element: <IdentityRealmDetailPage /> },
    { path: "/admin/realms/:realmId/access/grades", element: <div>Realm 등급 화면</div> },
    { path: "/admin/realms/:realmId/access/roles", element: <div>Realm 역할 화면</div> },
  ], { initialEntries: [`/admin/realms/${realm.realmId}`] });
  render(
    <DisplayModeProvider initialMode={mode}>
      <QueryClientProvider client={queryClient}>
        <AdminApiProvider api={api}>
          <RouterProvider router={router} />
        </AdminApiProvider>
      </QueryClientProvider>
    </DisplayModeProvider>,
  );
  return { createProfileSchema, createProfileField, registerMembership, grantRealmAdministrator, getOwner, listFullAccess, grantFullAccess, assignOwner, router, user: userEvent.setup() };
}

afterEach(cleanup);

describe("IdentityRealmDetailPage provisioning guidance", () => {
  it("creates the provisioning Realm's Profile Schema with a directly entered login field name", async () => {
    const { createProfileSchema, user } = renderDetail(
      contentRealm({ status: "provisioning", realmKey: "testre" }),
    );

    expect(await screen.findByText(/Realm을 바로 활성화할 수 있습니다/)).toBeTruthy();
    expect(screen.getByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "기본 인증 스키마 생성" }));
    const dialog = await screen.findByRole("dialog");
    const identifierField = within(dialog).getByRole("textbox", { name: "로그인 ID 필드명" });
    expect((identifierField as HTMLInputElement).value).toBe("loginId");
    await user.clear(identifierField);
    await user.type(identifierField, "memberEmail");
    await user.click(within(dialog).getByRole("button", { name: "생성하고 Realm 활성화" }));

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
    const { createProfileField, user } = renderDetail(
      contentRealm({ status: "active", profileCollectionId: "col_profile" }),
    );

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
    const { grantRealmAdministrator, getOwner, user } = renderDetail(
      contentRealm({ status: "active", profileCollectionId: "col_profile" }),
      [membership],
    );

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
    const { assignOwner, user } = renderDetail(
      contentRealm({ status: "active", profileCollectionId: "col_profile" }),
      [membership],
    );

    await user.click(await screen.findByRole("tab", { name: "사용자" }));
    await user.click(await screen.findByRole("button", { name: "Owner 지정" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("새 Realm Owner"));
    await user.click(await screen.findByRole("option", { name: /realm\.owner@example\.com/ }));
    await user.type(within(dialog).getByLabelText(/변경 사유/), "Initial Realm owner");
    await user.type(within(dialog).getByLabelText(/현재 System 계정 비밀번호/), "admin-pw");
    await user.click(within(dialog).getByRole("button", { name: "Owner 지정" }));

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
    expect(await screen.findByText("Realm 설정")).toBeTruthy();
    expect(screen.queryByText(/Realm을 바로 활성화할 수 있습니다/)).toBeNull();
    expect(screen.queryByRole("button", { name: "기본 인증 스키마 생성" })).toBeNull();
    expect(screen.queryByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeNull();
  });
});

describe("IdentityRealmDetailPage 표시 모드", () => {
  const activeRealm = contentRealm({ status: "active", profileCollectionId: "col_profile" });

  it("keeps basic mode focused and routes Realm authorization to grades", async () => {
    const { listFullAccess, router, user } = renderDetail(activeRealm, [], "basic");

    await screen.findByText("Realm 설정");
    expect(screen.queryByLabelText("초기 Profile JSON")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Realm Full Access" })).toBeNull();
    await waitFor(() => expect(listFullAccess).toHaveBeenCalledWith("rlm_testre"));

    await user.click(screen.getByRole("tab", { name: "권한" }));
    await user.click(screen.getByRole("button", { name: "Realm 권한 관리" }));
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
    expect(screen.queryByRole("heading", { name: "Realm Full Access" })).toBeNull();
    await waitFor(() => expect(listFullAccess).toHaveBeenCalledWith("rlm_testre"));

    await user.click(screen.getByRole("tab", { name: "권한" }));
    await user.click(screen.getByRole("button", { name: "Realm 권한 관리" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/realms/rlm_testre/access/roles"));
  });

  it("shows Full Access in every display mode while keeping history advanced", async () => {
    const { listFullAccess, user } = renderDetail(activeRealm, [], "advanced");

    await user.click(await screen.findByRole("tab", { name: "권한" }));
    expect(await screen.findByRole("heading", { name: "Realm Full Access" })).toBeTruthy();
    expect(listFullAccess).toHaveBeenCalledWith("rlm_testre");
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
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/realms",
      element: <IdentityRealmListPage />,
    }], { initialEntries: ["/admin/realms"] });

    render(
      <QueryClientProvider client={queryClient}>
        <AdminApiProvider api={api}><RouterProvider router={router} /></AdminApiProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Identity Realm을 관리할 권한이 없습니다/)).toBeTruthy();
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
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/realms/:realmId",
      element: <IdentityRealmDetailPage />,
    }], { initialEntries: ["/admin/realms/rlm_testre"] });

    render(
      <QueryClientProvider client={queryClient}>
        <AdminApiProvider api={api}><RouterProvider router={router} /></AdminApiProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/이 Realm을 관리할 권한이 없습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Realm 목록으로" })).toBeTruthy();
  });
});
