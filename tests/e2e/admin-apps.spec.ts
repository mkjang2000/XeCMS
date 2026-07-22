import { expect, test, type APIResponse, type Page } from "./fixtures.js";

const OWNER_PASSWORD = process.env["XECMS_E2E_OWNER_PASSWORD"] ?? "Admin-test-only-2026!";
const SERVER_URL = process.env["XECMS_SERVER_URL"] ?? "http://127.0.0.1:3100";

interface AdminSession { readonly csrfToken: string }
interface Realm {
  readonly realmId: string;
  readonly realmKey: string;
  readonly name: string;
  readonly profileCollectionId?: string;
}
interface Policy {
  readonly revision: number;
  readonly levels: readonly { readonly id: string; readonly name: string }[];
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly resources: readonly { readonly id: string; readonly name: string; readonly type: string }[];
  readonly bindings: readonly { readonly id: string; readonly subjectId: string; readonly roleId: string; readonly resourceId: string }[];
}

test("App Builder에서 생성·적용한 System App으로 문서를 생성하고 publish한다", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("사용자 이름").fill("admin");
  await page.getByLabel("비밀번호").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema$/);

  const session = await page.request.get("/api/auth/session");
  const { csrfToken } = await session.json() as { readonly csrfToken: string };
  const active = await page.request.get("/api/schema");
  const current = await active.json() as { readonly revisionId: string; readonly schema: { readonly collections: readonly unknown[] } };
  const imported = await page.request.put("/api/schema/manifest", {
    headers: { "x-csrf-token": csrfToken },
    data: {
      baseRevisionId: current.revisionId,
      expectedDraftVersion: null,
      schema: {
        format: "xecms.schema",
        formatVersion: 1,
        collections: [...current.schema.collections, {
          id: "col_tasks",
          name: "tasks",
          label: "Tasks",
          fields: [
            { id: "fld_task_title", name: "title", label: "Title", type: "text", required: true },
            { id: "fld_task_done", name: "done", label: "Done", type: "boolean" },
          ],
        }],
      },
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const draftVersion = (await imported.json() as { readonly draftVersion: string }).draftVersion;
  const schemaPreview = await page.request.post("/api/schema/preview", {
    headers: { "x-csrf-token": csrfToken }, data: { expectedDraftVersion: draftVersion },
  });
  const planId = (await schemaPreview.json() as { readonly planId: string }).planId;
  const applied = await page.request.post("/api/schema/apply", {
    headers: { "x-csrf-token": csrfToken },
    data: { planId, expectedRevisionId: current.revisionId, expectedDraftVersion: draftVersion, approveDestructive: false },
  });
  expect(applied.ok(), await applied.text()).toBe(true);

  await page.goto("/admin/apps");
  await expect(page.getByRole("heading", { name: "운영 앱" })).toBeVisible();
  await page.getByRole("button", { name: "새 App" }).click();
  await page.getByLabel("App 이름").fill("Task Operations");
  await page.getByLabel("URL key").fill("task-ops");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Draft 생성" }).click();
  await expect(page).toHaveURL(/\/admin\/apps\/aap_/);

  await page.getByRole("button", { name: "검증 및 Preview" }).click();
  await expect(page.getByRole("heading", { name: "적용할 준비가 됐습니다" })).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: /실행 App 열기/ })).toBeVisible();

  await page.goto("/apps/task-ops");
  await expect(page.getByText("Task Operations", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Task Operations 메뉴" }).getByRole("button", { name: "새 문서" }).click();
  await page.getByLabel(/Title/).fill("First runtime task");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { name: "Tasks detail" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revision" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("heading", { name: "Tasks 휴지통" })).toBeVisible();
  await page.getByRole("cell", { name: "First runtime task" }).click();
  await expect(page.getByText("deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "복원", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "First runtime task" })).toBeVisible();
});

test("Content Realm App에서 경계, 계정 전환, 접근 권한 부여와 회수를 검증한다", async ({ page }) => {
  const admin = await loginAdmin(page);
  const alpha = await createRealm(page, admin, "app-alpha", "App Alpha");
  const beta = await createRealm(page, admin, "app-beta", "App Beta");
  const alphaWithProfile = await createProfileSchema(page, admin, alpha, "alphaMembers", "Alpha Members");
  const betaWithProfile = await createProfileSchema(page, admin, beta, "betaMembers", "Beta Members");

  const activeResponse = await page.request.get(`${SERVER_URL}/api/schema`);
  expect(activeResponse.ok(), await activeResponse.text()).toBe(true);
  const active = await activeResponse.json() as {
    readonly revisionId: string;
    readonly schema: { readonly collections: readonly unknown[] };
  };
  const imported = await mutateAdmin(page, admin, "put", "/api/schema/manifest", {
    baseRevisionId: active.revisionId,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [...active.schema.collections, {
        id: "col_realm_tasks",
        name: "realmTasks",
        label: "Realm Tasks",
        fields: [{ id: "fld_realm_task_title", name: "title", label: "Title", type: "text", required: true }],
      }],
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const schemaDraft = await imported.json() as { readonly draftVersion: string };
  const schemaPreview = await mutateAdmin(page, admin, "post", "/api/schema/preview", {
    expectedDraftVersion: schemaDraft.draftVersion,
  });
  expect(schemaPreview.ok(), await schemaPreview.text()).toBe(true);
  const schemaPlan = await schemaPreview.json() as { readonly planId: string };
  const schemaApplied = await mutateAdmin(page, admin, "post", "/api/schema/apply", {
    planId: schemaPlan.planId,
    expectedRevisionId: active.revisionId,
    expectedDraftVersion: schemaDraft.draftVersion,
    approveDestructive: false,
  });
  expect(schemaApplied.ok(), await schemaApplied.text()).toBe(true);

  await page.goto("/admin/apps/new");
  await page.getByLabel("App 이름").fill("Realm Console");
  await page.getByLabel("URL key").fill("realm-console");
  await page.getByLabel("대상 Realm").selectOption(alpha.realmId);
  await expect(page.getByText("Alpha Members", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta Members", { exact: true })).toHaveCount(0);
  await expect(page.getByText(alphaWithProfile.profileCollectionId!, { exact: false })).toBeVisible();
  await expect(page.getByText(betaWithProfile.profileCollectionId!, { exact: false })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Realm Tasks/ }).check();
  await page.getByRole("button", { name: "Draft 생성" }).click();
  await expect(page).toHaveURL(/\/admin\/apps\/aap_/);
  const appId = page.url().match(/\/admin\/apps\/(aap_[^/?#]+)/)?.[1];
  expect(appId).toBeDefined();
  await page.getByRole("button", { name: "검증 및 Preview" }).click();
  await expect(page.getByRole("heading", { name: "적용할 준비가 됐습니다" })).toBeVisible();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("정상", { exact: true })).toBeVisible();

  const authorizedPassword = "Authorized-realm-user-2026!";
  const unauthorizedPassword = "Unauthorized-realm-user-2026!";
  const authorizedSignup = await page.request.post(`${SERVER_URL}/api/content-realms/${alpha.realmKey}/signup`, {
    headers: { origin: SERVER_URL },
    data: { identifier: "authorized@app.test", password: authorizedPassword, profile: { displayName: "Authorized App User" } },
  });
  expect(authorizedSignup.status(), await authorizedSignup.text()).toBe(201);
  const authorized = await authorizedSignup.json() as { readonly subjectId: string };
  const unauthorizedSignup = await page.request.post(`${SERVER_URL}/api/content-realms/${alpha.realmKey}/signup`, {
    headers: { origin: SERVER_URL },
    data: { identifier: "unauthorized@app.test", password: unauthorizedPassword, profile: { displayName: "Unauthorized App User" } },
  });
  expect(unauthorizedSignup.status(), await unauthorizedSignup.text()).toBe(201);

  const fullAccess = await mutateAdmin(page, admin, "post", `/api/identity-realms/${alpha.realmId}/full-access`, {
    reason: "Admin App browser access setup",
    validUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
    password: OWNER_PASSWORD,
  });
  expect(fullAccess.status(), await fullAccess.text()).toBe(201);

  let policy = await getPolicy(page, alpha.realmId);
  const operatorLevel = policy.levels.find(({ name }) => name === "Editors") ?? policy.levels.at(-1);
  const editorRole = policy.roles.find(({ name }) => name === "Editor");
  const appResource = policy.resources.find(({ id }) => id === `resource:admin-app:${appId}`);
  const taskResource = policy.resources.find(({ name, type }) => name === "realmTasks" && type === "collection");
  expect(operatorLevel).toBeDefined(); expect(editorRole).toBeDefined();
  expect(appResource).toBeDefined(); expect(taskResource).toBeDefined();
  const roleResponse = await mutateAdmin(page, admin, "post", `/api/identity-realms/${alpha.realmId}/authorization/roles`, {
    expectedPolicyRevision: policy.revision,
    name: "Realm Console User",
    levelId: operatorLevel!.id,
    permissions: ["admin-app.access"],
    delegatablePermissions: [],
  });
  expect(roleResponse.status(), await roleResponse.text()).toBe(201);
  policy = await roleResponse.json() as Policy;
  const appRole = policy.roles.find(({ name }) => name === "Realm Console User");
  expect(appRole).toBeDefined();
  const appBindingResponse = await mutateAdmin(page, admin, "post", `/api/identity-realms/${alpha.realmId}/authorization/bindings`, {
    expectedPolicyRevision: policy.revision,
    subjectId: authorized.subjectId,
    roleId: appRole!.id,
    resourceId: appResource!.id,
    propagation: "self",
  });
  expect(appBindingResponse.status(), await appBindingResponse.text()).toBe(201);
  policy = await appBindingResponse.json() as Policy;
  const appBinding = policy.bindings.find(({ subjectId, roleId }) => subjectId === authorized.subjectId && roleId === appRole!.id);
  expect(appBinding).toBeDefined();
  const editorBindingResponse = await mutateAdmin(page, admin, "post", `/api/identity-realms/${alpha.realmId}/authorization/bindings`, {
    expectedPolicyRevision: policy.revision,
    subjectId: authorized.subjectId,
    roleId: editorRole!.id,
    resourceId: taskResource!.id,
    propagation: "self-and-children",
  });
  expect(editorBindingResponse.status(), await editorBindingResponse.text()).toBe(201);
  policy = await editorBindingResponse.json() as Policy;

  await page.goto("/apps/realm-console");
  await expect(page.getByRole("heading", { name: "App 접근 권한이 없습니다" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃 후 다른 계정으로 로그인" }).click();
  await expect(page.getByRole("heading", { name: "App Alpha 로그인" })).toBeVisible();
  await page.getByLabel("식별자").fill("authorized@app.test");
  await page.getByLabel("비밀번호").fill(authorizedPassword);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("Realm Console", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Realm Console 메뉴" }).getByRole("button", { name: "목록" }).click();
  await expect(page.getByRole("heading", { name: "Realm Tasks" })).toBeVisible();

  const revoked = await mutateAdmin(page, admin, "delete", `/api/identity-realms/${alpha.realmId}/authorization/bindings/${appBinding!.id}`, {
    expectedPolicyRevision: policy.revision,
  });
  expect(revoked.ok(), await revoked.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "App 접근 권한이 없습니다" })).toBeVisible();
});

async function loginAdmin(page: Page): Promise<AdminSession> {
  await page.goto("/admin/login");
  await page.getByLabel("사용자 이름").fill("admin");
  await page.getByLabel("비밀번호").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema$/);
  const response = await page.request.get(`${SERVER_URL}/api/auth/session`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<AdminSession>;
}

async function mutateAdmin(
  page: Page,
  session: AdminSession,
  method: "post" | "put" | "patch" | "delete",
  path: string,
  data: unknown,
): Promise<APIResponse> {
  return page.request[method](`${SERVER_URL}${path}`, {
    headers: { "x-csrf-token": session.csrfToken, origin: SERVER_URL },
    data,
  });
}

async function createRealm(page: Page, session: AdminSession, key: string, name: string): Promise<Realm> {
  const response = await mutateAdmin(page, session, "post", "/api/identity-realms", {
    key,
    name,
    acceptSystemIdentities: false,
    provisioning: "explicit",
    registration: "open",
    defaultRoleIds: [],
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<Realm>;
}

async function createProfileSchema(
  page: Page,
  session: AdminSession,
  realm: Realm,
  collectionName: string,
  collectionLabel: string,
): Promise<Realm> {
  const response = await mutateAdmin(page, session, "post", `/api/identity-realms/${realm.realmId}/profile-schema`, {
    collectionName,
    collectionLabel,
    identifierFieldName: "email",
    includeDisplayName: true,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Realm>;
}

async function getPolicy(page: Page, realmId: string): Promise<Policy> {
  const response = await page.request.get(`${SERVER_URL}/api/identity-realms/${realmId}/authorization/policy`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Policy>;
}
