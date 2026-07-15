import { randomUUID } from "node:crypto";
import {
  AuthorizationApplicationService,
  RetentionService,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  UnifiedAuditService,
} from "@xecms/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAuditRetentionMigration, AUDIT_RETENTION_MIGRATION_ID } from "./audit-retention-migration.js";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, SYSTEM_REALM_ID } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresRetentionStore } from "./postgres-retention.js";
import { PostgresUnifiedAuditStore } from "./postgres-unified-audit.js";
import { PostgresDatabase } from "./postgres.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"] ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("M4-C3 unified Audit and retention PostgreSQL gates", () => {
  const schema = `xecms_audit_retention_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 4 });
  const ownerId = "usr_c3_owner";
  const now = "2026-07-15T15:00:00.000Z";
  let planSequence = 0;
  const audit = new UnifiedAuditService(new PostgresUnifiedAuditStore(database.pool, schema));
  const retentionStore = new PostgresRetentionStore(database.pool, schema);
  const retention = new RetentionService(retentionStore,
    { now: () => now, newPlanId: () => `retention_test_${++planSequence}` });
  const authorization = new AuthorizationApplicationService(
    new PostgresAuthorizationStore(database.pool, schema),
    { now: () => now, newAuditId: () => `audit_${randomUUID()}`,
      newId: (prefix) => `${prefix}_${randomUUID()}` },
  );
  const q = (name: string) => qualifiedName(schema, name);

  beforeAll(async () => {
    await database.migrate();
    await database.createInitialOwner({ id: ownerId, username: "c3.owner", passwordHash: "hash", now });
    await authorization.initialize({ realmId: SYSTEM_REALM_ID, realmName: "System Realm",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID, rootResourceName: DEFAULT_WORKSPACE_NAME,
      ownerSubjectId: ownerId, ownerIdentityId: ownerId, ownerSubjectName: "c3.owner" });
    await database.pool.query(
      `INSERT INTO ${q("_xecms_realm_memberships")}
         (id,workspace_id,identity_id,realm_id,subject_id,status,provisioned_by,revision,
          created_at,created_by,activated_at,updated_at,updated_by)
       VALUES ('membership_c3_owner',$1,$2,$3,$2,'active','explicit',1,$4,$2,$4,$4,$2)`,
      [DEFAULT_WORKSPACE_ID, ownerId, SYSTEM_REALM_ID, now],
    );
    await seed();
  });
  afterAll(async () => {
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await database.close();
  });

  it("installs 0017 idempotently and normalizes sources with cursor and recursive redaction", async () => {
    await expect(database.pool.query(
      `SELECT id FROM ${q("_xecms_core_migrations")} WHERE id = $1`, [AUDIT_RETENTION_MIGRATION_ID],
    )).resolves.toMatchObject({ rowCount: 1 });
    const client = await database.pool.connect();
    try { await client.query("BEGIN"); await applyAuditRetentionMigration(client, schema); await client.query("COMMIT"); }
    finally { client.release(); }

    const first = await audit.list({ workspaceId: DEFAULT_WORKSPACE_ID, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const second = await audit.list({ workspaceId: DEFAULT_WORKSPACE_ID, limit: 20,
      cursor: first.nextCursor! });
    expect([...new Set([...first.items, ...second.items].map((entry) => entry.source))]).toEqual(
      expect.arrayContaining(["system", "document", "authorization", "delivery"]),
    );
    const secret = [...first.items, ...second.items].find((entry) => entry.action === "login.failed");
    expect(secret?.metadata).toMatchObject({ password: "[REDACTED]", nested: { api_key: "[REDACTED]" } });
    expect(JSON.stringify([...first.items, ...second.items])).not.toContain("fixture-secret");
    const onlyDead = await audit.list({ workspaceId: DEFAULT_WORKSPACE_ID,
      source: "delivery", outcome: "failed", limit: 20 });
    expect(onlyDead.items).toHaveLength(1);
    expect(await audit.get(DEFAULT_WORKSPACE_ID, onlyDead.items[0]!.id)).toMatchObject({ source: "delivery" });
  });

  it("rejects stale previews, then atomically applies exact targets and preserves protected state", async () => {
    const initial = await retention.getPolicy(DEFAULT_WORKSPACE_ID);
    const policy = await retention.updatePolicy({ workspaceId: DEFAULT_WORKSPACE_ID,
      expectedRevision: initial.revision, auditDays: 90, dispatchedOutboxDays: 7,
      succeededDeliveryDays: 7, deadDeliveryDays: 30, expiredSessionDays: 1,
      softDeletedDocumentDays: 1, actorIdentityId: ownerId, actorSubjectId: ownerId });
    const stalePlan = await retention.preview({ workspaceId: DEFAULT_WORKSPACE_ID,
      expectedPolicyRevision: policy.revision, actorIdentityId: ownerId });
    await insertExpiredSession("session_stale", "stale-token");
    await expect(retention.apply({ workspaceId: DEFAULT_WORKSPACE_ID, planId: stalePlan.id,
      expectedPolicyRevision: policy.revision, actorIdentityId: ownerId, actorSubjectId: ownerId }))
      .rejects.toMatchObject({ code: "RETENTION_PLAN_STALE", status: 409 });
    await expect(database.pool.query(
      `SELECT 1 FROM ${q("_xecms_sessions")} WHERE id = 'session_old'`,
    )).resolves.toMatchObject({ rowCount: 1 });

    const plan = await retention.preview({ workspaceId: DEFAULT_WORKSPACE_ID,
      expectedPolicyRevision: policy.revision, actorIdentityId: ownerId });
    expect(plan.counts).toMatchObject({ systemAudit: 1, documentAudit: 1,
      dispatchedOutbox: 1, succeededDeliveries: 1, deadDeliveries: 1,
      expiredSessions: 2, softDeletedDocuments: 1 });
    const applied = await retention.apply({ workspaceId: DEFAULT_WORKSPACE_ID, planId: plan.id,
      expectedPolicyRevision: policy.revision, actorIdentityId: ownerId, actorSubjectId: ownerId });
    expect(applied).toMatchObject({ status: "applied", results: {
      systemAudit: 1, documentAudit: 1, dispatchedOutbox: 1,
      succeededDeliveries: 1, deadDeliveries: 1, expiredSessions: 2,
      softDeletedDocuments: 0,
    } });
    await expect(retention.apply({ workspaceId: DEFAULT_WORKSPACE_ID, planId: plan.id,
      expectedPolicyRevision: policy.revision, actorIdentityId: ownerId, actorSubjectId: ownerId }))
      .resolves.toMatchObject({ id: plan.id, status: "applied" });
    const preserved = await database.pool.query<{ id: string }>(
      `SELECT id FROM ${q("_xecms_outbox_events")} WHERE id IN ('evt_pending','evt_undispatched') ORDER BY id`,
    );
    expect(preserved.rows.map(({ id }) => id)).toEqual(["evt_pending", "evt_undispatched"]);
    await expect(database.pool.query(
      `SELECT 1 FROM ${q("_xecms_documents")} WHERE id = 'doc_soft_deleted'`,
    )).resolves.toMatchObject({ rowCount: 1 });
    await expect(database.pool.query(
      `SELECT topic FROM ${q("_xecms_outbox_events")} WHERE topic = 'retention.plan.applied'`,
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  async function insertExpiredSession(id: string, token: string): Promise<void> {
    await database.pool.query(
      `INSERT INTO ${q("_xecms_sessions")}
         (token_hash, csrf_token_hash, identity_id, created_at, expires_at, id, audience,
          realm_id, membership_id, subject_id, authenticated_at, credential_version)
       SELECT $1, $2, identity.id, '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z',
              $4, 'admin', membership.realm_id, membership.id, membership.subject_id,
              '2025-01-01T00:00:00.000Z', identity.credential_version
         FROM ${q("_xecms_identities")} identity
         JOIN ${q("_xecms_realm_memberships")} membership ON membership.identity_id = identity.id
        WHERE identity.id = $3 AND membership.realm_id = $5`,
      [token, `${token}-csrf`, ownerId, id, SYSTEM_REALM_ID],
    );
  }
  async function seed(): Promise<void> {
    await database.pool.query(
      `INSERT INTO ${q("_xecms_audit_log")}(event_type, identity_id, occurred_at, metadata)
       VALUES ('login.failed', $1, '2025-01-01T00:00:00.000Z', $2::jsonb),
              ('site.updated', $1, '2026-07-15T14:55:00.000Z', $3::jsonb)`,
      [ownerId, JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, password: "fixture-secret",
        nested: { api_key: "fixture-secret" } }),
        JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, siteId: "site_demo" })],
    );
    const document = await database.pool.query<{ id: string }>(
      `INSERT INTO ${q("_xecms_document_events")}
         (document_id, event_type, aggregate_version, actor_id, occurred_at, payload)
       VALUES ('doc_purged', 'document.deleted', 1, $1, '2025-01-01T00:00:00.000Z', '{}'::jsonb)
       RETURNING id::text`, [ownerId],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id, aggregate_version,
          actor_subject_id, actor_identity_id, occurred_at, payload, created_at, dispatched_at)
       VALUES
         ($1, $2, $3, 'document.deleted', 'document', 'doc_purged', 1, $4, $4,
          '2025-01-01T00:00:00.000Z', '{"collectionId":"posts"}'::jsonb,
          '2025-01-01T00:00:00.000Z', NULL),
         ('evt_orphan', $2, $3, 'media.created', 'media', 'media_old', 1, $4, $4,
          '2025-01-01T00:00:00.000Z', '{}'::jsonb, '2025-01-01T00:00:00.000Z',
          '2025-01-01T00:01:00.000Z'),
         ('evt_succeeded', $2, $3, 'media.created', 'media', 'media_succeeded', 1, $4, $4,
          '2025-01-01T00:00:00.000Z', '{}'::jsonb, '2025-01-01T00:00:00.000Z',
          '2025-01-01T00:01:00.000Z'),
         ('evt_dead', $2, $3, 'media.created', 'media', 'media_dead', 1, $4, $4,
          '2025-01-01T00:00:00.000Z', '{}'::jsonb, '2025-01-01T00:00:00.000Z',
          '2025-01-01T00:01:00.000Z'),
         ('evt_pending', $2, $3, 'media.created', 'media', 'media_pending', 1, $4, $4,
          '2025-01-01T00:00:00.000Z', '{}'::jsonb, '2025-01-01T00:00:00.000Z',
          '2025-01-01T00:01:00.000Z'),
         ('evt_undispatched', $2, $3, 'media.created', 'media', 'media_undispatched', 1, $4, $4,
          '2025-01-01T00:00:00.000Z', '{}'::jsonb, '2025-01-01T00:00:00.000Z', NULL)`,
      [`outbox_document_${document.rows[0]!.id}`, DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, ownerId],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_event_deliveries")}
         (id,event_id,handler_id,status,attempts,max_attempts,available_at,last_error_code,
          last_error_message,created_at,updated_at,completed_at)
       VALUES
         ('delivery_succeeded','evt_succeeded','test','succeeded',1,8,'2025-01-01',NULL,NULL,'2025-01-01','2025-01-01','2025-01-02'),
         ('delivery_dead','evt_dead','test','dead',8,8,'2025-01-01','FIXTURE','bad error','2025-01-01','2025-01-01','2025-01-02'),
         ('delivery_pending','evt_pending','test','pending',0,8,'2025-01-01',NULL,NULL,'2025-01-01','2025-01-01',NULL)`,
    );
    await insertExpiredSession("session_old", "old-token");
    await database.pool.query(
      `INSERT INTO ${q("_xecms_documents")}
         (id,workspace_id,collection_id,current_draft_revision_id,publication,lifecycle,deletion,
          created_at,created_by,updated_at,updated_by,aggregate_version)
       VALUES ('doc_soft_deleted',$1,'posts',NULL,NULL,'{"state":"draft"}'::jsonb,
         '{"deletedAt":"2025-01-01T00:00:00.000Z"}'::jsonb,'2025-01-01',$2,'2025-01-01',$2,1)`,
      [DEFAULT_WORKSPACE_ID, ownerId],
    );
  }
});
