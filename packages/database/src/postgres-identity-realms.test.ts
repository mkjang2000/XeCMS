import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyIdentityRealmMigration, IDENTITY_REALM_MIGRATION_ID } from "./identity-realm-migration.js";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, migrateCore } from "./migrate.js";
import { PostgresIdentityRealmStore } from "./postgres-identity-realms.js";
import { PostgresDatabase } from "./postgres.js";

describe("PostgresIdentityRealmStore validation", () => {
  it("rejects an unsafe PostgreSQL schema before issuing a query", () => {
    expect(() => new PostgresIdentityRealmStore({} as Pool, "public; drop schema public")).toThrow();
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("M4 Identity Realm PostgreSQL migration and store", () => {
  const schema = `xecms_identity_realm_${randomUUID().replaceAll("-", "_")}`;
  const legacySchema = `xecms_identity_legacy_${randomUUID().replaceAll("-", "_")}`;
  const bootstrapSchema = `xecms_identity_bootstrap_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  const store = new PostgresIdentityRealmStore(pool, schema);
  const q = (name: string): string => qualifiedName(schema, name);
  const legacyQ = (name: string): string => qualifiedName(legacySchema, name);
  const ownerIdentityId = "usr_identity_realm_owner";
  const ownerSubjectId = "subject_identity_realm_owner";
  const now = "2026-07-15T09:00:00.000Z";

  beforeAll(async () => {
    await migrateCore(pool, schema);
    // Re-running core migration is the supported idempotency path.
    await migrateCore(pool, schema);
    await pool.query(
      `INSERT INTO ${q("_xecms_identities")}
         (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
          password_hash, is_owner, credential_version, created_at)
       VALUES ($1, $2, $3, $3, 'realm-owner', 'realm-owner', 'hash-owner', true, 1, $4)`,
      [ownerIdentityId, DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, now],
    );
    await pool.query(
      `INSERT INTO ${q("_xecms_identity_identifiers")}
         (id, workspace_id, identity_id, identifier_kind, normalized_value,
          display_value, verified_at, created_at, created_by)
       VALUES ('identifier_realm_owner', $1, $2, 'username', 'realm-owner',
               'realm-owner', $3, $3, $2)`,
      [DEFAULT_WORKSPACE_ID, ownerIdentityId, now],
    );
    await pool.query(
      `INSERT INTO ${q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, identity_id, protected,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, 'user', 'Realm owner', $3, true, $4, $3, $4, $3)`,
      [ownerSubjectId, SYSTEM_REALM_ID, ownerIdentityId, now],
    );
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(legacySchema)} CASCADE`);
    await pool.end();
  });

  it("installs 0013 once and keeps the System Realm compatible", async () => {
    const migration = await pool.query(
      `SELECT id FROM ${q("_xecms_core_migrations")} WHERE id = $1`,
      [IDENTITY_REALM_MIGRATION_ID],
    );
    expect(migration.rowCount).toBe(1);
    expect(await store.getRealmById(SYSTEM_REALM_ID)).toMatchObject({
      id: SYSTEM_REALM_ID,
      key: "system",
      kind: "system",
      status: "active",
      revision: 1,
    });
    await expect(store.findIdentityCredentialByIdentifier(
      DEFAULT_WORKSPACE_ID,
      "realm-owner",
    )).resolves.toMatchObject({ id: ownerIdentityId, credentialVersion: 1 });
  });

  it("creates the initial System owner as a resolvable Global Identity", async () => {
    const database = new PostgresDatabase({
      connectionString: DATABASE_URL,
      schema: bootstrapSchema,
      maxConnections: 2,
    });
    try {
      await database.migrate();
      await database.createInitialOwner({
        id: "usr_bootstrap_owner",
        username: "BootstrapAdmin",
        passwordHash: "hash-bootstrap",
        now,
      });
      const bootstrapStore = new PostgresIdentityRealmStore(database.pool, bootstrapSchema);
      await expect(bootstrapStore.findIdentityCredentialByIdentifier(
        DEFAULT_WORKSPACE_ID,
        "bootstrapadmin",
      )).resolves.toMatchObject({
        id: "usr_bootstrap_owner",
        primaryIdentifier: "BootstrapAdmin",
        originRealmId: SYSTEM_REALM_ID,
        credentialVersion: 1,
      });
      const bootstrapQ = (name: string): string => qualifiedName(bootstrapSchema, name);
      await database.pool.query(
        `INSERT INTO ${bootstrapQ("_xecms_auth_subjects")}
           (id, realm_id, subject_type, display_name, identity_id, protected,
            created_at, created_by, updated_at, updated_by)
         VALUES ('subject_bootstrap_owner', $1, 'user', 'Bootstrap owner', $2, true,
                 $3, $2, $3, $2)`,
        [SYSTEM_REALM_ID, "usr_bootstrap_owner", now],
      );
      await database.createSession({
        sessionTokenHash: "bootstrap_session_hash",
        csrfTokenHash: "bootstrap_csrf_hash",
        identityId: "usr_bootstrap_owner",
        createdAt: now,
        expiresAt: "2026-07-16T09:00:00.000Z",
      });
      await expect(database.findSession(
        "bootstrap_session_hash",
        "2026-07-15T09:01:00.000Z",
      )).resolves.toMatchObject({ identity: { id: "usr_bootstrap_owner" } });
      await database.pool.query(
        `UPDATE ${bootstrapQ("_xecms_identities")}
         SET credential_version = credential_version + 1 WHERE id = 'usr_bootstrap_owner'`,
      );
      await expect(database.findSession(
        "bootstrap_session_hash",
        "2026-07-15T09:02:00.000Z",
      )).resolves.toBeNull();
    } finally {
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(bootstrapSchema)} CASCADE`);
      await database.close();
    }
  });

  it("creates and CAS-updates a separate Content Realm", async () => {
    const created = await store.createRealm({
      id: "rlm_community",
      workspaceId: DEFAULT_WORKSPACE_ID,
      key: "community",
      name: "Community",
      authentication: {
        acceptSystemIdentities: true,
        provisioning: "jit",
        registration: "open",
        defaultRoleIds: [],
      },
      actorIdentityId: ownerIdentityId,
      now,
    });
    expect(created).toMatchObject({ kind: "content", status: "provisioning", revision: 1 });
    const active = await store.updateRealm({
      realmId: created.id,
      expectedRevision: 1,
      name: created.name,
      status: "active",
      authentication: created.authentication,
      actorIdentityId: ownerIdentityId,
      now: "2026-07-15T09:01:00.000Z",
    });
    expect(active).toMatchObject({ status: "active", revision: 2 });
    await expect(store.updateRealm({
      realmId: created.id,
      expectedRevision: 1,
      name: "Stale",
      status: "active",
      authentication: created.authentication,
      actorIdentityId: ownerIdentityId,
      now: "2026-07-15T09:02:00.000Z",
    })).rejects.toMatchObject({ code: "IDENTITY_REALM_REVISION_CONFLICT", status: 409 });
    await expect(store.getRealmByKey(DEFAULT_WORKSPACE_ID, "community"))
      .resolves.toMatchObject({ id: created.id, revision: 2 });
  });

  it("enforces Membership uniqueness and cross-Realm Subject integrity", async () => {
    const identity = await store.createIdentity({
      id: "usr_community_member",
      workspaceId: DEFAULT_WORKSPACE_ID,
      originRealmId: "rlm_community",
      primaryIdentifier: "member@example.test",
      normalizedIdentifier: "member@example.test",
      passwordHash: "hash-member",
      actorId: ownerIdentityId,
      now,
    });
    await pool.query(
      `INSERT INTO ${q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, protected,
          created_at, created_by, updated_at, updated_by)
       VALUES ('subject_community_member', 'rlm_community', 'user', 'Member', false,
               $1, $2, $1, $2)`,
      [now, ownerIdentityId],
    );
    const membership = await store.createMembership({
      id: "membership_community_member",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: identity.id,
      realmId: "rlm_community",
      subjectId: "subject_community_member",
      status: "active",
      provisionedBy: "signup",
      actorIdentityId: ownerIdentityId,
      now,
    });
    expect(membership).toMatchObject({ status: "active", provisionedBy: "signup", revision: 1 });
    await expect(store.createMembership({
      id: "membership_community_duplicate",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: identity.id,
      realmId: "rlm_community",
      subjectId: "subject_community_member",
      status: "active",
      provisionedBy: "explicit",
      actorIdentityId: ownerIdentityId,
      now,
    })).rejects.toMatchObject({ code: "REALM_MEMBERSHIP_CONFLICT", status: 409 });

    const secondRealm = await store.createRealm({
      id: "rlm_partner",
      workspaceId: DEFAULT_WORKSPACE_ID,
      key: "partner",
      name: "Partner",
      authentication: {
        acceptSystemIdentities: false,
        provisioning: "explicit",
        registration: "closed",
        defaultRoleIds: [],
      },
      actorIdentityId: ownerIdentityId,
      now,
    });
    await expect(store.createMembership({
      id: "membership_cross_realm",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: identity.id,
      realmId: secondRealm.id,
      subjectId: "subject_community_member",
      status: "active",
      provisionedBy: "explicit",
      actorIdentityId: ownerIdentityId,
      now,
    })).rejects.toMatchObject({ code: "MEMBERSHIP_SUBJECT_LINK_INVALID", status: 409 });
  });

  it("provisions pending Memberships idempotently and activates a unique profile with CAS", async () => {
    const identity = await store.createGlobalIdentity({
      id: "usr_provisioned_member",
      workspaceId: DEFAULT_WORKSPACE_ID,
      originRealmId: "rlm_community",
      normalizedIdentifier: "provisioned@example.test",
      displayIdentifier: "Provisioned@example.test",
      passwordHash: "hash-provisioned",
      now,
    });
    await expect(store.createGlobalIdentity({
      id: "usr_duplicate_retry",
      workspaceId: DEFAULT_WORKSPACE_ID,
      originRealmId: "rlm_community",
      normalizedIdentifier: "provisioned@example.test",
      displayIdentifier: "Provisioned@example.test",
      passwordHash: "unused-retry-hash",
      now,
    })).rejects.toMatchObject({ code: "IDENTITY_IDENTIFIER_CONFLICT", status: 409 });
    await pool.query(
      `INSERT INTO ${q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, protected,
          created_at, created_by, updated_at, updated_by)
       VALUES ('subject_provisioned_member', 'rlm_community', 'user', 'Provisioned', false,
               $1, $2, $1, $2)`,
      [now, ownerIdentityId],
    );
    const pending = await store.createPendingMembership({
      id: "membership_provisioned_member",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: identity.id,
      realmId: "rlm_community",
      subjectId: "subject_provisioned_member",
      provisionedBy: "jit",
      createdByIdentityId: identity.id,
      now,
    });
    expect(pending).toMatchObject({ status: "pending", revision: 1 });
    await expect(store.createPendingMembership({
      id: "membership_ignored_retry",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: identity.id,
      realmId: "rlm_community",
      subjectId: "subject_provisioned_member",
      provisionedBy: "jit",
      createdByIdentityId: identity.id,
      now,
    })).resolves.toMatchObject({ id: pending.id, status: "pending" });
    await expect(store.createPendingMembership({
      id: "membership_subject_mismatch",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: identity.id,
      realmId: "rlm_community",
      subjectId: "some_other_subject",
      provisionedBy: "jit",
      createdByIdentityId: identity.id,
      now,
    })).rejects.toMatchObject({ code: "REALM_MEMBERSHIP_SUBJECT_CONFLICT", status: 409 });

    await store.upsertAuthCollectionConfig({
      collectionId: "col_community_profiles",
      realmId: "rlm_community",
      identifierFieldIds: ["field_email"],
      status: "active",
      actorId: ownerIdentityId,
      now,
    });
    await pool.query(
      `INSERT INTO ${q("_xecms_documents")}
         (id, workspace_id, collection_id, current_draft_revision_id, publication,
          lifecycle, deletion, created_at, created_by, updated_at, updated_by, aggregate_version)
       VALUES ('doc_provisioned_profile', $1, 'col_community_profiles', NULL, NULL,
               '{}'::jsonb, NULL, $2, $3, $2, $3, 1)`,
      [DEFAULT_WORKSPACE_ID, now, identity.id],
    );
    const active = await store.activateMembership({
      membershipId: pending.id,
      expectedRevision: pending.revision,
      profileCollectionId: "col_community_profiles",
      profileDocumentId: "doc_provisioned_profile",
      actorIdentityId: identity.id,
      now: "2026-07-15T09:00:30.000Z",
    });
    expect(active).toMatchObject({
      status: "active",
      revision: 2,
      profileCollectionId: "col_community_profiles",
      profileDocumentId: "doc_provisioned_profile",
    });
    await expect(store.activateMembership({
      membershipId: pending.id,
      expectedRevision: 1,
      profileCollectionId: "col_community_profiles",
      profileDocumentId: "doc_provisioned_profile",
      actorIdentityId: identity.id,
      now,
    })).rejects.toMatchObject({ code: "REALM_MEMBERSHIP_REVISION_CONFLICT", status: 409 });

    const secondIdentity = await store.createGlobalIdentity({
      id: "usr_second_profile",
      workspaceId: DEFAULT_WORKSPACE_ID,
      originRealmId: "rlm_community",
      normalizedIdentifier: "second-profile@example.test",
      displayIdentifier: "second-profile@example.test",
      passwordHash: "hash-second-profile",
      now,
    });
    await pool.query(
      `INSERT INTO ${q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, protected,
          created_at, created_by, updated_at, updated_by)
       VALUES ('subject_second_profile', 'rlm_community', 'user', 'Second profile', false,
               $1, $2, $1, $2)`,
      [now, ownerIdentityId],
    );
    const secondPending = await store.createPendingMembership({
      id: "membership_second_profile",
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: secondIdentity.id,
      realmId: "rlm_community",
      subjectId: "subject_second_profile",
      provisionedBy: "explicit",
      createdByIdentityId: ownerIdentityId,
      now,
    });
    await expect(store.activateMembership({
      membershipId: secondPending.id,
      expectedRevision: secondPending.revision,
      profileCollectionId: "col_community_profiles",
      profileDocumentId: "doc_provisioned_profile",
      actorIdentityId: ownerIdentityId,
      now,
    })).rejects.toMatchObject({ code: "REALM_MEMBERSHIP_PROFILE_CONFLICT", status: 409 });
  });

  it("resolves only active, credential-current Content sessions and revokes on suspension", async () => {
    await store.createContentSession({
      tokenHash: "content_token_hash",
      csrfTokenHash: "content_csrf_hash",
      identityId: "usr_community_member",
      realmId: "rlm_community",
      membershipId: "membership_community_member",
      subjectId: "subject_community_member",
      credentialVersion: 1,
      authenticatedAt: "2026-07-15T10:00:00.000Z",
      expiresAt: "2026-07-15T18:00:00.000Z",
    });
    await expect(store.findContentSession(
      "content_token_hash",
      "rlm_community",
      "2026-07-15T11:00:00.000Z",
    )).resolves.toMatchObject({
      identity: { id: "usr_community_member" },
      realm: { id: "rlm_community" },
      membership: { id: "membership_community_member" },
    });
    await expect(store.findContentSessionWithCsrf(
      "content_token_hash",
      "content_csrf_hash",
      "rlm_community",
      "2026-07-15T11:00:00.000Z",
    )).resolves.toBe(true);
    const suspended = await store.suspendMembership({
      realmId: "rlm_community",
      membershipId: "membership_community_member",
      expectedRevision: 1,
      actorIdentityId: ownerIdentityId,
      now: "2026-07-15T11:01:00.000Z",
    });
    expect(suspended).toMatchObject({ status: "suspended", revision: 2 });
    await expect(store.findContentSession(
      "content_token_hash",
      "rlm_community",
      "2026-07-15T11:02:00.000Z",
    )).resolves.toBeNull();
    const sessionRows = await pool.query(
      `SELECT 1 FROM ${q("_xecms_sessions")} WHERE token_hash = 'content_token_hash'`,
    );
    expect(sessionRows.rowCount).toBe(0);
    await expect(store.reactivateMembership({
      realmId: "rlm_community",
      membershipId: "membership_community_member",
      expectedRevision: 2,
      actorIdentityId: ownerIdentityId,
      now: "2026-07-15T11:03:00.000Z",
    })).resolves.toMatchObject({ status: "active", revision: 3 });
  });

  it("honors Full Access expiry, uniqueness and revocation", async () => {
    const grant = await store.grantFullAccess({
      id: "full_access_community_member",
      realmId: "rlm_community",
      subjectId: "subject_community_member",
      grantedByIdentityId: ownerIdentityId,
      grantedBySubjectId: ownerSubjectId,
      reason: "Acceptance recovery grant",
      createdAt: "2026-07-15T12:00:00.000Z",
      validUntil: "2026-07-15T13:00:00.000Z",
    });
    expect(grant.revokedAt).toBeUndefined();
    await expect(store.hasActiveFullAccess(
      "rlm_community",
      "subject_community_member",
      "2026-07-15T12:59:59.000Z",
    )).resolves.toBe(true);
    await expect(store.hasActiveFullAccess(
      "rlm_community",
      "subject_community_member",
      "2026-07-15T13:00:00.000Z",
    )).resolves.toBe(false);
    await expect(store.grantFullAccess({
      ...grant,
      id: "full_access_duplicate",
      createdAt: "2026-07-15T12:01:00.000Z",
      validUntil: "2026-07-15T14:00:00.000Z",
    })).rejects.toMatchObject({ code: "FULL_ACCESS_ALREADY_GRANTED", status: 409 });
    const revoked = await store.revokeFullAccess({
      realmId: grant.realmId,
      bindingId: grant.id,
      actorIdentityId: ownerIdentityId,
      now: "2026-07-15T12:30:00.000Z",
    });
    expect(revoked).toMatchObject({ revokedByIdentityId: ownerIdentityId });
    await store.grantFullAccess({
      id: "full_access_short_lived",
      realmId: "rlm_community",
      subjectId: "subject_community_member",
      grantedByIdentityId: ownerIdentityId,
      grantedBySubjectId: ownerSubjectId,
      reason: "Short recovery window",
      createdAt: "2026-07-15T12:31:00.000Z",
      validUntil: "2026-07-15T12:40:00.000Z",
    });
    await expect(store.grantFullAccess({
      id: "full_access_after_expiry",
      realmId: "rlm_community",
      subjectId: "subject_community_member",
      grantedByIdentityId: ownerIdentityId,
      grantedBySubjectId: ownerSubjectId,
      reason: "Renewed recovery window",
      createdAt: "2026-07-15T12:41:00.000Z",
      validUntil: "2026-07-15T13:41:00.000Z",
    })).resolves.toMatchObject({ id: "full_access_after_expiry" });
    const expired = await pool.query<{ revoked_at: Date | string | null }>(
      `SELECT revoked_at FROM ${q("_xecms_realm_full_access_bindings")}
       WHERE id = 'full_access_short_lived'`,
    );
    expect(new Date(expired.rows[0]!.revoked_at!).toISOString())
      .toBe("2026-07-15T12:41:00.000Z");
  });

  it("upgrades legacy complete sessions and deletes incomplete principals fail-closed", async () => {
    await pool.query(`CREATE SCHEMA ${quoteIdentifier(legacySchema)}`);
    await pool.query(`
      CREATE TABLE ${legacyQ("_xecms_workspaces")} (
        id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE TABLE ${legacyQ("_xecms_realms")} (
        id text PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES ${legacyQ("_xecms_workspaces")}(id),
        kind text NOT NULL CONSTRAINT _xecms_realms_kind_check CHECK (kind IN ('system')),
        name text NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE ${legacyQ("_xecms_identities")} (
        id text PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES ${legacyQ("_xecms_workspaces")}(id),
        realm_id text NOT NULL REFERENCES ${legacyQ("_xecms_realms")}(id),
        username text NOT NULL,
        normalized_username text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        is_owner boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        disabled_at timestamptz
      );
      CREATE TABLE ${legacyQ("_xecms_sessions")} (
        token_hash text PRIMARY KEY,
        csrf_token_hash text NOT NULL,
        identity_id text NOT NULL REFERENCES ${legacyQ("_xecms_identities")}(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE ${legacyQ("_xecms_audit_log")} (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event_type text NOT NULL, identity_id text, username text,
        occurred_at timestamptz NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE ${legacyQ("_xecms_schema_revisions")} (revision_id text PRIMARY KEY);
      CREATE TABLE ${legacyQ("_xecms_documents")} (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        collection_id text NOT NULL,
        UNIQUE (workspace_id, collection_id, id)
      );
      CREATE TABLE ${legacyQ("_xecms_auth_subjects")} (
        id text PRIMARY KEY,
        realm_id text NOT NULL REFERENCES ${legacyQ("_xecms_realms")}(id),
        subject_type text NOT NULL,
        display_name text NOT NULL,
        identity_id text REFERENCES ${legacyQ("_xecms_identities")}(id),
        protected boolean NOT NULL DEFAULT false,
        disabled_at timestamptz,
        created_at timestamptz NOT NULL,
        created_by text,
        updated_at timestamptz NOT NULL,
        updated_by text,
        UNIQUE (realm_id, id)
      );
      CREATE UNIQUE INDEX _xecms_auth_subject_identity_realm
        ON ${legacyQ("_xecms_auth_subjects")}(realm_id, identity_id)
        WHERE identity_id IS NOT NULL;
    `);
    await pool.query(
      `INSERT INTO ${legacyQ("_xecms_workspaces")} VALUES ('wrk_default', 'Legacy', $1)`,
      [now],
    );
    await pool.query(
      `INSERT INTO ${legacyQ("_xecms_realms")} VALUES ('rlm_system', 'wrk_default', 'system', 'System', $1)`,
      [now],
    );
    await pool.query(`
      INSERT INTO ${legacyQ("_xecms_identities")}
        (id, workspace_id, realm_id, username, normalized_username, password_hash, is_owner, created_at)
      VALUES
        ('usr_complete', 'wrk_default', 'rlm_system', 'complete', 'complete', 'hash', true, $1),
        ('usr_incomplete', 'wrk_default', 'rlm_system', 'incomplete', 'incomplete', 'hash', false, $1)
    `, [now]);
    await pool.query(`
      INSERT INTO ${legacyQ("_xecms_auth_subjects")}
        (id, realm_id, subject_type, display_name, identity_id, protected, created_at, updated_at)
      VALUES ('subject_complete', 'rlm_system', 'user', 'Complete', 'usr_complete', true, $1, $1)
    `, [now]);
    await pool.query(`
      INSERT INTO ${legacyQ("_xecms_sessions")}
        (token_hash, csrf_token_hash, identity_id, created_at, expires_at)
      VALUES
        ('legacy_complete', 'csrf_complete', 'usr_complete', $1, '2027-07-15T00:00:00Z'),
        ('legacy_incomplete', 'csrf_incomplete', 'usr_incomplete', $1, '2027-07-15T00:00:00Z')
    `, [now]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyIdentityRealmMigration(client, legacySchema);
      await applyIdentityRealmMigration(client, legacySchema);
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const sessions = await pool.query<{ token_hash: string; audience: string; subject_id: string }>(
      `SELECT token_hash, audience, subject_id FROM ${legacyQ("_xecms_sessions")} ORDER BY token_hash`,
    );
    expect(sessions.rows).toEqual([
      { token_hash: "legacy_complete", audience: "admin", subject_id: "subject_complete" },
    ]);
    const membership = await pool.query<{ identity_id: string; realm_id: string; status: string }>(
      `SELECT identity_id, realm_id, status FROM ${legacyQ("_xecms_realm_memberships")}`,
    );
    expect(membership.rows).toEqual([
      { identity_id: "usr_complete", realm_id: "rlm_system", status: "active" },
    ]);
  });
});
