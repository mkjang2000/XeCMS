// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  type AdminApi,
  type CollectionDetail,
  type IdentityRealm,
} from "@xecms/admin";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaEditorPage } from "./schema-editor-page.js";

const contentRealm: IdentityRealm = {
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

function collectionFixture(
  kind: "collection" | "singleton" = "collection",
  eligibleIdentifier = true,
): CollectionDetail {
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

function renderEditor(input: {
  readonly collection?: CollectionDetail;
  readonly realms?: readonly IdentityRealm[];
}) {
  const collection = input.collection ?? collectionFixture();
  const updateDraft = vi.fn().mockImplementation(async (
    _collectionId: string,
    request: { readonly draft: Parameters<AdminApi["collections"]["create"]>[0] },
  ) => ({
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
  } as unknown as AdminApi;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter([
    { path: "/admin/schema/:collectionId", element: <SchemaEditorPage /> },
    { path: "/admin/schema/:collectionId/changes", element: <h1>Schema review</h1> },
  ], { initialEntries: [`/admin/schema/${collection.id}`] });
  render(
    <AdminApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AdminApiProvider>,
  );
  return { router, updateDraft, user: userEvent.setup() };
}

afterEach(cleanup);

describe("SchemaEditorPage Collection auth", () => {
  it("saves the exact CollectionAuthDefinition contract from a pre-created Content Realm", async () => {
    const { updateDraft, user } = renderEditor({});
    await screen.findByRole("heading", { name: "Members 스키마" });

    await user.click(screen.getByRole("checkbox", { name: "콘텐츠 계정 인증 사용" }));
    const realmSelect = [...document.querySelectorAll("select")].find((select) =>
      select.querySelector('option[value="community"]') !== null);
    expect(realmSelect).toBeDefined();
    await user.selectOptions(realmSelect!, "community");
    await user.click(screen.getByRole("checkbox", { name: "Email · fld_email" }));

    const submit = screen.getByRole("button", { name: "변경 사항 검토" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    const request = updateDraft.mock.calls[0]?.[1] as {
      readonly draft: { readonly auth?: unknown };
      readonly expectedDraftVersion: string;
    };
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
    expect((screen.getByRole("button", { name: "변경 사항 검토" }) as HTMLButtonElement).disabled).toBe(true);
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
    expect((screen.getByRole("button", { name: "변경 사항 검토" }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
