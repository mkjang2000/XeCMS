import {
  ApplicationError,
  type DelegationScopeRule,
  type ManagementAction,
  type PutRealmManagementDelegationInput,
  type RealmManagementDelegation,
  type RealmManagementDelegationStore,
  type RemoveRealmManagementDelegationInput,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

interface DelegationRow extends QueryResultRow {
  readonly workspace_id: string;
  readonly managing_realm_id: string;
  readonly managed_realm_id: string;
  readonly actions: readonly string[];
  readonly scope_by_action: Readonly<Record<string, string>>;
  readonly revision: number;
  readonly updated_at: Date | string;
  readonly updated_by: string;
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function delegationFromRow(row: DelegationRow): RealmManagementDelegation {
  const scopeByAction: Partial<Record<ManagementAction, DelegationScopeRule>> = {};
  for (const [action, rule] of Object.entries(row.scope_by_action ?? {})) {
    if (rule === "any" || rule === "all") {
      scopeByAction[action as ManagementAction] = rule;
    }
  }
  return {
    workspaceId: row.workspace_id,
    managingRealmId: row.managing_realm_id,
    managedRealmId: row.managed_realm_id,
    actions: [...row.actions] as ManagementAction[],
    scopeByAction,
    revision: row.revision,
    updatedAt: instant(row.updated_at),
    updatedBy: row.updated_by,
  };
}

interface PostgresErrorLike {
  readonly code?: string;
}

function mapDelegationError(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  const pg = error as PostgresErrorLike;
  if (pg.code === "23503") {
    return new ApplicationError(
      "MANAGEMENT_DELEGATION_REFERENCE_INVALID",
      409,
      "A management-delegation reference is missing or invalid.",
    );
  }
  if (pg.code === "23514" || pg.code === "23502" || pg.code === "22P02") {
    return new ApplicationError(
      "MANAGEMENT_DELEGATION_INVALID",
      422,
      "The management-delegation record is invalid.",
    );
  }
  return error;
}

export class PostgresRealmManagementDelegationStore implements RealmManagementDelegationStore {
  public readonly schema: string;

  public constructor(public readonly pool: Pool, schema = "xecms") {
    this.schema = validateDatabaseSchema(schema);
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }

  public async listByManagingRealm(
    managingRealmId: string,
  ): Promise<readonly RealmManagementDelegation[]> {
    const result = await this.pool.query<DelegationRow>(
      `SELECT * FROM ${this.q("_xecms_realm_management_delegations")}
        WHERE managing_realm_id = $1 ORDER BY managed_realm_id`,
      [managingRealmId],
    );
    return result.rows.map(delegationFromRow);
  }

  public async listByManagedRealm(
    managedRealmId: string,
  ): Promise<readonly RealmManagementDelegation[]> {
    const result = await this.pool.query<DelegationRow>(
      `SELECT * FROM ${this.q("_xecms_realm_management_delegations")}
        WHERE managed_realm_id = $1 ORDER BY managing_realm_id`,
      [managedRealmId],
    );
    return result.rows.map(delegationFromRow);
  }

  public async getDelegation(
    managingRealmId: string,
    managedRealmId: string,
  ): Promise<RealmManagementDelegation | null> {
    const result = await this.pool.query<DelegationRow>(
      `SELECT * FROM ${this.q("_xecms_realm_management_delegations")}
        WHERE managing_realm_id = $1 AND managed_realm_id = $2`,
      [managingRealmId, managedRealmId],
    );
    return result.rows[0] === undefined ? null : delegationFromRow(result.rows[0]);
  }

  public async put(
    input: PutRealmManagementDelegationInput,
  ): Promise<RealmManagementDelegation> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Both realms must exist in the claimed workspace. System realm is a valid
      // managing realm (entry point A); the managed realm must be content.
      const realms = await client.query<{ id: string; kind: string }>(
        `SELECT id, kind FROM ${this.q("_xecms_realms")}
          WHERE workspace_id = $1 AND id = ANY($2::text[])`,
        [input.workspaceId, [input.managingRealmId, input.managedRealmId]],
      );
      const byId = new Map(realms.rows.map((r) => [r.id, r.kind]));
      if (!byId.has(input.managingRealmId) || byId.get(input.managedRealmId) !== "content") {
        throw new ApplicationError(
          "MANAGEMENT_DELEGATION_REALM_INVALID",
          409,
          "A delegation must target an existing managing realm and a content managed realm in this workspace.",
        );
      }
      const existing = await client.query<{ revision: number }>(
        `SELECT revision FROM ${this.q("_xecms_realm_management_delegations")}
          WHERE managing_realm_id = $1 AND managed_realm_id = $2 FOR UPDATE`,
        [input.managingRealmId, input.managedRealmId],
      );
      const currentRevision = existing.rows[0]?.revision;
      const expected = input.expectedRevision;
      // CAS: create requires expectedRevision null; update requires exact match.
      if (
        (currentRevision === undefined && expected !== null) ||
        (currentRevision !== undefined && expected !== currentRevision)
      ) {
        throw new ApplicationError(
          "MANAGEMENT_DELEGATION_REVISION_CONFLICT",
          409,
          "The management delegation changed after it was read.",
          { details: { expectedRevision: expected, actualRevision: currentRevision ?? null } },
        );
      }
      const nextRevision = (currentRevision ?? 0) + 1;
      const result = await client.query<DelegationRow>(
        `INSERT INTO ${this.q("_xecms_realm_management_delegations")}
           (workspace_id, managing_realm_id, managed_realm_id, actions, scope_by_action,
            revision, updated_at, updated_by)
         VALUES ($1, $2, $3, $4::text[], $5::jsonb, $6, $7, $8)
         ON CONFLICT (managing_realm_id, managed_realm_id) DO UPDATE SET
           actions = EXCLUDED.actions,
           scope_by_action = EXCLUDED.scope_by_action,
           revision = EXCLUDED.revision,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by
         RETURNING *`,
        [
          input.workspaceId, input.managingRealmId, input.managedRealmId,
          [...input.actions],
          JSON.stringify(input.scopeByAction),
          nextRevision, input.updatedAt, input.updatedBy,
        ],
      );
      await client.query("COMMIT");
      return delegationFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDelegationError(error);
    } finally {
      client.release();
    }
  }

  public async remove(input: RemoveRealmManagementDelegationInput): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `DELETE FROM ${this.q("_xecms_realm_management_delegations")}
          WHERE managing_realm_id = $1 AND managed_realm_id = $2 AND revision = $3`,
        [input.managingRealmId, input.managedRealmId, input.expectedRevision],
      );
      if (result.rowCount !== 1) {
        const current = await client.query<{ revision: number }>(
          `SELECT revision FROM ${this.q("_xecms_realm_management_delegations")}
            WHERE managing_realm_id = $1 AND managed_realm_id = $2`,
          [input.managingRealmId, input.managedRealmId],
        );
        if (current.rowCount === 0) {
          throw new ApplicationError(
            "MANAGEMENT_DELEGATION_NOT_FOUND",
            404,
            "The management delegation does not exist.",
          );
        }
        throw new ApplicationError(
          "MANAGEMENT_DELEGATION_REVISION_CONFLICT",
          409,
          "The management delegation changed after it was read.",
          { details: { expectedRevision: input.expectedRevision, actualRevision: current.rows[0]!.revision } },
        );
      }
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDelegationError(error);
    } finally {
      client.release();
    }
  }
}
