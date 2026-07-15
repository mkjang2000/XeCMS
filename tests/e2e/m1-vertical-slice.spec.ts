import { expect, test, type Locator, type Page } from "@playwright/test";

const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3100";
const ownerPassword = "Admin-test-only-2026!";

interface CollectionList {
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

interface DocumentList {
  readonly items: readonly {
    readonly id: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly version: number;
  }[];
  readonly total: number;
}

interface PublishedDocument {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly revisionId: string;
  readonly updatedAt: string;
}

interface PublishedDocumentList {
  readonly items: readonly PublishedDocument[];
  readonly total: number;
}

async function activate(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.click();
}

function action(page: Page, name: string) {
  return page
    .getByRole("button", { name, exact: true })
    .or(page.getByRole("link", { name, exact: true }))
    .first();
}

async function chooseFieldType(
  page: Page,
  field: Locator,
  optionName: string,
) {
  await field.getByLabel("필드 유형").click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

test("setup부터 Schema, migration, Document REST 정합성까지 완주한다", async ({
  page,
  context,
}) => {
  await test.step("빈 Instance의 최초 Owner를 한 번만 생성한다", async () => {
    await page.goto("/admin/setup");

    const setupForm = page.getByRole("form", { name: "초기 관리자 설정" });
    await expect(setupForm).toBeVisible();
    await setupForm.getByLabel("사용자 이름").fill("admin");
    await setupForm.getByLabel("비밀번호").first().fill(ownerPassword);
    await setupForm.getByLabel("비밀번호 확인").fill(ownerPassword);
    await setupForm.getByRole("button", { name: "초기 관리자 생성" }).click();

    await expect(page).toHaveURL(/\/admin\/schema(?:\/)?$/);

    const statusResponse = await page.request.get(
      `${serverUrl}/api/bootstrap/status`,
    );
    expect(statusResponse.ok()).toBe(true);
    expect(await statusResponse.json()).toMatchObject({ required: false });

    const repeatedBootstrap = await page.request.post(
      `${serverUrl}/api/bootstrap`,
      { data: { username: "another-admin", password: "another-password" } },
    );
    expect(repeatedBootstrap.status()).toBe(409);
  });

  await test.step("세션 없이 다시 접근하고 최초 Owner로 로그인한다", async () => {
    await context.clearCookies();
    await page.goto("/admin/schema");
    await expect(page).toHaveURL(/\/admin\/login(?:\/)?$/);

    const loginForm = page.getByRole("form", { name: "로그인" });
    await expect(loginForm).toBeVisible();
    await loginForm.getByLabel("사용자 이름").fill("admin");
    await loginForm.getByLabel("비밀번호").fill(ownerPassword);
    await loginForm.getByRole("button", { name: "로그인" }).click();

    await expect(page).toHaveURL(/\/admin\/schema(?:\/)?$/);
    await expect(page.getByRole("navigation")).toContainText("스키마");
    await expect(page.getByRole("navigation")).toContainText("콘텐츠");
  });

  await test.step("Posts Collection과 세 필드를 만들고 migration을 적용한다", async () => {
    await activate(action(page, "새 콘텐츠 타입"));
    await expect(page).toHaveURL(/\/admin\/schema\/new(?:\/)?$/);

    await page.getByRole("textbox", { name: /^이름/ }).fill("posts");
    await page.getByLabel("표시 이름").fill("게시글");

    const fields = [
      { name: "title", label: "제목", type: "텍스트", required: true },
      { name: "body", label: "본문", type: "텍스트", required: false },
      {
        name: "publishedAt",
        label: "게시 일시",
        type: "날짜 및 시간",
        required: false,
      },
    ] as const;

    for (const [index, definition] of fields.entries()) {
      if (index > 0) {
        await activate(action(page, "필드 추가"));
      }
      const field = page.getByRole("group", { name: `필드 ${index + 1}` });
      await expect(field).toBeVisible();
      await field.getByLabel("필드 이름").fill(definition.name);
      await field.getByLabel("필드 레이블").fill(definition.label);
      await chooseFieldType(page, field, definition.type);
      if (definition.required) {
        const required = field.getByRole("checkbox", { name: "필수 필드" });
        await field.getByText("필수 필드", { exact: true }).click();
        await expect(required).toBeChecked();
      }
    }

    await activate(action(page, "변경 사항 검토"));
    await expect(page).toHaveURL(/\/admin\/schema\/[^/]+\/changes(?:\/)?$/);
    await expect(page.getByRole("heading", { name: "Schema 변경" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Database 작업" })).toBeVisible();

    await activate(action(page, "변경 적용"));
    await expect(page).toHaveURL(/\/admin\/content\/[^/]+(?:\/)?$/);
  });

  let collectionId = "";

  await test.step("적용한 Collection이 REST API에도 나타난다", async () => {
    const response = await page.request.get(`${serverUrl}/api/collections`);
    expect(response.ok()).toBe(true);

    const collections = (await response.json()) as CollectionList;
    const posts = collections.items.find((collection) => collection.name === "posts");
    expect(posts).toBeDefined();
    collectionId = posts?.id ?? "";
  });

  let documentId = "";

  await test.step("문서를 UI에서 만들고 REST API에서 같은 값을 읽는다", async () => {
    await page.goto(`/admin/content/${collectionId}`);
    await activate(action(page, "새 문서"));
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}/new(?:/)?$`),
    );

    await page.getByLabel("제목").fill("첫 번째 게시글");
    await page.getByLabel("본문").fill("XeCMS M1 문서입니다.");
    await page.getByLabel("게시 일시").fill("2026-07-15T09:30");
    await activate(action(page, "문서 저장"));

    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );

    const response = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents`,
    );
    expect(response.ok()).toBe(true);
    const documents = (await response.json()) as DocumentList;
    expect(documents.total).toBe(1);
    expect(documents.items[0]?.data).toMatchObject({
      title: "첫 번째 게시글",
      body: "XeCMS M1 문서입니다.",
    });
    documentId = documents.items[0]?.id ?? "";
  });

  await test.step("문서 편집 결과가 REST API와 일치한다", async () => {
    const documentRow = page
      .getByRole("row")
      .filter({ hasText: "첫 번째 게시글" });
    await expect(documentRow).toBeVisible();
    await documentRow.getByRole("cell").nth(1).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}/${documentId}(?:/)?$`),
    );
    await expect(page.getByRole("heading", { name: "문서 편집" })).toBeVisible();
    await page.getByLabel("제목").fill("수정된 게시글");
    await activate(action(page, "문서 저장"));
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );

    const response = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents/${documentId}`,
    );
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      id: documentId,
      data: { title: "수정된 게시글" },
      version: 2,
    });
  });

