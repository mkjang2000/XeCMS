import { createHash } from "node:crypto";

export const XECMS_PLUGIN_MANIFEST_VERSION = 1 as const;
export const XECMS_PLUGIN_SDK_VERSION = "1.0.0";
export const XECMS_CORE_VERSION = "0.5.0";
export const XECMS_ADMIN_VERSION = "0.5.0";

export type PluginHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type PluginDocumentHookStage = "beforeValidate" | "afterValidate" | "beforeCreate" | "beforeUpdate" | "beforeDelete";
export type PluginAdminSlot = "dashboard.main" | "operations.overview" | "settings.after";

export interface PluginFieldExtension {
  readonly id: string; readonly label: string;
  readonly storage: "json"; readonly widget: "text" | "textarea" | "number" | "json";
}
export interface PluginRouteDeclaration {
  readonly id: string; readonly method: PluginHttpMethod; readonly path: string;
  readonly permission: string;
}
export interface PluginAdminSlotDeclaration {
  readonly id: string; readonly slot: PluginAdminSlot; readonly title: string;
}
export interface PluginMigrationDeclaration { readonly id: string; readonly checksum: string; }
export interface XeCmsPluginManifestV1 {
  readonly manifestVersion: 1; readonly id: string; readonly packageName: string;
  readonly version: string; readonly displayName: string; readonly description?: string;
  readonly compatibility: { readonly core: string; readonly admin: string; readonly sdk: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly serverEntry?: "server"; readonly adminEntry?: "admin";
  readonly extensions?: {
    readonly permissions?: readonly string[]; readonly fields?: readonly PluginFieldExtension[];
    readonly routes?: readonly PluginRouteDeclaration[]; readonly hooks?: readonly string[];
    readonly eventHandlers?: readonly string[]; readonly adminSlots?: readonly PluginAdminSlotDeclaration[];
  };
  readonly migrations?: readonly PluginMigrationDeclaration[];
  readonly dataTables?: readonly string[];
}
export interface PluginMigrationContext {
  readonly table: (unqualifiedName: string) => string;
  query(sql: string, values?: readonly unknown[]): Promise<{ readonly rowCount: number | null; readonly rows: readonly Record<string, unknown>[] }>;
}
export interface PluginMigration {
  readonly id: string; readonly checksum: string;
  up(context: PluginMigrationContext): Promise<void>;
  readonly down?: (context: PluginMigrationContext) => Promise<void>;
}
export interface PluginRouteContext {
  readonly workspaceId: string; readonly subjectId: string; readonly identityId?: string;
  readonly params: Readonly<Record<string, string>>; readonly query: Readonly<Record<string, string>>;
  readonly body: unknown; readonly config: Readonly<Record<string, unknown>>;
}
export interface PluginRoute {
  readonly id: string; readonly method: PluginHttpMethod; readonly path: string; readonly permission: string;
  handle(context: PluginRouteContext): Promise<unknown> | unknown;
}
export interface PluginDocumentHook {
  readonly id: string; readonly priority?: number; readonly stages: readonly PluginDocumentHookStage[];
  run(context: Readonly<Record<string, unknown>>): Promise<void> | void;
}
export interface PluginDurableEventHandler {
  readonly id: string; readonly topics: readonly string[];
  handle(event: Readonly<Record<string, unknown>>, context: { readonly idempotencyKey: string; readonly deliveryId: string }): Promise<void>;
}
export interface PluginAdminCard {
  readonly id: string; readonly slot: PluginAdminSlot; readonly title: string;
  readonly description: string; readonly status?: string;
  readonly link?: { readonly label: string; readonly href: string };
}
export interface XeCmsPluginModule {
  readonly manifest: XeCmsPluginManifestV1;
  readonly server?: {
    readonly migrations?: readonly PluginMigration[]; readonly routes?: readonly PluginRoute[];
    readonly hooks?: readonly PluginDocumentHook[]; readonly eventHandlers?: readonly PluginDurableEventHandler[];
    readonly health?: () => Promise<{ readonly status: "ok" | "degraded"; readonly detail?: string }>;
  };
  readonly admin?: { readonly cards: readonly PluginAdminCard[] };
}

export class PluginManifestError extends Error {
  public readonly issues: readonly string[];
  public constructor(issues: readonly string[]) { super(`Invalid XeCMS Plugin manifest: ${issues.join("; ")}`); this.name="PluginManifestError"; this.issues=issues; }
}

export function definePlugin(module: XeCmsPluginModule): XeCmsPluginModule {
  validatePluginModule(module);
  return Object.freeze(module);
}

export function validatePluginModule(module: XeCmsPluginModule, versions={core:XECMS_CORE_VERSION,admin:XECMS_ADMIN_VERSION,sdk:XECMS_PLUGIN_SDK_VERSION}):void{
  const m=module.manifest,issues:string[]=[];
  if(m.manifestVersion!==1)issues.push("manifestVersion must be 1");
  if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(m.id))issues.push("id must be lowercase kebab-case");
  if(!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(m.packageName))issues.push("packageName is invalid");
  if(!semver(m.version))issues.push("version must be SemVer");
  if(m.displayName.trim()==="")issues.push("displayName is required");
  for(const [key,range,current] of [["core",m.compatibility.core,versions.core],["admin",m.compatibility.admin,versions.admin],["sdk",m.compatibility.sdk,versions.sdk]] as const){
    if(!supports(current,range))issues.push(`${key} ${current} is outside '${range}'`);
  }
  const dot=(value:string,kind:string)=>{if(!value.startsWith(`${m.id}.`))issues.push(`${kind} '${value}' must use ${m.id} namespace`)};
  for(const permission of m.extensions?.permissions??[])dot(permission,"permission");
  for(const field of m.extensions?.fields??[]){if(!field.id.startsWith(`${m.id}:`))issues.push(`field '${field.id}' must use ${m.id} namespace`)}
  for(const route of m.extensions?.routes??[]){dot(route.id,"route");dot(route.permission,"route permission");if(!route.path.startsWith(`/api/plugins/${m.id}/`))issues.push(`route path '${route.path}' is outside Plugin namespace`)}
  for(const id of m.extensions?.hooks??[])dot(id,"hook");
  for(const id of m.extensions?.eventHandlers??[])dot(id,"event handler");
  for(const slot of m.extensions?.adminSlots??[])dot(slot.id,"admin slot");
  const prefix=`_xecms_plugin_${m.id.replaceAll("-","_")}_`;
  for(const table of m.dataTables??[]){if(!table.startsWith(prefix)||!/^_[a-z0-9_]+$/.test(table))issues.push(`data table '${table}' must start with ${prefix}`)}
  const unique=(values:readonly string[],kind:string)=>{const seen=new Set<string>();for(const value of values){if(seen.has(value))issues.push(`duplicate ${kind} '${value}'`);seen.add(value)}};
  unique([...(m.extensions?.permissions??[]),...(m.extensions?.fields??[]).map(x=>x.id),...(m.extensions?.routes??[]).map(x=>x.id),...(m.extensions?.hooks??[]),...(m.extensions?.eventHandlers??[]),...(m.extensions?.adminSlots??[]).map(x=>x.id)],"extension");
  unique((m.migrations??[]).map(x=>x.id),"migration");
  const runtimeMigrations=module.server?.migrations??[];
  if(JSON.stringify(runtimeMigrations.map(x=>({id:x.id,checksum:x.checksum})))!==JSON.stringify(m.migrations??[]))issues.push("runtime migrations must exactly match manifest order and checksum");
  matchIds(m.extensions?.routes,module.server?.routes,"route",issues);
  matchIds(m.extensions?.hooks,module.server?.hooks,"hook",issues);
  matchIds(m.extensions?.eventHandlers,module.server?.eventHandlers,"event handler",issues);
  matchIds(m.extensions?.adminSlots,module.admin?.cards,"admin slot",issues);
  if(issues.length)throw new PluginManifestError(issues);
}

