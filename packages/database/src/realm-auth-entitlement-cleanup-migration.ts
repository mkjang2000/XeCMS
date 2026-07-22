import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const REALM_AUTH_ENTITLEMENT_CLEANUP_MIGRATION_ID =
  "0028_realm_auth_entitlement_cleanup";

/**
 * Removes historical ceilings targeting Auth Collections. A Realm's own Auth
 * Collection is guaranteed outside the entitlement table; every foreign Auth
 * Collection is denied regardless of a stale row. Versions are bumped so any
 * cached ceiling snapshot is invalidated immediately after upgrade.
 */
export async function applyRealmAuthEntitlementCleanupMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    WITH removed AS (
      DELETE FROM ${q("_xecms_realm_collection_entitlements")} entitlement
      USING ${q("_xecms_auth_collection_configs")} config
       WHERE entitlement.collection_id = config.collection_id
      RETURNING entitlement.realm_id
    ), affected AS (
      SELECT DISTINCT realm_id FROM removed
    )
    UPDATE ${q("_xecms_realm_entitlement_enforcement")} enforcement
       SET version = enforcement.version + 1,
           updated_at = now()
      FROM affected
     WHERE enforcement.realm_id = affected.realm_id;
  `);
}
