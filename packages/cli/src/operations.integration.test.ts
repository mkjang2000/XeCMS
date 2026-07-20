import { createHash,randomUUID } from "node:crypto";
import { access,mkdtemp,readFile,rm,writeFile,mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CORE_MIGRATION_IDS,PostgresDatabase,qualifiedName,quoteIdentifier } from "@xecms/database";
import { pluginManifestDigest,type XeCmsPluginManifestV1 } from "@xecms/plugin-sdk";
import { serializeSchema } from "@xecms/schema";
import { buildServer,DEFAULT_PLUGIN_MODULES } from "@xecms/server";
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { createBackup,restoreBackup } from "./backup.js";
import { doctor } from "./doctor.js";
import { syncPluginManifests } from "./plugin-sync.js";
import { scaffold } from "./scaffold.js";
import { starterSchema } from "./starters.js";
import type { LoadedProject } from "./config.js";
import { loadServerConfig } from "@xecms/server";

const RUN=process.env["XECMS_RUN_POSTGRES_TESTS"]==="true",DATABASE_URL=process.env["XECMS_TEST_DATABASE_URL"]??"postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});
// These cases mutate shared process.env (backup tool commands). `.sequential`
// forbids any interleaving and beforeEach clears prior state so one case can
// never observe another's docker-exec backup command (which would flip the
// doctor's backup-tools check to fail for an unrelated case).
describe.runIf(RUN).sequential("C5 doctor, backup and empty restore",()=>{
  beforeEach(()=>{for(const key of environmentKeys)delete process.env[key]});
  it("detects migration/storage drift and restores identity, authorization, content, Plugin and media",async()=>{const token=randomUUID().replaceAll("-","").slice(0,12),schema=`xecms_c5_${token}`,targetDatabase=`xecms_c5_restore_${token}`,sourceRoot=await projectRoot("blog"),targetRoot=await projectRoot("blog"),source=new PostgresDatabase({connectionString:DATABASE_URL,schema,maxConnections:4});let target:PostgresDatabase|undefined;const previous=saveEnvironment();try{
    const server=await buildServer({database:source,logger:false,config:loadServerConfig({NODE_ENV:"development",DATABASE_URL,XECMS_DB_SCHEMA:schema,XECMS_SESSION_SECRET:"c5-source-integration-secret-0123456789",XECMS_ADMIN_ORIGINS:"http://127.0.0.1:3999",XECMS_ADMIN_DIST:"/not-used",XECMS_MEDIA_STORAGE_ROOT:resolve(sourceRoot,".xecms/media"),XECMS_WORKER_ENABLED:"false"})});const bootstrap=await server.app.inject({method:"POST",url:"/api/bootstrap",payload:{username:"owner",password:"Strong-Owner-Password-2026!"}});expect(bootstrap.statusCode,bootstrap.body).toBe(201);await server.close();const q=(name:string)=>qualifiedName(schema,name),owner=(await source.pool.query<{id:string}>(`SELECT id FROM ${q("_xecms_identities")} WHERE is_owner=true`)).rows[0]!.id,schemaValue=starterSchema("blog"),serialized=serializeSchema(schemaValue),schemaHash=hash(serialized),now=new Date().toISOString();await source.pool.query("BEGIN");try{await source.pool.query(`INSERT INTO ${q("_xecms_schema_revisions")}(revision_id,schema_json,diff_json,hash,created_at,created_by) VALUES('rev_c5',$1::jsonb,'{}'::jsonb,$2,$3,$4)`,[serialized,schemaHash,now,owner]);await source.pool.query(`UPDATE ${q("_xecms_schema_state")} SET active_revision_id='rev_c5' WHERE singleton=true`);await source.pool.query(`INSERT INTO ${q("_xecms_documents")}(id,workspace_id,collection_id,current_draft_revision_id,publication,lifecycle,deletion,created_at,created_by,updated_at,updated_by,aggregate_version) VALUES('doc_c5','wrk_default','col_blog_posts',NULL,NULL,'{"kind":"draft"}'::jsonb,NULL,$1,$2,$1,$2,1)`,[now,owner]);await source.pool.query(`INSERT INTO ${q("_xecms_document_revisions")}(id,document_id,sequence,schema_revision_id,data,parent_revision_id,origin,created_at,created_by) VALUES('docrev_c5','doc_c5',1,'rev_c5','{"title":"Backup post","slug":"backup","content":{"format":"xecms.rich-text","formatVersion":2,"content":[]}}'::jsonb,NULL,'{"kind":"create"}'::jsonb,$1,$2)`,[now,owner]);await source.pool.query(`UPDATE ${q("_xecms_documents")} SET current_draft_revision_id='docrev_c5' WHERE id='doc_c5'`);const manifest:XeCmsPluginManifestV1={manifestVersion:1,id:"backup-probe",packageName:"@test/backup-probe",version:"1.0.0",displayName:"Backup Probe",compatibility:{core:">=0.5.0 <0.6.0",admin:">=0.5.0 <0.6.0",sdk:"1.x"}};await source.pool.query(`INSERT INTO ${q("_xecms_plugins")}(workspace_id,plugin_id,package_name,version,manifest,manifest_digest,desired_state,config,revision,restart_required,installed_at,installed_by,updated_at,updated_by) VALUES('wrk_default','backup-probe','@test/backup-probe','1.0.0',$1::jsonb,$2,'installed','{}',1,true,$3,$4,$3,$4)`,[JSON.stringify(manifest),pluginManifestDigest(manifest),now,owner]);const bytes=Buffer.from("C5 media integrity\n"),mediaHash=createHash("sha256").update(bytes).digest("hex");await mkdir(resolve(sourceRoot,".xecms/media/probe"),{recursive:true});await writeFile(resolve(sourceRoot,".xecms/media/probe/file.txt"),bytes);await source.pool.query(`INSERT INTO ${q("_xecms_media")}(id,workspace_id,original_file_name,mime_type,storage_key,status,size,sha256,created_at,created_by) VALUES('media_c5','wrk_default','file.txt','text/plain','probe/file.txt','ready',$1,$2,$3,$4)`,[bytes.length,mediaHash,now,owner]);await source.pool.query("COMMIT")}catch(error){await source.pool.query("ROLLBACK");throw error}
    const sourceProject=project(sourceRoot,DATABASE_URL,schema);const firstDoctor=await doctor(sourceProject);expect(firstDoctor.status,JSON.stringify(firstDoctor.checks)).toBe("healthy");await source.pool.query(`DELETE FROM ${q("_xecms_core_migrations")} WHERE id='0018_m4c4_plugin_platform'`);expect((await doctor(sourceProject)).checks).toContainEqual(expect.objectContaining({id:"migrations",status:"fail"}));await source.pool.query(`INSERT INTO ${q("_xecms_core_migrations")}(id,applied_at) VALUES('0018_m4c4_plugin_platform',now())`);
    await source.pool.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);const targetUrl=withDatabase(DATABASE_URL,targetDatabase),service=process.env["XECMS_C5_DB_SERVICE"]??"xecms-postgres-e2e-1",internalUrl="postgresql://xecms:xecms@127.0.0.1:5432/postgres";process.env["XECMS_PG_DUMP_COMMAND_JSON"]=JSON.stringify(["docker","exec","-i",service,"pg_dump"]);process.env["XECMS_PG_RESTORE_COMMAND_JSON"]=JSON.stringify(["docker","exec","-i",service,"pg_restore"]);process.env["XECMS_BACKUP_DATABASE_URL"]=withDatabase(internalUrl,databaseName(DATABASE_URL));process.env["XECMS_RESTORE_DATABASE_URL"]=withDatabase(internalUrl,targetDatabase);const backupDir=resolve(sourceRoot,"backups","verified");const backup=await createBackup(sourceProject,backupDir);expect(backup).toMatchObject({activeSchemaHash:schemaHash,xecmsVersion:"0.5.0"});const targetProject=project(targetRoot,targetUrl,schema);await expect(restoreBackup(targetProject,backupDir,false)).rejects.toMatchObject({code:"RESTORE_CONFIRMATION_REQUIRED"});await restoreBackup(targetProject,backupDir,true);target=new PostgresDatabase({connectionString:targetUrl,schema,maxConnections:3});for(const table of ["_xecms_identities","_xecms_auth_roles","_xecms_documents","_xecms_document_revisions","_xecms_plugins","_xecms_media"]){const sourceCount=await source.pool.query<{count:string}>(`SELECT count(*)::text count FROM ${q(table)}`),targetCount=await target.pool.query<{count:string}>(`SELECT count(*)::text count FROM ${qualifiedName(schema,table)}`);expect(targetCount.rows[0]!.count,table).toBe(sourceCount.rows[0]!.count)}expect(await readFile(resolve(targetRoot,".xecms/media/probe/file.txt"),"utf8")).toBe("C5 media integrity\n");expect((await doctor(targetProject)).status).toBe("healthy");
  }finally{restoreEnvironment(previous);await target?.close();await source.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(()=>undefined);await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabase)} WITH (FORCE)`).catch(()=>undefined);await source.close()}},60_000)
  it("upgrades a populated pre-C4 release fixture and remains idempotent",async()=>{const schema=`xecms_c5_upgrade_${randomUUID().replaceAll("-","")}`,database=new PostgresDatabase({connectionString:DATABASE_URL,schema,maxConnections:3}),q=(name:string)=>qualifiedName(schema,name);try{await database.migrate();await database.pool.query(`INSERT INTO ${q("_xecms_audit_log")}(event_type,occurred_at,metadata) VALUES('fixture.pre-c4',now(),'{"mustSurvive":true}')`);await database.pool.query(`DELETE FROM ${q("_xecms_auth_role_permissions")} WHERE permission_key IN ('plugin.enable','plugin.disable','plugin.uninstall')`);await database.pool.query(`DELETE FROM ${q("_xecms_auth_permissions")} WHERE permission_key IN ('plugin.enable','plugin.disable','plugin.uninstall')`);for(const table of ["_xecms_plugin_exports","_xecms_plugin_plans","_xecms_plugin_migrations","_xecms_plugins"])await database.pool.query(`DROP TABLE ${q(table)}`);await database.pool.query(`DELETE FROM ${q("_xecms_core_migrations")} WHERE id IN ('0018_m4c4_plugin_platform','0019_owner_delegation_reconciliation')`);await database.migrate();await database.migrate();expect((await database.pool.query(`SELECT metadata FROM ${q("_xecms_audit_log")} WHERE event_type='fixture.pre-c4'`)).rows[0]).toEqual({metadata:{mustSurvive:true}});expect((await database.pool.query(`SELECT id FROM ${q("_xecms_core_migrations")} ORDER BY id`)).rows.map(row=>row.id)).toHaveLength(CORE_MIGRATION_IDS.length);expect((await database.pool.query("SELECT to_regclass($1) name",[`${schema}._xecms_plugins`])).rows[0].name).toBe(`${schema}._xecms_plugins`)}finally{await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(()=>undefined);await database.close()}},30_000)
  it("recovers a boot-blocking Plugin manifest drift from the CLI",async()=>{
    // Manifest drift makes buildServer throw, so Admin Studio — where a
    // reinstall plan would normally be applied — is unreachable. `plugin sync`
    // is the only way out, and it must refuse when migrations also moved.
    const schema=`xecms_c5_pluginsync_${randomUUID().replaceAll("-","")}`;
    const root=await projectRoot("blog"),database=new PostgresDatabase({connectionString:DATABASE_URL,schema,maxConnections:3});
    const q=(name:string)=>qualifiedName(schema,name);
    try{
      await database.migrate();
      const loaded=project(root,DATABASE_URL,schema);
      const module=DEFAULT_PLUGIN_MODULES[0]!;
      const manifest=module.manifest;
      const now=new Date().toISOString();
      await database.pool.query(
        `INSERT INTO ${q("_xecms_plugins")}(workspace_id,plugin_id,package_name,version,manifest,manifest_digest,desired_state,config,revision,restart_required,installed_at,installed_by,updated_at,updated_by)
         VALUES('wrk_default',$1,$2,$3,$4::jsonb,'stale-digest','enabled','{}',1,false,$5,'usr_test',$5,'usr_test')`,
        [manifest.id,manifest.packageName,manifest.version,JSON.stringify(manifest),now],
      );
      for(const[index,migration]of(manifest.migrations??[]).entries())
        await database.pool.query(
          `INSERT INTO ${q("_xecms_plugin_migrations")}(workspace_id,plugin_id,migration_id,checksum,sequence,applied_at,applied_by) VALUES('wrk_default',$1,$2,$3,$4,$5,'usr_test')`,
          [manifest.id,migration.id,migration.checksum,index+1,now],
        );

      // Dry run reports the drift without touching anything.
      const preview=await syncPluginManifests(loaded,DEFAULT_PLUGIN_MODULES,false);
      expect(preview.entries).toMatchObject([{pluginId:manifest.id,status:"drifted"}]);
      expect(preview.updated).toEqual([]);
      expect((await database.pool.query<{manifest_digest:string}>(`SELECT manifest_digest FROM ${q("_xecms_plugins")}`)).rows[0]!.manifest_digest).toBe("stale-digest");

      const applied=await syncPluginManifests(loaded,DEFAULT_PLUGIN_MODULES,true);
      expect(applied.updated).toEqual([manifest.id]);
      expect((await database.pool.query<{manifest_digest:string}>(`SELECT manifest_digest FROM ${q("_xecms_plugins")}`)).rows[0]!.manifest_digest)
        .toBe(pluginManifestDigest(manifest));
      expect((await syncPluginManifests(loaded,DEFAULT_PLUGIN_MODULES,false)).entries).toMatchObject([{status:"in-sync"}]);

      // Migration drift means schema work: sync must refuse rather than paper over it.
      await database.pool.query(`UPDATE ${q("_xecms_plugins")} SET manifest_digest='stale-again' WHERE plugin_id=$1`,[manifest.id]);
      await database.pool.query(`DELETE FROM ${q("_xecms_plugin_migrations")} WHERE plugin_id=$1`,[manifest.id]);
      const blocked=await syncPluginManifests(loaded,DEFAULT_PLUGIN_MODULES,true);
      expect(blocked.entries).toMatchObject([{status:"blocked"}]);
      expect(blocked.updated).toEqual([]);
      expect((await database.pool.query<{manifest_digest:string}>(`SELECT manifest_digest FROM ${q("_xecms_plugins")}`)).rows[0]!.manifest_digest).toBe("stale-again");
    }finally{
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(()=>undefined);
      await database.close();
    }
  },30_000);
  it("leaves an empty retryable target when integrity fails after media promotion",async()=>{
    const token=randomUUID().replaceAll("-","").slice(0,12),schema=`xecms_c5_cleanup_${token}`,targetDatabase=`xecms_c5_cleanup_target_${token}`;
    const sourceRoot=await projectRoot("blog"),targetRoot=await projectRoot("blog"),source=new PostgresDatabase({connectionString:DATABASE_URL,schema,maxConnections:3});
    const previous=saveEnvironment();
    try{
      await source.migrate();
      await mkdir(resolve(sourceRoot,".xecms/media/probe"),{recursive:true});
      await writeFile(resolve(sourceRoot,".xecms/media/probe/file.txt"),"restore cleanup probe\n");
      await source.pool.query(`DELETE FROM ${qualifiedName(schema,"_xecms_core_migrations")}`);
      await source.pool.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)}`);
      const service=process.env["XECMS_C5_DB_SERVICE"]??"xecms-postgres-e2e-1",internalUrl="postgresql://xecms:xecms@127.0.0.1:5432/postgres";
      process.env["XECMS_PG_DUMP_COMMAND_JSON"]=JSON.stringify(["docker","exec","-i",service,"pg_dump"]);
      process.env["XECMS_PG_RESTORE_COMMAND_JSON"]=JSON.stringify(["docker","exec","-i",service,"pg_restore"]);
      process.env["XECMS_BACKUP_DATABASE_URL"]=withDatabase(internalUrl,databaseName(DATABASE_URL));
      process.env["XECMS_RESTORE_DATABASE_URL"]=withDatabase(internalUrl,targetDatabase);
      const backupDir=resolve(sourceRoot,"backups","invalid-history"),targetUrl=withDatabase(DATABASE_URL,targetDatabase),targetProject=project(targetRoot,targetUrl,schema);
      await createBackup(project(sourceRoot,DATABASE_URL,schema),backupDir);

      await expect(restoreBackup(targetProject,backupDir,true)).rejects.toMatchObject({code:"RESTORE_INTEGRITY_FAILED"});
      const targetDatabaseConnection=new PostgresDatabase({connectionString:targetUrl,schema,maxConnections:2});
      try{expect((await targetDatabaseConnection.pool.query<{exists:boolean}>("SELECT to_regnamespace($1) IS NOT NULL exists",[schema])).rows[0]!.exists).toBe(false)}finally{await targetDatabaseConnection.close()}
      await expect(access(resolve(targetRoot,".xecms/media"))).rejects.toMatchObject({code:"ENOENT"});
      await expect(restoreBackup(targetProject,backupDir,true)).rejects.toMatchObject({code:"RESTORE_INTEGRITY_FAILED"});
    }finally{
      restoreEnvironment(previous);
      await source.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(()=>undefined);
      await source.pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabase)} WITH (FORCE)`).catch(()=>undefined);
      await source.close();
    }
  },60_000)
});
async function projectRoot(starter:"blog"){const parent=await mkdtemp(resolve(tmpdir(),"xecms-c5-")),root=resolve(parent,"project");roots.push(parent);await scaffold(root,starter);return root}
function project(root:string,databaseUrl:string,schema:string):LoadedProject{return{root,databaseUrl,config:{projectName:"c5",starter:"blog",databaseSchema:schema,schemaFile:"xecms.schema.json",typesFile:"xecms.generated.ts",mediaStorageRoot:".xecms/media",adminDist:"node_modules/@xecms/admin-app/dist"}}}
function hash(value:string){return createHash("sha256").update(value).digest("hex")}function withDatabase(url:string,name:string){const parsed=new URL(url);parsed.pathname=`/${name}`;return parsed.toString()}function databaseName(url:string){return new URL(url).pathname.slice(1)}
const environmentKeys=["XECMS_PG_DUMP_COMMAND_JSON","XECMS_PG_RESTORE_COMMAND_JSON","XECMS_BACKUP_DATABASE_URL","XECMS_RESTORE_DATABASE_URL"] as const;function saveEnvironment(){return Object.fromEntries(environmentKeys.map(key=>[key,process.env[key]])) as Record<typeof environmentKeys[number],string|undefined>}function restoreEnvironment(values:ReturnType<typeof saveEnvironment>){for(const key of environmentKeys)values[key]===undefined?delete process.env[key]:process.env[key]=values[key]}
