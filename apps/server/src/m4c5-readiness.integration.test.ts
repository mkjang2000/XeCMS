import { randomUUID } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PostgresDatabase,qualifiedName,quoteIdentifier } from "@xecms/database";
import { describe,expect,it } from "vitest";
import { loadServerConfig } from "./config.js";
import { buildServer,type XeCmsServer } from "./server.js";

const RUN=process.env["XECMS_RUN_POSTGRES_TESTS"]==="true",DATABASE_URL=process.env["XECMS_TEST_DATABASE_URL"]??"postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
describe.runIf(RUN)("M4-C5 liveness and readiness",()=>{
  it("separates process liveness from migration-aware readiness",async()=>{const schema=`xecms_c5_ready_${randomUUID().replaceAll("-","")}`,storage=await mkdtemp(resolve(tmpdir(),"xecms-c5-ready-")),database=new PostgresDatabase({connectionString:DATABASE_URL,schema,maxConnections:3});let server:XeCmsServer|undefined;try{server=await buildServer({database,logger:false,config:loadServerConfig({NODE_ENV:"test",DATABASE_URL,XECMS_DB_SCHEMA:schema,XECMS_SESSION_SECRET:"c5-readiness-integration-secret-012345",XECMS_ADMIN_DIST:"/not-used",XECMS_MEDIA_STORAGE_ROOT:storage,XECMS_WORKER_ENABLED:"false"})});const live=await server.app.inject({method:"GET",url:"/api/live"});expect(live.statusCode).toBe(200);expect(live.headers["x-xecms-api-version"]).toBe("1");expect(live.json()).toEqual({status:"live",version:"0.4.1"});const ready=await server.app.inject({method:"GET",url:"/api/ready"});expect(ready.statusCode,ready.body).toBe(200);expect(ready.json()).toMatchObject({status:"ready",checks:{database:true,migrations:true,storage:true,plugins:true}});await database.pool.query(`DELETE FROM ${qualifiedName(schema,"_xecms_core_migrations")} WHERE id='0018_m4c4_plugin_platform'`);const drift=await server.app.inject({method:"GET",url:"/api/ready"});expect(drift.statusCode).toBe(503);expect(drift.json()).toMatchObject({status:"not-ready",checks:{database:true,migrations:false}});expect((await server.app.inject({method:"GET",url:"/api/live"})).statusCode).toBe(200)}finally{await server?.close();await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(()=>undefined);await database.close();await rm(storage,{recursive:true,force:true})}},30_000)
});
