import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const REALM_FULL_ACCESS_LIFECYCLE_MIGRATION_ID =
  "0024_m4_realm_full_access_lifecycle";

/** Distinguishes an explicit revoke from temporal expiry on existing 0021 databases. */
export async function applyRealmFullAccessLifecycleMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const table = qualifiedName(schema, "_xecms_realm_full_access_bindings");
  await client.query(`
    ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS termination_reason text;

    DO $drop_legacy_full_access_lifecycle_check$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = '${table}'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%revoked_at IS NULL%'
           AND pg_get_constraintdef(oid) LIKE '%revoked_by_identity_id IS NULL%'
      LOOP
        EXECUTE 'ALTER TABLE ${table} DROP CONSTRAINT ' || quote_ident(constraint_name);
      END LOOP;
    END;
    $drop_legacy_full_access_lifecycle_check$;

    UPDATE ${table}
       SET termination_reason = 'revoked'
     WHERE revoked_at IS NOT NULL AND termination_reason IS NULL;

    ALTER TABLE ${table}
      DROP CONSTRAINT IF EXISTS _xecms_realm_full_access_lifecycle_check,
      ADD CONSTRAINT _xecms_realm_full_access_lifecycle_check CHECK (
        (revoked_at IS NULL AND revoked_by_identity_id IS NULL AND termination_reason IS NULL)
        OR (
          revoked_at IS NOT NULL
          AND termination_reason = 'expired'
          AND revoked_by_identity_id IS NULL
        )
        OR (
          revoked_at IS NOT NULL
          AND termination_reason = 'revoked'
          AND revoked_by_identity_id IS NOT NULL
        )
      );
  `);
}
