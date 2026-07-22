import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const REALM_COLLECTION_ENTITLEMENTS_MIGRATION_ID =
  "0025_m4_realm_collection_entitlements";

/**
 * Introduces the CMS-level access ceiling (entitlement) layer above each
 * Content Realm's authorization policy. This migration only creates the tables
 * and, for safety, seeds every existing content realm's enforcement state as
 * `disabled` (the gate is skipped until the feature is explicitly activated in a
 * later migration that also fills entitlement data). No existing access changes.
 */
export async function applyRealmCollectionEntitlementsMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_entitlement_enforcement")} (
      realm_id text PRIMARY KEY REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      workspace_id text NOT NULL,
      state text NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled', 'enforced')),
      version bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_collection_entitlements")} (
      workspace_id text NOT NULL,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      collection_id text NOT NULL CHECK (length(btrim(collection_id)) > 0),
      actions text[] NOT NULL CHECK (
        actions <@ ARRAY[
          'list','read','create','update','delete',
          'publish','unpublish','purge','restore',
          'revision.read','revision.restore'
        ]::text[]
      ),
      readable_fields text[],
      writable_fields text[],
      constraint_owner_only boolean NOT NULL DEFAULT false,
      constraint_statuses text[],
      revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      PRIMARY KEY (realm_id, collection_id),
      -- writable ⊆ readable (no blind writes). NULL readable = all fields, so any
      -- writable set is a subset; only a restricted readable set is checked.
      CHECK (readable_fields IS NULL OR writable_fields IS NULL OR writable_fields <@ readable_fields)
    );

    CREATE INDEX IF NOT EXISTS _xecms_realm_collection_entitlements_by_collection
      ON ${q("_xecms_realm_collection_entitlements")}(workspace_id, collection_id);
  `);

  // Seed enforcement rows for existing content realms as disabled (gate skipped).
  await client.query(`
    INSERT INTO ${q("_xecms_realm_entitlement_enforcement")} (realm_id, workspace_id, state, version)
    SELECT realm.id, realm.workspace_id, 'disabled', 0
    FROM ${q("_xecms_realms")} AS realm
    WHERE realm.kind = 'content'
    ON CONFLICT (realm_id) DO NOTHING;
  `);

  // Preserve existing access: for every (content realm, collection), create a
  // "full-allow" entitlement whose actions = union of the content.* actions that
  // ANY binding effectively grants on that collection. This must respect scope
  // propagation, because almost all real bindings (Owner, Content Administrator,
  // default member roles) are attached to the realm ROOT resource with
  // `self-and-children` and reach collections by propagation — a naive
  // "binding on the collection resource" scan would miss them and break access.
  //
  // For each collection resource `col` and binding `b` on resource `br`:
  //   - self             → applies only when br == col (ancestor depth 0)
  //   - children         → applies when br is a strict ancestor of col (depth ≥ 1)
  //   - self-and-children→ applies when br is col or an ancestor (depth ≥ 0)
  // resolved via _xecms_auth_resource_ancestors(ancestor, descendant, depth),
  // which includes the self row (depth 0).
  await client.query(`
    INSERT INTO ${q("_xecms_realm_collection_entitlements")}
      (workspace_id, realm_id, collection_id, actions, revision, updated_at, updated_by)
    SELECT
      realm.workspace_id,
      col.realm_id,
      substring(col.id FROM (position('resource:collection:' IN col.id) + length('resource:collection:'))) AS collection_id,
      array_agg(DISTINCT action_map.action) AS actions,
      1,
      now(),
      'system:migration:0025'
    FROM ${q("_xecms_auth_resources")} AS col
    JOIN ${q("_xecms_realms")} AS realm
      ON realm.id = col.realm_id AND realm.kind = 'content'
    JOIN ${q("_xecms_auth_role_bindings")} AS b
      ON b.realm_id = col.realm_id
    JOIN ${q("_xecms_auth_resource_ancestors")} AS anc
      ON anc.realm_id = col.realm_id
     AND anc.descendant_resource_id = col.id
     AND anc.ancestor_resource_id = b.resource_id
     AND (
       (b.propagation = 'self' AND anc.depth = 0)
       OR (b.propagation = 'children' AND anc.depth >= 1)
       OR (b.propagation = 'self-and-children')
     )
    JOIN ${q("_xecms_auth_role_permissions")} AS rp
      ON rp.realm_id = b.realm_id AND rp.role_id = b.role_id
    JOIN LATERAL (
      SELECT CASE rp.permission_key
        WHEN 'content.list' THEN 'list'
        WHEN 'content.read' THEN 'read'
        WHEN 'content.create' THEN 'create'
        WHEN 'content.update' THEN 'update'
        WHEN 'content.delete' THEN 'delete'
        WHEN 'content.publish' THEN 'publish'
        WHEN 'content.unpublish' THEN 'unpublish'
        WHEN 'content.purge' THEN 'purge'
        WHEN 'content.restore' THEN 'restore'
        WHEN 'content.revision.read' THEN 'revision.read'
        WHEN 'content.revision.restore' THEN 'revision.restore'
        ELSE NULL
      END AS action
    ) AS action_map ON action_map.action IS NOT NULL
    WHERE col.resource_type = 'collection' AND col.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${q("_xecms_auth_collection_configs")} config
         WHERE config.collection_id = substring(
           col.id FROM (position('resource:collection:' IN col.id) + length('resource:collection:'))
         )
      )
    GROUP BY realm.workspace_id, col.realm_id, collection_id
    ON CONFLICT (realm_id, collection_id) DO NOTHING;
  `);

  // Turn the gate on for every content realm now that ceilings preserve access.
  await client.query(`
    UPDATE ${q("_xecms_realm_entitlement_enforcement")}
       SET state = 'enforced', version = version + 1, updated_at = now()
     WHERE state = 'disabled';
  `);
}
