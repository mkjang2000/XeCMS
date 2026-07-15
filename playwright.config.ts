import { defineConfig, devices } from "@playwright/test";

const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3100";
const adminUrl = process.env.XECMS_E2E_ADMIN_URL ?? serverUrl;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // The cumulative journeys intentionally mutate one isolated instance from
  // bootstrap onward, so retrying against the same server would not be clean.
  retries: 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: adminUrl,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  expect: {
    timeout: 10_000,
  },
  timeout: 60_000,
  webServer: {
    command: "pnpm --filter @xecms/server start",
    url: `${serverUrl}/api/health`,
    timeout: 120_000,
    reuseExistingServer: process.env.XECMS_E2E_REUSE_SERVER === "true",
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
