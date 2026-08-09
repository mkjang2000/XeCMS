import { readdir, readFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
const domainPackages = ["schema", "core", "authorization"];
const allowedExternalImports = new Set(["vitest"]);
const violations = [];

for (const packageName of domainPackages) {
  const sourceDirectory = new URL(`packages/${packageName}/src/`, root);
  for (const file of await walk(sourceDirectory)) {
    if (extname(file.pathname) !== ".ts") {
      continue;
    }
    const source = await readFile(file, "utf8");
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ].map((match) => match[2]);

    for (const specifier of imports) {
      if (
        specifier === undefined ||
        specifier.startsWith(".") ||
        allowedExternalImports.has(specifier)
      ) {
        continue;
      }
      violations.push(
        `${relative(root.pathname, file.pathname)} imports '${specifier}', but core domain packages may only use relative domain imports.`,
      );
    }
  }

  const packageJsonUrl = new URL(`packages/${packageName}/package.json`, root);
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));
  for (const dependencySection of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = Object.keys(packageJson[dependencySection] ?? {});
    if (dependencies.length > 0) {
      violations.push(
        `packages/${packageName}/package.json has ${dependencySection}: ${dependencies.join(", ")}. Core domain packages must remain dependency-free.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Core domain package boundaries are valid.");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      files.push(...(await walk(location)));
    } else {
      files.push(location);
    }
  }
  return files;
}
