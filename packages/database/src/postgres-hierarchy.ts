import type {
  ContentHierarchyQueryResult,
  ContentHierarchyStore,
  ContentHierarchyStoreContext,
} from "@xecms/application";
import {
  ContentHierarchyDomainError,
  addHierarchyNode,
  asCollectionId,
  asDocumentId,
  asWorkspaceId,
  createContentHierarchySnapshot,
  moveHierarchyNode,
  removeHierarchyNode,
  reorderHierarchyChildren,
  type AddHierarchyNodeInput,
  type ContentHierarchyCommandResult,
  type ContentHierarchyEvent,
  type ContentHierarchyPosition,
  type ContentHierarchySnapshot,
  type DocumentId,
  type MoveHierarchyNodeInput,
  type RemoveHierarchyNodeInput,
  type ReorderHierarchyChildrenInput,
} from "@xecms/core";
import type { Pool, PoolClient } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

interface HierarchyNodeRow {
  readonly document_id: string;
  readonly parent_document_id: string | null;
  readonly sort_key: number;
  readonly depth: number;
}

interface DocumentLocationRow {
  readonly workspace_id: string;
  readonly collection_id: string;
}

export class PostgresContentHierarchyStore implements ContentHierarchyStore {
  private readonly schema: string;

  public constructor(
    private readonly pool: Pool,
    rawSchema: string,
  ) {
    this.schema = validateDatabaseSchema(rawSchema);
  }

  public listRoots(context: ContentHierarchyStoreContext): Promise<ContentHierarchyQueryResult> {
    return this.read(context, async (client) => this.positions(client, context, `
      SELECT document_id, parent_document_id, sort_key, depth
      FROM ${this.q("_xecms_content_hierarchy_nodes")}
      WHERE workspace_id = $1 AND collection_id = $2 AND parent_document_id IS NULL
      ORDER BY sort_key, document_id
    `, [context.workspaceId, context.collectionId]));
  }

  public listChildren(
    context: ContentHierarchyStoreContext,
    parentId: DocumentId,
  ): Promise<ContentHierarchyQueryResult> {
    return this.read(context, async (client) => {
      await this.assertHierarchyNode(client, context, parentId);
      return this.positions(client, context, `
        SELECT document_id, parent_document_id, sort_key, depth
        FROM ${this.q("_xecms_content_hierarchy_nodes")}
        WHERE workspace_id = $1 AND collection_id = $2 AND parent_document_id = $3
        ORDER BY sort_key, document_id
      `, [context.workspaceId, context.collectionId, parentId]);
    });
  }

  public listAncestors(
    context: ContentHierarchyStoreContext,
    documentId: DocumentId,
  ): Promise<ContentHierarchyQueryResult> {
    return this.read(context, async (client) => {
      await this.assertHierarchyNode(client, context, documentId);
      return this.positions(client, context, `
        SELECT node.document_id, node.parent_document_id, node.sort_key, node.depth
        FROM ${this.q("_xecms_content_hierarchy_closure")} closure
        JOIN ${this.q("_xecms_content_hierarchy_nodes")} node
          ON node.workspace_id = closure.workspace_id
         AND node.collection_id = closure.collection_id
         AND node.document_id = closure.ancestor_document_id
        WHERE closure.workspace_id = $1
          AND closure.collection_id = $2
          AND closure.descendant_document_id = $3
          AND closure.distance > 0
        ORDER BY closure.distance DESC
      `, [context.workspaceId, context.collectionId, documentId]);
    });
  }

  public listDescendants(
    context: ContentHierarchyStoreContext,
    documentId: DocumentId,
  ): Promise<ContentHierarchyQueryResult> {
    return this.tree(context, documentId, false);
  }

  public getSubtree(
    context: ContentHierarchyStoreContext,
    documentId: DocumentId,
  ): Promise<ContentHierarchyQueryResult> {
    return this.tree(context, documentId, true);
  }

