import {
  ApplicationError,
  type DocumentMediaReferenceEdge,
  type DocumentMediaReferenceIssue,
  type DocumentMediaReferenceReplaceResult,
  type DocumentMediaReferenceStore,
  type MediaRecord,
  type MediaRecordStatus,
  type MediaStore,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export class PostgresMediaStore implements MediaStore, DocumentMediaReferenceStore {
  public readonly schema: string;

  public constructor(
    public readonly pool: Pool,
    schema = "xecms",
  ) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async reserveMedia(record: MediaRecord): Promise<void> {
    if (record.status !== "pending" || record.size !== null || record.sha256 !== null) {
      throw new TypeError("Only pending media can be reserved.");
    }
    try {
      await this.pool.query(
        `INSERT INTO ${this.q("_xecms_media")}
           (id, workspace_id, original_file_name, mime_type, storage_key, status,
            size, sha256, failure_reason, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, 'pending', NULL, NULL, NULL, $6, $7)`,
        [
          record.id,
          record.workspaceId,
          record.originalFileName,
          record.mimeType,
          record.storageKey,
          record.createdAt,
          record.createdBy,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError("MEDIA_ID_CONFLICT", 409, "Media ID or storage key already exists.");
      }
      throw error;
    }
  }

  public async completeMedia(input: {
    readonly id: string;
    readonly expectedStatus: "pending";
    readonly size: number;
    readonly sha256: string;
  }): Promise<MediaRecord> {
    const result = await this.pool.query<MediaRow>(
      `UPDATE ${this.q("_xecms_media")}
       SET status = 'ready', size = $2, sha256 = $3, failure_reason = NULL
       WHERE id = $1 AND status = $4
       RETURNING *`,
      [input.id, input.size, input.sha256, input.expectedStatus],
    );
    if (result.rows[0] === undefined) mediaStateConflict(input.id);
    return mediaFromRow(result.rows[0]);
  }

  public async failMedia(input: {
    readonly id: string;
    readonly expectedStatus: "pending";
    readonly reason: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.q("_xecms_media")}
       SET status = 'failed', size = NULL, sha256 = NULL, failure_reason = $2
       WHERE id = $1 AND status = $3`,
      [input.id, input.reason.slice(0, 500), input.expectedStatus],
    );
    if (result.rowCount !== 1) mediaStateConflict(input.id);
  }

  public async getMedia(id: string): Promise<MediaRecord | null> {
    const result = await this.pool.query<MediaRow>(
      `SELECT * FROM ${this.q("_xecms_media")} WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? null : mediaFromRow(result.rows[0]);
  }

  public async listAllMedia(workspaceId: string): Promise<readonly MediaRecord[]> {
    const result = await this.pool.query<MediaRow>(
      `SELECT * FROM ${this.q("_xecms_media")}
       WHERE workspace_id = $1
       ORDER BY created_at, id`,
      [workspaceId],
    );
    return result.rows.map(mediaFromRow);
  }

  public async deleteMediaRecord(input: {
    readonly id: string;
    readonly expectedStatus: MediaRecordStatus;
  }): Promise<void> {
    try {
      const result = await this.pool.query(
        `DELETE FROM ${this.q("_xecms_media")} WHERE id = $1 AND status = $2`,
        [input.id, input.expectedStatus],
      );
      if (result.rowCount !== 1) mediaStateConflict(input.id);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ApplicationError(
          "MEDIA_IN_USE",
          409,
          `Media '${input.id}' is still referenced by a document.`,
        );
      }
      throw error;
    }
  }

  public async validateAndReplaceDocumentMedia(input: {
    readonly workspaceId: string;
    readonly sourceDocumentId: string;
    readonly expectedDocumentVersion: number;
    readonly edges: readonly DocumentMediaReferenceEdge[];
  }): Promise<DocumentMediaReferenceReplaceResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.validateAndReplaceDocumentMediaWithClient(client, input);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Hook used by the document transaction after revision/projection writes. */
  public async validateAndReplaceDocumentMediaWithClient(
    client: Pick<PoolClient, "query">,
    input: {
      readonly workspaceId: string;
      readonly sourceDocumentId: string;
      readonly expectedDocumentVersion: number;
      readonly edges: readonly DocumentMediaReferenceEdge[];
    },
  ): Promise<DocumentMediaReferenceReplaceResult> {
    if (input.edges.some(({ sourceDocumentId }) => sourceDocumentId !== input.sourceDocumentId)) {
      throw new ApplicationError(
        "MEDIA_SOURCE_IDENTITY_MISMATCH",
        422,
        "Every media edge must belong to the locked source document.",
      );
    }
    const source = await client.query<DocumentMediaSourceRow>(
      `SELECT id, workspace_id, aggregate_version, deletion
       FROM ${this.q("_xecms_documents")}
       WHERE id = $1 FOR UPDATE`,
      [input.sourceDocumentId],
    );
    const sourceRow = source.rows[0];
    if (sourceRow === undefined) {
      throw new ApplicationError("MEDIA_SOURCE_NOT_FOUND", 404, "Source document was not found.");
    }
    if (sourceRow.workspace_id !== input.workspaceId) {
      throw new ApplicationError("MEDIA_SOURCE_WORKSPACE_MISMATCH", 422, "Source workspace does not match.");
    }
    if (sourceRow.deletion !== null) {
      throw new ApplicationError("MEDIA_SOURCE_DELETED", 409, "Deleted documents cannot update media references.");
    }
    if (Number(sourceRow.aggregate_version) !== input.expectedDocumentVersion) {
      throw new ApplicationError("DOCUMENT_VERSION_CONFLICT", 409, "The source document changed.");
    }
    const mediaIds = [...new Set(input.edges.map(({ mediaId }) => mediaId))];
    const rows = mediaIds.length === 0
      ? []
      : (await client.query<MediaIdentityRow>(
          `SELECT id, workspace_id, status, mime_type FROM ${this.q("_xecms_media")}
           WHERE id = ANY($1::text[]) FOR KEY SHARE`,
          [mediaIds],
        )).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const issues: DocumentMediaReferenceIssue[] = [];
    for (const mediaId of mediaIds) {
      const media = byId.get(mediaId);
      if (media === undefined) issues.push({ mediaId, reason: "not-found" });
      else if (media.workspace_id !== input.workspaceId) {
        issues.push({ mediaId, reason: "workspace-mismatch" });
      } else if (media.status !== "ready") issues.push({ mediaId, reason: "not-ready" });
    }
    for (const edge of input.edges) {
      const media = byId.get(edge.mediaId);
      if (
        media !== undefined &&
        media.workspace_id === input.workspaceId &&
        media.status === "ready" &&
        edge.acceptedMimeTypes !== undefined &&
        !mimeAllowed(media.mime_type, edge.acceptedMimeTypes)
      ) {
        issues.push({
          mediaId: edge.mediaId,
          reason: "mime-not-accepted",
          actualMimeType: media.mime_type,
          acceptedMimeTypes: edge.acceptedMimeTypes,
        });
      }
    }
    if (issues.length > 0) return { status: "invalid-media", issues };

    await client.query(
      `DELETE FROM ${this.q("_xecms_document_media")} WHERE source_document_id = $1`,
      [input.sourceDocumentId],
    );
    for (const edge of input.edges) {
      await client.query(
        `INSERT INTO ${this.q("_xecms_document_media")}
           (source_document_id, field_name, media_id, ordinal)
         VALUES ($1, $2, $3, $4)`,
        [edge.sourceDocumentId, edge.fieldName, edge.mediaId, edge.ordinal],
      );
    }
    return { status: "committed" };
  }

  public async listMediaUsages(mediaId: string): Promise<readonly DocumentMediaReferenceEdge[]> {
    const result = await this.pool.query<DocumentMediaUsageRow>(
      `SELECT source_document_id, field_name, media_id, ordinal
       FROM ${this.q("_xecms_document_media")}
       WHERE media_id = $1
       ORDER BY source_document_id, field_name, ordinal`,
      [mediaId],
    );
    return result.rows.map((row) => ({
      sourceDocumentId: row.source_document_id,
      fieldName: row.field_name,
      mediaId: row.media_id,
      ordinal: row.ordinal,
    }));
  }

  private q(table: string): string {
    return qualifiedName(this.schema, table);
  }
}

interface MediaRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly original_file_name: string;
  readonly mime_type: string;
  readonly storage_key: string;
  readonly status: MediaRecordStatus;
  readonly size: string | number | null;
  readonly sha256: string | null;
  readonly failure_reason: string | null;
  readonly created_at: Date | string;
  readonly created_by: string;
}

interface DocumentMediaSourceRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly aggregate_version: string | number;
  readonly deletion: unknown | null;
}

interface MediaIdentityRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly status: MediaRecordStatus;
  readonly mime_type: string;
}

interface DocumentMediaUsageRow extends QueryResultRow {
  readonly source_document_id: string;
  readonly field_name: string;
  readonly media_id: string;
  readonly ordinal: number;
}

function mediaFromRow(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    status: row.status,
    size: row.size === null ? null : Number(row.size),
    sha256: row.sha256,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
    ...(row.failure_reason === null ? {} : { failureReason: row.failure_reason }),
  };
}

function mediaStateConflict(id: string): never {
  throw new ApplicationError(
    "MEDIA_STATE_CONFLICT",
    409,
    `Media '${id}' is not in the expected state.`,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "23503" || error.code === "23001");
}

function mimeAllowed(mimeType: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern === mimeType || pattern.endsWith("/*") && mimeType.startsWith(pattern.slice(0, -1))
  );
}
