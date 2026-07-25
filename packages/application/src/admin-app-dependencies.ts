import {
  BUILTIN_ACTION_IDS,
  BUILTIN_RENDERER_IDS,
  BUILTIN_WIDGET_IDS,
  extractAdminAppDependencies,
  extractAdminAppDependenciesV2,
  type AdminAppFieldReference,
  type AdminAppFilterExpression,
  type AdminAppManifest,
  type AdminAppManifestV1,
  type AdminPageDefinition,
  type FormLayoutNode,
  type PermissionReference,
} from "@xecms/admin-apps";
import type { FieldDefinition, SchemaIrV1 } from "@xecms/schema";

import {
  StructuralAdminAppDependencyResolver,
  type AdminAppDependencyKind,
  type AdminAppDependencyRecord,
  type AdminAppDependencyResolution,
  type AdminAppDependencyResolver,
  type AdminAppPreviewBlocker,
} from "./admin-apps.js";

export interface AdminAppSchemaDependencySnapshot {
  readonly revisionId: string;
  readonly hash: string;
  readonly schema: SchemaIrV1;
}

export interface AdminAppRealmDependencySnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly kind: "system" | "content";
  readonly status: "provisioning" | "active" | "disabled";
  readonly revision: number;
}

export interface AdminAppAuthorizationDependencySnapshot {
  readonly realmId: string;
  readonly revision: number;
  readonly permissionKeys: ReadonlySet<string>;
  readonly resourceIds: ReadonlySet<string>;
}

export interface AdminAppPluginDependencySnapshot {
  readonly id: string;
  readonly version: string;
  readonly manifestDigest: string;
  readonly installedManifestDigest?: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly runtimeLoaded: boolean;
  readonly extensionIds: ReadonlySet<string>;
}

/** Read-only live state used by Preview. Implementations must scope every lookup to the Workspace. */
export interface AdminAppDependencyCatalog {
  getActiveSchema(workspaceId: string): Promise<AdminAppSchemaDependencySnapshot | null>;
  getRealm(workspaceId: string, realmId: string): Promise<AdminAppRealmDependencySnapshot | null>;
  getAuthorization(
    workspaceId: string,
    realmId: string,
  ): Promise<AdminAppAuthorizationDependencySnapshot | null>;
  getPlugin(workspaceId: string, pluginId: string): Promise<AdminAppPluginDependencySnapshot | null>;
}

/**
 * Resolves structural Manifest references against the state that will execute an active Revision.
 * The resulting fingerprints are immutable Revision dependencies; blockers are fail-closed.
 */
export class CatalogAdminAppDependencyResolver implements AdminAppDependencyResolver {
  private readonly structural = new StructuralAdminAppDependencyResolver();

  public constructor(private readonly catalog: AdminAppDependencyCatalog) {}

  public async resolve(input: {
    readonly workspaceId: string;
    readonly manifest: AdminAppManifest;
  }): Promise<AdminAppDependencyResolution> {
    const structural = await this.structural.resolve(input);
    const records = new Map(structural.dependencies.map((dependency) => [key(dependency), dependency]));
    const blockers: AdminAppPreviewBlocker[] = [...structural.blockers];
    const extracted = normalizedExtract(input.manifest);
    const targetRealmId = input.manifest.audience.type === "system"
      ? "rlm_system"
      : input.manifest.audience.realmId;

    const [schema, realm, authorization] = await Promise.all([
      this.catalog.getActiveSchema(input.workspaceId),
      this.catalog.getRealm(input.workspaceId, targetRealmId),
      this.catalog.getAuthorization(input.workspaceId, targetRealmId),
    ]);

    this.resolveSchema(input.manifest, schema, realm, records, blockers);
    this.resolveRealm(input.manifest, targetRealmId, realm, records, blockers);
    this.resolveAuthorization(targetRealmId, extracted.permissionReferences, extracted.resourceIds,
      authorization, records, blockers);
    await this.resolveExtensions(input.workspaceId, extracted.pluginIds, extracted.extensionIds,
      records, blockers);
    fingerprintBuiltins(records);

    return {
      dependencies: [...records.values()].sort(compareDependency),
      blockers: deduplicateBlockers(blockers),
    };
  }

