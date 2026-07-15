// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  type AdminApi,
  type AuthorizationDecision,
  type AuthorizationPolicy,
} from "@xecms/admin";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessBindingsPage, AccessSimulatorPage } from "./access-pages.js";

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
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
      </AdminApiProvider>,
    );

    await user.selectOptions(await screen.findByLabelText("Subject"), "subject-editor");
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));
    await user.click(screen.getByRole("button", { name: "전체 유효 권한 조회" }));

    expect(await screen.findByText("1/2 허용")).toBeTruthy();
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ action: "content.read", resourceId: "collection:pages" }));
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ action: "content.update", resourceId: "collection:pages" }));
    expect(screen.getByText("PERMISSION_GRANTED")).toBeTruthy();
    expect(screen.getByText("PERMISSION_NOT_GRANTED")).toBeTruthy();
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
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
      </AdminApiProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "새 바인딩" }));
    await user.selectOptions(screen.getByLabelText("Subject"), "subject-editor");
    await user.selectOptions(screen.getByLabelText("Role"), "role-editor");
    await user.click(screen.getByRole("button", { name: "Pages, Collection" }));
    await user.click(screen.getByRole("radio", { name: /현재 및 모든 하위/ }));
    await user.click(screen.getByRole("button", { name: "저장" }));

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
});