export function validatePluginGraph(modules:readonly XeCmsPluginModule[]):void{
  const issues:string[]=[],byId=new Map<string,XeCmsPluginModule>();
  for(const module of modules){validatePluginModule(module);if(byId.has(module.manifest.id))issues.push(`duplicate Plugin '${module.manifest.id}'`);byId.set(module.manifest.id,module)}
  for(const module of modules)for(const [id,range] of Object.entries(module.manifest.dependencies??{})){const dependency=byId.get(id);if(!dependency)issues.push(`${module.manifest.id} requires missing ${id}`);else if(!supports(dependency.manifest.version,range))issues.push(`${module.manifest.id} requires ${id} ${range}`)}
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string,path:string[])=>{if(visiting.has(id)){issues.push(`dependency cycle: ${[...path,id].join(" -> ")}`);return}if(visited.has(id))return;visiting.add(id);for(const dep of Object.keys(byId.get(id)?.manifest.dependencies??{}))if(byId.has(dep))visit(dep,[...path,id]);visiting.delete(id);visited.add(id)};
  for(const id of byId.keys())visit(id,[]);
  if(issues.length)throw new PluginManifestError(issues);
}

export function pluginManifestDigest(manifest:XeCmsPluginManifestV1):string{return createHash("sha256").update(stable(manifest)).digest("hex")}
export function supports(version:string,range:string):boolean{
  const parsed=parse(version);if(!parsed)return false;
  const major=/^(\d+)\.x$/.exec(range);if(major)return parsed[0]===Number(major[1]);
  const exact=parse(range);if(exact)return compare(parsed,exact)===0;
  const bounded=/^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(range);if(!bounded)return false;
  return compare(parsed,parse(bounded[1]!)!)>=0&&compare(parsed,parse(bounded[2]!)!)<0;
}
function semver(value:string){return parse(value)!==null}
function parse(value:string):[number,number,number]|null{const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);return match?[Number(match[1]),Number(match[2]),Number(match[3])]:null}
function compare(a:[number,number,number],b:[number,number,number]){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2]}
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;return JSON.stringify(value)}
function matchIds(declared:readonly({readonly id:string}|string)[]|undefined,runtime:readonly{readonly id:string}[]|undefined,kind:string,issues:string[]){const left=(declared??[]).map(x=>typeof x==="string"?x:x.id),right=(runtime??[]).map(x=>x.id);if(JSON.stringify(left)!==JSON.stringify(right))issues.push(`runtime ${kind} IDs must exactly match manifest order`)}