  private resolveSchema(
    manifest: AdminAppManifest,
    schema: AdminAppSchemaDependencySnapshot | null,
    realm: AdminAppRealmDependencySnapshot | null,
    records: Map<string, AdminAppDependencyRecord>,
    blockers: AdminAppPreviewBlocker[],
  ): void {
    const extracted = normalizedExtract(manifest);
    const hasReferences = extracted.collectionIds.length > 0 || extracted.fieldIds.length > 0 ||
      extracted.relationIds.length > 0;
    if (schema === null) {
      if (hasReferences) blockers.push(blocker("SCHEMA_NOT_APPLIED", "An active Schema is required by this Admin App."));
      return;
    }

    put(records, {
      kind: "schema-revision", id: schema.revisionId, fingerprint: schema.hash,
      metadata: { hash: schema.hash },
    });
    const index = indexSchema(schema.schema);
    for (const id of extracted.collectionIds) {
      const collection = index.collections.get(id);
      if (collection === undefined) {
        blockers.push(missing("COLLECTION_MISSING", "Collection", id));
      } else {
        replace(records, "collection", id, schema.hash, {
          name: collection.name,
          schemaRevisionId: schema.revisionId,
          ...(collection.authRealmKey === undefined ? {} : { authRealmKey: collection.authRealmKey }),
        });
        if (collection.authRealmKey !== undefined && (
          manifest.audience.type === "system" || collection.authRealmKey !== realm?.key
        )) {
          blockers.push(blocker(
            "AUTH_COLLECTION_REALM_MISMATCH",
            `Auth Collection '${id}' belongs to Realm '${collection.authRealmKey}' and cannot be included in this App Realm.`,
            {
              collectionId: id,
              collectionRealmKey: collection.authRealmKey,
              appRealmId: realm?.id ?? (manifest.audience.type === "system" ? "rlm_system" : manifest.audience.realmId),
              appRealmKey: realm?.key,
            },
          ));
        }
      }
    }
    for (const id of extracted.fieldIds) {
      const field = index.fields.get(id);
      if (field === undefined) {
        blockers.push(missing("FIELD_MISSING", "Field", id));
      } else {
        replace(records, "field", id, schema.hash, {
          ownerId: field.ownerId, ownerKind: field.ownerKind, schemaRevisionId: schema.revisionId,
        });
        snapshotReferencedComponents(field.definition, index, schema, records, blockers);
      }
    }
    for (const id of extracted.relationIds) {
      const relation = index.relations.get(id);
      if (relation === undefined) {
        blockers.push(missing("RELATION_MISSING", "Relation", id));
      } else {
        replace(records, "relation", id, schema.hash, {
          ownerId: relation.ownerId, ownerKind: relation.ownerKind,
          targetCollectionId: relation.targetCollectionId, schemaRevisionId: schema.revisionId,
        });
      }
    }

    // Field↔Collection ownership is validated per page shape. Composed Page
    // (V2) Data Source ownership validation lands with CPB-4 semantics.
    const usages = manifest.formatVersion === 2 ? [] : collectSchemaUsages(manifest);
    for (const usage of usages) {
      if (usage.kind === "field") {
        const field = index.fields.get(usage.id);
        if (field !== undefined && (field.ownerKind !== "collection" || field.ownerId !== usage.collectionId)) {
          blockers.push(blocker("FIELD_COLLECTION_MISMATCH",
            `Field '${usage.id}' does not belong to Collection '${usage.collectionId}'.`, {
              pageId: usage.pageId, fieldId: usage.id, collectionId: usage.collectionId,
              actualOwnerId: field.ownerId, actualOwnerKind: field.ownerKind,
            }));
        }
      } else {
        const relation = index.relations.get(usage.id);
        if (relation !== undefined && (relation.ownerKind !== "collection" || relation.ownerId !== usage.collectionId)) {
          blockers.push(blocker("RELATION_COLLECTION_MISMATCH",
            `Relation '${usage.id}' does not belong to Collection '${usage.collectionId}'.`, {
              pageId: usage.pageId, relationId: usage.id, collectionId: usage.collectionId,
              actualOwnerId: relation.ownerId, actualOwnerKind: relation.ownerKind,
            }));
        }
      }
    }
  }

