import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const ADMIN_APP_PAGE_ACCESS_MIGRATION_ID =
  "0029_admin_app_page_action_access";

export const ADMIN_APP_RUNTIME_PERMISSIONS = Object.freeze([
  "admin-app.page.read",
  "admin-app.page.unmask",
  "admin-app.action.execute",
] as const);

/**
 * Adds the runtime gates used below an Admin App Resource. Existing Owner and
 * Content Administrator roles receive and may delegate them in every Realm so
 * upgrades match freshly initialized authorization policies. Roles that
 * already had admin-app.access inherit the V1-equivalent Page, Action, and
 * unmasked access; otherwise an upgrade would silently empty their Runtime.
 */
export async function applyAdminAppPageAccessMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    INSERT INTO ${q("_xecms_auth_permissions")}
      (permission_key, hierarchy_guard, delegatable, protected, created_at)
    VALUES
      ('admin-app.page.read', 'none', true, false, now()),
      ('admin-app.page.unmask', 'none', true, false, now()),
      ('admin-app.action.execute', 'none', true, false, now())
    ON CONFLICT (permission_key) DO UPDATE SET
      hierarchy_guard = EXCLUDED.hierarchy_guard,
      delegatable = EXCLUDED.delegatable,
      protected = EXCLUDED.protected;

    INSERT INTO ${q("_xecms_auth_role_permissions")}
      (realm_id, role_id, permission_key)
    SELECT role.realm_id, role.id, permission.permission_key
      FROM ${q("_xecms_auth_roles")} role
      CROSS JOIN (VALUES
        ('admin-app.page.read'),
        ('admin-app.page.unmask'),
        ('admin-app.action.execute')
      ) permission(permission_key)
     WHERE role.id IN (
       'authorization:' || role.realm_id || ':role:owner',
       'authorization:' || role.realm_id || ':role:content-administrator'
     )
        OR EXISTS (
          SELECT 1 FROM ${q("_xecms_auth_role_permissions")} existing
           WHERE existing.realm_id = role.realm_id
             AND existing.role_id = role.id
             AND existing.permission_key = 'admin-app.access'
        )
    ON CONFLICT DO NOTHING;

    INSERT INTO ${q("_xecms_auth_role_delegations")}
      (realm_id, role_id, permission_key)
    SELECT role_permission.realm_id, role_permission.role_id, role_permission.permission_key
      FROM ${q("_xecms_auth_role_permissions")} role_permission
      JOIN ${q("_xecms_auth_roles")} role
        ON role.realm_id = role_permission.realm_id AND role.id = role_permission.role_id
      JOIN ${q("_xecms_auth_permissions")} permission
        ON permission.permission_key = role_permission.permission_key
     WHERE (
       role.id IN (
         'authorization:' || role.realm_id || ':role:owner',
         'authorization:' || role.realm_id || ':role:content-administrator'
       )
       OR EXISTS (
          SELECT 1 FROM ${q("_xecms_auth_role_delegations")} existing
           WHERE existing.realm_id = role.realm_id
             AND existing.role_id = role.id
             AND existing.permission_key = 'admin-app.access'
       )
     )
       AND role_permission.permission_key IN (
         'admin-app.page.read',
         'admin-app.page.unmask',
         'admin-app.action.execute'
       )
       AND permission.delegatable = true
       AND permission.protected = false
    ON CONFLICT DO NOTHING;
  `);
}
