import type { Pool } from "pg";
import {
  applyAuthorizationContractMigration,
  applyAuthorizationMigration,
  applyAuthorizationAuditRetentionMigration,
  applyAuthorizationResourceQuarantineMigration,
  applyAuthorizationStorageFinalization,
} from "./authorization-migration.js";
import { qualifiedName, quoteIdentifier, validateDatabaseSchema } from "./identifiers.js";
import { applyM2SchemaRegistryMigration } from "./m2-migration.js";
import { applyRelationMigration } from "./relation-migration.js";
import { applyMediaMigration } from "./media-migration.js";
import {
  CONTENT_HIERARCHY_MIGRATION_ID,
  applyContentHierarchyMigration,
} from "./hierarchy-migration.js";
import {
  IDENTITY_REALM_MIGRATION_ID,
  applyIdentityRealmMigration,
} from "./identity-realm-migration.js";
import { EVENT_WORKER_MIGRATION_ID, applyEventWorkerMigration } from "./event-worker-migration.js";
import { USER_IDENTITY_MIGRATION_ID, applyUserIdentityMigration } from "./user-identity-migration.js";
import { SITE_SETTINGS_MIGRATION_ID, applySiteSettingsMigration } from "./site-settings-migration.js";
import { AUDIT_RETENTION_MIGRATION_ID, applyAuditRetentionMigration } from "./audit-retention-migration.js";
import { PLUGIN_PLATFORM_MIGRATION_ID, applyPluginPlatformMigration } from "./plugin-migration.js";
import {
  OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID,
  applyOwnerDelegationReconciliationMigration,
} from "./owner-delegation-migration.js";
import {
  ADMIN_APP_STORE_MIGRATION_ID,
  applyAdminAppStoreMigration,
} from "./admin-app-migration.js";

export const DEFAULT_WORKSPACE_ID = "wrk_default";
export const DEFAULT_WORKSPACE_NAME = "Default Workspace";
export const SYSTEM_REALM_ID = "rlm_system";
export const CORE_MIGRATION_IDS = Object.freeze([
  "0001_m1_core","0002_schema_draft_version","0003_document_lifecycle_events",
  "0004_m3_authorization","0005_m3_authorization_contract",
  "0006_m3_authorization_storage_finalization","0007_m3_authorization_audit_retention",
  "0008_m2_schema_registry","0009_m2_relations","0010_m2_media",
  CONTENT_HIERARCHY_MIGRATION_ID,"0012_m3_authorization_resource_quarantine",
  IDENTITY_REALM_MIGRATION_ID,EVENT_WORKER_MIGRATION_ID,USER_IDENTITY_MIGRATION_ID,
  SITE_SETTINGS_MIGRATION_ID,AUDIT_RETENTION_MIGRATION_ID,PLUGIN_PLATFORM_MIGRATION_ID,
  OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID,
  ADMIN_APP_STORE_MIGRATION_ID,
] as const);

