import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIResponse,
  type Locator,
  type Page,
} from "./fixtures.js";

const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3110";
const ownerPassword =
  process.env.XECMS_E2E_OWNER_PASSWORD ?? "Admin-test-only-2026!";
const manifestPath = fileURLToPath(
  new URL("../../examples/blog/xecms.schema.json", import.meta.url),
);
const generatedTypesPath = fileURLToPath(
  new URL("../../examples/blog/xecms.generated.ts", import.meta.url),
);

interface ProblemDetails {
  readonly code: string;
  readonly detail: string;
}

interface Session {
  readonly csrfToken: string;
}

interface SchemaRevision {
  readonly revisionId: string;
}

interface SchemaDraft {
  readonly baseRevisionId: string | null;
  readonly draftVersion: string;
}

interface SchemaPreview {
  readonly planId: string;
  readonly requiresDestructiveApproval: boolean;
}

interface SchemaManifest {
  readonly schema: unknown;
  readonly serialized: string;
  readonly hash: string;
}

interface GeneratedTypes {
  readonly fileName: string;
  readonly source: string;
  readonly hash: string;
}

interface DocumentRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly version: number;
}

interface DocumentList {
  readonly items: readonly DocumentRecord[];
  readonly total: number;
}

interface RevisionList {
  readonly items: readonly {
    readonly id: string;
    readonly sequence: number;
  }[];
  readonly documentVersion: number;
}

interface MediaRecord {
  readonly id: string;
  readonly fileName?: string;
  readonly originalFileName?: string;
  readonly mimeType: string;
}

interface HierarchyTreeItem {
  readonly documentId?: string;
  readonly document?: DocumentRecord;
  readonly parentId: string | null;
  readonly position?: number;
  readonly sortKey?: number;
  readonly depth: number;
  readonly path: readonly string[];
}

interface HierarchyTree {
  readonly version: number;
  readonly items: readonly HierarchyTreeItem[];
}

function richText(text: string) {
  return {
    format: "xecms.rich-text",
    formatVersion: 2,
    content: [
      {
        id: "blk-e2e-1",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
        children: [],
      },
    ],
  } as const;
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as T;
}

async function ok(response: APIResponse): Promise<void> {
  expect(response.ok(), await response.text()).toBe(true);
}

async function problem(response: APIResponse, status: number): Promise<ProblemDetails> {
  expect(response.status()).toBe(status);
  return (await response.json()) as ProblemDetails;
}

function action(page: Page, name: RegExp): Locator {
  return page
    .getByRole("button", { name })
    .or(page.getByRole("link", { name }))
    .first();
}

async function loginOrBootstrap(page: Page): Promise<string> {
  const status = await json<{ readonly required: boolean }>(
    await page.request.get(`${serverUrl}/api/bootstrap/status`),
  );

  if (status.required) {
    await page.goto("/admin/setup");
    const form = page.getByRole("form", { name: "초기 관리자 설정" });
    await form.getByLabel("사용자 이름").fill("admin");
    await form.getByLabel("비밀번호").first().fill(ownerPassword);
    await form.getByLabel("비밀번호 확인").fill(ownerPassword);
    await form.getByRole("button", { name: "초기 관리자 생성" }).click();
  } else {
    await page.goto("/admin/login");
    const form = page.getByRole("form", { name: "로그인" });
    await form.getByLabel("사용자 이름").fill("admin");
    await form.getByLabel("비밀번호").fill(ownerPassword);
    await form.getByRole("button", { name: "로그인" }).click();
  }

  await expect(page).toHaveURL(/\/admin\/(?:schema|content)(?:\/|$)/);
  const session = await json<Session>(
    await page.request.get(`${serverUrl}/api/auth/session`),
  );
  return session.csrfToken;
}

