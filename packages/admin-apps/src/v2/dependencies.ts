import { extractAdminAppDependencies } from "../dependencies.js";
import type { AdminAppManifestV1, AdminNavigationItem, AdminPageDefinition, PermissionReference } from "../types.js";
import type {
  AdminAppManifestV2,
  ComposedPageDefinition,
  ParameterizedFilterExpression,
} from "./types.js";

export interface AdminAppManifestDependenciesV2 {
  readonly audienceRealmIds: readonly string[];
  readonly collectionIds: readonly string[];
  readonly fieldIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly maskPolicyIds: readonly string[];
  /** Namespaced Plugin extension ids (Component kinds, renderers, …). */
  readonly extensionIds: readonly string[];
  /** Owning Plugin ids of the extensions above (for digest pinning). */
  readonly pluginIds: readonly string[];
  readonly permissionReferences: readonly PermissionReference[];
  readonly resourceIds: readonly string[];
}

interface Sets {
  readonly audienceRealmIds: Set<string>;
  readonly collectionIds: Set<string>;
  readonly fieldIds: Set<string>;
  readonly actionIds: Set<string>;
  readonly maskPolicyIds: Set<string>;
  readonly extensionIds: Set<string>;
  readonly pluginIds: Set<string>;
  readonly permissions: Map<string, PermissionReference>;
  readonly resourceIds: Set<string>;
}

/**
 * Extracts the stable references a V2 manifest depends on. Composed Pages are
 * walked directly; Generated Pages carried over by a V1→V2 upgrade reuse the V1
 * extractor via a throwaway V1 envelope so their Collection/Field/Action/
 * permission references are recorded too.
 */
export function extractAdminAppDependenciesV2(
  manifest: AdminAppManifestV2,
): AdminAppManifestDependenciesV2 {
  const sets: Sets = {
    audienceRealmIds: new Set(),
    collectionIds: new Set(),
    fieldIds: new Set(),
    actionIds: new Set(),
    maskPolicyIds: new Set(),
    extensionIds: new Set(),
    pluginIds: new Set(),
    permissions: new Map(),
    resourceIds: new Set(),
  };
  if (manifest.audience.type === "content-realm") sets.audienceRealmIds.add(manifest.audience.realmId);
  manifest.navigation.forEach((item) => collectNavigation(item, sets));

  const generatedPages: AdminPageDefinition[] = [];
  for (const page of manifest.pages) {
    if (page.type === "composed-page") collectComposedPage(page, sets);
    else generatedPages.push(page);
  }
  if (generatedPages.length > 0) mergeGeneratedDependencies(manifest, generatedPages, sets);

  return {
    audienceRealmIds: sorted(sets.audienceRealmIds),
    collectionIds: sorted(sets.collectionIds),
    fieldIds: sorted(sets.fieldIds),
    actionIds: sorted(sets.actionIds),
    maskPolicyIds: sorted(sets.maskPolicyIds),
    extensionIds: sorted(sets.extensionIds),
    pluginIds: sorted(sets.pluginIds),
    permissionReferences: [...sets.permissions.values()].sort(comparePermission),
    resourceIds: sorted(sets.resourceIds),
  };
}

/** Merges Generated-Page dependencies via the V1 extractor (upgraded manifests). */
function mergeGeneratedDependencies(
  manifest: AdminAppManifestV2,
  generatedPages: readonly AdminPageDefinition[],
  sets: Sets,
): void {
  const envelope: AdminAppManifestV1 = {
    format: "xecms.admin-app",
    formatVersion: 1,
    id: manifest.id,
    name: manifest.name,
    key: manifest.key,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.icon === undefined ? {} : { icon: manifest.icon }),
    audience: manifest.audience,
    // Only navigation entries that target a Generated Page keep the V1 envelope valid.
    navigation: manifest.navigation.filter((item) =>
      item.pageId === undefined || generatedPages.some((page) => page.id === item.pageId)),
    pages: generatedPages,
    startPageId: generatedPages.some((page) => page.id === manifest.startPageId)
      ? manifest.startPageId
      : generatedPages[0]!.id,
  };
  const extracted = extractAdminAppDependencies(envelope);
  extracted.collectionIds.forEach((id) => sets.collectionIds.add(id));
  extracted.fieldIds.forEach((id) => sets.fieldIds.add(id));
  extracted.actionIds.forEach((id) => sets.actionIds.add(id));
  extracted.permissionReferences.forEach((reference) =>
    sets.permissions.set(`${reference.action}\0${reference.resourceId}`, reference));
  extracted.resourceIds.forEach((id) => sets.resourceIds.add(id));
}

