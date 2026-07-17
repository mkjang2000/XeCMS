import { createHash, randomUUID } from "node:crypto";
import {
  ApplicationError,
  canonicalDocumentQueryScalar,
  decodeM1Schema,
  encodeDocumentQueryCursor,
  type AppliedSchemaResult,
  type AuthStore,
  type DocumentQueryFieldReference,
  type DocumentQueryFilter,
  type DocumentQueryStorePage,
  type DocumentQueryScalar,
  type DocumentQuerySort,
  type DocumentPage,
  type DocumentListState,
  type HardPurgePlan,
  type DocumentRecord,
  type DocumentStore,
  type DocumentWriteIntegrity,
  type IdentityRecord,
  type MigrationOperation,
  type NormalizedDocumentQuery,
  type PersistedDocumentEvent,
  type PublishedDocumentPage,
  type PublishedDocumentRecord,
  type SchemaDraftRecord,
  type SchemaRevisionRecord,
  type SchemaStore,
  type StoredSession,
} from "@xecms/application";
import {
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  assertDocumentInvariants,
  ContentHierarchyDomainError,
  type DocumentAggregate,
  type DocumentDeletion,
  type DocumentLifecycle,
  type DocumentRevision,
  type JsonObject,
  type Publication,
  type RevisionOrigin,
} from "@xecms/core";
import {
  collectionAuthDefinitionsEqual,
  serializeSchema,
  type CollectionAuthDefinition,
  type CollectionDefinition,
  type FieldDefinition,
  type SchemaIrV1,
} from "@xecms/schema";
import { Pool, type PoolClient } from "pg";
import {
  contentTableName,
  fieldColumnName,
  qualifiedName,
  quoteIdentifier,
  validateDatabaseSchema,
} from "./identifiers.js";
import {
  DEFAULT_WORKSPACE_ID,
  SYSTEM_REALM_ID,
  migrateCore,
} from "./migrate.js";
import { storageParameter, type PostgresMigrationOperation, type SqlStatement } from "./planner.js";
import { PostgresRelationStore } from "./postgres-relations.js";
import { PostgresMediaStore } from "./postgres-media.js";
import { PostgresContentHierarchyStore } from "./postgres-hierarchy.js";

export interface PostgresDatabaseOptions {
  readonly connectionString: string;
  readonly schema?: string;
  readonly maxConnections?: number;
}

export class PostgresDatabase implements SchemaStore, DocumentStore, AuthStore {
  public readonly pool: Pool;
  public readonly schema: string;
  private readonly projectionLockPool: Pool;
  private projectionLockQueue: Promise<void> = Promise.resolve();

