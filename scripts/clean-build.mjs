import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const caches = ["coverage", "playwright-report", "test-results", ".cache", ".vite", ".vitest",
  "node_modules/.cache", "node_modules/.vite", "node_modules/.vitest"];

// Root dist holds prepared release artifacts and is intentionally preserved.
for (const cache of caches) await rm(resolve(root, cache), { recursive: true, force: true });

// TypeScript --clean only knows current inputs. Remove orphan outputs from moved
// features too, so packing the engine cannot retain old builder implementations.
for (const area of ["apps", "packages", "examples"]) {
  for (const entry of await readdir(resolve(root, area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const output of ["dist", "dist-types", ...caches]) {
      await rm(resolve(root, area, entry.name, output), { recursive: true, force: true });
    }
  }
}
console.log("Removed workspace build outputs and known test/tool caches; prepared releases and runtime data are preserved.");
