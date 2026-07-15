import { ApplicationError } from "./errors.js";
import { pluginManifestDigest, validatePluginGraph, type XeCmsPluginManifestV1,
  type XeCmsPluginModule } from "@xecms/plugin-sdk";

export type PluginDesiredState="installed"|"enabled"|"disabled";
export type PluginPlanAction="install"|"enable"|"disable"|"uninstall";
export type PluginDataAction="preserve"|"export"|"purge";
export interface PluginRecord{readonly workspaceId:string;readonly pluginId:string;readonly packageName:string;readonly version:string;readonly manifest:XeCmsPluginManifestV1;readonly manifestDigest:string;readonly desiredState:PluginDesiredState;readonly config:Readonly<Record<string,unknown>>;readonly revision:number;readonly restartRequired:boolean;readonly installedAt:string;readonly installedBy:string;readonly updatedAt:string;readonly updatedBy:string}
export interface PluginCatalogRecord{readonly pluginId:string;readonly packageName:string;readonly version:string;readonly displayName:string;readonly description?:string;readonly manifest:XeCmsPluginManifestV1;readonly manifestDigest:string;readonly installed:PluginRecord|null;readonly runtimeLoaded:boolean;readonly restartRequired:boolean}
export interface PluginBlocker{readonly code:"DEPENDENT_PLUGIN"|"DEPENDENCY_MISSING"|"SCHEMA_USAGE"|"DATA_ACTION_REQUIRED"|"DOWN_MIGRATION_REQUIRED"|"PERMISSION_IN_USE"|"PLUGIN_STATE";readonly message:string;readonly details?:Readonly<Record<string,unknown>>}
export interface PluginPlan{readonly id:string;readonly workspaceId:string;readonly pluginId:string;readonly action:PluginPlanAction;readonly dataAction?:PluginDataAction;readonly expectedPluginRevision:number|null;readonly manifestDigest:string;readonly status:"previewed"|"applied";readonly blockers:readonly PluginBlocker[];readonly dependencyIds:readonly string[];readonly schemaReferences:readonly string[];readonly dataCounts:Readonly<Record<string,number>>;readonly migrationIds:readonly string[];readonly digest:string;readonly createdAt:string;readonly createdBy:string;readonly expiresAt:string;readonly appliedAt?:string;readonly appliedBy?:string;readonly result?:PluginRecord|null;readonly exportId?:string}

export interface PluginStore{
  list(workspaceId:string):Promise<readonly PluginRecord[]>;
  get(workspaceId:string,pluginId:string):Promise<PluginRecord|null>;
  updateConfig(input:{readonly workspaceId:string;readonly pluginId:string;readonly expectedRevision:number;readonly config:Readonly<Record<string,unknown>>;readonly actorIdentityId:string;readonly actorSubjectId:string;readonly now:string}):Promise<PluginRecord>;
  createPlan(input:{readonly id:string;readonly workspaceId:string;readonly module:XeCmsPluginModule;readonly action:PluginPlanAction;readonly dataAction?:PluginDataAction;readonly expectedPluginRevision:number|null;readonly createdAt:string;readonly createdBy:string;readonly expiresAt:string}):Promise<PluginPlan>;
  getPlan(workspaceId:string,planId:string):Promise<PluginPlan|null>;
  applyPlan(input:{readonly workspaceId:string;readonly planId:string;readonly expectedPluginRevision:number|null;readonly actorIdentityId:string;readonly actorSubjectId:string;readonly now:string;readonly module:XeCmsPluginModule}):Promise<PluginPlan>;
  getExport(workspaceId:string,exportId:string):Promise<{readonly id:string;readonly pluginId:string;readonly createdAt:string;readonly data:unknown}|null>;
  assertMigrationState(workspaceId:string,module:XeCmsPluginModule):Promise<void>;
  markRuntimeReconciled(workspaceId:string,loadedPluginIds:readonly string[]):Promise<void>;
}
export interface PluginRuntime{readonly now:()=>string;readonly newPlanId:()=>string;readonly loadedPluginIds:ReadonlySet<string>}

export class PluginCatalog{
  private readonly modules=new Map<string,XeCmsPluginModule>();
  public constructor(modules:readonly XeCmsPluginModule[]){validatePluginGraph(modules);for(const module of modules)this.modules.set(module.manifest.id,module)}
  public list(){return[...this.modules.values()].sort((a,b)=>a.manifest.id.localeCompare(b.manifest.id))}
  public get(pluginId:string){const module=this.modules.get(pluginId);if(!module)throw new ApplicationError("PLUGIN_NOT_IN_CATALOG",404,"Plugin is not present in the trusted runtime catalog.");return module}
  public has(pluginId:string){return this.modules.has(pluginId)}
}

