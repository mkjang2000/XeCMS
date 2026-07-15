import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = new URL("../", import.meta.url);
const environmentFile = new URL(".env", rootDirectory);

if (existsSync(environmentFile)) {
  process.loadEnvFile(fileURLToPath(environmentFile));
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const serverUrl = process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3100";
const adminUrl = process.env.XECMS_E2E_ADMIN_URL ?? serverUrl;
const serverPort = new URL(serverUrl).port || "80";

const environment = {
  ...process.env,
  NODE_ENV: "development",
  XECMS_HOST: "127.0.0.1",
  XECMS_PORT: serverPort,
  XECMS_ADMIN_ORIGINS: adminUrl,
  DATABASE_URL:
    process.env.XECMS_E2E_DATABASE_URL ??
    "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e",
  XECMS_DB_SCHEMA:
    process.env.XECMS_E2E_DB_SCHEMA ??
    `xecms_e2e_${process.pid}_${Date.now()}`,
  XECMS_RUN_POSTGRES_TESTS: "true",
  XECMS_DEV_SEED: "false",
  XECMS_DEV_ADMIN_USERNAME: "admin",
  XECMS_DEV_ADMIN_PASSWORD: "admin",
  XECMS_SESSION_SECRET: "m1-e2e-only-session-secret-change-me",
  XECMS_ADMIN_DIST: fileURLToPath(new URL("apps/admin/dist", rootDirectory)),
  XECMS_SERVER_URL: serverUrl,
  XECMS_E2E_ADMIN_URL: adminUrl,
};

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: rootDirectory,
      env: environment,
      stdio: "inherit",
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal === null ? `exit code ${code ?? 1}` : signal;
      reject(new Error(`${command} ${arguments_.join(" ")} failed (${reason}).`));
    });
  });
}

let databaseStarted = false;

try {
  await run(pnpm, ["build"]);
  await run(pnpm, ["build:admin"]);

  databaseStarted = true;
  await run(docker, [
    "compose",
    "--profile",
    "e2e",
    "up",
    "--detach",
    "--wait",
    "postgres-e2e",
  ]);
  await run(pnpm, ["--filter", "@xecms/server", "test:integration"]);
  await run(pnpm, ["exec", "playwright", "test"]);
} finally {
  if (databaseStarted) {
    await run(docker, [
      "compose",
      "--profile",
      "e2e",
      "rm",
      "--force",
      "--stop",
      "--volumes",
      "postgres-e2e",
    ]).catch((error) => {
      console.error(`Could not remove the E2E database: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