  private resolveRealm(
    manifest: AdminAppManifest,
    realmId: string,
    realm: AdminAppRealmDependencySnapshot | null,
    records: Map<string, AdminAppDependencyRecord>,
    blockers: AdminAppPreviewBlocker[],
  ): void {
    if (realm === null) {
      blockers.push(missing("REALM_MISSING", "Realm", realmId));
      return;
    }
    put(records, {
      kind: "realm", id: realm.id, fingerprint: String(realm.revision),
      metadata: { key: realm.key, kind: realm.kind, status: realm.status, revision: realm.revision },
    });
    const expectedKind = manifest.audience.type === "system" ? "system" : "content";
    if (realm.kind !== expectedKind) {
      blockers.push(blocker("REALM_KIND_MISMATCH",
        `Realm '${realm.id}' is '${realm.kind}', but the App audience requires '${expectedKind}'.`,
        { realmId: realm.id, expectedKind, actualKind: realm.kind }));
    }
    if (realm.status !== "active") {
      blockers.push(blocker("REALM_INACTIVE", `Realm '${realm.id}' is not active.`, {
        realmId: realm.id, status: realm.status,
      }));
    }
  }

  private resolveAuthorization(
    realmId: string,
    permissions: readonly { readonly action: string; readonly resourceId: string }[],
    resourceIds: readonly string[],
    authorization: AdminAppAuthorizationDependencySnapshot | null,
    records: Map<string, AdminAppDependencyRecord>,
    blockers: AdminAppPreviewBlocker[],
  ): void {
    if (authorization === null) {
      blockers.push(blocker("AUTHORIZATION_POLICY_MISSING",
        `Authorization policy for Realm '${realmId}' is not initialized.`, { realmId }));
      return;
    }
    put(records, {
      kind: "authorization-policy", id: realmId, fingerprint: String(authorization.revision),
      metadata: { realmId, revision: authorization.revision },
    });
    for (const reference of permissions) {
      const id = `${reference.action}@${encodeURIComponent(reference.resourceId)}`;
      replace(records, "permission", id, String(authorization.revision), {
        action: reference.action, resourceId: reference.resourceId, realmId,
        policyRevision: authorization.revision,
      });
      if (!authorization.permissionKeys.has(reference.action)) {
        blockers.push(missing("PERMISSION_MISSING", "Permission", reference.action, { realmId }));
      }
    }
    for (const resourceId of resourceIds) {
      replace(records, "resource", resourceId, String(authorization.revision), {
        realmId, policyRevision: authorization.revision,
      });
      if (!authorization.resourceIds.has(resourceId)) {
        blockers.push(missing("RESOURCE_MISSING", "Authorization Resource", resourceId, { realmId }));
      }
    }
  }

