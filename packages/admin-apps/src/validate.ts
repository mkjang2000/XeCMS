import { AdminAppManifestValidationError, type AdminAppIssue } from "./errors.js";
import type {
  AdminAppActionReference,
  AdminAppDocumentQuery,
  AdminAppFieldReference,
  AdminAppFilterExpression,
  AdminAppManifestV1,
  AdminAppSortDefinition,
  AdminNavigationItem,
  AdminPageDefinition,
  DashboardWidgetDefinition,
  FormLayoutNode,
  PermissionReference,
  VisibilityCondition,
} from "./types.js";

type Path = readonly (string | number)[];
interface Context {
  readonly issues: AdminAppIssue[];
  readonly pageIds: ReadonlySet<string>;
  readonly navigationIds: Set<string>;
}

const PORTABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COLLECTION_ID = /^col_[a-z0-9][a-z0-9_-]{0,95}$/;
const FIELD_ID = /^fld_[a-z0-9][a-z0-9_-]{0,95}$/;
const RELATION_ID = /^rel_[a-z0-9][a-z0-9_-]{0,95}$/;
const PERMISSION_KEY = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,254}$/;
const PLUGIN_EXTENSION = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.(?:action|widget|page|panel|renderer)\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RESERVED_APP_KEYS = new Set(["admin", "api", "apps", "assets", "builder", "new"]);

export const BUILTIN_ACTION_IDS = new Set([
  "core.action.create", "core.action.update", "core.action.publish", "core.action.unpublish",
  "core.action.archive", "core.action.restore", "core.action.delete", "core.action.purge",
  "core.action.duplicate", "core.action.move", "core.action.reorder", "core.action.export",
]);

export const BUILTIN_WIDGET_IDS = new Set([
  "core.widget.text", "core.widget.textarea", "core.widget.number", "core.widget.boolean",
  "core.widget.date", "core.widget.datetime", "core.widget.select", "core.widget.rich-text",
  "core.widget.relation", "core.widget.media", "core.widget.json", "core.widget.metric",
  "core.widget.recent-documents", "core.widget.status-summary", "core.widget.collection-count",
  "core.widget.saved-filter-result", "core.widget.quick-action",
]);

export const BUILTIN_RENDERER_IDS = new Set([
  "core.renderer.text", "core.renderer.status", "core.renderer.date", "core.renderer.relation",
]);

export interface AdminAppValidationResult {
  readonly valid: boolean;
  readonly issues: readonly AdminAppIssue[];
}

export function validateAdminAppManifest(manifest: AdminAppManifestV1): AdminAppValidationResult {
  const issues: AdminAppIssue[] = [];
  if (manifest.format !== "xecms.admin-app" || manifest.formatVersion !== 1) {
    issues.push({ code: "INVALID_MANIFEST", message: "format and formatVersion must identify Admin App Manifest V1.", path: [] });
  }
  validatePortableId(issues, manifest.id, ["id"], "App ID");
  validateName(issues, manifest.name, ["name"], "App name");
  validatePortableId(issues, manifest.key, ["key"], "App key");
  if (RESERVED_APP_KEYS.has(manifest.key)) add(issues, "RESERVED_APP_KEY", `App key '${manifest.key}' is reserved.`, ["key"]);
  optionalName(issues, manifest.description, ["description"], 500, "description");
  optionalName(issues, manifest.icon, ["icon"], 120, "icon");
  if (manifest.audience.type === "content-realm") {
    if (!/^rlm_[a-z0-9][a-z0-9_-]{0,95}$/.test(manifest.audience.realmId)) {
      add(issues, "INVALID_REALM_REFERENCE", "Content audience realmId must be a stable Realm ID.", ["audience", "realmId"]);
    }
  }

  const pageIds = new Set<string>();
  manifest.pages.forEach((page, index) => {
    validatePortableId(issues, page.id, ["pages", index, "id"], "Page ID");
    registerUnique(issues, pageIds, page.id, ["pages", index, "id"], "DUPLICATE_PAGE_ID", "Page ID");
  });
  if (manifest.pages.length === 0) add(issues, "PAGE_REQUIRED", "At least one page is required.", ["pages"]);
  if (!pageIds.has(manifest.startPageId)) add(issues, "START_PAGE_NOT_FOUND", `startPageId '${manifest.startPageId}' does not exist.`, ["startPageId"]);

  const context: Context = { issues, pageIds, navigationIds: new Set() };
  const activeNavigation = new WeakSet<object>();
  manifest.navigation.forEach((item, index) => validateNavigation(context, item, ["navigation", index], activeNavigation, 0));
  if (manifest.navigation.length === 0) add(issues, "NAVIGATION_REQUIRED", "At least one navigation item is required.", ["navigation"]);
  manifest.pages.forEach((page, index) => validatePage(context, page, ["pages", index]));
  return { valid: issues.length === 0, issues };
}

