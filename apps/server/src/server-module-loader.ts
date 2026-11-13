import { registerHooks } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePluginModule, type XeCmsPluginModule } from "@xecms/plugin-sdk";
import type { ServerExtension } from "./server-extensions.js";

export interface ServerModuleSelection {
  readonly root?: string;
  readonly extensions?: readonly string[];
  readonly plugins?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** Load only explicitly selected trusted packages from the consuming project. */
export async function loadServerModules(selection: ServerModuleSelection = {}): Promise<{
  readonly extensions: readonly ServerExtension[];
  readonly plugins: readonly XeCmsPluginModule[];
}> {
  const root = resolve(selection.root ?? process.cwd());
  const environment = selection.environment ?? process.env;
  const extensionNames = selection.extensions ?? moduleNames(environment["XECMS_SERVER_EXTENSIONS"], "XECMS_SERVER_EXTENSIONS");
  const pluginNames = selection.plugins ?? moduleNames(environment["XECMS_PLUGINS"], "XECMS_PLUGINS");
  const extensions: ServerExtension[] = [];
  const plugins: XeCmsPluginModule[] = [];
  for (const name of extensionNames) {
    const candidate = await loadModule(root, name);
    if (!record(candidate) || typeof candidate["id"] !== "string" || candidate["id"].length === 0
      || typeof candidate["name"] !== "string" || typeof candidate["register"] !== "function") {
      throw new Error(`Server extension '${name}' must default-export an id, name and register function.`);
    }
    if (extensions.some(extension => extension.id === candidate["id"])) {
      throw new Error(`Duplicate server extension '${candidate["id"]}'.`);
    }
    extensions.push(candidate as unknown as ServerExtension);
  }
  for (const name of pluginNames) {
    const candidate = await loadModule(root, name);
    if (!record(candidate) || !record(candidate["manifest"])) {
      throw new Error(`Plugin '${name}' must default-export a Plugin module.`);
    }
    validatePluginModule(candidate as unknown as XeCmsPluginModule);
    const plugin = candidate as unknown as XeCmsPluginModule;
    if (plugins.some(existing => existing.manifest.id === plugin.manifest.id)) {
      throw new Error(`Duplicate Plugin '${plugin.manifest.id}'.`);
    }
    plugins.push(plugin);
  }
  return { extensions, plugins };
}

function moduleNames(value: string | undefined, setting: string): readonly string[] {
  if (value === undefined) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${setting} must be a JSON array of module names.`); }
  if (!Array.isArray(parsed) || parsed.some(name => typeof name !== "string" || name.trim().length === 0)) {
    throw new Error(`${setting} must be a JSON array of nonempty module names.`);
  }
  return parsed as string[];
}

async function loadModule(root: string, name: string): Promise<unknown> {
  if (typeof name !== "string" || name.trim().length === 0) throw new Error("Server module names must be nonempty strings.");
  const location = resolveModule(root, name);
  const loaded = await import(location) as { readonly default?: unknown };
  return loaded.default;
}

function resolveModule(root: string, name: string): string {
  const specifier = isAbsolute(name) ? pathToFileURL(name).href : name;
  const parentURL = pathToFileURL(resolve(root, "package.json")).href;
  // Node ignores import.meta.resolve's parent argument without a startup flag.
  // Keep this hook strictly synchronous: no other task can resolve a module
  // before finally removes it, and the import below uses the resolved URL.
  const hook = registerHooks({
    resolve(requested, context, nextResolve) {
      return nextResolve(requested,
        requested === specifier && context.parentURL === import.meta.url
          ? { ...context, parentURL }
          : context,
      );
    },
  });
  try {
    return import.meta.resolve(specifier);
  } finally {
    hook.deregister();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
