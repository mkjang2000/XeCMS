// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  AdminApiError,
  type AdminApi,
  type AuthorizationDecision,
  type AuthorizationPolicy,
} from "@xecms/admin";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider } from "../display-mode.js";
import { AccessBindingsPage, AccessRolesPage, AccessSimulatorPage } from "./access-pages.js";

const policy: AuthorizationPolicy = {
  realmId: "system",
  revision: 9,
  subjects: [{ id: "subject-editor", realmId: "system", type: "user", name: "Editor", protected: false, disabled: false }],
  groupMemberships: [],
  resources: [
    { id: "workspace", realmId: "system", type: "workspace", name: "Workspace", protected: true },
    { id: "content", realmId: "system", type: "section", name: "Content", parentId: "workspace", protected: true },
    { id: "collection:pages", realmId: "system", type: "collection", name: "Pages", parentId: "content", protected: false },
  ],
  levels: [],
  permissions: [
    { key: "content.read", label: "콘텐츠 조회", category: "content", hierarchyGuard: "none", delegatable: true, protected: false },
    { key: "content.update", label: "콘텐츠 수정", category: "content", hierarchyGuard: "none", delegatable: true, protected: false },
  ],
  roles: [],
  bindings: [],
};

afterEach(cleanup);

describe("AccessSimulatorPage", () => {
  it("queries every catalog action to show a user's effective permissions", async () => {
    const simulate = vi.fn().mockImplementation(async ({ action, resourceId }: { readonly action: string; readonly resourceId: string }): Promise<AuthorizationDecision> => ({
      allowed: action === "content.read",
      action,
      reasonCode: action === "content.read" ? "PERMISSION_GRANTED" : "PERMISSION_NOT_GRANTED",
      resourceId,
      policyRevision: policy.revision,
      matchedGrants: [],
    }));
    const api = {
      authorization: {
        getPolicy: vi.fn().mockResolvedValue(policy),
        simulate,
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/access/simulator",
      element: <AccessSimulatorPage />,
    }], { initialEntries: ["/admin/access/simulator"] });
    const user = userEvent.setup();

    render(
      <DisplayModeProvider initialMode="standard">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    await user.selectOptions(await screen.findByLabelText("확인할 사용자·그룹"), "subject-editor");
    // Global (System) authorization context is labelled consistently.
    expect(screen.getByText("운영자 공간 · 권한")).toBeTruthy();
    expect(screen.getByRole("link", { name: "사용자 권한 확인" })).toBeTruthy();
    expect(screen.queryByText("특정 권한 상세 진단")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));
    await user.click(screen.getByRole("button", { name: "이 영역의 전체 권한 확인" }));

    expect(await screen.findByText("1/2개 가능")).toBeTruthy();
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ action: "content.read", resourceId: "collection:pages" }));
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ action: "content.update", resourceId: "collection:pages" }));
    expect(screen.getByText("필요한 역할과 권한이 적용되어 있습니다.")).toBeTruthy();
    expect(screen.getByText("이 업무를 허용하는 역할이 배정되지 않았습니다.")).toBeTruthy();
    expect(screen.queryByText("content.read")).toBeNull();
  });

  it("separates hierarchy actions from ordinary denied permission results", async () => {
    const hierarchyPolicy: AuthorizationPolicy = {
      ...policy,
      permissions: [
        ...policy.permissions,
        {
          key: "role.update",
          label: "역할 수정",
          category: "role",
          hierarchyGuard: "target-role",
          delegatable: true,
          protected: false,
        },
      ],
    };
    const simulate = vi.fn().mockResolvedValue({
      allowed: true,
      action: "content.read",
      reasonCode: "ALLOW_PERMISSION",
      resourceId: "collection:pages",
      policyRevision: hierarchyPolicy.revision,
      matchedGrants: [],
    });
    const api = {
      authorization: {
        getPolicy: vi.fn().mockResolvedValue(hierarchyPolicy),
        simulate,
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createMemoryRouter([{
      path: "/admin/access/simulator",
      element: <AccessSimulatorPage />,
    }], { initialEntries: ["/admin/access/simulator"] });
    const user = userEvent.setup();

    render(
      <DisplayModeProvider initialMode="advanced">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    await user.selectOptions(await screen.findByLabelText("확인할 사용자·그룹"), "subject-editor");
    await user.click(screen.getByText("특정 권한 상세 진단"));
    await user.selectOptions(screen.getByLabelText("확인할 권한"), "role.update");
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));

    expect(screen.getByText(/대상 역할의 Authority Level context가 필요합니다/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "대상 정보 필요" }) as HTMLButtonElement).disabled)
      .toBe(true);

    await user.click(screen.getByRole("button", { name: "이 영역의 전체 권한 확인" }));
    expect(await screen.findByText(/1개 추가 정보 필요/)).toBeTruthy();
    expect(screen.getByText("추가 정보 필요")).toBeTruthy();
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate).not.toHaveBeenCalledWith(expect.objectContaining({ action: "role.update" }));
  });
});

