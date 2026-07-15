import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

/** M2-E metadata. File bytes deliberately remain behind the MediaStorage port. */
export async function applyMediaMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE ${q("_xecms_media")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id),
      original_file_name text NOT NULL CHECK (length(original_file_name) BETWEEN 1 AND 255),
      mime_type text NOT NULL CHECK (length(mime_type) BETWEEN 3 AND 127),
      storage_key text NOT NULL UNIQUE CHECK (length(btrim(storage_key)) > 0),
      status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
      size bigint CHECK (size >= 0),
      sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      failure_reason text,
      created_at timestamptz NOT NULL,
      created_by text NOT NULL,
      CHECK (
        (status = 'ready' AND size IS NOT NULL AND sha256 IS NOT NULL AND failure_reason IS NULL)
        OR (status = 'pending' AND size IS NULL AND sha256 IS NULL AND failure_reason IS NULL)
        OR (status = 'failed' AND size IS NULL AND sha256 IS NULL AND failure_reason IS NOT NULL)
      )
    );
    CREATE INDEX _xecms_media_workspace_created
      ON ${q("_xecms_media")}(workspace_id, created_at DESC, id DESC);
    CREATE INDEX _xecms_media_incomplete
      ON ${q("_xecms_media")}(workspace_id, status, created_at)
      WHERE status <> 'ready';

    CREATE TABLE ${q("_xecms_document_media")} (
      source_document_id text NOT NULL
        REFERENCES ${q("_xecms_documents")}(id) ON DELETE CASCADE,
      field_name text NOT NULL CHECK (length(btrim(field_name)) > 0),
      media_id text NOT NULL REFERENCES ${q("_xecms_media")}(id) ON DELETE RESTRICT,
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      PRIMARY KEY (source_document_id, field_name, ordinal),
      UNIQUE (source_document_id, field_name, media_id)
    );
    CREATE INDEX _xecms_document_media_target
      ON ${q("_xecms_document_media")}(media_id, source_document_id, field_name);
  `);
}
