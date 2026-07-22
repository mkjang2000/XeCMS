import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const ADMIN_APP_ACCESS_RECONCILIATION_MIGRATION_ID =
  "0027_admin_app_access_reconciliation";

/**
 * Backfills the runtime permission omitted by the original Admin App migration.
 * Owner and Content Administrator are seeded with this permission by the
 * application policy, so existing persisted policies must match that contract.
 */
export async function applyAdminAppAccessReconciliationMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    INSERT INTO ${q("_xecms_auth_role_permissions")}
      (realm_id, role_id, permission_key)
    SELECT role.realm_id, role.id, 'admin-app.access'
      FROM ${q("_xecms_auth_roles")} role
     WHERE role.id IN (
       'authorization:' || role.realm_id || ':role:owner',
       'authorization:' || role.realm_id || ':role:content-administrator'
     )
    ON CONFLICT DO NOTHING;

    INSERT INTO ${q("_xecms_auth_role_delegations")}
      (realm_id, role_id, permission_key)
    SELECT role.realm_id, role.id, 'admin-app.access'
      FROM ${q("_xecms_auth_roles")} role
      JOIN ${q("_xecms_auth_permissions")} permission
        ON permission.permission_key = 'admin-app.access'
     WHERE role.id IN (
       'authorization:' || role.realm_id || ':role:owner',
       'authorization:' || role.realm_id || ':role:content-administrator'
     )
       AND permission.delegatable = true
       AND permission.protected = false
    ON CONFLICT DO NOTHING;
  `);
}
