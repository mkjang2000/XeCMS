// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider, type AdminApi, type AuthorizationPolicy } from "@xecms/admin";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayModeProvider } from "../../display-mode.js";
import { AccessGradesPage } from "./grades-page.js";
import { seedPolicy } from "./test-fixtures.js";

afterEach(cleanup);

function renderPage(policy: AuthorizationPolicy, authorization: Record<string, unknown> = {}) {
  const api = {
    authorization: { getPolicy: vi.fn().mockResolvedValue(policy), ...authorization },
  } as unknown as AdminApi;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{
    path: "/admin/access/grades",
    element: <AccessGradesPage />,
  }], { initialEntries: ["/admin/access/grades"] });
  render(
    <AdminApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <DisplayModeProvider initialMode="basic"><RouterProvider router={router} /></DisplayModeProvider>
      </QueryClientProvider>
    </AdminApiProvider>,
  );
  return api.authorization;
}

describe("AccessGradesPage", () => {
  it("shows aggregate grades as a complete read-only configuration", async () => {
    renderPage(seedPolicy());
    const card = await screen.findByRole("region", { name: "Administrators 등급" });

    expect(within(card).getByText("역할 2개")).toBeTruthy();
    expect(within(card).getByText("담당 업무별로 역할이 나뉘어 있어요", { exact: false })).toBeTruthy();
    await userEvent.setup().click(within(card).getByRole("button", { name: "구성 보기" }));

    const editor = screen.getByRole("region", { name: "등급 권한 편집기" });
    expect(within(editor).getByText("읽기 전용")).toBeTruthy();
    expect(within(editor).getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled"))).toBe(true);
    expect(within(editor).getByRole("button", { name: "표준 모드에서 역할별로 편집" })).toBeTruthy();
  });

  it("preserves delegation, field access, and description when saving visible permissions", async () => {
    const policy = seedPolicy();
    const updateRole = vi.fn().mockResolvedValue({ ...policy, revision: 8 });
    renderPage(policy, { updateRole });
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Editors 등급" });
    await user.click(within(card).getByRole("button", { name: "권한 편집" }));
    await user.click(screen.getByRole("checkbox", { name: "콘텐츠 보기" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await user.click((await screen.findByRole("dialog")).querySelector("button:last-child")!);

    expect(updateRole).toHaveBeenCalledWith("role-editor", {
      name: "Editors",
      description: "콘텐츠 담당",
      levelId: "level-editor",
      permissions: ["content.update", "content.publish"],
      delegatablePermissions: ["content.update", "content.publish"],
      fieldAccess: [{ resourceId: "content", readableFields: ["title"], writableFields: [] }],
      expectedPolicyRevision: 7,
    });
  });

  it("offers a role-only retry when level creation succeeds but role creation fails", async () => {
    const policy = seedPolicy();
    const createdLevel = {
      ...policy,
      revision: 8,
      levels: [...policy.levels, { id: "level-new", realmId: "system", name: "Contributors", rank: 60, protected: false }],
    };
    const createLevel = vi.fn().mockResolvedValue(createdLevel);
    const createRole = vi.fn().mockRejectedValue(new Error("role creation failed"));
    renderPage(policy, { createLevel, createRole });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "새 등급" }));
    await user.type(screen.getByLabelText("등급 이름"), "Contributors");
    await user.selectOptions(screen.getByLabelText("어느 위치에 둘까요?"), "level-admin:level-editor");
    await user.click(screen.getByRole("button", { name: "등급 만들기" }));

    expect(await screen.findByText("등급은 만들어졌어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "권한 설정 다시 시도" })).toBeTruthy();
    expect(createLevel).toHaveBeenCalledWith({ name: "Contributors", rank: 60, expectedPolicyRevision: 7 });
    expect(createRole).toHaveBeenCalledWith(expect.objectContaining({ levelId: "level-new", expectedPolicyRevision: 8 }));
  });
});
