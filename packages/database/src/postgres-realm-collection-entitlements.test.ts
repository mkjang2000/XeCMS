import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationApplicationService } from "@xecms/application";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, migrateCore } from "./migrate.js";
import { applyRealmCollectionEntitlementsMigration } from "./realm-collection-entitlements-migration.js";
import { applyRealmAuthEntitlementCleanupMigration } from "./realm-auth-entitlement-cleanup-migration.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresIdentityRealmStore } from "./postgres-identity-realms.js";
import { PostgresRealmCollectionEntitlementStore } from "./postgres-realm-collection-entitlements.js";

describe("PostgresRealmCollectionEntitlementStore validation", () => {
  it("rejects an unsafe PostgreSQL schema", () => {
    expect(() => new PostgresRealmCollectionEntitlementStore({} as Pool, "public; drop")).toThrow();
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("Realm collection entitlement PostgreSQL store", () => {
  const schema = `xecms_ent_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  const realmStore = new PostgresIdentityRealmStore(pool, schema);
  const store = new PostgresRealmCollectionEntitlementStore(pool, schema);
  const q = (name: string): string => qualifiedName(schema, name);
  const now = "2026-07-19T09:00:00.000Z";

  beforeAll(async () => {
    await migrateCore(pool, schema);
    // Re-run to prove idempotency of the 0025 migration.
    await migrateCore(pool, schema);
    await pool.query(
      `INSERT INTO ${q("_xecms_identities")}
         (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
          password_hash, is_owner, credential_version, created_at)
       VALUES ('usr_ent_owner', $1, $2, $2, 'ent-owner', 'ent-owner', 'hash', true, 1, $3)`,
      [DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, now],
    );
    await realmStore.createRealm({
      id: "rlm_community",
      workspaceId: DEFAULT_WORKSPACE_ID,
      key: "community",
      name: "Community",
      authentication: { acceptSystemIdentities: true, provisioning: "jit", registration: "open", defaultRoleIds: [] },
      actorIdentityId: "usr_ent_owner",
      now,
    });
    await store.initRealmEnforcement("rlm_community", DEFAULT_WORKSPACE_ID);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("creates enforcement rows (disabled) and reports version", async () => {
    const enforcement = await store.getEnforcement("rlm_community");
    expect(enforcement).toMatchObject({ realmId: "rlm_community", state: "disabled", version: 0 });
    expect(await store.getEnforcement("rlm_missing")).toBeNull();
  });

  it("puts, updates via CAS, and bumps the realm version", async () => {
    const created = await store.put({
      workspaceId: DEFAULT_WORKSPACE_ID, realmId: "rlm_community", collectionId: "col_posts",
      actions: ["list", "read"], expectedRevision: null, updatedAt: now, updatedBy: "usr_ent_owner",
    });
    expect(created).toMatchObject({ revision: 1, actions: ["list", "read"] });
    expect((await store.getEnforcement("rlm_community"))?.version).toBe(1);

    await expect(store.put({
      workspaceId: DEFAULT_WORKSPACE_ID, realmId: "rlm_community", collectionId: "col_posts",
      actions: ["read"], expectedRevision: 99, updatedAt: now, updatedBy: "usr_ent_owner",
    })).rejects.toMatchObject({ code: "ENTITLEMENT_REVISION_CONFLICT", status: 409 });

    const updated = await store.put({
      workspaceId: DEFAULT_WORKSPACE_ID, realmId: "rlm_community", collectionId: "col_posts",
      actions: ["list", "read", "update"], expectedRevision: 1, updatedAt: now, updatedBy: "usr_ent_owner",
    });
    expect(updated).toMatchObject({ revision: 2, actions: ["list", "read", "update"] });
    expect((await store.getEnforcement("rlm_community"))?.version).toBe(2);
  });

  it("enforces writable ⊆ readable (no blind writes)", async () => {
    await expect(store.put({
      workspaceId: DEFAULT_WORKSPACE_ID, realmId: "rlm_community", collectionId: "col_fields",
      actions: ["read", "update"], readableFields: ["a"], writableFields: ["a", "b"],
      expectedRevision: null, updatedAt: now, updatedBy: "usr_ent_owner",
    })).rejects.toMatchObject({ code: "ENTITLEMENT_FIELD_INVALID", status: 422 });

    // undefined readable = all fields → any writable subset is allowed.
    const ok = await store.put({
      workspaceId: DEFAULT_WORKSPACE_ID, realmId: "rlm_community", collectionId: "col_fields",
      actions: ["read", "update"], writableFields: ["a", "b"],
      expectedRevision: null, updatedAt: now, updatedBy: "usr_ent_owner",
    });
    expect(ok.readableFields).toBeUndefined();
    expect(ok.writableFields).toEqual(["a", "b"]);
  });

  it("rejects entitlements whose workspace does not match the realm", async () => {
    await expect(store.put({
      workspaceId: "wrk_other", realmId: "rlm_community", collectionId: "col_ws",
      actions: ["read"], expectedRevision: null, updatedAt: now, updatedBy: "usr_ent_owner",
    })).rejects.toMatchObject({ code: "ENTITLEMENT_REALM_INVALID", status: 409 });
  });

  it("persists constraints and lists by realm and by collection", async () => {
    await store.put({
      workspaceId: DEFAULT_WORKSPACE_ID, realmId: "rlm_community", collectionId: "col_owned",
      actions: ["read"], constraint: { ownerOnly: true, statuses: ["published"] },
      expectedRevision: null, updatedAt: now, updatedBy: "usr_ent_owner",
    });
    const byRealm = await store.listByRealm("rlm_community");
    const owned = byRealm.find((e) => e.collectionId === "col_owned");
    expect(owned?.constraint).toEqual({ ownerOnly: true, statuses: ["published"] });

    const byCollection = await store.listByCollection(DEFAULT_WORKSPACE_ID, "col_posts");
    expect(byCollection.map((e) => e.realmId)).toContain("rlm_community");
  });

  it("removes via CAS and distinguishes not-found from conflict", async () => {
    await expect(store.remove({ realmId: "rlm_community", collectionId: "col_absent", expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "ENTITLEMENT_NOT_FOUND", status: 404 });

    await expect(store.remove({ realmId: "rlm_community", collectionId: "col_posts", expectedRevision: 99 }))
      .rejects.toMatchObject({ code: "ENTITLEMENT_REVISION_CONFLICT", status: 409 });

    await store.remove({ realmId: "rlm_community", collectionId: "col_posts", expectedRevision: 2 });
    expect((await store.listByRealm("rlm_community")).some((e) => e.collectionId === "col_posts")).toBe(false);
  });
});

describe.runIf(RUN)("0025 access-preserving migration", () => {
  const schema = `xecms_ent_preserve_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  const realmStore = new PostgresIdentityRealmStore(pool, schema);
  const authStore = new PostgresAuthorizationStore(pool, schema);
  const entStore = new PostgresRealmCollectionEntitlementStore(pool, schema);
  let auth: AuthorizationApplicationService;
  const now = "2026-07-19T09:00:00.000Z";
  const REALM = "rlm_preserve";
  const AUTH_REALM = "rlm_auth_owner";
  const OWNER_SUBJECT = "subject:preserve-owner";

  beforeAll(async () => {
    await migrateCore(pool, schema);
    auth = new AuthorizationApplicationService(
      authStore,
      { now: () => now, newAuditId: () => `audit_${randomUUID()}`, newId: (p: string) => `${p}_${randomUUID()}` },
      entStore,
    );
    await pool.query(
      `INSERT INTO ${qualifiedName(schema, "_xecms_identities")}
         (id, workspace_id, realm_id, origin_realm_id, username, normalized_username, password_hash, is_owner, credential_version, created_at)
       VALUES ('usr_preserve', $1, $2, $2, 'preserve', 'preserve', 'hash', true, 1, $3)`,
      [DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, now],
    );
    await realmStore.createRealm({
      id: REALM, workspaceId: DEFAULT_WORKSPACE_ID, key: "preserve", name: "Preserve",
      authentication: { acceptSystemIdentities: true, provisioning: "jit", registration: "open", defaultRoleIds: [] },
      actorIdentityId: "usr_preserve", now,
    });
    // Initialize the realm's policy: the owner subject receives the Owner role
    // bound to the ROOT resource with self-and-children (the real shape).
    await auth.initialize({
      realmId: REALM, realmName: "Preserve",
      rootResourceId: `authorization:${REALM}:resource:workspace`, rootResourceName: "Preserve workspace",
      ownerSubjectId: OWNER_SUBJECT, ownerSubjectName: "Preserve owner",
    });
    const ownerActor = { realmId: REALM, subjectId: OWNER_SUBJECT };
    const revision = (await auth.getPolicy(ownerActor)).revision;
    // Project a "posts" collection resource (child of content root).
    await auth.syncCoreResources(ownerActor, {
      expectedRevision: revision,
      collections: [
        { id: "posts", name: "Posts" },
        { id: "foreign_auth", name: "Foreign Auth" },
      ],
    });
    await realmStore.createRealm({
      id: AUTH_REALM, workspaceId: DEFAULT_WORKSPACE_ID, key: "auth-owner", name: "Auth Owner",
      authentication: { acceptSystemIdentities: true, provisioning: "jit", registration: "open", defaultRoleIds: [] },
      actorIdentityId: "usr_preserve", now,
    });
    await pool.query(
      `INSERT INTO ${qualifiedName(schema, "_xecms_auth_collection_configs")}
         (collection_id, realm_id, identifier_field_ids, status,
          created_at, created_by, updated_at, updated_by)
       VALUES ('foreign_auth', $1, ARRAY['identifier'], 'active', $2, 'usr_preserve', $2, 'usr_preserve')`,
      [AUTH_REALM, now],
    );
    // Re-run the 0025 apply to trigger preservation now that the realm has a
    // root binding propagating content.* into the "posts" collection.
    await applyRealmCollectionEntitlementsMigration(pool, schema);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("creates a full-allow entitlement from the root owner binding via propagation", async () => {
    const entitlements = await entStore.listByRealm(REALM);
    const posts = entitlements.find((e) => e.collectionId === "posts");
    expect(posts).toBeDefined();
    // Owner role grants the full content action set; preservation should capture it.
    expect(posts?.actions).toEqual(
      expect.arrayContaining(["list", "read", "create", "update", "delete"]),
    );
    expect(posts?.readableFields).toBeUndefined(); // all fields
    expect(posts?.constraint).toBeUndefined(); // no conditions
  });

  it("never seeds an entitlement for an Auth Collection", async () => {
    const entitlements = await entStore.listByRealm(REALM);
    expect(entitlements.some(({ collectionId }) => collectionId === "foreign_auth")).toBe(false);
  });

  it("flips the realm to enforced", async () => {
    expect(await entStore.getEnforcement(REALM)).toMatchObject({ state: "enforced" });
  });

  it("keeps the owner's collection access working after the gate turns on", async () => {
    const ownerActor = { realmId: REALM, subjectId: OWNER_SUBJECT };
    const posts = `authorization:${REALM}:resource:collection:posts`;
    // Enforced + preserved ceiling → owner still allowed (no access lost).
    await expect(auth.authorize(ownerActor, { action: "content.read", resourceId: posts }))
      .resolves.toMatchObject({ allowed: true });
    await expect(auth.authorize(ownerActor, { action: "content.update", resourceId: posts }))
      .resolves.toMatchObject({ allowed: true });
  });

  it("seeds only collections explicitly introduced by a later Schema apply", async () => {
    const ownerActor = { realmId: REALM, subjectId: OWNER_SUBJECT };
    const revision = (await auth.getPolicy(ownerActor)).revision;
    await auth.syncCoreResources(ownerActor, {
      expectedRevision: revision,
      collections: [
        { id: "posts", name: "Posts" },
        { id: "foreign_auth", name: "Foreign Auth" },
        { id: "new_articles", name: "New Articles" },
      ],
    });

    await entStore.reconcileRealmFromPolicy(REALM, DEFAULT_WORKSPACE_ID, ["new_articles"]);
    const entitlements = await entStore.listByRealm(REALM);
    expect(entitlements.find(({ collectionId }) => collectionId === "new_articles")?.actions)
      .toEqual(expect.arrayContaining(["list", "read", "create", "update"]));
    expect(entitlements.some(({ collectionId }) => collectionId === "foreign_auth")).toBe(false);
  });

  it("cleans historical Auth rows and does not resurrect explicit CMS denials", async () => {
    const q = (name: string): string => qualifiedName(schema, name);
    await pool.query(
      `INSERT INTO ${q("_xecms_realm_collection_entitlements")}
         (workspace_id, realm_id, collection_id, actions, revision, updated_at, updated_by)
       VALUES ($1, $2, 'foreign_auth', ARRAY['read'], 1, $3, 'system:legacy')`,
      [DEFAULT_WORKSPACE_ID, REALM, now],
    );
    const versionBefore = (await entStore.getEnforcement(REALM))!.version;
    await applyRealmAuthEntitlementCleanupMigration(pool, schema);
    expect((await entStore.listByRealm(REALM)).some(({ collectionId }) => collectionId === "foreign_auth"))
      .toBe(false);
    expect((await entStore.getEnforcement(REALM))!.version).toBe(versionBefore + 1);

    // Reconciliation also removes rows inserted by an old/direct writer.
    await pool.query(
      `INSERT INTO ${q("_xecms_realm_collection_entitlements")}
         (workspace_id, realm_id, collection_id, actions, revision, updated_at, updated_by)
       VALUES ($1, $2, 'foreign_auth', ARRAY['read'], 1, $3, 'system:legacy')`,
      [DEFAULT_WORKSPACE_ID, REALM, now],
    );
    await entStore.reconcileRealmFromPolicy(REALM, DEFAULT_WORKSPACE_ID);
    expect((await entStore.listByRealm(REALM)).some(({ collectionId }) => collectionId === "foreign_auth"))
      .toBe(false);

    const posts = (await entStore.listByRealm(REALM)).find(({ collectionId }) => collectionId === "posts")!;
    await entStore.remove({ realmId: REALM, collectionId: "posts", expectedRevision: posts.revision });
    await entStore.reconcileRealmFromPolicy(REALM, DEFAULT_WORKSPACE_ID);
    await entStore.reconcileRealmFromPolicy(REALM, DEFAULT_WORKSPACE_ID);
    expect((await entStore.listByRealm(REALM)).some(({ collectionId }) => collectionId === "posts"))
      .toBe(false);
  });
});
