import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

export const USER_IDENTITY_MIGRATION_ID = "0015_m4c1_users_credentials";

export async function applyUserIdentityMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    ALTER TABLE ${q("_xecms_identities")}
      ADD COLUMN IF NOT EXISTS identity_kind text,
      ADD COLUMN IF NOT EXISTS revision bigint,
      ADD COLUMN IF NOT EXISTS password_change_required boolean,
      ADD COLUMN IF NOT EXISTS locked_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_by text;
    UPDATE ${q("_xecms_identities")}
       SET identity_kind = COALESCE(identity_kind, 'human'),
           revision = COALESCE(revision, 1),
           password_change_required = COALESCE(password_change_required, false),
           updated_at = COALESCE(updated_at, created_at),
           updated_by = COALESCE(updated_by, id)
     WHERE identity_kind IS NULL OR revision IS NULL OR password_change_required IS NULL
        OR updated_at IS NULL OR updated_by IS NULL;
    ALTER TABLE ${q("_xecms_identities")}
      ALTER COLUMN identity_kind SET NOT NULL,
      ALTER COLUMN identity_kind SET DEFAULT 'human',
      ALTER COLUMN revision SET NOT NULL,
      ALTER COLUMN revision SET DEFAULT 1,
      ALTER COLUMN password_change_required SET NOT NULL,
      ALTER COLUMN password_change_required SET DEFAULT false,
      ALTER COLUMN updated_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT now(),
      ALTER COLUMN updated_by SET NOT NULL,
      ALTER COLUMN updated_by SET DEFAULT 'system';
    ALTER TABLE ${q("_xecms_identities")}
      DROP CONSTRAINT IF EXISTS _xecms_identities_kind_check,
      DROP CONSTRAINT IF EXISTS _xecms_identities_revision_check,
      DROP CONSTRAINT IF EXISTS _xecms_service_identity_no_password_change,
      ADD CONSTRAINT _xecms_identities_kind_check CHECK (identity_kind IN ('human', 'service')),
      ADD CONSTRAINT _xecms_identities_revision_check CHECK (revision > 0),
      ADD CONSTRAINT _xecms_service_identity_no_password_change
        CHECK (identity_kind <> 'service' OR password_change_required = false);
    CREATE INDEX IF NOT EXISTS _xecms_identities_admin_list
      ON ${q("_xecms_identities")}(workspace_id, identity_kind, disabled_at, normalized_username, id);

    ALTER TABLE ${q("_xecms_sessions")}
      ADD COLUMN IF NOT EXISTS id text,
      ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
      ADD COLUMN IF NOT EXISTS revoked_by_identity_id text,
      ADD COLUMN IF NOT EXISTS revoke_reason text;
    UPDATE ${q("_xecms_sessions")}
       SET id = 'session_' || md5(token_hash)
     WHERE id IS NULL;
    ALTER TABLE ${q("_xecms_sessions")} ALTER COLUMN id SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_sessions_id ON ${q("_xecms_sessions")}(id);
    CREATE INDEX IF NOT EXISTS _xecms_sessions_identity_time
      ON ${q("_xecms_sessions")}(identity_id, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS _xecms_sessions_active_identity
      ON ${q("_xecms_sessions")}(identity_id, expires_at, id) WHERE revoked_at IS NULL;
    DO $session_revoked_by_fk$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = '${q("_xecms_sessions")}'::regclass
           AND conname = '_xecms_sessions_revoked_by_fk'
      ) THEN
        ALTER TABLE ${q("_xecms_sessions")}
          ADD CONSTRAINT _xecms_sessions_revoked_by_fk
          FOREIGN KEY (revoked_by_identity_id) REFERENCES ${q("_xecms_identities")}(id)
          ON DELETE RESTRICT;
      END IF;
    END
    $session_revoked_by_fk$;
    ALTER TABLE ${q("_xecms_sessions")}
      DROP CONSTRAINT IF EXISTS _xecms_sessions_revoke_shape,
      ADD CONSTRAINT _xecms_sessions_revoke_shape CHECK (
        (revoked_at IS NULL AND revoked_by_identity_id IS NULL AND revoke_reason IS NULL)
        OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
      );

    CREATE TABLE IF NOT EXISTS ${q("_xecms_credential_tokens")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE CASCADE,
      purpose text NOT NULL CHECK (purpose IN ('invitation', 'password-reset')),
      token_digest text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL,
      created_by_identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      revoked_at timestamptz,
      CHECK (expires_at > created_at),
      CHECK (used_at IS NULL OR used_at >= created_at),
      CHECK (revoked_at IS NULL OR revoked_at >= created_at),
      CHECK (used_at IS NULL OR revoked_at IS NULL)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_credential_token_active_purpose
      ON ${q("_xecms_credential_tokens")}(identity_id, purpose)
      WHERE used_at IS NULL AND revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS _xecms_credential_token_expiry
      ON ${q("_xecms_credential_tokens")}(expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

    CREATE TABLE IF NOT EXISTS ${q("_xecms_api_keys")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
      key_prefix text NOT NULL UNIQUE,
      key_digest text NOT NULL UNIQUE,
      scopes jsonb NOT NULL CHECK (jsonb_typeof(scopes) = 'array'),
      created_at timestamptz NOT NULL,
      created_by_identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      expires_at timestamptz,
      last_used_at timestamptz,
      revoked_at timestamptz,
      revoked_by_identity_id text REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      revoke_reason text,
      CHECK (expires_at IS NULL OR expires_at > created_at),
      CHECK ((revoked_at IS NULL AND revoked_by_identity_id IS NULL AND revoke_reason IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by_identity_id IS NOT NULL AND revoke_reason IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS _xecms_api_keys_identity
      ON ${q("_xecms_api_keys")}(identity_id, created_at DESC, id);
    CREATE INDEX IF NOT EXISTS _xecms_api_keys_active
      ON ${q("_xecms_api_keys")}(identity_id, expires_at, id) WHERE revoked_at IS NULL;

    INSERT INTO ${q("_xecms_auth_permissions")}
      (permission_key, hierarchy_guard, delegatable, protected, created_at)
    VALUES
      ('identity.owner.transfer', 'target-subject', false, true, now()),
      ('identity.system-membership.create', 'none', true, false, now()),
      ('service-account.create', 'none', true, false, now()),
      ('service-account.update', 'target-subject', true, false, now())
    ON CONFLICT (permission_key) DO UPDATE SET
      hierarchy_guard = EXCLUDED.hierarchy_guard,
      delegatable = EXCLUDED.delegatable,
      protected = EXCLUDED.protected;

    INSERT INTO ${q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
      SELECT role.realm_id, role.id, permission.permission_key
        FROM ${q("_xecms_auth_roles")} role
        CROSS JOIN (VALUES
          ('identity.owner.transfer'),
          ('identity.system-membership.create'),
          ('service-account.create'),
          ('service-account.update')
        ) permission(permission_key)
       WHERE role.id = 'authorization:' || role.realm_id || ':role:owner'
          OR (
            role.id = 'authorization:' || role.realm_id || ':role:security-administrator'
            AND permission.permission_key <> 'identity.owner.transfer'
          )
    ON CONFLICT DO NOTHING;

    INSERT INTO ${q("_xecms_auth_role_delegations")}(realm_id, role_id, permission_key)
      SELECT role.realm_id, role.id, permission.permission_key
        FROM ${q("_xecms_auth_roles")} role
        CROSS JOIN (VALUES
          ('identity.system-membership.create'),
          ('service-account.create'),
          ('service-account.update')
        ) permission(permission_key)
       WHERE role.id IN (
         'authorization:' || role.realm_id || ':role:owner',
         'authorization:' || role.realm_id || ':role:security-administrator'
       )
    ON CONFLICT DO NOTHING;
  `);
}
