import { PostgresDatabase, PostgresPluginRecoveryStore } from "@xecms/database";
import type { CliIo } from "./cli.js";
import { cliError, type LoadedProject } from "./config.js";
import { syncPluginManifests } from "./plugin-sync.js";

export async function runPluginCommand(project: LoadedProject, args: string[], io: CliIo): Promise<number> {
  const action = args.shift();
  if (action === "sync") {
    const apply = takeFlag(args, "--apply");
    assertNoArgs(args);
    const { DEFAULT_PLUGIN_MODULES } = await import("@xecms/server");
    const report = await syncPluginManifests(project, DEFAULT_PLUGIN_MODULES, apply);
    for (const entry of report.entries) io.log(`${entry.status.toUpperCase()} ${entry.pluginId} revision=${entry.revision}${entry.reason ? `: ${entry.reason}` : ""}`);
    const drifted = report.entries.filter(entry => entry.status === "drifted");
    const blocked = report.entries.filter(entry => entry.status === "blocked" || entry.status === "missing-package");
    if (!apply && drifted.length) io.log(`${drifted.length} Plugin manifest(s) differ from this build. Re-run with --apply to revalidate and realign, then restart the server.`);
    if (apply && report.updated.length) io.log(`Realigned ${report.updated.length} Plugin manifest(s): ${report.updated.join(", ")}. Restart the server.`);
    if (!drifted.length && !blocked.length) io.log("All installed Plugin manifests and migration histories match this build.");
    return blocked.length ? 1 : 0;
  }
  if (action === "inspect") {
    const json = takeFlag(args, "--json");
    assertNoArgs(args);
    const entries = await withRecovery(project, store => store.inspect("wrk_default"));
    if (json) io.log(JSON.stringify({ entries }, null, 2));
    else {
      for (const entry of entries) {
        io.log(`${entry.pluginId} ${entry.desiredState} revision=${entry.revision} restart=${entry.restartRequired} manifest=${entry.manifestIntegrity ? "ok" : "drifted"} migrations=${entry.migrationIntegrity ? "ok" : "drifted"}`);
        if (entry.enabledDependents.length) io.log(`  Enabled dependents: ${entry.enabledDependents.join(", ")}`);
      }
      io.log("Inspected stored Plugin records without loading packages. Package availability and runtime health are not checked.");
    }
    return entries.some(entry => !entry.manifestIntegrity || !entry.migrationIntegrity) ? 1 : 0;
  }
  if (action === "disable") {
    if (!takeFlag(args, "--offline")) throw cliError("PLUGIN_OFFLINE_REQUIRED", "Use 'xecms plugin disable <id> --offline' for database-only recovery.");
    const expected = takeOption(args, "--expected-revision");
    if (expected !== undefined && (!/^[1-9]\d*$/.test(expected) || !Number.isSafeInteger(Number(expected)))) {
      throw cliError("PLUGIN_REVISION_INVALID", "--expected-revision must be a positive safe integer.");
    }
    const pluginId = args.shift();
    if (!pluginId || pluginId.startsWith("--")) throw cliError("PLUGIN_ID_REQUIRED", "Plugin ID is required.");
    assertNoArgs(args);
    const report = await withRecovery(project, store => store.disable("wrk_default", pluginId, expected === undefined ? undefined : Number(expected)));
    io.log(`${report.changed ? "Disabled" : "Already disabled"} ${pluginId} revision=${report.revision}. Plugin data, config and migration history are preserved.${report.restartRequired ? " Restart the server." : ""}`);
    if (report.enabledDependents.length) io.log(`Enabled dependents also need inspection before restart: ${report.enabledDependents.join(", ")}. Disable affected dependents individually.`);
    return 0;
  }
  throw cliError("COMMAND_INVALID", "Use 'xecms plugin inspect [--json]', 'xecms plugin disable <id> --offline [--expected-revision <n>]' or 'xecms plugin sync [--apply]'.");
}

async function withRecovery<T>(project: LoadedProject, operation: (store: PostgresPluginRecoveryStore) => Promise<T>): Promise<T> {
  const database = new PostgresDatabase({ connectionString: project.databaseUrl, schema: project.config.databaseSchema, maxConnections: 2 });
  try {
    return await operation(new PostgresPluginRecoveryStore(database.pool, database.schema));
  } finally {
    await database.close();
  }
}

function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}
function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw cliError("OPTION_VALUE_REQUIRED", `${name} requires a value.`);
  args.splice(index, 2);
  return value;
}
function assertNoArgs(args: readonly string[]): void {
  if (args.length) throw cliError("ARGUMENT_UNEXPECTED", `Unexpected argument '${args[0]}'.`);
}
