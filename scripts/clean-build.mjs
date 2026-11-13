import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// TypeScript --clean only knows current inputs. Remove orphan outputs from moved
// features too, so packing the engine cannot retain old builder implementations.
for (const area of ["apps", "packages", "examples"]) {
  for (const entry of await readdir(resolve(root, area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const output of ["dist", "dist-types"]) {
      await rm(resolve(root, area, entry.name, output), { recursive: true, force: true });
    }
  }
}
console.log("Removed generated workspace build outputs, including files orphaned by package moves.");
