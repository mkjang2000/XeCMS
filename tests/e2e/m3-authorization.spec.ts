import { expect, test, type Locator, type Page } from "@playwright/test";

const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3100";
const ownerPassword = process.env.XECMS_E2E_OWNER_PASSWORD ?? "Admin-test-only-2026!";

async function selectOptionByLabel(locator: Locator, label: string): Promise<void> {
  await locator.selectOption({ label });
}

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  const form = page.getByRole("form", { name: "로그인" });
  await form.getByLabel("사용자 이름").fill("admin");
  await form.getByLabel("비밀번호").fill(ownerPassword);
  await form.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/admin\/schema(?:\/)?$/);
}

interface M3TreeItem {
  readonly document: {
    readonly id: string;
    readonly data: Readonly<Record<string, unknown>>;
  };
  readonly parentId: string | null;
}

interface M3PolicyResource {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

test("M3 역할, 그룹, Scope, 조건부 판정과 Audit을 Admin UI에서 완주한다", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await login(page);

  const treeResponse = await page.request.get(
    `${serverUrl}/api/collections/col_blog_pages/tree`,
  );
  expect(treeResponse.ok()).toBe(true);
  const treeItems = (await treeResponse.json()).items as readonly M3TreeItem[];
  const rootA = treeItems.find(({ document }) => document.data["title"] === "Root A");
  const rootB = treeItems.find(({ document }) => document.data["title"] === "Root B");
  const child = treeItems.find(({ document }) => document.data["title"] === "Child");
  expect(rootA).toBeDefined();
  expect(rootB).toBeDefined();
  expect(child).toBeDefined();

  const initialPolicyResponse = await page.request.get(`${serverUrl}/api/authorization/policy`);
  expect(initialPolicyResponse.ok()).toBe(true);
  const initialResources = (await initialPolicyResponse.json()).resources as readonly M3PolicyResource[];
  const scopeResource = initialResources.find(
    ({ id }) => id === `resource:document:${rootA!.document.id}`,
  );
  expect(scopeResource).toBeDefined();
  const scopeResourceLabel = scopeResource!.name;

  await test.step("동일 레벨에 필드 제한 역할을 만든다", async () => {
    await page.goto("/admin/access/roles");
    await expect(page.getByRole("heading", { name: "레벨과 역할" })).toBeVisible();
    await expect(page.getByText("Content Administrator", { exact: true })).toBeVisible();
    await expect(page.getByText("Security Administrator", { exact: true })).toBeVisible();

    const editorLevel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Editors", exact: true }),
    }).first();
    await editorLevel.getByRole("button", { name: /동일 레벨 역할 추가/ }).click();

    const editor = page.getByRole("region", { name: "역할 편집기" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("역할 이름").fill("E2E 제한 작성자");
    await editor.getByLabel("설명").fill("M3 브라우저 검증 역할");
    await editor.getByLabel("content.list 사용").check();
    await editor.getByLabel("content.read 사용").check();
    await editor.getByLabel("content.update 사용").check();

    const scope = editor.getByRole("group", { name: "필드 접근 Scope" });
    await scope.getByRole("button", {
      name: `${scopeResourceLabel}, Document`,
    }).click();
    await expect(scope.getByRole("button", {
      name: `${scopeResourceLabel}, Document, 선택됨`,
    })).toBeVisible();
    await editor.getByLabel("읽기 허용 필드").fill("title");
    await editor.getByLabel("쓰기 허용 필드").fill("title");
    await editor.getByRole("button", { name: "저장", exact: true }).click();

    await expect(page.getByText("E2E 제한 작성자", { exact: true })).toBeVisible();
    await expect(page.getByText("필드 규칙 1", { exact: true })).toBeVisible();
  });

  await test.step("사용자와 중첩 그룹을 만들고 조건부 Scope Binding을 연결한다", async () => {
    await page.goto("/admin/access/bindings");
    await expect(page.getByRole("heading", { name: "주체와 역할 바인딩" })).toBeVisible();

    const subjectPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "권한 주체 추가" }),
    });
    await subjectPanel.getByLabel("표시 이름").fill("E2E Writer");
    await subjectPanel.getByRole("button", { name: "추가", exact: true }).click();
    await expect(subjectPanel.getByLabel("표시 이름")).toHaveValue("");

    await selectOptionByLabel(subjectPanel.getByLabel("유형"), "그룹");
    await subjectPanel.getByLabel("표시 이름").fill("E2E Editorial");
    await subjectPanel.getByRole("button", { name: "추가", exact: true }).click();
    await expect(subjectPanel.getByLabel("표시 이름")).toHaveValue("");

    await selectOptionByLabel(subjectPanel.getByLabel("유형"), "사용자");
    await subjectPanel.getByLabel("표시 이름").fill("E2E Move Observer");
    await subjectPanel.getByRole("button", { name: "추가", exact: true }).click();
    await expect(subjectPanel.getByLabel("표시 이름")).toHaveValue("");

    const groupPanel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "중첩 그룹" }),
    });
    await selectOptionByLabel(groupPanel.getByLabel("멤버"), "E2E Writer");
    await selectOptionByLabel(groupPanel.getByLabel("상위 그룹"), "E2E Editorial");
    await groupPanel.getByRole("button", { name: "그룹에 추가" }).click();
    await expect(groupPanel.getByText("E2E Writer → E2E Editorial", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "새 바인딩" }).click();
    const binding = page.getByRole("region", { name: "역할 바인딩 편집기" });
    await selectOptionByLabel(binding.getByLabel("Subject"), "E2E Editorial · group");
    await selectOptionByLabel(binding.getByLabel("Role"), "E2E 제한 작성자");
    const bindingScope = binding.getByRole("group", { name: "Resource Scope" });
    await bindingScope.getByRole("button", {
      name: `${scopeResourceLabel}, Document`,
    }).click();
    await bindingScope.getByRole("radio", { name: /현재 및 모든 하위/ }).check();
    await selectOptionByLabel(binding.getByLabel("소유자 조건"), "E2E Writer");
    await binding.getByLabel("상태 조건").fill("draft");
    await binding.getByRole("button", { name: "저장", exact: true }).click();

    const row = page.getByRole("row").filter({ hasText: "E2E Editorial" });
    await expect(row).toContainText("E2E 제한 작성자");
    await expect(row).toContainText("현재 및 모든 하위");
    await expect(row).toContainText("조건부");

    await page.getByRole("button", { name: "새 바인딩" }).click();
    const moveBinding = page.getByRole("region", { name: "역할 바인딩 편집기" });
    await selectOptionByLabel(moveBinding.getByLabel("Subject"), "E2E Move Observer · user");
    await selectOptionByLabel(moveBinding.getByLabel("Role"), "E2E 제한 작성자");
    const moveBindingScope = moveBinding.getByRole("group", { name: "Resource Scope" });
    await moveBindingScope.getByRole("button", {
      name: `${scopeResourceLabel}, Document`,
    }).click();
    await moveBindingScope.getByRole("radio", { name: /현재 및 모든 하위/ }).check();
    await moveBinding.getByRole("button", { name: "저장", exact: true }).click();
    const moveObserverRow = page.getByRole("row").filter({ hasText: "E2E Move Observer" });
    await expect(moveObserverRow).toContainText("E2E 제한 작성자");
    await expect(moveObserverRow).toContainText("현재 및 모든 하위");
  });

  await test.step("실제 판정기로 Group provenance와 조건 불일치를 설명한다", async () => {
    await page.goto("/admin/access/simulator");
    await selectOptionByLabel(page.getByLabel("Subject"), "E2E Writer · user");
    await page.getByLabel("Action").selectOption("content.read");
    const simulatorScope = page.getByRole("group", { name: "Resource" });
    await simulatorScope.getByRole("button", {
      name: `${scopeResourceLabel}, Document`,
    }).click();
    await expect(simulatorScope.getByRole("button", {
      name: `${scopeResourceLabel}, Document, 선택됨`,
    })).toBeVisible();
    await selectOptionByLabel(page.getByLabel("소유자 Context"), "E2E Writer");
    await page.getByLabel("상태 Context").fill("draft");
    await page.getByRole("button", { name: "권한 판정" }).click();

    await expect(page.getByText("Allowed", { exact: true })).toBeVisible();
    await expect(page.getByText(/그룹 경로:.*E2E Writer.*E2E Editorial/)).toBeVisible();
    await expect(page.getByText(/Policy r\d+/)).toBeVisible();

    await page.getByLabel("상태 Context").fill("published");
    await page.getByRole("button", { name: "권한 판정" }).click();
    await expect(page.getByText("Denied", { exact: true })).toBeVisible();
    await expect(page.getByText("CONSTRAINT_NOT_SATISFIED", { exact: true })).toBeVisible();
  });

  await test.step("Tree 이동 전에 권한 경로와 실질 권한 변화를 확인하고 승인한다", async () => {
    await page.goto("/admin/content/col_blog_pages?view=tree");
    await expect(page.getByRole("region", { name: /페이지 콘텐츠 트리/ })).toBeVisible();
    const childRow = page.getByRole("listitem").filter({
      has: page.getByRole("link", {
        name: new RegExp(`^Child · ${child!.document.id}$`),
      }),
    });
    await childRow.locator("select").selectOption(rootB!.document.id);
    await childRow.getByRole("button", { name: "이동", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "콘텐츠 이동 및 권한 영향" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("이동 전 권한 경로", { exact: true })).toBeVisible();
    await expect(dialog.getByText("이동 후 권한 경로", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Tree v\d+ · Policy r\d+ 기준 미리보기/)).toBeVisible();
    const changes = dialog.getByRole("list", { name: "실질 권한 변화" });
    await expect(changes).toBeVisible();
    await expect(changes).toContainText("상실");
    await expect(changes).toContainText("content.read");
    const fieldChanges = dialog.getByRole("list", { name: "필드 접근 변화" });
    await expect(fieldChanges).toBeVisible();
    await expect(fieldChanges).toContainText("필드 읽기");
    await expect(fieldChanges).toContainText(/축소|변경/);
    await expect(dialog.getByText(/보호된 Owner 권한/)).toBeVisible();
    await dialog.getByRole("button", { name: "확인 후 이동" }).click();

    await expect(page.getByText(
      `Child · ${child!.document.id} 이동 완료`,
      { exact: true },
    )).toBeVisible();
    const movedTree = await page.request.get(
      `${serverUrl}/api/collections/col_blog_pages/tree`,
    );
    expect(movedTree.ok()).toBe(true);
    const movedChild = ((await movedTree.json()).items as readonly M3TreeItem[])
      .find(({ document }) => document.id === child!.document.id);
    expect(movedChild?.parentId).toBe(rootB!.document.id);
  });

  await test.step("정책 변경의 actor, target, revision과 판정이 Audit에 남는다", async () => {
    await page.goto("/admin/access/audit");
    await expect(page.getByRole("heading", { name: "정책 변경 감사" })).toBeVisible();
    await expect(page.getByText("role.create", { exact: true })).toBeVisible();
    await expect(page.getByText("binding.create", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("ALLOW", { exact: false }).first()).toBeVisible();

    const policy = await page.request.get(`${serverUrl}/api/authorization/policy`);
    expect(policy.ok()).toBe(true);
    expect((await policy.json()).revision).toBeGreaterThanOrEqual(6);
  });

  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
