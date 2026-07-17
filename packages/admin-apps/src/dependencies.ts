import { normalizeAdminAppManifest } from "./normalize.js";
import type {
  AdminAppActionReference,
  AdminAppDocumentQuery,
  AdminAppFieldReference,
  AdminAppFilterExpression,
  AdminAppManifestV1,
  AdminNavigationItem,
  AdminPageDefinition,
  FormLayoutNode,
  PermissionReference,
  VisibilityCondition,
} from "./types.js";

export interface AdminAppManifestDependencies {
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

interface DependencySets {
  readonly audienceRealmIds: Set<string>;
  readonly collectionIds: Set<string>;
  readonly fieldIds: Set<string>;
  readonly relationIds: Set<string>;
  readonly actionIds: Set<string>;
  readonly widgetIds: Set<string>;
  readonly rendererIds: Set<string>;
  readonly extensionIds: Set<string>;
  readonly pluginIds: Set<string>;
  readonly permissions: Map<string, PermissionReference>;
  readonly resourceIds: Set<string>;
}

export function extractAdminAppDependencies(
  input: AdminAppManifestV1,
): AdminAppManifestDependencies {
  const manifest = normalizeAdminAppManifest(input);
  const sets: DependencySets = {
    audienceRealmIds: new Set(),
    collectionIds: new Set(),
    fieldIds: new Set(),
    relationIds: new Set(),
    actionIds: new Set(),
    widgetIds: new Set(),
    rendererIds: new Set(),
    extensionIds: new Set(),
    pluginIds: new Set(),
    permissions: new Map(),
    resourceIds: new Set(),
  };

  if (manifest.audience.type === "content-realm") {
    sets.audienceRealmIds.add(manifest.audience.realmId);
  }
  manifest.navigation.forEach((item) => collectNavigation(sets, item));
  manifest.pages.forEach((page) => collectPage(sets, page));

  return {
    audienceRealmIds: sorted(sets.audienceRealmIds),
    collectionIds: sorted(sets.collectionIds),
    fieldIds: sorted(sets.fieldIds),
    relationIds: sorted(sets.relationIds),
    actionIds: sorted(sets.actionIds),
    widgetIds: sorted(sets.widgetIds),
    rendererIds: sorted(sets.rendererIds),
    extensionIds: sorted(sets.extensionIds),
    pluginIds: sorted(sets.pluginIds),
    permissionReferences: [...sets.permissions.values()].sort(comparePermission),
    resourceIds: sorted(sets.resourceIds),
  };
}

function collectNavigation(sets: DependencySets, item: AdminNavigationItem): void {
  if (item.visibility !== undefined) collectVisibility(sets, item.visibility);
  item.children?.forEach((child) => collectNavigation(sets, child));
}

function collectPage(sets: DependencySets, page: AdminPageDefinition): void {
  switch (page.type) {
    case "collection-list":
      sets.collectionIds.add(page.collectionId);
      page.columns.forEach((column) => {
        collectField(sets, column.field);
        if (column.rendererId !== undefined) {
          sets.rendererIds.add(column.rendererId);
          collectPluginExtension(sets, column.rendererId);
        }
      });
      if (page.fixedFilter !== undefined) collectFilter(sets, page.fixedFilter);
      page.availableFilters?.forEach((filter) => collectField(sets, filter.field));
      page.defaultSort?.forEach((sort) => collectField(sets, sort.field));
      page.rowActions?.forEach((action) => collectAction(sets, action));
      page.bulkActions?.forEach((action) => collectAction(sets, action));
      break;
    case "document-form":
    case "singleton":
      sets.collectionIds.add(page.collectionId);
      page.layout.nodes.forEach((node) => collectFormNode(sets, node));
      page.actions?.forEach((action) => collectAction(sets, action));
      break;
    case "document-detail":
      sets.collectionIds.add(page.collectionId);
      page.layout.panels.forEach((panel) => {
        if ("fieldIds" in panel) panel.fieldIds.forEach((fieldId) => sets.fieldIds.add(fieldId));
        if (panel.type === "relation") sets.relationIds.add(panel.relationId);
        if (panel.type === "plugin") collectPluginExtension(sets, panel.extensionId);
      });
      page.actions?.forEach((action) => collectAction(sets, action));
      break;
    case "dashboard":
      page.widgets.forEach((widget) => {
        sets.widgetIds.add(widget.widgetId);
        collectPluginExtension(sets, widget.widgetId);
        if (widget.query !== undefined) collectQuery(sets, widget.query);
        if (widget.action !== undefined) collectAction(sets, widget.action);
        if (widget.visibility !== undefined) collectVisibility(sets, widget.visibility);
      });
      break;
    case "plugin-page":
      collectPluginExtension(sets, page.extensionId);
      break;
  }
}

function collectFormNode(sets: DependencySets, node: FormLayoutNode): void {
  if (node.type === "field") {
    sets.fieldIds.add(node.fieldId);
    if (node.widgetId !== undefined) {
      sets.widgetIds.add(node.widgetId);
      collectPluginExtension(sets, node.widgetId);
    }
    if (node.when !== undefined) collectFilter(sets, node.when);
    return;
  }
  if (node.type === "tabs") {
    node.tabs.forEach((tab) => tab.children.forEach((child) => collectFormNode(sets, child)));
    return;
  }
  node.children.forEach((child) => collectFormNode(sets, child));
}

function collectQuery(sets: DependencySets, query: AdminAppDocumentQuery): void {
  sets.collectionIds.add(query.collectionId);
  query.fields?.forEach((fieldId) => sets.fieldIds.add(fieldId));
  if (query.filter !== undefined) collectFilter(sets, query.filter);
  query.sort?.forEach((sort) => collectField(sets, sort.field));
}

function collectFilter(sets: DependencySets, filter: AdminAppFilterExpression): void {
  if (filter.type === "condition") {
    collectField(sets, filter.field);
    return;
  }
  filter.filters.forEach((child) => collectFilter(sets, child));
}

function collectField(sets: DependencySets, field: AdminAppFieldReference): void {
  if (field.kind === "data") sets.fieldIds.add(field.fieldId);
}

function collectAction(sets: DependencySets, action: AdminAppActionReference): void {
  sets.actionIds.add(action.id);
  collectPluginExtension(sets, action.id);
  if (action.visibility !== undefined) collectVisibility(sets, action.visibility);
}

function collectVisibility(sets: DependencySets, visibility: VisibilityCondition): void {
  for (const permission of [
    ...(visibility.allPermissions ?? []),
    ...(visibility.anyPermissions ?? []),
  ]) {
    sets.permissions.set(`${permission.action}\0${permission.resourceId}`, permission);
    sets.resourceIds.add(permission.resourceId);
  }
}

function collectPluginExtension(sets: DependencySets, id: string): void {
  if (id.startsWith("core.")) return;
  const separator = id.indexOf(".");
  if (separator < 1) return;
  sets.extensionIds.add(id);
  sets.pluginIds.add(id.slice(0, separator));
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
