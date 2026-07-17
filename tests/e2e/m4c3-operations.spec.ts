import { expect, test, type Page } from "./fixtures.js";

const ownerPassword=process.env.XECMS_E2E_OWNER_PASSWORD??"Admin-test-only-2026!";
async function login(page:Page){await page.goto("/admin/login");const form=page.getByRole("form",{name:"로그인"});await form.getByLabel("사용자 이름").fill("admin");await form.getByLabel("비밀번호").fill(ownerPassword);await form.getByRole("button",{name:"로그인"}).click();await expect(page).toHaveURL(/\/admin\/schema\/?$/)}

test("M4-C3 통합 Audit, retention preview와 media consistency를 Admin UI에서 확인한다",async({page})=>{
  const pageErrors:string[]=[],failedResponses:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)failedResponses.push(`${response.status()} ${response.url()}`)});
  await login(page);
  await page.getByRole("link",{name:"운영 및 감사"}).click();
  await expect(page).toHaveURL(/\/admin\/operations\/?$/);
  await expect(page.getByRole("heading",{name:"운영 및 감사"})).toBeVisible();
  await expect(page.getByText("Retention revision")).toBeVisible();

  await page.getByRole("button",{name:"통합 감사"}).click();
  await expect(page.getByRole("heading",{name:"Audit filter"})).toBeVisible();
  await page.getByLabel("Action").fill("login.succeeded");
  await page.getByRole("button",{name:"필터 적용"}).click();
  await expect(page.getByRole("heading",{name:"통합 감사 로그"})).toBeVisible();
  await expect(page.getByText("login.succeeded",{exact:true}).first()).toBeVisible();

  await page.getByRole("button",{name:"보존 정책"}).click();
  await expect(page.getByRole("heading",{name:"Workspace retention policy"})).toBeVisible();
  await page.getByRole("button",{name:"정책 변경"}).click();
  let dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("현재 비밀번호")).toBeVisible();
  await dialog.getByRole("button",{name:"취소"}).click();
  await page.getByRole("button",{name:"정리 미리보기"}).click();
  await expect(page.getByRole("heading",{name:"Retention plan"})).toBeVisible();
  await expect(page.getByText(/report only/)).toBeVisible();

  await page.getByRole("button",{name:"Media consistency"}).click();
  await page.getByRole("button",{name:"Consistency 검사"}).click();
  await expect(page.getByText("정상 파일")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
