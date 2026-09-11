import { qualifiedName } from "../identifiers.js";
import { DEFAULT_WORKSPACE_ID } from "../migrate.js";
import { PostgresAuthMaterialization } from "./auth-materialization.js";
import {
  type SchemaRevisionRow,
  type SchemaDraftRow,
  schemaRevisionFromRow,
  schemaDraftFromRow,
  schemaObjects,
  migrationStatements,
  publicOperations,
  schemaConflict,
  schemaDraftConflict,
} from "./schema-records.js";
import { mapDatabaseError, databaseErrorCode, lockWorkspace } from "./shared.js";
import {
  ApplicationError,
  decodeM1Schema,
  type AppliedSchemaResult,
  type MigrationOperation,
  type SchemaDraftRecord,
  type SchemaRevisionRecord,
  type SchemaStore,
} from "@xecms/application";
import { serializeSchema, type SchemaIrV1 } from "@xecms/schema";
import { createHash, randomUUID } from "node:crypto";
import { type Pool, type PoolClient } from "pg";

export class PostgresSchemaStore implements SchemaStore {
  private readonly authMaterialization: PostgresAuthMaterialization;
  public constructor(private readonly pool: Pool, private readonly schema: string) {
    this.authMaterialization = new PostgresAuthMaterialization(schema);
  }