export function assertValidAdminAppManifest(manifest: AdminAppManifestV1): void {
  const result = validateAdminAppManifest(manifest);
  if (!result.valid) throw new AdminAppManifestValidationError(result.issues);
}

function validateNavigation(context: Context, item: AdminNavigationItem, path: Path, active: WeakSet<object>, depth: number): void {
  if (active.has(item)) {
    add(context.issues, "NAVIGATION_CYCLE", "Navigation children contain a cycle.", path);
    return;
  }
  if (depth > 12) {
    add(context.issues, "NAVIGATION_DEPTH_EXCEEDED", "Navigation nesting cannot exceed 12 levels.", path);
    return;
  }
  active.add(item);
  validatePortableId(context.issues, item.id, [...path, "id"], "Navigation ID");
  registerUnique(context.issues, context.navigationIds, item.id, [...path, "id"], "DUPLICATE_NAVIGATION_ID", "Navigation ID");
  validateName(context.issues, item.label, [...path, "label"], "Navigation label");
  optionalName(context.issues, item.icon, [...path, "icon"], 120, "icon");
  if (item.pageId === undefined && (item.children === undefined || item.children.length === 0)) {
    add(context.issues, "EMPTY_NAVIGATION_ITEM", "Navigation must reference a page or contain children.", path);
  }
  if (item.pageId !== undefined && !context.pageIds.has(item.pageId)) {
    add(context.issues, "UNKNOWN_PAGE_REFERENCE", `Navigation references missing page '${item.pageId}'.`, [...path, "pageId"]);
  }
  if (item.children !== undefined && item.children.length === 0) {
    add(context.issues, "EMPTY_NAVIGATION_CHILDREN", "children must be omitted instead of empty.", [...path, "children"]);
  }
  if (item.visibility !== undefined) validateVisibility(context.issues, item.visibility, [...path, "visibility"]);
  item.children?.forEach((child, index) => validateNavigation(context, child, [...path, "children", index], active, depth + 1));
  active.delete(item);
}

