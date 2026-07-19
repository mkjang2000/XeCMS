import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const IDENTITY_REALM_MIGRATION_ID = "0013_m4_identity_realms";
export const REALM_CONTROL_PLANE_ACCESS_MIGRATION_ID =
  "0021_m4_realm_control_plane_access";

/**
 * Adds the durable M4 identity/Realm boundary without changing legacy identity
 * IDs or invalidating a complete System session. Rows that cannot be tied to
 * an active System Membership are deleted fail-closed during the upgrade.
 */
export async function applyIdentityRealmMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);

  await client.query(`
    ALTER TABLE ${q("_xecms_realms")}
      DROP CONSTRAINT IF EXISTS _xecms_realms_kind_check;
    ALTER TABLE ${q("_xecms_realms")}
      ADD CONSTRAINT _xecms_realms_kind_check CHECK (kind IN ('system', 'content'));

    ALTER TABLE ${q("_xecms_realms")}
      ADD COLUMN IF NOT EXISTS realm_key text,
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS profile_collection_id text,
      ADD COLUMN IF NOT EXISTS accept_system_identities boolean,
      ADD COLUMN IF NOT EXISTS membership_provisioning text,
      ADD COLUMN IF NOT EXISTS registration text,
      ADD COLUMN IF NOT EXISTS default_role_ids text[],
      ADD COLUMN IF NOT EXISTS revision bigint,
      ADD COLUMN IF NOT EXISTS created_by text,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_by text;

    UPDATE ${q("_xecms_realms")}
       SET realm_key = CASE WHEN kind = 'system' THEN 'system' ELSE lower(id) END
     WHERE realm_key IS NULL;
    UPDATE ${q("_xecms_realms")}
       SET status = 'active',
           accept_system_identities = COALESCE(accept_system_identities, false),
           membership_provisioning = COALESCE(membership_provisioning, 'explicit'),
           registration = COALESCE(registration, 'closed'),
           default_role_ids = COALESCE(default_role_ids, '{}'::text[]),
           revision = COALESCE(revision, 1),
           created_by = COALESCE(created_by, 'system:migration'),
           updated_at = COALESCE(updated_at, created_at),
           updated_by = COALESCE(updated_by, created_by, 'system:migration')
     WHERE status IS NULL
        OR accept_system_identities IS NULL
        OR membership_provisioning IS NULL
        OR registration IS NULL
        OR default_role_ids IS NULL
        OR revision IS NULL
        OR created_by IS NULL
        OR updated_at IS NULL
        OR updated_by IS NULL;

    ALTER TABLE ${q("_xecms_realms")}
      ALTER COLUMN realm_key SET NOT NULL,
      ALTER COLUMN status SET NOT NULL,
      ALTER COLUMN accept_system_identities SET NOT NULL,
      ALTER COLUMN accept_system_identities SET DEFAULT false,
      ALTER COLUMN membership_provisioning SET NOT NULL,
      ALTER COLUMN membership_provisioning SET DEFAULT 'explicit',
      ALTER COLUMN registration SET NOT NULL,
      ALTER COLUMN registration SET DEFAULT 'closed',
      ALTER COLUMN default_role_ids SET NOT NULL,
      ALTER COLUMN default_role_ids SET DEFAULT '{}'::text[],
      ALTER COLUMN revision SET NOT NULL,
      ALTER COLUMN revision SET DEFAULT 1,
      ALTER COLUMN created_by SET NOT NULL,
      ALTER COLUMN updated_at SET NOT NULL,
      ALTER COLUMN updated_by SET NOT NULL;

    ALTER TABLE ${q("_xecms_realms")}
      DROP CONSTRAINT IF EXISTS _xecms_realms_status_check,
      DROP CONSTRAINT IF EXISTS _xecms_realms_provisioning_check,
      DROP CONSTRAINT IF EXISTS _xecms_realms_registration_check,
      DROP CONSTRAINT IF EXISTS _xecms_realms_revision_check,
      DROP CONSTRAINT IF EXISTS _xecms_realms_key_check;
    ALTER TABLE ${q("_xecms_realms")}
      ADD CONSTRAINT _xecms_realms_status_check
        CHECK (status IN ('provisioning', 'active', 'disabled')),
      ADD CONSTRAINT _xecms_realms_provisioning_check
        CHECK (membership_provisioning IN ('explicit', 'jit')),
      ADD CONSTRAINT _xecms_realms_registration_check
        CHECK (registration IN ('closed', 'open')),
      ADD CONSTRAINT _xecms_realms_revision_check CHECK (revision > 0),
      ADD CONSTRAINT _xecms_realms_key_check
        CHECK (realm_key ~ '^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$');

    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_realms_workspace_key
      ON ${q("_xecms_realms")}(workspace_id, realm_key);
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_realms_workspace_id
      ON ${q("_xecms_realms")}(workspace_id, id);

    ALTER TABLE ${q("_xecms_identities")}
      ADD COLUMN IF NOT EXISTS origin_realm_id text,
      ADD COLUMN IF NOT EXISTS credential_version bigint;
    UPDATE ${q("_xecms_identities")}
       SET origin_realm_id = COALESCE(origin_realm_id, realm_id),
           credential_version = COALESCE(credential_version, 1)
     WHERE origin_realm_id IS NULL OR credential_version IS NULL;
    ALTER TABLE ${q("_xecms_identities")}
      ALTER COLUMN origin_realm_id SET NOT NULL,
      ALTER COLUMN credential_version SET NOT NULL,
      ALTER COLUMN credential_version SET DEFAULT 1;
    ALTER TABLE ${q("_xecms_identities")}
      DROP CONSTRAINT IF EXISTS _xecms_identities_origin_realm_fk,
      DROP CONSTRAINT IF EXISTS _xecms_identities_credential_version_check;
    ALTER TABLE ${q("_xecms_identities")}
      ADD CONSTRAINT _xecms_identities_origin_realm_fk
        FOREIGN KEY (workspace_id, origin_realm_id)
        REFERENCES ${q("_xecms_realms")}(workspace_id, id),
      ADD CONSTRAINT _xecms_identities_credential_version_check CHECK (credential_version > 0);

    -- Keep pre-M4 callers safe while they are migrated to the explicit origin
    -- Realm contract. PostgreSQL runs BEFORE triggers ahead of NOT NULL checks,
    -- so legacy inserts that still only provide realm_id remain well-defined.
    CREATE OR REPLACE FUNCTION ${q("_xecms_identity_apply_defaults")}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $identity_defaults$
    BEGIN
      NEW.origin_realm_id := COALESCE(NEW.origin_realm_id, NEW.realm_id);
      NEW.credential_version := COALESCE(NEW.credential_version, 1);
      RETURN NEW;
    END;
    $identity_defaults$;
    DROP TRIGGER IF EXISTS _xecms_identity_apply_defaults
      ON ${q("_xecms_identities")};
    CREATE TRIGGER _xecms_identity_apply_defaults
      BEFORE INSERT OR UPDATE OF realm_id, origin_realm_id, credential_version
      ON ${q("_xecms_identities")}
      FOR EACH ROW EXECUTE FUNCTION ${q("_xecms_identity_apply_defaults")}();
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_identities_workspace_id
      ON ${q("_xecms_identities")}(workspace_id, id);
    COMMENT ON COLUMN ${q("_xecms_identities")}.realm_id IS
      'Deprecated origin compatibility column; authorization is resolved through Realm Membership.';

    CREATE TABLE IF NOT EXISTS ${q("_xecms_identity_identifiers")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      identity_id text NOT NULL,
      identifier_kind text NOT NULL CHECK (length(btrim(identifier_kind)) > 0),
      normalized_value text NOT NULL CHECK (length(btrim(normalized_value)) > 0),
      display_value text NOT NULL CHECK (length(btrim(display_value)) > 0),
      verified_at timestamptz,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      UNIQUE (workspace_id, normalized_value),
      UNIQUE (identity_id, identifier_kind, normalized_value),
      FOREIGN KEY (workspace_id, identity_id)
        REFERENCES ${q("_xecms_identities")}(workspace_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS _xecms_identity_identifiers_identity
      ON ${q("_xecms_identity_identifiers")}(identity_id, identifier_kind, id);

    INSERT INTO ${q("_xecms_identity_identifiers")}
      (id, workspace_id, identity_id, identifier_kind, normalized_value,
       display_value, verified_at, created_at, created_by)
    SELECT 'identifier_legacy_' || md5(identity.id), identity.workspace_id, identity.id,
           'username', identity.normalized_username, identity.username,
           identity.created_at, identity.created_at, 'system:migration'
      FROM ${q("_xecms_identities")} identity
    ON CONFLICT (workspace_id, normalized_value) DO NOTHING;

    DO $identity_subject_key$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = '${q("_xecms_auth_subjects")}'::regclass
           AND conname = '_xecms_auth_subjects_realm_id_identity_unique'
      ) THEN
        ALTER TABLE ${q("_xecms_auth_subjects")}
          ADD CONSTRAINT _xecms_auth_subjects_realm_id_identity_unique
            UNIQUE (realm_id, id, identity_id);
      END IF;
    END;
    $identity_subject_key$;

    DO $identity_subject_audit_key$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = '${q("_xecms_auth_subjects")}'::regclass
           AND conname = '_xecms_auth_subjects_id_identity_unique'
      ) THEN
        ALTER TABLE ${q("_xecms_auth_subjects")}
          ADD CONSTRAINT _xecms_auth_subjects_id_identity_unique
            UNIQUE (id, identity_id);
      END IF;
    END;
    $identity_subject_audit_key$;

    CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_memberships")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL,
      identity_id text NOT NULL,
      realm_id text NOT NULL,
      subject_id text NOT NULL,
      profile_collection_id text,
      profile_document_id text,
      status text NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
      provisioned_by text NOT NULL
        CHECK (provisioned_by IN ('explicit', 'invitation', 'jit', 'account-link', 'signup')),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      activated_at timestamptz,
      suspended_at timestamptz,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      UNIQUE (identity_id, realm_id),
      UNIQUE (realm_id, subject_id),
      UNIQUE (id, identity_id, realm_id, subject_id),
      FOREIGN KEY (workspace_id, identity_id)
        REFERENCES ${q("_xecms_identities")}(workspace_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (workspace_id, realm_id)
        REFERENCES ${q("_xecms_realms")}(workspace_id, id) ON DELETE CASCADE,
      FOREIGN KEY (realm_id, subject_id, identity_id)
        REFERENCES ${q("_xecms_auth_subjects")}(realm_id, id, identity_id) ON DELETE RESTRICT,
      CONSTRAINT _xecms_realm_memberships_profile_document_fk
        FOREIGN KEY (workspace_id, profile_collection_id, profile_document_id)
        REFERENCES ${q("_xecms_documents")}(workspace_id, collection_id, id) ON DELETE RESTRICT,
      CHECK ((profile_collection_id IS NULL) = (profile_document_id IS NULL)),
      CHECK (status <> 'active' OR activated_at IS NOT NULL),
      CHECK (status <> 'pending' OR activated_at IS NULL),
      CHECK ((status = 'suspended') = (suspended_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_realm_memberships_profile_document
      ON ${q("_xecms_realm_memberships")}(profile_document_id)
      WHERE profile_document_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS _xecms_realm_memberships_realm_status
      ON ${q("_xecms_realm_memberships")}(realm_id, status, id);

    INSERT INTO ${q("_xecms_realm_memberships")}
      (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
       revision, created_at, created_by, activated_at, suspended_at, updated_at, updated_by)
    SELECT 'membership_legacy_' || md5(subject.realm_id || ':' || subject.identity_id),
           identity.workspace_id, subject.identity_id, subject.realm_id, subject.id,
           CASE WHEN subject.disabled_at IS NULL THEN 'active' ELSE 'suspended' END,
           'explicit', 1, subject.created_at, 'system:migration',
           CASE WHEN subject.disabled_at IS NULL THEN subject.created_at ELSE NULL END,
           subject.disabled_at, subject.updated_at, 'system:migration'
      FROM ${q("_xecms_auth_subjects")} subject
      JOIN ${q("_xecms_identities")} identity ON identity.id = subject.identity_id
      JOIN ${q("_xecms_realms")} realm
        ON realm.id = subject.realm_id AND realm.workspace_id = identity.workspace_id
     WHERE subject.identity_id IS NOT NULL
    ON CONFLICT (identity_id, realm_id) DO NOTHING;

    ALTER TABLE ${q("_xecms_sessions")}
      ADD COLUMN IF NOT EXISTS audience text,
      ADD COLUMN IF NOT EXISTS realm_id text,
      ADD COLUMN IF NOT EXISTS membership_id text,
      ADD COLUMN IF NOT EXISTS subject_id text,
      ADD COLUMN IF NOT EXISTS authenticated_at timestamptz,
      ADD COLUMN IF NOT EXISTS credential_version bigint;
    UPDATE ${q("_xecms_sessions")} session
       SET audience = COALESCE(session.audience, 'admin'),
           realm_id = membership.realm_id,
           membership_id = membership.id,
           subject_id = membership.subject_id,
           authenticated_at = COALESCE(session.authenticated_at, session.created_at),
           credential_version = identity.credential_version
      FROM ${q("_xecms_identities")} identity
      JOIN ${q("_xecms_realm_memberships")} membership
        ON membership.identity_id = identity.id AND membership.status = 'active'
      JOIN ${q("_xecms_realms")} realm
        ON realm.id = membership.realm_id AND realm.kind = 'system' AND realm.status = 'active'
     WHERE session.identity_id = identity.id
       AND identity.disabled_at IS NULL
       AND (session.realm_id IS NULL OR session.membership_id IS NULL OR session.subject_id IS NULL
         OR session.authenticated_at IS NULL OR session.credential_version IS NULL OR session.audience IS NULL);

    DELETE FROM ${q("_xecms_sessions")}
     WHERE audience IS NULL OR realm_id IS NULL OR membership_id IS NULL OR subject_id IS NULL
        OR authenticated_at IS NULL OR credential_version IS NULL;

    ALTER TABLE ${q("_xecms_sessions")}
      ALTER COLUMN audience SET NOT NULL,
      ALTER COLUMN audience SET DEFAULT 'admin',
      ALTER COLUMN realm_id SET NOT NULL,
      ALTER COLUMN membership_id SET NOT NULL,
      ALTER COLUMN subject_id SET NOT NULL,
      ALTER COLUMN authenticated_at SET NOT NULL,
      ALTER COLUMN credential_version SET NOT NULL;
    ALTER TABLE ${q("_xecms_sessions")}
      DROP CONSTRAINT IF EXISTS _xecms_sessions_audience_check,
      DROP CONSTRAINT IF EXISTS _xecms_sessions_membership_fk;
    ALTER TABLE ${q("_xecms_sessions")}
      ADD CONSTRAINT _xecms_sessions_audience_check CHECK (audience IN ('admin', 'content')),
      ADD CONSTRAINT _xecms_sessions_membership_fk
        FOREIGN KEY (membership_id, identity_id, realm_id, subject_id)
        REFERENCES ${q("_xecms_realm_memberships")}(id, identity_id, realm_id, subject_id)
        ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS _xecms_sessions_membership
      ON ${q("_xecms_sessions")}(membership_id, expires_at);
    CREATE INDEX IF NOT EXISTS _xecms_sessions_realm_audience
      ON ${q("_xecms_sessions")}(realm_id, audience, expires_at);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_auth_collection_configs")} (
      collection_id text PRIMARY KEY,
      realm_id text NOT NULL UNIQUE REFERENCES ${q("_xecms_realms")}(id) ON DELETE RESTRICT,
      identifier_field_ids text[] NOT NULL CHECK (cardinality(identifier_field_ids) > 0),
      status text NOT NULL CHECK (status IN ('active', 'retired')),
      schema_revision_id text REFERENCES ${q("_xecms_schema_revisions")}(revision_id),
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_full_access_bindings")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE RESTRICT,
      system_identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      granted_by_identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      reason text NOT NULL CHECK (length(btrim(reason)) > 0),
      created_at timestamptz NOT NULL,
      valid_until timestamptz NOT NULL,
      revoked_at timestamptz,
      revoked_by_identity_id text REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      CHECK (valid_until > created_at),
      CHECK (valid_until <= created_at + interval '4 hours'),
      CHECK (revoked_at IS NULL OR revoked_at >= created_at),
      CHECK ((revoked_at IS NULL) = (revoked_by_identity_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_realm_full_access_active_system_identity
      ON ${q("_xecms_realm_full_access_bindings")}(realm_id, system_identity_id)
      WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS _xecms_realm_full_access_expiry
      ON ${q("_xecms_realm_full_access_bindings")}(realm_id, valid_until)
      WHERE revoked_at IS NULL;
  `);
}