test("M2 Blog을 Schema, Relation, Hierarchy, Media와 UI까지 완주한다", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const csrfToken = await loginOrBootstrap(page);
  const mutationHeaders = { "x-csrf-token": csrfToken };
  const movePage = async (
    documentId: string,
    data: {
      readonly newParentId: string | null;
      readonly position: number;
      readonly expectedVersion: number;
    },
  ): Promise<APIResponse> => {
    const policy = await json<{ readonly revision: number }>(
      await page.request.get(`${serverUrl}/api/authorization/policy`),
    );
    return page.request.post(
      `${serverUrl}/api/collections/col_blog_pages/documents/${documentId}/move`,
      {
        headers: mutationHeaders,
        data: { ...data, expectedPolicyRevision: policy.revision },
      },
    );
  };
  const canonicalManifest = (await readFile(manifestPath, "utf8")).trimEnd();
  const blogSchema = JSON.parse(canonicalManifest) as unknown;
  const generatedTypesFixture = await readFile(generatedTypesPath, "utf8");

  await test.step("canonical Blog Manifest를 import, preview, apply한다", async () => {
    const activeResponse = await page.request.get(`${serverUrl}/api/schema`);
    const active = activeResponse.ok()
      ? ((await activeResponse.json()) as SchemaRevision | null)
      : null;
    const draftResponse = await page.request.get(`${serverUrl}/api/schema/draft`);
    const existingDraft = draftResponse.ok()
      ? ((await draftResponse.json()) as SchemaDraft | null)
      : null;

    const imported = await json<SchemaDraft>(
      await page.request.put(`${serverUrl}/api/schema/manifest`, {
        headers: mutationHeaders,
        data: {
          baseRevisionId: active?.revisionId ?? null,
          expectedDraftVersion: existingDraft?.draftVersion ?? null,
          schema: blogSchema,
        },
      }),
    );
    const preview = await json<SchemaPreview>(
      await page.request.post(`${serverUrl}/api/schema/preview`, {
        headers: mutationHeaders,
        data: { expectedDraftVersion: imported.draftVersion },
      }),
    );
    await json<SchemaRevision>(
      await page.request.post(`${serverUrl}/api/schema/apply`, {
        headers: mutationHeaders,
        data: {
          planId: preview.planId,
          expectedRevisionId: active?.revisionId ?? null,
          expectedDraftVersion: imported.draftVersion,
          approveDestructive: true,
        },
      }),
    );
  });

  await test.step("Manifest export와 TypeScript 생성 결과가 byte 단위로 재현된다", async () => {
    const firstManifest = await json<SchemaManifest>(
      await page.request.get(`${serverUrl}/api/schema/manifest`),
    );
    const secondManifest = await json<SchemaManifest>(
      await page.request.get(`${serverUrl}/api/schema/manifest`),
    );
    expect(firstManifest).toEqual(secondManifest);
    expect(firstManifest.serialized).toBe(canonicalManifest);
    expect(firstManifest.schema).toEqual(blogSchema);

    const firstTypes = await json<GeneratedTypes>(
      await page.request.get(`${serverUrl}/api/schema/types`),
    );
    const secondTypes = await json<GeneratedTypes>(
      await page.request.get(`${serverUrl}/api/schema/types`),
    );
    expect(firstTypes).toEqual(secondTypes);
    expect(firstTypes.fileName).toBe("xecms.generated.ts");
    expect(firstTypes.source).toBe(generatedTypesFixture);
    expect(firstTypes.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  let mediaId = "";

  await test.step("검증 가능한 PNG를 streaming upload하고 정합성을 확인한다", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const uploaded = await json<MediaRecord>(
      await page.request.post(`${serverUrl}/api/media`, {
        headers: {
          ...mutationHeaders,
          "content-type": "image/png",
          "x-file-name": encodeURIComponent("blog-cover.png"),
        },
        data: png,
      }),
    );
    expect(uploaded.mimeType).toBe("image/png");
    mediaId = uploaded.id;

    const content = await page.request.get(
      `${serverUrl}/api/media/${encodeURIComponent(mediaId)}/content`,
    );
    expect(content.ok()).toBe(true);
    expect(content.headers()["content-type"]).toContain("image/png");
    expect((await content.body()).subarray(0, 8)).toEqual(png.subarray(0, 8));

    const consistency = await json<{
      readonly missing: readonly unknown[];
      readonly orphanStorageKeys: readonly string[];
      readonly incomplete: readonly unknown[];
      readonly healthyCount: number;
    }>(
      await page.request.post(`${serverUrl}/api/media/consistency`, {
        headers: mutationHeaders,
      }),
    );
    expect(consistency.missing).toEqual([]);
    expect(consistency.orphanStorageKeys).toEqual([]);
    expect(consistency.incomplete).toEqual([]);
    expect(consistency.healthyCount).toBe(1);

    const allowListRejected = await page.request.post(`${serverUrl}/api/media`, {
      headers: {
        ...mutationHeaders,
        "content-type": "image/gif",
        "x-file-name": encodeURIComponent("declared-wrong.png"),
      },
      data: png,
    });
    expect((await problem(allowListRejected, 415)).code).toBe("MEDIA_MIME_NOT_ALLOWED");

    const signatureRejected = await page.request.post(`${serverUrl}/api/media`, {
      headers: {
        ...mutationHeaders,
        "content-type": "image/jpeg",
        "x-file-name": encodeURIComponent("declared-jpeg.jpg"),
      },
      data: png,
    });
    expect((await problem(signatureRejected, 415)).code).toBe("MEDIA_MIME_MISMATCH");

    const pathRejected = await page.request.post(`${serverUrl}/api/media`, {
      headers: {
        ...mutationHeaders,
        "content-type": "image/png",
        "x-file-name": encodeURIComponent("../escape.png"),
      },
      data: png,
    });
    expect((await problem(pathRejected, 422)).code).toBe("MEDIA_FILE_NAME_INVALID");

    const oversizedPng = Buffer.alloc(1_048_577);
    png.copy(oversizedPng);
    const sizeRejected = await page.request.post(`${serverUrl}/api/media`, {
      headers: {
        ...mutationHeaders,
        "content-type": "image/png",
        "x-file-name": encodeURIComponent("too-large.png"),
      },
      data: oversizedPng,
    });
    expect((await problem(sizeRejected, 413)).code).toBe("MEDIA_SIZE_LIMIT_EXCEEDED");
  });

  async function createDocument(
    collectionId: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<DocumentRecord> {
    let hierarchy: {
      readonly parentId: null;
      readonly position: number;
      readonly expectedVersion: number;
    } | undefined;
    if (collectionId === "col_blog_categories" || collectionId === "col_blog_pages") {
      const tree = await json<HierarchyTree>(
        await page.request.get(`${serverUrl}/api/collections/${collectionId}/tree`),
      );
      hierarchy = {
        parentId: null,
        position: tree.items.filter(({ parentId }) => parentId === null).length,
        expectedVersion: tree.version,
      };
    }
    return json<DocumentRecord>(
      await page.request.post(
        `${serverUrl}/api/collections/${collectionId}/documents`,
        {
          headers: mutationHeaders,
          data: { data, ...(hierarchy === undefined ? {} : { hierarchy }) },
        },
      ),
    );
  }

  async function getDocument(
    collectionId: string,
    documentId: string,
  ): Promise<DocumentRecord> {
    return json<DocumentRecord>(
      await page.request.get(
        `${serverUrl}/api/collections/${collectionId}/documents/${documentId}`,
      ),
    );
  }

  async function getDeletedDocument(
    collectionId: string,
    documentId: string,
  ): Promise<DocumentRecord> {
    const deleted = await json<DocumentList>(
      await page.request.get(
        `${serverUrl}/api/collections/${collectionId}/documents?state=deleted`,
      ),
    );
    const document = deleted.items.find(({ id }) => id === documentId);
    expect(document).toBeDefined();
    return document!;
  }

  async function softDelete(
    collectionId: string,
    document: DocumentRecord,
  ): Promise<DocumentRecord> {
    await ok(
      await page.request.delete(
        `${serverUrl}/api/collections/${collectionId}/documents/${document.id}`,
        {
          headers: mutationHeaders,
          data: { expectedVersion: document.version },
        },
      ),
    );
    return getDeletedDocument(collectionId, document.id);
  }

  async function restoreDeleted(
    collectionId: string,
    document: DocumentRecord,
  ): Promise<DocumentRecord> {
    return json<DocumentRecord>(
      await page.request.post(
        `${serverUrl}/api/collections/${collectionId}/documents/${document.id}/restore`,
        {
          headers: mutationHeaders,
          data: { expectedVersion: document.version },
        },
      ),
    );
  }

  async function purge(
    collectionId: string,
    document: DocumentRecord,
  ): Promise<APIResponse> {
    return page.request.delete(
      `${serverUrl}/api/collections/${collectionId}/documents/${document.id}/purge`,
      {
        headers: mutationHeaders,
        data: { expectedVersion: document.version },
      },
    );
  }

  await test.step("Singleton과 upload reference 경계를 고정한다", async () => {
    const invalidMedia = await page.request.post(
      `${serverUrl}/api/collections/col_blog_site/documents`,
      {
        headers: mutationHeaders,
        data: { data: { siteName: "Invalid", logo: "media_missing" } },
      },
    );
    expect(invalidMedia.status()).toBe(422);

    await createDocument("col_blog_site", {
      siteName: "XeCMS Blog",
      description: "M2 Content Core 검증 사이트",
      theme: "system",
      logo: mediaId,
      seo: { title: "XeCMS Blog", noIndex: false },
      socialLinks: [{ label: "Repository", url: "https://example.invalid/xecms" }],
    });

    const duplicate = await page.request.post(
      `${serverUrl}/api/collections/col_blog_site/documents`,
      {
        headers: mutationHeaders,
        data: { data: { siteName: "두 번째 설정", theme: "dark" } },
      },
    );
    expect((await problem(duplicate, 409)).code).toBe("SINGLETON_ALREADY_EXISTS");
  });

  let author: DocumentRecord;
  let category: DocumentRecord;
  let anchorPost: DocumentRecord;
  let relatedPost: DocumentRecord;
  let comment: DocumentRecord;

  await test.step("one/many Relation은 target Collection과 stable Document ID를 검사한다", async () => {
    author = await createDocument("col_blog_authors", {
      name: "M2 Author",
      bio: "stable relation 검증 작성자",
      avatar: mediaId,
      roles: ["writer", "editor"],
      metadata: { source: "m2-e2e" },
    });
    category = await createDocument("col_blog_categories", {
      title: "Engineering",
      slug: "engineering",
    });

    const unknownTarget = await page.request.post(
      `${serverUrl}/api/collections/col_blog_posts/documents`,
      {
        headers: mutationHeaders,
        data: {
          data: {
            title: "잘못된 관계",
            slug: "invalid-relation",
            body: richText("invalid"),
            status: "draft",
            kind: "article",
            author: "doc_missing",
          },
        },
      },
    );
    expect(unknownTarget.status()).toBe(422);

    const wrongCollection = await page.request.post(
      `${serverUrl}/api/collections/col_blog_posts/documents`,
      {
        headers: mutationHeaders,
        data: {
          data: {
            title: "잘못된 컬렉션 관계",
            slug: "wrong-collection-relation",
            body: richText("invalid"),
            status: "draft",
            kind: "article",
            author: category.id,
          },
        },
      },
    );
    expect(wrongCollection.status()).toBe(422);

    anchorPost = await createDocument("col_blog_posts", {
      title: "Stable target",
      slug: "stable-target",
      body: richText("첫 번째 revision"),
      status: "ready",
      kind: "tutorial",
      author: author.id,
      category: category.id,
      cover: mediaId,
      gallery: [mediaId],
      sections: [{ heading: "M2", body: "Schema breadth" }],
      layout: { width: "wide", showTableOfContents: true },
      contentBlocks: [
        {
          componentId: "cmp_blog_callout",
          data: { tone: "info", body: "stable block value" },
        },
      ],
    });
    relatedPost = await createDocument("col_blog_posts", {
      title: "Stable source",
      slug: "stable-source",
      body: richText("relation source"),
      status: "draft",
      kind: "article",
      author: author.id,
      category: category.id,
      relatedPosts: [anchorPost.id],
    });
    comment = await createDocument("col_blog_comments", {
      name: "Reader",
      message: "cascade policy test",
      post: anchorPost.id,
    });
  });

  await test.step("publish와 revision restore 뒤에도 Relation의 Document ID가 유지된다", async () => {
    anchorPost = await json<DocumentRecord>(
      await page.request.post(
        `${serverUrl}/api/collections/col_blog_posts/documents/${anchorPost.id}/publish`,
        { headers: mutationHeaders, data: { expectedVersion: anchorPost.version } },
      ),
    );
    anchorPost = await json<DocumentRecord>(
      await page.request.patch(
        `${serverUrl}/api/collections/col_blog_posts/documents/${anchorPost.id}`,
        {
          headers: mutationHeaders,
          data: {
            expectedVersion: anchorPost.version,
            data: {
              ...anchorPost.data,
              title: "Stable target edited",
              body: richText("두 번째 revision"),
            },
          },
        },
      ),
    );

    const history = await json<RevisionList>(
      await page.request.get(
        `${serverUrl}/api/collections/col_blog_posts/documents/${anchorPost.id}/revisions`,
      ),
    );
    const firstRevision = [...history.items].sort((left, right) => left.sequence - right.sequence)[0];
    expect(firstRevision).toBeDefined();
    anchorPost = await json<DocumentRecord>(
      await page.request.post(
        `${serverUrl}/api/collections/col_blog_posts/documents/${anchorPost.id}/revisions/${firstRevision!.id}/restore`,
        {
          headers: mutationHeaders,
          data: { expectedVersion: history.documentVersion },
        },
      ),
    );

    relatedPost = await getDocument("col_blog_posts", relatedPost.id);
    expect(relatedPost.data["relatedPosts"]).toEqual([anchorPost.id]);
    expect(relatedPost.data["author"]).toBe(author.id);
  });

  await test.step("soft delete/restore는 identity와 Relation을 그대로 보존한다", async () => {
    author = await getDocument("col_blog_authors", author.id);
    author = await softDelete("col_blog_authors", author);
    relatedPost = await getDocument("col_blog_posts", relatedPost.id);
    expect(relatedPost.data["author"]).toBe(author.id);
    author = await restoreDeleted("col_blog_authors", author);
    expect(author.id).toBe(relatedPost.data["author"]);

    category = await getDocument("col_blog_categories", category.id);
    category = await softDelete("col_blog_categories", category);
    relatedPost = await getDocument("col_blog_posts", relatedPost.id);
    expect(relatedPost.data["category"]).toBe(category.id);
    category = await restoreDeleted("col_blog_categories", category);
    expect(category.id).toBe(relatedPost.data["category"]);

    anchorPost = await getDocument("col_blog_posts", anchorPost.id);
    anchorPost = await softDelete("col_blog_posts", anchorPost);
    relatedPost = await getDocument("col_blog_posts", relatedPost.id);
    expect(relatedPost.data["relatedPosts"]).toEqual([anchorPost.id]);
    expect((await getDocument("col_blog_comments", comment.id)).data["post"]).toBe(
      anchorPost.id,
    );
    anchorPost = await restoreDeleted("col_blog_posts", anchorPost);
  });

  await test.step("hard purge에서 restrict, nullify, cascade 정책을 함께 검증한다", async () => {
    author = await softDelete("col_blog_authors", author);
    const restricted = await purge("col_blog_authors", author);
    expect((await problem(restricted, 409)).code).toBe("RELATION_DELETE_RESTRICTED");
    author = await restoreDeleted("col_blog_authors", author);

    category = await softDelete("col_blog_categories", category);
    await ok(await purge("col_blog_categories", category));
    anchorPost = await getDocument("col_blog_posts", anchorPost.id);
    relatedPost = await getDocument("col_blog_posts", relatedPost.id);
    expect(anchorPost.data["category"] ?? null).toBeNull();
    expect(relatedPost.data["category"] ?? null).toBeNull();

    anchorPost = await softDelete("col_blog_posts", anchorPost);
    await ok(await purge("col_blog_posts", anchorPost));
    relatedPost = await getDocument("col_blog_posts", relatedPost.id);
    expect(relatedPost.data["relatedPosts"]).toEqual([]);

    const removedComment = await page.request.get(
      `${serverUrl}/api/collections/col_blog_comments/documents/${comment.id}`,
    );
    expect(removedComment.status()).toBe(404);
  });

  const pageDocuments: DocumentRecord[] = [];

  await test.step("forest를 만들고 move/reorder path를 재현한다", async () => {
    for (const [title, slug] of [
      ["Root A", "root-a"],
      ["Root B", "root-b"],
      ["Child", "child"],
      ["Grandchild", "grandchild"],
      ["Too deep", "too-deep"],
    ] as const) {
      pageDocuments.push(
        await createDocument("col_blog_pages", {
          title,
          slug,
          body: richText(`${title} body`),
        }),
      );
    }

    const [rootA, rootB, child, grandchild, tooDeep] = pageDocuments as [
      DocumentRecord,
      DocumentRecord,
      DocumentRecord,
      DocumentRecord,
      DocumentRecord,
    ];
    let tree = await json<HierarchyTree>(
      await page.request.get(`${serverUrl}/api/collections/col_blog_pages/tree`),
    );
    expect(tree.items.filter(({ parentId }) => parentId === null)).toHaveLength(5);

    await json<unknown>(await movePage(child.id, {
      newParentId: rootA.id,
      position: 0,
      expectedVersion: tree.version,
    }));
    tree = await json<HierarchyTree>(
      await page.request.get(`${serverUrl}/api/collections/col_blog_pages/tree`),
    );
    await json<unknown>(await movePage(grandchild.id, {
      newParentId: child.id,
      position: 0,
      expectedVersion: tree.version,
    }));
    tree = await json<HierarchyTree>(
      await page.request.get(`${serverUrl}/api/collections/col_blog_pages/tree`),
    );

    const ids = (item: HierarchyTreeItem) => item.documentId ?? item.document?.id ?? "";
    expect(tree.items.filter(({ parentId }) => parentId === null).map(ids)).toEqual(
      expect.arrayContaining([rootA.id, rootB.id, tooDeep.id]),
    );
    expect(tree.items.find((item) => ids(item) === grandchild.id)).toMatchObject({
      parentId: child.id,
      depth: 2,
      path: [rootA.id, child.id, grandchild.id],
    });

    const structureVersion = tree.version;
    const deletedChild = await softDelete("col_blog_pages", child);
    const preservedTree = await json<HierarchyTree>(
      await page.request.get(`${serverUrl}/api/collections/col_blog_pages/tree`),
    );
    expect(preservedTree.version).toBe(structureVersion);
    expect(preservedTree.items.find((item) => ids(item) === child.id)).toMatchObject({
      parentId: rootA.id,
      depth: 1,
      path: [rootA.id, child.id],
    });
    await restoreDeleted("col_blog_pages", deletedChild);

    await json<HierarchyTree>(
      await page.request.post(`${serverUrl}/api/collections/col_blog_pages/tree/reorder`, {
        headers: mutationHeaders,
        data: {
          parentId: null,
          orderedDocumentIds: [rootB.id, rootA.id, tooDeep.id],
          expectedVersion: tree.version,
        },
      }),
    );
    tree = await json<HierarchyTree>(
      await page.request.get(`${serverUrl}/api/collections/col_blog_pages/tree`),
    );
    expect(tree.items.filter(({ parentId }) => parentId === null).map(ids)).toEqual([
      rootB.id,
      rootA.id,
      tooDeep.id,
    ]);

    const cycle = await movePage(rootA.id, {
      newParentId: grandchild.id,
      position: 0,
      expectedVersion: tree.version,
    });
    expect((await problem(cycle, 422)).code).toBe("HIERARCHY_CYCLE");

    const tooDeepMove = await movePage(tooDeep.id, {
      newParentId: grandchild.id,
      position: 0,
      expectedVersion: tree.version,
    });
    expect((await problem(tooDeepMove, 422)).code).toBe(
      "HIERARCHY_MAX_DEPTH_EXCEEDED",
    );

    const crossCollection = await movePage(rootB.id, {
      newParentId: author.id,
      position: 0,
      expectedVersion: tree.version,
    });
    expect([404, 422]).toContain(crossCollection.status());
  });

  await test.step("Admin의 Schema, Tree View, Media 화면이 같은 데이터를 표시한다", async () => {
    await page.goto("/admin/schema");
    await expect(page.locator("body")).toContainText("사이트 설정");

    await page.goto("/admin/schema/tools");
    await expect(
      page.getByRole("heading", { name: "Manifest · TypeScript" }),
    ).toBeVisible();
    await expect(page.getByLabel("Schema JSON")).toHaveValue(canonicalManifest);
    await expect(page.locator("pre")).toContainText("SiteSettingsDocument");

    await page.goto("/admin/content/col_blog_posts/new");
    await page.getByLabel("제목").fill("Admin UI 작성 글");
    await page.getByLabel("슬러그").fill("admin-ui-post");
    await page.getByRole("textbox", { name: "본문", exact: true }).fill(
      "브라우저에서 rich-text를 작성했습니다.",
    );
    await page.getByLabel("편집 상태").click();
    await page.locator('[role="option"][data-key="ready"]').click();
    await page.getByLabel("글 유형").click();
    await page.locator('[role="option"][data-key="article"]').click();
    await page.getByLabel("작성자").click();
    await page.locator(`[role="option"][data-key="${author.id}"]`).click();
    await page.getByLabel("대표 이미지").click();
    await page.locator(`[role="option"][data-key="${mediaId}"]`).click();
    await action(page, /문서 저장/).click();
    await expect(page).toHaveURL(/\/admin\/content\/col_blog_posts(?:\/)?$/);
    await expect(page.locator("body")).toContainText("Admin UI 작성 글");

    await page.goto("/admin/content/col_blog_pages");
    await page.getByRole("button", { name: "트리 보기", exact: true }).click();
    await expect(page.getByRole("region", { name: /페이지 콘텐츠 트리/ })).toBeVisible();
    await expect(page.locator("body")).toContainText("Root A");
    await expect(page.locator("body")).toContainText("Child");

    const [uiRootA, , , uiGrandchild, uiTooDeep] = pageDocuments as [
      DocumentRecord,
      DocumentRecord,
      DocumentRecord,
      DocumentRecord,
      DocumentRecord,
    ];
    const rootARow = page.getByRole("listitem").filter({
      has: page.getByRole("link", { name: new RegExp(`^Root A · ${uiRootA.id}$`) }),
    });
    await expect(rootARow.locator(`option[value="${uiGrandchild.id}"]`)).toHaveCount(0);

    const tooDeepRow = page.getByRole("listitem").filter({
      has: page.getByRole("link", { name: new RegExp(`^Too deep · ${uiTooDeep.id}$`) }),
    });
    await tooDeepRow.locator("select").selectOption(uiGrandchild.id);
    await tooDeepRow.getByRole("button", { name: "이동", exact: true }).click();
    await expect(page.getByText("요청을 완료하지 못했습니다.")).toBeVisible();
    const treeAfterUiRejection = await json<HierarchyTree>(
      await page.request.get(`${serverUrl}/api/collections/col_blog_pages/tree`),
    );
    expect(
      treeAfterUiRejection.items.find(
        (item) => (item.documentId ?? item.document?.id) === uiTooDeep.id,
      )?.parentId,
    ).toBeNull();

    await page.goto("/admin/media");
    await expect(page.locator("body")).toContainText("blog-cover.png");
    await page.locator('input[type="file"]').setInputFiles({
      name: "browser-upload.png",
      mimeType: "image/png",
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]),
    });
    await page.getByRole("button", { name: "파일 업로드" }).click();
    await expect(page.locator("body")).toContainText("browser-upload.png");
    await page.getByRole("button", { name: "일관성 검사" }).click();
    await expect(page.locator("body")).toContainText("누락 파일 0개 · 고아 파일 0개");
  });

  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
