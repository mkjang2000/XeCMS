import { expect, test } from "./fixtures.js";

test("블록 화면을 작성·재편집·적용하고 선택 항목을 충돌 없이 수정한다", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("사용자 이름").fill("admin");
  await page.getByLabel("비밀번호").fill(process.env["XECMS_E2E_OWNER_PASSWORD"] ?? "Admin-test-only-2026!");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema$/);
  const session = await (await page.request.get("/api/auth/session")).json() as { csrfToken: string };
  const headers = { "x-csrf-token": session.csrfToken };
  const current = await (await page.request.get("/api/schema")).json() as { revisionId: string; schema: { collections: unknown[] } };
  const schemaResponse = await page.request.put("/api/schema/manifest", { headers, data: {
    baseRevisionId: current.revisionId, expectedDraftVersion: null,
    schema: { format: "xecms.schema", formatVersion: 1, collections: [...current.schema.collections, {
      id: "col_block_customers", name: "blockCustomers", label: "고객 업무", fields: [
        { id: "fld_block_name", name: "name", label: "고객명", type: "text", required: true },
        { id: "fld_block_note", name: "note", label: "메모", type: "text" },
      ],
    }] },
  } });
  expect(schemaResponse.ok(), await schemaResponse.text()).toBe(true);
  const { draftVersion } = await schemaResponse.json() as { draftVersion: string };
  const preview = await page.request.post("/api/schema/preview", { headers, data: { expectedDraftVersion: draftVersion } });
  const { planId } = await preview.json() as { planId: string };
  const applied = await page.request.post("/api/schema/apply", { headers, data: { planId, expectedRevisionId: current.revisionId, expectedDraftVersion: draftVersion, approveDestructive: false } });
  expect(applied.ok(), await applied.text()).toBe(true);
  const seeded = await page.request.post("/api/collections/col_block_customers/documents", { headers, data: { data: { name: "고객 하나", note: "보존할 메모" } } });
  expect(seeded.ok(), await seeded.text()).toBe(true);
  const document = await seeded.json() as { id: string; version: number };

  await page.goto("/admin/apps");
  await page.getByRole("button", { name: "새 App" }).click();
  await page.getByLabel("App 이름").fill("고객 업무 앱");
  await page.getByLabel("URL key").fill("block-customers");
  await page.getByRole("radio", { name: /Composed/ }).check();
  await page.getByRole("button", { name: "Draft 생성" }).click();
  await expect(page).toHaveURL(/\/admin\/apps\/aap_/);
  const builderUrl = page.url();
  await page.getByRole("button", { name: "화면 편집 열기 ↗" }).click();
  await page.getByLabel("추가할 데이터").selectOption("col_block_customers");
  await page.getByRole("button", { name: "검색·목록·수정 화면 만들기" }).click();
  const canvas = page.getByLabel("블록 배치");
  await canvas.getByRole("button", { name: /^검색/ }).click();
  await page.getByLabel("블록 이름").fill("고객 찾기");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  await page.reload();
  await expect(canvas.getByRole("button", { name: /^고객 찾기/ })).toBeVisible();
  await canvas.getByRole("button", { name: /^목록/ }).click();
  await expect(page.getByLabel("검색 조건 받기")).toHaveValue("b1");
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "화면 미리보기" });
  await dialog.getByLabel("고객 찾기").fill("고객");
  await dialog.getByRole("button", { name: "조회", exact: true }).click();
  await expect(dialog.getByRole("cell", { name: "고객 하나", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.goto(builderUrl);
  await page.getByRole("button", { name: "검증 및 Preview" }).click();
  await expect(page.getByRole("heading", { name: "적용할 준비가 됐습니다" })).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("link", { name: /실행 App 열기/ })).toBeVisible();

  await page.goto("/apps/block-customers");
  await page.getByLabel("고객 찾기").fill("고객");
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await page.getByRole("cell", { name: "고객 하나", exact: true }).click();
  await expect(page.getByLabel("고객명", { exact: true })).toHaveValue("고객 하나");
  await page.getByLabel("고객명", { exact: true }).fill("고객 수정");
  await page.getByLabel("메모", { exact: true }).fill("");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("저장되었습니다.", { exact: true })).toBeVisible();
  const savedResponse = await page.request.get(`/api/collections/col_block_customers/documents/${document.id}`);
  const saved = await savedResponse.json() as { version: number; data: { name: string; note: string } };
  expect(saved.data).toEqual({ name: "고객 수정", note: "" });

  // The form still holds the version it saved; a concurrent writer must win safely.
  const otherWrite = await page.request.patch(`/api/collections/col_block_customers/documents/${document.id}`, { headers, data: { expectedVersion: saved.version, data: { note: "다른 담당자의 수정" } } });
  expect(otherWrite.ok(), await otherWrite.text()).toBe(true);
  await page.getByLabel("고객명", { exact: true }).fill("오래된 화면의 수정");
  const conflict = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(document.id));
  await page.getByRole("button", { name: "저장", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  const final = await (await page.request.get(`/api/collections/col_block_customers/documents/${document.id}`)).json() as { data: { name: string; note: string } };
  expect(final.data).toEqual({ name: "고객 수정", note: "다른 담당자의 수정" });
});