  public listAll(context: ContentHierarchyStoreContext): Promise<ContentHierarchyQueryResult> {
    return this.read(context, async (client) => this.positions(client, context, `
      SELECT document_id, parent_document_id, sort_key, depth
      FROM ${this.q("_xecms_content_hierarchy_nodes")}
      WHERE workspace_id = $1 AND collection_id = $2
      ORDER BY depth, parent_document_id NULLS FIRST, sort_key, document_id
    `, [context.workspaceId, context.collectionId]));
  }

  public listAllByIds(workspaceId: string, collectionId: string): Promise<ContentHierarchyQueryResult> {
    return this.listAll({
      workspaceId: asWorkspaceId(workspaceId),
      collectionId: asCollectionId(collectionId),
    });
  }

  public addNode(
    context: ContentHierarchyStoreContext,
    input: AddHierarchyNodeInput,
  ): Promise<ContentHierarchyCommandResult> {
    return this.write(
      context,
      async (client) => {
        await this.assertDocumentLocation(client, context, input.documentId, false);
        if (input.parentId !== null) await this.assertDocumentLocation(client, context, input.parentId, true);
      },
      (snapshot) => addHierarchyNode(snapshot, input),
    );
  }

  /** Transaction hook used when a document and its initial tree position are created together. */
  public addNodeWithClient(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    input: AddHierarchyNodeInput,
  ): Promise<ContentHierarchyCommandResult> {
    return this.writeWithClient(
      client,
      context,
      async () => {
        await this.assertDocumentLocation(client, context, input.documentId, false);
        if (input.parentId !== null) await this.assertDocumentLocation(client, context, input.parentId, true);
      },
      (snapshot) => addHierarchyNode(snapshot, input),
    );
  }

