import { expect, test, type APIResponse, type Page } from "./fixtures.js";

const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3120";
const ownerPassword = process.env.XECMS_E2E_OWNER_PASSWORD ?? "Admin-test-only-2026!";

interface AdminSession { readonly csrfToken: string }
interface Realm {
  readonly realmId: string;
  readonly name: string;
  readonly status: string;
  readonly revision: number;
  readonly authentication: { readonly defaultRoleIds: readonly string[] };
}

async function login(page: Page): Promise<AdminSession> {
  await page.goto("/admin/login");
  const form = page.getByRole("form", { name: "로그인" });
  await form.getByLabel("사용자 이름").fill("admin");
  await form.getByLabel("비밀번호").fill(ownerPassword);
  await form.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema\/?$/);
  const session = await page.request.get(`${serverUrl}/api/auth/session`);
  expect(session.ok()).toBe(true);
  return await session.json() as AdminSession;
}

async function mutate(page: Page, session: AdminSession, method: "post" | "put" | "patch", path: string, data: unknown): Promise<APIResponse> {
  return page.request[method](`${serverUrl}${path}`, {
    data,
    headers: { "x-csrf-token": session.csrfToken, origin: serverUrl },
  });
}

test("M4-A Realm Admin과 Community 사용자 흐름을 Chromium에서 완주한다", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  const session = await login(page);
  const realmResponse = await mutate(page, session, "post", "/api/identity-realms", {
    key: "community",
    name: "Community",
    acceptSystemIdentities: true,
    provisioning: "explicit",
    registration: "open",
    defaultRoleIds: [],
  });
  expect(realmResponse.status(), await realmResponse.text()).toBe(201);
  let realm = await realmResponse.json() as Realm;

  const imported = await mutate(page, session, "put", "/api/schema/manifest", {
    baseRevisionId: null,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [
        {
          id: "col_members", name: "members", label: "Members",
          fields: [
            { id: "fld_member_email", name: "email", label: "Email", type: "text", required: true, unique: true },
            { id: "fld_member_name", name: "displayName", label: "Display name", type: "text", required: true },
          ],
          auth: { enabled: true, realmKey: "community", identifierFieldIds: ["fld_member_email"], acceptSystemIdentities: true, provisioning: "explicit", defaultRoleIds: [] },
        },
        {
          id: "col_articles", name: "articles", label: "Articles",
          fields: [
            { id: "fld_article_title", name: "title", label: "Title", type: "text", required: true },
            { id: "fld_article_body", name: "body", label: "Body", type: "textarea", required: true },
          ],
        },
      ],
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const draft = await imported.json();
  const preview = await mutate(page, session, "post", "/api/schema/preview", { expectedDraftVersion: draft.draftVersion });
  expect(preview.status(), await preview.text()).toBe(200);
  const plan = await preview.json();
  const applied = await mutate(page, session, "post", "/api/schema/apply", {
    planId: plan.planId,
    expectedRevisionId: null,
    expectedDraftVersion: draft.draftVersion,
    approveDestructive: false,
  });
  expect(applied.status(), await applied.text()).toBe(200);

  const realmDetail = await page.request.get(`${serverUrl}/api/identity-realms/${realm.realmId}`);
  expect(realmDetail.ok()).toBe(true);
  realm = await realmDetail.json() as Realm;
  const contentAdminRole = `authorization:${realm.realmId}:role:content-administrator`;
  const elevated = await mutate(page, session, "patch", `/api/identity-realms/${realm.realmId}`, {
    expectedRevision: realm.revision, name: realm.name, status: "active",
    acceptSystemIdentities: true, provisioning: "explicit", registration: "open",
    defaultRoleIds: [contentAdminRole],
  });
  expect(elevated.ok(), await elevated.text()).toBe(true);
  realm = await elevated.json() as Realm;
  const identityResponse = await page.request.get(`${serverUrl}/api/global-identities`);
  const adminIdentity = (await identityResponse.json()).items.find((item: { primaryIdentifier: string }) => item.primaryIdentifier === "admin");
  const provisioned = await mutate(page, session, "post", `/api/identity-realms/${realm.realmId}/memberships`, {
    globalIdentityId: adminIdentity.globalIdentityId,
    profile: { displayName: "Realm Administrator" },
    password: ownerPassword,
  });
  expect(provisioned.status(), await provisioned.text()).toBe(201);
  const resetDefaults = await mutate(page, session, "patch", `/api/identity-realms/${realm.realmId}`, {
    expectedRevision: realm.revision, name: realm.name, status: "active",
    acceptSystemIdentities: true, provisioning: "explicit", registration: "open", defaultRoleIds: [],
  });
  expect(resetDefaults.ok(), await resetDefaults.text()).toBe(true);

  await test.step("Admin Realm 상세와 독립 권한 정책 화면을 연다", async () => {
    await page.goto(`/admin/realms/${encodeURIComponent(realm.realmId)}`);
    await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
    await expect(page.getByText("활성", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Realm 권한 관리" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/roles`));
    await expect(page.getByRole("heading", { name: "레벨과 역할" })).toBeVisible();
    await expect(page.getByText("Editor", { exact: true })).toBeVisible();
  });

  await test.step("Community에서 가입 후 권한이 없음을 확인한다", async () => {
    await page.goto("/community/community");
    await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.getByLabel("Identifier").fill("browser-member@example.test");
    await page.getByLabel("비밀번호").fill("Browser-member-2026!");
    await page.getByLabel("Profile JSON").fill(JSON.stringify({ displayName: "Browser Member" }, null, 2));
    await page.getByRole("button", { name: "계정 만들기" }).click();
    await expect(page.getByText("SIGNED IN", { exact: true })).toBeVisible();
    await expect(page.getByText("부여된 콘텐츠 권한이 없습니다.")).toBeVisible();
  });

  await test.step("Realm UI에서 Subject에 Collection Scope 역할을 부여한다", async () => {
    await page.goto(`/admin/realms/${encodeURIComponent(realm.realmId)}/access/bindings`);
    await expect(page.getByRole("heading", { name: "역할 배정", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "역할 배정하기" }).click();
    const editor = page.getByRole("region", { name: "역할 배정 편집기" });
    await editor.getByLabel("사용자 또는 그룹").selectOption({ label: "browser-member@example.test · 사용자" });
    await editor.getByLabel("부여할 역할").selectOption({ label: "Editor · Editors 레벨 40" });
    const scope = editor.getByRole("group", { name: "적용할 영역" });
    await scope.getByRole("button", { name: "articles, Collection" }).click();
    await scope.getByRole("radio", { name: /현재 \+ 모든 하위/ }).check();
    await editor.getByRole("button", { name: "역할 배정", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "browser-member@example.test" })).toContainText("Editor");
  });

  await test.step("Community에서 허용된 문서를 생성하고 수정한다", async () => {
    await page.goto("/community/community");
    await expect(page.getByRole("button", { name: /Articles/ })).toBeVisible();
    const documentEditor = page.getByLabel("Document JSON");
    await documentEditor.fill(JSON.stringify({ title: "Browser article", body: "Created through Content Realm" }, null, 2));
    await page.getByRole("button", { name: "문서 생성" }).click();
    await expect(page.getByRole("button", { name: /Browser article/ })).toBeVisible();
    await page.getByRole("button", { name: /Browser article/ }).click();
    await documentEditor.fill(JSON.stringify({ title: "Browser article updated", body: "Scoped edit" }, null, 2));
    await page.getByRole("button", { name: "수정 저장" }).click();
    await expect(page.getByRole("button", { name: /Browser article updated/ })).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