  await test.step("문서를 UI에서 삭제하면 REST 목록에서도 사라진다", async () => {
    await page.goto(`/admin/content/${collectionId}/${documentId}`);
    await activate(action(page, "문서 삭제"));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "문서 삭제" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );

    const response = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents`,
    );
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ items: [], total: 0 });
  });
});

test("문서 게시, 버전 복원, 휴지통과 영구 삭제까지 완주한다", async ({
  page,
}) => {
  const publishedTitle = "M2 라이프사이클 게시글";
  const draftTitle = "M2 비공개 변경 초안";

  await test.step("최초 Owner로 로그인하고 Posts 컬렉션을 찾는다", async () => {
    await page.goto("/admin/login");

    const loginForm = page.getByRole("form", { name: "로그인" });
    await expect(loginForm).toBeVisible();
    await loginForm.getByLabel("사용자 이름").fill("admin");
    await loginForm.getByLabel("비밀번호").fill(ownerPassword);
    await loginForm.getByRole("button", { name: "로그인" }).click();

    await expect(page).toHaveURL(/\/admin\/schema(?:\/)?$/);
  });

  let collectionId = "";
  let documentId = "";

  await test.step("새 초안을 만들면 아직 공개 API에는 나타나지 않는다", async () => {
    const collectionsResponse = await page.request.get(
      `${serverUrl}/api/collections`,
    );
    expect(collectionsResponse.ok()).toBe(true);
    const collections = (await collectionsResponse.json()) as CollectionList;
    collectionId =
      collections.items.find((collection) => collection.name === "posts")?.id ??
      "";
    expect(collectionId).not.toBe("");

    await page.goto(`/admin/content/${collectionId}`);
    await activate(action(page, "새 문서"));
    await page.getByLabel("제목").fill(publishedTitle);
    await page.getByLabel("본문").fill("처음 공개할 본문입니다.");
    await activate(action(page, "문서 저장"));
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );

    const documentsResponse = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents`,
    );
    expect(documentsResponse.ok()).toBe(true);
    const documents = (await documentsResponse.json()) as DocumentList;
    documentId =
      documents.items.find((document) => document.data["title"] === publishedTitle)
        ?.id ?? "";
    expect(documentId).not.toBe("");

    await page.goto(`/admin/content/${collectionId}/${documentId}`);
    await expect(
      page.getByRole("status", { name: "문서 상태: 초안", exact: true }),
    ).toBeVisible();