function validatePage(context: Context, page: AdminPageDefinition, path: Path): void {
  switch (page.type) {
    case "collection-list": {
      validateCollectionId(context.issues, page.collectionId, [...path, "collectionId"]);
      if (page.columns.length === 0) add(context.issues, "COLUMN_REQUIRED", "Collection list requires at least one column.", [...path, "columns"]);
      validateUniqueItems(context.issues, page.columns, [...path, "columns"], "DUPLICATE_COLUMN_ID", (column) => column.id);
      page.columns.forEach((column, index) => {
        validatePortableId(context.issues, column.id, [...path, "columns", index, "id"], "Column ID");
        validateFieldReference(context.issues, column.field, [...path, "columns", index, "field"]);
        if (column.width !== undefined && (column.width < 48 || column.width > 1200)) add(context.issues, "INVALID_COLUMN_WIDTH", "Column width must be 48-1200.", [...path, "columns", index, "width"]);
        if (column.rendererId !== undefined) validateExtension(context.issues, column.rendererId, "renderer", BUILTIN_RENDERER_IDS, [...path, "columns", index, "rendererId"]);
      });
      if (page.fixedFilter !== undefined) validateFilter(context.issues, page.fixedFilter, [...path, "fixedFilter"], 0, { count: 0 });
      validateUniqueItems(context.issues, page.availableFilters ?? [], [...path, "availableFilters"], "DUPLICATE_FILTER_ID", (filter) => filter.id);
      page.availableFilters?.forEach((filter, index) => {
        validatePortableId(context.issues, filter.id, [...path, "availableFilters", index, "id"], "Filter ID");
        validateName(context.issues, filter.label, [...path, "availableFilters", index, "label"], "Filter label");
        validateFieldReference(context.issues, filter.field, [...path, "availableFilters", index, "field"]);
        uniqueStrings(context.issues, filter.operators ?? [], [...path, "availableFilters", index, "operators"], "DUPLICATE_FILTER_OPERATOR");
      });
      validateSorts(context.issues, page.defaultSort ?? [], [...path, "defaultSort"]);
      validateActions(context.issues, page.rowActions ?? [], [...path, "rowActions"]);
      validateActions(context.issues, page.bulkActions ?? [], [...path, "bulkActions"]);
      if (page.rowClick !== undefined && !context.pageIds.has(page.rowClick.pageId)) add(context.issues, "UNKNOWN_PAGE_REFERENCE", `rowClick references missing page '${page.rowClick.pageId}'.`, [...path, "rowClick", "pageId"]);
      break;
    }
    case "document-form":
    case "singleton":
      validateCollectionId(context.issues, page.collectionId, [...path, "collectionId"]);
      validateFormLayout(context.issues, page.layout.nodes, [...path, "layout", "nodes"]);
      validateActions(context.issues, page.actions ?? [], [...path, "actions"]);
      break;
    case "document-detail":
      validateCollectionId(context.issues, page.collectionId, [...path, "collectionId"]);
      if (page.layout.panels.length === 0) add(context.issues, "DETAIL_PANEL_REQUIRED", "Detail page requires at least one panel.", [...path, "layout", "panels"]);
      validateUniqueItems(context.issues, page.layout.panels, [...path, "layout", "panels"], "DUPLICATE_LAYOUT_ID", (panel) => panel.id);
      page.layout.panels.forEach((panel, index) => {
        validatePortableId(context.issues, panel.id, [...path, "layout", "panels", index, "id"], "Panel ID");
        if ("fieldIds" in panel) {
          if (panel.fieldIds.length === 0) add(context.issues, "FIELD_REFERENCE_REQUIRED", "Panel fieldIds cannot be empty.", [...path, "layout", "panels", index, "fieldIds"]);
          panel.fieldIds.forEach((fieldId, fieldIndex) => validateFieldId(context.issues, fieldId, [...path, "layout", "panels", index, "fieldIds", fieldIndex]));
        }
        if (panel.type === "relation") validateRelationId(context.issues, panel.relationId, [...path, "layout", "panels", index, "relationId"]);
        if (panel.type === "plugin") validateExtension(context.issues, panel.extensionId, "panel", new Set(), [...path, "layout", "panels", index, "extensionId"]);
      });
      validateActions(context.issues, page.actions ?? [], [...path, "actions"]);
      break;
    case "dashboard":
      if (page.widgets.length === 0) add(context.issues, "WIDGET_REQUIRED", "Dashboard requires at least one widget.", [...path, "widgets"]);
      validateUniqueItems(context.issues, page.widgets, [...path, "widgets"], "DUPLICATE_WIDGET_ID", (widget) => widget.id);
      page.widgets.forEach((widget, index) => validateWidget(context.issues, widget, [...path, "widgets", index]));
      break;
    case "plugin-page":
      validateExtension(context.issues, page.extensionId, "page", new Set(), [...path, "extensionId"]);
      break;
  }
}

