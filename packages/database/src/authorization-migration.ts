import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

/**
 * Creates the normalized M3 authorization graph. Policy JSON is deliberately
 * not a source of truth: JSONB is limited to constraints and immutable audit
 * payloads, while PostgreSQL constraints protect the live graph.
 */
export async function applyAuthorizationMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE ${q("_xecms_auth_subjects")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      subject_type text NOT NULL CHECK (subject_type IN ('user', 'group', 'service-account')),
      display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
      identity_id text REFERENCES ${q("_xecms_identities")}(id) ON DELETE SET NULL,
      protected boolean NOT NULL DEFAULT false,
      disabled_at timestamptz,
      created_at timestamptz NOT NULL,
      created_by text,
      updated_at timestamptz NOT NULL,
      updated_by text,
      UNIQUE (realm_id, id)
    );
    CREATE UNIQUE INDEX _xecms_auth_subject_identity_realm
      ON ${q("_xecms_auth_subjects")}(realm_id, identity_id)
      WHERE identity_id IS NOT NULL;
    CREATE INDEX _xecms_auth_subjects_realm_type
      ON ${q("_xecms_auth_subjects")}(realm_id, subject_type, display_name, id);

    CREATE TABLE ${q("_xecms_auth_group_members")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL,
      group_subject_id text NOT NULL,
      member_subject_id text NOT NULL,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      UNIQUE (realm_id, id),
      UNIQUE (realm_id, group_subject_id, member_subject_id),
      FOREIGN KEY (realm_id, group_subject_id)
        REFERENCES ${q("_xecms_auth_subjects")}(realm_id, id) ON DELETE CASCADE,
      FOREIGN KEY (realm_id, member_subject_id)
        REFERENCES ${q("_xecms_auth_subjects")}(realm_id, id) ON DELETE CASCADE,
      CHECK (group_subject_id <> member_subject_id)
    );
    CREATE INDEX _xecms_auth_group_members_member
      ON ${q("_xecms_auth_group_members")}(realm_id, member_subject_id, group_subject_id);

    CREATE TABLE ${q("_xecms_auth_group_ancestors")} (
      realm_id text NOT NULL,
      ancestor_group_id text NOT NULL,
      descendant_subject_id text NOT NULL,
      depth integer NOT NULL CHECK (depth >= 0),
      membership_path text[] NOT NULL CHECK (cardinality(membership_path) = depth + 1),
      PRIMARY KEY (realm_id, ancestor_group_id, descendant_subject_id),
      FOREIGN KEY (realm_id, ancestor_group_id)
        REFERENCES ${q("_xecms_auth_subjects")}(realm_id, id) ON DELETE CASCADE,
      FOREIGN KEY (realm_id, descendant_subject_id)
        REFERENCES ${q("_xecms_auth_subjects")}(realm_id, id) ON DELETE CASCADE
    );
    CREATE INDEX _xecms_auth_group_ancestors_descendant
      ON ${q("_xecms_auth_group_ancestors")}(realm_id, descendant_subject_id, ancestor_group_id);

    CREATE TABLE ${q("_xecms_auth_resources")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(btrim(name)) > 0),
      resource_type text NOT NULL CHECK (length(btrim(resource_type)) > 0),
      parent_id text,
      external_type text,
      external_id text,
      protected boolean NOT NULL DEFAULT false,
      attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
      retired_at timestamptz,
      created_at timestamptz NOT NULL,
      created_by text,
      updated_at timestamptz NOT NULL,
      updated_by text,
      UNIQUE (realm_id, id),
      FOREIGN KEY (realm_id, parent_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id) DEFERRABLE INITIALLY DEFERRED,
      CHECK ((external_type IS NULL) = (external_id IS NULL))
    );
    CREATE UNIQUE INDEX _xecms_auth_resource_external
      ON ${q("_xecms_auth_resources")}(realm_id, external_type, external_id)
      WHERE external_type IS NOT NULL;
    CREATE INDEX _xecms_auth_resources_parent
      ON ${q("_xecms_auth_resources")}(realm_id, parent_id, id);

    CREATE TABLE ${q("_xecms_auth_resource_ancestors")} (
      realm_id text NOT NULL,
      ancestor_resource_id text NOT NULL,
      descendant_resource_id text NOT NULL,
      depth integer NOT NULL CHECK (depth >= 0),
      PRIMARY KEY (realm_id, ancestor_resource_id, descendant_resource_id),
      FOREIGN KEY (realm_id, ancestor_resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id) ON DELETE CASCADE,
      FOREIGN KEY (realm_id, descendant_resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id) ON DELETE CASCADE
    );
    CREATE INDEX _xecms_auth_resource_ancestors_descendant
      ON ${q("_xecms_auth_resource_ancestors")}(realm_id, descendant_resource_id, depth);

    CREATE TABLE ${q("_xecms_auth_authority_levels")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(btrim(name)) > 0),
      rank bigint NOT NULL CHECK (rank >= 0),
      protected boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      UNIQUE (realm_id, id),
      UNIQUE (realm_id, rank),
      UNIQUE (realm_id, name)
    );

    CREATE TABLE ${q("_xecms_auth_permissions")} (
      permission_key text PRIMARY KEY CHECK (length(btrim(permission_key)) > 0),
      hierarchy_guard text NOT NULL
        CHECK (hierarchy_guard IN ('none', 'target-role', 'target-binding', 'target-subject')),
      delegatable boolean NOT NULL,
      protected boolean NOT NULL DEFAULT false,
      label text,
      retired_at timestamptz,
      created_at timestamptz NOT NULL
    );

    CREATE TABLE ${q("_xecms_auth_roles")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      level_id text NOT NULL,
      name text NOT NULL CHECK (length(btrim(name)) > 0),
      description text,
      protected boolean NOT NULL DEFAULT false,
      field_access_restricted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      UNIQUE (realm_id, id),
      UNIQUE (realm_id, name),
      FOREIGN KEY (realm_id, level_id)
        REFERENCES ${q("_xecms_auth_authority_levels")}(realm_id, id)
    );
    CREATE INDEX _xecms_auth_roles_level
      ON ${q("_xecms_auth_roles")}(realm_id, level_id, name, id);

    CREATE TABLE ${q("_xecms_auth_role_permissions")} (
      realm_id text NOT NULL,
      role_id text NOT NULL,
      permission_key text NOT NULL REFERENCES ${q("_xecms_auth_permissions")}(permission_key),
      PRIMARY KEY (realm_id, role_id, permission_key),
      FOREIGN KEY (realm_id, role_id)
        REFERENCES ${q("_xecms_auth_roles")}(realm_id, id) ON DELETE CASCADE
    );
    CREATE INDEX _xecms_auth_role_permissions_key
      ON ${q("_xecms_auth_role_permissions")}(permission_key, realm_id, role_id);

    CREATE TABLE ${q("_xecms_auth_role_delegations")} (
      realm_id text NOT NULL,
      role_id text NOT NULL,
      permission_key text NOT NULL REFERENCES ${q("_xecms_auth_permissions")}(permission_key),
      PRIMARY KEY (realm_id, role_id, permission_key),
      FOREIGN KEY (realm_id, role_id)
        REFERENCES ${q("_xecms_auth_roles")}(realm_id, id) ON DELETE CASCADE,
      FOREIGN KEY (realm_id, role_id, permission_key)
        REFERENCES ${q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
        ON DELETE CASCADE
    );

    CREATE TABLE ${q("_xecms_auth_role_field_access")} (
      realm_id text NOT NULL,
      role_id text NOT NULL,
      resource_id text NOT NULL,
      readable_fields text[] NOT NULL DEFAULT '{}'::text[],
      writable_fields text[] NOT NULL DEFAULT '{}'::text[],
      PRIMARY KEY (realm_id, role_id, resource_id),
      FOREIGN KEY (realm_id, role_id)
        REFERENCES ${q("_xecms_auth_roles")}(realm_id, id) ON DELETE CASCADE,
      FOREIGN KEY (realm_id, resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id)
    );
    CREATE INDEX _xecms_auth_role_field_access_field
      ON ${q("_xecms_auth_role_field_access")}(realm_id, resource_id, role_id);

    CREATE TABLE ${q("_xecms_auth_role_bindings")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      subject_id text NOT NULL,
      role_id text NOT NULL,
      resource_id text NOT NULL,
      propagation text NOT NULL CHECK (propagation IN ('self', 'children', 'self-and-children')),
      valid_from timestamptz,
      valid_until timestamptz,
      constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(constraints) = 'object'),
      protected boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      updated_at timestamptz NOT NULL,
      updated_by text NOT NULL,
      UNIQUE (realm_id, id),
      FOREIGN KEY (realm_id, subject_id)
        REFERENCES ${q("_xecms_auth_subjects")}(realm_id, id),
      FOREIGN KEY (realm_id, role_id)
        REFERENCES ${q("_xecms_auth_roles")}(realm_id, id),
      FOREIGN KEY (realm_id, resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id),
      CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until)
    );
    CREATE INDEX _xecms_auth_bindings_subject
      ON ${q("_xecms_auth_role_bindings")}(realm_id, subject_id, role_id);
    CREATE INDEX _xecms_auth_bindings_resource
      ON ${q("_xecms_auth_role_bindings")}(realm_id, resource_id, role_id);

    CREATE TABLE ${q("_xecms_auth_policy_state")} (
      realm_id text PRIMARY KEY REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
      root_resource_id text,
      updated_at timestamptz NOT NULL,
      FOREIGN KEY (realm_id, root_resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id)
        DEFERRABLE INITIALLY DEFERRED,
      CHECK ((current_revision = 0) = (root_resource_id IS NULL))
    );
    INSERT INTO ${q("_xecms_auth_policy_state")}(realm_id, current_revision, root_resource_id, updated_at)
      SELECT id, 0, NULL, now() FROM ${q("_xecms_realms")}
      ON CONFLICT (realm_id) DO NOTHING;

    CREATE TABLE ${q("_xecms_auth_policy_revisions")} (
      realm_id text NOT NULL REFERENCES ${q("_xecms_realms")}(id) ON DELETE CASCADE,
      revision bigint NOT NULL CHECK (revision > 0),
      actor_subject_id text,
      change_kind text NOT NULL CHECK (length(btrim(change_kind)) > 0),
      target_type text NOT NULL CHECK (length(btrim(target_type)) > 0),
      target_id text,
      occurred_at timestamptz NOT NULL,
      PRIMARY KEY (realm_id, revision)
    );

    CREATE TABLE ${q("_xecms_auth_audit_log")} (
      id text PRIMARY KEY,
      realm_id text NOT NULL,
      policy_revision bigint NOT NULL,
      actor_subject_id text,
      action text NOT NULL CHECK (length(btrim(action)) > 0),
      target_type text NOT NULL CHECK (length(btrim(target_type)) > 0),
      target_id text,
      before_state jsonb,
      after_state jsonb,
      decision jsonb CHECK (decision IS NULL OR jsonb_typeof(decision) = 'object'),
      request_id text,
      occurred_at timestamptz NOT NULL,
      FOREIGN KEY (realm_id, policy_revision)
        REFERENCES ${q("_xecms_auth_policy_revisions")}(realm_id, revision)
    );
    CREATE INDEX _xecms_auth_audit_realm_time
      ON ${q("_xecms_auth_audit_log")}(realm_id, occurred_at DESC, id DESC);
    CREATE INDEX _xecms_auth_audit_target
      ON ${q("_xecms_auth_audit_log")}(realm_id, target_type, target_id, id DESC);
  `);
}

/**
 * Converges databases that ran an early development build of migration 0004.
 * It is intentionally idempotent so fresh databases and upgraded workspaces
 * end with exactly the same storage contract.
 */
export async function applyAuthorizationContractMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);

  await client.query(`
    ALTER TABLE ${q("_xecms_auth_resources")} ADD COLUMN IF NOT EXISTS name text;
    UPDATE ${q("_xecms_auth_resources")}
      SET name = COALESCE(NULLIF(external_id, ''), resource_type, id)
      WHERE name IS NULL;
    ALTER TABLE ${q("_xecms_auth_resources")} ALTER COLUMN name SET NOT NULL;

    ALTER TABLE ${q("_xecms_auth_roles")} ADD COLUMN IF NOT EXISTS description text;
    ALTER TABLE ${q("_xecms_auth_roles")}
      ADD COLUMN IF NOT EXISTS field_access_restricted boolean NOT NULL DEFAULT false;
    ALTER TABLE ${q("_xecms_auth_authority_levels")} ALTER COLUMN rank TYPE bigint;

    ALTER TABLE ${q("_xecms_auth_group_members")} ADD COLUMN IF NOT EXISTS id text;
    UPDATE ${q("_xecms_auth_group_members")}
      SET id = 'membership_legacy_' || md5(realm_id || ':' || group_subject_id || ':' || member_subject_id)
      WHERE id IS NULL;
    ALTER TABLE ${q("_xecms_auth_group_members")} ALTER COLUMN id SET NOT NULL;
    ALTER TABLE ${q("_xecms_auth_group_members")}
      DROP CONSTRAINT IF EXISTS _xecms_auth_group_members_pkey;
    ALTER TABLE ${q("_xecms_auth_group_members")}
      ADD CONSTRAINT _xecms_auth_group_members_pkey PRIMARY KEY (id);
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_auth_group_members_realm_id
      ON ${q("_xecms_auth_group_members")}(realm_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS _xecms_auth_group_members_edge
      ON ${q("_xecms_auth_group_members")}(realm_id, group_subject_id, member_subject_id);

  `);

  const policyRootColumn = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = '_xecms_auth_policy_state'
       AND column_name = 'root_resource_id'`,
    [schema],
  );
  if (policyRootColumn.rowCount === 0) {
    await client.query(`
      ALTER TABLE ${q("_xecms_auth_policy_state")}
        ADD COLUMN root_resource_id text;
      UPDATE ${q("_xecms_auth_policy_state")} state
        SET root_resource_id = roots.id
        FROM (
          SELECT realm_id, min(id) AS id
          FROM ${q("_xecms_auth_resources")}
          WHERE parent_id IS NULL
          GROUP BY realm_id
          HAVING count(*) = 1
        ) roots
        WHERE state.realm_id = roots.realm_id
          AND state.current_revision > 0;
      ALTER TABLE ${q("_xecms_auth_policy_state")}
        ADD CONSTRAINT _xecms_auth_policy_state_root_fk FOREIGN KEY (realm_id, root_resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id)
        DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE ${q("_xecms_auth_policy_state")}
        ADD CONSTRAINT _xecms_auth_policy_state_root_check
        CHECK ((current_revision = 0) = (root_resource_id IS NULL))
    `);
  }

  const legacyFieldAccess = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = '_xecms_auth_role_field_access'
       AND column_name = 'field_id'`,
    [schema],
  );
  if (legacyFieldAccess.rowCount !== 0) {
    const rows = await client.query(`SELECT 1 FROM ${q("_xecms_auth_role_field_access")} LIMIT 1`);
    if (rows.rowCount !== 0) {
      throw new Error("Cannot automatically migrate non-empty legacy authorization field access rows.");
    }
    await client.query(`
      DROP TABLE ${q("_xecms_auth_role_field_access")};
      CREATE TABLE ${q("_xecms_auth_role_field_access")} (
        realm_id text NOT NULL,
        role_id text NOT NULL,
        resource_id text NOT NULL,
        readable_fields text[] NOT NULL DEFAULT '{}'::text[],
        writable_fields text[] NOT NULL DEFAULT '{}'::text[],
        PRIMARY KEY (realm_id, role_id, resource_id),
        FOREIGN KEY (realm_id, role_id)
          REFERENCES ${q("_xecms_auth_roles")}(realm_id, id) ON DELETE CASCADE,
        FOREIGN KEY (realm_id, resource_id)
          REFERENCES ${q("_xecms_auth_resources")}(realm_id, id)
      );
      CREATE INDEX _xecms_auth_role_field_access_field
        ON ${q("_xecms_auth_role_field_access")}(realm_id, resource_id, role_id)
    `);
  }

  const auditId = await client.query<{ data_type: string; is_identity: string }>(
    `SELECT data_type, is_identity FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = '_xecms_auth_audit_log' AND column_name = 'id'`,
    [schema],
  );
  if (auditId.rows[0]?.data_type !== "text") {
    if (auditId.rows[0]?.is_identity === "YES") {
      await client.query(
        `ALTER TABLE ${q("_xecms_auth_audit_log")} ALTER COLUMN id DROP IDENTITY`,
      );
    }
    await client.query(
      `ALTER TABLE ${q("_xecms_auth_audit_log")} ALTER COLUMN id TYPE text USING id::text`,
    );
  }
  await client.query(`
    ALTER TABLE ${q("_xecms_auth_audit_log")} ALTER COLUMN decision DROP NOT NULL;
    ALTER TABLE ${q("_xecms_auth_audit_log")} ALTER COLUMN decision DROP DEFAULT
  `);
}

/** Final convergence for development databases that applied 0005 early. */
export async function applyAuthorizationStorageFinalization(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    ALTER TABLE ${q("_xecms_auth_authority_levels")} ALTER COLUMN rank TYPE bigint;
    ALTER TABLE ${q("_xecms_auth_role_field_access")}
      DROP CONSTRAINT IF EXISTS _xecms_auth_role_field_access_check
  `);
}

/** Historical actor IDs must survive Subject deletion for forensic audit. */
export async function applyAuthorizationAuditRetentionMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    ALTER TABLE ${q("_xecms_auth_policy_revisions")}
      DROP CONSTRAINT IF EXISTS _xecms_auth_policy_revisions_realm_id_actor_subject_id_fkey;
    ALTER TABLE ${q("_xecms_auth_audit_log")}
      DROP CONSTRAINT IF EXISTS _xecms_auth_audit_log_realm_id_actor_subject_id_fkey
  `);
}

/** Durable fail-closed fence used while hierarchy and policy projections converge. */
export async function applyAuthorizationResourceQuarantineMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_auth_resource_quarantine")} (
      realm_id text NOT NULL,
      resource_id text NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) > 0),
      quarantined_at timestamptz NOT NULL,
      actor_subject_id text,
      PRIMARY KEY (realm_id, resource_id),
      FOREIGN KEY (realm_id, resource_id)
        REFERENCES ${q("_xecms_auth_resources")}(realm_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS _xecms_auth_resource_quarantine_time
      ON ${q("_xecms_auth_resource_quarantine")}(quarantined_at, realm_id, resource_id)
  `);
}
