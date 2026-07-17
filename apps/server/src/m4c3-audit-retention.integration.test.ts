import { randomUUID } from "node:crypto";
import { PostgresDatabase, qualifiedName, quoteIdentifier } from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";
import { bootstrapTestOwner, TEST_OWNER_PASSWORD, TEST_OWNER_USERNAME } from "./integration-test-support.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN=process.env["XECMS_RUN_POSTGRES_TESTS"]==="true";
const DATABASE_URL=process.env["XECMS_TEST_DATABASE_URL"]??process.env["DATABASE_URL"]??"postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const ORIGIN="http://127.0.0.1:3199";
interface Session{readonly cookie:string;readonly csrfToken:string}

describe.runIf(RUN)("M4-C3 Audit and retention HTTP acceptance",()=>{
  it("enforces query contracts, redaction, export, reauth, CAS preview/apply and media reporting",async()=>{
    const schema=`xecms_m4c3_${randomUUID().replaceAll("-","_")}`;
    const database=new PostgresDatabase({connectionString:DATABASE_URL,schema,maxConnections:5});
    let server:XeCmsServer|undefined;
    try{
      server=await buildServer({database,logger:false,config:loadServerConfig({NODE_ENV:"development",DATABASE_URL,XECMS_DB_SCHEMA:schema,XECMS_SESSION_SECRET:"m4c3-integration-session-secret-0123456789",XECMS_ADMIN_ORIGINS:ORIGIN,XECMS_ADMIN_DIST:"/not-used-in-http-test"})});
      await bootstrapTestOwner(server);
      const session=await login(server);
      const owner=await database.findOwnerIdentity();
      await database.pool.query(
        `INSERT INTO ${qualifiedName(schema,"_xecms_audit_log")}(event_type,identity_id,occurred_at,metadata)
         VALUES ('login.failed',$1,'2026-07-15T12:00:00.000Z',$2::jsonb)`,
        [owner!.id,JSON.stringify({workspaceId:"wrk_default",password:"http-fixture-secret",nested:{tokenHash:"http-fixture-secret"}})],
      );

      const list=await get(server,session,"/api/audit?category=security&action=login.failed&limit=1");
      expect(list.statusCode,list.body).toBe(200);
      expect(list.json().items[0]).toMatchObject({action:"login.failed",metadata:{password:"[REDACTED]",nested:{tokenHash:"[REDACTED]"}}});
      expect(list.body).not.toContain("http-fixture-secret");
      const detail=await get(server,session,`/api/audit/${encodeURIComponent(list.json().items[0].id)}`);
      expect(detail.statusCode,detail.body).toBe(200);
      expect((await get(server,session,"/api/audit?unknown=true")).statusCode).toBe(400);
      expect((await get(server,session,"/api/audit/export")).statusCode).toBe(400);
      const exported=await get(server,session,"/api/audit/export?from=2026-07-15T00%3A00%3A00.000Z&to=2026-07-16T00%3A00%3A00.000Z");
      expect(exported.statusCode,exported.body).toBe(200);
      expect(exported.headers["content-type"]).toContain("application/x-ndjson");
      expect(exported.body).not.toContain("http-fixture-secret");

      const policyResponse=await get(server,session,"/api/retention/policy");
      expect(policyResponse.statusCode,policyResponse.body).toBe(200);
      const policy=policyResponse.json();
      const wrong=await mutate(server,session,"PATCH","/api/retention/policy",policyInput(policy.revision,"wrong"));
      expect(wrong.statusCode).toBe(401);
      const updated=await mutate(server,session,"PATCH","/api/retention/policy",policyInput(policy.revision,TEST_OWNER_PASSWORD));
      expect(updated.statusCode,updated.body).toBe(200);
      expect(updated.json()).toMatchObject({revision:policy.revision+1,auditDays:90});
      const noCsrf=await server.app.inject({method:"POST",url:"/api/retention/preview",headers:{cookie:session.cookie,origin:ORIGIN},payload:{expectedPolicyRevision:updated.json().revision}});
      expect(noCsrf.statusCode).toBe(403);
      const preview=await mutate(server,session,"POST","/api/retention/preview",{expectedPolicyRevision:updated.json().revision});
      expect(preview.statusCode,preview.body).toBe(201);
      expect(preview.json()).toMatchObject({status:"previewed",policyRevision:updated.json().revision});
      const wrongApply=await mutate(server,session,"POST",`/api/retention/plans/${preview.json().id}/apply`,{expectedPolicyRevision:updated.json().revision,currentPassword:"wrong"});
      expect(wrongApply.statusCode).toBe(401);
      const applied=await mutate(server,session,"POST",`/api/retention/plans/${preview.json().id}/apply`,{expectedPolicyRevision:updated.json().revision,currentPassword:TEST_OWNER_PASSWORD});
      expect(applied.statusCode,applied.body).toBe(200);
      expect(applied.json().status).toBe("applied");
      const idempotent=await mutate(server,session,"POST",`/api/retention/plans/${preview.json().id}/apply`,{expectedPolicyRevision:updated.json().revision,currentPassword:TEST_OWNER_PASSWORD});
      expect(idempotent.statusCode,idempotent.body).toBe(200);
      expect((await get(server,session,"/api/media/consistency")).statusCode).toBe(200);
    }finally{
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(()=>undefined);
      await database.close();
    }
  },30_000);
});

function policyInput(revision:number,currentPassword:string){return{expectedRevision:revision,auditDays:90,dispatchedOutboxDays:7,succeededDeliveryDays:7,deadDeliveryDays:30,expiredSessionDays:1,softDeletedDocumentDays:1,currentPassword}}
async function login(server:XeCmsServer):Promise<Session>{const response=await server.app.inject({method:"POST",url:"/api/auth/login",headers:{origin:ORIGIN},payload:{username:TEST_OWNER_USERNAME,password:TEST_OWNER_PASSWORD}});expect(response.statusCode,response.body).toBe(200);return{cookie:String(response.headers["set-cookie"]).split(";",1)[0]!,csrfToken:response.json().csrfToken as string}}
function get(server:XeCmsServer,session:Session,url:string):Promise<LightMyRequestResponse>{return server.app.inject({method:"GET",url,headers:{cookie:session.cookie,origin:ORIGIN}})}
function mutate(server:XeCmsServer,session:Session,method:"POST"|"PATCH",url:string,payload:Readonly<Record<string,unknown>>):Promise<LightMyRequestResponse>{return server.app.inject({method,url,headers:{cookie:session.cookie,"x-csrf-token":session.csrfToken,origin:ORIGIN},payload})}
