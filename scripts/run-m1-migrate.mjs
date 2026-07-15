import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = new URL("../", import.meta.url);
const environmentFile = new URL(".env", rootDirectory);

if (existsSync(environmentFile)) {
  process.loadEnvFile(fileURLToPath(environmentFile));
}

const environment = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://xecms:xecms@127.0.0.1:54320/xecms",
};
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(arguments_, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, arguments_, {
      cwd: rootDirectory,
      env: environment,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal === null ? `exit code ${code ?? 1}` : signal;
      reject(new Error(`${label} failed (${reason}).`));
    });
  });
}

await run(["build"], "M1 prerequisite build");
await run(["--filter", "@xecms/server", "db:migrate"], "XeCMS migration");