function validateFormLayout(issues: AdminAppIssue[], nodes: readonly FormLayoutNode[], path: Path): void {
  if (nodes.length === 0) add(issues, "LAYOUT_NODE_REQUIRED", "Form layout requires at least one node.", path);
  const ids = new Set<string>();
  const fields = new Set<string>();
  const visit = (items: readonly FormLayoutNode[], itemPath: Path, depth: number): void => {
    if (depth > 8) { add(issues, "LAYOUT_DEPTH_EXCEEDED", "Form layout nesting cannot exceed 8 levels.", itemPath); return; }
    items.forEach((node, index) => {
      const nodePath = [...itemPath, index] as const;
      validatePortableId(issues, node.id, [...nodePath, "id"], "Layout ID");
      registerUnique(issues, ids, node.id, [...nodePath, "id"], "DUPLICATE_LAYOUT_ID", "Layout ID");
      if (node.type === "field") {
        validateFieldId(issues, node.fieldId, [...nodePath, "fieldId"]);
        registerUnique(issues, fields, node.fieldId, [...nodePath, "fieldId"], "DUPLICATE_FIELD_PLACEMENT", "Field placement");
        if (node.widgetId !== undefined) validateExtension(issues, node.widgetId, "widget", BUILTIN_WIDGET_IDS, [...nodePath, "widgetId"]);
        if (node.when !== undefined) validateFilter(issues, node.when, [...nodePath, "when"], 0, { count: 0 });
      } else if (node.type === "tabs") {
        if (node.tabs.length === 0) add(issues, "TAB_REQUIRED", "Tabs require at least one tab.", [...nodePath, "tabs"]);
        validateUniqueItems(issues, node.tabs, [...nodePath, "tabs"], "DUPLICATE_LAYOUT_ID", (tab) => tab.id);
        node.tabs.forEach((tab, tabIndex) => {
          validatePortableId(issues, tab.id, [...nodePath, "tabs", tabIndex, "id"], "Tab ID");
          registerUnique(issues, ids, tab.id, [...nodePath, "tabs", tabIndex, "id"], "DUPLICATE_LAYOUT_ID", "Layout ID");
          if (tab.children.length === 0) add(issues, "LAYOUT_NODE_REQUIRED", "Tab children cannot be empty.", [...nodePath, "tabs", tabIndex, "children"]);
          visit(tab.children, [...nodePath, "tabs", tabIndex, "children"], depth + 1);
        });
      } else {
        if (node.children.length === 0) add(issues, "LAYOUT_NODE_REQUIRED", `${node.type} children cannot be empty.`, [...nodePath, "children"]);
        visit(node.children, [...nodePath, "children"], depth + 1);
      }
    });
  };
  visit(nodes, path, 0);
}

function validateWidget(issues: AdminAppIssue[], widget: DashboardWidgetDefinition, path: Path): void {
  validatePortableId(issues, widget.id, [...path, "id"], "Widget instance ID");
  validateExtension(issues, widget.widgetId, "widget", BUILTIN_WIDGET_IDS, [...path, "widgetId"]);
  if (widget.widgetId === "core.widget.quick-action") {
    if (widget.action === undefined) add(issues, "WIDGET_ACTION_REQUIRED", "Quick action widget requires action.", [...path, "action"]);
  } else if (widget.widgetId.startsWith("core.widget.") && widget.query === undefined) {
    add(issues, "WIDGET_QUERY_REQUIRED", "Built-in dashboard widget requires a registered document query.", [...path, "query"]);
  }
  if (widget.query !== undefined) validateQuery(issues, widget.query, [...path, "query"]);
  if (widget.action !== undefined) validateAction(issues, widget.action, [...path, "action"]);
  if (widget.visibility !== undefined) validateVisibility(issues, widget.visibility, [...path, "visibility"]);
}

function validateQuery(issues: AdminAppIssue[], query: AdminAppDocumentQuery, path: Path): void {
  validateCollectionId(issues, query.collectionId, [...path, "collectionId"]);
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) add(issues, "INVALID_QUERY_LIMIT", "Query limit must be an integer from 1 to 100.", [...path, "limit"]);
  uniqueStrings(issues, query.fields ?? [], [...path, "fields"], "DUPLICATE_FIELD_REFERENCE");
  query.fields?.forEach((fieldId, index) => validateFieldId(issues, fieldId, [...path, "fields", index]));
  if (query.filter !== undefined) validateFilter(issues, query.filter, [...path, "filter"], 0, { count: 0 });
  validateSorts(issues, query.sort ?? [], [...path, "sort"]);
}

