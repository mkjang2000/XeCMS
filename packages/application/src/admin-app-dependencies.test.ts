import { decodeAdminAppManifest, minimalBackofficeManifest } from "@xecms/admin-apps";
import { decodeSchema } from "@xecms/schema";
import { describe, expect, it } from "vitest";

import {
  CatalogAdminAppDependencyResolver,
  type AdminAppDependencyCatalog,
} from "./admin-app-dependencies.js";

const schema = decodeSchema({
  format: "xecms.schema",
  formatVersion: 1,
  collections: [
    {
      id: "col_orders", name: "orders", fields: [
        { id: "fld_order_number", name: "orderNumber", type: "text", required: true },
        { id: "fld_customer_name", name: "customerName", type: "text" },
      ],
    },
    {
      id: "col_workspace_settings", name: "workspaceSettings", kind: "singleton", fields: [
        { id: "fld_workspace_name", name: "workspaceName", type: "component", componentId: "cmp_workspace_identity" },
      ],
    },
  ],
  components: [{
    id: "cmp_workspace_identity", name: "workspaceIdentity",
    fields: [{ id: "fld_workspace_title", name: "title", type: "text" }],
  }],
});

function catalog(overrides: Partial<AdminAppDependencyCatalog> = {}): AdminAppDependencyCatalog {
  return {
    getActiveSchema: async () => ({ revisionId: "sch_active", hash: "schema-hash", schema }),
    getRealm: async (_workspaceId, realmId) => ({
      id: realmId, workspaceId: "wrk_default", key: "system", kind: "system",
      status: "active", revision: 4,
    }),
    getAuthorization: async (_workspaceId, realmId) => ({
      realmId, revision: 9,
      permissionKeys: new Set(["content.create"]),
      resourceIds: new Set(["resource:workspace", "resource:collection:col_orders"]),
    }),
    getPlugin: async () => null,
    ...overrides,
  };
}

