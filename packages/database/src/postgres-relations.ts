import {
  ApplicationError,
  type RelationReplaceResult,
  type RelationStore,
} from "@xecms/application";
import {
  asCollectionId,
  asDocumentId,
  type DocumentRelationEdge,
  type IncomingDocumentRelation,
  type JsonObject,
} from "@xecms/core";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export class PostgresRelationStore implements RelationStore {
  public readonly schema: string;

  public constructor(
    public readonly pool: Pool,
    schema = "xecms",
  ) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async validateAndReplaceDocumentRelations(input: {
    readonly sourceCollectionId: string;
    readonly sourceDocumentId: string;
    readonly expectedDocumentVersion: number;
    readonly edges: readonly DocumentRelationEdge[];
  }): Promise<RelationReplaceResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.validateAndReplaceWithClient(client, input);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Transaction hook for PostgresDatabase: call after writing the document but
   * before COMMIT so revision/projection and relation edges cannot diverge.
   */
  public async validateAndReplaceWithClient(
    client: Pick<PoolClient, "query">,
    input: {
      readonly sourceCollectionId: string;
      readonly sourceDocumentId: string;
      readonly expectedDocumentVersion: number;
      readonly edges: readonly DocumentRelationEdge[];
    },
  ): Promise<RelationReplaceResult> {
    if (input.edges.some((edge) =>
      edge.sourceDocumentId !== input.sourceDocumentId ||
      edge.sourceCollectionId !== input.sourceCollectionId)) {
      throw new ApplicationError(
        "RELATION_SOURCE_IDENTITY_MISMATCH",
        422,
        "Every relation edge must belong to the locked source document.",
      );
    }
    const source = await client.query<DocumentIdentityRow>(
      `SELECT id, collection_id, aggregate_version, deletion
       FROM ${this.q("_xecms_documents")}
       WHERE id = $1
       FOR UPDATE`,
      [input.sourceDocumentId],
    );
    const sourceRow = source.rows[0];
    if (sourceRow === undefined) {
      throw new ApplicationError(
        "RELATION_SOURCE_NOT_FOUND",
        404,
        `Source document '${input.sourceDocumentId}' was not found.`,
      );
    }
    if (sourceRow.collection_id !== input.sourceCollectionId) {
      throw new ApplicationError("RELATION_SOURCE_COLLECTION_MISMATCH", 422, "Source collection does not match.");
    }
    if (sourceRow.deletion !== null) {
      throw new ApplicationError("RELATION_SOURCE_DELETED", 409, "Deleted documents cannot update relations.");
    }
    if (Number(sourceRow.aggregate_version) !== input.expectedDocumentVersion) {
      throw new ApplicationError(
        "DOCUMENT_VERSION_CONFLICT",
        409,
        "The source document changed before its relations were stored.",
      );
    }

    const targets = [...new Set(input.edges.map(({ targetDocumentId }) => String(targetDocumentId)))];
    const targetRows = targets.length === 0
      ? []
      : (await client.query<DocumentIdentityRow>(
          `SELECT id, collection_id, aggregate_version, deletion
           FROM ${this.q("_xecms_documents")}
           WHERE id = ANY($1::text[])
           FOR KEY SHARE`,
          [targets],
        )).rows;
    const byId = new Map(targetRows.map((row) => [row.id, row]));
    const issues: NonNullable<Extract<RelationReplaceResult, { status: "invalid-targets" }>["issues"]>[number][] = [];
    for (const edge of input.edges) {
      const target = byId.get(edge.targetDocumentId);
      const common = {
        documentId: String(edge.targetDocumentId),
        expectedCollectionId: String(edge.targetCollectionId),
      };
      if (target === undefined) {
        issues.push({ ...common, reason: "not-found" });
      } else if (target.collection_id !== edge.targetCollectionId) {
        issues.push({
          ...common,
          actualCollectionId: target.collection_id,
          reason: "collection-mismatch",
        });
      } else if (target.deletion !== null) {
        issues.push({ ...common, reason: "deleted" });
      }
    }
    const uniqueIssues = deduplicateIssues(issues);
    if (uniqueIssues.length > 0) {
      return { status: "invalid-targets", issues: uniqueIssues };
    }

    await client.query(
      `DELETE FROM ${this.q("_xecms_document_relations")} WHERE source_document_id = $1`,
      [input.sourceDocumentId],
    );
    for (const edge of input.edges) {
      await client.query(
        `INSERT INTO ${this.q("_xecms_document_relations")}
           (relation_id, field_name, source_collection_id, source_document_id,
            target_collection_id, target_document_id, ordinal, on_delete)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          edge.relationId,
          edge.fieldName,
          edge.sourceCollectionId,
          edge.sourceDocumentId,
          edge.targetCollectionId,
          edge.targetDocumentId,
          edge.ordinal,
          edge.onDelete,
        ],
      );
    }
    return { status: "committed" };
  }

  public async listIncomingDocumentRelations(input: {
    readonly targetCollectionId: string;
    readonly targetDocumentId: string;
  }): Promise<readonly IncomingDocumentRelation[]> {
    const result = await this.pool.query<IncomingRelationRow>(
      `SELECT e.relation_id, e.field_name, e.source_collection_id, e.source_document_id,
              e.target_collection_id, e.target_document_id, e.ordinal, e.on_delete,
              r.data AS source_data
       FROM ${this.q("_xecms_document_relations")} e
       JOIN ${this.q("_xecms_documents")} d ON d.id = e.source_document_id
       JOIN ${this.q("_xecms_document_revisions")} r
         ON r.id = COALESCE(d.current_draft_revision_id, d.publication ->> 'revisionId')
        AND r.document_id = d.id
       WHERE e.target_document_id = $1 AND e.target_collection_id = $2
       ORDER BY e.source_document_id, e.relation_id, e.ordinal`,
      [input.targetDocumentId, input.targetCollectionId],
    );
    return result.rows.map((row) => ({
      edge: {
        relationId: row.relation_id,
        fieldName: row.field_name,
        sourceCollectionId: asCollectionId(row.source_collection_id),
        sourceDocumentId: asDocumentId(row.source_document_id),
        targetCollectionId: asCollectionId(row.target_collection_id),
        targetDocumentId: asDocumentId(row.target_document_id),
        ordinal: row.ordinal,
        onDelete: row.on_delete,
      },
      sourceData: assertJsonObject(row.source_data),
    }));
  }

  private q(table: string): string {
    return qualifiedName(this.schema, table);
  }
}

interface DocumentIdentityRow extends QueryResultRow {
  readonly id: string;
  readonly collection_id: string;
  readonly aggregate_version: string | number;
  readonly deletion: unknown | null;
}

interface IncomingRelationRow extends QueryResultRow {
  readonly relation_id: string;
  readonly field_name: string;
  readonly source_collection_id: string;
  readonly source_document_id: string;
  readonly target_collection_id: string;
  readonly target_document_id: string;
  readonly ordinal: number;
  readonly on_delete: "restrict" | "nullify" | "cascade";
  readonly source_data: unknown;
}

function assertJsonObject(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("RELATION_SOURCE_DATA_INVALID", 500, "Stored source data is not a JSON object.");
  }
  return value as JsonObject;
}

function deduplicateIssues<TIssue extends {
  readonly documentId: string;
  readonly expectedCollectionId: string;
  readonly reason: string;
}>(issues: readonly TIssue[]): readonly TIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.documentId}\u0000${issue.expectedCollectionId}\u0000${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