export async function migrateCore(pool: Pool, rawSchema: string): Promise<void> {
  const schema = validateDatabaseSchema(rawSchema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`xecms:migrate:${schema}`]);

    const migrations = qualifiedName(schema, "_xecms_core_migrations");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${migrations} (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL
      )
    `);
    const existing = await client.query<{ id: string }>(`SELECT id FROM ${migrations} WHERE id = $1`, [
      "0001_m1_core",
    ]);
    if (existing.rowCount === 0) {
      await applyInitialMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0001_m1_core",
      ]);
    }
    const draftVersionMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0002_schema_draft_version"],
    );
    if (draftVersionMigration.rowCount === 0) {
      await client.query(`
        ALTER TABLE ${qualifiedName(schema, "_xecms_schema_drafts")}
          ADD COLUMN IF NOT EXISTS draft_version text;
        UPDATE ${qualifiedName(schema, "_xecms_schema_drafts")}
          SET draft_version = 'drf_legacy_' || md5(random()::text || clock_timestamp()::text)
          WHERE draft_version IS NULL;
        ALTER TABLE ${qualifiedName(schema, "_xecms_schema_drafts")}
          ALTER COLUMN draft_version SET NOT NULL
      `);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0002_schema_draft_version",
      ]);
    }
    const documentEventMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0003_document_lifecycle_events"],
    );
    if (documentEventMigration.rowCount === 0) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${qualifiedName(schema, "_xecms_document_events")} (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          document_id text NOT NULL,
          event_type text NOT NULL,
          aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
          actor_id text NOT NULL,
          occurred_at timestamptz NOT NULL,
          payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
        );
        CREATE INDEX IF NOT EXISTS _xecms_document_events_document
          ON ${qualifiedName(schema, "_xecms_document_events")}
          (document_id, aggregate_version DESC, id DESC);
        CREATE INDEX IF NOT EXISTS _xecms_document_events_type_time
          ON ${qualifiedName(schema, "_xecms_document_events")}
          (event_type, occurred_at DESC)
      `);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0003_document_lifecycle_events",
      ]);
    }
    const authorizationMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0004_m3_authorization"],
    );
    if (authorizationMigration.rowCount === 0) {
      await applyAuthorizationMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0004_m3_authorization",
      ]);
    }
    const authorizationContractMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0005_m3_authorization_contract"],
    );
    if (authorizationContractMigration.rowCount === 0) {
      await applyAuthorizationContractMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0005_m3_authorization_contract",
      ]);
    }
    const authorizationFinalization = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0006_m3_authorization_storage_finalization"],
    );
    if (authorizationFinalization.rowCount === 0) {
      await applyAuthorizationStorageFinalization(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0006_m3_authorization_storage_finalization",
      ]);
    }
    const authorizationAuditRetention = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0007_m3_authorization_audit_retention"],
    );
    if (authorizationAuditRetention.rowCount === 0) {
      await applyAuthorizationAuditRetentionMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0007_m3_authorization_audit_retention",
      ]);
    }
    const m2SchemaRegistry = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0008_m2_schema_registry"],
    );
    if (m2SchemaRegistry.rowCount === 0) {
      await applyM2SchemaRegistryMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0008_m2_schema_registry",
      ]);
    }
    const relationMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0009_m2_relations"],
    );
    if (relationMigration.rowCount === 0) {
      await applyRelationMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0009_m2_relations",
      ]);
    }
    const mediaMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0010_m2_media"],
    );
    if (mediaMigration.rowCount === 0) {
      await applyMediaMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0010_m2_media",
      ]);
    }
    const hierarchyMigration = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      [CONTENT_HIERARCHY_MIGRATION_ID],
    );
    if (hierarchyMigration.rowCount === 0) {
      await applyContentHierarchyMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        CONTENT_HIERARCHY_MIGRATION_ID,
      ]);
    }
    const authorizationResourceQuarantine = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      ["0012_m3_authorization_resource_quarantine"],
    );
    if (authorizationResourceQuarantine.rowCount === 0) {
      await applyAuthorizationResourceQuarantineMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        "0012_m3_authorization_resource_quarantine",
      ]);
    }
    const identityRealms = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      [IDENTITY_REALM_MIGRATION_ID],
    );
    if (identityRealms.rowCount === 0) {
      await applyIdentityRealmMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        IDENTITY_REALM_MIGRATION_ID,
      ]);
    }
    const eventWorker = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      [EVENT_WORKER_MIGRATION_ID],
    );
    if (eventWorker.rowCount === 0) {
      await applyEventWorkerMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        EVENT_WORKER_MIGRATION_ID,
      ]);
    }
    const userIdentity = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      [USER_IDENTITY_MIGRATION_ID],
    );
    if (userIdentity.rowCount === 0) {
      await applyUserIdentityMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        USER_IDENTITY_MIGRATION_ID,
      ]);
    }
    const siteSettings = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`, [SITE_SETTINGS_MIGRATION_ID],
    );
    if (siteSettings.rowCount === 0) {
      await applySiteSettingsMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        SITE_SETTINGS_MIGRATION_ID,
      ]);
    }
    const auditRetention = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`, [AUDIT_RETENTION_MIGRATION_ID],
    );
    if (auditRetention.rowCount === 0) {
      await applyAuditRetentionMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        AUDIT_RETENTION_MIGRATION_ID,
      ]);
    }
    const pluginPlatform = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`, [PLUGIN_PLATFORM_MIGRATION_ID],
    );
    if (pluginPlatform.rowCount === 0) {
      await applyPluginPlatformMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        PLUGIN_PLATFORM_MIGRATION_ID,
      ]);
    }
    const ownerDelegationReconciliation = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      [OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID],
    );
    if (ownerDelegationReconciliation.rowCount === 0) {
      await applyOwnerDelegationReconciliationMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID,
      ]);
    }
    const adminAppStore = await client.query<{ id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`, [ADMIN_APP_STORE_MIGRATION_ID],
    );
    if (adminAppStore.rowCount === 0) {
      await applyAdminAppStoreMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        ADMIN_APP_STORE_MIGRATION_ID,
      ]);
    }
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function applyInitialMigration(
  client: { query(query: string, values?: readonly unknown[]): Promise<unknown> },
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE ${q("_xecms_workspaces")} (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE ${q("_xecms_realms")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id),
      kind text NOT NULL CHECK (kind IN ('system')),
      name text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE ${q("_xecms_identities")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id),
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id),
      username text NOT NULL,
      normalized_username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      is_owner boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      disabled_at timestamptz
    );
    CREATE UNIQUE INDEX _xecms_single_owner ON ${q("_xecms_identities")} (workspace_id)
      WHERE is_owner = true;
    CREATE TABLE ${q("_xecms_sessions")} (
      token_hash text PRIMARY KEY,
      csrf_token_hash text NOT NULL,
      identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX _xecms_sessions_expiry ON ${q("_xecms_sessions")} (expires_at);
    CREATE TABLE ${q("_xecms_audit_log")} (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_type text NOT NULL,
      identity_id text,
      username text,
      occurred_at timestamptz NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE ${q("_xecms_schema_object_ids")} (
      object_id text PRIMARY KEY,
      object_kind text NOT NULL CHECK (object_kind IN ('collection', 'field')),
      state text NOT NULL CHECK (state IN ('issued', 'active', 'retired')),
      issued_at timestamptz NOT NULL,
      issued_by text NOT NULL,
      activated_revision_id text,
      retired_revision_id text,
      retired_at timestamptz
    );
    CREATE TABLE ${q("_xecms_schema_revisions")} (
      revision_id text PRIMARY KEY,
      parent_revision_id text REFERENCES ${q("_xecms_schema_revisions")}(revision_id),
      schema_json jsonb NOT NULL,
      diff_json jsonb NOT NULL,
      hash text NOT NULL,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL
    );
    CREATE TABLE ${q("_xecms_schema_state")} (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      active_revision_id text REFERENCES ${q("_xecms_schema_revisions")}(revision_id)
    );
    INSERT INTO ${q("_xecms_schema_state")} (singleton, active_revision_id) VALUES (true, NULL);
    CREATE TABLE ${q("_xecms_schema_drafts")} (
      workspace_id text PRIMARY KEY REFERENCES ${q("_xecms_workspaces")}(id),
      base_revision_id text REFERENCES ${q("_xecms_schema_revisions")}(revision_id),
      draft_version text NOT NULL,
      schema_json jsonb NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL
    );
    CREATE TABLE ${q("_xecms_migration_runs")} (
      migration_id text PRIMARY KEY,
      target_revision_id text NOT NULL,
      base_revision_id text,
      status text NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
      operations_json jsonb NOT NULL,
      started_at timestamptz NOT NULL,
      completed_at timestamptz,
      applied_by text NOT NULL,
      error_code text
    );
    CREATE TABLE ${q("_xecms_documents")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id),
      collection_id text NOT NULL,
      current_draft_revision_id text,
      publication jsonb,
      lifecycle jsonb NOT NULL,
      deletion jsonb,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      aggregate_version bigint NOT NULL CHECK (aggregate_version > 0)
    );
    CREATE INDEX _xecms_documents_collection ON ${q("_xecms_documents")} (collection_id, updated_at DESC)
      WHERE deletion IS NULL;
    CREATE TABLE ${q("_xecms_document_revisions")} (
      id text PRIMARY KEY,
      document_id text NOT NULL REFERENCES ${q("_xecms_documents")}(id) ON DELETE CASCADE,
      sequence integer NOT NULL CHECK (sequence > 0),
      schema_revision_id text NOT NULL REFERENCES ${q("_xecms_schema_revisions")}(revision_id),
      data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
      parent_revision_id text,
      origin jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      UNIQUE (document_id, sequence)
    );
    ALTER TABLE ${q("_xecms_documents")}
      ADD CONSTRAINT _xecms_draft_revision_fk FOREIGN KEY (current_draft_revision_id)
      REFERENCES ${q("_xecms_document_revisions")}(id) DEFERRABLE INITIALLY DEFERRED;
  `);
  await client.query(
    `INSERT INTO ${q("_xecms_workspaces")} (id, name, created_at) VALUES ($1, $2, now())`,
    [DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME],
  );
  await client.query(
    `INSERT INTO ${q("_xecms_realms")} (id, workspace_id, kind, name, created_at)
     VALUES ($1, $2, 'system', 'System Realm', now())`,
    [SYSTEM_REALM_ID, DEFAULT_WORKSPACE_ID],
  );
}
