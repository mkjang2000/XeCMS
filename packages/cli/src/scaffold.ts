import { randomBytes } from "node:crypto";
import { mkdir,readdir,writeFile } from "node:fs/promises";
import { basename,resolve } from "node:path";
import { cliError } from "./config.js";
import { starterArtifacts,type StarterName } from "./starters.js";

export async function scaffold(directory:string,starter:StarterName):Promise<string>{const root=resolve(directory);await mkdir(root,{recursive:true});if((await readdir(root)).length>0)throw cliError("DIRECTORY_NOT_EMPTY",`Refusing to initialize non-empty directory '${root}'.`);const projectName=safeName(basename(root)),artifacts=starterArtifacts(starter);const files:Record<string,string>={
  "package.json":`${JSON.stringify({name:projectName,version:"0.1.0",private:true,type:"module",scripts:{dev:"xecms dev",build:"xecms schema validate && xecms generate types",migrate:"xecms migrate",doctor:"xecms doctor",backup:"xecms backup create ./backups/manual"},dependencies:{"@xecms/cli":"^0.4.0","@xecms/server":"^0.4.0","@xecms/admin-app":"^0.4.0"}},null,2)}\n`,
  "xecms.config.json":`${JSON.stringify({projectName,starter,databaseSchema:"xecms",schemaFile:"xecms.schema.json",typesFile:"xecms.generated.ts",mediaStorageRoot:".xecms/media",adminDist:"node_modules/@xecms/admin-app/dist"},null,2)}\n`,
  "xecms.schema.json":artifacts.manifest,
  "xecms.generated.ts":artifacts.types,
  ".gitignore":"node_modules/\n.env\n.xecms/\nbackups/\n",
  ".env.example":env(false),".env":env(true),
  "compose.yaml":compose(),
  "README.md":readme(projectName,starter),
};for(const[name,contents]of Object.entries(files))await writeFile(resolve(root,name),contents,{encoding:"utf8",flag:"wx"});return root}
function safeName(value:string){const normalized=value.toLowerCase().replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");return normalized||"xecms-project"}
function env(secret:boolean){return`NODE_ENV=development\nXECMS_HOST=127.0.0.1\nXECMS_PORT=3100\nXECMS_ADMIN_ORIGINS=http://127.0.0.1:3100,http://localhost:3100\nDATABASE_URL=postgresql://xecms:xecms@127.0.0.1:54320/xecms\nXECMS_DB_SCHEMA=xecms\nXECMS_SESSION_SECRET=${secret?randomBytes(32).toString("base64url"):"replace-with-at-least-32-random-bytes"}\nXECMS_DEV_SEED=true\nXECMS_DEV_ADMIN_USERNAME=admin\nXECMS_DEV_ADMIN_PASSWORD=admin\nXECMS_MEDIA_STORAGE_ROOT=.xecms/media\nXECMS_WORKER_ENABLED=true\nXECMS_PG_DUMP_COMMAND_JSON=["docker","compose","exec","-T","postgres","pg_dump"]\nXECMS_PG_RESTORE_COMMAND_JSON=["docker","compose","exec","-T","postgres","pg_restore"]\nXECMS_BACKUP_DATABASE_URL=postgresql://xecms:xecms@127.0.0.1:5432/xecms\nXECMS_RESTORE_DATABASE_URL=postgresql://xecms:xecms@127.0.0.1:5432/xecms\n`}
function compose(){return`name: xecms-project\nservices:\n  postgres:\n    image: postgres:18-alpine\n    environment:\n      POSTGRES_DB: xecms\n      POSTGRES_USER: xecms\n      POSTGRES_PASSWORD: xecms\n    ports:\n      - "54320:5432"\n    volumes:\n      - postgres-data:/var/lib/postgresql\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U xecms -d xecms"]\n      interval: 2s\n      timeout: 5s\n      retries: 20\nvolumes:\n  postgres-data:\n`}
function readme(name:string,starter:StarterName){return`# ${name}\n\nXeCMS **${starter}** starter입니다.\n\n\`\`\`bash\npnpm install\ndocker compose up -d --wait\npnpm migrate\npnpm dev\n\`\`\`\n\nAdmin: http://127.0.0.1:3100/admin/ (development seed: admin/admin)\n\n배포 전 \`.env\`의 비밀번호와 session secret을 반드시 교체하세요. Schema를 수정한 후 \`pnpm build\`, 운영 점검은 \`pnpm doctor\`를 실행합니다.\n`}
