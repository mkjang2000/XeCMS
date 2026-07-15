// @vitest-environment jsdom

import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AdminApiProvider,
  type AdminApi,
  type CollectionDetail,
  type DocumentRecord,
} from "@xecms/admin";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentListPage } from "./document-pages.js";

const collection: CollectionDetail = {
  id: "col_users",
  name: "users",
  label: "사용자",
  status: "applied",
  hasPendingChanges: false,
  revisionId: "schema-1",
  draftVersion: "draft-1",
  fields: [
    {
      id: "field_user_id",
      name: "userID",
      label: "사용자 ID",
      type: "text",
      required: true,
    },
  ],
};

const document: DocumentRecord = {
  id: "doc_1",
  collectionId: collection.id,
  data: { userID: "mkjang2000" },
  version: 1,
  displayState: "draft",
  draftRevisionId: "revision-1",
  publication: null,
  deletion: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

function renderDocumentList() {
  const api = {
    collections: {
      getApplied: vi.fn().mockResolvedValue(collection),
    },
    documents: {
      list: vi.fn().mockResolvedValue({
        items: [document],
        page: 1,
        pageSize: 25,
        total: 1,
      }),
    },
  } as unknown as AdminApi;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/admin/content/:collectionId",
        element: <DocumentListPage />,
      },
      {
        path: "/admin/content/:collectionId/new",
        element: <h1>새 문서 경로</h1>,
      },
      {
        path: "/admin/content/:collectionId/:documentId",
        element: <h1>문서 편집 경로</h1>,
      },
    ],
    { initialEntries: [`/admin/content/${collection.id}`] },
  );

  render(
    <StrictMode>
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AdminApiProvider>
    </StrictMode>,
  );

  return { router, user: userEvent.setup() };
}

describe("DocumentListPage navigation", () => {
  it("commits a client-side transition to the new document page in StrictMode", async () => {
    const { router, user } = renderDocumentList();
    await screen.findByRole("link", { name: "mkjang2000" });

    await user.click(screen.getByRole("button", { name: "새 문서" }));

    expect(
      await screen.findByRole("heading", { name: "새 문서 경로" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(
      `/admin/content/${collection.id}/new`,
    );
  });

  it("opens a document when a non-title cell in its row is clicked", async () => {
    const { router, user } = renderDocumentList();
    const title = await screen.findByRole("link", { name: "mkjang2000" });
    const row = title.closest("tr");
    expect(row).not.toBeNull();

    await user.click(
      within(row!).getByRole("cell", { name: "문서 상태: 초안" }),
    );

    expect(
      await screen.findByRole("heading", { name: "문서 편집 경로" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(
      `/admin/content/${collection.id}/${document.id}`,
    );
  });

  it("previews and confirms a tree move with both structure and policy revisions", async () => {
    const hierarchyCollection: CollectionDetail = {
      ...collection,
      hierarchy: { enabled: true, ordering: "manual", permissionInheritance: true },
    };
    const node = {
      document,
      parentId: null,
      position: 0,
      depth: 0,
      path: [],
      hasChildren: false,
    } as const;
    const permissionImpact = {
      documentId: document.id,
      documentResourceId: `resource:document:${document.id}`,
      beforeParentResourceId: "resource:collection:col_users",
      afterParentResourceId: "resource:document:doc_parent",
      beforeDocumentPath: [document.id],
      afterDocumentPath: ["doc_parent", document.id],
      beforeResourcePath: ["resource:collection:col_users", `resource:document:${document.id}`],
      afterResourcePath: ["resource:collection:col_users", "resource:document:doc_parent", `resource:document:${document.id}`],
      affectedDocumentIds: [document.id],
      affectedResourceIds: [`resource:document:${document.id}`],
      requiresAuthorizationManagement: true,
      effectivePermissionChanges: [{
        subjectId: "subject-editor",
        resourceId: `resource:document:${document.id}`,
        permission: "content.read",
        beforeAllowed: false,
        afterAllowed: true,
        change: "granted" as const,
      }],
      effectiveFieldAccessChanges: [{
        subjectId: "subject-editor",
        resourceId: `resource:document:${document.id}`,
        operation: "read" as const,
        beforeFields: ["title"],
        afterFields: null,
        change: "broadened" as const,
      }],
      effectivePermissionChangesTruncated: true,
    } as const;
    const previewMove = vi.fn().mockResolvedValue({
      previousParentId: null,
      previousPosition: 0,
      affectedDocumentIds: [document.id],
      permissionImpact,
      policyRevision: 11,
    });
    const move = vi.fn().mockResolvedValue({
      node,
      previousParentId: null,
      previousPosition: 0,
      affectedDocumentIds: [document.id],
      version: 8,
      permissionImpact,
      policyRevision: 11,
    });
    const api = {
      collections: { getApplied: vi.fn().mockResolvedValue(hierarchyCollection) },
      documents: {
        list: vi.fn().mockResolvedValue({ items: [document], page: 1, pageSize: 25, total: 1 }),
        tree: vi.fn().mockResolvedValue({ items: [node], version: 7 }),
        previewMove,
        move,
      },
    } as unknown as AdminApi;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{
      path: "/admin/content/:collectionId",
      element: <DocumentListPage />,
    }], { initialEntries: [`/admin/content/${collection.id}?view=tree`] });
    const user = userEvent.setup();
    render(
      <AdminApiProvider api={api}>
        <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
      </AdminApiProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "이동" }));

    expect(await screen.findByRole("heading", { name: "콘텐츠 이동 및 권한 영향" })).toBeTruthy();
    expect(previewMove).toHaveBeenCalledWith(collection.id, document.id, {
      newParentId: null,
      position: 0,
      expectedVersion: 7,
    });
    expect(move).not.toHaveBeenCalled();
    expect(screen.getByText("권한 영향")).toBeTruthy();
    expect(screen.getByText("획득")).toBeTruthy();
    expect(screen.getByText("content.read")).toBeTruthy();
    expect(screen.getByText(/보호된 Owner 권한/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "필드 접근 변화" })).toBeTruthy();
    expect(screen.getByText("필드 읽기")).toBeTruthy();
    expect(screen.getByText("title → 전체 필드")).toBeTruthy();
    expect(screen.getByText(/계산 상한을 넘어/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "콘텐츠 이동 및 권한 영향" })).toBeNull());
    expect(move).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "이동" }));
    await screen.findByRole("heading", { name: "콘텐츠 이동 및 권한 영향" });
    await user.click(screen.getByRole("button", { name: "확인 후 이동" }));

    await waitFor(() => expect(move).toHaveBeenCalledWith(collection.id, document.id, {
      newParentId: null,
      position: 0,
      expectedVersion: 7,
      expectedPolicyRevision: 11,
    }));
    expect(await screen.findByText(/이동 완료/)).toBeTruthy();
  });
});
