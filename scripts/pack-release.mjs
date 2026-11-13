import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2).filter(value => value !== "--");
if (args.length !== 2 || args[0] !== "--output") {
  throw new Error("Usage: pnpm release:pack --output <empty-directory>. Build with pnpm build:all first.");
}
const output = resolve(args[1]);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length !== 0) throw new Error(`Release output must be empty: ${output}`);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const staging = await mkdtemp(join(tmpdir(), "xecms-pack-"));
const packages = await workspacePackages();
const ordered = dependencyOrder(packages);
const artifacts = [];

try {
  for (const item of ordered) {
    const packageStage = join(staging, item.manifest.name.replaceAll("/", "-"));
    const original = join(packageStage, "original");
    const unpacked = join(packageStage, "unpacked");
    await mkdir(original, { recursive: true });
    await mkdir(unpacked);
    // pnpm resolves workspace:* to the actual publishable package version.
    await run(pnpm, ["pack", "--pack-destination", original], item.directory);
    const tarballs = (await readdir(original)).filter(name => name.endsWith(".tgz"));
    if (tarballs.length !== 1) throw new Error(`Expected one packed file for ${item.manifest.name}.`);
    await run("tar", ["-xzf", join(original, tarballs[0]), "-C", unpacked]);
    const contents = join(unpacked, "package");
    const manifest = JSON.parse(await readFile(join(contents, "package.json"), "utf8"));
    // Keep redistribution notices in every artifact, including compiled SPAs.
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) await copyFile(join(root, name), join(contents, name));
    if (Array.isArray(manifest.files)) manifest.files = [...new Set([...manifest.files, "LICENSE", "THIRD_PARTY_NOTICES.md"])];
    await writeFile(join(contents, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await validatePackage(contents, manifest);
    const packed = JSON.parse(await run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", output], contents));
    if (packed.length !== 1) throw new Error(`Expected one final artifact for ${manifest.name}.`);
    const filename = packed[0].filename;
    const bytes = await readFile(join(output, filename));
    const files = packed[0].files.map(file => file.path);
    for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
      if (!files.includes(notice)) throw new Error(`${manifest.name} is missing ${notice}.`);
    }
    artifacts.push({ name: manifest.name, version: manifest.version, filename,
      sha512: createHash("sha512").update(bytes).digest("hex"), bytes: bytes.length,
      dependencies: manifest.dependencies ?? {}, optionalDependencies: manifest.optionalDependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {}, files: files.length });
    console.log(`${manifest.name}@${manifest.version}: ${filename} (${bytes.length} bytes)`);
  }
  const engine = packages.get("@xecms/server").manifest.version;
  await writeFile(join(output, "release-manifest.json"), `${JSON.stringify({
    engineVersion: engine, status: "prepared-not-published", packages: artifacts,
  }, null, 2)}\n`);
  console.log(`Prepared ${artifacts.length} packages in ${output}. No registry writes were performed.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

async function workspacePackages() {
  const result = new Map();
  for (const area of ["packages", "apps", "examples"]) {
    for (const entry of await readdir(join(root, area), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, area, entry.name);
      let manifest;
      try { manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (!manifest.private) result.set(manifest.name, { directory, manifest });
    }
  }
  return result;
}

function dependencyOrder(items) {
  const ordered = [], active = new Set(), complete = new Set();
  function visit(name) {
    if (complete.has(name)) return;
    if (active.has(name)) throw new Error(`Circular release dependency: ${name}`);
    const item = items.get(name);
    if (!item) throw new Error(`Missing public workspace package: ${name}`);
    active.add(name);
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependency, version] of Object.entries(item.manifest[section] ?? {})) {
        if (version.startsWith("workspace:") || dependency.startsWith("@xecms/")) visit(dependency);
      }
    }
    active.delete(name); complete.add(name); ordered.push(item);
  }
  for (const name of items.keys()) visit(name);
  return ordered;
}

async function validatePackage(directory, manifest) {
  if (manifest.private || manifest.publishConfig?.access !== "public") throw new Error(`${manifest.name} must explicitly publish publicly.`);
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (/^(workspace:|link:|file:)/.test(version)) throw new Error(`${manifest.name} retains local ${name}: ${version}.`);
      if (section !== "devDependencies" && packages.has(name) && version !== packages.get(name).manifest.version) {
        throw new Error(`${manifest.name} has inconsistent release dependency ${name}: ${version}.`);
      }
    }
  }
  const entrypoints = [manifest.main, manifest.module, manifest.types, ...strings(manifest.exports),
    ...(typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {}))].filter(Boolean);
  if (manifest.name === "@xecms/admin-app") entrypoints.push("dist/index.html");
  if (entrypoints.length === 0) throw new Error(`${manifest.name} has no entrypoint.`);
  for (const entry of entrypoints) {
    if (entry.includes("*")) throw new Error(`Wildcard export needs an explicit pack check: ${manifest.name} ${entry}`);
    await access(join(directory, entry));
  }
  for (const file of await walk(directory)) {
    const relative = file.slice(directory.length + 1).replaceAll("\\", "/");
    if (/(^|\/)(node_modules|devdocs|\.env(?:\..*)?)($|\/)|\.(test|spec)\.[^/]+$|\.tsbuildinfo$|(^|\/)(?:[^/]*-)?test-(?:support|fixtures)(?:\.|\/)/.test(relative)) {
      throw new Error(`${manifest.name} contains internal file ${relative}.`);
    }
    if (!/\.(js|css|html)$/.test(file)) continue;
    const source = await readFile(file, "utf8");
    // CSS is not copied by tsc; validate source-relative CSS exports/imports too.
    for (const match of source.matchAll(/(?:from\s*|import\s*)(["'])(\.[^"']+\.css)\1/g)) {
      await access(resolve(dirname(file), match[2]));
    }
    if (relative === "dist/index.html") {
      for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const asset = match[1].split("?", 1)[0];
        if (asset.includes("/assets/")) await access(join(directory, "dist/assets", asset.split("/assets/")[1]));
      }
    }
  }
}

function strings(value) {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected non-file in packed output: ${path}`);
  }
  return files;
}

async function run(command, args, cwd = root) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolvePromise(stdout)
      : reject(new Error(`${command} ${args.join(" ")} failed (${code}).\n${stderr || stdout}`)));
  });
}
