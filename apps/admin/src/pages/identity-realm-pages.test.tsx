// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  type AdminApi,
  type IdentityRealm,
} from "@xecms/admin";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityRealmDetailPage } from "./identity-realm-pages.js";

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

function renderDetail(realm: IdentityRealm, memberships: readonly unknown[] = []) {
  const registerMembership = vi.fn().mockResolvedValue({});
  const grantRealmAdministrator = vi.fn().mockResolvedValue({});
  const api = {
    identityRealms: {
      get: vi.fn().mockResolvedValue(realm),
      list: vi.fn().mockResolvedValue({ items: [realm], nextCursor: undefined }),
      listGlobalIdentities: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      listMemberships: vi.fn().mockResolvedValue({ items: memberships, nextCursor: undefined }),
      listFullAccess: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      registerMembership,
      grantRealmAdministrator,
    },
  } as unknown as AdminApi;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{
    path: "/admin/realms/:realmId",
    element: <IdentityRealmDetailPage />,
  }], { initialEntries: [`/admin/realms/${realm.realmId}`] });
  render(
    <QueryClientProvider client={queryClient}>
      <AdminApiProvider api={api}>
        <RouterProvider router={router} />
      </AdminApiProvider>
    </QueryClientProvider>,
  );
  return { registerMembership, grantRealmAdministrator, user: userEvent.setup() };
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
    expect(screen.queryByText(/한 단계가 더 필요합니다/)).toBeNull();
    expect(screen.queryByRole("button", { name: "스키마 빌더로 이동" })).toBeNull();
    expect(screen.queryByText(/활성화되기 전까지는 설정을 변경할 수 없습니다/)).toBeNull();
  });
});
