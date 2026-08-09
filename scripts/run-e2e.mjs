import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = new URL("../", import.meta.url);
const environmentFile = new URL(".env", rootDirectory);

if (existsSync(environmentFile)) {
  process.loadEnvFile(fileURLToPath(environmentFile));
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const arguments_ = process.argv.slice(2);
let releaseMode = false;
const commandLineSuiteNames = [];
while (arguments_.length > 0) {
  const argument = arguments_.shift();
  if (argument === "--") {
    continue;
  }
  if (argument === "--release") {
    releaseMode = true;
    continue;
  }
  if (argument === "--suite") {
    const suiteName = arguments_.shift();
    if (suiteName === undefined || suiteName.startsWith("--")) {
      throw new Error("--suite requires a suite name.");
    }
    commandLineSuiteNames.push(suiteName);
    continue;
  }
  throw new Error(`Unknown E2E argument '${argument}'.`);
}
const defaultServerPort = 32_000 + (process.pid % 1_000);
const defaultDatabasePort = 45_000 + (process.pid % 1_000);
const databasePort = process.env.XECMS_E2E_RUNNER_POSTGRES_PORT ?? String(defaultDatabasePort);
const composeProjectName = `xecms-e2e-${process.pid}`;
const databaseServiceName = `${composeProjectName}-postgres-e2e-1`;
const serverUrl =
  process.env.XECMS_E2E_SERVER_URL ??
  `http://127.0.0.1:${defaultServerPort}`;
const databaseUrl =
  process.env.XECMS_E2E_RUNNER_DATABASE_URL ??
  `postgresql://xecms:xecms@127.0.0.1:${databasePort}/xecms_e2e`;
const runId = `${process.pid}_${Date.now()}`;
const selectedSuiteNames = new Set(
  [
    ...(process.env.XECMS_E2E_SUITES ?? "").split(","),
    ...commandLineSuiteNames,
  ].map((name) => name.trim()).filter(Boolean),
);
const baseEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  DISABLE_ADMIN_ORIGINS: "false",
  XECMS_HOST: "127.0.0.1",
  XECMS_PORT: new URL(serverUrl).port || "80",
  XECMS_ADMIN_ORIGINS: serverUrl,
  XECMS_CONTENT_ORIGINS: serverUrl,
  DATABASE_URL: databaseUrl,
  XECMS_TEST_DATABASE_URL: databaseUrl,
  XECMS_E2E_DATABASE_URL: databaseUrl,
  XECMS_E2E_POSTGRES_PORT: databasePort,
  XECMS_RUN_POSTGRES_TESTS: "true",
  XECMS_SESSION_SECRET: "e2e-only-session-secret-change-me",
  XECMS_ADMIN_DIST: fileURLToPath(
    new URL("apps/admin/dist", rootDirectory),
  ),
  XECMS_SERVER_URL: serverUrl,
  XECMS_E2E_ADMIN_URL: serverUrl,
  XECMS_E2E_DISPLAY_MODE: "advanced",
  XECMS_WORKER_ENABLED: "false",
  XECMS_MEDIA_MAX_UPLOAD_BYTES: "1048576",
  XECMS_MEDIA_ALLOWED_MIME_TYPES: "image/png,image/jpeg",
  XECMS_E2E_DB_SERVICE: databaseServiceName,
};

function run(command, arguments_, environment = baseEnvironment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
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
      reject(
        new Error(
          `${command} ${arguments_.join(" ")} failed (${signal ?? code}).`,
        ),
      );
    });
  });
}

async function runBrowserSuite({
  name,
  specs,
  seeded = true,
  ownerPassword = "Admin-test-only-2026!",
  environment = {},
}) {
  const suiteMediaRoot = join(mediaRoot, name);
  await mkdir(suiteMediaRoot, { recursive: true });
  console.log(`\n[E2E] Browser suite: ${name}`);
  await run(pnpm, ["exec", "playwright", "test", ...specs], {
    ...baseEnvironment,
    XECMS_DB_SCHEMA: `xecms_e2e_${name.replaceAll("-", "_")}_${runId}`,
    XECMS_MEDIA_STORAGE_ROOT: suiteMediaRoot,
    XECMS_E2E_AUTO_BOOTSTRAP: String(seeded),
    XECMS_E2E_OWNER_PASSWORD: ownerPassword,
    ...environment,
  });
}

const browserSuites = [
  {
    name: "setup-and-content",
    seeded: false,
    specs: ["tests/e2e/m1-vertical-slice.spec.ts"],
  },
  {
    name: "content-and-authorization",
    seeded: false,
    specs: [
      "tests/e2e/m2-content-core.spec.ts",
      "tests/e2e/m3-authorization.spec.ts",
    ],
  },
  {
    name: "identity-realms",
    specs: ["tests/e2e/m4a-identity-realms.spec.ts"],
  },
  {
    name: "event-worker",
    specs: ["tests/e2e/m4b-event-worker.spec.ts"],
  },
  {
    name: "users",
    specs: ["tests/e2e/m4c1-users.spec.ts"],
  },
  {
    name: "settings-and-sites",
    specs: ["tests/e2e/m4c2-settings-sites.spec.ts"],
    environment: { XECMS_SCHEMA_MODE: "locked" },
  },
  {
    name: "operations",
    specs: ["tests/e2e/m4c3-operations.spec.ts"],
  },
  {
    name: "plugins",
    specs: ["tests/e2e/m4c4-plugins.spec.ts"],
  },
  {
    name: "runtime-health",
    specs: ["tests/e2e/m4c5-productization.spec.ts"],
    environment: { XECMS_E2E_DISPLAY_MODE: "" },
  },
  {
    name: "admin-apps",
    specs: ["tests/e2e/admin-apps.spec.ts"],
  },
];
const knownSuiteNames = new Set(browserSuites.map(({ name }) => name));
const unknownSuiteNames = [...selectedSuiteNames].filter((name) => !knownSuiteNames.has(name));
if (unknownSuiteNames.length > 0) {
  throw new Error(`Unknown E2E suite '${unknownSuiteNames[0]}'.`);
}
const mediaRoot = await mkdtemp(join(tmpdir(), "xecms-e2e-media-"));
const packRoot = await mkdtemp(join(tmpdir(), "xecms-release-pack-"));

let databaseStarted = false;

try {
  if (releaseMode) {
    await run(pnpm, ["clean"]);
  }
  await run(pnpm, ["build"], {
    ...baseEnvironment,
    NODE_ENV: "production",
  });
  if (releaseMode) {
    await run(pnpm, ["check:prototype"]);
    await run(pnpm, [
      "--filter",
      "@xecms/cli",
      "pack",
      "--pack-destination",
      packRoot,
    ]);
  }

  databaseStarted = true;
  await run(docker, [
    "compose",
    "--project-name",
    composeProjectName,
    "--profile",
    "e2e",
    "up",
    "--detach",
    "--wait",
    "postgres-e2e",
  ]);
  if (releaseMode) {
    await run(pnpm, ["test:database"]);
  }

  for (const suite of browserSuites) {
    if (
      selectedSuiteNames.size > 0 &&
      !selectedSuiteNames.has(suite.name)
    ) {
      continue;
    }
    await runBrowserSuite(suite);
  }
} finally {
  await Promise.all([
    rm(mediaRoot, { recursive: true, force: true }),
    rm(packRoot, { recursive: true, force: true }),
  ]);
  if (databaseStarted) {
    await run(docker, [
      "compose",
      "--project-name",
      composeProjectName,
      "--profile",
      "e2e",
      "down",
      "--volumes",
      "--remove-orphans",
    ]).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
