import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerModules } from "./server-module-loader.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function project() {
  const root = await mkdtemp(resolve(tmpdir(), "xecms-modules-"));
  roots.push(root);
  await writeFile(resolve(root, "package.json"), JSON.stringify({ type: "module" }));
  return root;
}

describe("explicit server module loading", () => {
  it("starts with no optional modules by default", async () => {
    await expect(loadServerModules({ root: await project(), environment: {} })).resolves.toEqual({ extensions: [], plugins: [] });
  });

  it("resolves extension packages from the consuming project, not the engine", async () => {
    const root = await project();
    const directory = resolve(root, "node_modules", "test-extension");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
    await writeFile(resolve(directory, "index.js"), 'export default {id:"test",name:"Test",register(){}};');
    const loaded = await loadServerModules({ root, extensions: ["test-extension"], environment: {} });
    expect(loaded.extensions.map(extension => extension.id)).toEqual(["test"]);
    expect(loaded.plugins).toEqual([]);
  });

  it("loads import-only exports and selects the import branch of dual packages", async () => {
    const root = await project();
    for (const name of ["import-only", "dual-exports"]) {
      const directory = resolve(root, "node_modules", name);
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "package.json"), JSON.stringify({ type: "module", exports: {
        ".": { import: "./index.js", ...(name === "dual-exports" ? { require: "./require.cjs" } : {}) },
      } }));
      await writeFile(resolve(directory, "index.js"), `export default {id:"${name}",name:"ESM",register(){}};`);
      await writeFile(resolve(directory, "require.cjs"), 'throw new Error("The require branch must not load");');
    }
    const loaded = await loadServerModules({ root, extensions: ["import-only", "dual-exports"], environment: {} });
    expect(loaded.extensions.map(extension => extension.id)).toEqual(["import-only", "dual-exports"]);
  });

  it("resolves the same package independently in different consuming projects", async () => {
    const projects = [await project(), await project()];
    for (const [index, root] of projects.entries()) {
      const directory = resolve(root, "node_modules", "shared-name");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "package.json"), JSON.stringify({ type: "module", exports: { import: "./index.js" } }));
      await writeFile(resolve(directory, "index.js"), `export default {id:"project-${index}",name:"Project ${index}",register(){}};`);
    }
    for (const index of [0, 1, 0, 1]) {
      const loaded = await loadServerModules({ root: projects[index]!, extensions: ["shared-name"], environment: {} });
      expect(loaded.extensions[0]?.id).toBe(`project-${index}`);
    }
    // The temporary resolver must not change later imports from the engine.
    expect(() => import.meta.resolve("shared-name")).toThrow();
  });

  it("uses explicit selections over ambient environment and loads relative files", async () => {
    const root = await project();
    await writeFile(resolve(root, "extension.mjs"), 'export default {id:"local",name:"Local",register(){}};');
    const loaded = await loadServerModules({ root, extensions: ["./extension.mjs"], plugins: [],
      environment: { XECMS_SERVER_EXTENSIONS: '["missing"]', XECMS_PLUGINS: '["missing"]' } });
    expect(loaded.extensions[0]?.id).toBe("local");
  });

  it.each(["not-json", "{}", '[""]', "[null]"])("rejects malformed environment selections %s", async value => {
    await expect(loadServerModules({ environment: { XECMS_SERVER_EXTENSIONS: value } })).rejects.toThrow("JSON array");
  });

  it("rejects missing or invalid packages instead of silently starting without them", async () => {
    const root = await project();
    await expect(loadServerModules({ root, extensions: ["not-installed"], environment: {} })).rejects.toThrow();
    await writeFile(resolve(root, "invalid.mjs"), "export default {};");
    await expect(loadServerModules({ root, extensions: ["./invalid.mjs"], environment: {} })).rejects.toThrow("register function");
  });

  it("rejects duplicate extension ids", async () => {
    const root = await project();
    await writeFile(resolve(root, "extension.mjs"), 'export default {id:"same",name:"Same",register(){}};');
    await expect(loadServerModules({ root, extensions: ["./extension.mjs", "./extension.mjs"], environment: {} })).rejects.toThrow("Duplicate server extension");
  });
});
