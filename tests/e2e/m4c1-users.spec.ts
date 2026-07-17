import { expect, test, type Page } from "./fixtures.js";

const ownerPassword = process.env.XECMS_E2E_OWNER_PASSWORD ?? "Admin-test-only-2026!";

async function login(
  page: Page,
  username = "admin",
  password = ownerPassword,
  replacementPassword?: string,
): Promise<void> {
  await page.goto("/admin/login");
  const form = page.getByRole("form", { name: "로그인" });
  await form.getByLabel("사용자 이름").fill(username);
  await form.getByLabel("비밀번호").fill(password);
  await form.getByRole("button", { name: "로그인" }).click();
  if (replacementPassword !== undefined) {
    await expect(page).toHaveURL(/\/admin\/password-change\/?$/);
    const change = page.getByRole("form", { name: "임시 비밀번호 변경" });
    await change.getByLabel("현재 임시 비밀번호").fill(password);
    await change.getByLabel(/^새 비밀번호\*?$/).fill(replacementPassword);
    await change.getByLabel(/^새 비밀번호 확인\*?$/).fill(replacementPassword);
    await change.getByRole("button", { name: "비밀번호 변경" }).click();
    await expect(page).toHaveURL(/\/admin\/login\/?$/);
    await login(page, username, replacementPassword);
    return;
  }
  await expect(page).toHaveURL(/\/admin\/schema\/?$/);
}

test("M4-C1 사용자 생성·수정·비활성화를 Admin UI에서 완주한다", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await login(page);
  await page.getByRole("link", { name: "사용자" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/?$/);
  await expect(page.getByRole("heading", { name: "사용자", exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "admin" })).toBeVisible();

  await page.getByRole("button", { name: "운영 계정 생성" }).click();
  await page.getByLabel("로그인 식별자").fill("browser.operator");
  await page.getByLabel("임시 비밀번호").fill("Browser-operator-2026!");
  await page.getByRole("button", { name: "계정 생성", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users\/usr_/);
  await expect(page.getByRole("heading", { name: "browser.operator" })).toBeVisible();
  await expect(page.getByText("System Realm", { exact: true })).toBeVisible();

  await page.getByLabel("로그인 식별자").fill("browser.renamed");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("heading", { name: "browser.renamed" })).toBeVisible();

  await page.getByRole("button", { name: "계정 비활성화" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("모든 활성 session과 API key를 폐기합니다");
  await dialog.getByRole("button", { name: "비활성화" }).click();
  await expect(page.getByText("비활성", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 재활성화" })).toBeVisible();

  await page.getByRole("link", { name: "사용자" }).click();
  await expect(page.getByRole("row").filter({ hasText: "browser.renamed" })).toContainText("비활성");

  await page.getByRole("row").filter({ hasText: "browser.renamed" }).getByRole("link").click();
  await page.getByRole("button", { name: "계정 재활성화" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "재활성화", exact: true }).click();
  await expect(page.getByRole("button", { name: "임시 비밀번호 재설정" })).toBeEnabled();

  await page.getByRole("button", { name: "초대 token 발급" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("현재 System 계정 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "Token 발급" }).click();
  await expect(page.locator("code").filter({ hasText: "xecms_setup_" })).toBeVisible();
  await page.getByRole("button", { name: "확인" }).click();

  await page.getByRole("button", { name: "임시 비밀번호 재설정" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("새 임시 비밀번호").fill("Browser-reset-operator-2026!");
  await dialog.getByLabel("현재 System 계정 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "Credential 재설정" }).click();
  await expect(page.getByText("Credential version").locator("..")).toContainText("3");

  await page.getByRole("button", { name: "Owner로 이전" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("이전 사유").fill("Chromium acceptance Owner handover");
  await dialog.getByLabel("현재 Owner 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button", { name: "Owner 이전", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login\/?$/);

  await login(page, "browser.renamed", "Browser-reset-operator-2026!", "Browser-final-operator-2026!");
  await page.getByRole("link", { name: "사용자" }).click();
  await page.getByRole("row").filter({ hasText: "browser.renamed" }).getByRole("link").click();
  await expect(page.getByText("Owner", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Admin · 현재", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "사용자" }).click();
  await page.getByRole("button", { name: "서비스 계정 생성" }).click();
  const serviceForm = page.getByRole("region", { name: "새 서비스 계정" });
  await serviceForm.getByLabel("서비스 식별자").fill("browser.indexer");
  await serviceForm.getByRole("button", { name: "서비스 계정 생성", exact: true }).click();
  await expect(page.getByRole("heading", { name: "browser.indexer" })).toBeVisible();
  await expect(page.getByText("서비스", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "API key 생성" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Key 이름").fill("Browser automation");
  await dialog.getByLabel("Permission scopes").fill("schema.read");
  await dialog.getByRole("button", { name: "Key 생성", exact: true }).click();
  await expect(page.locator("code").filter({ hasText: "xecms_" })).toBeVisible();
  const keyRow = page.getByRole("row").filter({ hasText: "Browser automation" });
  await expect(keyRow).toContainText("schema.read");
  await keyRow.getByRole("button", { name: "폐기" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Key 폐기", exact: true }).click();
  await expect(keyRow).toContainText("폐기됨");
  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
