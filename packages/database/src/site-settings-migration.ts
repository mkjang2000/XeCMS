import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

export const SITE_SETTINGS_MIGRATION_ID = "0016_m4c2_sites_settings";

export async function applySiteSettingsMigration(client: Pick<PoolClient, "query">, schema: string): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    ALTER TABLE ${q("_xecms_workspaces")}
      ADD COLUMN IF NOT EXISTS default_timezone text,
      ADD COLUMN IF NOT EXISTS admin_locale text,
      ADD COLUMN IF NOT EXISTS revision bigint,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_by text;
    UPDATE ${q("_xecms_workspaces")}
       SET default_timezone = COALESCE(default_timezone, 'UTC'),
           admin_locale = COALESCE(admin_locale, 'ko-KR'),
           revision = COALESCE(revision, 1),
           updated_at = COALESCE(updated_at, created_at),
           updated_by = COALESCE(updated_by, 'system')
     WHERE default_timezone IS NULL OR admin_locale IS NULL OR revision IS NULL
        OR updated_at IS NULL OR updated_by IS NULL;
    ALTER TABLE ${q("_xecms_workspaces")}
      ALTER COLUMN default_timezone SET NOT NULL,
      ALTER COLUMN default_timezone SET DEFAULT 'UTC',
      ALTER COLUMN admin_locale SET NOT NULL,
      ALTER COLUMN admin_locale SET DEFAULT 'ko-KR',
      ALTER COLUMN revision SET NOT NULL,
      ALTER COLUMN revision SET DEFAULT 1,
      ALTER COLUMN updated_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT now(),
      ALTER COLUMN updated_by SET NOT NULL,
      ALTER COLUMN updated_by SET DEFAULT 'system';
    ALTER TABLE ${q("_xecms_workspaces")}
      DROP CONSTRAINT IF EXISTS _xecms_workspaces_revision_check,
      ADD CONSTRAINT _xecms_workspaces_revision_check CHECK (revision > 0);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_sites")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      site_key text NOT NULL,
      name text NOT NULL,
      canonical_url text,
      status text NOT NULL CHECK (status IN ('active', 'archived')),
      is_default boolean NOT NULL DEFAULT false,
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      archived_at timestamptz,
      UNIQUE (workspace_id, site_key),
      CHECK (length(btrim(name)) BETWEEN 1 AND 120),
      CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
      CHECK (NOT is_default OR status = 'active')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_sites_one_default
      ON ${q("_xecms_sites")}(workspace_id) WHERE is_default;
    CREATE INDEX IF NOT EXISTS _xecms_sites_list
      ON ${q("_xecms_sites")}(workspace_id, status, name, id);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_collection_sites")} (
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      collection_id text NOT NULL,
      site_id text NOT NULL REFERENCES ${q("_xecms_sites")}(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      PRIMARY KEY (workspace_id, collection_id)
    );
    CREATE INDEX IF NOT EXISTS _xecms_collection_sites_site
      ON ${q("_xecms_collection_sites")}(workspace_id, site_id, collection_id);

    ALTER TABLE ${q("_xecms_outbox_events")}
      DROP CONSTRAINT IF EXISTS _xecms_outbox_events_aggregate_type_check;
    ALTER TABLE ${q("_xecms_outbox_events")}
      ADD CONSTRAINT _xecms_outbox_events_aggregate_type_check
      CHECK (aggregate_type IN ('document', 'identity', 'realm', 'authorization', 'media', 'workspace', 'site'));

    INSERT INTO ${q("_xecms_auth_permissions")}
      (permission_key, hierarchy_guard, delegatable, protected, created_at)
    VALUES
      ('system.settings.read', 'none', true, false, now()),
      ('site.read', 'none', true, false, now()),
      ('site.create', 'none', true, false, now()),
      ('site.update', 'none', true, false, now()),
      ('site.archive', 'none', true, false, now()),
      ('site.collection.bind', 'none', true, false, now())
    ON CONFLICT (permission_key) DO UPDATE SET
      hierarchy_guard = EXCLUDED.hierarchy_guard,
      delegatable = EXCLUDED.delegatable,
      protected = EXCLUDED.protected;

    INSERT INTO ${q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
      SELECT role.realm_id, role.id, permission.permission_key
        FROM ${q("_xecms_auth_roles")} role
        CROSS JOIN (VALUES ('system.settings.read'), ('site.read'), ('site.create'),
          ('site.update'), ('site.archive'), ('site.collection.bind')) permission(permission_key)
       WHERE role.id IN ('authorization:' || role.realm_id || ':role:owner',
                         'authorization:' || role.realm_id || ':role:administrator')
    ON CONFLICT DO NOTHING;
  `);
}