  private async resolveExtensions(
    workspaceId: string,
    pluginIds: readonly string[],
    extensionIds: readonly string[],
    records: Map<string, AdminAppDependencyRecord>,
    blockers: AdminAppPreviewBlocker[],
  ): Promise<void> {
    const plugins = new Map<string, AdminAppPluginDependencySnapshot | null>();
    await Promise.all(pluginIds.map(async (pluginId) => {
      plugins.set(pluginId, await this.catalog.getPlugin(workspaceId, pluginId));
    }));
    for (const pluginId of pluginIds) {
      const plugin = plugins.get(pluginId) ?? null;
      if (plugin === null) {
        blockers.push(missing("PLUGIN_MISSING", "Trusted Plugin", pluginId));
        continue;
      }
      replace(records, "plugin", pluginId, plugin.manifestDigest, {
        version: plugin.version, installed: plugin.installed, enabled: plugin.enabled,
        runtimeLoaded: plugin.runtimeLoaded,
      });
      if (!plugin.installed) blockers.push(blocker("PLUGIN_NOT_INSTALLED", `Plugin '${pluginId}' is not installed.`, { pluginId }));
      if (plugin.installedManifestDigest !== undefined && plugin.installedManifestDigest !== plugin.manifestDigest) {
        blockers.push(blocker("PLUGIN_MANIFEST_DRIFT", `Plugin '${pluginId}' manifest digest has drifted.`, {
          pluginId, expectedDigest: plugin.installedManifestDigest, actualDigest: plugin.manifestDigest,
        }));
      }
      if (!plugin.enabled) blockers.push(blocker("PLUGIN_NOT_ENABLED", `Plugin '${pluginId}' is not enabled.`, { pluginId }));
      if (!plugin.runtimeLoaded) blockers.push(blocker("PLUGIN_RUNTIME_UNAVAILABLE", `Plugin '${pluginId}' is not loaded by this runtime.`, { pluginId }));
    }
    for (const extensionId of extensionIds) {
      const pluginId = extensionId.slice(0, extensionId.indexOf("."));
      const plugin = plugins.get(pluginId) ?? null;
      if (plugin === null) continue;
      const structural = [...records.values()].find((record) => record.kind !== "plugin" && record.id === extensionId);
      replace(records, "extension", extensionId, plugin.manifestDigest, { pluginId, version: plugin.version });
      if (structural !== undefined) replace(records, structural.kind, extensionId, plugin.manifestDigest, {
        pluginId, version: plugin.version,
      });
      if (!plugin.extensionIds.has(extensionId)) {
        blockers.push(missing("EXTENSION_MISSING", "Plugin extension", extensionId, { pluginId }));
      }
    }
  }
}

interface IndexedSchemaField {
  readonly ownerId: string;
  readonly ownerKind: "collection" | "component";
  readonly definition: FieldDefinition;
}
interface IndexedSchemaRelation extends IndexedSchemaField { readonly targetCollectionId: string }
interface IndexedSchema {
  readonly collections: Map<string, { readonly name: string; readonly authRealmKey?: string }>;
  readonly components: Map<string, { readonly name: string; readonly fields: readonly FieldDefinition[] }>;
  readonly fields: Map<string, IndexedSchemaField>;
  readonly relations: Map<string, IndexedSchemaRelation>;
}

function indexSchema(schema: SchemaIrV1): IndexedSchema {
  const collections = new Map<string, { readonly name: string; readonly authRealmKey?: string }>();
  const components = new Map<string, { readonly name: string; readonly fields: readonly FieldDefinition[] }>();
  const fields = new Map<string, IndexedSchemaField>();
  const relations = new Map<string, IndexedSchemaRelation>();
  const visit = (items: readonly FieldDefinition[], ownerId: string, ownerKind: "collection" | "component"): void => {
    for (const field of items) {
      fields.set(field.id, { ownerId, ownerKind, definition: field });
      if (field.type === "relation") relations.set(field.relationId, {
        ownerId, ownerKind, definition: field, targetCollectionId: field.targetCollectionId,
      });
      if (field.type === "object" || field.type === "array") visit(field.fields, ownerId, ownerKind);
    }
  };
  for (const collection of schema.collections) {
    collections.set(collection.id, {
      name: collection.name,
      ...(collection.auth === undefined ? {} : { authRealmKey: collection.auth.realmKey }),
    });
    visit(collection.fields, collection.id, "collection");
  }
  for (const component of schema.components ?? []) {
    components.set(component.id, { name: component.name, fields: component.fields });
    visit(component.fields, component.id, "component");
  }
  return { collections, components, fields, relations };
}

