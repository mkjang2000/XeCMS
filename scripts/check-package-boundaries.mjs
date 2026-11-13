import { access, readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const domainPackages = new Set(["packages/schema", "packages/core", "packages/authorization"]);
const rules = [
  { directory: "packages/application", allowed: ["authorization", "core", "schema", "plugin-sdk"] },
  { directory: "packages/database", allowed: ["application", "core", "schema", "plugin-sdk"], tests: ["example-plugin"] },
  { directory: "packages/plugin-sdk", allowed: [] },
  { directory: "packages/cli", allowed: ["database", "plugin-sdk", "schema", "server"], tests: ["example-plugin"] },
  { directory: "examples/example-plugin", allowed: ["plugin-sdk"] },
  { directory: "packages/contracts", allowed: ["schema"] },
  { directory: "packages/client", allowed: ["contracts"] },
  { directory: "packages/ui", allowed: [] },
  { directory: "packages/admin", allowed: ["ui"] },
  { directory: "apps/admin", allowed: ["admin", "client", "schema", "ui"] },
  { directory: "apps/server", allowed: ["application", "contracts", "core", "database", "plugin-sdk", "schema"], tests: ["example-plugin"] },
].map(rule => ({ directory: rule.directory,
  allowed: new Set(rule.allowed.map(name => `@xecms/${name}`)),
  tests: new Set((rule.tests ?? []).map(name => `@xecms/${name}`)),
}));
const rulesByDirectory = new Map(rules.map(rule => [rule.directory, rule]));
const dependencySections = ["dependencies", "optionalDependencies", "peerDependencies"];
const forbidden = name => name === "@xecms/admin-apps" || name === "@xecms/admin-runtime"
  || name.startsWith("@xecms/app-builder-") || name === "@xecms/example-plugin" || name === "recharts";
const packages = new Map();
const violations = [];

for (const area of ["apps", "packages", "examples"]) {
  for (const entry of await readdir(resolve(root, area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = `${area}/${entry.name}`;
    let manifest;
    try { manifest = JSON.parse(await readFile(resolve(root, directory, "package.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    packages.set(manifest.name, { directory, manifest });
    const rule = rulesByDirectory.get(directory);
    for (const section of dependencySections) {
      const dependencies = Object.keys(manifest[section] ?? {});
      if (domainPackages.has(directory) && dependencies.length) {
        violations.push(`${directory}/package.json has ${section}: ${dependencies.join(", ")}. Core domain packages must remain dependency-free.`);
      }
      for (const dependency of dependencies) {
        if (rule && dependency.startsWith("@xecms/") && !rule.allowed.has(dependency)) {
          violations.push(`${directory}/package.json declares forbidden ${section} entry '${dependency}'.`);
        }
      }
    }
  }
}

for (const directory of new Set([...domainPackages, ...rulesByDirectory.keys()])) {
  if (![...packages.values()].some(item => item.directory === directory)) {
    throw new Error(`Missing package manifest for boundary rule '${directory}'.`);
  }
  await access(resolve(root, directory, "src"));
}

// Check the shared source tree once for domain, package and engine isolation rules.
for (const area of ["apps", "packages", "examples"]) {
  for (const file of await walk(resolve(root, area))) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const location = relative(root, file).replaceAll("\\", "/");
    const directory = location.split("/").slice(0, 2).join("/");
    const inSource = location.startsWith(`${directory}/src/`);
    const extension = extname(file);
    const rule = inSource && [".ts", ".tsx"].includes(extension) ? rulesByDirectory.get(directory) : undefined;
    const domain = inSource && extension === ".ts" && domainPackages.has(directory);
    const isTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)) {
      const specifier = match[2];
      const packageName = specifier.startsWith("@xecms/") ? specifier.split("/").slice(0, 2).join("/") : specifier;
      if (domain && !specifier.startsWith(".") && specifier !== "vitest") {
        violations.push(`${location} imports '${specifier}', but core domain packages may only use relative domain imports.`);
      }
      if (rule && packageName.startsWith("@xecms/") && !rule.allowed.has(packageName)
        && !(isTest && rule.tests.has(packageName))) {
        violations.push(`${location} imports '${specifier}', which crosses its package boundary.`);
      }
      if (area !== "examples" && !/\.(test|spec)\./.test(file)
        && (forbidden(specifier.split("/").slice(0, 2).join("/")) || /plugins\/app-builder/.test(specifier))) {
        violations.push(`${location} imports optional builder/example code: ${specifier}`);
      }
    }
  }
}

// Follow production dependencies so an indirect optional feature cannot enter the engine.
const visited = new Set();
for (const name of ["@xecms/cli", "@xecms/server", "@xecms/admin-app", "@xecms/client"]) visit(name, []);
function visit(name, chain) {
  if (forbidden(name)) {
    violations.push(`Engine production dependency: ${[...chain, name].join(" → ")}`);
    return;
  }
  if (visited.has(name)) return;
  visited.add(name);
  const item = packages.get(name);
  if (!item) {
    if (name.startsWith("@xecms/")) violations.push(`Unknown workspace dependency '${name}'.`);
    return;
  }
  for (const section of dependencySections) {
    for (const dependency of Object.keys(item.manifest[section] ?? {})) visit(dependency, [...chain, name]);
  }
}

// The Admin package distributes complete browser bundles, so its UI build dependencies
// must remain devDependencies rather than being installed again by consumers.
const admin = packages.get("@xecms/admin-app");
if (!admin) violations.push("Missing browser bundle package '@xecms/admin-app'.");
else for (const section of dependencySections) {
  for (const dependency of Object.keys(admin.manifest[section] ?? {})) {
    violations.push(`@xecms/admin-app ships a complete browser bundle; move ${section} entry '${dependency}' to devDependencies.`);
  }
}

if (process.argv.includes("--built")) {
  for (const asset of await readdir(resolve(root, "apps/admin/dist/assets"))) {
    if (/^(composed-|admin-app-pages-|admin-runtime-page-|block-editor-)/.test(asset)) {
      violations.push(`Engine Admin bundle contains builder asset '${asset}'.`);
    }
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Domain and package boundaries are valid; engine dependencies and browser bundles remain isolated from optional features.");
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "dist-types"].includes(entry.name)) files.push(...await walk(location));
    } else files.push(location);
  }
  return files;
}
