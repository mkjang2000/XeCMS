import {
  contentTableName,
  fieldColumnName,
  qualifiedName,
  quoteIdentifier,
} from "../identifiers.js";
import { storageParameter } from "../planner.js";
import { PostgresContentHierarchyStore } from "../postgres-hierarchy.js";
import { PostgresMediaStore } from "../postgres-media.js";
import { PostgresRelationStore } from "../postgres-relations.js";
import { documentEventAuditPayload } from "./records.js";
import { mapDatabaseError, jsonOrNull } from "./shared.js";
import {
  ApplicationError,
  type HardPurgePlan,
  type DocumentWriteIntegrity,
  type PersistedDocumentEvent,
} from "@xecms/application";
import {
  asSubjectId,
  asUtcInstant,
  type DocumentAggregate,
  type DocumentDeletion,
  type DocumentRevision,
} from "@xecms/core";
import { type CollectionDefinition } from "@xecms/schema";
import { type Pool, type PoolClient } from "pg";

export class PostgresDocumentStore {
  public constructor(private readonly pool: Pool, private readonly schema: string) {}

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

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

