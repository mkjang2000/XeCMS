import type { AdminAppManifestV1 } from "./types.js";

/** Small but representative system Backoffice used by contract and integration tests. */
export const minimalBackofficeManifest = {
  format: "xecms.admin-app",
  formatVersion: 1,
  id: "backoffice",
  name: "Backoffice",
  key: "backoffice",
  description: "Orders and workspace settings",
  icon: "briefcase",
  audience: { type: "system" },
  navigation: [
    { id: "overview-nav", label: "Overview", pageId: "overview", icon: "home" },
    {
      id: "orders-nav",
      label: "Orders",
      icon: "receipt",
      children: [
        { id: "order-list-nav", label: "All orders", pageId: "order-list" },
        { id: "order-create-nav", label: "New order", pageId: "order-create" },
      ],
    },
    { id: "settings-nav", label: "Settings", pageId: "workspace-settings", icon: "settings" },
  ],
  pages: [
    {
      id: "overview",
      type: "dashboard",
      title: "Overview",
      widgets: [
        {
          id: "recent-orders",
          widgetId: "core.widget.recent-documents",
          title: "Recent orders",
          width: 8,
          query: {
            collectionId: "col_orders",
            limit: 8,
            fields: ["fld_order_number", "fld_customer_name"],
            sort: [{ field: { kind: "system", field: "updatedAt" }, direction: "desc" }],
            state: "active",
          },
        },
        {
          id: "create-order",
          widgetId: "core.widget.quick-action",
          title: "Create order",
          width: 4,
          action: {
            id: "core.action.create",
            visibility: {
              allPermissions: [{ action: "content.create", resourceId: "resource:collection:col_orders" }],
            },
          },
        },
      ],
    },
    {
      id: "order-list",
      type: "collection-list",
      collectionId: "col_orders",
      title: "Orders",
      columns: [
        { id: "order-number", field: { kind: "data", fieldId: "fld_order_number" }, label: "Order" },
        { id: "customer", field: { kind: "data", fieldId: "fld_customer_name" }, label: "Customer" },
        { id: "updated-at", field: { kind: "system", field: "updatedAt" }, label: "Updated", rendererId: "core.renderer.date" },
      ],
      availableFilters: [
        { id: "customer-filter", label: "Customer", field: { kind: "data", fieldId: "fld_customer_name" }, operators: ["contains", "eq"] },
      ],
      defaultSort: [{ field: { kind: "system", field: "updatedAt" }, direction: "desc" }],
      rowActions: [{ id: "core.action.update" }, { id: "core.action.archive" }],
      bulkActions: [{ id: "core.action.export" }],
      rowClick: { pageId: "order-detail", documentIdFrom: "row" },
    },
    {
      id: "order-create",
      type: "document-form",
      collectionId: "col_orders",
      mode: "create",
      layout: {
        nodes: [
          {
            id: "order-main",
            type: "section",
            title: "Order",
            columns: 2,
            children: [
              { id: "order-number-field", type: "field", fieldId: "fld_order_number", width: "half" },
              { id: "customer-name-field", type: "field", fieldId: "fld_customer_name", width: "half" },
            ],
          },
        ],
      },
      actions: [{ id: "core.action.create" }],
    },
    {
      id: "order-detail",
      type: "document-detail",
      collectionId: "col_orders",
      title: "Order details",
      layout: {
        panels: [
          { id: "order-summary", type: "summary", fieldIds: ["fld_order_number", "fld_customer_name"] },
          { id: "order-revisions", type: "revisions" },
          { id: "order-audit", type: "audit" },
        ],
      },
      actions: [{ id: "core.action.update" }, { id: "core.action.archive" }],
    },
    {
      id: "workspace-settings",
      type: "singleton",
      collectionId: "col_workspace_settings",
      title: "Workspace settings",
      layout: {
        nodes: [
          { id: "workspace-name-field", type: "field", fieldId: "fld_workspace_name" },
        ],
      },
      actions: [{ id: "core.action.update" }],
    },
  ],
  startPageId: "overview",
} as const satisfies AdminAppManifestV1;
