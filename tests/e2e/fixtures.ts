import { expect, test as base } from "@playwright/test";

const serverUrl = process.env["XECMS_SERVER_URL"] ?? "http://127.0.0.1:3100";
const autoBootstrap = process.env["XECMS_E2E_AUTO_BOOTSTRAP"] === "true";
const ownerUsername = process.env["XECMS_E2E_OWNER_USERNAME"] ?? "admin";
const ownerPassword = process.env["XECMS_E2E_OWNER_PASSWORD"] ?? "Admin-test-only-2026!";
const displayMode = process.env["XECMS_E2E_DISPLAY_MODE"];

export const test = base.extend<{ bootstrapOwner: void }>({
  bootstrapOwner: [async ({ page, request }, use) => {
    if (
      displayMode === "basic"
      || displayMode === "standard"
      || displayMode === "advanced"
    ) {
      await page.addInitScript((mode) => {
        window.localStorage.setItem("xecms.admin.display-mode.v1", mode);
      }, displayMode);
    }
    if (autoBootstrap) {
      const status = await request.get(`${serverUrl}/api/bootstrap/status`);
      expect(status.ok()).toBe(true);
      if ((await status.json() as { required: boolean }).required) {
        const created = await request.post(`${serverUrl}/api/bootstrap`, {
          data: { username: ownerUsername, password: ownerPassword },
        });
        expect(created.status(), await created.text()).toBe(201);
      }
    }
    await use();
  }, { auto: true }],
});

export { expect };
export type { APIResponse, Locator, Page } from "@playwright/test";