  public constructor(options: PostgresDatabaseOptions) {
    this.schema = validateDatabaseSchema(options.schema ?? "xecms");
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
    });
    // Session advisory locks need a dedicated connection. Keeping it outside
    // the data pool prevents maxConnections=1 from deadlocking while the
    // protected operation performs its ordinary queries.
    this.projectionLockPool = new Pool({
      connectionString: options.connectionString,
      max: 1,
    });
  }

  public migrate(): Promise<void> {
    return migrateCore(this.pool, this.schema);
  }

  public async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  /** Serializes topology changes with their authorization projection across instances. */
  public async withContentProjectionLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireContentProjectionLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  /** Acquires the session lock for request-lifetime coordination. Release is idempotent. */
  public async acquireContentProjectionLock(): Promise<() => Promise<void>> {
    let releaseQueue!: () => void;
    const previous = this.projectionLockQueue;
    this.projectionLockQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;

    let client: PoolClient;
    try {
      client = await this.projectionLockPool.connect();
    } catch (error: unknown) {
      releaseQueue();
      throw error;
    }
    const key = `xecms:content-authorization-projection:${this.schema}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    } catch (error: unknown) {
      client.release();
      releaseQueue();
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      } finally {
        client.release();
        releaseQueue();
      }
    };
  }

  public async close(): Promise<void> {
    await Promise.all([this.pool.end(), this.projectionLockPool.end()]);
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
      await this.lockWorkspace(client);
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
      await this.lockWorkspace(client);
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
      const authMaterialization = await this.preflightAuthMaterialization(
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
      await this.materializeCollectionAuth(
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
      await this.pool.query(
        `UPDATE ${this.q("_xecms_migration_runs")}
         SET status = 'failed', completed_at = now(), error_code = $2 WHERE migration_id = $1`,
        [migrationId, databaseErrorCode(error)],
      );
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async loadDocument(documentId: string): Promise<DocumentAggregate | null> {
    const identityResult = await this.pool.query<DocumentIdentityRow>(
      `SELECT * FROM ${this.q("_xecms_documents")} WHERE id = $1`,
      [documentId],
    );
    const identity = identityResult.rows[0];
    if (identity === undefined) {
      return null;
    }
    const revisionResult = await this.pool.query<DocumentRevisionRow>(
      `SELECT * FROM ${this.q("_xecms_document_revisions")}
       WHERE document_id = $1 ORDER BY sequence ASC`,
      [documentId],
    );
    const aggregate = hydrateAggregate(identity, revisionResult.rows);
    assertDocumentInvariants(aggregate);
    return aggregate;
  }

  /** Counts active and soft-deleted documents without requiring an active schema definition. */
  public async countDocumentsByCollectionId(collectionId: string): Promise<number> {
    const result = await this.pool.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
         FROM ${this.q("_xecms_documents")}
        WHERE collection_id = $1`,
      [collectionId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async createDocument(
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
    events: readonly PersistedDocumentEvent[],
    integrity?: DocumentWriteIntegrity,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.assertSingletonAvailable(
        client,
        collection,
        aggregate.identity.workspaceId,
        aggregate.identity.id,
      );
      await this.insertIdentity(client, aggregate);
      for (const revision of aggregate.revisions) {
        await this.insertRevision(client, revision);
      }
      await this.upsertProjection(client, aggregate, collection);
      await this.synchronizeDocumentIntegrity(client, aggregate, collection, integrity, true);
      await this.insertDocumentEvents(
        client,
        events,
        String(aggregate.identity.workspaceId),
        String(collection.id),
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async updateDocument(
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
    expectedVersion: number,
    events: readonly PersistedDocumentEvent[],
    integrity?: DocumentWriteIntegrity,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.assertSingletonAvailable(
        client,
        collection,
        aggregate.identity.workspaceId,
        aggregate.identity.id,
      );
      await this.updateDocumentWithClient(
        client,
        aggregate,
        collection,
        expectedVersion,
        events,
        integrity,
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async listDocuments(
    collection: CollectionDefinition,
    input: {
      readonly page: number;
      readonly pageSize: number;
      readonly state: DocumentListState;
    },
  ): Promise<DocumentPage> {
    const table = qualifiedName(this.schema, contentTableName(collection.id));
    const aliases = collection.fields.map((field) =>
      `p.${quoteIdentifier(fieldColumnName(field.id))} AS ${quoteIdentifier(field.name)}`,
    );
    const offset = (input.page - 1) * input.pageSize;
    const statePredicate = input.state === "deleted" ? "d.deletion IS NOT NULL" : "d.deletion IS NULL";
    const [rows, count] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `SELECT p.id, p.aggregate_version, p.created_at, p.updated_at,
                d.created_by AS owner_subject_id,
                d.current_draft_revision_id, d.publication, d.lifecycle, d.deletion
                ${aliases.length === 0 ? "" : `, ${aliases.join(", ")}`}
         FROM ${table} p
         JOIN ${this.q("_xecms_documents")} d ON d.id = p.id
         WHERE ${statePredicate}
         ORDER BY p.updated_at DESC, p.id ASC LIMIT $1 OFFSET $2`,
        [input.pageSize, offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total
         FROM ${table} p
         JOIN ${this.q("_xecms_documents")} d ON d.id = p.id
         WHERE ${statePredicate}`,
      ),
    ]);
    return {
      items: rows.rows.map((row) => projectionToRecord(collection, row)),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  public async queryDocuments(
    collection: CollectionDefinition,
    input: NormalizedDocumentQuery,
  ): Promise<DocumentQueryStorePage> {
    const table = qualifiedName(this.schema, contentTableName(collection.id));
    const projectedFields = input.fields === undefined
      ? collection.fields
      : input.fields.map((fieldId) =>
        collection.fields.find(({ id }) => String(id) === fieldId)!);
    const aliases = projectedFields.map((field) =>
      `p.${quoteIdentifier(fieldColumnName(field.id))} AS ${quoteIdentifier(field.name)}`,
    );
    const fieldById = new Map(collection.fields.map((field) => [String(field.id), field]));
    const parameters: unknown[] = [];
    const statePredicate = input.state === "deleted" ? "d.deletion IS NOT NULL" : "d.deletion IS NULL";
    const filterPredicate = input.filter === undefined
      ? undefined
      : documentQueryFilterSql(input.filter, fieldById, parameters);
    const sortExpressions = input.sort.map(({ field }) =>
      documentQueryFieldSql(field, fieldById));
    const cursorPredicate = input.cursorValues === undefined
      ? undefined
      : documentQueryCursorSql(
        sortExpressions,
        input.sort,
        input.cursorValues,
        parameters,
      );
    const predicates = [statePredicate, filterPredicate, cursorPredicate]
      .filter((value): value is string => value !== undefined);
    const sortAliasNames = documentQuerySortAliasNames(collection, sortExpressions.length);
    const sortAliases = sortExpressions.map((expression, index) =>
      `${expression} AS ${quoteIdentifier(sortAliasNames[index]!)}`);
    parameters.push(input.limit + 1);
    const limitParameter = `$${parameters.length}`;
    const rows = await this.pool.query<Record<string, unknown>>(
      `SELECT p.id, p.aggregate_version, p.created_at, p.updated_at,
              d.created_by AS owner_subject_id,
              d.current_draft_revision_id, d.publication, d.lifecycle, d.deletion
              ${aliases.length === 0 ? "" : `, ${aliases.join(", ")}`}
              ${sortAliases.length === 0 ? "" : `, ${sortAliases.join(", ")}`}
       FROM ${table} p
       JOIN ${this.q("_xecms_documents")} d ON d.id = p.id
       WHERE ${predicates.join(" AND ")}
       ORDER BY ${sortExpressions.map((expression, index) =>
         `${expression} ${input.sort[index]!.direction.toUpperCase()} NULLS LAST`).join(", ")}
       LIMIT ${limitParameter}`,
      parameters,
    );
    const hasNextPage = rows.rows.length > input.limit;
    const selectedRows = hasNextPage ? rows.rows.slice(0, input.limit) : rows.rows;
    return {
      items: selectedRows.map((row) => ({
        document: projectionToRecord(collection, row),
        cursor: encodeDocumentQueryCursor(
          input.fingerprint,
          input.sort.map((_, index) =>
            canonicalDocumentQueryScalar(row[sortAliasNames[index]!])),
        ),
      })),
      hasNextPage,
    };
  }

  public async listPublishedDocuments(
    collection: CollectionDefinition,
    input: { readonly page: number; readonly pageSize: number },
  ): Promise<PublishedDocumentPage> {
    const offset = (input.page - 1) * input.pageSize;
    const predicate = `d.collection_id = $1
      AND d.deletion IS NULL
      AND d.lifecycle ->> 'kind' = 'active'
      AND d.publication IS NOT NULL`;
    const [rows, count] = await Promise.all([
      this.pool.query<PublishedDocumentRow>(
        `SELECT d.id, d.collection_id, d.created_at, d.created_by AS owner_subject_id,
                r.created_at AS updated_at,
                r.id AS revision_id, r.schema_revision_id, r.data,
                d.publication ->> 'publishedAt' AS published_at,
                d.publication ->> 'publishedBy' AS published_by
         FROM ${this.q("_xecms_documents")} d
         JOIN ${this.q("_xecms_document_revisions")} r
           ON r.id = d.publication ->> 'revisionId' AND r.document_id = d.id
         WHERE ${predicate}
         ORDER BY (d.publication ->> 'publishedAt')::timestamptz DESC, d.id ASC
         LIMIT $2 OFFSET $3`,
        [collection.id, input.pageSize, offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM ${this.q("_xecms_documents")} d WHERE ${predicate}`,
        [collection.id],
      ),
    ]);
    return {
      items: rows.rows.map(publishedRowToRecord),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  public async getPublishedDocument(
    collection: CollectionDefinition,
    documentId: string,
  ): Promise<PublishedDocumentRecord | null> {
    const result = await this.pool.query<PublishedDocumentRow>(
      `SELECT d.id, d.collection_id, d.created_at, d.created_by AS owner_subject_id,
              r.created_at AS updated_at,
              r.id AS revision_id, r.schema_revision_id, r.data,
              d.publication ->> 'publishedAt' AS published_at,
              d.publication ->> 'publishedBy' AS published_by
       FROM ${this.q("_xecms_documents")} d
       JOIN ${this.q("_xecms_document_revisions")} r
         ON r.id = d.publication ->> 'revisionId' AND r.document_id = d.id
       WHERE d.id = $1 AND d.collection_id = $2
         AND d.deletion IS NULL
         AND d.lifecycle ->> 'kind' = 'active'
         AND d.publication IS NOT NULL`,
      [documentId, collection.id],
    );
    const row = result.rows[0];
    return row === undefined ? null : publishedRowToRecord(row);
  }

  public async executeHardPurge(input: HardPurgePlan): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updateIds = input.updates.map(({ aggregate }) => String(aggregate.identity.id));
      const removalIds = input.removals.map(({ aggregate }) => String(aggregate.identity.id));
      const allIds = [...updateIds, ...removalIds];
      if (
        removalIds.length === 0 ||
        new Set(allIds).size !== allIds.length
      ) {
        throw new ApplicationError(
          "DOCUMENT_PURGE_PLAN_INVALID",
          500,
          "A hard purge plan must contain unique document operations and at least one removal.",
        );
      }

      // Relation writers take KEY SHARE locks on targets. Holding UPDATE locks
      // on the complete plan therefore prevents a new edge from crossing this
      // transaction's deletion boundary after it has been revalidated.
      const current = await client.query<{
        readonly id: string;
        readonly aggregate_version: string | number;
        readonly collection_id: string;
        readonly deletion: DocumentDeletion | null;
      }>(
        `SELECT id, aggregate_version, collection_id, deletion
         FROM ${this.q("_xecms_documents")}
         WHERE id = ANY($1::text[])
         ORDER BY id
         FOR UPDATE`,
        [allIds],
      );
      const currentById = new Map(current.rows.map((row) => [row.id, row]));
      for (const update of input.updates) {
        const id = String(update.aggregate.identity.id);
        const row = currentById.get(id);
        if (
          row === undefined ||
          row.collection_id !== String(update.collection.id) ||
          Number(row.aggregate_version) !== update.expectedVersion ||
          row.deletion !== null ||
          update.aggregate.aggregateVersion !== update.expectedVersion + 1 ||
          String(update.aggregate.identity.collectionId) !== String(update.collection.id)
        ) {
          throw new ApplicationError(
            "DOCUMENT_VERSION_CONFLICT",
            409,
            "A relation source changed before the hard purge could be committed.",
          );
        }
      }
      for (const removal of input.removals) {
        const id = String(removal.aggregate.identity.id);
        const row = currentById.get(id);
        const softDeletedByPlan = row?.deletion === null;
        const expectedFinalVersion = removal.expectedVersion + (softDeletedByPlan ? 1 : 0);
        const deletedEvents = removal.events.filter(({ type }) => type === "document.deleted");
        const purgedEvents = removal.events.filter(({ type }) => type === "document.purged");
        if (
          row === undefined ||
          row.collection_id !== String(removal.collection.id) ||
          Number(row.aggregate_version) !== removal.expectedVersion ||
          removal.aggregate.identity.deletion === null ||
          removal.aggregate.aggregateVersion !== expectedFinalVersion ||
          String(removal.aggregate.identity.collectionId) !== String(removal.collection.id) ||
          deletedEvents.length !== (softDeletedByPlan ? 1 : 0) ||
          purgedEvents.length !== 1 ||
          removal.events.some(({ documentId }) => String(documentId) !== id) ||
          purgedEvents[0]?.aggregateVersion !== removal.aggregate.aggregateVersion
        ) {
          throw new ApplicationError(
            "DOCUMENT_VERSION_CONFLICT",
            409,
            "A purge target changed before the hard purge could be committed.",
          );
        }
      }

      await this.assertHardPurgeRelationPlan(
        client,
        new Set(updateIds),
        new Set(removalIds),
      );

      for (const update of input.updates) {
        await this.updateDocumentWithClient(
          client,
          update.aggregate,
          update.collection,
          update.expectedVersion,
          update.events,
          update.integrity,
        );
      }

      // Deleting every outgoing edge up front allows mutually-related cascade
      // documents to be removed without relying on row deletion order.
      await client.query(
        `DELETE FROM ${this.q("_xecms_document_relations")}
         WHERE source_document_id = ANY($1::text[])`,
        [removalIds],
      );
      await this.assertNoIncomingPurgeRelations(client, removalIds);

      const hierarchy = new PostgresContentHierarchyStore(this.pool, this.schema);
      for (const removal of input.removals) {
        const purgeEvent = removal.events.find(({ type }) => type === "document.purged");
        if (purgeEvent === undefined || purgeEvent.type !== "document.purged") {
          throw new ApplicationError("DOCUMENT_PURGE_PLAN_INVALID", 500, "Purge event is missing.");
        }
        if (removal.collection.hierarchy?.enabled === true) {
          await hierarchy.removeNodeForPurgeWithClient(
            client,
            {
              workspaceId: removal.aggregate.identity.workspaceId,
              collectionId: removal.aggregate.identity.collectionId,
            },
            {
              documentId: removal.aggregate.identity.id,
              actorId: asSubjectId(purgeEvent.actorId),
              now: asUtcInstant(purgeEvent.occurredAt),
              ...(removal.collection.hierarchy.maxDepth === undefined
                ? {}
                : { maxDepth: removal.collection.hierarchy.maxDepth }),
            },
          );
        }
        await this.insertDocumentEvents(
          client,
          removal.events,
          String(removal.aggregate.identity.workspaceId),
          String(removal.collection.id),
        );
      }

      const deleted = await client.query(
        `DELETE FROM ${this.q("_xecms_documents")} WHERE id = ANY($1::text[])`,
        [removalIds],
      );
      if (deleted.rowCount !== removalIds.length) {
        throw new ApplicationError(
          "DOCUMENT_VERSION_CONFLICT",
          409,
          "A purge target changed before the hard purge could be committed.",
        );
      }
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async bootstrapRequired(): Promise<boolean> {
    const result = await this.pool.query<{ required: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM ${this.q("_xecms_identities")} WHERE workspace_id = $1 AND is_owner = true
       ) AS required`,
      [DEFAULT_WORKSPACE_ID],
    );
    return result.rows[0]?.required ?? true;
  }

  public async createInitialOwner(input: {
    readonly id: string;
    readonly username: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<IdentityRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client);
      const existing = await client.query(
        `SELECT 1 FROM ${this.q("_xecms_identities")} WHERE workspace_id = $1 AND is_owner = true`,
        [DEFAULT_WORKSPACE_ID],
      );
      if (existing.rowCount !== 0) {
        throw new ApplicationError(
          "BOOTSTRAP_ALREADY_COMPLETED",
          409,
          "The initial owner has already been created.",
        );
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_identities")}
           (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
            password_hash, is_owner, credential_version, created_at, updated_at, updated_by)
         VALUES ($1, $2, $3, $3, $4, $5, $6, true, 1, $7, $7, $1)`,
        [input.id, DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, input.username, normalizeUsername(input.username), input.passwordHash, input.now],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_identity_identifiers")}
           (id, workspace_id, identity_id, identifier_kind, normalized_value,
            display_value, verified_at, created_at, created_by)
         VALUES ($1, $2, $3, 'username', $4, $5, $6, $6, $3)`,
        [`identifier_${input.id}`, DEFAULT_WORKSPACE_ID, input.id,
          normalizeUsername(input.username), input.username, input.now],
      );
      await client.query("COMMIT");
      return {
        id: input.id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        username: input.username,
        passwordHash: input.passwordHash,
        isOwner: true,
        passwordChangeRequired: false,
      };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async findIdentityByUsername(username: string): Promise<IdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `SELECT id, workspace_id, username, password_hash, is_owner, password_change_required
       FROM ${this.q("_xecms_identities")}
       WHERE normalized_username = $1 AND disabled_at IS NULL`,
      [normalizeUsername(username)],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }

  /**
   * Recovers the protected workspace owner when an existing M1/M2 database is
   * upgraded and its normalized authorization policy still needs seeding.
   */
  public async findOwnerIdentity(): Promise<IdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `SELECT id, workspace_id, username, password_hash, is_owner, password_change_required
       FROM ${this.q("_xecms_identities")}
       WHERE workspace_id = $1 AND is_owner = true
       LIMIT 1`,
      [DEFAULT_WORKSPACE_ID],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }

  public async createSession(input: {
    readonly sessionTokenHash: string;
    readonly csrfTokenHash: string;
    readonly identityId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const membership = await client.query<{
        readonly id: string;
        readonly realm_id: string;
        readonly subject_id: string;
        readonly credential_version: string | number;
      }>(
        `INSERT INTO ${this.q("_xecms_realm_memberships")}
           (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, suspended_at, updated_at, updated_by)
         SELECT 'membership_system_' || md5(identity.id), identity.workspace_id, identity.id,
                subject.realm_id, subject.id, 'active', 'explicit', 1, $2, identity.id,
                $2, NULL, $2, identity.id
         FROM ${this.q("_xecms_identities")} identity
         JOIN ${this.q("_xecms_auth_subjects")} subject
           ON subject.identity_id = identity.id AND subject.realm_id = $3
         WHERE identity.id = $1 AND identity.disabled_at IS NULL AND subject.disabled_at IS NULL
         ON CONFLICT (identity_id, realm_id) DO UPDATE SET identity_id = EXCLUDED.identity_id
           WHERE ${this.q("_xecms_realm_memberships")}.status = 'active'
         RETURNING id, realm_id, subject_id,
           (SELECT credential_version FROM ${this.q("_xecms_identities")} WHERE id = $1)`,
        [input.identityId, input.createdAt, SYSTEM_REALM_ID],
      );
      const principal = membership.rows[0];
      if (principal === undefined) {
        throw new ApplicationError(
          "SESSION_PRINCIPAL_INVALID",
          401,
          "The System Identity has no active System Realm Membership.",
        );
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_sessions")}
           (id, token_hash, csrf_token_hash, identity_id, created_at, expires_at, audience,
            realm_id, membership_id, subject_id, authenticated_at, credential_version)
         VALUES ('session_' || md5($1), $1, $2, $3, $4, $5, 'admin', $6, $7, $8, $4, $9)`,
        [input.sessionTokenHash, input.csrfTokenHash, input.identityId, input.createdAt,
          input.expiresAt, principal.realm_id, principal.id, principal.subject_id,
          Number(principal.credential_version)],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async findSession(sessionTokenHash: string, now: string): Promise<StoredSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT i.id, i.workspace_id, i.username, i.password_hash, i.is_owner,
              i.password_change_required, s.expires_at
       FROM ${this.q("_xecms_sessions")} s
       JOIN ${this.q("_xecms_identities")} i ON i.id = s.identity_id
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.id = s.membership_id AND membership.identity_id = s.identity_id
        AND membership.realm_id = s.realm_id AND membership.subject_id = s.subject_id
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = s.realm_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = s.realm_id AND subject.id = s.subject_id
       WHERE s.token_hash = $1 AND s.expires_at > $2 AND s.audience = 'admin'
         AND s.revoked_at IS NULL
         AND realm.kind = 'system' AND realm.status = 'active'
         AND membership.status = 'active' AND i.disabled_at IS NULL AND subject.disabled_at IS NULL
         AND s.credential_version = i.credential_version`,
      [sessionTokenHash, now],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { identity: identityFromRow(row), expiresAt: instant(row.expires_at) };
  }

  public async findSessionWithCsrf(
    sessionTokenHash: string,
    csrfTokenHash: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.q("_xecms_sessions")} session
       JOIN ${this.q("_xecms_identities")} identity ON identity.id = session.identity_id
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.id = session.membership_id AND membership.identity_id = session.identity_id
        AND membership.realm_id = session.realm_id AND membership.subject_id = session.subject_id
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = session.realm_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = session.realm_id AND subject.id = session.subject_id
       WHERE session.token_hash = $1 AND session.csrf_token_hash = $2
         AND session.expires_at > $3 AND session.audience = 'admin'
         AND session.revoked_at IS NULL
         AND realm.kind = 'system' AND realm.status = 'active'
         AND membership.status = 'active' AND identity.disabled_at IS NULL
         AND subject.disabled_at IS NULL
         AND session.credential_version = identity.credential_version`,
      [sessionTokenHash, csrfTokenHash, now],
    );
    return result.rowCount === 1;
  }

  public async deleteSession(sessionTokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.q("_xecms_sessions")}
          SET revoked_at = now(), revoked_by_identity_id = identity_id, revoke_reason = 'logout'
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sessionTokenHash],
    );
  }

  public async recordAuthEvent(input: {
    readonly event:
      | "login.succeeded"
      | "login.failed"
      | "reauthentication.succeeded"
      | "reauthentication.failed"
      | "logout"
      | "bootstrap.owner-created";
    readonly identityId?: string;
    readonly username?: string;
    readonly occurredAt: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.q("_xecms_audit_log")}
         (event_type, identity_id, username, occurred_at)
       VALUES ($1, $2, $3, $4)`,
      [input.event, input.identityId ?? null, input.username ?? null, input.occurredAt],
    );
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }

  private lockWorkspace(client: PoolClient): Promise<unknown> {
    return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `xecms:workspace:${DEFAULT_WORKSPACE_ID}`,
    ]);
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

  private async preflightAuthMaterialization(
    client: PoolClient,
    previous: SchemaIrV1,
    next: SchemaIrV1,
  ): Promise<readonly AuthMaterializationTransition[]> {
    // Prevent a document or Membership from appearing after the destructive
    // preflight and before the corresponding Realm configuration is committed.
    await client.query(`LOCK TABLE ${this.q("_xecms_documents")} IN SHARE MODE`);
    await client.query(`LOCK TABLE ${this.q("_xecms_realm_memberships")} IN SHARE MODE`);
    await client.query(
      `LOCK TABLE ${this.q("_xecms_auth_collection_configs")} IN SHARE ROW EXCLUSIVE MODE`,
    );

    const previousCollections = new Map(previous.collections.map((collection) => [String(collection.id), collection]));
    const nextCollections = new Map(next.collections.map((collection) => [String(collection.id), collection]));
    const collectionIds = [...new Set([
      ...previousCollections.keys(),
      ...nextCollections.keys(),
    ])].sort((left, right) => left.localeCompare(right, "en-US"));
    const candidates = collectionIds.flatMap((collectionId) => {
      const previousAuth = previousCollections.get(collectionId)?.auth;
      const nextAuth = nextCollections.get(collectionId)?.auth;
      if (previousAuth === undefined && nextAuth === undefined) return [];
      return [{ collectionId, previousAuth, nextAuth }];
    });

    const claimedRealmKeys = new Map<string, string>();
    for (const collection of next.collections) {
      if (collection.auth === undefined) continue;
      const previousCollectionId = claimedRealmKeys.get(collection.auth.realmKey);
      if (previousCollectionId !== undefined && previousCollectionId !== collection.id) {
        throw new ApplicationError(
          "SCHEMA_AUTH_REALM_PROFILE_CONFLICT",
          409,
          "A Content Realm can have only one profile Collection.",
          { details: { realmKey: collection.auth.realmKey, collectionIds: [previousCollectionId, collection.id] } },
        );
      }
      claimedRealmKeys.set(collection.auth.realmKey, String(collection.id));
    }

    const realmKeys = [...new Set(candidates.flatMap(({ previousAuth, nextAuth }) => [
      ...(previousAuth === undefined ? [] : [previousAuth.realmKey]),
      ...(nextAuth === undefined ? [] : [nextAuth.realmKey]),
    ]))];
    const realms = realmKeys.length === 0
      ? []
      : (await client.query<AuthMaterializationRealmRow>(
        `SELECT realm.id, realm.workspace_id, realm.realm_key, realm.kind, realm.status,
                realm.profile_collection_id, realm.accept_system_identities,
                realm.membership_provisioning, realm.default_role_ids,
                state.current_revision AS policy_revision,
                state.root_resource_id AS policy_root_resource_id
         FROM ${this.q("_xecms_realms")} AS realm
         LEFT JOIN ${this.q("_xecms_auth_policy_state")} AS state ON state.realm_id = realm.id
         WHERE realm.workspace_id = $1 AND realm.realm_key = ANY($2::text[])
         ORDER BY realm.id
         FOR UPDATE OF realm`,
        [DEFAULT_WORKSPACE_ID, realmKeys],
      )).rows;
    const realmsByKey = new Map(realms.map((realm) => [realm.realm_key, realm]));

    const relevantCollectionIds = candidates.map(({ collectionId }) => collectionId);
    const relevantRealmIds = realms.map(({ id }) => id);
    const configs = relevantCollectionIds.length === 0 && relevantRealmIds.length === 0
      ? []
      : (await client.query<AuthMaterializationConfigRow>(
        `SELECT collection_id, realm_id
         FROM ${this.q("_xecms_auth_collection_configs")}
         WHERE collection_id = ANY($1::text[]) OR realm_id = ANY($2::text[])
         ORDER BY collection_id
         FOR UPDATE`,
        [relevantCollectionIds, relevantRealmIds],
      )).rows;
    const configsByCollection = new Map(configs.map((config) => [config.collection_id, config]));
    const configsByRealm = new Map(configs.map((config) => [config.realm_id, config]));

    const membershipRealms = relevantRealmIds.length === 0
      ? new Set<string>()
      : new Set((await client.query<{ realm_id: string }>(
        `SELECT DISTINCT realm_id
         FROM ${this.q("_xecms_realm_memberships")}
         WHERE realm_id = ANY($1::text[])`,
        [relevantRealmIds],
      )).rows.map(({ realm_id }) => realm_id));
    const collectionsWithDocuments = relevantCollectionIds.length === 0
      ? new Set<string>()
      : new Set((await client.query<{ collection_id: string }>(
        `SELECT DISTINCT collection_id
         FROM ${this.q("_xecms_documents")}
         WHERE workspace_id = $1 AND collection_id = ANY($2::text[])`,
        [DEFAULT_WORKSPACE_ID, relevantCollectionIds],
      )).rows.map(({ collection_id }) => collection_id));

    const transitions: AuthMaterializationTransition[] = [];
    for (const candidate of candidates) {
      const previousRealm = candidate.previousAuth === undefined
        ? undefined
        : requireAuthRealm(realmsByKey, candidate.previousAuth.realmKey, candidate.collectionId);
      const nextRealm = candidate.nextAuth === undefined
        ? undefined
        : requireAuthRealm(realmsByKey, candidate.nextAuth.realmKey, candidate.collectionId);
      const changed = !collectionAuthDefinitionsEqual(candidate.previousAuth, candidate.nextAuth);

      if (
        candidate.previousAuth === undefined
        && candidate.nextAuth !== undefined
        && collectionsWithDocuments.has(candidate.collectionId)
      ) {
        throw new ApplicationError(
          "SCHEMA_AUTH_EXISTING_DOCUMENTS",
          409,
          "Auth cannot be enabled on a Collection that already contains Documents.",
          { details: { collectionId: candidate.collectionId } },
        );
      }

      const protectedMembershipChange = candidate.previousAuth !== undefined && changed && (
        candidate.nextAuth === undefined
        || candidate.previousAuth.realmKey !== candidate.nextAuth.realmKey
        || !sameStringValues(
          candidate.previousAuth.identifierFieldIds,
          candidate.nextAuth.identifierFieldIds,
        )
      );
      if (
        protectedMembershipChange
        && previousRealm !== undefined
        && membershipRealms.has(previousRealm.id)
      ) {
        throw new ApplicationError(
          "SCHEMA_AUTH_MEMBERSHIP_CONFLICT",
          409,
          "Auth cannot be disabled or relinked while the Realm has Memberships.",
          { details: { collectionId: candidate.collectionId, realmId: previousRealm.id } },
        );
      }

      if (previousRealm !== undefined) {
        const previousConfig = configsByRealm.get(previousRealm.id);
        if (previousConfig !== undefined && previousConfig.collection_id !== candidate.collectionId) {
          authProfileConflict(previousRealm, candidate.collectionId);
        }
        if (
          previousRealm.profile_collection_id !== null
          && previousRealm.profile_collection_id !== candidate.collectionId
        ) {
          authProfileConflict(previousRealm, candidate.collectionId);
        }
      }

      if (nextRealm !== undefined) {
        const targetConfig = configsByRealm.get(nextRealm.id);
        if (targetConfig !== undefined && targetConfig.collection_id !== candidate.collectionId) {
          authProfileConflict(nextRealm, candidate.collectionId);
        }
        if (
          nextRealm.profile_collection_id !== null
          && nextRealm.profile_collection_id !== candidate.collectionId
        ) {
          authProfileConflict(nextRealm, candidate.collectionId);
        }
        const collectionConfig = configsByCollection.get(candidate.collectionId);
        if (
          collectionConfig !== undefined
          && collectionConfig.realm_id !== nextRealm.id
          && collectionConfig.realm_id !== previousRealm?.id
        ) {
          throw new ApplicationError(
            "SCHEMA_AUTH_CONFIG_CONFLICT",
            409,
            "The Collection has an inconsistent Content Realm configuration.",
            { details: { collectionId: candidate.collectionId, realmId: collectionConfig.realm_id } },
          );
        }
        if (
          Number(nextRealm.policy_revision ?? 0) <= 0
          || nextRealm.policy_root_resource_id === null
        ) {
          throw new ApplicationError(
            "SCHEMA_AUTH_POLICY_UNINITIALIZED",
            409,
            "The Content Realm authorization policy must be initialized before auth is enabled.",
            { details: { collectionId: candidate.collectionId, realmId: nextRealm.id } },
          );
        }
      }

      transitions.push({
        collectionId: candidate.collectionId,
        changed,
        ...(candidate.previousAuth === undefined ? {} : { previousAuth: candidate.previousAuth }),
        ...(candidate.nextAuth === undefined ? {} : { nextAuth: candidate.nextAuth }),
        ...(previousRealm === undefined ? {} : { previousRealmId: previousRealm.id }),
        ...(nextRealm === undefined ? {} : { nextRealmId: nextRealm.id }),
      });
    }
    return transitions;
  }

  private async materializeCollectionAuth(
    client: PoolClient,
    transitions: readonly AuthMaterializationTransition[],
    schemaRevisionId: string,
    actorId: string,
    now: string,
  ): Promise<void> {
    for (const transition of transitions) {
      if (
        transition.previousRealmId !== undefined
        && (
          transition.nextRealmId === undefined
          || transition.nextRealmId !== transition.previousRealmId
        )
      ) {
        await client.query(
          `DELETE FROM ${this.q("_xecms_auth_collection_configs")}
           WHERE collection_id = $1 AND realm_id = $2`,
          [transition.collectionId, transition.previousRealmId],
        );
        await client.query(
          `UPDATE ${this.q("_xecms_realms")} AS realm
           SET profile_collection_id = NULL,
               status = 'disabled',
               revision = revision + 1,
               updated_at = $3,
               updated_by = $4
           WHERE realm.id = $2
             AND (realm.profile_collection_id IS NULL OR realm.profile_collection_id = $1)
             AND (realm.profile_collection_id IS NOT NULL OR realm.status <> 'disabled')`,
          [transition.collectionId, transition.previousRealmId, now, actorId],
        );
      }
    }

    for (const transition of transitions) {
      if (transition.nextAuth === undefined || transition.nextRealmId === undefined) continue;
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_collection_configs")}
           (collection_id, realm_id, identifier_field_ids, status, schema_revision_id,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3::text[], 'active', $4, $5, $6, $5, $6)
         ON CONFLICT (collection_id) DO UPDATE SET
           realm_id = EXCLUDED.realm_id,
           identifier_field_ids = EXCLUDED.identifier_field_ids,
           status = 'active',
           schema_revision_id = EXCLUDED.schema_revision_id,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [transition.collectionId, transition.nextRealmId,
          [...transition.nextAuth.identifierFieldIds], schemaRevisionId, now, actorId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_realms")} AS realm
         SET profile_collection_id = $1,
             accept_system_identities = $3,
             membership_provisioning = $4,
             default_role_ids = $5::text[],
             status = CASE WHEN realm.status = 'provisioning' THEN 'active' ELSE realm.status END,
             revision = revision + 1,
             updated_at = $6,
             updated_by = $7
         WHERE realm.id = $2
           AND (
             realm.profile_collection_id IS DISTINCT FROM $1
             OR realm.accept_system_identities IS DISTINCT FROM $3
             OR realm.membership_provisioning IS DISTINCT FROM $4
             OR realm.default_role_ids IS DISTINCT FROM $5::text[]
             OR realm.status = 'provisioning'
           )`,
        [transition.collectionId, transition.nextRealmId,
          transition.nextAuth.acceptSystemIdentities, transition.nextAuth.provisioning,
          [...transition.nextAuth.defaultRoleIds], now, actorId],
      );
    }
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

  private async insertIdentity(client: PoolClient, aggregate: DocumentAggregate): Promise<void> {
    const identity = aggregate.identity;
    await client.query(
      `INSERT INTO ${this.q("_xecms_documents")}
         (id, workspace_id, collection_id, current_draft_revision_id, publication, lifecycle,
          deletion, created_at, created_by, updated_at, updated_by, aggregate_version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)`,
      [
        identity.id,
        identity.workspaceId,
        identity.collectionId,
        identity.currentDraftRevisionId,
        jsonOrNull(identity.publication),
        JSON.stringify(identity.lifecycle),
        jsonOrNull(identity.deletion),
        identity.createdAt,
        identity.createdBy,
        identity.updatedAt,
        identity.updatedBy,
        aggregate.aggregateVersion,
      ],
    );
  }

  private async insertRevision(client: PoolClient, revision: DocumentRevision): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_document_revisions")}
         (id, document_id, sequence, schema_revision_id, data, parent_revision_id, origin, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)`,
      [
        revision.id,
        revision.documentId,
        revision.sequence,
        revision.schemaRevisionId,
        JSON.stringify(revision.data),
        revision.parentRevisionId,
        JSON.stringify(revision.origin),
        revision.createdAt,
        revision.createdBy,
      ],
    );
  }

  private async updateDocumentWithClient(
    client: PoolClient,
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
    expectedVersion: number,
    events: readonly PersistedDocumentEvent[],
    integrity: DocumentWriteIntegrity | undefined,
  ): Promise<void> {
    const updated = await client.query(
      `UPDATE ${this.q("_xecms_documents")} SET
         current_draft_revision_id = $1,
         publication = $2::jsonb,
         lifecycle = $3::jsonb,
         deletion = $4::jsonb,
         updated_at = $5,
         updated_by = $6,
         aggregate_version = $7
       WHERE id = $8 AND aggregate_version = $9`,
      [
        aggregate.identity.currentDraftRevisionId,
        jsonOrNull(aggregate.identity.publication),
        JSON.stringify(aggregate.identity.lifecycle),
        jsonOrNull(aggregate.identity.deletion),
        aggregate.identity.updatedAt,
        aggregate.identity.updatedBy,
        aggregate.aggregateVersion,
        aggregate.identity.id,
        expectedVersion,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new ApplicationError(
        "DOCUMENT_VERSION_CONFLICT",
        409,
        "The document was changed by another request.",
      );
    }
    const newest = aggregate.revisions.at(-1);
    if (newest !== undefined) {
      const exists = await client.query(
        `SELECT 1 FROM ${this.q("_xecms_document_revisions")} WHERE id = $1`,
        [newest.id],
      );
      if (exists.rowCount === 0) {
        await this.insertRevision(client, newest);
      }
    }
    await this.upsertProjection(client, aggregate, collection);
    await this.synchronizeDocumentIntegrity(client, aggregate, collection, integrity, false);
    await this.insertDocumentEvents(
      client,
      events,
      String(aggregate.identity.workspaceId),
      String(collection.id),
    );
  }

  private async insertDocumentEvents(
    client: PoolClient,
    events: readonly PersistedDocumentEvent[],
    workspaceId: string,
    collectionId: string,
  ): Promise<void> {
    for (const event of events) {
      const inserted = await client.query<{ readonly id: string | number }>(
        `INSERT INTO ${this.q("_xecms_document_events")}
           (document_id, event_type, aggregate_version, actor_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id`,
        [
          event.documentId,
          event.type,
          event.aggregateVersion,
          event.actorId,
          event.occurredAt,
          JSON.stringify(documentEventAuditPayload(event)),
        ],
      );
      const sourceId = inserted.rows[0]?.id;
      if (sourceId === undefined) throw new Error("Document event insert returned no id.");
      await client.query(
        `INSERT INTO ${this.q("_xecms_outbox_events")}
           (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id,
            aggregate_version, actor_subject_id, occurred_at, payload, created_at)
         VALUES (
           $1, $2,
           (SELECT subject.realm_id FROM ${this.q("_xecms_auth_subjects")} subject
             WHERE subject.id = $3 ORDER BY subject.realm_id LIMIT 1),
           $4, 'document', $5, $6, $3, $7, $8::jsonb, $7
         )`,
        [
          `outbox_document_${sourceId}`,
          workspaceId,
          event.actorId,
          event.type,
          event.documentId,
          event.aggregateVersion,
          event.occurredAt,
          JSON.stringify({ ...event, collectionId }),
        ],
      );
    }
  }

  private async assertHardPurgeRelationPlan(
    client: PoolClient,
    updateIds: ReadonlySet<string>,
    removalIds: ReadonlySet<string>,
  ): Promise<void> {
    const incoming = await client.query<{
      readonly relation_id: string;
      readonly source_document_id: string;
      readonly target_document_id: string;
      readonly on_delete: string;
    }>(
      `SELECT relation_id, source_document_id, target_document_id, on_delete
       FROM ${this.q("_xecms_document_relations")}
       WHERE target_document_id = ANY($1::text[])
       ORDER BY target_document_id, relation_id, source_document_id
       FOR UPDATE`,
      [[...removalIds]],
    );
    const unexpected = incoming.rows.filter((row) =>
      !removalIds.has(row.source_document_id) &&
      !(row.on_delete === "nullify" && updateIds.has(row.source_document_id)));
    if (unexpected.length > 0) {
      throw new ApplicationError(
        "RELATION_DELETE_RESTRICTED",
        409,
        `The hard purge plan is stale or restricted by ${unexpected.length} relation(s).`,
        { details: { incoming: unexpected } },
      );
    }
  }

  private async assertNoIncomingPurgeRelations(
    client: PoolClient,
    documentIds: readonly string[],
  ): Promise<void> {
    const incoming = await client.query<{
      readonly relation_id: string;
      readonly source_document_id: string;
      readonly target_document_id: string;
      readonly on_delete: string;
    }>(
      `SELECT relation_id, source_document_id, target_document_id, on_delete
       FROM ${this.q("_xecms_document_relations")}
       WHERE target_document_id = ANY($1::text[])
       ORDER BY target_document_id, relation_id, source_document_id`,
      [documentIds],
    );
    if (incoming.rowCount !== 0) {
      throw new ApplicationError(
        "RELATION_DELETE_RESTRICTED",
        409,
        `The hard purge left ${incoming.rowCount} incoming relation(s).`,
        { details: { incoming: incoming.rows } },
      );
    }
  }

  private async synchronizeDocumentIntegrity(
    client: PoolClient,
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
    integrity: DocumentWriteIntegrity | undefined,
    creating: boolean,
  ): Promise<void> {
    if (integrity === undefined) return;
    const relations = new PostgresRelationStore(this.pool, this.schema);
    const relationResult = await relations.validateAndReplaceWithClient(client, {
      sourceCollectionId: String(collection.id),
      sourceDocumentId: String(aggregate.identity.id),
      expectedDocumentVersion: aggregate.aggregateVersion,
      edges: integrity.relationEdges,
    });
    if (relationResult.status === "invalid-targets") {
      throw new ApplicationError(
        "RELATION_TARGET_INVALID",
        422,
        "One or more relation targets do not exist in the configured collection.",
        { details: { issues: relationResult.issues } },
      );
    }

    const media = new PostgresMediaStore(this.pool, this.schema);
    const mediaResult = await media.validateAndReplaceDocumentMediaWithClient(client, {
      workspaceId: String(aggregate.identity.workspaceId),
      sourceDocumentId: String(aggregate.identity.id),
      expectedDocumentVersion: aggregate.aggregateVersion,
      edges: integrity.mediaReferences.map((reference) => ({
        sourceDocumentId: String(aggregate.identity.id),
        ...reference,
      })),
    });
    if (mediaResult.status === "invalid-media") {
      throw new ApplicationError(
        "MEDIA_REFERENCE_INVALID",
        422,
        "One or more upload field references are unavailable.",
        { details: { issues: mediaResult.issues } },
      );
    }

    if (creating && collection.hierarchy?.enabled === true) {
      if (integrity.hierarchy === undefined) {
        throw new ApplicationError("HIERARCHY_PLACEMENT_REQUIRED", 422, "Hierarchy placement is required.");
      }
      const hierarchy = new PostgresContentHierarchyStore(this.pool, this.schema);
      await hierarchy.addNodeWithClient(
        client,
        {
          workspaceId: aggregate.identity.workspaceId,
          collectionId: aggregate.identity.collectionId,
        },
        {
          documentId: aggregate.identity.id,
          parentId: integrity.hierarchy.parentId,
          position: integrity.hierarchy.position,
          expectedVersion: integrity.hierarchy.expectedVersion,
          actorId: aggregate.identity.createdBy,
          now: aggregate.identity.createdAt,
          ...(collection.hierarchy.maxDepth === undefined
            ? {}
            : { maxDepth: collection.hierarchy.maxDepth }),
        },
      );
    }
  }

  private async assertSingletonAvailable(
    client: PoolClient,
    collection: CollectionDefinition,
    workspaceId: string,
    documentId: string,
  ): Promise<void> {
    if (collection.kind !== "singleton") return;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `xecms:singleton:${collection.id}`,
    ]);
    const existing = await client.query(
      `SELECT 1
       FROM ${this.q("_xecms_documents")}
       WHERE workspace_id = $1 AND collection_id = $2 AND deletion IS NULL AND id <> $3
       LIMIT 1`,
      [workspaceId, collection.id, documentId],
    );
    if (existing.rowCount !== 0) {
      throw new ApplicationError(
        "SINGLETON_ALREADY_EXISTS",
        409,
        `Singleton collection '${collection.name}' already has a document.`,
      );
    }
  }

  private async upsertProjection(
    client: PoolClient,
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
  ): Promise<void> {
    const revisionId = aggregate.identity.currentDraftRevisionId ?? aggregate.identity.publication?.revisionId;
    const revision = aggregate.revisions.find(({ id }) => id === revisionId);
    if (revision === undefined) {
      throw new ApplicationError("DOCUMENT_INVARIANT_FAILED", 500, "Working revision was not found.");
    }
    const fieldColumns = collection.fields.map(({ id }) => quoteIdentifier(fieldColumnName(id)));
    const columns = ["id", "aggregate_version", "created_at", "updated_at", "deleted_at"].map(quoteIdentifier);
    columns.push(...fieldColumns);
    const values: unknown[] = [
      aggregate.identity.id,
      aggregate.aggregateVersion,
      aggregate.identity.createdAt,
      aggregate.identity.updatedAt,
      aggregate.identity.deletion?.deletedAt ?? null,
      ...collection.fields.map((field) =>
        storageParameter(field, revision.data[field.name] ?? null)),
    ];
    const assignments = columns
      .slice(1)
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(", ");
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(
      `INSERT INTO ${qualifiedName(this.schema, contentTableName(collection.id))}
         (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT (id) DO UPDATE SET ${assignments}`,
      values,
    );
  }
}

interface SchemaRevisionRow {
  readonly revision_id: string | null;
  readonly parent_revision_id: string | null;
  readonly schema_json: unknown;
  readonly created_at: Date | string | null;
  readonly created_by: string | null;
  readonly hash: string | null;
}

interface SchemaDraftRow {
  readonly base_revision_id: string | null;
  readonly draft_version: string;
  readonly schema_json: unknown;
  readonly updated_at: Date | string;
  readonly updated_by: string;
}

interface AuthMaterializationRealmRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly realm_key: string;
  readonly kind: "system" | "content";
  readonly status: "provisioning" | "active" | "disabled";
  readonly profile_collection_id: string | null;
  readonly accept_system_identities: boolean;
  readonly membership_provisioning: "explicit" | "jit";
  readonly default_role_ids: string[];
  readonly policy_revision: string | number | null;
  readonly policy_root_resource_id: string | null;
}

interface AuthMaterializationConfigRow {
  readonly collection_id: string;
  readonly realm_id: string;
}

interface AuthMaterializationTransition {
  readonly collectionId: string;
  readonly changed: boolean;
  readonly previousAuth?: CollectionAuthDefinition;
  readonly nextAuth?: CollectionAuthDefinition;
  readonly previousRealmId?: string;
  readonly nextRealmId?: string;
}

interface DocumentIdentityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly collection_id: string;
  readonly current_draft_revision_id: string | null;
  readonly publication: Publication | null;
  readonly lifecycle: DocumentLifecycle;
  readonly deletion: DocumentDeletion | null;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly updated_at: Date | string;
  readonly updated_by: string;
  readonly aggregate_version: string | number;
}

interface DocumentRevisionRow {
  readonly id: string;
  readonly document_id: string;
  readonly sequence: number;
  readonly schema_revision_id: string;
  readonly data: JsonObject;
  readonly parent_revision_id: string | null;
  readonly origin: RevisionOrigin;
  readonly created_at: Date | string;
  readonly created_by: string;
}

interface PublishedDocumentRow {
  readonly id: string;
  readonly collection_id: string;
  readonly data: JsonObject;
  readonly revision_id: string;
  readonly schema_revision_id: string;
  readonly published_at: string;
  readonly published_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly owner_subject_id: string;
}

interface IdentityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly is_owner: boolean;
  readonly password_change_required: boolean;
}

interface SessionRow extends IdentityRow {
  readonly expires_at: Date | string;
}

function schemaRevisionFromRow(row: SchemaRevisionRow): SchemaRevisionRecord {
  if (
    row.revision_id === null ||
    row.created_at === null ||
    row.created_by === null ||
    row.hash === null
  ) {
    throw new ApplicationError("SCHEMA_REGISTRY_CORRUPT", 500, "The schema registry row is incomplete.");
  }
  return {
    revisionId: row.revision_id,
    parentRevisionId: row.parent_revision_id,
    schema: decodeM1Schema(row.schema_json),
    createdAt: instant(row.created_at),
    createdBy: row.created_by,
    hash: row.hash,
  };
}

function schemaDraftFromRow(row: SchemaDraftRow): SchemaDraftRecord {
  return {
    baseRevisionId: row.base_revision_id,
    draftVersion: row.draft_version,
    schema: decodeM1Schema(row.schema_json),
    updatedAt: instant(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function hydrateAggregate(
  identity: DocumentIdentityRow,
  revisions: readonly DocumentRevisionRow[],
): DocumentAggregate {
  return {
    identity: {
      id: asDocumentId(identity.id),
      workspaceId: asWorkspaceId(identity.workspace_id),
      collectionId: asCollectionId(identity.collection_id),
      currentDraftRevisionId:
        identity.current_draft_revision_id === null
          ? null
          : asRevisionId(identity.current_draft_revision_id),
      publication: identity.publication,
      lifecycle: identity.lifecycle,
      deletion: identity.deletion,
      createdAt: asUtcInstant(instant(identity.created_at)),
      createdBy: asSubjectId(identity.created_by),
      updatedAt: asUtcInstant(instant(identity.updated_at)),
      updatedBy: asSubjectId(identity.updated_by),
    },
    revisions: revisions.map((revision) => ({
      id: asRevisionId(revision.id),
      documentId: asDocumentId(revision.document_id),
      sequence: revision.sequence,
      schemaRevisionId: asSchemaRevisionId(revision.schema_revision_id),
      data: revision.data,
      parentRevisionId:
        revision.parent_revision_id === null ? null : asRevisionId(revision.parent_revision_id),
      origin: revision.origin,
      createdAt: asUtcInstant(instant(revision.created_at)),
      createdBy: asSubjectId(revision.created_by),
    })),
    aggregateVersion: Number(identity.aggregate_version),
  };
}

function projectionToRecord(
  collection: CollectionDefinition,
  row: Record<string, unknown>,
): DocumentRecord {
  const data: Record<string, unknown> = {};
  for (const field of collection.fields) {
    const value = row[field.name];
    if (value !== null && value !== undefined) {
      data[field.name] = field.type === "datetime" && value instanceof Date ? value.toISOString() : value;
    }
  }
  const draftRevisionId = row["current_draft_revision_id"] === null
    ? null
    : String(row["current_draft_revision_id"]);
  const publication = (row["publication"] ?? null) as Publication | null;
  const lifecycle = row["lifecycle"] as DocumentLifecycle;
  const deletion = (row["deletion"] ?? null) as DocumentDeletion | null;
  return {
    id: String(row["id"]),
    collectionId: collection.id,
    data,
    version: Number(row["aggregate_version"]),
    createdAt: instant(row["created_at"] as Date | string),
    updatedAt: instant(row["updated_at"] as Date | string),
    ownerSubjectId: String(row["owner_subject_id"]),
    displayState: deletion !== null
      ? "deleted"
      : lifecycle.kind === "archived"
        ? "archived"
        : publication !== null && draftRevisionId !== null
          ? "published-with-draft"
          : publication !== null
            ? "published"
            : "draft",
    draftRevisionId,
    publication,
    deletion,
  };
}

function documentQueryFieldSql(
  reference: DocumentQueryFieldReference,
  fieldById: ReadonlyMap<string, FieldDefinition>,
): string {
  if (reference.kind === "data") {
    return `p.${quoteIdentifier(fieldColumnName(fieldById.get(reference.fieldId)!.id))}`;
  }
  switch (reference.field) {
    case "id": return "p.id";
    case "createdAt": return "p.created_at";
    case "updatedAt": return "p.updated_at";
    case "version": return "p.aggregate_version";
  }
}

function documentQuerySortAliasNames(
  collection: CollectionDefinition,
  count: number,
): readonly string[] {
  const reserved = new Set([
    ...collection.fields.map(({ name }) => name),
    "id",
    "aggregate_version",
    "created_at",
    "updated_at",
    "owner_subject_id",
    "current_draft_revision_id",
    "publication",
    "lifecycle",
    "deletion",
  ]);
  return Array.from({ length: count }, (_, index) => {
    let candidate = `__xecms_query_sort_${index}`;
    while (reserved.has(candidate)) candidate = `_${candidate}`;
    reserved.add(candidate);
    return candidate;
  });
}

function documentQueryFilterSql(
  filter: DocumentQueryFilter,
  fieldById: ReadonlyMap<string, FieldDefinition>,
  parameters: unknown[],
): string {
  if (filter.type === "group") {
    const joiner = filter.operator === "and" ? " AND " : " OR ";
    return `(${filter.filters.map((child) =>
      documentQueryFilterSql(child, fieldById, parameters)).join(joiner)})`;
  }
  const column = documentQueryFieldSql(filter.field, fieldById);
  if (filter.operator === "isNull") return `${column} IS NULL`;
  if (filter.operator === "isNotNull") return `${column} IS NOT NULL`;
  if (filter.operator === "in") {
    const values = filter.value as readonly DocumentQueryScalar[];
    const nonNull = values.filter((value) => value !== null);
    const includesNull = nonNull.length !== values.length;
    if (nonNull.length === 0) return `${column} IS NULL`;
    const placeholder = pushQueryParameter(parameters, nonNull);
    const membership = `${column} = ANY(${placeholder})`;
    return includesNull ? `(${membership} OR ${column} IS NULL)` : membership;
  }
  const value = filter.value as DocumentQueryScalar;
  if (filter.operator === "eq" && value === null) return `${column} IS NULL`;
  if (filter.operator === "ne" && value === null) return `${column} IS NOT NULL`;
  const placeholder = pushQueryParameter(parameters, value);
  switch (filter.operator) {
    case "eq": return `${column} IS NOT DISTINCT FROM ${placeholder}`;
    case "ne": return `${column} IS DISTINCT FROM ${placeholder}`;
    case "lt": return `${column} < ${placeholder}`;
    case "lte": return `${column} <= ${placeholder}`;
    case "gt": return `${column} > ${placeholder}`;
    case "gte": return `${column} >= ${placeholder}`;
    case "contains": return `POSITION(${placeholder} IN ${column}) > 0`;
    case "startsWith": return `LEFT(${column}, char_length(${placeholder})) = ${placeholder}`;
  }
}

function documentQueryCursorSql(
  expressions: readonly string[],
  sort: readonly DocumentQuerySort[],
  values: readonly DocumentQueryScalar[],
  parameters: unknown[],
): string {
  const placeholders = values.map((value) => pushQueryParameter(parameters, value));
  const branches = expressions.map((expression, index) => {
    const prefix = expressions.slice(0, index).map((prefixExpression, prefixIndex) =>
      `${prefixExpression} IS NOT DISTINCT FROM ${placeholders[prefixIndex]}`).join(" AND ");
    const value = values[index]!;
    if (value === null) return prefix === "" ? "FALSE" : `(${prefix} AND FALSE)`;
    const comparator = sort[index]!.direction === "asc" ? ">" : "<";
    const current = `(${expression} ${comparator} ${placeholders[index]} OR ${expression} IS NULL)`;
    return prefix === "" ? current : `(${prefix} AND ${current})`;
  });
  return `(${branches.join(" OR ")})`;
}

function pushQueryParameter(parameters: unknown[], value: unknown): string {
  parameters.push(value);
  return `$${parameters.length}`;
}

function publishedRowToRecord(row: PublishedDocumentRow): PublishedDocumentRecord {
  return {
    id: row.id,
    collectionId: row.collection_id,
    data: row.data,
    revisionId: row.revision_id,
    schemaRevisionId: row.schema_revision_id,
    publishedAt: instant(row.published_at),
    publishedBy: row.published_by,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    ownerSubjectId: row.owner_subject_id,
  };
}

function schemaContainsRelationField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(schemaContainsRelationField);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const object = value as Readonly<Record<string, unknown>>;
  if (object["type"] === "relation") {
    return true;
  }
  return Object.values(object).some(schemaContainsRelationField);
}

/**
 * Audit history intentionally keeps lifecycle metadata but never revision
 * content. This remains true after purge, when the event table is the only
 * surviving document record.
 */
export function documentEventAuditPayload(
  event: PersistedDocumentEvent,
): object {
  if (!("revision" in event)) {
    return event;
  }
  return {
    ...event,
    revision: {
      id: event.revision.id,
      documentId: event.revision.documentId,
      sequence: event.revision.sequence,
      schemaRevisionId: event.revision.schemaRevisionId,
      parentRevisionId: event.revision.parentRevisionId,
      origin: event.revision.origin,
      createdAt: event.revision.createdAt,
      createdBy: event.revision.createdBy,
    },
  };
}

function identityFromRow(row: IdentityRow): IdentityRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    username: row.username,
    passwordHash: row.password_hash,
    isOwner: row.is_owner,
    passwordChangeRequired: row.password_change_required,
  };
}

function schemaObjects(schema: SchemaIrV1): readonly {
  readonly id: string;
  readonly kind: "collection" | "field" | "relation" | "component";
  readonly path: readonly (string | number)[];
}[] {
  return [
    ...schema.collections.flatMap((collection, collectionIndex) => [
      { id: collection.id, kind: "collection" as const, path: ["collections", collectionIndex, "id"] },
      ...fieldSchemaObjects(collection.fields, ["collections", collectionIndex, "fields"]),
    ]),
    ...(schema.components ?? []).flatMap((component, componentIndex) => [
      { id: component.id, kind: "component" as const, path: ["components", componentIndex, "id"] },
      ...fieldSchemaObjects(component.fields, ["components", componentIndex, "fields"]),
    ]),
  ];
}

function fieldSchemaObjects(
  fields: readonly FieldDefinition[],
  path: readonly (string | number)[],
): readonly {
  readonly id: string;
  readonly kind: "field" | "relation";
  readonly path: readonly (string | number)[];
}[] {
  return fields.flatMap((field, fieldIndex) => {
    const fieldPath = [...path, fieldIndex] as const;
    return [
      { id: field.id, kind: "field" as const, path: [...fieldPath, "id"] },
      ...(field.type === "relation"
        ? [{ id: field.relationId, kind: "relation" as const, path: [...fieldPath, "relationId"] }]
        : []),
      ...(field.type === "object" || field.type === "array"
        ? fieldSchemaObjects(field.fields, [...fieldPath, "fields"])
        : []),
    ];
  });
}

function migrationStatements(operation: MigrationOperation): readonly SqlStatement[] {
  if ("statements" in operation && Array.isArray(operation.statements)) {
    return (operation as PostgresMigrationOperation).statements;
  }
  return [{ sql: operation.sql }];
}

function publicOperations(operations: readonly MigrationOperation[]): readonly unknown[] {
  return operations.map(({ id, kind, summary, severity, sql }) => ({ id, kind, summary, severity, sql }));
}

function schemaConflict(expected: string | null, actual: string | null): ApplicationError {
  return new ApplicationError(
    "SCHEMA_REVISION_CONFLICT",
    409,
    "The active schema no longer matches the draft base revision.",
    { details: { expectedRevisionId: expected, actualRevisionId: actual } },
  );
}

function schemaDraftConflict(expected: string | null, actual: string | null): ApplicationError {
  return new ApplicationError(
    "SCHEMA_DRAFT_CONFLICT",
    409,
    "The schema draft was changed by another editor.",
    { details: { expectedDraftVersion: expected, actualDraftVersion: actual } },
  );
}

function requireAuthRealm(
  realmsByKey: ReadonlyMap<string, AuthMaterializationRealmRow>,
  realmKey: string,
  collectionId: string,
): AuthMaterializationRealmRow {
  const realm = realmsByKey.get(realmKey);
  if (realm === undefined || realm.kind !== "content") {
    throw new ApplicationError(
      "SCHEMA_AUTH_REALM_NOT_FOUND",
      409,
      "Schema auth requires a pre-existing Content Realm in this Workspace.",
      { details: { realmKey, collectionId } },
    );
  }
  return realm;
}

function authProfileConflict(realm: AuthMaterializationRealmRow, collectionId: string): never {
  throw new ApplicationError(
    "SCHEMA_AUTH_REALM_PROFILE_CONFLICT",
    409,
    "A Content Realm can have only one profile Collection.",
    {
      details: {
        realmId: realm.id,
        collectionId,
        currentProfileCollectionId: realm.profile_collection_id,
      },
    },
  );
}

function sameStringValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeUsername(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

interface PostgresLikeError {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof ApplicationError) {
    return error;
  }
  if (error instanceof ContentHierarchyDomainError) {
    const status = error.code === "HIERARCHY_VERSION_CONFLICT"
      ? 409
      : error.code === "HIERARCHY_NODE_NOT_FOUND" || error.code === "HIERARCHY_PARENT_NOT_FOUND"
        ? 404
        : 422;
    return new ApplicationError(error.code, status, error.message, { details: error.details });
  }
  const pg = error as PostgresLikeError;
  if (pg.code === "23505") {
    if (pg.constraint === "_xecms_identities_normalized_username_key") {
      return new ApplicationError("USERNAME_ALREADY_EXISTS", 409, "That username already exists.");
    }
    return new ApplicationError(
      "DOCUMENT_UNIQUE_CONSTRAINT",
      409,
      "A document field violates a unique constraint.",
    );
  }
  if (pg.code === "23502" || pg.code === "23514" || pg.code === "22P02") {
    return new ApplicationError(
      "DATABASE_CONSTRAINT_FAILED",
      422,
      "Stored content does not satisfy the active schema constraints.",
    );
  }
  return error;
}

function databaseErrorCode(error: unknown): string {
  return error instanceof ApplicationError
    ? error.code
    : ((error as PostgresLikeError).code ?? "MIGRATION_FAILED");
}