describe("AccessBindingsPage", () => {
  it("saves the selected tree scope and its explicit propagation", async () => {
    const bindingPolicy: AuthorizationPolicy = {
      ...policy,
      levels: [{ id: "level-editor", realmId: "system", name: "Editors", rank: 40, protected: false }],
      roles: [{
        id: "role-editor",
        realmId: "system",
        levelId: "level-editor",
        name: "Page Editor",
        permissions: ["content.read"],
        delegatablePermissions: [],
        fieldAccess: [],
        protected: false,
      }],
    };
    const createBinding = vi.fn().mockResolvedValue(bindingPolicy);
    const api = {
      authorization: {
        getPolicy: vi.fn().mockResolvedValue(bindingPolicy),
        createBinding,
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/access/bindings",
      element: <AccessBindingsPage />,
    }], { initialEntries: ["/admin/access/bindings"] });
    const user = userEvent.setup();
    render(
      <DisplayModeProvider initialMode="advanced">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "역할 배정하기" }));
    await user.selectOptions(screen.getByLabelText("사용자 또는 그룹"), "subject-editor");
    await user.selectOptions(screen.getByLabelText("부여할 역할"), "role-editor");
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));
    await user.click(screen.getByRole("radio", { name: /현재 \+ 모든 하위/ }));
    await user.click(screen.getByRole("button", { name: "역할 배정" }));

    expect(createBinding).toHaveBeenCalledWith({
      expectedPolicyRevision: bindingPolicy.revision,
      subjectId: "subject-editor",
      roleId: "role-editor",
      resourceId: "collection:pages",
      propagation: "self-and-children",
      validFrom: undefined,
      validUntil: undefined,
      constraints: undefined,
    });
  });

  it("defaults new standard bindings to descendants and preserves hidden settings on edits", async () => {
    const bindingPolicy: AuthorizationPolicy = {
      ...policy,
      levels: [{ id: "level-editor", realmId: "system", name: "Editors", rank: 40, protected: false }],
      roles: [{
        id: "role-editor",
        realmId: "system",
        levelId: "level-editor",
        name: "Page Editor",
        permissions: ["content.read"],
        delegatablePermissions: [],
        fieldAccess: [],
        protected: false,
      }],
      bindings: [{
        id: "binding-editor",
        realmId: "system",
        subjectId: "subject-editor",
        roleId: "role-editor",
        resourceId: "content",
        propagation: "self",
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2026-12-31T23:59:59.000Z",
        constraints: { statuses: ["draft"] },
        protected: false,
      }],
    };
    const createBinding = vi.fn().mockResolvedValue(bindingPolicy);
    const updateBinding = vi.fn().mockResolvedValue(bindingPolicy);
    const api = {
      authorization: {
        getPolicy: vi.fn().mockResolvedValue(bindingPolicy),
        createBinding,
        updateBinding,
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/access/bindings",
      element: <AccessBindingsPage />,
    }], { initialEntries: ["/admin/access/bindings"] });
    const user = userEvent.setup();

    render(
      <DisplayModeProvider initialMode="standard">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    expect(await screen.findByText("고급 설정 있음")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "역할 배정하기" }));
    expect(screen.queryByRole("radio")).toBeNull();
    await user.selectOptions(screen.getByLabelText("사용자 또는 그룹"), "subject-editor");
    await user.selectOptions(screen.getByLabelText("부여할 역할"), "role-editor");
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));
    await user.click(screen.getByRole("button", { name: "역할 배정" }));
    expect(createBinding).toHaveBeenCalledWith({
      expectedPolicyRevision: bindingPolicy.revision,
      subjectId: "subject-editor",
      roleId: "role-editor",
      resourceId: "collection:pages",
      propagation: "self-and-children",
      validFrom: undefined,
      validUntil: undefined,
      constraints: undefined,
    });

    await user.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.getAllByText("고급 설정 있음").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("추가 조건")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));
    await user.click(screen.getByRole("button", { name: "변경 저장" }));

    expect(updateBinding).toHaveBeenCalledWith("binding-editor", {
      expectedPolicyRevision: bindingPolicy.revision,
      subjectId: "subject-editor",
      roleId: "role-editor",
      resourceId: "collection:pages",
      propagation: "self",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      constraints: { statuses: ["draft"] },
    });
  });
});

