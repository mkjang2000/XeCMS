import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const REALM_MANAGEMENT_DELEGATIONS_MIGRATION_ID =
  "0026_m4_realm_management_delegations";

/**
 * Introduces CMS-level cross-realm user-administration delegations: one Content
 * Realm ("managing") may administer another Content Realm's ("managed") members
 * within the actions the CMS Owner declares. Purely additive — with no rows the
 * existing behaviour (CMS Owner only) is unchanged, which is the natural
 * fail-closed default. No seed, no enforcement toggle.
 *
 * `managing_realm_id` may also be the System realm (`rlm_system`) for future
 * "delegate to a System operator" declarations (entry point A); the System realm
 * exists as a real row in `_xecms_realms`, so the FK holds.
 */
export async function applyRealmManagementDelegationsMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_management_delegations")} (
      workspace_id text NOT NULL,
      managing_realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      managed_realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      actions text[] NOT NULL CHECK (
        actions <@ ARRAY[
          'identity.credentials.reset','identity.disable','identity.update',
          'identity.session.revoke','membership.suspend','membership.reactivate',
          'membership.provision'
        ]::text[]
      ),
      -- Per-action any/all rule as {action: "any"|"all"}. Validated in the app layer.
      scope_by_action jsonb NOT NULL DEFAULT '{}'::jsonb,
      revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      PRIMARY KEY (managing_realm_id, managed_realm_id),
      -- A realm never delegates to itself.
      CHECK (managing_realm_id <> managed_realm_id)
    );

    -- Judgement hot path resolves delegations by the managed (target) realm.
    CREATE INDEX IF NOT EXISTS _xecms_realm_management_delegations_by_managed
      ON ${q("_xecms_realm_management_delegations")}(managed_realm_id);
  `);
}