function validateFilter(issues: AdminAppIssue[], filter: AdminAppFilterExpression, path: Path, depth: number, state: { count: number }): void {
  state.count += 1;
  if (state.count > 100) { add(issues, "FILTER_COMPLEXITY_EXCEEDED", "Filter cannot exceed 100 nodes.", path); return; }
  if (depth > 8) { add(issues, "FILTER_DEPTH_EXCEEDED", "Filter nesting cannot exceed 8 levels.", path); return; }
  if (filter.type === "group") {
    if (filter.filters.length === 0) add(issues, "EMPTY_FILTER_GROUP", "Filter group cannot be empty.", [...path, "filters"]);
    filter.filters.forEach((child, index) => validateFilter(issues, child, [...path, "filters", index], depth + 1, state));
    return;
  }
  validateFieldReference(issues, filter.field, [...path, "field"]);
  const noValue = filter.operator === "isNull" || filter.operator === "isNotNull";
  if (noValue && filter.value !== undefined) add(issues, "FILTER_VALUE_FORBIDDEN", `${filter.operator} cannot have value.`, [...path, "value"]);
  if (!noValue && filter.value === undefined) add(issues, "FILTER_VALUE_REQUIRED", `${filter.operator} requires value.`, [...path, "value"]);
  if (filter.operator === "in" && (!Array.isArray(filter.value) || filter.value.length === 0)) add(issues, "FILTER_ARRAY_REQUIRED", "in requires a non-empty scalar array.", [...path, "value"]);
  if (filter.operator !== "in" && Array.isArray(filter.value)) add(issues, "FILTER_SCALAR_REQUIRED", `${filter.operator} requires one scalar value.`, [...path, "value"]);
}

function validateSorts(issues: AdminAppIssue[], sorts: readonly AdminAppSortDefinition[], path: Path): void {
  if (sorts.length > 5) add(issues, "SORT_LIMIT_EXCEEDED", "At most 5 sort fields are allowed.", path);
  const fields = new Set<string>();
  sorts.forEach((sort, index) => {
    validateFieldReference(issues, sort.field, [...path, index, "field"]);
    const key = sort.field.kind === "data" ? `data:${sort.field.fieldId}` : `system:${sort.field.field}`;
    registerUnique(issues, fields, key, [...path, index, "field"], "DUPLICATE_SORT_FIELD", "Sort field");
  });
}

function validateActions(issues: AdminAppIssue[], actions: readonly AdminAppActionReference[], path: Path): void {
  const ids = new Set<string>();
  actions.forEach((action, index) => {
    registerUnique(issues, ids, action.id, [...path, index, "id"], "DUPLICATE_ACTION", "Action");
    validateAction(issues, action, [...path, index]);
  });
}

function validateAction(issues: AdminAppIssue[], action: AdminAppActionReference, path: Path): void {
  validateExtension(issues, action.id, "action", BUILTIN_ACTION_IDS, [...path, "id"]);
  if (action.visibility !== undefined) validateVisibility(issues, action.visibility, [...path, "visibility"]);
  optionalName(issues, action.label, [...path, "label"], 120, "action label");
  if (action.confirmation !== undefined) {
    validateName(issues, action.confirmation.title, [...path, "confirmation", "title"], "confirmation title");
    validateName(issues, action.confirmation.message, [...path, "confirmation", "message"], "confirmation message", 500);
  }
}

function validateVisibility(issues: AdminAppIssue[], visibility: VisibilityCondition, path: Path): void {
  const all = visibility.allPermissions ?? [];
  const any = visibility.anyPermissions ?? [];
  const statuses = visibility.documentStatuses ?? [];
  if (all.length === 0 && any.length === 0 && statuses.length === 0) add(issues, "EMPTY_VISIBILITY", "Visibility must contain at least one condition.", path);
  validatePermissionList(issues, all, [...path, "allPermissions"]);
  validatePermissionList(issues, any, [...path, "anyPermissions"]);
  uniqueStrings(issues, statuses, [...path, "documentStatuses"], "DUPLICATE_DOCUMENT_STATUS");
  statuses.forEach((status, index) => validateName(issues, status, [...path, "documentStatuses", index], "document status"));
}

