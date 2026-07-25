import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const ADMIN_APP_MASK_POLICY_DEPENDENCY_MIGRATION_ID =
  "0030_admin_app_mask_policy_dependency";

/**
 * Adds `mask-policy` to the Admin App Revision dependency-kind constraint.
 * Composed Page (V2) output protection references a Mask Policy id, which the
 * dependency resolver records so drift can be detected on Apply.
 */
export async function applyAdminAppMaskPolicyDependencyMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const table = qualifiedName(schema, "_xecms_admin_app_dependencies");
  await client.query(`
    ALTER TABLE ${table}
      DROP CONSTRAINT IF EXISTS _xecms_admin_app_dependencies_dependency_kind_check;
    ALTER TABLE ${table}
      ADD CONSTRAINT _xecms_admin_app_dependencies_dependency_kind_check
      CHECK (dependency_kind IN (
        'schema-revision', 'authorization-policy', 'collection', 'component', 'field', 'relation',
        'realm', 'permission', 'resource', 'action', 'widget', 'renderer', 'plugin', 'extension',
        'mask-policy'
      ));
  `);
}
