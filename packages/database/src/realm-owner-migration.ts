import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

export const REALM_OWNER_MODEL_MIGRATION_ID = "0022_m4_realm_owner_model";

/**
 * Promotes the historical Content Realm provisioner above the human Owner
 * Role. The old protected owner grant is never handed to a person: it becomes
 * the deterministic System Policy Root grant, while the human Owner Role starts
 * unassigned (or preserves an already-human legacy target as Primary Owner).
 */
export async function applyRealmOwnerModelMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);

  await client.query(`
    CREATE TEMP TABLE _xecms_realm_owner_model_targets ON COMMIT DROP AS
    SELECT realm.id AS realm_id,
           realm.workspace_id,
           state.current_revision,
           state.root_resource_id,
           'authorization:' || realm.id || ':subject:provisioner' AS provisioner_id,
           'authorization:' || realm.id || ':level:owner' AS owner_level_id,
           'authorization:' || realm.id || ':role:owner' AS owner_role_id,
           'authorization:' || realm.id || ':binding:owner' AS legacy_binding_id,
           'authorization:' || realm.id || ':level:system-policy-root' AS root_level_id,
           'authorization:' || realm.id || ':role:system-policy-root' AS root_role_id,
           'authorization:' || realm.id || ':binding:system-policy-root' AS root_binding_id,
           'authorization:' || realm.id || ':binding:primary-owner' AS primary_owner_binding_id
      FROM ${q("_xecms_realms")} realm
      JOIN ${q("_xecms_auth_policy_state")} state
        ON state.realm_id = realm.id AND state.current_revision > 0
     WHERE realm.kind = 'content';

    -- Never mark the migration complete for a partially missing or corrupted
    -- legacy foundation. In particular, promoting a user-like provisioner to
    -- System Policy Root would turn policy damage into a privilege escalation.
    DO $realm_owner_model_preflight$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM _xecms_realm_owner_model_targets target
          LEFT JOIN ${q("_xecms_auth_subjects")} provisioner
            ON provisioner.realm_id = target.realm_id
           AND provisioner.id = target.provisioner_id
          LEFT JOIN ${q("_xecms_auth_authority_levels")} owner_level
            ON owner_level.realm_id = target.realm_id
           AND owner_level.id = target.owner_level_id
          LEFT JOIN ${q("_xecms_auth_roles")} owner_role
            ON owner_role.realm_id = target.realm_id
           AND owner_role.id = target.owner_role_id
         WHERE target.root_resource_id IS NULL
            OR provisioner.id IS NULL
            OR provisioner.subject_type <> 'service-account'
            OR provisioner.identity_id IS NOT NULL
            OR provisioner.protected <> true
            OR provisioner.disabled_at IS NOT NULL
            OR owner_level.id IS NULL
            OR owner_level.rank <> 100
            OR owner_level.protected <> true
            OR owner_role.id IS NULL
            OR owner_role.level_id <> target.owner_level_id
            OR owner_role.protected <> true
            OR NOT EXISTS (
              SELECT 1 FROM ${q("_xecms_auth_role_permissions")} permission
               WHERE permission.realm_id = target.realm_id
                 AND permission.role_id = target.owner_role_id
                 AND permission.permission_key = 'authorization.manage'
            )
            OR NOT EXISTS (
              SELECT 1 FROM ${q("_xecms_auth_role_permissions")} permission
               WHERE permission.realm_id = target.realm_id
                 AND permission.role_id = target.owner_role_id
                 AND permission.permission_key = 'schema.apply'
            )
            OR NOT EXISTS (
              SELECT 1 FROM ${q("_xecms_auth_role_permissions")} permission
               WHERE permission.realm_id = target.realm_id
                 AND permission.role_id = target.owner_role_id
                 AND permission.permission_key = 'role.assign'
            )
      ) THEN
        RAISE EXCEPTION 'Cannot migrate a damaged Content Realm authorization foundation';
      END IF;
    END;
    $realm_owner_model_preflight$;

    INSERT INTO ${q("_xecms_auth_authority_levels")}
      (id, realm_id, name, rank, protected, created_at, created_by, updated_at, updated_by)
    SELECT root_level_id, realm_id, 'System Policy Root', 110, true, now(),
           provisioner_id, now(), provisioner_id
      FROM _xecms_realm_owner_model_targets
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      rank = EXCLUDED.rank,
      protected = true,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

    INSERT INTO ${q("_xecms_auth_roles")}
      (id, realm_id, level_id, name, description, protected, field_access_restricted,
       created_at, created_by, updated_at, updated_by)
    SELECT target.root_role_id, target.realm_id, target.root_level_id,
           'System Policy Root', 'Internal trusted policy root; not assignable or visible.',
           true, owner_role.field_access_restricted, now(), target.provisioner_id,
           now(), target.provisioner_id
      FROM _xecms_realm_owner_model_targets target
      JOIN ${q("_xecms_auth_roles")} owner_role
        ON owner_role.realm_id = target.realm_id AND owner_role.id = target.owner_role_id
    ON CONFLICT (id) DO UPDATE SET
      level_id = EXCLUDED.level_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      protected = true,
      field_access_restricted = EXCLUDED.field_access_restricted,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

    -- The hidden root Role must be an exact copy of the protected Owner Role,
    -- not a merge with permissions left behind by an interrupted/dev build.
    DELETE FROM ${q("_xecms_auth_role_delegations")} delegation
     USING _xecms_realm_owner_model_targets target
     WHERE delegation.realm_id = target.realm_id
       AND delegation.role_id = target.root_role_id;
    DELETE FROM ${q("_xecms_auth_role_field_access")} field_access
     USING _xecms_realm_owner_model_targets target
     WHERE field_access.realm_id = target.realm_id
       AND field_access.role_id = target.root_role_id;
    DELETE FROM ${q("_xecms_auth_role_permissions")} permission
     USING _xecms_realm_owner_model_targets target
     WHERE permission.realm_id = target.realm_id
       AND permission.role_id = target.root_role_id;

    INSERT INTO ${q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
    SELECT target.realm_id, target.root_role_id, permission.permission_key
      FROM _xecms_realm_owner_model_targets target
      JOIN ${q("_xecms_auth_role_permissions")} permission
        ON permission.realm_id = target.realm_id AND permission.role_id = target.owner_role_id
    ON CONFLICT DO NOTHING;

    INSERT INTO ${q("_xecms_auth_role_delegations")}(realm_id, role_id, permission_key)
    SELECT target.realm_id, target.root_role_id, delegation.permission_key
      FROM _xecms_realm_owner_model_targets target
      JOIN ${q("_xecms_auth_role_delegations")} delegation
        ON delegation.realm_id = target.realm_id AND delegation.role_id = target.owner_role_id
    ON CONFLICT DO NOTHING;

    INSERT INTO ${q("_xecms_auth_role_field_access")}
      (realm_id, role_id, resource_id, readable_fields, writable_fields)
    SELECT target.realm_id, target.root_role_id, field_access.resource_id,
           field_access.readable_fields, field_access.writable_fields
      FROM _xecms_realm_owner_model_targets target
      JOIN ${q("_xecms_auth_role_field_access")} field_access
        ON field_access.realm_id = target.realm_id AND field_access.role_id = target.owner_role_id
    ON CONFLICT DO NOTHING;

    -- No user or second service grant may retain the hidden root Role.
    DELETE FROM ${q("_xecms_auth_role_bindings")} binding
     USING _xecms_realm_owner_model_targets target
     WHERE binding.realm_id = target.realm_id
       AND binding.role_id = target.root_role_id
       AND binding.id <> target.root_binding_id;

    INSERT INTO ${q("_xecms_auth_role_bindings")}
      (id, realm_id, subject_id, role_id, resource_id, propagation, valid_from,
       valid_until, constraints, protected, created_at, created_by, updated_at, updated_by)
    SELECT root_binding_id, realm_id, provisioner_id, root_role_id, root_resource_id,
           'self-and-children', NULL, NULL, '{}'::jsonb, true, now(), provisioner_id,
           now(), provisioner_id
      FROM _xecms_realm_owner_model_targets
    ON CONFLICT (id) DO UPDATE SET
      subject_id = EXCLUDED.subject_id,
      role_id = EXCLUDED.role_id,
      resource_id = EXCLUDED.resource_id,
      propagation = EXCLUDED.propagation,
      valid_from = NULL,
      valid_until = NULL,
      constraints = '{}'::jsonb,
      protected = true,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

    CREATE TEMP TABLE _xecms_realm_owner_eligible_subjects ON COMMIT DROP AS
    SELECT DISTINCT target.realm_id, subject.id AS subject_id
      FROM _xecms_realm_owner_model_targets target
      JOIN ${q("_xecms_realms")} content_realm
        ON content_realm.id = target.realm_id
       AND content_realm.workspace_id = target.workspace_id
       AND content_realm.kind = 'content'
       AND content_realm.status = 'active'
      JOIN ${q("_xecms_auth_subjects")} subject
        ON subject.realm_id = target.realm_id
       AND subject.subject_type = 'user'
       AND subject.identity_id IS NOT NULL
       AND subject.protected = false
       AND subject.disabled_at IS NULL
      JOIN ${q("_xecms_realm_memberships")} membership
        ON membership.workspace_id = target.workspace_id
       AND membership.realm_id = target.realm_id
       AND membership.subject_id = subject.id
       AND membership.identity_id = subject.identity_id
       AND membership.status = 'active'
      JOIN ${q("_xecms_identities")} identity
        ON identity.workspace_id = target.workspace_id
       AND identity.id = subject.identity_id
       AND identity.identity_kind = 'human'
       AND identity.is_owner = false
       AND identity.disabled_at IS NULL
      JOIN ${q("_xecms_realm_memberships")} system_membership
        ON system_membership.workspace_id = target.workspace_id
       AND system_membership.identity_id = identity.id
       AND system_membership.status = 'active'
      JOIN ${q("_xecms_realms")} system_realm
        ON system_realm.workspace_id = target.workspace_id
       AND system_realm.id = system_membership.realm_id
       AND system_realm.kind = 'system'
       AND system_realm.status = 'active'
      JOIN ${q("_xecms_auth_subjects")} system_subject
        ON system_subject.realm_id = system_realm.id
       AND system_subject.id = system_membership.subject_id
       AND system_subject.identity_id = identity.id
       AND system_subject.subject_type = 'user'
       AND system_subject.disabled_at IS NULL;

    -- An interrupted development build may already have the deterministic
    -- Binding. Keep it only when the linked person is still an eligible System
    -- operator, and normalize its complete protected shape.
    DELETE FROM ${q("_xecms_auth_role_bindings")} primary_owner
     USING _xecms_realm_owner_model_targets target
     WHERE primary_owner.realm_id = target.realm_id
       AND primary_owner.id = target.primary_owner_binding_id
       AND NOT EXISTS (
         SELECT 1 FROM _xecms_realm_owner_eligible_subjects eligible
          WHERE eligible.realm_id = target.realm_id
            AND eligible.subject_id = primary_owner.subject_id
       );

    -- A development build may instead have retargeted the historical binding
    -- to a person. Preserve only an eligible human as Primary Owner.
    UPDATE ${q("_xecms_auth_role_bindings")} legacy
       SET id = target.primary_owner_binding_id,
           role_id = target.owner_role_id,
           resource_id = target.root_resource_id,
           propagation = 'self-and-children',
           valid_from = NULL,
           valid_until = NULL,
           constraints = '{}'::jsonb,
           protected = true,
           updated_at = now(),
           updated_by = target.provisioner_id
      FROM _xecms_realm_owner_model_targets target
      JOIN _xecms_realm_owner_eligible_subjects eligible
        ON eligible.realm_id = target.realm_id
     WHERE legacy.realm_id = target.realm_id
       AND legacy.id = target.legacy_binding_id
       AND legacy.subject_id = eligible.subject_id
       AND NOT EXISTS (
         SELECT 1 FROM ${q("_xecms_auth_role_bindings")} primary_owner
          WHERE primary_owner.realm_id = target.realm_id
            AND primary_owner.id = target.primary_owner_binding_id
       );

    UPDATE ${q("_xecms_auth_role_bindings")} primary_owner
       SET role_id = target.owner_role_id,
           resource_id = target.root_resource_id,
           propagation = 'self-and-children',
           valid_from = NULL,
           valid_until = NULL,
           constraints = '{}'::jsonb,
           protected = true,
           updated_at = now(),
           updated_by = target.provisioner_id
      FROM _xecms_realm_owner_model_targets target
     WHERE primary_owner.realm_id = target.realm_id
       AND primary_owner.id = target.primary_owner_binding_id;

    -- Owner is a singleton protected Binding. Unknown/duplicate legacy grants
    -- are removed fail-closed; CMS Owner can recover an intentionally ownerless
    -- Realm through the dedicated recovery command.
    DELETE FROM ${q("_xecms_auth_role_bindings")} legacy
     USING _xecms_realm_owner_model_targets target
     WHERE legacy.realm_id = target.realm_id
       AND legacy.role_id = target.owner_role_id
       AND legacy.id <> target.primary_owner_binding_id;

    INSERT INTO ${q("_xecms_auth_policy_revisions")}
      (realm_id, revision, actor_subject_id, change_kind, target_type, target_id, occurred_at)
    SELECT realm_id, current_revision + 1, provisioner_id,
           'policy.realm-owner-model.migrate', 'policy', realm_id, now()
      FROM _xecms_realm_owner_model_targets;

    INSERT INTO ${q("_xecms_auth_audit_log")}
      (id, realm_id, policy_revision, actor_subject_id, action, target_type,
       target_id, before_state, after_state, decision, occurred_at)
    SELECT 'audit_realm_owner_model_' || md5(realm_id), realm_id,
           current_revision + 1, provisioner_id, 'policy.realm-owner-model.migrate',
           'policy', realm_id,
           jsonb_build_object('legacyOwnerBindingId', legacy_binding_id),
           jsonb_build_object('systemPolicyRootBindingId', root_binding_id,
                              'primaryOwnerBindingId', primary_owner_binding_id),
           NULL, now()
      FROM _xecms_realm_owner_model_targets;

    INSERT INTO ${q("_xecms_outbox_events")}
      (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id,
       aggregate_version, actor_subject_id, occurred_at, payload, created_at)
    SELECT 'outbox_realm_owner_model_' || md5(realm_id), workspace_id, realm_id,
           'authorization.policy.migrated', 'authorization', realm_id,
           current_revision + 1, provisioner_id, now(),
           jsonb_build_object('action', 'policy.realm-owner-model.migrate'), now()
      FROM _xecms_realm_owner_model_targets;

    UPDATE ${q("_xecms_auth_policy_state")} state
       SET current_revision = target.current_revision + 1,
           updated_at = now()
      FROM _xecms_realm_owner_model_targets target
     WHERE state.realm_id = target.realm_id
       AND state.current_revision = target.current_revision;
  `);
}