    const unpublished = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(unpublished.status()).toBe(404);
  });

  let publishedRevisionId = "";
  let publishedUpdatedAt = "";

  await test.step("초안을 게시하면 상태와 공개 API가 같은 리비전을 가리킨다", async () => {
    await activate(action(page, "게시"));
    await expect(
      page.getByRole("status", { name: "문서 상태: 게시됨", exact: true }),
    ).toBeVisible();

    const publicDetailResponse = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(publicDetailResponse.ok()).toBe(true);
    const publicDetail = (await publicDetailResponse.json()) as PublishedDocument;
    expect(publicDetail.data).toMatchObject({ title: publishedTitle });
    publishedRevisionId = publicDetail.revisionId;
    publishedUpdatedAt = publicDetail.updatedAt;

    const publicListResponse = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents`,
    );
    expect(publicListResponse.ok()).toBe(true);
    const publicList = (await publicListResponse.json()) as PublishedDocumentList;
    expect(publicList.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: documentId,
          revisionId: publishedRevisionId,
          updatedAt: publishedUpdatedAt,
          data: expect.objectContaining({ title: publishedTitle }),
        }),
      ]),
    );
  });

  await test.step("새 초안을 저장해도 공개 리비전과 공개 수정일은 고정된다", async () => {
    await page.getByLabel("제목").fill(draftTitle);
    await activate(action(page, "문서 저장"));
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );
    await page.goto(`/admin/content/${collectionId}/${documentId}`);

    await expect(
      page.getByRole("status", {
        name: "문서 상태: 게시됨 · 게시되지 않은 변경",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("제목")).toHaveValue(draftTitle);

    const publicDetailResponse = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(publicDetailResponse.ok()).toBe(true);
    expect(await publicDetailResponse.json()).toMatchObject({
      id: documentId,
      revisionId: publishedRevisionId,
      updatedAt: publishedUpdatedAt,
      data: { title: publishedTitle },
    });

    const publicListResponse = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents`,
    );
    expect(publicListResponse.ok()).toBe(true);
    const publicList = (await publicListResponse.json()) as PublishedDocumentList;
    expect(publicList.items.find((document) => document.id === documentId)).toMatchObject({
      revisionId: publishedRevisionId,
      updatedAt: publishedUpdatedAt,
      data: { title: publishedTitle },
    });
  });

  await test.step("버전 1을 새 초안으로 복원하고 변경 사항을 게시한다", async () => {
    await activate(action(page, "버전 기록"));
    await expect(
      page.getByRole("heading", { name: `${draftTitle} 버전 기록` }),
    ).toBeVisible();

    await activate(action(page, "버전 1 미리보기"));
    await expect(page.getByLabel("버전 1 JSON 미리보기")).toContainText(
      publishedTitle,
    );

    await activate(action(page, "새 초안으로 복원"));
    const restoreDialog = page.getByRole("dialog", { name: "버전 복원" });
    await expect(restoreDialog).toBeVisible();
    await restoreDialog
      .getByRole("button", { name: "새 초안으로 복원", exact: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}/${documentId}(?:/)?$`),
    );
    await expect(page.getByLabel("제목")).toHaveValue(publishedTitle);
    await expect(
      page.getByRole("status", {
        name: "문서 상태: 게시됨 · 게시되지 않은 변경",
        exact: true,
      }),
    ).toBeVisible();

    await activate(action(page, "변경 사항 게시"));
    await expect(
      page.getByRole("status", { name: "문서 상태: 게시됨", exact: true }),
    ).toBeVisible();

    const republishedResponse = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(republishedResponse.ok()).toBe(true);
    expect(await republishedResponse.json()).toMatchObject({
      id: documentId,
      data: { title: publishedTitle },
    });
  });

  await test.step("삭제된 게시 문서를 휴지통에서 복원하면 다시 공개된다", async () => {
    await activate(action(page, "문서 삭제"));
    const deleteDialog = page.getByRole("dialog", { name: "문서 삭제" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: "문서 삭제", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );

    const deletedPublic = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(deletedPublic.status()).toBe(404);

    const workspaceNavigation = page.getByRole("group", {
      name: "컬렉션 보기",
    });
    await workspaceNavigation.getByRole("link", { name: "휴지통" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}/trash(?:/)?$`),
    );

    const trashRow = page.getByRole("row").filter({ hasText: publishedTitle });
    await expect(trashRow).toBeVisible();
    await expect(trashRow.getByText("삭제됨", { exact: true })).toBeVisible();
    await trashRow
      .getByRole("button", { name: `${publishedTitle} 복원`, exact: true })
      .click();
    await expect(trashRow).toHaveCount(0);

    await page
      .getByRole("group", { name: "컬렉션 보기" })
      .getByRole("link", { name: "문서 목록" })
      .click();
    const restoredRow = page.getByRole("row").filter({ hasText: publishedTitle });
    await expect(restoredRow).toBeVisible();
    await expect(restoredRow.getByText("게시됨", { exact: true })).toBeVisible();

    const restoredPublic = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(restoredPublic.ok()).toBe(true);
    expect(await restoredPublic.json()).toMatchObject({
      id: documentId,
      data: { title: publishedTitle },
    });
  });

  await test.step("문서 ID를 확인한 영구 삭제는 문서와 버전 기록을 제거한다", async () => {
    const restoredRow = page.getByRole("row").filter({ hasText: publishedTitle });
    await restoredRow
      .getByRole("link", { name: publishedTitle, exact: true })
      .click();
    await activate(action(page, "문서 삭제"));
    const deleteDialog = page.getByRole("dialog", { name: "문서 삭제" });
    await deleteDialog
      .getByRole("button", { name: "문서 삭제", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/${collectionId}(?:/)?$`),
    );

    await page
      .getByRole("group", { name: "컬렉션 보기" })
      .getByRole("link", { name: "휴지통" })
      .click();
    const purgeRow = page.getByRole("row").filter({ hasText: publishedTitle });
    await expect(purgeRow).toBeVisible();

    const staleDocumentResponse = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents/${documentId}`,
    );
    expect(staleDocumentResponse.ok()).toBe(true);
    const staleVersion = (
      (await staleDocumentResponse.json()) as { readonly version: number }
    ).version;

    await purgeRow
      .getByRole("button", {
        name: `${publishedTitle} 영구 삭제`,
        exact: true,
      })
      .click();

    const purgeDialog = page.getByRole("dialog", { name: "문서 영구 삭제" });
    await expect(purgeDialog).toBeVisible();
    const purgeButton = purgeDialog.getByRole("button", {
      name: "영구 삭제",
      exact: true,
    });
    await expect(purgeButton).toBeDisabled();

    const sessionResponse = await page.request.get(
      `${serverUrl}/api/auth/session`,
    );
    expect(sessionResponse.ok()).toBe(true);
    const csrfToken = (
      (await sessionResponse.json()) as { readonly csrfToken: string }
    ).csrfToken;
    expect(csrfToken.length).toBeGreaterThan(32);

    const restoredResponse = await page.request.post(
      `${serverUrl}/api/collections/${collectionId}/documents/${documentId}/restore`,
      {
        data: { expectedVersion: staleVersion },
        headers: { "x-csrf-token": csrfToken },
      },
    );
    expect(restoredResponse.ok()).toBe(true);
    const restoredVersion = (
      (await restoredResponse.json()) as { readonly version: number }
    ).version;
    expect(restoredVersion).toBe(staleVersion + 1);

    const deletedResponse = await page.request.delete(
      `${serverUrl}/api/collections/${collectionId}/documents/${documentId}`,
      {
        data: { expectedVersion: restoredVersion },
        headers: { "x-csrf-token": csrfToken },
      },
    );
    expect(deletedResponse.status()).toBe(204);

    await purgeDialog
      .getByLabel("확인을 위해 문서 ID 입력")
      .fill(documentId);
    await expect(purgeButton).toBeEnabled();
    await purgeButton.click();

    await expect(purgeDialog).toHaveCount(0);
    const conflictNotice = page.getByText(
      "다른 변경이 먼저 저장되었습니다.",
      { exact: true },
    );
    await expect(conflictNotice).toBeVisible();
    await activate(action(page, "최신 버전 불러오기"));
    await expect(conflictNotice).toHaveCount(0);
    await expect(purgeRow).toBeVisible();

    await purgeRow
      .getByRole("button", {
        name: `${publishedTitle} 영구 삭제`,
        exact: true,
      })
      .click();
    const currentPurgeDialog = page.getByRole("dialog", {
      name: "문서 영구 삭제",
    });
    await expect(currentPurgeDialog).toBeVisible();
    const currentPurgeButton = currentPurgeDialog.getByRole("button", {
      name: "영구 삭제",
      exact: true,
    });
    await expect(currentPurgeButton).toBeDisabled();
    await currentPurgeDialog
      .getByLabel("확인을 위해 문서 ID 입력")
      .fill(documentId);
    await expect(currentPurgeButton).toBeEnabled();
    await currentPurgeButton.click();
    await expect(purgeRow).toHaveCount(0);

    const adminDocument = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents/${documentId}`,
    );
    expect(adminDocument.status()).toBe(404);
    const revisions = await page.request.get(
      `${serverUrl}/api/collections/${collectionId}/documents/${documentId}/revisions`,
    );
    expect(revisions.status()).toBe(404);
    const publicDocument = await page.request.get(
      `${serverUrl}/api/content/${collectionId}/documents/${documentId}`,
    );
    expect(publicDocument.status()).toBe(404);
  });
});