/**
 * Replaces the retired Content data-plane Subject grant with the System
 * control-plane Identity grant. Legacy rows are archived verbatim and never
 * promoted to the new privilege model.
 */
export async function applyRealmControlPlaneAccessMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  const legacy = await client.query<{ readonly present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = '_xecms_realm_full_access_bindings'
          AND column_name = 'subject_id'
     ) AS present`,
    [schema],
  );

  if (legacy.rows[0]?.present === true) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_full_access_legacy_subject_bindings")} (
        id text PRIMARY KEY,
        realm_id text NOT NULL,
        subject_id text NOT NULL,
        granted_by_identity_id text NOT NULL,
        granted_by_subject_id text NOT NULL,
        reason text NOT NULL,
        created_at timestamptz NOT NULL,
        valid_until timestamptz,
        revoked_at timestamptz,
        revoked_by_identity_id text,
        archived_at timestamptz NOT NULL,
        archive_reason text NOT NULL
      );
      INSERT INTO ${q("_xecms_realm_full_access_legacy_subject_bindings")}
        (id, realm_id, subject_id, granted_by_identity_id, granted_by_subject_id,
         reason, created_at, valid_until, revoked_at, revoked_by_identity_id,
         archived_at, archive_reason)
      SELECT id, realm_id, subject_id, granted_by_identity_id, granted_by_subject_id,
             reason, created_at, valid_until, revoked_at, revoked_by_identity_id,
             now(), 'content-data-plane-full-access-retired'
        FROM ${q("_xecms_realm_full_access_bindings")}
      ON CONFLICT (id) DO NOTHING;
      DROP TABLE ${q("_xecms_realm_full_access_bindings")};
    `);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_realm_full_access_bindings")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE RESTRICT,
      system_identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      granted_by_identity_id text NOT NULL REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      reason text NOT NULL CHECK (length(btrim(reason)) > 0),
      created_at timestamptz NOT NULL,
      valid_until timestamptz NOT NULL,
      revoked_at timestamptz,
      revoked_by_identity_id text REFERENCES ${q("_xecms_identities")}(id) ON DELETE RESTRICT,
      CHECK (valid_until > created_at),
      CHECK (valid_until <= created_at + interval '4 hours'),
      CHECK (revoked_at IS NULL OR revoked_at >= created_at),
      CHECK ((revoked_at IS NULL) = (revoked_by_identity_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_realm_full_access_active_system_identity
      ON ${q("_xecms_realm_full_access_bindings")}(realm_id, system_identity_id)
      WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS _xecms_realm_full_access_expiry
      ON ${q("_xecms_realm_full_access_bindings")}(realm_id, valid_until)
      WHERE revoked_at IS NULL;
  `);
}
