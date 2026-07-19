import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const AUTHORIZATION_CONTROL_PLANE_AUDIT_MIGRATION_ID =
  "0023_m4_authorization_control_plane_audit";

/** Adds explicit System actor provenance without fabricating a Realm Subject. */
export async function applyAuthorizationControlPlaneAuditMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    ALTER TABLE ${q("_xecms_auth_policy_revisions")}
      ADD COLUMN IF NOT EXISTS actor_identity_id text,
      ADD COLUMN IF NOT EXISTS access_mode text,
      ADD COLUMN IF NOT EXISTS full_access_binding_id text;
    ALTER TABLE ${q("_xecms_auth_audit_log")}
      ADD COLUMN IF NOT EXISTS actor_identity_id text,
      ADD COLUMN IF NOT EXISTS access_mode text,
      ADD COLUMN IF NOT EXISTS full_access_binding_id text;

    ALTER TABLE ${q("_xecms_auth_policy_revisions")}
      DROP CONSTRAINT IF EXISTS _xecms_auth_policy_revisions_access_mode_check,
      ADD CONSTRAINT _xecms_auth_policy_revisions_access_mode_check
        CHECK (access_mode IS NULL OR access_mode IN (
          'realm-actor', 'cms-owner-readonly', 'realm-full-access',
          'cms-owner-control-plane', 'system-provisioner'
        )),
      DROP CONSTRAINT IF EXISTS _xecms_auth_policy_revisions_actor_check,
      DROP CONSTRAINT IF EXISTS _xecms_auth_policy_revisions_full_access_check,
      ADD CONSTRAINT _xecms_auth_policy_revisions_full_access_check
        CHECK (
          (access_mode = 'realm-full-access' AND full_access_binding_id IS NOT NULL)
          OR (access_mode IS DISTINCT FROM 'realm-full-access' AND full_access_binding_id IS NULL)
        );

    ALTER TABLE ${q("_xecms_auth_audit_log")}
      DROP CONSTRAINT IF EXISTS _xecms_auth_audit_log_access_mode_check,
      ADD CONSTRAINT _xecms_auth_audit_log_access_mode_check
        CHECK (access_mode IS NULL OR access_mode IN (
          'realm-actor', 'cms-owner-readonly', 'realm-full-access',
          'cms-owner-control-plane', 'system-provisioner'
        )),
      DROP CONSTRAINT IF EXISTS _xecms_auth_audit_log_actor_check,
      DROP CONSTRAINT IF EXISTS _xecms_auth_audit_log_full_access_check,
      ADD CONSTRAINT _xecms_auth_audit_log_full_access_check
        CHECK (
          (access_mode = 'realm-full-access' AND full_access_binding_id IS NOT NULL)
          OR (access_mode IS DISTINCT FROM 'realm-full-access' AND full_access_binding_id IS NULL)
        );

    CREATE INDEX IF NOT EXISTS _xecms_auth_audit_actor_identity
      ON ${q("_xecms_auth_audit_log")}(actor_identity_id, occurred_at DESC, id DESC)
      WHERE actor_identity_id IS NOT NULL;
  `);
}
