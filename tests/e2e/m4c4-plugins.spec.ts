import { expect, test, type Page } from "./fixtures.js";

const ownerPassword=process.env.XECMS_E2E_OWNER_PASSWORD??"Admin-test-only-2026!";
async function login(page:Page){await page.goto("/admin/login");const form=page.getByRole("form",{name:"로그인"});await form.getByLabel("사용자 이름").fill("admin");await form.getByLabel("비밀번호").fill(ownerPassword);await form.getByRole("button",{name:"로그인"}).click();await expect(page).toHaveURL(/\/admin\/schema\/?$/)}

test("M4-C4 trusted Plugin을 Admin UI에서 설치하고 활성화한다",async({page})=>{
  const pageErrors:string[]=[],failedResponses:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)failedResponses.push(`${response.status()} ${response.url()}`)});
  await login(page);
  await page.getByRole("link",{name:"Plugins"}).click();
  await expect(page).toHaveURL(/\/admin\/plugins\/?$/);
  await expect(page.getByRole("heading",{name:"Plugins"})).toBeVisible();
  const card=page.locator("article").filter({has:page.getByRole("heading",{name:"Example Greeter"})});
  await expect(card.getByText("Catalog",{exact:true})).toBeVisible();
  await card.getByRole("button",{name:"Install 미리보기"}).click();
  await expect(page.getByRole("heading",{name:"Install plan"})).toBeVisible();
  await page.getByRole("button",{name:"이 plan 적용"}).click();
  let dialog=page.getByRole("dialog");
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button",{name:"재인증 후 적용"}).click();
  await expect(card.getByText("installed",{exact:true})).toBeVisible();

  await card.getByRole("button",{name:"Enable 미리보기"}).click();
  await expect(page.getByRole("heading",{name:"Enable plan"})).toBeVisible();
  await page.getByRole("button",{name:"이 plan 적용"}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button",{name:"재인증 후 적용"}).click();
  await expect(card.getByText("enabled",{exact:true})).toBeVisible();
  await expect(card.getByText("현재 process와 desired state가 다릅니다.")).toBeVisible();

  await card.getByRole("button",{name:"설정"}).click();
  dialog=page.getByRole("dialog");
  await dialog.getByLabel("JSON config").fill('{"greeting":"Browser verified greeting"}');
  await dialog.getByLabel("현재 비밀번호").fill(ownerPassword);
  await dialog.getByRole("button",{name:"설정 저장"}).click();
  await expect(dialog).not.toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