  public async issueSchemaIds(input: {
    readonly kind: "collection" | "field" | "relation" | "component";
    readonly count: number;
    readonly actorId: string;
    readonly now: string;
  }): Promise<readonly string[]> {
    const client = await this.pool.connect();
    const ids: string[] = [];
    try {
      await client.query("BEGIN");
      for (let index = 0; index < input.count; index += 1) {
        const prefix = {
          collection: "col",
          field: "fld",
          relation: "rel",
          component: "cmp",
        }[input.kind];
        const id = `${prefix}_${randomUUID()}`;
        await client.query(
          `INSERT INTO ${this.q("_xecms_schema_object_ids")}
             (object_id, object_kind, state, issued_at, issued_by)
           VALUES ($1, $2, 'issued', $3, $4)`,
          [id, input.kind, input.now, input.actorId],
        );
        ids.push(id);
      }
      await client.query("COMMIT");
      return ids;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async getActiveSchema(): Promise<SchemaRevisionRecord | null> {
    const result = await this.pool.query<SchemaRevisionRow>(`
      SELECT r.revision_id, r.parent_revision_id, r.schema_json, r.created_at, r.created_by, r.hash
      FROM ${this.q("_xecms_schema_state")} s
      LEFT JOIN ${this.q("_xecms_schema_revisions")} r ON r.revision_id = s.active_revision_id
      WHERE s.singleton = true
    `);
    const row = result.rows[0];
    return row?.revision_id == null ? null : schemaRevisionFromRow(row);
  }

  public async getSchemaDraft(): Promise<SchemaDraftRecord | null> {
    const result = await this.pool.query<SchemaDraftRow>(`
      SELECT base_revision_id, draft_version, schema_json, updated_at, updated_by
      FROM ${this.q("_xecms_schema_drafts")}
      WHERE workspace_id = $1
    `, [DEFAULT_WORKSPACE_ID]);
    const row = result.rows[0];
    return row === undefined ? null : schemaDraftFromRow(row);
  }

  public async saveSchemaDraft(input: {
    readonly baseRevisionId: string | null;
    readonly expectedDraftVersion: string | null;
    readonly schema: SchemaIrV1;
    readonly actorId: string;
    readonly now: string;
    readonly claimUnissuedIds?: boolean;
  }): Promise<SchemaDraftRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockWorkspace(client);
      const activeRevisionId = await this.getActiveRevisionId(client);
      if (activeRevisionId !== input.baseRevisionId) {
        throw schemaConflict(input.baseRevisionId, activeRevisionId);
      }
      const currentDraft = await client.query<{ draft_version: string }>(
        `SELECT draft_version FROM ${this.q("_xecms_schema_drafts")}
         WHERE workspace_id = $1 FOR UPDATE`,
        [DEFAULT_WORKSPACE_ID],
      );
      const actualDraftVersion = currentDraft.rows[0]?.draft_version ?? null;
      if (actualDraftVersion !== input.expectedDraftVersion) {
        throw schemaDraftConflict(input.expectedDraftVersion, actualDraftVersion);
      }
      if (input.claimUnissuedIds === true) {
        await this.claimUnissuedSchemaIds(client, input.schema, input.actorId, input.now);
      }
      await this.assertSchemaIdsUsable(client, input.schema);
      const draftVersion = `drf_${randomUUID()}`;
      await client.query(
        `INSERT INTO ${this.q("_xecms_schema_drafts")}
           (workspace_id, base_revision_id, draft_version, schema_json, updated_at, updated_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (workspace_id) DO UPDATE SET
           base_revision_id = EXCLUDED.base_revision_id,
           draft_version = EXCLUDED.draft_version,
           schema_json = EXCLUDED.schema_json,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [DEFAULT_WORKSPACE_ID, input.baseRevisionId, draftVersion, JSON.stringify(input.schema), input.now, input.actorId],
      );
      await client.query("COMMIT");
      return {
        baseRevisionId: input.baseRevisionId,
        draftVersion,
        schema: input.schema,
        updatedAt: input.now,
        updatedBy: input.actorId,
      };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async applySchemaDraft(input: {
    readonly expectedRevisionId: string | null;
    readonly expectedDraftVersion: string;
    readonly planId: string;
    readonly schema: SchemaIrV1;
    readonly changes: readonly unknown[];
    readonly operations: readonly MigrationOperation[];
    readonly actorId: string;
    readonly now: string;
  }): Promise<AppliedSchemaResult> {
    const revisionId = `sch_${randomUUID()}`;
    const migrationId = `mig_${randomUUID()}`;
    await this.pool.query(
      `INSERT INTO ${this.q("_xecms_migration_runs")}
         (migration_id, target_revision_id, base_revision_id, status, operations_json, started_at, applied_by)
       VALUES ($1, $2, $3, 'pending', $4::jsonb, $5, $6)`,
      [migrationId, revisionId, input.expectedRevisionId, JSON.stringify(publicOperations(input.operations)), input.now, input.actorId],
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockWorkspace(client);
      const activeRevisionId = await this.getActiveRevisionId(client);
      if (activeRevisionId !== input.expectedRevisionId) {
        throw schemaConflict(input.expectedRevisionId, activeRevisionId);
      }
      const draftResult = await client.query<SchemaDraftRow>(
        `SELECT base_revision_id, draft_version, schema_json, updated_at, updated_by
         FROM ${this.q("_xecms_schema_drafts")} WHERE workspace_id = $1 FOR UPDATE`,
        [DEFAULT_WORKSPACE_ID],
      );
      const draftRow = draftResult.rows[0];
      if (draftRow === undefined) {
        throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No schema draft exists.");
      }
      const draft = schemaDraftFromRow(draftRow);
      if (
        draft.baseRevisionId !== input.expectedRevisionId ||
        serializeSchema(draft.schema) !== serializeSchema(input.schema)
      ) {
        throw schemaConflict(input.expectedRevisionId, draft.baseRevisionId);
      }
      if (draft.draftVersion !== input.expectedDraftVersion) {
        throw schemaDraftConflict(input.expectedDraftVersion, draft.draftVersion);
      }
      await this.assertSchemaIdsUsable(client, input.schema);
      const previousSchema = await this.loadSchemaAtRevision(client, activeRevisionId);
      const authMaterialization = await this.authMaterialization.preflightAuthMaterialization(
        client,
        previousSchema,
        input.schema,
      );
      for (const operation of input.operations) {
        const statements = migrationStatements(operation);
        for (const statement of statements) {
          await client.query(statement.sql, statement.parameters === undefined ? [] : [...statement.parameters]);
        }
      }

      const hash = createHash("sha256").update(serializeSchema(input.schema)).digest("hex");
      await client.query(
        `INSERT INTO ${this.q("_xecms_schema_revisions")}
           (revision_id, parent_revision_id, schema_json, diff_json, hash, created_at, created_by)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
        [revisionId, input.expectedRevisionId, JSON.stringify(input.schema), JSON.stringify(input.changes), hash, input.now, input.actorId],
      );
      await this.authMaterialization.materializeCollectionAuth(
        client,
        authMaterialization,
        revisionId,
        input.actorId,
        input.now,
      );
      await this.activateSchemaIds(client, input.schema, revisionId, input.now);
      await client.query(
        `UPDATE ${this.q("_xecms_schema_state")} SET active_revision_id = $1 WHERE singleton = true`,
        [revisionId],
      );
      await client.query(
        `DELETE FROM ${this.q("_xecms_schema_drafts")} WHERE workspace_id = $1`,
        [DEFAULT_WORKSPACE_ID],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_migration_runs")}
         SET status = 'applied', completed_at = $2 WHERE migration_id = $1`,
        [migrationId, input.now],
      );
      await client.query("COMMIT");
      return {
        migrationId,
        revision: {
          revisionId,
          parentRevisionId: input.expectedRevisionId,
          schema: input.schema,
          createdAt: input.now,
          createdBy: input.actorId,
          hash,
        },
      };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      // The rolled-back client is still checked out, so reuse it even when the pool has one connection.
      await client.query(
        `UPDATE ${this.q("_xecms_migration_runs")}
         SET status = 'failed', completed_at = now(), error_code = $2 WHERE migration_id = $1`,
        [migrationId, databaseErrorCode(error)],
      );
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  private async getActiveRevisionId(client: PoolClient): Promise<string | null> {
    const result = await client.query<{ active_revision_id: string | null }>(
      `SELECT active_revision_id FROM ${this.q("_xecms_schema_state")} WHERE singleton = true FOR UPDATE`,
    );
    return result.rows[0]?.active_revision_id ?? null;
  }

  private async loadSchemaAtRevision(
    client: PoolClient,
    revisionId: string | null,
  ): Promise<SchemaIrV1> {
    if (revisionId === null) {
      return { format: "xecms.schema", formatVersion: 1, collections: [] };
    }
    const result = await client.query<{ schema_json: unknown }>(
      `SELECT schema_json FROM ${this.q("_xecms_schema_revisions")} WHERE revision_id = $1`,
      [revisionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ApplicationError(
        "SCHEMA_REGISTRY_CORRUPT",
        500,
        "The active schema revision is missing from the registry.",
      );
    }
    return decodeM1Schema(row.schema_json);
  }

  private async assertSchemaIdsUsable(client: PoolClient, schema: SchemaIrV1): Promise<void> {
    const objects = schemaObjects(schema);
    if (objects.length === 0) {
      return;
    }
    const result = await client.query<{ object_id: string; object_kind: string; state: string }>(
      `SELECT object_id, object_kind, state FROM ${this.q("_xecms_schema_object_ids")}
       WHERE object_id = ANY($1::text[])`,
      [objects.map(({ id }) => id)],
    );
    const rows = new Map(result.rows.map((row) => [row.object_id, row]));
    const issues: Array<{ code: string; message: string; path: readonly (string | number)[] }> = [];
    for (const object of objects) {
      const row = rows.get(object.id);
      if (row === undefined) {
        issues.push({
          code: "SCHEMA_ID_NOT_ISSUED",
          message: `Schema ID '${object.id}' was not issued by this registry.`,
          path: object.path,
        });
      } else if (row.object_kind !== object.kind) {
        issues.push({
          code: "SCHEMA_ID_KIND_MISMATCH",
          message: `Schema ID '${object.id}' was issued for '${row.object_kind}', not '${object.kind}'.`,
          path: object.path,
        });
      } else if (row.state === "retired") {
        issues.push({
          code: "SCHEMA_ID_REUSE_FORBIDDEN",
          message: `Retired Schema ID '${object.id}' cannot be reused.`,
          path: object.path,
        });
      }
    }
    if (issues.length > 0) {
      throw new ApplicationError("SCHEMA_ID_INVALID", 422, "Schema object IDs are invalid.", { issues });
    }
  }

  private async claimUnissuedSchemaIds(
    client: PoolClient,
    schema: SchemaIrV1,
    actorId: string,
    now: string,
  ): Promise<void> {
    for (const object of schemaObjects(schema)) {
      await client.query(
        `INSERT INTO ${this.q("_xecms_schema_object_ids")}
           (object_id, object_kind, state, issued_at, issued_by)
         VALUES ($1, $2, 'issued', $3, $4)
         ON CONFLICT (object_id) DO NOTHING`,
        [object.id, object.kind, now, actorId],
      );
    }
  }

  private async activateSchemaIds(
    client: PoolClient,
    schema: SchemaIrV1,
    revisionId: string,
    now: string,
  ): Promise<void> {
    const targetIds = schemaObjects(schema).map(({ id }) => id);
    if (targetIds.length > 0) {
      await client.query(
        `UPDATE ${this.q("_xecms_schema_object_ids")}
         SET state = 'active', activated_revision_id = $2
         WHERE object_id = ANY($1::text[]) AND state IN ('issued', 'active')`,
        [targetIds, revisionId],
      );
    }
    await client.query(
      `UPDATE ${this.q("_xecms_schema_object_ids")}
       SET state = 'retired', retired_revision_id = $2, retired_at = $3
       WHERE state = 'active' AND NOT (object_id = ANY($1::text[]))`,
      [targetIds, revisionId, now],
    );
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}
