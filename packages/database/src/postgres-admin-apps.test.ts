import { randomUUID } from "node:crypto";

import {
  decodeAdminAppManifest,
  minimalBackofficeManifest,
  type AdminAppManifestV1,
} from "@xecms/admin-apps";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyAdminAppStoreMigration, ADMIN_APP_STORE_MIGRATION_ID } from "./admin-app-migration.js";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, migrateCore } from "./migrate.js";
import { PostgresAdminAppStore } from "./postgres-admin-apps.js";

describe("Admin App PostgreSQL adapter validation", () => {
  it("rejects unsafe database schema names before issuing queries", () => {
    expect(() => new PostgresAdminAppStore({} as Pool, "public; drop schema public")).toThrow();
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("CAA-2A Admin App PostgreSQL Store", () => {
  const schema = `xecms_admin_apps_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  const store = new PostgresAdminAppStore(pool, schema);
  const now = "2026-07-17T14:00:00.000Z";
  const author = {
    actorIdentityId: "identity_admin_apps_owner",
    actorSubjectId: "subject_admin_apps_owner",
    now,
  } as const;
  const q = (name: string): string => qualifiedName(schema, name);

  beforeAll(async () => {
    await migrateCore(pool, schema);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("installs migration 0020 and all storage boundaries idempotently", async () => {
    const migration = await pool.query(
      `SELECT id FROM ${q("_xecms_core_migrations")} WHERE id = $1`,
      [ADMIN_APP_STORE_MIGRATION_ID],
    );
    expect(migration.rowCount).toBe(1);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyAdminAppStoreMigration(client, schema);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = ANY($2::text[])
        ORDER BY table_name`,
      [schema, [
        "_xecms_admin_apps",
        "_xecms_admin_app_drafts",
        "_xecms_admin_app_revisions",
        "_xecms_admin_app_dependencies",
        "_xecms_admin_app_user_views",
      ]],
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toHaveLength(5);

    const permissions = await pool.query<{ permission_key: string }>(
      `SELECT permission_key FROM ${q("_xecms_auth_permissions")}
        WHERE permission_key LIKE 'admin-app.%' ORDER BY permission_key`,
    );
    expect(permissions.rows.map(({ permission_key }) => permission_key)).toEqual([
      "admin-app.access",
      "admin-app.apply",
      "admin-app.create",
      "admin-app.delete",
      "admin-app.export",
      "admin-app.read",
      "admin-app.update",
    ]);
  });

  it("keeps multiple Apps and their optimistic Drafts independent", async () => {
    const first = await store.createAppDraft({
      id: "aap_backoffice",
      workspaceId: DEFAULT_WORKSPACE_ID,
      manifest: appManifest("backoffice", "backoffice", "Backoffice"),
      ...author,
    });
    const second = await store.createAppDraft({
      id: "aap_inventory",
      workspaceId: DEFAULT_WORKSPACE_ID,
      manifest: appManifest("inventory", "inventory", "Inventory"),
      ...author,
    });

    expect(first.app).toMatchObject({ activeRevisionId: null, routeVersion: 1, key: "backoffice" });
    expect(first.draft).toMatchObject({ baseRevisionId: null, draftVersion: 1 });
    expect(second.draft.manifest.id).toBe("inventory");
    expect(await store.listApps(DEFAULT_WORKSPACE_ID)).toHaveLength(2);

    await expect(store.createAppDraft({
      id: "aap_duplicate",
      workspaceId: DEFAULT_WORKSPACE_ID,
      manifest: appManifest("another-app", "backoffice", "Duplicate route"),
      ...author,
    })).rejects.toMatchObject({ code: "ADMIN_APP_KEY_CONFLICT", status: 409 });

    const changed = appManifest("backoffice", "operations", "Operations");
    const saved = await store.saveDraft({
      appId: first.app.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedDraftVersion: first.draft.draftVersion,
      expectedBaseRevisionId: null,
      manifest: changed,
      ...author,
    });
    expect(saved).toMatchObject({ desiredKey: "operations", draftVersion: 2 });
    expect((await store.getApp(DEFAULT_WORKSPACE_ID, first.app.id))?.key).toBe("backoffice");
    expect((await store.getDraft(DEFAULT_WORKSPACE_ID, second.app.id))?.draftVersion).toBe(1);

    await expect(store.saveDraft({
      appId: first.app.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedDraftVersion: 1,
      expectedBaseRevisionId: null,
      manifest: changed,
      ...author,
    })).rejects.toMatchObject({ code: "ADMIN_APP_DRAFT_CONFLICT", status: 409 });

    await expect(store.saveDraft({
      appId: first.app.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedDraftVersion: saved.draftVersion,
      expectedBaseRevisionId: null,
      manifest: appManifest("backoffice", "inventory", "Conflicting route"),
      ...author,
    })).rejects.toMatchObject({ code: "ADMIN_APP_KEY_CONFLICT", status: 409 });
  });

  it("applies immutable revisions with dependency snapshots and rejects stale apply", async () => {
    const app = required(await store.getApp(DEFAULT_WORKSPACE_ID, "aap_backoffice"));
    const draft = required(await store.getDraft(DEFAULT_WORKSPACE_ID, app.id));

    await expect(store.applyDraft({
      appId: app.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      revisionId: "aar_stale",
      expectedActiveRevisionId: null,
      expectedRouteVersion: app.routeVersion,
      expectedDraftVersion: draft.draftVersion - 1,
      dependencies: [],
      ...author,
    })).rejects.toMatchObject({ code: "ADMIN_APP_DRAFT_CONFLICT", status: 409 });

    const applied = await store.applyDraft({
      appId: app.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      revisionId: "aar_operations_v1",
      expectedActiveRevisionId: null,
      expectedRouteVersion: app.routeVersion,
      expectedDraftVersion: draft.draftVersion,
      dependencies: [
        { kind: "field", id: "fld_order_number" },
        { kind: "schema-revision", id: "sch_active", fingerprint: "schema-hash" },
        { kind: "plugin", id: "sales", fingerprint: "plugin-digest", metadata: { version: "1.0.0" } },
      ],
      ...author,
    });

    expect(applied.app).toMatchObject({
      key: "operations",
      name: "Operations",
      activeRevisionId: "aar_operations_v1",
      routeVersion: 2,
    });
    expect(applied.revision).toMatchObject({
      sequence: 1,
      parentRevisionId: null,
      manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(applied.revision.dependencies).toEqual([
      { kind: "field", id: "fld_order_number" },
      { kind: "plugin", id: "sales", fingerprint: "plugin-digest", metadata: { version: "1.0.0" } },
      { kind: "schema-revision", id: "sch_active", fingerprint: "schema-hash" },
    ]);
    expect(await store.getDraft(DEFAULT_WORKSPACE_ID, app.id)).toBeNull();

    await expect(pool.query(
      `UPDATE ${q("_xecms_admin_app_revisions")}
          SET manifest_hash = $2 WHERE revision_id = $1`,
      [applied.revision.id, "f".repeat(64)],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(pool.query(
      `DELETE FROM ${q("_xecms_admin_app_dependencies")} WHERE revision_id = $1`,
      [applied.revision.id],
    )).rejects.toMatchObject({ code: "55000" });
  });

  it("creates the next Draft, applies it, and rolls back the active pointer with CAS", async () => {
    const before = required(await store.getApp(DEFAULT_WORKSPACE_ID, "aap_backoffice"));
    const draft = await store.createDraft({
      appId: before.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRouteVersion: before.routeVersion,
      ...author,
    });
    expect(draft).toMatchObject({ baseRevisionId: "aar_operations_v1", draftVersion: 1 });

    const updated = await store.saveDraft({
      appId: before.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedDraftVersion: draft.draftVersion,
      expectedBaseRevisionId: draft.baseRevisionId,
      manifest: appManifest("backoffice", "ops-center", "Operations Center"),
      ...author,
    });
    const second = await store.applyDraft({
      appId: before.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      revisionId: "aar_operations_v2",
      expectedActiveRevisionId: "aar_operations_v1",
      expectedRouteVersion: before.routeVersion,
      expectedDraftVersion: updated.draftVersion,
      dependencies: [],
      ...author,
    });
    expect(second.app).toMatchObject({ key: "ops-center", routeVersion: 3 });
    expect(second.revision).toMatchObject({ sequence: 2, parentRevisionId: "aar_operations_v1" });

    await expect(store.activateRevision({
      appId: before.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      targetRevisionId: "aar_operations_v1",
      expectedActiveRevisionId: "aar_operations_v2",
      expectedRouteVersion: 2,
      ...author,
    })).rejects.toMatchObject({ code: "ADMIN_APP_ROUTE_CONFLICT", status: 409 });

    const rolledBack = await store.activateRevision({
      appId: before.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      targetRevisionId: "aar_operations_v1",
      expectedActiveRevisionId: "aar_operations_v2",
      expectedRouteVersion: second.app.routeVersion,
      ...author,
    });
    expect(rolledBack.app).toMatchObject({
      key: "operations",
      activeRevisionId: "aar_operations_v1",
      routeVersion: 4,
    });
    expect((await store.listRevisions(DEFAULT_WORKSPACE_ID, before.id)).map(({ id }) => id)).toEqual([
      "aar_operations_v2",
      "aar_operations_v1",
    ]);
  });
});

function appManifest(id: string, key: string, name: string): AdminAppManifestV1 {
  return decodeAdminAppManifest({ ...minimalBackofficeManifest, id, key, name });
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required test value is missing.");
  return value;
}
