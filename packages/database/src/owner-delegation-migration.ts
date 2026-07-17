import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID =
  "0019_owner_delegation_reconciliation";

/**
 * Reconciles protected Owner roles with the permission catalog.
 *
 * Older feature migrations granted newly introduced permissions to Owner but
 * did not add the matching delegation row. Owner must delegate every assigned
 * permission that the catalog marks delegatable and non-protected.
 */
export async function applyOwnerDelegationReconciliationMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    DELETE FROM ${q("_xecms_auth_role_delegations")} delegation
    USING ${q("_xecms_auth_roles")} role,
          ${q("_xecms_auth_permissions")} permission
    WHERE delegation.realm_id = role.realm_id
      AND delegation.role_id = role.id
      AND delegation.permission_key = permission.permission_key
      AND role.id = 'authorization:' || role.realm_id || ':role:owner'
      AND (permission.delegatable = false OR permission.protected = true);

    INSERT INTO ${q("_xecms_auth_role_delegations")}
      (realm_id, role_id, permission_key)
    SELECT role_permission.realm_id,
           role_permission.role_id,
           role_permission.permission_key
      FROM ${q("_xecms_auth_role_permissions")} role_permission
      JOIN ${q("_xecms_auth_roles")} role
        ON role.realm_id = role_permission.realm_id
       AND role.id = role_permission.role_id
      JOIN ${q("_xecms_auth_permissions")} permission
        ON permission.permission_key = role_permission.permission_key
     WHERE role.id = 'authorization:' || role.realm_id || ':role:owner'
       AND permission.delegatable = true
       AND permission.protected = false
    ON CONFLICT DO NOTHING;
  `);
}
