import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const ADMIN_APP_STORE_MIGRATION_ID = "0020_caa2_admin_app_store";

export async function applyAdminAppStoreMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_admin_apps")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      manifest_id text NOT NULL,
      app_key text NOT NULL,
      name text NOT NULL,
      audience_type text NOT NULL CHECK (audience_type IN ('system', 'content-realm')),
      audience_realm_id text,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      active_revision_id text,
      route_version bigint NOT NULL DEFAULT 1 CHECK (route_version > 0),
      created_at timestamptz NOT NULL,
      created_by_identity_id text NOT NULL,
      created_by_subject_id text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by_identity_id text NOT NULL,
      updated_by_subject_id text NOT NULL,
      archived_at timestamptz,
      archived_by_identity_id text,
      archived_by_subject_id text,
      UNIQUE (workspace_id, id),
      UNIQUE (workspace_id, manifest_id),
      UNIQUE (workspace_id, app_key),
      CHECK (manifest_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
      CHECK (app_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
      CHECK (length(btrim(name)) BETWEEN 1 AND 120),
      CHECK ((audience_type = 'system' AND audience_realm_id IS NULL)
          OR (audience_type = 'content-realm' AND audience_realm_id IS NOT NULL)),
      CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
      CHECK ((archived_at IS NULL AND archived_by_identity_id IS NULL AND archived_by_subject_id IS NULL)
          OR (archived_at IS NOT NULL AND archived_by_identity_id IS NOT NULL AND archived_by_subject_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS _xecms_admin_apps_list
      ON ${q("_xecms_admin_apps")}(workspace_id, status, name, id);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_admin_app_revisions")} (
      revision_id text PRIMARY KEY,
      app_id text NOT NULL,
      workspace_id text NOT NULL,
      sequence bigint NOT NULL CHECK (sequence > 0),
      parent_revision_id text,
      manifest_json jsonb NOT NULL CHECK (jsonb_typeof(manifest_json) = 'object'),
      manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL,
      created_by_identity_id text NOT NULL,
      created_by_subject_id text NOT NULL,
      UNIQUE (app_id, revision_id),
      UNIQUE (app_id, sequence),
      FOREIGN KEY (workspace_id, app_id)
        REFERENCES ${q("_xecms_admin_apps")}(workspace_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (app_id, parent_revision_id)
        REFERENCES ${q("_xecms_admin_app_revisions")}(app_id, revision_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS _xecms_admin_app_revisions_history
      ON ${q("_xecms_admin_app_revisions")}(app_id, sequence DESC);

    ALTER TABLE ${q("_xecms_admin_apps")}
      DROP CONSTRAINT IF EXISTS _xecms_admin_apps_active_revision_fk;
    ALTER TABLE ${q("_xecms_admin_apps")}
      ADD CONSTRAINT _xecms_admin_apps_active_revision_fk
      FOREIGN KEY (id, active_revision_id)
      REFERENCES ${q("_xecms_admin_app_revisions")}(app_id, revision_id)
      ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;

    CREATE TABLE IF NOT EXISTS ${q("_xecms_admin_app_drafts")} (
      app_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      base_revision_id text,
      draft_version bigint NOT NULL DEFAULT 1 CHECK (draft_version > 0),
      desired_key text NOT NULL,
      manifest_json jsonb NOT NULL CHECK (jsonb_typeof(manifest_json) = 'object'),
      manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL,
      created_by_identity_id text NOT NULL,
      created_by_subject_id text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by_identity_id text NOT NULL,
      updated_by_subject_id text NOT NULL,
      UNIQUE (workspace_id, desired_key),
      FOREIGN KEY (workspace_id, app_id)
        REFERENCES ${q("_xecms_admin_apps")}(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (app_id, base_revision_id)
        REFERENCES ${q("_xecms_admin_app_revisions")}(app_id, revision_id) ON DELETE RESTRICT,
      CHECK (desired_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$')
    );
    CREATE INDEX IF NOT EXISTS _xecms_admin_app_drafts_workspace
      ON ${q("_xecms_admin_app_drafts")}(workspace_id, updated_at DESC, app_id);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_admin_app_dependencies")} (
      revision_id text NOT NULL REFERENCES ${q("_xecms_admin_app_revisions")}(revision_id) ON DELETE RESTRICT,
      dependency_kind text NOT NULL CHECK (dependency_kind IN (
        'schema-revision', 'authorization-policy', 'collection', 'component', 'field', 'relation',
        'realm', 'permission', 'resource', 'action', 'widget', 'renderer', 'plugin', 'extension'
      )),
      dependency_id text NOT NULL,
      fingerprint text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
      PRIMARY KEY (revision_id, dependency_kind, dependency_id)
    );
    CREATE INDEX IF NOT EXISTS _xecms_admin_app_dependencies_reverse
      ON ${q("_xecms_admin_app_dependencies")}(dependency_kind, dependency_id, revision_id);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_admin_app_user_views")} (
      workspace_id text NOT NULL,
      app_id text NOT NULL,
      subject_id text NOT NULL,
      page_id text NOT NULL,
      view_key text NOT NULL,
      value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
      version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (app_id, subject_id, page_id, view_key),
      FOREIGN KEY (workspace_id, app_id)
        REFERENCES ${q("_xecms_admin_apps")}(workspace_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS _xecms_admin_app_user_views_subject
      ON ${q("_xecms_admin_app_user_views")}(workspace_id, subject_id, app_id, page_id);

    CREATE OR REPLACE FUNCTION ${q("_xecms_reject_admin_app_snapshot_mutation")}()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Admin App revisions and dependency snapshots are immutable'
        USING ERRCODE = '55000';
    END;
    $$;
    DROP TRIGGER IF EXISTS _xecms_admin_app_revisions_immutable
      ON ${q("_xecms_admin_app_revisions")};
    CREATE TRIGGER _xecms_admin_app_revisions_immutable
      BEFORE UPDATE OR DELETE ON ${q("_xecms_admin_app_revisions")}
      FOR EACH ROW EXECUTE FUNCTION ${q("_xecms_reject_admin_app_snapshot_mutation")}();
    DROP TRIGGER IF EXISTS _xecms_admin_app_dependencies_immutable
      ON ${q("_xecms_admin_app_dependencies")};
    CREATE TRIGGER _xecms_admin_app_dependencies_immutable
      BEFORE UPDATE OR DELETE ON ${q("_xecms_admin_app_dependencies")}
      FOR EACH ROW EXECUTE FUNCTION ${q("_xecms_reject_admin_app_snapshot_mutation")}();

    INSERT INTO ${q("_xecms_auth_permissions")}
      (permission_key, hierarchy_guard, delegatable, protected, created_at)
    VALUES
      ('admin-app.read', 'none', true, false, now()),
      ('admin-app.create', 'none', true, false, now()),
      ('admin-app.update', 'none', true, false, now()),
      ('admin-app.apply', 'none', true, false, now()),
      ('admin-app.delete', 'none', true, false, now()),
      ('admin-app.export', 'none', true, false, now()),
      ('admin-app.access', 'none', true, false, now())
    ON CONFLICT (permission_key) DO UPDATE SET
      hierarchy_guard = EXCLUDED.hierarchy_guard,
      delegatable = EXCLUDED.delegatable,
      protected = EXCLUDED.protected;

    INSERT INTO ${q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
      SELECT 'rlm_system', role.id, permission.permission_key
        FROM ${q("_xecms_auth_roles")} role
        CROSS JOIN (VALUES ('admin-app.read'), ('admin-app.create'), ('admin-app.update'),
          ('admin-app.apply'), ('admin-app.delete'), ('admin-app.export')) permission(permission_key)
       WHERE role.realm_id = 'rlm_system'
         AND role.id IN ('authorization:rlm_system:role:owner',
                         'authorization:rlm_system:role:content-administrator')
    ON CONFLICT DO NOTHING;

    INSERT INTO ${q("_xecms_auth_role_delegations")}(realm_id, role_id, permission_key)
      SELECT role_permission.realm_id, role_permission.role_id, role_permission.permission_key
        FROM ${q("_xecms_auth_role_permissions")} role_permission
        JOIN ${q("_xecms_auth_permissions")} permission
          ON permission.permission_key = role_permission.permission_key
       WHERE role_permission.realm_id = 'rlm_system'
         AND role_permission.role_id = 'authorization:rlm_system:role:owner'
         AND permission.delegatable = true
         AND permission.protected = false
    ON CONFLICT DO NOTHING;
  `);
}
