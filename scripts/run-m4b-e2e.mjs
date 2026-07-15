import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = new URL("../", import.meta.url);
const environmentFile = new URL(".env", rootDirectory);
if (existsSync(environmentFile)) process.loadEnvFile(fileURLToPath(environmentFile));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const serverUrl = process.env.XECMS_M4B_SERVER_URL ?? "http://127.0.0.1:3130";
const databaseUrl = process.env.XECMS_M4B_DATABASE_URL ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const mediaStorageRoot = await mkdtemp(join(tmpdir(), "xecms-m4b-media-"));
const environment = {
  ...process.env,
  NODE_ENV: "development",
  XECMS_HOST: "127.0.0.1",
  XECMS_PORT: new URL(serverUrl).port || "80",
  XECMS_ADMIN_ORIGINS: serverUrl,
  XECMS_CONTENT_ORIGINS: serverUrl,
  DATABASE_URL: databaseUrl,
  XECMS_TEST_DATABASE_URL: databaseUrl,
  XECMS_E2E_DATABASE_URL: databaseUrl,
  XECMS_DB_SCHEMA: process.env.XECMS_M4B_DB_SCHEMA ?? `xecms_m4b_e2e_${process.pid}_${Date.now()}`,
  XECMS_RUN_POSTGRES_TESTS: "true",
  XECMS_DEV_SEED: "true",
  XECMS_DEV_ADMIN_USERNAME: "admin",
  XECMS_DEV_ADMIN_PASSWORD: "admin",
  XECMS_E2E_OWNER_PASSWORD: "admin",
  XECMS_SESSION_SECRET: "m4b-e2e-only-session-secret-change-me",
  XECMS_ADMIN_DIST: fileURLToPath(new URL("apps/admin/dist", rootDirectory)),
  XECMS_SERVER_URL: serverUrl,
  XECMS_E2E_ADMIN_URL: serverUrl,
  XECMS_MEDIA_STORAGE_ROOT: mediaStorageRoot,
  XECMS_WORKER_ENABLED: "false",
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDirectory, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code}).`)));
  });
}

let databaseStarted = false;
try {
  await run(pnpm, ["build"]);
  await run(pnpm, ["build:admin"]);
  databaseStarted = true;
  await run(docker, ["compose", "--profile", "e2e", "up", "--detach", "--wait", "postgres-e2e"]);
  await run(pnpm, ["exec", "vitest", "run", "packages/database/src/postgres-event-worker.test.ts", "apps/server/src/m4b-event-worker.integration.test.ts"]);
  await run(pnpm, ["exec", "playwright", "test", "tests/e2e/m4b-event-worker.spec.ts"]);
} finally {
  await rm(mediaStorageRoot, { recursive: true, force: true });
  if (databaseStarted) {
    await run(docker, ["compose", "--profile", "e2e", "rm", "--force", "--stop", "--volumes", "postgres-e2e"]).catch((error) => {
      console.error(error.message); process.exitCode = 1;
    });
  }
}