function snapshotReferencedComponents(
  root: FieldDefinition,
  index: IndexedSchema,
  schema: AdminAppSchemaDependencySnapshot,
  records: Map<string, AdminAppDependencyRecord>,
  blockers: AdminAppPreviewBlocker[],
): void {
  const visited = new Set<string>();
  const visitFields = (fields: readonly FieldDefinition[]): void => fields.forEach(visitField);
  const visitComponent = (componentId: string): void => {
    if (visited.has(componentId)) return;
    visited.add(componentId);
    const component = index.components.get(componentId);
    if (component === undefined) {
      blockers.push(missing("COMPONENT_MISSING", "Component", componentId));
      return;
    }
    replace(records, "component", componentId, schema.hash, {
      name: component.name, schemaRevisionId: schema.revisionId,
    });
    for (const field of component.fields) {
      replace(records, "field", field.id, schema.hash, {
        ownerId: componentId, ownerKind: "component", schemaRevisionId: schema.revisionId,
      });
    }
    visitFields(component.fields);
  };
  const visitField = (field: FieldDefinition): void => {
    if (field.type === "component") visitComponent(field.componentId);
    else if (field.type === "blocks") field.allowedComponentIds.forEach(visitComponent);
    else if (field.type === "object" || field.type === "array") visitFields(field.fields);
  };
  visitField(root);
}

interface SchemaUsage {
  readonly kind: "field" | "relation";
  readonly id: string;
  readonly collectionId: string;
  readonly pageId: string;
}

interface NormalizedDependencies {
  readonly audienceRealmIds: readonly string[];
  readonly collectionIds: readonly string[];
  readonly fieldIds: readonly string[];
  readonly relationIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly widgetIds: readonly string[];
  readonly rendererIds: readonly string[];
  readonly extensionIds: readonly string[];
  readonly pluginIds: readonly string[];
  readonly permissionReferences: readonly PermissionReference[];
  readonly resourceIds: readonly string[];
}

/** Version-agnostic dependency view. V2-absent kinds default to empty. */
function normalizedExtract(manifest: AdminAppManifest): NormalizedDependencies {
  if (manifest.formatVersion === 2) {
    const extracted = extractAdminAppDependenciesV2(manifest);
    return {
      audienceRealmIds: extracted.audienceRealmIds,
      collectionIds: extracted.collectionIds,
      fieldIds: extracted.fieldIds,
      relationIds: [],
      actionIds: extracted.actionIds,
      widgetIds: [],
      rendererIds: [],
      extensionIds: extracted.extensionIds,
      pluginIds: extracted.pluginIds,
      permissionReferences: extracted.permissionReferences,
      resourceIds: extracted.resourceIds,
    };
  }
  return extractAdminAppDependencies(manifest);
}

function collectSchemaUsages(manifest: AdminAppManifestV1): readonly SchemaUsage[] {
  const usages: SchemaUsage[] = [];
  const field = (reference: AdminAppFieldReference, collectionId: string, pageId: string): void => {
    if (reference.kind === "data") usages.push({ kind: "field", id: reference.fieldId, collectionId, pageId });
  };
  const filter = (value: AdminAppFilterExpression, collectionId: string, pageId: string): void => {
    if (value.type === "condition") field(value.field, collectionId, pageId);
    else value.filters.forEach((child) => filter(child, collectionId, pageId));
  };
  const form = (nodes: readonly FormLayoutNode[], collectionId: string, pageId: string): void => {
    for (const node of nodes) {
      if (node.type === "field") {
        usages.push({ kind: "field", id: node.fieldId, collectionId, pageId });
        if (node.when !== undefined) filter(node.when, collectionId, pageId);
      } else if (node.type === "tabs") {
        node.tabs.forEach((tab) => form(tab.children, collectionId, pageId));
      } else form(node.children, collectionId, pageId);
    }
  };
  for (const page of manifest.pages) collectPageUsages(page, usages, field, filter, form);
  return usages;
}

