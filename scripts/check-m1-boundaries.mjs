import { readdir, readFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
const rules = [
  {
    directory: "packages/application",
    allowedXeCms: new Set(["@xecms/admin-apps", "@xecms/authorization", "@xecms/core", "@xecms/schema", "@xecms/plugin-sdk"]),
  },
  {
    directory: "packages/database",
    allowedXeCms: new Set(["@xecms/admin-apps", "@xecms/application", "@xecms/core", "@xecms/schema", "@xecms/plugin-sdk", "@xecms/example-plugin"]),
  },
  {
    directory: "packages/plugin-sdk",
    allowedXeCms: new Set(),
  },
  {
    directory: "packages/cli",
    allowedXeCms: new Set(["@xecms/database", "@xecms/plugin-sdk", "@xecms/schema", "@xecms/server"]),
  },
  {
    directory: "examples/example-plugin",
    allowedXeCms: new Set(["@xecms/plugin-sdk"]),
  },
  {
    directory: "packages/contracts",
    allowedXeCms: new Set(["@xecms/admin-apps", "@xecms/schema"]),
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
    directory: "packages/admin-apps",
    allowedXeCms: new Set(),
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
      "@xecms/admin-apps",
      "@xecms/application",
      "@xecms/contracts",
      "@xecms/core",
      "@xecms/database",
      "@xecms/example-plugin",
      "@xecms/plugin-sdk",
      "@xecms/schema",
    ]),
  },
];

const violations = [];

for (const rule of rules) {
  const sourceDirectory = new URL(`${rule.directory}/src/`, root);
  for (const file of await walk(sourceDirectory)) {
    if (!new Set([".ts", ".tsx"]).has(extname(file.pathname))) continue;
    const source = await readFile(file, "utf8");
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ].map((match) => match[2]);

    for (const specifier of imports) {
      if (
        specifier?.startsWith("@xecms/") &&
        !rule.allowedXeCms.has(specifier)
      ) {
        violations.push(
          `${relative(root.pathname, file.pathname)} imports '${specifier}', which crosses its M1 package boundary.`,
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
  console.log("M1 application, database, client, Admin, and server boundaries are valid.");
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
