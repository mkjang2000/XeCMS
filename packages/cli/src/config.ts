import { access,readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

export interface XeCmsProjectConfig{readonly projectName:string;readonly starter:"minimal"|"blog"|"community";readonly databaseSchema:string;readonly schemaFile:string;readonly typesFile:string;readonly mediaStorageRoot:string;readonly adminDist:string}
export interface LoadedProject{readonly root:string;readonly config:XeCmsProjectConfig;readonly databaseUrl:string}
export async function loadProject(root=process.cwd(),requireDatabase=true):Promise<LoadedProject>{const absolute=resolve(root);const envFile=resolve(absolute,".env");try{await access(envFile,constants.R_OK);process.loadEnvFile(envFile)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}const value=JSON.parse(await readFile(resolve(absolute,"xecms.config.json"),"utf8")) as Partial<XeCmsProjectConfig>;for(const key of ["projectName","starter","databaseSchema","schemaFile","typesFile","mediaStorageRoot","adminDist"] as const)if(typeof value[key]!=="string"||value[key]!.length===0)throw cliError("CONFIG_INVALID",`xecms.config.json '${key}' is required.`);const databaseUrl=process.env["DATABASE_URL"]??"";if(requireDatabase&&!databaseUrl)throw cliError("DATABASE_URL_REQUIRED","DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");return{root:absolute,config:value as XeCmsProjectConfig,databaseUrl}}
export function cliError(code:string,message:string):Error&{code:string}{return Object.assign(new Error(message),{code})}
