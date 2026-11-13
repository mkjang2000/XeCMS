import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const benchmark = args.length === 1 && args[0] === "--benchmark";
if (args.length && !benchmark) throw new Error("Usage: node scripts/run-postgres-tests.mjs [--benchmark]");

// Regression tests never inherit the application's database or load its .env.
// The opt-in benchmark retains the local development database convention.
if (benchmark) {
  const environmentFile = new URL("../.env", import.meta.url);
  if (existsSync(environmentFile)) process.loadEnvFile(fileURLToPath(environmentFile));
}
const databaseUrl = benchmark
  ? process.env.XECMS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://xecms:xecms@127.0.0.1:54320/xecms"
  : process.env.XECMS_TEST_DATABASE_URL ?? process.env.XECMS_E2E_DATABASE_URL ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const files = [];
if (benchmark) files.push("packages/database/src/postgres-scalability.test.ts");
else {
  for (const directory of ["apps", "packages"]) await discover(new URL(`../${directory}/`, import.meta.url));
  files.sort();
  if (files.length === 0) throw new Error("No PostgreSQL conditional test files were found.");
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
await new Promise((resolvePromise, reject) => {
  const child = spawn(pnpm, ["exec", "vitest", "run", "--no-file-parallelism", ...files,
    ...(benchmark ? ["--reporter=verbose"] : []),
  ], {
    cwd: root,
    env: {
      ...process.env,
      ...(benchmark ? { XECMS_RUN_DATABASE_BENCHMARKS: "true" } : { XECMS_RUN_POSTGRES_TESTS: "true" }),
      XECMS_TEST_DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => code === 0 ? resolvePromise()
    : reject(new Error(`${benchmark ? "Database benchmark" : "PostgreSQL test"} suite failed (${signal ?? code}).`)));
});

async function discover(directoryUrl) {
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      if (!["dist", "dist-types", "node_modules"].includes(entry.name)) await discover(child);
      continue;
    }
    if (!entry.name.endsWith(".test.ts") && !entry.name.endsWith(".integration.test.ts")) continue;
    if ((await readFile(child, "utf8")).includes("XECMS_RUN_POSTGRES_TESTS")) {
      files.push(relative(root, fileURLToPath(child)));
    }
  }
}
