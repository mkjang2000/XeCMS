// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  AdminApiError,
  type AdminApi,
  type IdentityRealm,
} from "@xecms/admin";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider, type DisplayMode } from "../display-mode.js";
import { IdentityRealmDetailPage, IdentityRealmListPage } from "./identity-realm-pages.js";

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

function renderDetail(realm: IdentityRealm, memberships: readonly unknown[] = [], mode: DisplayMode = "basic") {
  const registerMembership = vi.fn().mockResolvedValue({});
  const grantRealmAdministrator = vi.fn().mockResolvedValue({});
  const createProfileSchema = vi.fn().mockResolvedValue({
    ...realm,
    status: "active",
    profileCollectionId: "col_profile",
  });
  const listFullAccess = vi.fn().mockResolvedValue({ items: [], nextCursor: undefined });
  const api = {
    identityRealms: {
      get: vi.fn().mockResolvedValue(realm),
      list: vi.fn().mockResolvedValue({ items: [realm], nextCursor: undefined }),
      listGlobalIdentities: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      listMemberships: vi.fn().mockResolvedValue({ items: memberships, nextCursor: undefined }),
      listFullAccess,
      createProfileSchema,
      registerMembership,
      grantRealmAdministrator,
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
  return { createProfileSchema, registerMembership, grantRealmAdministrator, listFullAccess, router, user: userEvent.setup() };
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

    await screen.findByRole("heading", { name: "새 사용자 만들어 연결" });

    // These labels are unique to the new-user form, so global queries are safe.
    await user.type(screen.getByRole("textbox", { name: "로그인 identifier" }), "new.user@example.com");
    // Required fields render a "*" inside the label, so match on a prefix.
    await user.type(screen.getByLabelText(/초기 비밀번호/), "new-user-initial-pw");
    await user.type(screen.getByLabelText(/현재 관리자 비밀번호/), "admin-pw");
    await user.click(screen.getByRole("button", { name: "새 사용자 생성 후 연결" }));

    await waitFor(() => expect(registerMembership).toHaveBeenCalledTimes(1));
    expect(registerMembership).toHaveBeenCalledWith("rlm_testre", expect.objectContaining({
      identifier: "new.user@example.com",
      password: "new-user-initial-pw",
      reauthPassword: "admin-pw",
      profile: {},
    }));
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
    const { grantRealmAdministrator, user } = renderDetail(
      contentRealm({ status: "active", profileCollectionId: "col_profile" }),
      [membership],
    );

    const promoteButton = await screen.findByRole("button", { name: "관리자로 지정" });
    await user.click(promoteButton);

    // A re-authentication dialog gates the promotion.
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/현재 관리자 비밀번호/), "admin-pw");
    await user.click(within(dialog).getByRole("button", { name: "관리자로 지정" }));

    await waitFor(() => expect(grantRealmAdministrator).toHaveBeenCalledTimes(1));
    expect(grantRealmAdministrator).toHaveBeenCalledWith("rlm_testre", "mem_1", { reauthPassword: "admin-pw" });
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
    expect(listFullAccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Realm 권한 관리" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/realms/rlm_testre/access/grades"));
  });

  it("shows profile JSON in standard mode and routes authorization to roles", async () => {
    const { listFullAccess, router, user } = renderDetail(activeRealm, [], "standard");

    expect((await screen.findAllByLabelText("초기 Profile JSON")).length).toBe(2);
    expect(screen.queryByRole("heading", { name: "Realm Full Access" })).toBeNull();
    expect(listFullAccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Realm 권한 관리" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/realms/rlm_testre/access/roles"));
  });

  it("loads and shows Full Access only in advanced mode", async () => {
    const { listFullAccess } = renderDetail(activeRealm, [], "advanced");

    expect(await screen.findByRole("heading", { name: "Realm Full Access" })).toBeTruthy();
    expect(screen.getAllByLabelText("초기 Profile JSON").length).toBe(2);
    expect(listFullAccess).toHaveBeenCalledWith("rlm_testre");
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
