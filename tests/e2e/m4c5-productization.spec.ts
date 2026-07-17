import { expect,test } from "./fixtures.js";

test("M4-C5 version headers, liveness and restart-aware readiness are exposed",async({request})=>{const live=await request.get("/api/live");expect(live.status()).toBe(200);expect(live.headers()["x-xecms-version"]).toBe("0.4.1");expect(live.headers()["x-xecms-api-version"]).toBe("1");expect(await live.json()).toEqual({status:"live",version:"0.4.1"});const health=await request.get("/api/health");expect(health.status()).toBe(200);expect(await health.json()).toMatchObject({status:"ok",database:"connected",version:"0.4.1"});const ready=await request.get("/api/ready");expect([200,503]).toContain(ready.status());const body=await ready.json();expect(body.checks).toMatchObject({database:true,migrations:true,storage:true});if(ready.status()===503)expect(body).toMatchObject({status:"not-ready",checks:{plugins:false}});else expect(body).toMatchObject({status:"ready",checks:{plugins:true}})});

test("Admin 표시 모드는 권한을 바꾸지 않고 단계별 정보량과 개인 선호만 조절한다",async({page})=>{
  await page.goto("/admin/login");
  await page.getByLabel("사용자 이름").fill("admin");
  await page.getByLabel("비밀번호").fill("Admin-test-only-2026!");
  await page.getByRole("button",{name:"로그인"}).click();
  await expect(page).toHaveURL(/\/admin\/schema$/);

  const mode=page.getByRole("group",{name:"Admin 표시 모드"});
  await expect(mode.getByRole("button",{name:"Basic"})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("link",{name:"사용자"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Identity Realms"})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Plugins"})).toHaveCount(0);

  await mode.getByRole("button",{name:"Standard"}).click();
  await expect(page.getByRole("link",{name:"Identity Realms"})).toBeVisible();
  await expect(page.getByRole("link",{name:"권한"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Plugins"})).toHaveCount(0);

  await mode.getByRole("button",{name:"Advanced"}).click();
  await expect(page.getByRole("link",{name:"Plugins"})).toBeVisible();
  await expect(page.getByRole("link",{name:"운영 및 감사"})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group",{name:"Admin 표시 모드"}).getByRole("button",{name:"Advanced"})).toHaveAttribute("aria-pressed","true");

  await page.getByRole("group",{name:"Admin 표시 모드"}).getByRole("button",{name:"Basic"}).click();
  await page.goto("/admin/plugins");
  await expect(page.getByRole("heading",{name:"Plugins"})).toBeVisible();
});
