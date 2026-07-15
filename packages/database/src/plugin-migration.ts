import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

export const PLUGIN_PLATFORM_MIGRATION_ID="0018_m4c4_plugin_platform";
export async function applyPluginPlatformMigration(client:Pick<PoolClient,"query">,schema:string):Promise<void>{
  const q=(name:string)=>qualifiedName(schema,name);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_plugins")} (
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      plugin_id text NOT NULL, package_name text NOT NULL, version text NOT NULL,
      manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'), manifest_digest text NOT NULL,
      desired_state text NOT NULL CHECK (desired_state IN ('installed','enabled','disabled')),
      config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config)='object'),
      revision bigint NOT NULL CHECK (revision>0), restart_required boolean NOT NULL DEFAULT true,
      installed_at timestamptz NOT NULL, installed_by text NOT NULL,
      updated_at timestamptz NOT NULL, updated_by text NOT NULL,
      PRIMARY KEY (workspace_id,plugin_id)
    );
    CREATE INDEX IF NOT EXISTS _xecms_plugins_state ON ${q("_xecms_plugins")}(workspace_id,desired_state,plugin_id);
    CREATE TABLE IF NOT EXISTS ${q("_xecms_plugin_migrations")} (
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      plugin_id text NOT NULL, migration_id text NOT NULL, checksum text NOT NULL,
      sequence integer NOT NULL CHECK(sequence>0), applied_at timestamptz NOT NULL, applied_by text NOT NULL,
      PRIMARY KEY(workspace_id,plugin_id,migration_id), UNIQUE(workspace_id,plugin_id,sequence)
    );
    CREATE TABLE IF NOT EXISTS ${q("_xecms_plugin_plans")} (
      id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      plugin_id text NOT NULL, action text NOT NULL CHECK(action IN ('install','enable','disable','uninstall')),
      data_action text CHECK(data_action IS NULL OR data_action IN ('preserve','export','purge')),
      expected_plugin_revision bigint, manifest_digest text NOT NULL,
      status text NOT NULL CHECK(status IN ('previewed','applied')),
      blockers jsonb NOT NULL CHECK(jsonb_typeof(blockers)='array'),
      dependency_ids jsonb NOT NULL CHECK(jsonb_typeof(dependency_ids)='array'),
      schema_references jsonb NOT NULL CHECK(jsonb_typeof(schema_references)='array'),
      data_counts jsonb NOT NULL CHECK(jsonb_typeof(data_counts)='object'),
      migration_ids jsonb NOT NULL CHECK(jsonb_typeof(migration_ids)='array'), digest text NOT NULL,
      created_at timestamptz NOT NULL, created_by text NOT NULL,
      expires_at timestamptz NOT NULL CHECK(expires_at>created_at), applied_at timestamptz,
      applied_by text, result jsonb, export_id text,
      CHECK((status='applied')=(applied_at IS NOT NULL AND applied_by IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS _xecms_plugin_plans_workspace_time ON ${q("_xecms_plugin_plans")}(workspace_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS ${q("_xecms_plugin_exports")} (
      id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      plugin_id text NOT NULL, manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
      data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), created_at timestamptz NOT NULL, created_by text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS _xecms_plugin_exports_workspace ON ${q("_xecms_plugin_exports")}(workspace_id,created_at DESC,id DESC);
    ALTER TABLE ${q("_xecms_outbox_events")} DROP CONSTRAINT IF EXISTS _xecms_outbox_events_aggregate_type_check;
    ALTER TABLE ${q("_xecms_outbox_events")} ADD CONSTRAINT _xecms_outbox_events_aggregate_type_check
      CHECK(aggregate_type IN ('document','identity','realm','authorization','media','workspace','site','retention','plugin'));
    INSERT INTO ${q("_xecms_auth_permissions")}(permission_key,hierarchy_guard,delegatable,protected,created_at)
    VALUES ('plugin.enable','none',true,false,now()),('plugin.disable','none',true,false,now()),('plugin.uninstall','none',true,false,now())
    ON CONFLICT(permission_key) DO UPDATE SET hierarchy_guard=EXCLUDED.hierarchy_guard,delegatable=EXCLUDED.delegatable,protected=EXCLUDED.protected;
    INSERT INTO ${q("_xecms_auth_role_permissions")}(realm_id,role_id,permission_key)
      SELECT role.realm_id,role.id,permission.permission_key FROM ${q("_xecms_auth_roles")} role
      CROSS JOIN (VALUES('plugin.enable'),('plugin.disable'),('plugin.uninstall')) permission(permission_key)
      WHERE role.id IN ('authorization:'||role.realm_id||':role:owner','authorization:'||role.realm_id||':role:administrator')
    ON CONFLICT DO NOTHING;
  `);
}
