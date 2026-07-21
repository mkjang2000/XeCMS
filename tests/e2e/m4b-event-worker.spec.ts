import { expect, test, type APIResponse, type Page } from "./fixtures.js";

const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3130";
const ownerPassword = process.env.XECMS_E2E_OWNER_PASSWORD ?? "Admin-test-only-2026!";

interface Session { readonly csrfToken: string }
interface SchemaRevision { readonly revisionId: string }

async function login(page: Page): Promise<Session> {
  await page.goto("/admin/login");
  const form = page.getByRole("form", { name: "로그인" });
  await form.getByLabel("사용자 이름").fill("admin");
  await form.getByLabel("비밀번호").fill(ownerPassword);
  await form.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema\/?$/);
  const response = await page.request.get(`${serverUrl}/api/auth/session`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<Session>;
}

function mutate(page: Page, session: Session, method: "post" | "put", path: string, data: unknown): Promise<APIResponse> {
  return page.request[method](`${serverUrl}${path}`, {
    data,
    headers: { "x-csrf-token": session.csrfToken, origin: serverUrl },
  });
}

test("M4-B Outbox 작업을 Admin UI에서 실행하고 조사한다", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  const session = await login(page);
  const activeSchemaResponse = await page.request.get(`${serverUrl}/api/schema`);
  expect(activeSchemaResponse.ok(), await activeSchemaResponse.text()).toBe(true);
  const activeSchema = await activeSchemaResponse.json() as SchemaRevision;
  const imported = await mutate(page, session, "put", "/api/schema/manifest", {
    baseRevisionId: activeSchema.revisionId,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [{
        id: "col_articles",
        name: "articles",
        label: "Articles",
        fields: [
          { id: "fld_title", name: "title", label: "Title", type: "text", required: true },
          { id: "fld_body", name: "body", label: "Body", type: "textarea", required: true },
        ],
      }],
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const draft = await imported.json();
  const preview = await mutate(page, session, "post", "/api/schema/preview", { expectedDraftVersion: draft.draftVersion });
  expect(preview.status(), await preview.text()).toBe(200);
  const plan = await preview.json();
  const applied = await mutate(page, session, "post", "/api/schema/apply", {
    planId: plan.planId,
    expectedRevisionId: activeSchema.revisionId,
    expectedDraftVersion: draft.draftVersion,
    approveDestructive: false,
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const created = await mutate(page, session, "post", "/api/collections/col_articles/documents", {
    data: { title: "Browser outbox article", body: "Inspect this payload in Admin" },
  });
  expect(created.status(), await created.text()).toBe(201);

  await page.goto("/admin/jobs");
  await expect(page.getByRole("heading", { name: "이벤트 작업", exact: true })).toBeVisible();
  await expect(page.getByText("표시할 이벤트 작업이 없습니다")).toBeVisible();
  await page.getByRole("button", { name: "Worker 한 번 실행" }).click();
  await expect(page.getByText("Claim 1 · 성공 1 · 재시도 0 · Dead 0")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "document.created" });
  await expect(row).toContainText("core.search-projection");
  await expect(row).toContainText("succeeded");
  await row.getByRole("button", { name: "상세" }).click();
  const detail = page.getByRole("region", { name: "이벤트 작업 상세" });
  await expect(detail).toContainText("document.created");
  await detail.getByText("Event payload").click();
  await expect(detail).toContainText("Browser outbox article");

  await page.getByLabel("상태").selectOption("succeeded");
  await page.getByLabel("Topic").fill("document.created");
  await expect(row).toBeVisible();
  await page.getByLabel("Topic").fill("document.deleted");
  await expect(page.getByText("표시할 이벤트 작업이 없습니다")).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