describe("AccessRolesPage", () => {
  it("renders CMS Owner oversight as read-only and hides every policy mutation entry point", async () => {
    const readonlyPolicy: AuthorizationPolicy = {
      ...policy,
      realmId: "rlm_testre",
      administration: { accessMode: "cms-owner-readonly" },
      levels: [{ id: "level-editor", realmId: "rlm_testre", name: "Editors", rank: 40, protected: false }],
      roles: [{
        id: "role-editor",
        realmId: "rlm_testre",
        levelId: "level-editor",
        name: "Page Editor",
        permissions: ["content.read"],
        delegatablePermissions: [],
        fieldAccess: [],
        protected: false,
      }],
    };
    const updateRole = vi.fn();
    const api = {
      identityRealms: {
        authorizationFor: vi.fn().mockReturnValue({
          getPolicy: vi.fn().mockResolvedValue(readonlyPolicy),
          updateRole,
        }),
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/realms/:realmId/access/roles",
      element: <AccessRolesPage />,
    }], { initialEntries: ["/admin/realms/rlm_testre/access/roles"] });
    const user = userEvent.setup();

    render(
      <DisplayModeProvider initialMode="advanced">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    expect(await screen.findByText("CMS Owner 읽기 전용 보기")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Full Access 시작" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "새 레벨" })).toBeNull();
    expect(screen.queryByRole("button", { name: "동일 레벨 역할 추가" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Page Editor/ }));
    expect((screen.getByLabelText("역할 이름") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("uses a selectable role list and exposes protected roles as read-only details", async () => {
    const rolesPolicy: AuthorizationPolicy = {
      ...policy,
      permissions: [
        ...policy.permissions,
        { key: "authorization.manage", label: "보호 권한 관리", category: "authorization", hierarchyGuard: "none", delegatable: false, protected: true },
      ],
      levels: [{ id: "level-editor", realmId: "system", name: "Editors", rank: 40, protected: false }],
      roles: [
        {
          id: "role-editor",
          realmId: "system",
          levelId: "level-editor",
          name: "Page Editor",
          description: "페이지 작성 담당",
          permissions: ["content.read"],
          delegatablePermissions: [],
          fieldAccess: [],
          protected: false,
        },
        {
          id: "role-protected",
          realmId: "system",
          levelId: "level-editor",
          name: "System Editor",
          permissions: ["content.read", "content.update", "authorization.manage"],
          delegatablePermissions: [],
          fieldAccess: [],
          protected: true,
        },
      ],
    };
    const api = {
      authorization: {
        getPolicy: vi.fn().mockResolvedValue(rolesPolicy),
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/access/roles",
      element: <AccessRolesPage />,
    }], { initialEntries: ["/admin/access/roles"] });
    const user = userEvent.setup();

    render(
      <DisplayModeProvider initialMode="advanced">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Page Editor/ }));
    expect(screen.getByRole("region", { name: "역할 편집기" })).toBeTruthy();
    expect(screen.getByLabelText("권한 검색")).toBeTruthy();
    expect((screen.getByLabelText("역할 이름") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText("authorization.manage")).toBeNull();

    await user.click(screen.getByRole("button", { name: /System Editor/ }));
    expect(screen.getByText("보호 역할 상세")).toBeTruthy();
    expect((screen.getByLabelText("역할 이름") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("authorization.manage")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
  });

  it("edits standard tasks without exposing or erasing advanced role settings", async () => {
    const fieldAccess = [{
      resourceId: "collection:pages",
      readableFields: ["title", "summary"],
      writableFields: ["title"],
    }];
    const rolesPolicy: AuthorizationPolicy = {
      ...policy,
      levels: [{ id: "level-editor", realmId: "system", name: "Editors", rank: 40, protected: false }],
      roles: [{
        id: "role-editor",
        realmId: "system",
        levelId: "level-editor",
        name: "Page Editor",
        description: "페이지 작성 담당",
        permissions: ["content.read", "content.update"],
        delegatablePermissions: ["content.update"],
        fieldAccess,
        protected: false,
      }],
    };
    const updateRole = vi.fn().mockResolvedValue(rolesPolicy);
    const api = {
      authorization: {
        getPolicy: vi.fn().mockResolvedValue(rolesPolicy),
        updateRole,
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/access/roles",
      element: <AccessRolesPage />,
    }], { initialEntries: ["/admin/access/roles"] });
    const user = userEvent.setup();

    render(
      <DisplayModeProvider initialMode="standard">
        <AdminApiProvider api={api}>
          <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
        </AdminApiProvider>
      </DisplayModeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Page Editor/ }));
    expect(screen.getAllByText("고급 설정 있음").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("L40")).toBeNull();
    expect(screen.queryByText("권한 코드 보기")).toBeNull();
    expect(screen.queryByText("필드 접근 제한")).toBeNull();
    await user.clear(screen.getByLabelText("역할 설명"));
    await user.type(screen.getByLabelText("역할 설명"), "표준 화면에서 설명 수정");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(updateRole).toHaveBeenCalledWith("role-editor", {
      expectedPolicyRevision: rolesPolicy.revision,
      name: "Page Editor",
      description: "표준 화면에서 설명 수정",
      levelId: "level-editor",
      permissions: ["content.read", "content.update"],
      delegatablePermissions: ["content.update"],
      fieldAccess,
    });
  });
});

describe("Realm 권한 부트스트랩 데드락 안내", () => {
  it("guides the operator to grant themselves administrator when getPolicy is denied", async () => {
    const denied = new AdminApiError({
      status: 403,
      code: "AUTHORIZATION_DENIED",
      message: "Authorization denied: NO_PERMISSION.",
      details: { decision: { reasonCode: "NO_PERMISSION" } },
    });
    const getPolicy = vi.fn().mockRejectedValue(denied);
    const api = {
      identityRealms: {
        authorizationFor: vi.fn().mockReturnValue({ getPolicy }),
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/realms/:realmId/access/roles",
      element: <AccessRolesPage />,
    }], { initialEntries: ["/admin/realms/rlm_testre/access/roles"] });

    render(
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
      </AdminApiProvider>,
    );

    // The dead-end error is replaced by an actionable escape hatch.
    expect(await screen.findByText(/관리할 권한이 아직 없습니다/)).toBeTruthy();
    const goToRealm = screen.getByRole("button", { name: "사용자 공간 상세로 이동해 관리자 지정" });
    expect(goToRealm).toBeTruthy();
  });

  it("shows a plain error (not the deadlock guidance) for the System workspace", async () => {
    const denied = new AdminApiError({
      status: 403,
      code: "AUTHORIZATION_DENIED",
      message: "Authorization denied: NO_PERMISSION.",
      details: { decision: { reasonCode: "NO_PERMISSION" } },
    });
    const api = {
      authorization: { getPolicy: vi.fn().mockRejectedValue(denied) },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/access/roles",
      element: <AccessRolesPage />,
    }], { initialEntries: ["/admin/access/roles"] });

    render(
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
      </AdminApiProvider>,
    );

    expect(await screen.findByText(/요청을 완료하지 못했습니다/)).toBeTruthy();
    expect(screen.queryByText(/관리할 권한이 아직 없습니다/)).toBeNull();
  });

  it("also treats REALM_MEMBERSHIP_REQUIRED (not yet a member) as the deadlock", async () => {
    const denied = new AdminApiError({
      status: 403,
      code: "REALM_MEMBERSHIP_REQUIRED",
      message: "An active Content Realm Membership is required to manage its authorization policy.",
    });
    const getPolicy = vi.fn().mockRejectedValue(denied);
    const api = {
      identityRealms: { authorizationFor: vi.fn().mockReturnValue({ getPolicy }) },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/realms/:realmId/access/roles",
      element: <AccessRolesPage />,
    }], { initialEntries: ["/admin/realms/rlm_testre/access/roles"] });

    render(
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
      </AdminApiProvider>,
    );

    // The raw English server message must not leak; the guidance takes over.
    expect(await screen.findByText(/관리할 권한이 아직 없습니다/)).toBeTruthy();
    expect(screen.queryByText(/An active Content Realm Membership/)).toBeNull();
  });
});
