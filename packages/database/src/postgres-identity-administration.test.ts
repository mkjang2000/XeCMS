import { createHash, randomUUID } from "node:crypto";

import { AuthorizationApplicationService } from "@xecms/application";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, SYSTEM_REALM_ID } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresRealmCollectionEntitlementStore } from "./postgres-realm-collection-entitlements.js";
import { PostgresIdentityAdministrationStore } from "./postgres-identity-administration.js";
import { PostgresIdentityRealmStore } from "./postgres-identity-realms.js";
import { PostgresDatabase } from "./postgres.js";
import { applyUserIdentityMigration, USER_IDENTITY_MIGRATION_ID } from "./user-identity-migration.js";

describe("PostgresIdentityAdministrationStore validation", () => {
  it("rejects an unsafe schema and invalid pagination without querying", async () => {
    expect(() => new PostgresIdentityAdministrationStore({} as Pool, "public; drop schema public"))
      .toThrow();
    const store = new PostgresIdentityAdministrationStore({} as Pool, "xecms");
    await expect(store.list({ workspaceId: DEFAULT_WORKSPACE_ID, limit: 0 }))
      .rejects.toMatchObject({ code: "IDENTITY_PAGE_INVALID" });
    await expect(store.listSessions({
      identityId: "usr_test", workspaceId: DEFAULT_WORKSPACE_ID, status: "active",
      page: 0, pageSize: 10, now: "2026-07-15T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "SESSION_PAGE_INVALID" });
    await expect(store.listSessions({
      identityId: "usr_test", workspaceId: DEFAULT_WORKSPACE_ID, status: "history",
      page: 1, pageSize: 101, now: "2026-07-15T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "SESSION_PAGE_SIZE_INVALID" });
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("M4-C1 Identity administration PostgreSQL transaction", () => {
  const schema = `xecms_identity_admin_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 4 });
  const store = new PostgresIdentityAdministrationStore(database.pool, schema);
  const authorizationStore = new PostgresAuthorizationStore(database.pool, schema);
  const identityRealmStore = new PostgresIdentityRealmStore(database.pool, schema);
  const authorization = new AuthorizationApplicationService(authorizationStore, {
    now: () => "2026-07-15T11:00:00.000Z",
    newAuditId: () => `audit_${randomUUID()}`,
    newId: (prefix) => `${prefix}_${randomUUID()}`,
  }, new PostgresRealmCollectionEntitlementStore(database.pool, schema));
  const ownerId = "usr_c1_owner";
  const targetId = "usr_c1_target";
  const q = (name: string) => qualifiedName(schema, name);

  beforeAll(async () => {
    await database.migrate();
    await database.createInitialOwner({
      id: ownerId,
      username: "c1.owner",
      passwordHash: "hash-owner",
      now: "2026-07-15T11:00:00.000Z",
    });
    await authorization.initialize({
      realmId: SYSTEM_REALM_ID,
      realmName: "System Realm",
      rootResourceId: "resource:workspace",
      rootResourceName: DEFAULT_WORKSPACE_NAME,
      ownerSubjectId: ownerId,
      ownerIdentityId: ownerId,
      ownerSubjectName: "c1.owner",
    });
  });

  afterAll(async () => {
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await database.close();
  });

  it("installs and idempotently reapplies migration 0015", async () => {
    await expect(database.pool.query(
      `SELECT id FROM ${q("_xecms_core_migrations")} WHERE id = $1`,
      [USER_IDENTITY_MIGRATION_ID],
    )).resolves.toMatchObject({ rowCount: 1 });
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await applyUserIdentityMigration(client, schema);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await expect(database.pool.query(
      `SELECT permission_key FROM ${q("_xecms_auth_permissions")}
        WHERE permission_key IN ('identity.owner.transfer', 'service-account.create')`,
    )).resolves.toMatchObject({ rowCount: 2 });
  });

  it("creates, lists, CAS-renames, disables, and reactivates a human Identity", async () => {
    const created = await store.createHuman({
      id: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      primaryIdentifier: "C1.Target",
      normalizedIdentifier: "c1.target",
      passwordHash: "hash-target",
      passwordChangeRequired: true,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T11:01:00.000Z",
      auditId: "audit_c1_create",
    });
    expect(created).toMatchObject({
      id: targetId,
      primaryIdentifier: "C1.Target",
      revision: 1,
      status: "active",
      passwordChangeRequired: true,
    });
    expect(created.memberships).toEqual([expect.objectContaining({
      realmId: SYSTEM_REALM_ID,
      subjectId: targetId,
      status: "active",
    })]);
    await expect(store.list({ workspaceId: DEFAULT_WORKSPACE_ID, limit: 1, query: "target" }))
      .resolves.toMatchObject({ items: [expect.objectContaining({ id: targetId })] });

    const renamed = await store.updateIdentifier({
      identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 1,
      primaryIdentifier: "C1.Renamed",
      normalizedIdentifier: "c1.renamed",
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T11:02:00.000Z",
      auditId: "audit_c1_rename",
    });
    expect(renamed).toMatchObject({ primaryIdentifier: "C1.Renamed", revision: 2 });
    await expect(store.updateIdentifier({
      identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 1,
      primaryIdentifier: "stale.name",
      normalizedIdentifier: "stale.name",
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T11:03:00.000Z",
      auditId: "audit_c1_stale",
    })).rejects.toMatchObject({ code: "IDENTITY_REVISION_CONFLICT", status: 409 });

    await database.createSession({
      sessionTokenHash: "c1_target_session_hash",
      csrfTokenHash: "c1_target_csrf_hash",
      identityId: targetId,
      createdAt: "2026-07-15T11:03:00.000Z",
      expiresAt: "2026-07-16T11:03:00.000Z",
    });
    const disabled = await store.setDisabled({
      identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 2,
      disabled: true,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T11:04:00.000Z",
      auditId: "audit_c1_disable",
    });
    expect(disabled).toMatchObject({ status: "disabled", revision: 3, credentialVersion: 2 });
    await expect(database.findSession("c1_target_session_hash", "2026-07-15T11:05:00.000Z"))
      .resolves.toBeNull();
    await expect(database.pool.query(
      `SELECT revoked_at, revoke_reason FROM ${q("_xecms_sessions")} WHERE identity_id = $1`,
      [targetId],
    )).resolves.toMatchObject({
      rows: [expect.objectContaining({ revoke_reason: "identity-disabled" })],
    });

    await expect(store.setDisabled({
      identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 3,
      disabled: false,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T11:06:00.000Z",
      auditId: "audit_c1_reactivate",
    })).resolves.toMatchObject({ status: "active", revision: 4, credentialVersion: 2 });
  });

  it("manages sessions, resets credentials, and transfers the protected Owner atomically", async () => {
    await database.createSession({
      sessionTokenHash: "c1_managed_session_one",
      csrfTokenHash: "c1_managed_csrf_one",
      identityId: targetId,
      createdAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-16T12:00:00.000Z",
    });
    await database.createSession({
      sessionTokenHash: "c1_managed_session_two",
      csrfTokenHash: "c1_managed_csrf_two",
      identityId: targetId,
      createdAt: "2026-07-15T12:01:00.000Z",
      expiresAt: "2026-07-16T12:01:00.000Z",
    });
    const firstSessionId = `session_${createHash("md5").update("c1_managed_session_one").digest("hex")}`;
    const sessions = await store.listSessions({
      identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      currentSessionId: firstSessionId,
      status: "all",
      page: 1,
      pageSize: 50,
      now: "2026-07-15T12:01:30.000Z",
    });
    expect(sessions.items).toHaveLength(3);
    expect(sessions.total).toBe(3);
    expect(sessions.items.find(({ id }) => id === firstSessionId)).toMatchObject({ current: true, audience: "admin" });
    const second = sessions.items.find(({ id }) => id !== firstSessionId && !id.includes("target_session"));
    expect(second).toBeDefined();
    const activePage = await store.listSessions({
      identityId: targetId, workspaceId: DEFAULT_WORKSPACE_ID, status: "active",
      page: 1, pageSize: 1, now: "2026-07-15T12:01:30.000Z",
    });
    expect(activePage).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(activePage.items).toHaveLength(1);
    expect(activePage.items[0]?.revokedAt).toBeUndefined();
    await expect(store.revokeSession({
      sessionId: second!.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      actorIdentityId: ownerId,
      now: "2026-07-15T12:02:00.000Z",
    })).resolves.toMatchObject({ revokeReason: "administrator-revoked" });

    const reset = await store.resetPassword({
      identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: 4,
      passwordHash: "hash-reset-target",
      revokeApiKeys: true,
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T12:03:00.000Z",
      auditId: "audit_c1_reset",
    });
    expect(reset).toMatchObject({ revision: 5, credentialVersion: 3, passwordChangeRequired: true });
    expect((await store.listSessions({
      identityId: targetId, workspaceId: DEFAULT_WORKSPACE_ID, status: "all",
      page: 1, pageSize: 50, now: "2026-07-15T12:03:00.000Z",
    })).items.every(({ revokedAt }) => revokedAt !== undefined)).toBe(true);
    await expect(store.listSessions({
      identityId: targetId, workspaceId: DEFAULT_WORKSPACE_ID, status: "active",
      page: 1, pageSize: 10, now: "2026-07-15T12:03:00.000Z",
    })).resolves.toMatchObject({ items: [], total: 0 });
    await expect(store.listSessions({
      identityId: targetId, workspaceId: DEFAULT_WORKSPACE_ID, status: "history",
      page: 1, pageSize: 2, now: "2026-07-15T12:03:00.000Z",
    })).resolves.toMatchObject({ page: 1, pageSize: 2, total: 3 });

    await database.createSession({
      sessionTokenHash: "c1_owner_transfer_owner_session",
      csrfTokenHash: "c1_owner_transfer_owner_csrf",
      identityId: ownerId,
      createdAt: "2026-07-15T12:04:00.000Z",
      expiresAt: "2026-07-16T12:04:00.000Z",
    });
    const transferred = await store.transferOwner({
      workspaceId: DEFAULT_WORKSPACE_ID,
      targetIdentityId: targetId,
      reason: "Scheduled Workspace ownership handover",
      actorIdentityId: ownerId,
      actorSubjectId: ownerId,
      now: "2026-07-15T12:05:00.000Z",
      auditId: "audit_c1_owner_transfer",
    });
    expect(transferred).toMatchObject({ id: targetId, isOwner: true, revision: 6, credentialVersion: 4 });
    await expect(database.findOwnerIdentity()).resolves.toMatchObject({ id: targetId, isOwner: true });
    await expect(database.findSession(
      "c1_owner_transfer_owner_session",
      "2026-07-15T12:06:00.000Z",
    )).resolves.toBeNull();
    await expect(database.pool.query(
      `SELECT subject_id FROM ${q("_xecms_auth_role_bindings")}
        WHERE role_id = 'authorization:' || $1 || ':role:owner' AND protected = true`,
      [SYSTEM_REALM_ID],
    )).resolves.toMatchObject({ rows: [expect.objectContaining({ subject_id: targetId })] });
  });

  it("creates a non-interactive Service Identity and stores only API key digests", async () => {
    const serviceId = "svc_c1_search";
    const service = await store.createService({
      id: serviceId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      primaryIdentifier: "search.indexer",
      normalizedIdentifier: "search.indexer",
      actorIdentityId: targetId,
      actorSubjectId: targetId,
      now: "2026-07-15T13:00:00.000Z",
      auditId: "audit_c1_service_create",
    });
    expect(service).toMatchObject({
      id: serviceId, kind: "service", passwordChangeRequired: false, status: "active",
    });
    expect(service.memberships).toEqual([expect.objectContaining({
      realmId: SYSTEM_REALM_ID, subjectId: serviceId, status: "active",
    })]);

    const created = await store.createApiKey({
      id: "key_c1_search",
      identityId: serviceId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: "Search projection",
      prefix: "c1searchprefix",
      digest: "peppered-digest-only",
      scopes: ["content.list", "content.read"],
      expiresAt: "2026-07-20T13:00:00.000Z",
      actorIdentityId: targetId,
      actorSubjectId: targetId,
      now: "2026-07-15T13:01:00.000Z",
    });
    expect(created).toMatchObject({
      id: "key_c1_search", prefix: "c1searchprefix", scopes: ["content.list", "content.read"],
    });
    const rawRow = await database.pool.query<{ key_digest: string }>(
      `SELECT key_digest FROM ${q("_xecms_api_keys")} WHERE id = 'key_c1_search'`,
    );
    expect(rawRow.rows[0]?.key_digest).toBe("peppered-digest-only");
    await expect(store.authenticateApiKey({
      prefix: "c1searchprefix", digest: "peppered-digest-only", now: "2026-07-15T13:02:00.000Z",
    })).resolves.toMatchObject({
      apiKeyId: "key_c1_search", identityId: serviceId, subjectId: serviceId,
      scopes: ["content.list", "content.read"],
    });
    await expect(store.authenticateApiKey({
      prefix: "c1searchprefix", digest: "wrong-digest", now: "2026-07-15T13:02:00.000Z",
    })).resolves.toBeNull();
    await expect(store.revokeApiKey({
      apiKeyId: "key_c1_search", workspaceId: DEFAULT_WORKSPACE_ID,
      actorIdentityId: targetId, now: "2026-07-15T13:03:00.000Z",
    })).resolves.toMatchObject({ revokedAt: "2026-07-15T13:03:00.000Z" });
    await expect(store.authenticateApiKey({
      prefix: "c1searchprefix", digest: "peppered-digest-only", now: "2026-07-15T13:04:00.000Z",
    })).resolves.toBeNull();
  });

  it("issues one-time credential tokens, consumes them atomically, and provisions System Membership explicitly", async () => {
    await store.createCredentialToken({
      id: "credential_c1_invitation", identityId: targetId,
      workspaceId: DEFAULT_WORKSPACE_ID, expectedRevision: 6, purpose: "invitation",
      digest: "sha256-invitation-only", actorIdentityId: targetId, actorSubjectId: targetId,
      now: "2026-07-15T14:00:00.000Z", expiresAt: "2026-07-16T14:00:00.000Z",
      auditId: "audit_c1_invitation",
    });
    await expect(store.resolveCredentialToken({
      purpose: "invitation", digest: "sha256-invitation-only", now: "2026-07-15T14:01:00.000Z",
    })).resolves.toMatchObject({ identityId: targetId, purpose: "invitation" });
    await expect(database.pool.query(
      `SELECT token_digest FROM ${q("_xecms_credential_tokens")} WHERE id = 'credential_c1_invitation'`,
    )).resolves.toMatchObject({ rows: [{ token_digest: "sha256-invitation-only" }] });
    await store.consumeCredentialToken({
      purpose: "invitation", digest: "sha256-invitation-only", identityId: targetId,
      passwordHash: "hash-invitation-completed", now: "2026-07-15T14:02:00.000Z",
    });
    await expect(store.resolveCredentialToken({
      purpose: "invitation", digest: "sha256-invitation-only", now: "2026-07-15T14:03:00.000Z",
    })).resolves.toBeNull();
    await expect(store.consumeCredentialToken({
      purpose: "invitation", digest: "sha256-invitation-only", identityId: targetId,
      passwordHash: "hash-replay", now: "2026-07-15T14:03:00.000Z",
    })).rejects.toMatchObject({ code: "CREDENTIAL_TOKEN_INVALID" });
    await expect(store.get(targetId, DEFAULT_WORKSPACE_ID)).resolves.toMatchObject({
      revision: 8, passwordChangeRequired: false,
    });

    const contentOnlyId = "usr_c1_content_only";
    await identityRealmStore.createIdentity({
      id: contentOnlyId, workspaceId: DEFAULT_WORKSPACE_ID, originRealmId: SYSTEM_REALM_ID,
      primaryIdentifier: "content.promoted", normalizedIdentifier: "content.promoted",
      passwordHash: "hash-content", actorId: targetId, now: "2026-07-15T14:04:00.000Z",
    });
    await expect(store.get(contentOnlyId, DEFAULT_WORKSPACE_ID)).resolves.toMatchObject({ memberships: [] });
    const promoted = await store.createSystemMembership({
      identityId: contentOnlyId, workspaceId: DEFAULT_WORKSPACE_ID, expectedRevision: 1,
      actorIdentityId: targetId, actorSubjectId: targetId,
      now: "2026-07-15T14:05:00.000Z", auditId: "audit_c1_promote",
    });
    expect(promoted).toMatchObject({ revision: 2 });
    expect(promoted.memberships).toEqual([expect.objectContaining({
      realmId: SYSTEM_REALM_ID, subjectId: contentOnlyId, status: "active",
    })]);
  });
});
