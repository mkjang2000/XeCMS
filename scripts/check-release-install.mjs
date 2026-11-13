import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const args = process.argv.slice(2).filter(argument => argument !== "--");
const directories = args.filter(argument => !argument.startsWith("--"));
const directoryArgument = directories[0];
if (directories.length !== 1 || args.some(argument => argument !== directoryArgument && !["--offline", "--keep"].includes(argument))) {
  throw new Error("Usage: node scripts/check-release-install.mjs <release-directory> [--offline] [--keep]");
}
const directory = resolve(directoryArgument);
const manifest = JSON.parse(await readFile(join(directory, "release-manifest.json"), "utf8"));
assert.match(manifest.engineVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
assert.ok(Array.isArray(manifest.packages) && manifest.packages.length > 0, "Release packages are required.");
const tarballs = {};
for (const item of manifest.packages) {
  assert.equal(basename(item.filename), item.filename, "Tarballs must be inside the release directory.");
  assert.equal(tarballs[item.name], undefined, `Duplicate release package: ${item.name}`);
  const tarball = join(directory, item.filename);
  const contents = await readFile(tarball);
  const hash = createHash("sha512").update(contents);
  const digest = item.sha512.startsWith("sha512-") ? `sha512-${hash.digest("base64")}` : hash.digest("hex");
  assert.equal(digest, item.sha512, `Checksum mismatch: ${item.filename}`);
  tarballs[item.name] = `file:${tarball}`;
}
for (const required of ["create-xecms", "@xecms/cli", "@xecms/server", "@xecms/admin-app"]) {
  assert.ok(tarballs[required], `Missing release package: ${required}`);
}

const root = await mkdtemp(join(tmpdir(), `xecms-release-${manifest.engineVersion}-`));
const creator = join(root, "creator");
const project = join(root, "consumer");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const environment = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` };
const testDatabaseUrl = process.env.XECMS_TEST_DATABASE_URL;
const schema = `xecms_release_${randomUUID().replaceAll("-", "")}`;
// Never let a developer's application settings select a database or extension.
const runtimeEnvironment = Object.fromEntries(Object.entries(environment)
  .filter(([name]) => !["DATABASE_URL", "NODE_PATH", "NODE_OPTIONS"].includes(name) && !name.startsWith("XECMS_")));
let databaseUsed = false;
try {
  await mkdir(creator);
  await writeJson(join(creator, "package.json"), {
    name: "xecms-packed-creator-check", private: true, type: "module",
    dependencies: { "create-xecms": tarballs["create-xecms"] }, overrides: tarballs,
  });
  await install(creator);
  await node(creator, [join(creator, "node_modules/create-xecms/bin.js"), project, "--starter", "minimal"]);
  console.log("Packed create-xecms generated an independent minimal project.");

  const packageFile = join(project, "package.json");
  const generated = JSON.parse(await readFile(packageFile, "utf8"));
  const dependencies = Object.keys(generated.dependencies);
  assert.deepEqual(dependencies.sort(), ["@xecms/admin-app", "@xecms/cli", "@xecms/server"]);
  for (const name of dependencies) {
    assert.equal(generated.dependencies[name], `^${manifest.engineVersion}`, `Scaffold version mismatch: ${name}`);
    generated.dependencies[name] = tarballs[name];
  }
  const configurationFile = join(project, "xecms.config.json");
  const configuration = JSON.parse(await readFile(configurationFile, "utf8"));
  assert.deepEqual(configuration.extensions, []);
  assert.deepEqual(configuration.plugins, []);
  generated.overrides = tarballs;
  await writeJson(packageFile, generated);
  await install(project);
  await verifyEngineInstallation();
  const cli = join(project, "node_modules/@xecms/cli/dist/bin.js");
  const version = await node(project, [cli, "version"]);
  assert.ok(version.includes(`XeCMS ${manifest.engineVersion}`), `Unexpected CLI version: ${version}`);
  await node(project, [cli, "schema", "validate"]);
  await node(project, [cli, "generate", "types"]);
  assert.ok((await readFile(join(project, configuration.typesFile), "utf8")).length > 0);
  console.log(`Engine ${manifest.engineVersion}: installation, isolation, Schema validation and type generation passed.`);

  if (testDatabaseUrl) {
    databaseUsed = true;
    await verifyServer(cli);
  }
  if (!testDatabaseUrl) console.log("Database/startup checks skipped: set XECMS_TEST_DATABASE_URL to enable them.");
  console.log(`Release installation checks passed for ${manifest.engineVersion}. Nothing was published.`);
} finally {
  if (databaseUsed) {
    await node(project, ["--input-type=module", "-e", `
      import {PostgresDatabase,quoteIdentifier} from '@xecms/database';
      const database=new PostgresDatabase({connectionString:process.env.DATABASE_URL,schema:process.env.XECMS_DB_SCHEMA});
      try {await database.pool.query('DROP SCHEMA IF EXISTS '+quoteIdentifier(database.schema)+' CASCADE');}
      finally {await database.close();}
    `], { ...runtimeEnvironment, DATABASE_URL: testDatabaseUrl, XECMS_DB_SCHEMA: schema });
  }
  if (args.includes("--keep")) console.log(`Kept consumer fixtures at ${root}`);
  else await rm(root, { recursive: true, force: true });
}

async function install(cwd) {
  const options = ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"];
  if (args.includes("--offline")) options.push("--offline");
  await command(npm, options, cwd, environment);
}

async function node(cwd, arguments_, env = runtimeEnvironment) {
  return command(process.execPath, arguments_, cwd, env);
}

async function command(executable, arguments_, cwd, env) {
  try {
    const result = await execute(executable, arguments_, { cwd, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    throw new Error(`${basename(executable)} ${arguments_.slice(0, 2).join(" ")} failed in ${cwd}:\n${error.stderr ?? error.message}\n${error.stdout ?? ""}`, { cause: error });
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function verifyEngineInstallation() {
  const lock = JSON.parse(await readFile(join(project, "package-lock.json"), "utf8"));
  const forbidden = name => name.startsWith("@xecms/app-builder-")
    || ["@xecms/admin-apps", "@xecms/admin-runtime", "@xecms/example-plugin", "react", "react-dom", "react-is", "react-router", "recharts"].includes(name)
    || ["@blocknote/", "@mantine/", "@tanstack/"].some(prefix => name.startsWith(prefix));
  for (const location of Object.keys(lock.packages)) {
    const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
    assert.ok(!forbidden(name), `Engine installed optional/frontend package: ${name}`);
  }
  for (const name of ["@xecms/cli", "@xecms/server", "@xecms/admin-app"]) {
    assert.ok((await realpath(join(project, "node_modules", name))).startsWith(`${project}/`), `${name} resolves outside the consumer.`);
    const installed = JSON.parse(await readFile(join(project, "node_modules", name, "package.json"), "utf8"));
    assert.equal(installed.version, manifest.engineVersion);
  }
  await node(project, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {DEFAULT_PLUGIN_MODULES,loadServerModules} from '@xecms/server';
    assert.deepEqual(DEFAULT_PLUGIN_MODULES,[]);
    assert.deepEqual(await loadServerModules({extensions:[],plugins:[]}),{extensions:[],plugins:[]});
  `]);
}

