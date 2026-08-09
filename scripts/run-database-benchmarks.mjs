import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const environmentFile = new URL("../.env", import.meta.url);
if (existsSync(environmentFile)) process.loadEnvFile(fileURLToPath(environmentFile));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

await new Promise((resolvePromise, reject) => {
  const child = spawn(pnpm, ["exec", "vitest", "run", "--no-file-parallelism",
    "packages/database/src/postgres-scalability.test.ts", "--reporter=verbose"], {
    cwd: root,
    env: {
      ...process.env,
      XECMS_RUN_DATABASE_BENCHMARKS: "true",
      XECMS_TEST_DATABASE_URL: process.env.XECMS_TEST_DATABASE_URL
        ?? process.env.DATABASE_URL
        ?? "postgresql://xecms:xecms@127.0.0.1:54320/xecms",
    },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => code === 0 ? resolvePromise()
    : reject(new Error(`Database benchmark suite failed (${signal ?? code}).`)));
});
