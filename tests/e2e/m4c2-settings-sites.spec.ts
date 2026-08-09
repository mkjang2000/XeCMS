import { expect, test, type Page } from "./fixtures.js";

const ownerPassword = process.env.XECMS_E2E_OWNER_PASSWORD ?? "Admin-test-only-2026!";

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  const form = page.getByRole("form", { name: "로그인" });
  await form.getByLabel("사용자 이름").fill("admin");
  await form.getByLabel("비밀번호").fill(ownerPassword);
  await form.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema\/?$/);
}

test("M4-C2 Workspace 설정과 Site lifecycle을 Admin UI에서 완주한다", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await login(page);
  await page.getByRole("link", { name: "설정 및 사이트" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/?$/);
  await expect(page.getByRole("heading", { name: "설정 및 사이트" })).toBeVisible();
  await expect(page.getByText("Schema mode").locator("..")).toContainText("locked");

  await page.getByRole("button", { name: "Workspace 설정 변경" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("표시 이름").fill("Browser Editorial");
  await dialog.getByLabel("기본 timezone").fill("Asia/Seoul");
  await dialog.getByLabel("Admin locale").fill("ko-KR");
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "설정 저장" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Browser Editorial", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Site 생성" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Site key").fill("browser-primary");
  await dialog.getByLabel("Site 이름").fill("Browser Primary");
  await dialog.getByLabel("Canonical URL").fill("https://primary.browser.example");
  await dialog.getByRole("button", { name: "생성", exact: true }).click();
  const primaryRow = page.getByRole("row").filter({ hasText: "Browser Primary" });
  await expect(primaryRow).toContainText("Default");

  await page.getByRole("button", { name: "Site 생성" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Site key").fill("browser-secondary");
  await dialog.getByLabel("Site 이름").fill("Browser Secondary");
  await dialog.getByRole("button", { name: "생성", exact: true }).click();
  const secondaryRow = page.getByRole("row").filter({ hasText: "Browser Secondary" });
  await expect(secondaryRow).toContainText("active");

  await secondaryRow.getByRole("button", { name: "수정" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Site 이름").fill("Browser Secondary Edited");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  const editedSecondaryRow = page.getByRole("row").filter({ hasText: "Browser Secondary Edited" });
  await expect(editedSecondaryRow).toBeVisible();

  await editedSecondaryRow.getByRole("button", { name: "Default 지정" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(editedSecondaryRow).toContainText("Default");

  await editedSecondaryRow.getByRole("button", { name: "Archive" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("대체 Default Site").click();
  await page.getByRole("option", { name: "Browser Primary" }).click();
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(editedSecondaryRow).toContainText("archived");
  await expect(primaryRow).toContainText("Default");

  await editedSecondaryRow.getByRole("button", { name: "Reactivate" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(editedSecondaryRow).toContainText("active");

  await page.getByRole("link", { name: "스키마" }).click();
  await expect(page.getByText(/시각 편집과 적용이 잠겨 있습니다/)).toBeVisible();
  await expect(page.getByRole("button", { name: "새 콘텐츠 타입" })).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
