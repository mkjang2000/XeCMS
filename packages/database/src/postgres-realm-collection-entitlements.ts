import {
  ApplicationError,
  type CollectionAction,
  type PutRealmCollectionEntitlementInput,
  type RealmCollectionEntitlement,
  type RealmCollectionEntitlementStore,
  type RealmEntitlementStatus,
  type RemoveRealmCollectionEntitlementInput,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

interface EntitlementRow extends QueryResultRow {
  readonly workspace_id: string;
  readonly realm_id: string;
  readonly collection_id: string;
  readonly actions: readonly string[];
  readonly readable_fields: readonly string[] | null;
  readonly writable_fields: readonly string[] | null;
  readonly constraint_owner_only: boolean;
  readonly constraint_statuses: readonly string[] | null;
  readonly revision: number;
  readonly updated_at: Date | string;
  readonly updated_by: string;
}

interface EnforcementRow extends QueryResultRow {
  readonly realm_id: string;
  readonly workspace_id: string;
  readonly state: "disabled" | "enforced";
  readonly version: string | number;
}

function entitlementFromRow(row: EntitlementRow): RealmCollectionEntitlement {
  const constraint =
    row.constraint_owner_only || (row.constraint_statuses !== null && row.constraint_statuses.length > 0)
      ? {
          ...(row.constraint_owner_only ? { ownerOnly: true } : {}),
          ...(row.constraint_statuses !== null && row.constraint_statuses.length > 0
            ? { statuses: [...row.constraint_statuses] }
            : {}),
        }
      : undefined;
  return {
    workspaceId: row.workspace_id,
    realmId: row.realm_id,
    collectionId: row.collection_id,
    actions: [...row.actions] as CollectionAction[],
    ...(row.readable_fields === null ? {} : { readableFields: [...row.readable_fields] }),
    ...(row.writable_fields === null ? {} : { writableFields: [...row.writable_fields] }),
    ...(constraint === undefined ? {} : { constraint }),
    revision: row.revision,
    updatedAt: instant(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** writable ⊆ readable when readable is a restricted set. NULL readable = all fields. */
function assertWritableSubset(input: PutRealmCollectionEntitlementInput): void {
  if (input.readableFields === undefined || input.writableFields === undefined) return;
  const readable = new Set(input.readableFields);
  const offending = input.writableFields.filter((field) => !readable.has(field));
  if (offending.length > 0) {
    throw new ApplicationError(
      "ENTITLEMENT_FIELD_INVALID",
      422,
      `Writable fields must be a subset of readable fields; offending: ${offending.join(", ")}.`,
    );
  }
}

export class PostgresRealmCollectionEntitlementStore implements RealmCollectionEntitlementStore {
  public readonly schema: string;

  public constructor(public readonly pool: Pool, schema = "xecms") {
    this.schema = validateDatabaseSchema(schema);
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }

  public async getEnforcement(realmId: string): Promise<RealmEntitlementStatus | null> {
    const result = await this.pool.query<EnforcementRow>(
      `SELECT realm_id, workspace_id, state, version
         FROM ${this.q("_xecms_realm_entitlement_enforcement")}
        WHERE realm_id = $1`,
      [realmId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      realmId: row.realm_id,
      workspaceId: row.workspace_id,
      state: row.state,
      version: Number(row.version),
    };
  }

  public async listByRealm(realmId: string): Promise<readonly RealmCollectionEntitlement[]> {
    const result = await this.pool.query<EntitlementRow>(
      `SELECT * FROM ${this.q("_xecms_realm_collection_entitlements")}
        WHERE realm_id = $1 ORDER BY collection_id`,
      [realmId],
    );
    return result.rows.map(entitlementFromRow);
  }

  public async listByCollection(
    workspaceId: string,
    collectionId: string,
  ): Promise<readonly RealmCollectionEntitlement[]> {
    const result = await this.pool.query<EntitlementRow>(
      `SELECT * FROM ${this.q("_xecms_realm_collection_entitlements")}
        WHERE workspace_id = $1 AND collection_id = $2 ORDER BY realm_id`,
      [workspaceId, collectionId],
    );
    return result.rows.map(entitlementFromRow);
  }

  public async put(
    input: PutRealmCollectionEntitlementInput,
  ): Promise<RealmCollectionEntitlement> {
    assertWritableSubset(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Workspace integrity: the entitlement must target an active content realm
      // in the claimed workspace. This also implicitly requires an enforcement row.
      const realm = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${this.q("_xecms_realms")}
          WHERE id = $1 AND kind = 'content' AND workspace_id = $2`,
        [input.realmId, input.workspaceId],
      );
      if (realm.rowCount !== 1) {
        throw new ApplicationError(
          "ENTITLEMENT_REALM_INVALID",
          409,
          "The entitlement must target an active Content Realm in this workspace.",
        );
      }
      const existing = await client.query<{ revision: number }>(
        `SELECT revision FROM ${this.q("_xecms_realm_collection_entitlements")}
          WHERE realm_id = $1 AND collection_id = $2 FOR UPDATE`,
        [input.realmId, input.collectionId],
      );
      const currentRevision = existing.rows[0]?.revision;
      const expected = input.expectedRevision;
      // CAS: create requires expectedRevision null; update requires exact match.
      if (
        (currentRevision === undefined && expected !== null) ||
        (currentRevision !== undefined && expected !== currentRevision)
      ) {
        throw new ApplicationError(
          "ENTITLEMENT_REVISION_CONFLICT",
          409,
          "The entitlement changed after it was read.",
          { details: { expectedRevision: expected, actualRevision: currentRevision ?? null } },
        );
      }
      const nextRevision = (currentRevision ?? 0) + 1;
      const result = await client.query<EntitlementRow>(
        `INSERT INTO ${this.q("_xecms_realm_collection_entitlements")}
           (workspace_id, realm_id, collection_id, actions, readable_fields, writable_fields,
            constraint_owner_only, constraint_statuses, revision, updated_at, updated_by)
         VALUES ($1, $2, $3, $4::text[], $5::text[], $6::text[], $7, $8::text[], $9, $10, $11)
         ON CONFLICT (realm_id, collection_id) DO UPDATE SET
           actions = EXCLUDED.actions,
           readable_fields = EXCLUDED.readable_fields,
           writable_fields = EXCLUDED.writable_fields,
           constraint_owner_only = EXCLUDED.constraint_owner_only,
           constraint_statuses = EXCLUDED.constraint_statuses,
           revision = EXCLUDED.revision,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by
         RETURNING *`,
        [
          input.workspaceId, input.realmId, input.collectionId,
          [...input.actions],
          input.readableFields === undefined ? null : [...input.readableFields],
          input.writableFields === undefined ? null : [...input.writableFields],
          input.constraint?.ownerOnly === true,
          input.constraint?.statuses === undefined ? null : [...input.constraint.statuses],
          nextRevision, input.updatedAt, input.updatedBy,
        ],
      );
      await this.bumpVersion(client, input.realmId);
      await client.query("COMMIT");
      return entitlementFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapEntitlementError(error);
    } finally {
      client.release();
    }
  }

  public async remove(input: RemoveRealmCollectionEntitlementInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `DELETE FROM ${this.q("_xecms_realm_collection_entitlements")}
          WHERE realm_id = $1 AND collection_id = $2 AND revision = $3`,
        [input.realmId, input.collectionId, input.expectedRevision],
      );
      if (result.rowCount !== 1) {
        // Distinguish "not found" from "revision conflict" for a precise error.
        const current = await client.query<{ revision: number }>(
          `SELECT revision FROM ${this.q("_xecms_realm_collection_entitlements")}
            WHERE realm_id = $1 AND collection_id = $2`,
          [input.realmId, input.collectionId],
        );
        if (current.rowCount === 0) {
          throw new ApplicationError("ENTITLEMENT_NOT_FOUND", 404, "The entitlement does not exist.");
        }
        throw new ApplicationError(
          "ENTITLEMENT_REVISION_CONFLICT",
          409,
          "The entitlement changed after it was read.",
          { details: { expectedRevision: input.expectedRevision, actualRevision: current.rows[0]!.revision } },
        );
      }
      await this.bumpVersion(client, input.realmId);
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapEntitlementError(error);
    } finally {
      client.release();
    }
  }

  public async initRealmEnforcement(realmId: string, workspaceId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.q("_xecms_realm_entitlement_enforcement")} (realm_id, workspace_id, state, version)
       VALUES ($1, $2, 'disabled', 0)
       ON CONFLICT (realm_id) DO NOTHING`,
      [realmId, workspaceId],
    );
  }

  public async reconcileRealmFromPolicy(realmId: string, workspaceId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Ensure the realm is enforced (create as enforced if missing).
      await client.query(
        `INSERT INTO ${this.q("_xecms_realm_entitlement_enforcement")} (realm_id, workspace_id, state, version)
         VALUES ($1, $2, 'enforced', 1)
         ON CONFLICT (realm_id) DO UPDATE SET
           state = 'enforced',
           version = ${this.q("_xecms_realm_entitlement_enforcement")}.version + 1,
           updated_at = now()`,
        [realmId, workspaceId],
      );
      // Derive full-allow entitlements for every collection reachable by a
      // content.* binding (respecting scope propagation), preserving existing
      // customised entitlements (ON CONFLICT DO NOTHING). Same logic as the 0025
      // preservation migration, scoped to a single realm.
      await client.query(
        `INSERT INTO ${this.q("_xecms_realm_collection_entitlements")}
           (workspace_id, realm_id, collection_id, actions, revision, updated_at, updated_by)
         SELECT
           $2, col.realm_id,
           substring(col.id FROM (position('resource:collection:' IN col.id) + length('resource:collection:'))),
           array_agg(DISTINCT action_map.action), 1, now(), 'system:reconcile'
         FROM ${this.q("_xecms_auth_resources")} AS col
         JOIN ${this.q("_xecms_auth_role_bindings")} AS b ON b.realm_id = col.realm_id
         JOIN ${this.q("_xecms_auth_resource_ancestors")} AS anc
           ON anc.realm_id = col.realm_id
          AND anc.descendant_resource_id = col.id
          AND anc.ancestor_resource_id = b.resource_id
          AND (
            (b.propagation = 'self' AND anc.depth = 0)
            OR (b.propagation = 'children' AND anc.depth >= 1)
            OR (b.propagation = 'self-and-children')
          )
         JOIN ${this.q("_xecms_auth_role_permissions")} AS rp
           ON rp.realm_id = b.realm_id AND rp.role_id = b.role_id
         JOIN LATERAL (
           SELECT CASE rp.permission_key
             WHEN 'content.list' THEN 'list' WHEN 'content.read' THEN 'read'
             WHEN 'content.create' THEN 'create' WHEN 'content.update' THEN 'update'
             WHEN 'content.delete' THEN 'delete' WHEN 'content.publish' THEN 'publish'
             WHEN 'content.unpublish' THEN 'unpublish' WHEN 'content.purge' THEN 'purge'
             WHEN 'content.restore' THEN 'restore' WHEN 'content.revision.read' THEN 'revision.read'
             WHEN 'content.revision.restore' THEN 'revision.restore' ELSE NULL
           END AS action
         ) AS action_map ON action_map.action IS NOT NULL
         WHERE col.realm_id = $1 AND col.resource_type = 'collection' AND col.retired_at IS NULL
         GROUP BY col.realm_id, col.id
         ON CONFLICT (realm_id, collection_id) DO NOTHING`,
        [realmId, workspaceId],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapEntitlementError(error);
    } finally {
      client.release();
    }
  }

  /** Bumps the realm's entitlement version so caches invalidate on the next read. */
  private async bumpVersion(client: PoolClient, realmId: string): Promise<void> {
    const result = await client.query(
      `UPDATE ${this.q("_xecms_realm_entitlement_enforcement")}
          SET version = version + 1, updated_at = now()
        WHERE realm_id = $1`,
      [realmId],
    );
    if (result.rowCount !== 1) {
      throw new ApplicationError(
        "ENTITLEMENT_ENFORCEMENT_MISSING",
        409,
        "The realm has no entitlement enforcement row.",
      );
    }
  }
}

interface PostgresErrorLike {
  readonly code?: string;
  readonly constraint?: string;
}

function mapEntitlementError(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  const pg = error as PostgresErrorLike;
  if (pg.code === "23503") {
    return new ApplicationError(
      "ENTITLEMENT_REFERENCE_INVALID",
      409,
      "An entitlement reference is missing or invalid.",
    );
  }
  if (pg.code === "23514" || pg.code === "23502" || pg.code === "22P02") {
    return new ApplicationError("ENTITLEMENT_INVALID", 422, "The entitlement record is invalid.");
  }
  return error;
}