function collectNavigation(item: AdminNavigationItem, sets: Sets): void {
  if (item.visibility !== undefined) {
    for (const permission of [
      ...(item.visibility.allPermissions ?? []),
      ...(item.visibility.anyPermissions ?? []),
    ]) {
      sets.permissions.set(`${permission.action}\0${permission.resourceId}`, permission);
      sets.resourceIds.add(permission.resourceId);
    }
  }
  item.children?.forEach((child) => collectNavigation(child, sets));
}

function collectComposedPage(page: ComposedPageDefinition, sets: Sets): void {
  for (const source of page.dataSources) {
    sets.collectionIds.add(source.collectionId);
    source.fields.forEach((fieldId) => sets.fieldIds.add(fieldId));
    if (source.filter !== undefined) collectFilterFields(source.filter, sets);
    source.sort?.forEach((sort) => {
      if (sort.field.kind === "data") sets.fieldIds.add(sort.field.fieldId);
    });
  }
  for (const component of page.components) {
    // A namespaced Component kind (e.g. `acme.output.chart`) is a Plugin extension.
    collectExtension(component.kind, sets);
    walk(component.props, sets);
    // Component-level events carry Action effects too (buttons, etc.).
    collectEventActions(component.events, sets);
  }
  collectEventActions(page.events, sets);
}

/** Records Action ids referenced by an event binding list, plugin ones pinned. */
function collectEventActions(
  events: ComposedPageDefinition["events"],
  sets: Sets,
): void {
  for (const event of events ?? []) {
    for (const effect of event.effects) {
      if (effect.kind === "action.execute" && typeof effect.args?.["actionId"] === "string") {
        const actionId = effect.args["actionId"];
        sets.actionIds.add(actionId);
        collectExtension(actionId, sets);
      }
    }
  }
}

/** Registers a namespaced (`<plugin>.*`, non-core) id as a Plugin extension. */
function collectExtension(id: string, sets: Sets): void {
  if (id.startsWith("core.")) return;
  const separator = id.indexOf(".");
  if (separator < 1) return;
  sets.extensionIds.add(id);
  sets.pluginIds.add(id.slice(0, separator));
}

function collectFilterFields(filter: ParameterizedFilterExpression, sets: Sets): void {
  if (filter.type === "group") {
    filter.filters.forEach((child) => collectFilterFields(child, sets));
    return;
  }
  if (filter.field.kind === "data") sets.fieldIds.add(filter.field.fieldId);
}

/** Walks component props for stable collection/field/mask-policy references. */
function walk(value: unknown, sets: Sets): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, sets);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record["fieldId"] === "string") sets.fieldIds.add(record["fieldId"]);
  if (typeof record["collectionId"] === "string") sets.collectionIds.add(record["collectionId"]);
  const protection = record["protection"];
  if (protection !== null && typeof protection === "object") {
    const maskPolicyId = (protection as Record<string, unknown>)["maskPolicyId"];
    if (typeof maskPolicyId === "string") sets.maskPolicyIds.add(maskPolicyId);
  }
  for (const child of Object.values(record)) walk(child, sets);
}

function sorted(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePermission(left: PermissionReference, right: PermissionReference): number {
  return compareText(left.action, right.action) || compareText(left.resourceId, right.resourceId);
}
