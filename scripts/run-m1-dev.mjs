import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = new URL("../", import.meta.url);
const environmentFile = new URL(".env", rootDirectory);

if (existsSync(environmentFile)) {
  process.loadEnvFile(fileURLToPath(environmentFile));
}

const host = process.env.XECMS_HOST ?? "127.0.0.1";
const port = process.env.XECMS_PORT ?? "3100";
const adminHost = process.env.XECMS_ADMIN_HOST ?? "127.0.0.1";
const adminPort = process.env.XECMS_ADMIN_PORT ?? "5173";
const environment = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  XECMS_HOST: host,
  XECMS_PORT: port,
  XECMS_ADMIN_HOST: adminHost,
  XECMS_ADMIN_PORT: adminPort,
  XECMS_SERVER_URL: process.env.XECMS_SERVER_URL ?? `http://${host}:${port}`,
  XECMS_ADMIN_DIST:
    process.env.XECMS_ADMIN_DIST ??
    fileURLToPath(new URL("apps/admin/dist", rootDirectory)),
  XECMS_ADMIN_ORIGINS:
    process.env.XECMS_ADMIN_ORIGINS ??
    process.env.XECMS_ADMIN_ORIGIN ??
    `http://${adminHost}:${adminPort},http://localhost:${adminPort}`,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://xecms:xecms@127.0.0.1:54320/xecms",
  XECMS_SESSION_SECRET:
    process.env.XECMS_SESSION_SECRET ?? "local-development-only-change-me",
};

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const children = [
  spawn(pnpm, ["--filter", "@xecms/server", "dev"], {
    cwd: rootDirectory,
    env: environment,
    stdio: "inherit",
  }),
  spawn(pnpm, ["--filter", "@xecms/admin-app", "dev"], {
    cwd: rootDirectory,
    env: environment,
    stdio: "inherit",
  }),
];

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(`M1 development process could not start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;

    const reason = signal === null ? `exit code ${code ?? 1}` : signal;
    console.error(`An M1 development process stopped unexpectedly (${reason}).`);
    process.exitCode = code === 0 ? 1 : (code ?? 1);
    stop();
  });
}

await Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.once("close", resolve);
      }),
  ),
);
