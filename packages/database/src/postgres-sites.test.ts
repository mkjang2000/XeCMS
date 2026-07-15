import { randomUUID } from "node:crypto";

import {
  AuthorizationApplicationService,
  SYSTEM_CONTENT_RESOURCE_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
} from "@xecms/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, SYSTEM_REALM_ID } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresWorkspaceSettingsStore } from "./postgres-site-settings.js";
import { PostgresSiteStore } from "./postgres-sites.js";
import { PostgresDatabase } from "./postgres.js";
import { applySiteSettingsMigration, SITE_SETTINGS_MIGRATION_ID } from "./site-settings-migration.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("M4-C2 Workspace settings and Sites PostgreSQL transactions", () => {
  const schema = `xecms_sites_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 4 });
  const settings = new PostgresWorkspaceSettingsStore(database.pool, schema);
  const sites = new PostgresSiteStore(database.pool, schema);
  const authorizationStore = new PostgresAuthorizationStore(database.pool, schema);
  const authorization = new AuthorizationApplicationService(authorizationStore, {
    now: () => "2026-07-15T15:00:00.000Z",
    newAuditId: () => `audit_${randomUUID()}`,
    newId: (prefix) => `${prefix}_${randomUUID()}`,
  });
  const ownerId = "usr_c2_owner";
  const q = (name: string) => qualifiedName(schema, name);

  beforeAll(async () => {
    await database.migrate();
    await database.createInitialOwner({
      id: ownerId,
      username: "c2.owner",
      passwordHash: "hash-owner",
      now: "2026-07-15T15:00:00.000Z",
    });
    await authorization.initialize({
      realmId: SYSTEM_REALM_ID,
      realmName: "System Realm",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: DEFAULT_WORKSPACE_NAME,
      ownerSubjectId: ownerId,
      ownerIdentityId: ownerId,
      ownerSubjectName: "c2.owner",
    });
  });

  afterAll(async () => {
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await database.close();
  });

  it("installs and idempotently reapplies migration 0016", async () => {
    await expect(database.pool.query(
      `SELECT id FROM ${q("_xecms_core_migrations")} WHERE id = $1`,
      [SITE_SETTINGS_MIGRATION_ID],
    )).resolves.toMatchObject({ rowCount: 1 });
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await applySiteSettingsMigration(client, schema);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await expect(database.pool.query(
      `SELECT permission_key FROM ${q("_xecms_auth_permissions")}
        WHERE permission_key IN ('site.read', 'site.collection.bind')`,
    )).resolves.toMatchObject({ rowCount: 2 });
  });

  it("updates Workspace settings with CAS and records Audit and Outbox atomically", async () => {
    const initial = await settings.get(DEFAULT_WORKSPACE_ID);
    expect(initial).toMatchObject({ revision: 1, defaultTimezone: "UTC", adminLocale: "ko-KR" });
    const updated = await settings.update({
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 1,
      displayName: "Editorial Workspace",
      defaultTimezone: "Asia/Seoul",
      adminLocale: "ko-KR",
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T15:01:00.000Z",
    });
    expect(updated).toMatchObject({ displayName: "Editorial Workspace", revision: 2 });
    await expect(settings.update({
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 1,
      displayName: "Stale update",
      defaultTimezone: "UTC",
      adminLocale: "en-US",
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T15:02:00.000Z",
    })).rejects.toMatchObject({ code: "WORKSPACE_REVISION_CONFLICT", status: 409 });
    await expect(database.pool.query(
      `SELECT topic, aggregate_type, aggregate_version
         FROM ${q("_xecms_outbox_events")} WHERE topic = 'workspace.settings.updated'`,
    )).resolves.toMatchObject({
      rows: [{ topic: "workspace.settings.updated", aggregate_type: "workspace", aggregate_version: "2" }],
    });
  });

  it("preserves default lifecycle invariants and Site CAS", async () => {
    const primary = await sites.create({
      id: "site_c2_primary", workspaceId: DEFAULT_WORKSPACE_ID, key: "primary-site",
      name: "Primary", canonicalUrl: "https://primary.example.com", actorIdentityId: ownerId,
      actorSubjectId: ownerId, now: "2026-07-15T15:10:00.000Z",
    });
    const secondary = await sites.create({
      id: "site_c2_secondary", workspaceId: DEFAULT_WORKSPACE_ID, key: "secondary-site",
      name: "Secondary", actorIdentityId: ownerId, actorSubjectId: ownerId,
      now: "2026-07-15T15:11:00.000Z",
    });
    expect(primary).toMatchObject({ isDefault: true, revision: 1 });
    expect(secondary).toMatchObject({ isDefault: false, revision: 1 });

    const renamed = await sites.update({
      siteId: secondary.id, workspaceId: DEFAULT_WORKSPACE_ID, expectedRevision: 1,
      name: "Secondary Editorial", actorIdentityId: ownerId, actorSubjectId: ownerId,
      now: "2026-07-15T15:12:00.000Z",
    });
    expect(renamed).toMatchObject({ revision: 2, name: "Secondary Editorial" });
    await expect(sites.update({
      siteId: secondary.id, workspaceId: DEFAULT_WORKSPACE_ID, expectedRevision: 1,
      name: "Stale", actorIdentityId: ownerId, actorSubjectId: ownerId,
      now: "2026-07-15T15:13:00.000Z",
    })).rejects.toMatchObject({ code: "SITE_REVISION_CONFLICT", status: 409 });

    await expect(sites.setArchived({
      siteId: primary.id, workspaceId: DEFAULT_WORKSPACE_ID, expectedRevision: 1,
      archived: true, actorIdentityId: ownerId, actorSubjectId: ownerId,
      now: "2026-07-15T15:14:00.000Z",
    })).rejects.toMatchObject({ code: "SITE_DEFAULT_REPLACEMENT_REQUIRED", status: 409 });
    const archived = await sites.setArchived({
      siteId: primary.id, workspaceId: DEFAULT_WORKSPACE_ID, expectedRevision: 1,
      archived: true, replacementDefaultSiteId: secondary.id,
      actorIdentityId: ownerId, actorSubjectId: ownerId,
      now: "2026-07-15T15:15:00.000Z",
    });
    expect(archived).toMatchObject({ status: "archived", isDefault: false, revision: 2 });
    const current = await sites.list(DEFAULT_WORKSPACE_ID);
    expect(current.filter(({ isDefault }) => isDefault)).toEqual([
      expect.objectContaining({ id: secondary.id, status: "active", revision: 3 }),
    ]);
  });

  it("reparents Collection authorization scope and locks writes after Site archive", async () => {
    const currentPolicy = await authorizationStore.getPolicyRevision(SYSTEM_REALM_ID);
    expect(currentPolicy).not.toBeNull();
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_resources")}
         (id, realm_id, name, resource_type, parent_id, external_type, external_id, protected,
          attributes, created_at, created_by, updated_at, updated_by)
       VALUES ('resource:collection:col_c2_posts', $1, 'Posts', 'collection', $2,
               'collection', 'col_c2_posts', false, '{}'::jsonb, $3, $4, $3, $4)`,
      [SYSTEM_REALM_ID, SYSTEM_CONTENT_RESOURCE_ID, "2026-07-15T15:20:00.000Z", ownerId],
    );
    const secondary = await sites.get("site_c2_secondary", DEFAULT_WORKSPACE_ID);
    const bound = await sites.bindCollection({
      siteId: secondary!.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      collectionId: "col_c2_posts",
      expectedSiteRevision: secondary!.revision,
      expectedPolicyRevision: currentPolicy!,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T15:21:00.000Z",
    });
    expect(bound.collectionIds).toEqual(["col_c2_posts"]);
    await expect(database.pool.query(
      `SELECT parent_id FROM ${q("_xecms_auth_resources")}
        WHERE realm_id = $1 AND id = 'resource:collection:col_c2_posts'`,
      [SYSTEM_REALM_ID],
    )).resolves.toMatchObject({ rows: [{ parent_id: `resource:site:${secondary!.id}` }] });
    await expect(sites.assertCollectionWritable(DEFAULT_WORKSPACE_ID, "col_c2_posts")).resolves.toBeUndefined();

    const primary = await sites.get("site_c2_primary", DEFAULT_WORKSPACE_ID);
    const activePrimary = await sites.setArchived({
      siteId: primary!.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: primary!.revision,
      archived: false,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T15:21:30.000Z",
    });
    const archivedSecondary = await sites.setArchived({
      siteId: secondary!.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: bound.revision,
      archived: true,
      replacementDefaultSiteId: activePrimary.id,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T15:22:00.000Z",
    });
    expect(archivedSecondary.status).toBe("archived");
    await expect(sites.assertCollectionWritable(DEFAULT_WORKSPACE_ID, "col_c2_posts"))
      .rejects.toMatchObject({ code: "SITE_ARCHIVED", status: 423 });
    await expect(database.pool.query(
      `SELECT count(*)::int AS count FROM ${q("_xecms_outbox_events")}
        WHERE topic IN ('site.collection.bound', 'site.archived') AND aggregate_id = $1`,
      [secondary!.id],
    )).resolves.toMatchObject({ rows: [{ count: 2 }] });
    await sites.reconcileCollections({
      workspaceId: DEFAULT_WORKSPACE_ID,
      activeCollectionIds: [],
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T15:23:00.000Z",
    });
    await expect(sites.get(secondary!.id, DEFAULT_WORKSPACE_ID)).resolves.toMatchObject({
      collectionIds: [],
    });
  });
});