async function verifyServer(cli) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [cli, "dev"], {
    cwd: project, stdio: ["ignore", "pipe", "pipe"],
    env: { ...runtimeEnvironment, NODE_ENV: "test", DATABASE_URL: testDatabaseUrl,
      XECMS_DB_SCHEMA: schema, XECMS_HOST: "127.0.0.1", XECMS_PORT: String(port),
      XECMS_SESSION_SECRET: "release-install-test-only-secret-0123456789",
      XECMS_ADMIN_ORIGINS: origin, XECMS_CONTENT_ORIGINS: origin,
      XECMS_WORKER_ENABLED: "false", XECMS_MEDIA_STORAGE_ROOT: join(project, ".xecms/media"),
    },
  });
  let output = "";
  let startupError;
  child.on("error", error => { startupError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-64_000); });
  const exited = new Promise(resolveExit => child.once("exit", resolveExit));
  try {
    const deadline = Date.now() + 45_000;
    while (true) {
      if (startupError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Consumer server failed: ${startupError ?? output}`);
      try { if ((await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(1_000) })).ok) break; } catch { /* Still starting. */ }
      if (Date.now() >= deadline) throw new Error(`Consumer server did not become ready:\n${output}`);
      await delay(100);
    }
    for (const route of ["/api/live", "/api/health"]) assert.equal((await fetch(`${origin}${route}`)).status, 200);
    await verifyHtml(origin, "/admin/setup", "/admin/");
    const appRoute = await fetch(`${origin}/api/admin-apps`);
    assert.equal(appRoute.status, 404);
    console.log("Engine consumer server: readiness, routes and served assets passed.");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { await exited; } finally { clearTimeout(timeout); }
    }
  }
}

async function verifyHtml(origin, route, prefix) {
  const response = await fetch(`${origin}${route}`);
  assert.equal(response.status, 200, route);
  assert.ok(response.headers.get("content-type")?.includes("text/html"), route);
  const assets = [...(await response.text()).matchAll(/(?:src|href)="([^\"]+)"/g)]
    .map(match => match[1]).filter(path => path.startsWith(prefix));
  assert.ok(assets.length > 0, `No bundled assets in ${route}`);
  for (const asset of assets) assert.equal((await fetch(new URL(asset, origin))).status, 200, asset);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}