export class PluginService{
  public constructor(private readonly store:PluginStore,private readonly catalog:PluginCatalog,private readonly runtime:PluginRuntime){}
  public async listCatalog(workspaceId:string):Promise<readonly PluginCatalogRecord[]>{const installed=new Map((await this.store.list(workspaceId)).map(record=>[record.pluginId,record]));return this.catalog.list().map(module=>{const record=installed.get(module.manifest.id)??null;const loaded=this.runtime.loadedPluginIds.has(module.manifest.id);return{pluginId:module.manifest.id,packageName:module.manifest.packageName,version:module.manifest.version,displayName:module.manifest.displayName,...(module.manifest.description===undefined?{}:{description:module.manifest.description}),manifest:module.manifest,manifestDigest:pluginManifestDigest(module.manifest),installed:record,runtimeLoaded:loaded,restartRequired:record===null?loaded:(record.desiredState==="enabled")!==loaded||record.restartRequired}})}
  public list(workspaceId:string){return this.store.list(workspaceId)}
  public async get(workspaceId:string,pluginId:string){const value=await this.store.get(workspaceId,pluginId);if(!value)throw new ApplicationError("PLUGIN_NOT_INSTALLED",404,"Plugin is not installed.");return value}
  public async assertStartupState(workspaceId:string):Promise<readonly PluginRecord[]>{const records=await this.store.list(workspaceId);for(const record of records){if(record.desiredState!=="enabled")continue;if(!this.catalog.has(record.pluginId))throw new ApplicationError("PLUGIN_ENABLED_PACKAGE_MISSING",503,`Enabled Plugin '${record.pluginId}' is missing from the runtime catalog.`);const module=this.catalog.get(record.pluginId);if(pluginManifestDigest(module.manifest)!==record.manifestDigest)throw new ApplicationError("PLUGIN_MANIFEST_DRIFT",503,`Enabled Plugin '${record.pluginId}' manifest changed without an install plan.`);await this.store.assertMigrationState(workspaceId,module)}return records.filter(x=>x.desiredState==="enabled")}
  public reconcileRuntime(workspaceId:string){return this.store.markRuntimeReconciled(workspaceId,[...this.runtime.loadedPluginIds])}
  public updateConfig(input:{readonly workspaceId:string;readonly pluginId:string;readonly expectedRevision:number;readonly config:unknown;readonly actorIdentityId:string;readonly actorSubjectId:string}){if(typeof input.config!=="object"||input.config===null||Array.isArray(input.config))throw new ApplicationError("PLUGIN_CONFIG_INVALID",422,"Plugin config must be a JSON object.");this.catalog.get(input.pluginId);return this.store.updateConfig({...input,config:input.config as Readonly<Record<string,unknown>>,now:this.runtime.now()})}
  public preview(input:{readonly workspaceId:string;readonly pluginId:string;readonly action:PluginPlanAction;readonly dataAction?:PluginDataAction;readonly expectedPluginRevision:number|null;readonly actorIdentityId:string}){const module=this.catalog.get(input.pluginId);const now=this.runtime.now();return this.store.createPlan({id:this.runtime.newPlanId(),workspaceId:input.workspaceId,module,action:input.action,...(input.dataAction===undefined?{}:{dataAction:input.dataAction}),expectedPluginRevision:input.expectedPluginRevision,createdAt:now,createdBy:input.actorIdentityId,expiresAt:new Date(Date.parse(now)+15*60_000).toISOString()})}
  public async getPlan(workspaceId:string,planId:string){const plan=await this.store.getPlan(workspaceId,planId);if(!plan)throw new ApplicationError("PLUGIN_PLAN_NOT_FOUND",404,"Plugin lifecycle plan does not exist.");return plan}
  public apply(input:{readonly workspaceId:string;readonly planId:string;readonly pluginId:string;readonly expectedPluginRevision:number|null;readonly actorIdentityId:string;readonly actorSubjectId:string}){return this.store.applyPlan({...input,module:this.catalog.get(input.pluginId),now:this.runtime.now()})}
  public async getExport(workspaceId:string,exportId:string){const value=await this.store.getExport(workspaceId,exportId);if(!value)throw new ApplicationError("PLUGIN_EXPORT_NOT_FOUND",404,"Plugin export does not exist.");return value}
}