function collectPageUsages(
  page: AdminPageDefinition,
  usages: SchemaUsage[],
  field: (reference: AdminAppFieldReference, collectionId: string, pageId: string) => void,
  filter: (value: AdminAppFilterExpression, collectionId: string, pageId: string) => void,
  form: (nodes: readonly FormLayoutNode[], collectionId: string, pageId: string) => void,
): void {
  if (page.type === "collection-list") {
    page.columns.forEach((column) => field(column.field, page.collectionId, page.id));
    if (page.fixedFilter !== undefined) filter(page.fixedFilter, page.collectionId, page.id);
    page.availableFilters?.forEach((item) => field(item.field, page.collectionId, page.id));
    page.defaultSort?.forEach((item) => field(item.field, page.collectionId, page.id));
  } else if (page.type === "document-form" || page.type === "singleton") {
    form(page.layout.nodes, page.collectionId, page.id);
  } else if (page.type === "document-detail") {
    page.layout.panels.forEach((panel) => {
      if ("fieldIds" in panel) panel.fieldIds.forEach((id) => usages.push({ kind: "field", id, collectionId: page.collectionId, pageId: page.id }));
      if (panel.type === "relation") usages.push({ kind: "relation", id: panel.relationId, collectionId: page.collectionId, pageId: page.id });
    });
  } else if (page.type === "dashboard") {
    page.widgets.forEach((widget) => {
      if (widget.query === undefined) return;
      widget.query.fields?.forEach((id) => usages.push({ kind: "field", id, collectionId: widget.query!.collectionId, pageId: page.id }));
      if (widget.query.filter !== undefined) filter(widget.query.filter, widget.query.collectionId, page.id);
      widget.query.sort?.forEach((item) => field(item.field, widget.query!.collectionId, page.id));
    });
  }
}

function fingerprintBuiltins(records: Map<string, AdminAppDependencyRecord>): void {
  for (const [kind, ids] of [
    ["action", BUILTIN_ACTION_IDS], ["widget", BUILTIN_WIDGET_IDS], ["renderer", BUILTIN_RENDERER_IDS],
  ] as const) {
    for (const id of ids) {
      if (records.has(`${kind}:${id}`)) replace(records, kind, id, "core-admin-registry-v1", { registry: "core", version: 1 });
    }
  }
}

function replace(
  records: Map<string, AdminAppDependencyRecord>, kind: AdminAppDependencyKind, id: string,
  fingerprint: string, metadata: Readonly<Record<string, unknown>>,
): void {
  put(records, { kind, id, fingerprint, metadata });
}
function put(records: Map<string, AdminAppDependencyRecord>, dependency: AdminAppDependencyRecord): void {
  records.set(key(dependency), dependency);
}
function key(dependency: Pick<AdminAppDependencyRecord, "kind" | "id">): string {
  return `${dependency.kind}:${dependency.id}`;
}
function blocker(code: string, message: string, details?: Readonly<Record<string, unknown>>): AdminAppPreviewBlocker {
  return { code, message, ...(details === undefined ? {} : { details }) };
}
function missing(code: string, label: string, id: string, details: Readonly<Record<string, unknown>> = {}): AdminAppPreviewBlocker {
  return blocker(code, `${label} '${id}' does not exist.`, { ...details, id });
}
function compareDependency(left: AdminAppDependencyRecord, right: AdminAppDependencyRecord): number {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}
function deduplicateBlockers(values: readonly AdminAppPreviewBlocker[]): readonly AdminAppPreviewBlocker[] {
  const unique = new Map<string, AdminAppPreviewBlocker>();
  for (const value of values) unique.set(`${value.code}:${JSON.stringify(value.details ?? {})}`, value);
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
}
