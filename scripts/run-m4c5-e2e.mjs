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
const defaultServerPort = 32_000 + (process.pid % 1_000);
const serverUrl =
  process.env.XECMS_M4C5_SERVER_URL ??
  `http://127.0.0.1:${defaultServerPort}`;
const databaseUrl =
  process.env.XECMS_M4C5_DATABASE_URL ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const runId = `${process.pid}_${Date.now()}`;
const mediaRoot = await mkdtemp(join(tmpdir(), "xecms-m4c5-media-"));
const packRoot = await mkdtemp(join(tmpdir(), "xecms-m4c5-pack-"));
const fastMode = process.env.XECMS_M4C5_FAST === "true";
const selectedJourneyNames = new Set(
  (process.env.XECMS_M4C5_JOURNEYS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
const baseEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  XECMS_HOST: "127.0.0.1",
  XECMS_PORT: new URL(serverUrl).port || "80",
  XECMS_ADMIN_ORIGINS: serverUrl,
  XECMS_CONTENT_ORIGINS: serverUrl,
  DATABASE_URL: databaseUrl,
  XECMS_TEST_DATABASE_URL: databaseUrl,
  XECMS_E2E_DATABASE_URL: databaseUrl,
  XECMS_RUN_POSTGRES_TESTS: "true",
  XECMS_DEV_ADMIN_USERNAME: "admin",
  XECMS_DEV_ADMIN_PASSWORD: "admin",
  XECMS_SESSION_SECRET: "m4c5-e2e-only-session-secret-change-me",
  XECMS_ADMIN_DIST: fileURLToPath(
    new URL("apps/admin/dist", rootDirectory),
  ),
  XECMS_SERVER_URL: serverUrl,
  XECMS_E2E_ADMIN_URL: serverUrl,
  XECMS_WORKER_ENABLED: "false",
  XECMS_MEDIA_MAX_UPLOAD_BYTES: "1048576",
  XECMS_MEDIA_ALLOWED_MIME_TYPES: "image/png,image/jpeg",
  XECMS_C5_DB_SERVICE: "xecms-postgres-e2e-1",
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

async function runBrowserJourney({
  name,
  specs,
  seeded = true,
  ownerPassword = seeded ? "admin" : "Admin-test-only-2026!",
  environment = {},
}) {
  const journeyMediaRoot = join(mediaRoot, name);
  await mkdir(journeyMediaRoot, { recursive: true });
  console.log(`\n[M4-C5] Browser journey: ${name}`);
  await run(pnpm, ["exec", "playwright", "test", ...specs], {
    ...baseEnvironment,
    XECMS_DB_SCHEMA: `xecms_m4c5_${name}_${runId}`,
    XECMS_MEDIA_STORAGE_ROOT: journeyMediaRoot,
    XECMS_DEV_SEED: String(seeded),
    XECMS_E2E_OWNER_PASSWORD: ownerPassword,
    ...environment,
  });
}

const browserJourneys = [
  {
    name: "m1",
    seeded: false,
    specs: ["tests/e2e/m1-vertical-slice.spec.ts"],
  },
  {
    name: "m2_m3",
    seeded: false,
    specs: [
      "tests/e2e/m2-content-core.spec.ts",
      "tests/e2e/m3-authorization.spec.ts",
    ],
  },
  {
    name: "m4a",
    specs: ["tests/e2e/m4a-identity-realms.spec.ts"],
  },
  {
    name: "m4b",
    specs: ["tests/e2e/m4b-event-worker.spec.ts"],
  },
  {
    name: "m4c1",
    specs: ["tests/e2e/m4c1-users.spec.ts"],
  },
  {
    name: "m4c2",
    specs: ["tests/e2e/m4c2-settings-sites.spec.ts"],
    environment: { XECMS_SCHEMA_MODE: "locked" },
  },
  {
    name: "m4c3",
    specs: ["tests/e2e/m4c3-operations.spec.ts"],
  },
  {
    name: "m4c4",
    specs: ["tests/e2e/m4c4-plugins.spec.ts"],
  },
  {
    name: "m4c5",
    specs: ["tests/e2e/m4c5-productization.spec.ts"],
  },
];

let databaseStarted = false;

try {
  if (!fastMode) {
    await run(pnpm, ["build"]);
    await run(pnpm, ["build:admin"]);
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
    "--profile",
    "e2e",
    "up",
    "--detach",
    "--wait",
    "postgres-e2e",
  ]);
  if (!fastMode) {
    await run(pnpm, [
      "exec",
      "vitest",
      "run",
      "packages/cli/src/operations.integration.test.ts",
      "apps/server/src/m4c5-readiness.integration.test.ts",
    ]);
  }

  for (const journey of browserJourneys) {
    if (
      selectedJourneyNames.size > 0 &&
      !selectedJourneyNames.has(journey.name)
    ) {
      continue;
    }
    await runBrowserJourney(journey);
  }
} finally {
  await Promise.all([
    rm(mediaRoot, { recursive: true, force: true }),
    rm(packRoot, { recursive: true, force: true }),
  ]);
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
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
