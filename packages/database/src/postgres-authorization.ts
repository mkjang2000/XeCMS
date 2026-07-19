import {
  ApplicationError,
  type AuthorizationAuditDraft,
  type AuthorizationAuditPage,
  type AuthorizationAuditRecord,
  type AuthorizationBindingRecord,
  type AuthorizationGroupMembershipRecord,
  type AuthorizationLevelRecord,
  type AuthorizationPermissionRecord,
  type AuthorizationPolicyMutation,
  type AuthorizationPolicySeed,
  type AuthorizationPolicyState,
  type AuthorizationRealmRecord,
  type AuthorizationResourceRecord,
  type AuthorizationRoleRecord,
  type AuthorizationStore,
  type AuthorizationSubjectRecord,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export class PostgresAuthorizationStore implements AuthorizationStore {
  public readonly schema: string;

  public constructor(
    public readonly pool: Pool,
    schema = "xecms",
  ) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async getPolicyRevision(realmId: string): Promise<number | null> {
    const result = await this.pool.query<{ current_revision: string | number }>(
      `SELECT current_revision
       FROM ${this.q("_xecms_auth_policy_state")}
       WHERE realm_id = $1`,
      [realmId],
    );
    const revision = Number(result.rows[0]?.current_revision ?? 0);
    return revision === 0 ? null : revision;
  }

  public async loadPolicy(realmId: string): Promise<AuthorizationPolicyState | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await this.loadPolicyWith(client, realmId);
      await client.query("COMMIT");
      return state;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAuthorizationDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async initialize(input: {
    readonly realmId: string;
    readonly expectedRevision: null;
    readonly state: AuthorizationPolicySeed;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    assertRealm(input.realmId, input.state.realm.id);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_policy_state")}
           (realm_id, current_revision, root_resource_id, updated_at)
         VALUES ($1, 0, NULL, $2)
         ON CONFLICT (realm_id) DO NOTHING`,
        [input.realmId, input.audit.occurredAt],
      );
      const current = await this.lockPolicyState(client, input.realmId);
      if (current !== 0) {
        throw new ApplicationError(
          "AUTHORIZATION_ALREADY_INITIALIZED",
          409,
          `Authorization policy for realm '${input.realmId}' is already initialized.`,
        );
      }

      await this.insertSeed(client, input.realmId, input.state, input.audit);
      await this.rebuildGroupClosure(client, input.realmId);
      await this.rebuildResourceClosure(client, input.realmId);
      await this.finishMutation(client, input.realmId, 1, "policy.initialize", input.audit);
      await client.query(
        `UPDATE ${this.q("_xecms_auth_policy_state")}
         SET current_revision = 1, root_resource_id = $2, updated_at = $3
         WHERE realm_id = $1`,
        [input.realmId, input.state.realm.rootResourceId, input.audit.occurredAt],
      );
      const state = await this.requireLoadedPolicy(client, input.realmId);
      await client.query("COMMIT");
      return state;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAuthorizationDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async mutatePolicy<TMutation extends AuthorizationPolicyMutation>(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly mutation: TMutation;
    readonly audit: AuthorizationAuditDraft;
  }): Promise<AuthorizationPolicyState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (input.mutation.type === "binding.replace-primary-owner") {
        // Lock eligibility rows before the policy state. Identity disable and
        // Membership suspension take those rows first as well; a consistent
        // order avoids deadlocks and closes the validation/CAS race.
        await this.lockEligiblePrimaryOwner(client, input.mutation.value);
      }
      const current = await this.lockPolicyState(client, input.realmId);
      if (current === 0) {
        throw new ApplicationError(
          "AUTHORIZATION_NOT_INITIALIZED",
          409,
          `Authorization policy for realm '${input.realmId}' is not initialized.`,
        );
      }
      if (current !== input.expectedRevision) {
        throw new ApplicationError(
          "AUTHORIZATION_POLICY_REVISION_CONFLICT",
          409,
          "The authorization policy changed after it was read.",
          { details: { expectedRevision: input.expectedRevision, actualRevision: current } },
        );
      }

      await this.applyMutation(client, input.realmId, input.mutation, input.audit);
      if (
        input.mutation.type.startsWith("group-membership.") ||
        input.mutation.type.startsWith("subject.")
      ) {
        await this.assertGroupGraphAcyclic(client, input.realmId);
        await this.rebuildGroupClosure(client, input.realmId);
      }
      if (input.mutation.type.startsWith("resource.")) {
        await this.assertResourceGraphAcyclic(client, input.realmId);
        await this.rebuildResourceClosure(client, input.realmId);
      }

      const revision = current + 1;
      await this.finishMutation(client, input.realmId, revision, input.mutation.type, input.audit);
      await client.query(
        `UPDATE ${this.q("_xecms_auth_policy_state")}
         SET current_revision = $2, updated_at = $3
         WHERE realm_id = $1`,
        [input.realmId, revision, input.audit.occurredAt],
      );
      const state = await this.requireLoadedPolicy(client, input.realmId);
      await client.query("COMMIT");
      return state;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAuthorizationDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async listAudit(input: {
    readonly realmId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<AuthorizationAuditPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
      throw new ApplicationError("AUDIT_PAGE_INVALID", 400, "Audit limit must be between 1 and 200.");
    }
    let cursor: { occurred_at: Date | string; id: string } | undefined;
    if (input.cursor !== undefined) {
      const result = await this.pool.query<{ occurred_at: Date | string; id: string }>(
        `SELECT occurred_at, id FROM ${this.q("_xecms_auth_audit_log")}
         WHERE realm_id = $1 AND id = $2`,
        [input.realmId, input.cursor],
      );
      cursor = result.rows[0];
      if (cursor === undefined) {
        throw new ApplicationError("AUDIT_CURSOR_INVALID", 400, "The audit cursor is invalid.");
      }
    }
    const result = await this.pool.query<AuditRow>(
      `SELECT id, realm_id, policy_revision, actor_subject_id, actor_identity_id,
              access_mode, full_access_binding_id, action, target_type,
              target_id, before_state, after_state, decision, occurred_at
       FROM ${this.q("_xecms_auth_audit_log")}
       WHERE realm_id = $1
         ${cursor === undefined ? "" : "AND (occurred_at, id) < ($3, $4)"}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $2`,
      cursor === undefined
        ? [input.realmId, input.limit + 1]
        : [input.realmId, input.limit + 1, cursor.occurred_at, cursor.id],
    );
    const hasMore = result.rows.length > input.limit;
    const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
    const items = rows.map(auditFromRow);
    const next = hasMore ? items.at(-1)?.id : undefined;
    return {
      items,
      ...(next === undefined ? {} : { nextCursor: next }),
    };
  }

  public async isResourceQuarantined(realmId: string, resourceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.q("_xecms_auth_resource_quarantine")}
       WHERE realm_id = $1 AND resource_id = $2`,
      [realmId, resourceId],
    );
    return result.rowCount === 1;
  }

  public async quarantineResources(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
    readonly reason: string;
    readonly actorSubjectId: string;
    readonly occurredAt: string;
  }): Promise<void> {
    const resourceIds = [...new Set(input.resourceIds)];
    if (resourceIds.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM ${this.q("_xecms_auth_resources")}
         WHERE realm_id = $1 AND id = ANY($2::text[]) FOR SHARE`,
        [input.realmId, resourceIds],
      );
      if (existing.rowCount !== resourceIds.length) {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_NOT_FOUND",
          409,
          "One or more resources could not be quarantined because their projection is missing.",
        );
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_resource_quarantine")}
           (realm_id, resource_id, reason, quarantined_at, actor_subject_id)
         SELECT $1, resource_id, $3, $4, $5 FROM unnest($2::text[]) AS resource_id
         ON CONFLICT (realm_id, resource_id) DO UPDATE SET
           reason = EXCLUDED.reason,
           quarantined_at = EXCLUDED.quarantined_at,
           actor_subject_id = EXCLUDED.actor_subject_id`,
        [input.realmId, resourceIds, input.reason, input.occurredAt, input.actorSubjectId],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAuthorizationDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async releaseResourceQuarantine(input: {
    readonly realmId: string;
    readonly resourceIds: readonly string[];
  }): Promise<void> {
    const resourceIds = [...new Set(input.resourceIds)];
    if (resourceIds.length === 0) return;
    await this.pool.query(
      `DELETE FROM ${this.q("_xecms_auth_resource_quarantine")}
       WHERE realm_id = $1 AND resource_id = ANY($2::text[])`,
      [input.realmId, resourceIds],
    );
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }

  private async lockPolicyState(client: PoolClient, realmId: string): Promise<number> {
    const result = await client.query<{ current_revision: string | number }>(
      `SELECT current_revision FROM ${this.q("_xecms_auth_policy_state")}
       WHERE realm_id = $1 FOR UPDATE`,
      [realmId],
    );
    if (result.rows[0] === undefined) {
      throw new ApplicationError("AUTHORIZATION_REALM_NOT_FOUND", 404, `Realm '${realmId}' was not found.`);
    }
    return Number(result.rows[0].current_revision);
  }

  private async insertSeed(
    client: PoolClient,
    realmId: string,
    seed: AuthorizationPolicySeed,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    if (seed.resources.every(({ id }) => id !== seed.realm.rootResourceId)) {
      throw new ApplicationError(
        "AUTHORIZATION_POLICY_INVALID",
        422,
        "The realm root resource is missing from the policy seed.",
      );
    }
    for (const subject of seed.subjects) {
      assertRealm(realmId, subject.realmId);
      await this.insertSubject(client, subject, audit);
    }
    for (const resource of seed.resources) {
      assertRealm(realmId, resource.realmId);
      await this.insertResource(client, resource, audit);
    }
    for (const level of seed.authorityLevels) {
      assertRealm(realmId, level.realmId);
      await this.insertLevel(client, level, audit);
    }
    for (const permission of seed.permissions) {
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_permissions")}
           (permission_key, hierarchy_guard, delegatable, protected, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (permission_key) DO NOTHING`,
        [permission.key, permission.hierarchyGuard, permission.delegatable, permission.protected === true, audit.occurredAt],
      );
      await this.assertPermissionDefinition(client, permission);
    }
    for (const role of seed.roles) {
      assertRealm(realmId, role.realmId);
      await this.insertRole(client, role, audit);
    }
    for (const membership of seed.groupMemberships) {
      assertRealm(realmId, membership.realmId);
      await this.insertGroupMembership(client, membership, audit);
    }
    await this.assertGroupGraphAcyclic(client, realmId);
    await this.assertResourceGraphAcyclic(client, realmId);
    for (const binding of seed.bindings) {
      assertRealm(realmId, binding.realmId);
      await this.insertBinding(client, binding, audit);
    }
  }

  private async applyMutation(
    client: PoolClient,
    realmId: string,
    mutation: AuthorizationPolicyMutation,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    switch (mutation.type) {
      case "subject.create":
        assertRealm(realmId, mutation.value.realmId);
        await this.insertSubject(client, mutation.value, audit);
        return;
      case "subject.update":
        assertRealm(realmId, mutation.value.realmId);
        await this.updateSubject(client, mutation.value, audit);
        return;
      case "subject.delete":
        await this.deleteById(client, "_xecms_auth_subjects", realmId, mutation.id);
        return;
      case "resource.upsert":
        assertRealm(realmId, mutation.value.realmId);
        await this.upsertResource(client, mutation.value, audit);
        return;
      case "resource.delete":
        await this.deleteById(client, "_xecms_auth_resources", realmId, mutation.id);
        return;
      case "resource.reconcile":
        for (const value of mutation.upserts) {
          assertRealm(realmId, value.realmId);
          await this.upsertResource(client, value, audit);
        }
        if (mutation.deleteIds.length > 0) {
          const referenced = await client.query<{ readonly resource_id: string }>(
            `SELECT resource_id
               FROM ${this.q("_xecms_auth_role_bindings")}
              WHERE realm_id = $1 AND resource_id = ANY($2::text[])
             UNION
             SELECT resource_id
               FROM ${this.q("_xecms_auth_role_field_access")}
              WHERE realm_id = $1 AND resource_id = ANY($2::text[])
              LIMIT 1`,
            [realmId, [...mutation.deleteIds]],
          );
          if (referenced.rowCount !== 0) {
            throw new ApplicationError(
              "AUTHORIZATION_RESOURCE_REFERENCED",
              409,
              "A referenced authorization resource must be retired before deletion.",
            );
          }
          const deleted = await client.query(
            `DELETE FROM ${this.q("_xecms_auth_resources")}
             WHERE realm_id = $1 AND id = ANY($2::text[])`,
            [realmId, [...mutation.deleteIds]],
          );
          if (deleted.rowCount !== mutation.deleteIds.length) {
            throw new ApplicationError(
              "AUTHORIZATION_RESOURCE_RECONCILE_CONFLICT",
              409,
              "The content resource projection changed while it was reconciled.",
            );
          }
        }
        return;
      case "authority-level.create":
        assertRealm(realmId, mutation.value.realmId);
        await this.insertLevel(client, mutation.value, audit);
        return;
      case "authority-level.update":
        assertRealm(realmId, mutation.value.realmId);
        await this.updateLevel(client, mutation.value, audit);
        return;
      case "authority-level.delete":
        await this.deleteById(client, "_xecms_auth_authority_levels", realmId, mutation.id);
        return;
      case "role.create":
        assertRealm(realmId, mutation.value.realmId);
        await this.insertRole(client, mutation.value, audit);
        return;
      case "role.update":
        assertRealm(realmId, mutation.value.realmId);
        await this.updateRole(client, mutation.value, audit);
        return;
      case "role.delete":
        await this.deleteById(client, "_xecms_auth_roles", realmId, mutation.id);
        return;
      case "binding.create":
        assertRealm(realmId, mutation.value.realmId);
        await this.insertBinding(client, mutation.value, audit);
        return;
      case "binding.update":
        assertRealm(realmId, mutation.value.realmId);
        await this.updateBinding(client, mutation.value, audit);
        return;
      case "binding.delete":
        await this.deleteById(client, "_xecms_auth_role_bindings", realmId, mutation.id);
        return;
      case "binding.replace-primary-owner":
        assertRealm(realmId, mutation.value.realmId);
        await this.replacePrimaryOwnerBinding(client, mutation.value, audit);
        return;
      case "group-membership.create":
        assertRealm(realmId, mutation.value.realmId);
        await this.insertGroupMembership(client, mutation.value, audit);
        return;
      case "group-membership.update":
        assertRealm(realmId, mutation.value.realmId);
        await this.updateGroupMembership(client, mutation.value, audit);
        return;
      case "group-membership.delete":
        await this.deleteById(client, "_xecms_auth_group_members", realmId, mutation.id);
        return;
    }
  }

  private async insertSubject(
    client: PoolClient,
    value: AuthorizationSubjectRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO ${this.q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, identity_id, protected, disabled_at,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9)`,
      [
        value.id,
        value.realmId,
        value.type,
        value.name,
        value.identityId ?? null,
        value.protected === true,
        value.disabled === true ? audit.occurredAt : null,
        audit.occurredAt,
        auditActorStorageId(audit),
      ],
    );
  }

  private async updateSubject(
    client: PoolClient,
    value: AuthorizationSubjectRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE ${this.q("_xecms_auth_subjects")}
       SET subject_type = $3, display_name = $4, identity_id = $5, protected = $6,
           disabled_at = CASE WHEN $7 THEN COALESCE(disabled_at, $8::timestamptz) ELSE NULL END,
           updated_at = $8, updated_by = $9
       WHERE realm_id = $1 AND id = $2`,
      [value.realmId, value.id, value.type, value.name, value.identityId ?? null,
        value.protected === true, value.disabled === true, audit.occurredAt, auditActorStorageId(audit)],
    );
    assertChanged(result.rowCount, "subject", value.id);
  }

  private async insertResource(
    client: PoolClient,
    value: AuthorizationResourceRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_resources")}
         (id, realm_id, name, resource_type, parent_id, protected, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $8)`,
      [value.id, value.realmId, value.name, value.type, value.parentId ?? null, value.protected === true, audit.occurredAt, auditActorStorageId(audit)],
    );
  }

  private async upsertResource(
    client: PoolClient,
    value: AuthorizationResourceRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const result = await client.query(
      `INSERT INTO ${this.q("_xecms_auth_resources")}
         (id, realm_id, name, resource_type, parent_id, protected, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         resource_type = EXCLUDED.resource_type,
         parent_id = EXCLUDED.parent_id,
         protected = EXCLUDED.protected,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by
       WHERE ${this.q("_xecms_auth_resources")}.realm_id = EXCLUDED.realm_id`,
      [value.id, value.realmId, value.name, value.type, value.parentId ?? null, value.protected === true, audit.occurredAt, auditActorStorageId(audit)],
    );
    assertChanged(result.rowCount, "resource", value.id);
  }

  private async insertLevel(
    client: PoolClient,
    value: AuthorizationLevelRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_authority_levels")}
         (id, realm_id, name, rank, protected, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7)`,
      [value.id, value.realmId, value.name, value.rank, value.protected === true, audit.occurredAt, auditActorStorageId(audit)],
    );
  }

  private async updateLevel(
    client: PoolClient,
    value: AuthorizationLevelRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE ${this.q("_xecms_auth_authority_levels")}
       SET name = $3, rank = $4, protected = $5, updated_at = $6, updated_by = $7
       WHERE realm_id = $1 AND id = $2`,
      [value.realmId, value.id, value.name, value.rank, value.protected === true, audit.occurredAt, auditActorStorageId(audit)],
    );
    assertChanged(result.rowCount, "authority level", value.id);
  }

  private async insertRole(
    client: PoolClient,
    value: AuthorizationRoleRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_roles")}
         (id, realm_id, level_id, name, description, protected, field_access_restricted,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9)`,
      [value.id, value.realmId, value.levelId, value.name, value.description ?? null, value.protected === true, value.fieldAccess !== undefined, audit.occurredAt, auditActorStorageId(audit)],
    );
    await this.replaceRoleRelations(client, value);
  }

  private async updateRole(
    client: PoolClient,
    value: AuthorizationRoleRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE ${this.q("_xecms_auth_roles")}
       SET level_id = $3, name = $4, description = $5, protected = $6, field_access_restricted = $7,
           updated_at = $8, updated_by = $9
       WHERE realm_id = $1 AND id = $2`,
      [value.realmId, value.id, value.levelId, value.name, value.description ?? null, value.protected === true, value.fieldAccess !== undefined, audit.occurredAt, auditActorStorageId(audit)],
    );
    assertChanged(result.rowCount, "role", value.id);
    await this.replaceRoleRelations(client, value);
  }

  private async replaceRoleRelations(client: PoolClient, value: AuthorizationRoleRecord): Promise<void> {
    await client.query(
      `DELETE FROM ${this.q("_xecms_auth_role_field_access")} WHERE realm_id = $1 AND role_id = $2`,
      [value.realmId, value.id],
    );
    await client.query(
      `DELETE FROM ${this.q("_xecms_auth_role_permissions")} WHERE realm_id = $1 AND role_id = $2`,
      [value.realmId, value.id],
    );
    for (const permission of value.permissions) {
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_role_permissions")}(realm_id, role_id, permission_key)
         VALUES ($1, $2, $3)`,
        [value.realmId, value.id, permission],
      );
    }
    for (const permission of value.delegatablePermissions) {
      const result = await client.query(
        `INSERT INTO ${this.q("_xecms_auth_role_delegations")}(realm_id, role_id, permission_key)
         SELECT $1, $2, permission_key
         FROM ${this.q("_xecms_auth_permissions")}
         WHERE permission_key = $3 AND delegatable = true AND protected = false`,
        [value.realmId, value.id, permission],
      );
      if (result.rowCount !== 1) {
        throw new ApplicationError(
          "AUTHORIZATION_DELEGATION_INVALID",
          422,
          `Permission '${permission}' cannot be delegated.`,
        );
      }
    }
    for (const rule of value.fieldAccess ?? []) {
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_role_field_access")}
           (realm_id, role_id, resource_id, readable_fields, writable_fields)
         VALUES ($1, $2, $3, $4::text[], $5::text[])`,
        [value.realmId, value.id, rule.resourceId, [...rule.readableFields], [...rule.writableFields]],
      );
    }
  }

  private async insertBinding(
    client: PoolClient,
    value: AuthorizationBindingRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_role_bindings")}
         (id, realm_id, subject_id, role_id, resource_id, propagation, valid_from, valid_until,
          constraints, protected, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $11, $12)`,
      [value.id, value.realmId, value.subjectId, value.roleId, value.resourceId, value.propagation,
        value.validFrom ?? null, value.validUntil ?? null, json(value.constraints ?? {}), value.protected === true,
        audit.occurredAt, auditActorStorageId(audit)],
    );
  }

  private async updateBinding(
    client: PoolClient,
    value: AuthorizationBindingRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE ${this.q("_xecms_auth_role_bindings")}
       SET subject_id = $3, role_id = $4, resource_id = $5, propagation = $6,
           valid_from = $7, valid_until = $8, constraints = $9::jsonb, protected = $10,
           updated_at = $11, updated_by = $12
       WHERE realm_id = $1 AND id = $2`,
      [value.realmId, value.id, value.subjectId, value.roleId, value.resourceId, value.propagation,
        value.validFrom ?? null, value.validUntil ?? null, json(value.constraints ?? {}), value.protected === true,
        audit.occurredAt, auditActorStorageId(audit)],
    );
    assertChanged(result.rowCount, "binding", value.id);
  }

  private async replacePrimaryOwnerBinding(
    client: PoolClient,
    value: AuthorizationBindingRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    const prefix = `authorization:${value.realmId}`;
    if (
      value.id !== `${prefix}:binding:primary-owner`
      || value.roleId !== `${prefix}:role:owner`
      || value.protected !== true
      || value.validFrom !== undefined
      || value.validUntil !== undefined
      || value.constraints !== undefined
      || value.propagation !== "self-and-children"
    ) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_BINDING_INVALID",
        409,
        "The trusted Primary Owner Binding shape is invalid.",
      );
    }

    await client.query(
      `DELETE FROM ${this.q("_xecms_auth_role_bindings")}
        WHERE realm_id = $1 AND role_id = $2`,
      [value.realmId, value.roleId],
    );
    await this.insertBinding(client, value, audit);
  }

  private async lockEligiblePrimaryOwner(
    client: PoolClient,
    value: AuthorizationBindingRecord,
  ): Promise<void> {
    // Recheck and lock every durable eligibility row in the same transaction
    // that switches the protected Binding. Concurrent suspension/disable waits
    // until this command commits, so a stale application precheck cannot make
    // an inactive identity the Realm Owner.
    const eligible = await client.query(
      `SELECT 1
         FROM ${this.q("_xecms_auth_subjects")} subject
         JOIN ${this.q("_xecms_realm_memberships")} membership
           ON membership.realm_id = subject.realm_id
          AND membership.subject_id = subject.id
          AND membership.identity_id = subject.identity_id
         JOIN ${this.q("_xecms_identities")} identity
           ON identity.id = membership.identity_id
          AND identity.workspace_id = membership.workspace_id
         JOIN ${this.q("_xecms_realms")} realm
           ON realm.id = membership.realm_id
          AND realm.workspace_id = membership.workspace_id
         JOIN ${this.q("_xecms_realm_memberships")} system_membership
           ON system_membership.identity_id = identity.id
          AND system_membership.workspace_id = identity.workspace_id
         JOIN ${this.q("_xecms_realms")} system_realm
           ON system_realm.id = system_membership.realm_id
          AND system_realm.workspace_id = system_membership.workspace_id
         JOIN ${this.q("_xecms_auth_subjects")} system_subject
           ON system_subject.realm_id = system_realm.id
          AND system_subject.id = system_membership.subject_id
          AND system_subject.identity_id = identity.id
        WHERE subject.realm_id = $1 AND subject.id = $2
          AND subject.subject_type = 'user' AND subject.identity_id IS NOT NULL
          AND subject.protected = false AND subject.disabled_at IS NULL
          AND membership.status = 'active'
          AND identity.disabled_at IS NULL AND identity.identity_kind = 'human'
          AND identity.is_owner = false
          AND realm.kind = 'content' AND realm.status = 'active'
          AND system_realm.kind = 'system' AND system_realm.status = 'active'
          AND system_membership.status = 'active'
          AND system_subject.subject_type = 'user'
          AND system_subject.disabled_at IS NULL
        FOR UPDATE OF subject, membership, identity, system_membership, system_subject`,
      [value.realmId, value.subjectId],
    );
    if (eligible.rowCount !== 1) {
      throw new ApplicationError(
        "REALM_PRIMARY_OWNER_SUBJECT_INELIGIBLE",
        409,
        "A Primary Realm Owner must be an active identity-linked System operator.",
      );
    }
  }

  private async insertGroupMembership(
    client: PoolClient,
    value: AuthorizationGroupMembershipRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await this.assertGroupSubject(client, value.realmId, value.groupSubjectId);
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_group_members")}
         (id, realm_id, group_subject_id, member_subject_id, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [value.id, value.realmId, value.groupSubjectId, value.memberSubjectId, audit.occurredAt, auditActorStorageId(audit)],
    );
  }

  private async updateGroupMembership(
    client: PoolClient,
    value: AuthorizationGroupMembershipRecord,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await this.assertGroupSubject(client, value.realmId, value.groupSubjectId);
    const result = await client.query(
      `UPDATE ${this.q("_xecms_auth_group_members")}
       SET group_subject_id = $3, member_subject_id = $4
       WHERE realm_id = $1 AND id = $2`,
      [value.realmId, value.id, value.groupSubjectId, value.memberSubjectId],
    );
    assertChanged(result.rowCount, "group membership", value.id);
  }

  private async assertGroupSubject(client: PoolClient, realmId: string, subjectId: string): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM ${this.q("_xecms_auth_subjects")}
       WHERE realm_id = $1 AND id = $2 AND subject_type = 'group'`,
      [realmId, subjectId],
    );
    if (result.rowCount !== 1) {
      throw new ApplicationError(
        "AUTHORIZATION_GROUP_REQUIRED",
        422,
        `Subject '${subjectId}' is not a group in realm '${realmId}'.`,
      );
    }
  }

  private async assertPermissionDefinition(
    client: PoolClient,
    permission: AuthorizationPermissionRecord,
  ): Promise<void> {
    const result = await client.query<PermissionRow>(
      `SELECT permission_key, hierarchy_guard, delegatable, protected
       FROM ${this.q("_xecms_auth_permissions")} WHERE permission_key = $1`,
      [permission.key],
    );
    const actual = result.rows[0];
    if (
      actual === undefined ||
      actual.hierarchy_guard !== permission.hierarchyGuard ||
      actual.delegatable !== permission.delegatable ||
      actual.protected !== (permission.protected === true)
    ) {
      throw new ApplicationError(
        "AUTHORIZATION_PERMISSION_CONFLICT",
        409,
        `Permission '${permission.key}' is registered with a different definition.`,
      );
    }
  }

  private async deleteById(
    client: PoolClient,
    table: string,
    realmId: string,
    id: string,
  ): Promise<void> {
    const result = await client.query(
      `DELETE FROM ${this.q(table)} WHERE realm_id = $1 AND id = $2`,
      [realmId, id],
    );
    assertChanged(result.rowCount, "authorization object", id);
  }

  private async assertGroupGraphAcyclic(client: PoolClient, realmId: string): Promise<void> {
    const result = await client.query(
      `WITH RECURSIVE reach(ancestor_id, descendant_id) AS (
         SELECT group_subject_id, member_subject_id
         FROM ${this.q("_xecms_auth_group_members")}
         WHERE realm_id = $1
         UNION
         SELECT reach.ancestor_id, members.member_subject_id
         FROM reach
         JOIN ${this.q("_xecms_auth_group_members")} members
           ON members.realm_id = $1 AND members.group_subject_id = reach.descendant_id
       )
       SELECT 1 FROM reach WHERE ancestor_id = descendant_id LIMIT 1`,
      [realmId],
    );
    if (result.rowCount !== 0) {
      throw new ApplicationError("AUTHORIZATION_GROUP_CYCLE", 422, "Group membership would create a cycle.");
    }
  }

  private async rebuildGroupClosure(client: PoolClient, realmId: string): Promise<void> {
    await client.query(
      `DELETE FROM ${this.q("_xecms_auth_group_ancestors")} WHERE realm_id = $1`,
      [realmId],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_group_ancestors")}
         (realm_id, ancestor_group_id, descendant_subject_id, depth, membership_path)
       WITH RECURSIVE paths(realm_id, ancestor_id, descendant_id, depth, path) AS (
         SELECT realm_id, id, id, 0, ARRAY[id]::text[]
         FROM ${this.q("_xecms_auth_subjects")}
         WHERE realm_id = $1 AND subject_type = 'group'
         UNION ALL
         SELECT paths.realm_id, paths.ancestor_id, members.member_subject_id,
                paths.depth + 1, paths.path || members.member_subject_id
         FROM paths
         JOIN ${this.q("_xecms_auth_group_members")} members
           ON members.realm_id = paths.realm_id
          AND members.group_subject_id = paths.descendant_id
         WHERE NOT members.member_subject_id = ANY(paths.path)
       ), canonical AS (
         SELECT DISTINCT ON (realm_id, ancestor_id, descendant_id)
                realm_id, ancestor_id, descendant_id, depth, path
         FROM paths
         ORDER BY realm_id, ancestor_id, descendant_id, depth, path::text
       )
       SELECT realm_id, ancestor_id, descendant_id, depth, path FROM canonical`,
      [realmId],
    );
  }

  private async assertResourceGraphAcyclic(client: PoolClient, realmId: string): Promise<void> {
    const result = await client.query(
      `WITH RECURSIVE reach(origin_id, ancestor_id) AS (
         SELECT id, parent_id FROM ${this.q("_xecms_auth_resources")}
         WHERE realm_id = $1 AND parent_id IS NOT NULL
         UNION
         SELECT reach.origin_id, resources.parent_id
         FROM reach
         JOIN ${this.q("_xecms_auth_resources")} resources
           ON resources.realm_id = $1 AND resources.id = reach.ancestor_id
         WHERE resources.parent_id IS NOT NULL
       )
       SELECT 1 FROM reach WHERE origin_id = ancestor_id LIMIT 1`,
      [realmId],
    );
    if (result.rowCount !== 0) {
      throw new ApplicationError("AUTHORIZATION_RESOURCE_CYCLE", 422, "Resource parent would create a cycle.");
    }
  }

  private async rebuildResourceClosure(client: PoolClient, realmId: string): Promise<void> {
    await client.query(
      `DELETE FROM ${this.q("_xecms_auth_resource_ancestors")} WHERE realm_id = $1`,
      [realmId],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_resource_ancestors")}
         (realm_id, ancestor_resource_id, descendant_resource_id, depth)
       WITH RECURSIVE paths(realm_id, ancestor_id, descendant_id, depth) AS (
         SELECT realm_id, id, id, 0
         FROM ${this.q("_xecms_auth_resources")} WHERE realm_id = $1
         UNION ALL
         SELECT paths.realm_id, paths.ancestor_id, child.id, paths.depth + 1
         FROM paths
         JOIN ${this.q("_xecms_auth_resources")} child
           ON child.realm_id = paths.realm_id AND child.parent_id = paths.descendant_id
       )
       SELECT realm_id, ancestor_id, descendant_id, depth FROM paths`,
      [realmId],
    );
  }

  private async finishMutation(
    client: PoolClient,
    realmId: string,
    revision: number,
    changeKind: string,
    audit: AuthorizationAuditDraft,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_policy_revisions")}
         (realm_id, revision, actor_subject_id, actor_identity_id, access_mode,
          full_access_binding_id, change_kind, target_type, target_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [realmId, revision, audit.actorSubjectId ?? null, audit.actorIdentityId ?? null,
        audit.accessMode ?? null, audit.fullAccessBindingId ?? null, changeKind,
        audit.targetType, audit.targetId, audit.occurredAt],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_audit_log")}
         (id, realm_id, policy_revision, actor_subject_id, actor_identity_id,
          access_mode, full_access_binding_id, action, target_type, target_id,
          before_state, after_state, decision, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11::jsonb, $12::jsonb, $13::jsonb, $14)`,
      [audit.id, realmId, revision, audit.actorSubjectId ?? null,
        audit.actorIdentityId ?? null, audit.accessMode ?? null,
        audit.fullAccessBindingId ?? null, audit.action, audit.targetType, audit.targetId,
        nullableJson(audit.before), nullableJson(audit.after), nullableJson(audit.decision),
        audit.occurredAt],
    );
    const topic = audit.targetType === "binding" ? "role.binding.changed" : `authorization.${audit.action}`;
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id,
          aggregate_version, actor_subject_id, actor_identity_id, occurred_at, payload, created_at)
       SELECT $1, realm.workspace_id, $2, $3, 'authorization', $4, $5, $6, $7, $8, $9::jsonb, $8
         FROM ${this.q("_xecms_realms")} realm WHERE realm.id = $2`,
      [`outbox_authorization_${audit.id}`, realmId, topic, audit.targetId, revision,
        audit.actorSubjectId ?? null, audit.actorIdentityId ?? null, audit.occurredAt, JSON.stringify({
          action: audit.action,
          targetType: audit.targetType,
          targetId: audit.targetId,
          accessMode: audit.accessMode,
          fullAccessBindingId: audit.fullAccessBindingId,
          before: audit.before,
          after: audit.after,
        })],
    );
  }

  private async requireLoadedPolicy(client: PoolClient, realmId: string): Promise<AuthorizationPolicyState> {
    const state = await this.loadPolicyWith(client, realmId);
    if (state === null) {
      throw new Error("A committed authorization mutation produced no policy state.");
    }
    return state;
  }

  private async loadPolicyWith(
    client: Pick<PoolClient, "query">,
    realmId: string,
  ): Promise<AuthorizationPolicyState | null> {
    const stateResult = await client.query<PolicyStateRow>(
      `SELECT realms.id, realms.name, state.current_revision, state.root_resource_id
       FROM ${this.q("_xecms_auth_policy_state")} state
       JOIN ${this.q("_xecms_realms")} realms ON realms.id = state.realm_id
       WHERE state.realm_id = $1`,
      [realmId],
    );
    const stateRow = stateResult.rows[0];
    if (stateRow === undefined || Number(stateRow.current_revision) === 0 || stateRow.root_resource_id === null) {
      return null;
    }

    const subjectsResult = await client.query<SubjectRow>(
      `SELECT id, realm_id, identity_id, display_name, subject_type, protected, disabled_at
       FROM ${this.q("_xecms_auth_subjects")} WHERE realm_id = $1 ORDER BY id`,
      [realmId],
    );
    const resourcesResult = await client.query<ResourceRow>(
      `SELECT id, realm_id, name, resource_type, parent_id, protected
       FROM ${this.q("_xecms_auth_resources")}
       WHERE realm_id = $1 AND retired_at IS NULL ORDER BY id`,
      [realmId],
    );
    const levelsResult = await client.query<LevelRow>(
      `SELECT id, realm_id, name, rank, protected
       FROM ${this.q("_xecms_auth_authority_levels")} WHERE realm_id = $1 ORDER BY rank DESC, id`,
      [realmId],
    );
    const permissionsResult = await client.query<PermissionRow>(
      `SELECT permission_key, hierarchy_guard, delegatable, protected
       FROM ${this.q("_xecms_auth_permissions")} WHERE retired_at IS NULL ORDER BY permission_key`,
    );
    const rolesResult = await client.query<RoleRow>(
      `SELECT id, realm_id, level_id, name, description, protected, field_access_restricted
       FROM ${this.q("_xecms_auth_roles")} WHERE realm_id = $1 ORDER BY name, id`,
      [realmId],
    );
    const rolePermissionsResult = await client.query<RolePermissionRow>(
      `SELECT role_id, permission_key FROM ${this.q("_xecms_auth_role_permissions")}
       WHERE realm_id = $1 ORDER BY role_id, permission_key`,
      [realmId],
    );
    const roleDelegationsResult = await client.query<RolePermissionRow>(
      `SELECT role_id, permission_key FROM ${this.q("_xecms_auth_role_delegations")}
       WHERE realm_id = $1 ORDER BY role_id, permission_key`,
      [realmId],
    );
    const fieldAccessResult = await client.query<FieldAccessRow>(
      `SELECT role_id, resource_id, readable_fields, writable_fields
       FROM ${this.q("_xecms_auth_role_field_access")}
       WHERE realm_id = $1 ORDER BY role_id, resource_id`,
      [realmId],
    );
    const bindingsResult = await client.query<BindingRow>(
      `SELECT id, realm_id, subject_id, role_id, resource_id, propagation,
              valid_from, valid_until, constraints, protected
       FROM ${this.q("_xecms_auth_role_bindings")} WHERE realm_id = $1 ORDER BY id`,
      [realmId],
    );
    const membershipsResult = await client.query<GroupMembershipRow>(
      `SELECT id, realm_id, member_subject_id, group_subject_id
       FROM ${this.q("_xecms_auth_group_members")} WHERE realm_id = $1 ORDER BY id`,
      [realmId],
    );

    const permissionsByRole = groupStrings(rolePermissionsResult.rows);
    const delegationsByRole = groupStrings(roleDelegationsResult.rows);
    const fieldAccessByRole = new Map<string, FieldAccessRow[]>();
    for (const rule of fieldAccessResult.rows) {
      const current = fieldAccessByRole.get(rule.role_id) ?? [];
      current.push(rule);
      fieldAccessByRole.set(rule.role_id, current);
    }

    const realm: AuthorizationRealmRecord = {
      id: stateRow.id,
      name: stateRow.name,
      rootResourceId: stateRow.root_resource_id,
    };
    return {
      revision: Number(stateRow.current_revision),
      realm,
      subjects: subjectsResult.rows.map(subjectFromRow),
      resources: resourcesResult.rows.map(resourceFromRow),
      authorityLevels: levelsResult.rows.map(levelFromRow),
      permissions: permissionsResult.rows.map(permissionFromRow),
      roles: rolesResult.rows.map((row) => roleFromRow(
        row,
        permissionsByRole.get(row.id) ?? [],
        delegationsByRole.get(row.id) ?? [],
        fieldAccessByRole.get(row.id) ?? [],
      )),
      bindings: bindingsResult.rows.map(bindingFromRow),
      groupMemberships: membershipsResult.rows.map(membershipFromRow),
    };
  }
}

interface PolicyStateRow extends QueryResultRow {
  readonly id: string;
  readonly name: string;
  readonly current_revision: string | number;
  readonly root_resource_id: string | null;
}

interface SubjectRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly identity_id: string | null;
  readonly display_name: string;
  readonly subject_type: AuthorizationSubjectRecord["type"];
  readonly protected: boolean;
  readonly disabled_at: Date | string | null;
}

interface ResourceRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly name: string;
  readonly resource_type: string;
  readonly parent_id: string | null;
  readonly protected: boolean;
}

interface LevelRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly name: string;
  readonly rank: string | number;
  readonly protected: boolean;
}

interface PermissionRow extends QueryResultRow {
  readonly permission_key: string;
  readonly hierarchy_guard: AuthorizationPermissionRecord["hierarchyGuard"];
  readonly delegatable: boolean;
  readonly protected: boolean;
}

interface RoleRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly level_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly protected: boolean;
  readonly field_access_restricted: boolean;
}

interface RolePermissionRow extends QueryResultRow {
  readonly role_id: string;
  readonly permission_key: string;
}

interface FieldAccessRow extends QueryResultRow {
  readonly role_id: string;
  readonly resource_id: string;
  readonly readable_fields: string[];
  readonly writable_fields: string[];
}

interface BindingRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly subject_id: string;
  readonly role_id: string;
  readonly resource_id: string;
  readonly propagation: AuthorizationBindingRecord["propagation"];
  readonly valid_from: Date | string | null;
  readonly valid_until: Date | string | null;
  readonly constraints: Record<string, unknown>;
  readonly protected: boolean;
}

interface GroupMembershipRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly member_subject_id: string;
  readonly group_subject_id: string;
}

interface AuditRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly policy_revision: string | number;
  readonly actor_subject_id: string | null;
  readonly actor_identity_id: string | null;
  readonly access_mode: NonNullable<AuthorizationAuditRecord["accessMode"]> | null;
  readonly full_access_binding_id: string | null;
  readonly action: string;
  readonly target_type: AuthorizationAuditRecord["targetType"];
  readonly target_id: string;
  readonly before_state: unknown | null;
  readonly after_state: unknown | null;
  readonly decision: AuthorizationAuditRecord["decision"];
  readonly occurred_at: Date | string;
}

function subjectFromRow(row: SubjectRow): AuthorizationSubjectRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    ...(row.identity_id === null ? {} : { identityId: row.identity_id }),
    name: row.display_name,
    type: row.subject_type,
    ...(row.protected ? { protected: true } : {}),
    ...(row.disabled_at === null ? {} : { disabled: true }),
  };
}

function resourceFromRow(row: ResourceRow): AuthorizationResourceRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    name: row.name,
    type: row.resource_type,
    ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
    ...(row.protected ? { protected: true } : {}),
  };
}

function levelFromRow(row: LevelRow): AuthorizationLevelRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    name: row.name,
    rank: Number(row.rank),
    ...(row.protected ? { protected: true } : {}),
  };
}

function permissionFromRow(row: PermissionRow): AuthorizationPermissionRecord {
  return {
    key: row.permission_key,
    hierarchyGuard: row.hierarchy_guard,
    delegatable: row.delegatable,
    ...(row.protected ? { protected: true } : {}),
  };
}

function roleFromRow(
  row: RoleRow,
  permissions: readonly string[],
  delegations: readonly string[],
  fieldAccess: readonly FieldAccessRow[],
): AuthorizationRoleRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    levelId: row.level_id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    permissions,
    delegatablePermissions: delegations,
    ...(row.field_access_restricted
      ? {
          fieldAccess: fieldAccess.map((rule) => ({
            resourceId: rule.resource_id,
            readableFields: rule.readable_fields,
            writableFields: rule.writable_fields,
          })),
        }
      : {}),
    ...(row.protected ? { protected: true } : {}),
  };
}

function bindingFromRow(row: BindingRow): AuthorizationBindingRecord {
  const hasConstraints = Object.keys(row.constraints).length > 0;
  const constraints = row.constraints as AuthorizationBindingRecord["constraints"];
  return {
    id: row.id,
    realmId: row.realm_id,
    subjectId: row.subject_id,
    roleId: row.role_id,
    resourceId: row.resource_id,
    propagation: row.propagation,
    ...(row.valid_from === null ? {} : { validFrom: instant(row.valid_from) }),
    ...(row.valid_until === null ? {} : { validUntil: instant(row.valid_until) }),
    ...(hasConstraints && constraints !== undefined ? { constraints } : {}),
    ...(row.protected ? { protected: true } : {}),
  };
}

function membershipFromRow(row: GroupMembershipRow): AuthorizationGroupMembershipRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    memberSubjectId: row.member_subject_id,
    groupSubjectId: row.group_subject_id,
  };
}

function auditFromRow(row: AuditRow): AuthorizationAuditRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    revision: Number(row.policy_revision),
    ...(row.actor_subject_id === null ? {} : { actorSubjectId: row.actor_subject_id }),
    ...(row.actor_identity_id === null ? {} : { actorIdentityId: row.actor_identity_id }),
    ...(row.access_mode === null ? {} : { accessMode: row.access_mode }),
    ...(row.full_access_binding_id === null
      ? {}
      : { fullAccessBindingId: row.full_access_binding_id }),
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before_state,
    after: row.after_state,
    decision: row.decision,
    occurredAt: instant(row.occurred_at),
  };
}

function groupStrings(rows: readonly RolePermissionRow[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const current = result.get(row.role_id) ?? [];
    current.push(row.permission_key);
    result.set(row.role_id, current);
  }
  return result;
}

function assertRealm(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new ApplicationError(
      "AUTHORIZATION_REALM_MISMATCH",
      422,
      `Authorization object belongs to realm '${actual}', not '${expected}'.`,
    );
  }
}

function assertChanged(rowCount: number | null, label: string, id: string): void {
  if (rowCount !== 1) {
    throw new ApplicationError(
      "AUTHORIZATION_OBJECT_NOT_FOUND",
      404,
      `The ${label} '${id}' was not found.`,
    );
  }
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function nullableJson(value: unknown | null): string | null {
  return value === null || value === undefined ? null : json(value);
}

function auditActorStorageId(audit: AuthorizationAuditDraft): string {
  const actorId = audit.actorSubjectId ?? audit.actorIdentityId;
  if (actorId === undefined) {
    throw new ApplicationError(
      "AUTHORIZATION_AUDIT_ACTOR_REQUIRED",
      500,
      "Authorization mutations require a Realm Subject or System Identity audit actor.",
    );
  }
  return actorId;
}

interface PostgresLikeError {
  readonly code?: string;
  readonly constraint?: string;
}

function mapAuthorizationDatabaseError(error: unknown): unknown {
  if (error instanceof ApplicationError) {
    return error;
  }
  const pg = error as PostgresLikeError;
  if (pg.code === "23505") {
    return new ApplicationError(
      "AUTHORIZATION_OBJECT_CONFLICT",
      409,
      "An authorization object violates a uniqueness constraint.",
      { details: { constraint: pg.constraint } },
    );
  }
  if (pg.code === "23503") {
    return new ApplicationError(
      "AUTHORIZATION_REFERENCE_CONFLICT",
      409,
      "An authorization object is still referenced or contains an unknown reference.",
      { details: { constraint: pg.constraint } },
    );
  }
  if (pg.code === "23514" || pg.code === "22P02" || pg.code === "22007") {
    return new ApplicationError(
      "AUTHORIZATION_DATA_INVALID",
      422,
      "Authorization data violates a storage constraint.",
      { details: { constraint: pg.constraint } },
    );
  }
  return error;
}