  /** Removes a hierarchy node in the caller's purge transaction, promoting children. */
  public async removeNodeForPurgeWithClient(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    input: {
      readonly documentId: DocumentId;
      readonly actorId: RemoveHierarchyNodeInput["actorId"];
      readonly now: RemoveHierarchyNodeInput["now"];
      readonly maxDepth?: number;
    },
  ): Promise<ContentHierarchyCommandResult | null> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      context.workspaceId,
      context.collectionId,
    ]);
    await this.ensureState(client, context);
    const snapshot = await this.loadSnapshot(client, context, true);
    if (!snapshot.positions.some(({ documentId }) => documentId === input.documentId)) return null;
    const result = removeHierarchyNode(snapshot, {
      documentId: input.documentId,
      expectedVersion: snapshot.version,
      actorId: input.actorId,
      now: input.now,
      promoteChildren: true,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    });
    await this.persistSnapshot(client, context, snapshot, result);
    return result;
  }

  public moveNode(
    context: ContentHierarchyStoreContext,
    input: MoveHierarchyNodeInput,
  ): Promise<ContentHierarchyCommandResult> {
    return this.write(
      context,
      async (client) => {
        if (input.newParentId !== null) {
          await this.assertDocumentLocation(client, context, input.newParentId, true);
        }
      },
      (snapshot) => moveHierarchyNode(snapshot, input),
    );
  }

  public async previewMove(
    context: ContentHierarchyStoreContext,
    input: MoveHierarchyNodeInput,
  ): Promise<ContentHierarchyCommandResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snapshot = await this.loadSnapshot(client, context, false);
      if (input.newParentId !== null) {
        await this.assertDocumentLocation(client, context, input.newParentId, true, false);
      }
      const result = moveHierarchyNode(snapshot, input);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public reorderChildren(
    context: ContentHierarchyStoreContext,
    input: ReorderHierarchyChildrenInput,
  ): Promise<ContentHierarchyCommandResult> {
    return this.write(
      context,
      async (client) => {
        if (input.parentId !== null) await this.assertDocumentLocation(client, context, input.parentId, true);
      },
      (snapshot) => reorderHierarchyChildren(snapshot, input),
    );
  }

  public removeNode(
    context: ContentHierarchyStoreContext,
    input: RemoveHierarchyNodeInput,
  ): Promise<ContentHierarchyCommandResult> {
    return this.write(context, async () => undefined, (snapshot) => removeHierarchyNode(snapshot, input));
  }

  private async tree(
    context: ContentHierarchyStoreContext,
    documentId: DocumentId,
    includeRoot: boolean,
  ): Promise<ContentHierarchyQueryResult> {
    return this.read(context, async (client) => {
      await this.assertHierarchyNode(client, context, documentId);
      return this.positions(client, context, `
        WITH RECURSIVE tree AS (
          SELECT node.document_id, node.parent_document_id, node.sort_key, node.depth,
                 ARRAY[node.sort_key]::integer[] AS sort_path, 0 AS relation_depth
          FROM ${this.q("_xecms_content_hierarchy_nodes")} node
          WHERE node.workspace_id = $1 AND node.collection_id = $2 AND node.document_id = $3
          UNION ALL
          SELECT child.document_id, child.parent_document_id, child.sort_key, child.depth,
                 tree.sort_path || child.sort_key, tree.relation_depth + 1
          FROM tree
          JOIN ${this.q("_xecms_content_hierarchy_nodes")} child
            ON child.workspace_id = $1
           AND child.collection_id = $2
           AND child.parent_document_id = tree.document_id
        )
        SELECT document_id, parent_document_id, sort_key, depth
        FROM tree
        WHERE relation_depth ${includeRoot ? ">=" : ">"} 0
        ORDER BY sort_path, document_id
      `, [context.workspaceId, context.collectionId, documentId]);
    });
  }

  private async read(
    context: ContentHierarchyStoreContext,
    query: (client: PoolClient) => Promise<readonly ContentHierarchyPosition[]>,
  ): Promise<ContentHierarchyQueryResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const [version, items] = await Promise.all([
        this.getVersion(client, context),
        query(client),
      ]);
      await client.query("COMMIT");
      return { version, items };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async write(
    context: ContentHierarchyStoreContext,
    validateReferences: (client: PoolClient) => Promise<void>,
    command: (snapshot: ContentHierarchySnapshot) => ContentHierarchyCommandResult,
  ): Promise<ContentHierarchyCommandResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.writeWithClient(client, context, () => validateReferences(client), command);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeWithClient(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    validateReferences: () => Promise<void>,
    command: (snapshot: ContentHierarchySnapshot) => ContentHierarchyCommandResult,
  ): Promise<ContentHierarchyCommandResult> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      context.workspaceId,
      context.collectionId,
    ]);
    await this.ensureState(client, context);
    const snapshot = await this.loadSnapshot(client, context, true);
    await validateReferences();
    const result = command(snapshot);
    await this.persistSnapshot(client, context, snapshot, result);
    return result;
  }

  private async ensureState(client: PoolClient, context: ContentHierarchyStoreContext): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_content_hierarchy_state")}
         (workspace_id, collection_id, structure_version)
       VALUES ($1, $2, 0)
       ON CONFLICT (workspace_id, collection_id) DO NOTHING`,
      [context.workspaceId, context.collectionId],
    );
  }

  private async loadSnapshot(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    forUpdate: boolean,
  ): Promise<ContentHierarchySnapshot> {
    const versionResult = await client.query<{ readonly structure_version: string | number }>(
      `SELECT structure_version
       FROM ${this.q("_xecms_content_hierarchy_state")}
       WHERE workspace_id = $1 AND collection_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [context.workspaceId, context.collectionId],
    );
    const nodes = await client.query<HierarchyNodeRow>(
      `SELECT document_id, parent_document_id, sort_key, depth
       FROM ${this.q("_xecms_content_hierarchy_nodes")}
       WHERE workspace_id = $1 AND collection_id = $2
       ORDER BY depth, parent_document_id NULLS FIRST, sort_key, document_id${forUpdate ? " FOR UPDATE" : ""}`,
      [context.workspaceId, context.collectionId],
    );
    return createContentHierarchySnapshot({
      workspaceId: asWorkspaceId(context.workspaceId),
      collectionId: asCollectionId(context.collectionId),
      version: Number(versionResult.rows[0]?.structure_version ?? 0),
      positions: nodes.rows.map(positionFromRow),
    });
  }

  private async persistSnapshot(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    previous: ContentHierarchySnapshot,
    result: ContentHierarchyCommandResult,
  ): Promise<void> {
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    const ids = result.state.positions.map(({ documentId }) => String(documentId));
    await client.query(
      `DELETE FROM ${this.q("_xecms_content_hierarchy_nodes")}
       WHERE workspace_id = $1 AND collection_id = $2 AND NOT (document_id = ANY($3::text[]))`,
      [context.workspaceId, context.collectionId, ids],
    );
    const previousById = new Map(previous.positions.map((position) => [position.documentId, position]));
    const changed = result.state.positions.filter((position) => {
      const before = previousById.get(position.documentId);
      return before === undefined || before.parentId !== position.parentId
        || before.sortKey !== position.sortKey || before.depth !== position.depth;
    });
    if (changed.length > 0) await client.query(
      `INSERT INTO ${this.q("_xecms_content_hierarchy_nodes")}
         (workspace_id, collection_id, document_id, parent_document_id, sort_key, depth)
       SELECT $1, $2, position.document_id, position.parent_document_id,
              position.sort_key, position.depth
         FROM jsonb_to_recordset($3::jsonb) AS position(
           document_id text, parent_document_id text, sort_key integer, depth integer)
       ON CONFLICT (workspace_id, collection_id, document_id) DO UPDATE SET
         parent_document_id = EXCLUDED.parent_document_id,
         sort_key = EXCLUDED.sort_key,
         depth = EXCLUDED.depth`,
      [context.workspaceId, context.collectionId, JSON.stringify(changed.map((position) => ({
        document_id: position.documentId, parent_document_id: position.parentId,
        sort_key: position.sortKey, depth: position.depth,
      })))],
    );
    await this.rebuildClosure(client, context);
    const updated = await client.query(
      `UPDATE ${this.q("_xecms_content_hierarchy_state")}
       SET structure_version = $3, updated_at = $4, updated_by = $5
       WHERE workspace_id = $1 AND collection_id = $2 AND structure_version = $6`,
      [
        context.workspaceId,
        context.collectionId,
        result.state.version,
        result.event.occurredAt,
        result.event.actorId,
        previous.version,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new ContentHierarchyDomainError(
        "HIERARCHY_VERSION_CONFLICT",
        "Hierarchy changed while the structure transaction was being committed.",
        { expectedVersion: previous.version },
      );
    }
    await this.insertEvent(client, result.event);
  }

  private async rebuildClosure(client: PoolClient, context: ContentHierarchyStoreContext): Promise<void> {
    await client.query(
      `DELETE FROM ${this.q("_xecms_content_hierarchy_closure")}
       WHERE workspace_id = $1 AND collection_id = $2`,
      [context.workspaceId, context.collectionId],
    );
    await client.query(`
      WITH RECURSIVE paths AS (
        SELECT node.workspace_id, node.collection_id,
               node.document_id AS ancestor_document_id,
               node.document_id AS descendant_document_id,
               0 AS distance
        FROM ${this.q("_xecms_content_hierarchy_nodes")} node
        WHERE node.workspace_id = $1 AND node.collection_id = $2
        UNION ALL
        SELECT paths.workspace_id, paths.collection_id,
               paths.ancestor_document_id,
               child.document_id AS descendant_document_id,
               paths.distance + 1
        FROM paths
        JOIN ${this.q("_xecms_content_hierarchy_nodes")} child
          ON child.workspace_id = paths.workspace_id
         AND child.collection_id = paths.collection_id
         AND child.parent_document_id = paths.descendant_document_id
      )
      INSERT INTO ${this.q("_xecms_content_hierarchy_closure")}
        (workspace_id, collection_id, ancestor_document_id, descendant_document_id, distance)
      SELECT workspace_id, collection_id, ancestor_document_id, descendant_document_id, distance
      FROM paths
    `, [context.workspaceId, context.collectionId]);
  }

  private async insertEvent(client: PoolClient, event: ContentHierarchyEvent): Promise<void> {
    await client.query(
      `INSERT INTO ${this.q("_xecms_content_hierarchy_events")}
         (workspace_id, collection_id, document_id, event_type, structure_version,
          actor_id, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        event.workspaceId,
        event.collectionId,
        event.documentId,
        event.type,
        event.structureVersion,
        event.actorId,
        event.occurredAt,
        JSON.stringify({
          before: event.before,
          after: event.after,
          affectedDocumentIds: event.affectedDocumentIds,
        }),
      ],
    );
  }

  private async getVersion(client: PoolClient, context: ContentHierarchyStoreContext): Promise<number> {
    const result = await client.query<{ readonly structure_version: string | number }>(
      `SELECT structure_version FROM ${this.q("_xecms_content_hierarchy_state")}
       WHERE workspace_id = $1 AND collection_id = $2`,
      [context.workspaceId, context.collectionId],
    );
    return Number(result.rows[0]?.structure_version ?? 0);
  }

  private async positions(
    client: PoolClient,
    _context: ContentHierarchyStoreContext,
    sql: string,
    parameters: readonly unknown[],
  ): Promise<readonly ContentHierarchyPosition[]> {
    const result = await client.query<HierarchyNodeRow>(sql, [...parameters]);
    return Object.freeze(result.rows.map(positionFromRow));
  }

  private async assertHierarchyNode(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    documentId: DocumentId,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM ${this.q("_xecms_content_hierarchy_nodes")}
       WHERE workspace_id = $1 AND collection_id = $2 AND document_id = $3`,
      [context.workspaceId, context.collectionId, documentId],
    );
    if (result.rowCount !== 1) {
      throw new ContentHierarchyDomainError(
        "HIERARCHY_NODE_NOT_FOUND",
        `Hierarchy node '${documentId}' does not exist.`,
        { documentId },
      );
    }
  }

  private async assertDocumentLocation(
    client: PoolClient,
    context: ContentHierarchyStoreContext,
    documentId: DocumentId,
    isParent: boolean,
    lock = true,
  ): Promise<void> {
    const result = await client.query<DocumentLocationRow>(
      `SELECT workspace_id, collection_id FROM ${this.q("_xecms_documents")} WHERE id = $1${lock ? " FOR SHARE" : ""}`,
      [documentId],
    );
    const location = result.rows[0];
    if (location === undefined) {
      throw new ContentHierarchyDomainError(
        isParent ? "HIERARCHY_PARENT_NOT_FOUND" : "HIERARCHY_NODE_NOT_FOUND",
        `Document '${documentId}' does not exist.`,
        { documentId },
      );
    }
    if (location.workspace_id !== context.workspaceId || location.collection_id !== context.collectionId) {
      if (isParent) {
        throw new ContentHierarchyDomainError(
          "HIERARCHY_CROSS_COLLECTION_PARENT",
          `Document '${documentId}' belongs to another collection or workspace.`,
          {
            parentId: documentId,
            expectedWorkspaceId: context.workspaceId,
            expectedCollectionId: context.collectionId,
            actualWorkspaceId: location.workspace_id,
            actualCollectionId: location.collection_id,
          },
        );
      }
      throw new ContentHierarchyDomainError(
        "HIERARCHY_NODE_NOT_FOUND",
        `Document '${documentId}' does not belong to this collection.`,
        { documentId },
      );
    }
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

function positionFromRow(row: HierarchyNodeRow): ContentHierarchyPosition {
  return Object.freeze({
    documentId: asDocumentId(row.document_id),
    parentId: row.parent_document_id === null ? null : asDocumentId(row.parent_document_id),
    sortKey: Number(row.sort_key),
    depth: Number(row.depth),
  });
}
