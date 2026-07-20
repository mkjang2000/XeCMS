import { PostgresDatabase,qualifiedName } from "@xecms/database";
import { pluginManifestDigest,type XeCmsPluginManifestV1,type XeCmsPluginModule } from "@xecms/plugin-sdk";
import { cliError,type LoadedProject } from "./config.js";

const WORKSPACE_ID="wrk_default";

export interface PluginSyncEntry{
  readonly pluginId:string;
  readonly storedDigest:string;
  readonly currentDigest:string;
  readonly status:"in-sync"|"drifted"|"blocked"|"missing-package";
  readonly reason?:string;
}
export interface PluginSyncReport{
  readonly entries:readonly PluginSyncEntry[];
  readonly updated:readonly string[];
}

/**
 * Realigns stored Plugin manifests with the packages this build actually ships.
 *
 * The server refuses to boot when an enabled Plugin's stored manifest digest no
 * longer matches its package (PLUGIN_MANIFEST_DRIFT). That check protects data,
 * but it also locks the operator out of Admin Studio — the only place a
 * reinstall plan can be applied — so recovery needs a path that works without a
 * running server.
 *
 * Only the manifest envelope is rewritten. A manifest whose migration list no
 * longer matches the applied history is reported as blocked and left untouched:
 * that difference implies schema work, which must go through a real plan.
 */
export async function syncPluginManifests(
  project:LoadedProject,
  modules:readonly XeCmsPluginModule[],
  apply:boolean,
):Promise<PluginSyncReport>{
  const database=new PostgresDatabase({connectionString:project.databaseUrl,schema:project.config.databaseSchema,maxConnections:3});
  const q=(name:string)=>qualifiedName(database.schema,name);
  const byId=new Map(modules.map(module=>[module.manifest.id,module]));
  const entries:PluginSyncEntry[]=[];
  const updated:string[]=[];
  try{
    const installed=await database.pool.query<{plugin_id:string;manifest:XeCmsPluginManifestV1;manifest_digest:string;desired_state:string}>(
      `SELECT plugin_id,manifest,manifest_digest,desired_state FROM ${q("_xecms_plugins")} WHERE workspace_id=$1 ORDER BY plugin_id`,
      [WORKSPACE_ID],
    );
    for(const row of installed.rows){
      const module=byId.get(row.plugin_id);
      if(module===undefined){
        entries.push({pluginId:row.plugin_id,storedDigest:row.manifest_digest,currentDigest:"",status:"missing-package",
          reason:"Plugin package is not present in this build."});
        continue;
      }
      const currentDigest=pluginManifestDigest(module.manifest);
      if(currentDigest===row.manifest_digest){
        entries.push({pluginId:row.plugin_id,storedDigest:row.manifest_digest,currentDigest,status:"in-sync"});
        continue;
      }
      const history=await database.pool.query<{migration_id:string;checksum:string}>(
        `SELECT migration_id,checksum FROM ${q("_xecms_plugin_migrations")} WHERE workspace_id=$1 AND plugin_id=$2 ORDER BY sequence`,
        [WORKSPACE_ID,row.plugin_id],
      );
      const applied=history.rows.map(entry=>`${entry.migration_id}:${entry.checksum}`);
      const declared=(module.manifest.migrations??[]).map(entry=>`${entry.id}:${entry.checksum}`);
      if(JSON.stringify(applied)!==JSON.stringify(declared)){
        entries.push({pluginId:row.plugin_id,storedDigest:row.manifest_digest,currentDigest,status:"blocked",
          reason:"Migration history differs from the manifest; reinstall through Admin Studio."});
        continue;
      }
      entries.push({pluginId:row.plugin_id,storedDigest:row.manifest_digest,currentDigest,status:"drifted"});
      if(apply){
        await database.pool.query(
          `UPDATE ${q("_xecms_plugins")} SET manifest=$3::jsonb,manifest_digest=$4,restart_required=true WHERE workspace_id=$1 AND plugin_id=$2`,
          [WORKSPACE_ID,row.plugin_id,JSON.stringify(module.manifest),currentDigest],
        );
        updated.push(row.plugin_id);
      }
    }
  }catch(error){
    throw cliError("PLUGIN_SYNC_FAILED",`Plugin manifest sync failed: ${error instanceof Error?error.message:String(error)}`);
  }finally{
    await database.close();
  }
  return {entries,updated};
}