function validatePermissionList(issues: AdminAppIssue[], values: readonly PermissionReference[], path: Path): void {
  const keys = new Set<string>();
  values.forEach((permission, index) => {
    if (!PERMISSION_KEY.test(permission.action)) add(issues, "INVALID_PERMISSION_REFERENCE", `Permission '${permission.action}' is not canonical.`, [...path, index, "action"]);
    if (!RESOURCE_ID.test(permission.resourceId)) add(issues, "INVALID_RESOURCE_REFERENCE", `Resource '${permission.resourceId}' is invalid.`, [...path, index, "resourceId"]);
    registerUnique(issues, keys, `${permission.action}\0${permission.resourceId}`, [...path, index], "DUPLICATE_PERMISSION_REFERENCE", "Permission reference");
  });
}

function validateFieldReference(issues: AdminAppIssue[], field: AdminAppFieldReference, path: Path): void {
  if (field.kind === "data") validateFieldId(issues, field.fieldId, [...path, "fieldId"]);
}

function validateExtension(issues: AdminAppIssue[], value: string, kind: "action" | "widget" | "page" | "panel" | "renderer", builtins: ReadonlySet<string>, path: Path): void {
  if (builtins.has(value)) return;
  const match = PLUGIN_EXTENSION.exec(value);
  if (value.startsWith("core.") || match === null || !value.includes(`.${kind}.`)) {
    add(issues, "UNKNOWN_EXTENSION_REFERENCE", `'${value}' is not a known core ${kind} or a namespaced Plugin ${kind}.`, path);
  }
}

function validateCollectionId(issues: AdminAppIssue[], value: string, path: Path): void {
  if (!COLLECTION_ID.test(value)) add(issues, "INVALID_COLLECTION_REFERENCE", `'${value}' is not a stable Collection ID.`, path);
}
function validateFieldId(issues: AdminAppIssue[], value: string, path: Path): void {
  if (!FIELD_ID.test(value)) add(issues, "INVALID_FIELD_REFERENCE", `'${value}' is not a stable Field ID.`, path);
}
function validateRelationId(issues: AdminAppIssue[], value: string, path: Path): void {
  if (!RELATION_ID.test(value)) add(issues, "INVALID_RELATION_REFERENCE", `'${value}' is not a stable Relation ID.`, path);
}

function validatePortableId(issues: AdminAppIssue[], value: string, path: Path, label: string): void {
  if (value.length > 64 || !PORTABLE_ID.test(value)) add(issues, "INVALID_PORTABLE_ID", `${label} must be lowercase kebab-case with at most 64 characters.`, path);
}
function validateName(issues: AdminAppIssue[], value: string, path: Path, label: string, max = 120): void {
  if (value.trim().length === 0 || value.length > max) add(issues, "INVALID_DISPLAY_TEXT", `${label} must contain 1-${max} characters.`, path);
}
function optionalName(issues: AdminAppIssue[], value: string | undefined, path: Path, max: number, label: string): void {
  if (value !== undefined) validateName(issues, value, path, label, max);
}
function registerUnique(issues: AdminAppIssue[], seen: Set<string>, value: string, path: Path, code: string, label: string): void {
  if (seen.has(value)) add(issues, code, `${label} '${value}' is duplicated.`, path);
  seen.add(value);
}
function validateUniqueItems<T>(issues: AdminAppIssue[], values: readonly T[], path: Path, code: string, key: (value: T) => string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => registerUnique(issues, seen, key(value), [...path, index], code, "ID"));
}
function uniqueStrings(issues: AdminAppIssue[], values: readonly string[], path: Path, code: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => registerUnique(issues, seen, value, [...path, index], code, "Value"));
}
function add(issues: AdminAppIssue[], code: string, message: string, path: Path): void {
  issues.push({ code, message, path });
}
