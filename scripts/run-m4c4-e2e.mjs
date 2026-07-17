import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootDirectory=new URL("../",import.meta.url),environmentFile=new URL(".env",rootDirectory);
if(existsSync(environmentFile))process.loadEnvFile(fileURLToPath(environmentFile));
const pnpm=process.platform==="win32"?"pnpm.cmd":"pnpm",docker=process.platform==="win32"?"docker.exe":"docker";
const serverUrl=process.env.XECMS_M4C4_SERVER_URL??"http://127.0.0.1:3140",databaseUrl=process.env.XECMS_M4C4_DATABASE_URL??"postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const environment={...process.env,NODE_ENV:"development",XECMS_HOST:"127.0.0.1",XECMS_PORT:new URL(serverUrl).port||"80",XECMS_ADMIN_ORIGINS:serverUrl,XECMS_CONTENT_ORIGINS:serverUrl,DATABASE_URL:databaseUrl,XECMS_TEST_DATABASE_URL:databaseUrl,XECMS_E2E_DATABASE_URL:databaseUrl,XECMS_DB_SCHEMA:process.env.XECMS_M4C4_DB_SCHEMA??`xecms_m4c4_e2e_${process.pid}_${Date.now()}`,XECMS_RUN_POSTGRES_TESTS:"true",XECMS_E2E_AUTO_BOOTSTRAP:"true",XECMS_E2E_OWNER_PASSWORD:"Admin-test-only-2026!",XECMS_E2E_DISPLAY_MODE:"advanced",XECMS_SESSION_SECRET:"m4c4-e2e-only-session-secret-change-me",XECMS_ADMIN_DIST:fileURLToPath(new URL("apps/admin/dist",rootDirectory)),XECMS_SERVER_URL:serverUrl,XECMS_E2E_ADMIN_URL:serverUrl,XECMS_WORKER_ENABLED:"false"};
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:rootDirectory,env:environment,stdio:"inherit"});child.once("error",reject);child.once("exit",(code,signal)=>code===0?resolve():reject(new Error(`${command} ${args.join(" ")} failed (${signal??code}).`)))})}
let databaseStarted=false;
try{await run(pnpm,["build"]);await run(pnpm,["build:admin"]);databaseStarted=true;await run(docker,["compose","--profile","e2e","up","--detach","--wait","postgres-e2e"]);await run(pnpm,["exec","vitest","run","packages/database/src/postgres-plugins.test.ts","apps/server/src/m4c4-plugin.integration.test.ts"]);await run(pnpm,["exec","playwright","test","tests/e2e/m4c4-plugins.spec.ts"])}finally{if(databaseStarted)await run(docker,["compose","--profile","e2e","rm","--force","--stop","--volumes","postgres-e2e"]).catch(error=>{console.error(error.message);process.exitCode=1})}
