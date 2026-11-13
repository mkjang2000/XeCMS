import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = new Map();
for (const directory of ["apps", "packages", "examples"]) {
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const location = resolve(root, directory, entry.name);
    try {
      const manifest = JSON.parse(await readFile(resolve(location, "package.json"), "utf8"));
      packages.set(manifest.name, { location, manifest });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

const violations = [];
const visited = new Set();
const forbidden = (name) => name === "@xecms/admin-apps" || name === "@xecms/admin-runtime"
  || name.startsWith("@xecms/app-builder-") || name === "@xecms/example-plugin" || name === "recharts";
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
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const dependency of Object.keys(item.manifest[section] ?? {})) visit(dependency, [...chain, name]);
  }
}
for (const name of ["@xecms/cli", "@xecms/server", "@xecms/admin-app", "@xecms/client"]) visit(name, []);

// These packages distribute complete browser bundles. Their source dependencies
// belong in devDependencies so installing the assets does not reinstall the UI stack.
for (const name of ["@xecms/admin-app"]) {
  const item = packages.get(name);
  if (!item) {
    violations.push(`Missing browser bundle package '${name}'.`);
    continue;
  }
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const dependency of Object.keys(item.manifest[section] ?? {})) {
      violations.push(`${name} ships a complete browser bundle; move ${section} entry '${dependency}' to devDependencies.`);
    }
  }
}

// Relative imports can bypass a package.json-only check.
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "dist-types"].includes(entry.name)) await inspect(location);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      const source = await readFile(location, "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)) {
        const specifier = match[2];
        if (forbidden(specifier.split("/").slice(0, 2).join("/")) || /plugins\/app-builder/.test(specifier)) {
          violations.push(`${relative(root, location)} imports optional builder/example code: ${specifier}`);
        }
      }
    }
  }
}
for (const directory of ["apps", "packages"]) await inspect(resolve(root, directory));

if (process.argv.includes("--built")) {
  const assets = resolve(root, "apps/admin/dist/assets");
  for (const entry of await readdir(assets)) {
    if (/^(composed-|admin-app-pages-|admin-runtime-page-|block-editor-)/.test(entry)) {
      violations.push(`Engine Admin bundle contains builder asset '${entry}'.`);
    }
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Engine dependencies exclude the optional builder and example Plugin; browser bundles have no install-time UI dependencies.");
}
