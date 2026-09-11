import { PostgresDatabase, PostgresPluginRecoveryStore, type PluginSyncReport } from "@xecms/database";
import type { XeCmsPluginModule } from "@xecms/plugin-sdk";
import { cliError, type LoadedProject } from "./config.js";

export type { PluginSyncEntry, PluginSyncReport } from "@xecms/database";

/** Existing CLI API; every apply validates a fresh transactional snapshot. */
export async function syncPluginManifests(
  project: LoadedProject,
  modules: readonly XeCmsPluginModule[],
  apply: boolean,
): Promise<PluginSyncReport> {
  const database = new PostgresDatabase({ connectionString: project.databaseUrl, schema: project.config.databaseSchema, maxConnections: 3 });
  try {
    return await new PostgresPluginRecoveryStore(database.pool, database.schema).sync("wrk_default", modules, apply);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "PLUGIN_REVISION_CONFLICT") throw error;
    throw cliError("PLUGIN_SYNC_FAILED", `Plugin manifest sync failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await database.close();
  }
}