describe("CatalogAdminAppDependencyResolver", () => {
  it("snapshots live Schema, Realm, policy and built-in registry fingerprints", async () => {
    const result = await new CatalogAdminAppDependencyResolver(catalog()).resolve({
      workspaceId: "wrk_default",
      manifest: minimalBackofficeManifest,
    });

    expect(result.blockers).toEqual([]);
    expect(result.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "schema-revision", id: "sch_active", fingerprint: "schema-hash" }),
      expect.objectContaining({ kind: "authorization-policy", id: "rlm_system", fingerprint: "9" }),
      expect.objectContaining({ kind: "realm", id: "rlm_system", fingerprint: "4" }),
      expect.objectContaining({ kind: "collection", id: "col_orders", fingerprint: "schema-hash" }),
      expect.objectContaining({ kind: "component", id: "cmp_workspace_identity", fingerprint: "schema-hash" }),
      expect.objectContaining({ kind: "field", id: "fld_order_number", fingerprint: "schema-hash" }),
      expect.objectContaining({ kind: "field", id: "fld_workspace_title", fingerprint: "schema-hash" }),
      expect.objectContaining({ kind: "permission", fingerprint: "9" }),
      expect.objectContaining({ kind: "resource", id: "resource:collection:col_orders", fingerprint: "9" }),
      expect.objectContaining({ kind: "action", id: "core.action.create", fingerprint: "core-admin-registry-v1" }),
      expect.objectContaining({ kind: "widget", id: "core.widget.quick-action", fingerprint: "core-admin-registry-v1" }),
      expect.objectContaining({ kind: "renderer", id: "core.renderer.date", fingerprint: "core-admin-registry-v1" }),
    ]));
  });

  it("fails closed when live Schema, Realm or Authorization state is unavailable", async () => {
    const result = await new CatalogAdminAppDependencyResolver(catalog({
      getActiveSchema: async () => null,
      getRealm: async () => null,
      getAuthorization: async () => null,
    })).resolve({ workspaceId: "wrk_default", manifest: minimalBackofficeManifest });

    expect(result.blockers.map(({ code }) => code)).toEqual([
      "AUTHORIZATION_POLICY_MISSING",
      "REALM_MISSING",
      "SCHEMA_NOT_APPLIED",
    ]);
  });

  it("detects field ownership, Permission, Resource and Realm state drift", async () => {
    const mismatchedSchema = decodeSchema({
      format: "xecms.schema", formatVersion: 1,
      collections: [
        { id: "col_orders", name: "orders", fields: [{ id: "fld_order_number", name: "number", type: "text" }] },
        { id: "col_other", name: "other", fields: [{ id: "fld_customer_name", name: "customer", type: "text" }] },
        { id: "col_workspace_settings", name: "settings", kind: "singleton", fields: [{ id: "fld_workspace_name", name: "name", type: "text" }] },
      ],
    });
    const result = await new CatalogAdminAppDependencyResolver(catalog({
      getActiveSchema: async () => ({ revisionId: "sch_drift", hash: "drift-hash", schema: mismatchedSchema }),
      getRealm: async (_workspaceId, realmId) => ({
        id: realmId, workspaceId: "wrk_default", key: "system", kind: "system",
        status: "disabled", revision: 5,
      }),
      getAuthorization: async (_workspaceId, realmId) => ({
        realmId, revision: 10, permissionKeys: new Set(), resourceIds: new Set(),
      }),
    })).resolve({ workspaceId: "wrk_default", manifest: minimalBackofficeManifest });

    expect(result.blockers.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "FIELD_COLLECTION_MISMATCH", "PERMISSION_MISSING", "REALM_INACTIVE", "RESOURCE_MISSING",
    ]));
  });

  it("keeps Auth Collections inside the App's target Realm", async () => {
    const rawSchema = structuredClone(schema) as unknown as {
      collections: Array<Record<string, unknown>>;
    };
    rawSchema.collections[0]!["auth"] = {
      enabled: true,
      realmKey: "customers",
      identifierFieldIds: ["fld_order_number"],
      acceptSystemIdentities: true,
      provisioning: "explicit",
      defaultRoleIds: [],
    };
    const authFields = rawSchema.collections[0]!["fields"] as Array<Record<string, unknown>>;
    authFields[0]!["unique"] = true;
    const schemaWithAuth = decodeSchema(rawSchema);
    const rawManifest = structuredClone(minimalBackofficeManifest) as unknown as Record<string, unknown>;
    rawManifest["audience"] = { type: "content-realm", realmId: "rlm_shop" };
    const contentManifest = decodeAdminAppManifest(rawManifest);
    const resolveForRealmKey = (realmKey: string) => new CatalogAdminAppDependencyResolver(catalog({
      getActiveSchema: async () => ({ revisionId: "sch_auth", hash: "auth-hash", schema: schemaWithAuth }),
      getRealm: async (_workspaceId, realmId) => ({
        id: realmId, workspaceId: "wrk_default", key: realmKey, kind: "content",
        status: "active", revision: 1,
      }),
    })).resolve({ workspaceId: "wrk_default", manifest: contentManifest });

    const foreignRealm = await resolveForRealmKey("shop");
    expect(foreignRealm.blockers).toContainEqual(expect.objectContaining({
      code: "AUTH_COLLECTION_REALM_MISMATCH",
      details: expect.objectContaining({ collectionId: "col_orders", collectionRealmKey: "customers" }),
    }));

    const owningRealm = await resolveForRealmKey("customers");
    expect(owningRealm.blockers.map(({ code }) => code)).not.toContain("AUTH_COLLECTION_REALM_MISMATCH");

    const systemRealm = await new CatalogAdminAppDependencyResolver(catalog({
      getActiveSchema: async () => ({ revisionId: "sch_auth", hash: "auth-hash", schema: schemaWithAuth }),
    })).resolve({ workspaceId: "wrk_default", manifest: minimalBackofficeManifest });
    expect(systemRealm.blockers.map(({ code }) => code)).toContain("AUTH_COLLECTION_REALM_MISMATCH");
  });

  it("requires namespaced extensions to exist in an installed, enabled and loaded trusted Plugin", async () => {
    const raw = structuredClone(minimalBackofficeManifest) as unknown as Record<string, unknown>;
    const pages = raw["pages"] as Array<Record<string, unknown>>;
    const list = pages.find(({ id }) => id === "order-list")!;
    const columns = list["columns"] as Array<Record<string, unknown>>;
    columns[0]!["rendererId"] = "sales.renderer.order-number";
    const manifest = decodeAdminAppManifest(raw);
    const result = await new CatalogAdminAppDependencyResolver(catalog({
      getPlugin: async () => ({
        id: "sales", version: "1.2.0", manifestDigest: "runtime-digest",
        installedManifestDigest: "stored-digest", installed: true, enabled: false,
        runtimeLoaded: false, extensionIds: new Set(),
      }),
    })).resolve({ workspaceId: "wrk_default", manifest });

    expect(result.blockers.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "EXTENSION_MISSING", "PLUGIN_MANIFEST_DRIFT", "PLUGIN_NOT_ENABLED", "PLUGIN_RUNTIME_UNAVAILABLE",
    ]));
    expect(result.dependencies).toContainEqual(expect.objectContaining({
      kind: "plugin", id: "sales", fingerprint: "runtime-digest",
    }));
  });
});
