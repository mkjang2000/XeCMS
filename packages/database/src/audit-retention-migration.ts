import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

export const AUDIT_RETENTION_MIGRATION_ID = "0017_m4c3_audit_retention";

export async function applyAuditRetentionMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_retention_policies")} (
      workspace_id text PRIMARY KEY REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      audit_days integer CHECK (audit_days IS NULL OR audit_days >= 90),
      dispatched_outbox_days integer CHECK (dispatched_outbox_days IS NULL OR dispatched_outbox_days >= 7),
      succeeded_delivery_days integer CHECK (succeeded_delivery_days IS NULL OR succeeded_delivery_days >= 7),
      dead_delivery_days integer CHECK (dead_delivery_days IS NULL OR dead_delivery_days >= 30),
      expired_session_days integer CHECK (expired_session_days IS NULL OR expired_session_days >= 1),
      soft_deleted_document_days integer CHECK (soft_deleted_document_days IS NULL OR soft_deleted_document_days >= 1),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL
    );
    INSERT INTO ${q("_xecms_retention_policies")}
      (workspace_id, audit_days, dispatched_outbox_days, succeeded_delivery_days,
       dead_delivery_days, expired_session_days, soft_deleted_document_days,
       revision, updated_at, updated_by)
      SELECT id, NULL, 30, 30, NULL, 7, NULL, 1, now(), 'system'
        FROM ${q("_xecms_workspaces")}
    ON CONFLICT (workspace_id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS ${q("_xecms_retention_plans")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      policy_revision bigint NOT NULL CHECK (policy_revision > 0),
      status text NOT NULL CHECK (status IN ('previewed', 'applied', 'expired')),
      reference_at timestamptz NOT NULL,
      cutoffs jsonb NOT NULL CHECK (jsonb_typeof(cutoffs) = 'object'),
      counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
      estimated_bytes jsonb NOT NULL CHECK (jsonb_typeof(estimated_bytes) = 'object'),
      digest text NOT NULL,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      expires_at timestamptz NOT NULL,
      applied_at timestamptz,
      applied_by text,
      results jsonb CHECK (results IS NULL OR jsonb_typeof(results) = 'object'),
      CHECK (expires_at > created_at),
      CHECK ((status = 'applied') = (applied_at IS NOT NULL AND applied_by IS NOT NULL AND results IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS _xecms_retention_plans_workspace_time
      ON ${q("_xecms_retention_plans")}(workspace_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS _xecms_retention_plans_expiry
      ON ${q("_xecms_retention_plans")}(expires_at, id) WHERE status = 'previewed';

    CREATE INDEX IF NOT EXISTS _xecms_audit_unified_time
      ON ${q("_xecms_audit_log")}(occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS _xecms_audit_unified_type_time
      ON ${q("_xecms_audit_log")}(event_type, occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS _xecms_document_audit_unified_time
      ON ${q("_xecms_document_events")}(occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS _xecms_auth_audit_unified_time
      ON ${q("_xecms_auth_audit_log")}(occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS _xecms_sessions_retention
      ON ${q("_xecms_sessions")}(expires_at, revoked_at, id);
    CREATE INDEX IF NOT EXISTS _xecms_outbox_retention
      ON ${q("_xecms_outbox_events")}(dispatched_at, occurred_at, id) WHERE dispatched_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS _xecms_deliveries_retention
      ON ${q("_xecms_event_deliveries")}(status, completed_at, id)
      WHERE status IN ('succeeded', 'dead');

    ALTER TABLE ${q("_xecms_outbox_events")}
      DROP CONSTRAINT IF EXISTS _xecms_outbox_events_aggregate_type_check;
    ALTER TABLE ${q("_xecms_outbox_events")}
      ADD CONSTRAINT _xecms_outbox_events_aggregate_type_check
      CHECK (aggregate_type IN ('document', 'identity', 'realm', 'authorization', 'media',
                                'workspace', 'site', 'retention'));

    INSERT INTO ${q("_xecms_auth_permissions")}
      (permission_key, hierarchy_guard, delegatable, protected, created_at)
    VALUES
      ('audit.export', 'none', true, false, now()),
      ('retention.read', 'none', true, false, now()),
      ('retention.update', 'none', true, false, now()),
      ('retention.preview', 'none', true, false, now()),
      ('retention.apply', 'none', true, false, now()),
      ('media.consistency.read', 'none', true, false, now())
    ON CONFLICT (permission_key) DO UPDATE SET
      hierarchy_guard = EXCLUDED.hierarchy_guard,
      delegatable = EXCLUDED.delegatable,
      protected = EXCLUDED.protected;

    INSERT INTO ${q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
      SELECT role.realm_id, role.id, permission.permission_key
        FROM ${q("_xecms_auth_roles")} role
        CROSS JOIN (VALUES ('audit.export'), ('retention.read'), ('retention.update'),
          ('retention.preview'), ('retention.apply'), ('media.consistency.read')) permission(permission_key)
       WHERE role.id IN ('authorization:' || role.realm_id || ':role:owner',
                         'authorization:' || role.realm_id || ':role:administrator')
    ON CONFLICT DO NOTHING;
  `);
}
