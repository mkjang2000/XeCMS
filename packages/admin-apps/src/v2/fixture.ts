import type { AdminAppManifestV2 } from "./types.js";

/**
 * The minimal search → list → detail Composed Page manifest from the CPB-1
 * specification (§5.1). The decoder/validator must accept this exact structure.
 */
export const minimalComposedPageManifest = {
  format: "xecms.admin-app",
  formatVersion: 2,
  id: "operations",
  name: "Operations",
  key: "operations",
  audience: { type: "content-realm", realmId: "rlm_operations" },
  presentation: {
    layoutProfile: "16:9",
    menuPosition: "left",
    canvasAlignment: "top-center",
  },
  navigation: [
    { id: "nav_customer_search", label: "고객 조회", pageId: "pg_customer_search" },
  ],
  pages: [
    {
      id: "pg_customer_search",
      type: "composed-page",
      screenNo: "CUS-001",
      title: "고객 조회",
      menuLabel: "고객 조회",
      layout: { columns: 48, rowHeight: 8 },
      state: [
        { id: "state_search_name", valueType: "string", initialValue: "" },
        { id: "state_selected_id", valueType: "document-id", initialValue: null },
      ],
      dataSources: [
        {
          id: "query_customers",
          type: "document-query",
          collectionId: "col_customers",
          trigger: "manual",
          fields: ["fld_customer_name", "fld_customer_email"],
          parameters: [{ id: "param_name", valueType: "string" }],
          filter: {
            type: "condition",
            field: { kind: "data", fieldId: "fld_customer_name" },
            operator: "contains",
            value: { type: "parameter", parameterId: "param_name" },
          },
          limit: 20,
        },
      ],
      components: [
        {
          id: "cmp_search_name",
          kind: "core.input.text",
          placement: { x: 0, y: 0, width: 16, height: 5 },
          props: { label: "고객명" },
        },
        {
          id: "cmp_search_button",
          kind: "core.button",
          placement: { x: 17, y: 0, width: 5, height: 5 },
          props: { label: "조회", tone: "primary" },
        },
        {
          id: "cmp_customer_list",
          kind: "core.output.table",
          placement: { x: 0, y: 7, width: 30, height: 30 },
          props: {
            columns: [
              {
                id: "column_name",
                fieldId: "fld_customer_name",
                label: "고객명",
                protection: { mode: "normal" },
              },
              {
                id: "column_email",
                fieldId: "fld_customer_email",
                label: "이메일",
                protection: { mode: "mask-when-required", maskPolicyId: "core.mask.email" },
              },
            ],
          },
        },
        {
          id: "cmp_customer_detail",
          kind: "core.output.detail",
          placement: { x: 31, y: 7, width: 17, height: 30 },
          props: {
            collectionId: "col_customers",
            fields: [
              { fieldId: "fld_customer_name", protection: { mode: "normal" } },
              {
                fieldId: "fld_customer_email",
                protection: { mode: "mask-when-required", maskPolicyId: "core.mask.email" },
              },
            ],
          },
        },
      ],
      connections: [
        {
          id: "conn_search_input_state",
          from: { nodeType: "component", nodeId: "cmp_search_name", portId: "value" },
          to: { nodeType: "state", nodeId: "state_search_name", portId: "write" },
        },
        {
          id: "conn_search_state_parameter",
          from: { nodeType: "state", nodeId: "state_search_name", portId: "value" },
          to: { nodeType: "data-source", nodeId: "query_customers", portId: "parameter:param_name" },
        },
        {
          id: "conn_search_execute",
          from: { nodeType: "component", nodeId: "cmp_search_button", portId: "clicked" },
          to: { nodeType: "data-source", nodeId: "query_customers", portId: "execute" },
        },
        {
          id: "conn_query_list",
          from: { nodeType: "data-source", nodeId: "query_customers", portId: "rows" },
          to: { nodeType: "component", nodeId: "cmp_customer_list", portId: "data" },
        },
        {
          id: "conn_list_selected_state",
          from: { nodeType: "component", nodeId: "cmp_customer_list", portId: "selectedDocumentId" },
          to: { nodeType: "state", nodeId: "state_selected_id", portId: "write" },
        },
        {
          id: "conn_selected_detail",
          from: { nodeType: "state", nodeId: "state_selected_id", portId: "value" },
          to: { nodeType: "component", nodeId: "cmp_customer_detail", portId: "documentId" },
        },
      ],
    },
  ],
  startPageId: "pg_customer_search",
} as const satisfies AdminAppManifestV2;
