import { readdir, readFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
const rules = [
  {
    directory: "packages/application",
    allowedXeCms: new Set(["@xecms/authorization", "@xecms/core", "@xecms/schema", "@xecms/plugin-sdk"]),
  },
  {
    directory: "packages/database",
    allowedXeCms: new Set(["@xecms/application", "@xecms/core", "@xecms/schema", "@xecms/plugin-sdk"]),
    allowedTestXeCms: new Set(["@xecms/example-plugin"]),
  },
  {
    directory: "packages/plugin-sdk",
    allowedXeCms: new Set(),
  },
  {
    directory: "packages/cli",
    allowedXeCms: new Set(["@xecms/database", "@xecms/plugin-sdk", "@xecms/schema", "@xecms/server"]),
    allowedTestXeCms: new Set(["@xecms/example-plugin"]),
  },
  {
    directory: "examples/example-plugin",
    allowedXeCms: new Set(["@xecms/plugin-sdk"]),
  },
  {
    directory: "packages/contracts",
    allowedXeCms: new Set(["@xecms/schema"]),
  },
  {
    directory: "packages/client",
    allowedXeCms: new Set(["@xecms/contracts"]),
  },
  {
    directory: "packages/ui",
    allowedXeCms: new Set(),
  },
  {
    directory: "packages/admin",
    allowedXeCms: new Set(["@xecms/ui"]),
  },
  {
    directory: "apps/admin",
    allowedXeCms: new Set([
      "@xecms/admin",
      "@xecms/client",
      "@xecms/schema",
      "@xecms/ui",
    ]),
  },
  {
    directory: "apps/server",
    allowedXeCms: new Set([
      "@xecms/application",
      "@xecms/contracts",
      "@xecms/core",
      "@xecms/database",
      "@xecms/plugin-sdk",
      "@xecms/schema",
    ]),
    allowedTestXeCms: new Set(["@xecms/example-plugin"]),
  },
];

const violations = [];

for (const rule of rules) {
  const sourceDirectory = new URL(`${rule.directory}/src/`, root);
  for (const file of await walk(sourceDirectory)) {
    if (!new Set([".ts", ".tsx"]).has(extname(file.pathname))) continue;
    const source = await readFile(file, "utf8");
    const isTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.pathname);
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ].map((match) => match[2]);

    for (const specifier of imports) {
      // Compare by package name so subpath exports (e.g. "@xecms/ui/theme.css")
      // resolve to the same boundary rule as the package root.
      const packageName = specifier?.startsWith("@xecms/")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier;
      if (
        packageName?.startsWith("@xecms/") &&
        !rule.allowedXeCms.has(packageName) &&
        !(isTest && rule.allowedTestXeCms?.has(packageName))
      ) {
        violations.push(
          `${relative(root.pathname, file.pathname)} imports '${specifier}', which crosses its package boundary.`,
        );
      }
    }
  }

  const packageJson = JSON.parse(
    await readFile(new URL(`${rule.directory}/package.json`, root), "utf8"),
  );
  for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const dependency of Object.keys(packageJson[section] ?? {})) {
      if (dependency.startsWith("@xecms/") && !rule.allowedXeCms.has(dependency)) {
        violations.push(
          `${rule.directory}/package.json declares forbidden ${section} entry '${dependency}'.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Application, database, client, Admin, and server package boundaries are valid.");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...(await walk(location)));
    else files.push(location);
  }
  return files;
}
