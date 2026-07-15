import type { Pool, PoolClient } from "pg";
import { qualifiedName, quoteIdentifier, validateDatabaseSchema } from "./identifiers.js";

export const CONTENT_HIERARCHY_MIGRATION_ID = "0011_m2_content_hierarchy";

/**
 * DDL body used by migrateCore integration. The caller owns the transaction and
 * writes the core migration marker after this function succeeds.
 */
export async function applyContentHierarchyMigration(
  client: Pick<PoolClient, "query">,
  rawSchema: string,
): Promise<void> {
  const schema = validateDatabaseSchema(rawSchema);
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    ALTER TABLE ${q("_xecms_documents")}
      ADD CONSTRAINT _xecms_documents_hierarchy_identity
      UNIQUE (workspace_id, collection_id, id);

    CREATE TABLE ${q("_xecms_content_hierarchy_state")} (
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      collection_id text NOT NULL,
      structure_version bigint NOT NULL DEFAULT 0 CHECK (structure_version >= 0),
      updated_at timestamptz,
      updated_by text,
      PRIMARY KEY (workspace_id, collection_id)
    );

    CREATE TABLE ${q("_xecms_content_hierarchy_nodes")} (
      workspace_id text NOT NULL,
      collection_id text NOT NULL,
      document_id text NOT NULL,
      parent_document_id text,
      sort_key integer NOT NULL CHECK (sort_key >= 0),
      depth integer NOT NULL CHECK (depth >= 0),
      PRIMARY KEY (workspace_id, collection_id, document_id),
      CONSTRAINT _xecms_hierarchy_document_fk
        FOREIGN KEY (workspace_id, collection_id, document_id)
        REFERENCES ${q("_xecms_documents")}(workspace_id, collection_id, id)
        ON DELETE RESTRICT,
      CONSTRAINT _xecms_hierarchy_parent_fk
        FOREIGN KEY (workspace_id, collection_id, parent_document_id)
        REFERENCES ${q("_xecms_content_hierarchy_nodes")}(workspace_id, collection_id, document_id)
        DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT _xecms_hierarchy_sibling_sort
        UNIQUE NULLS NOT DISTINCT (workspace_id, collection_id, parent_document_id, sort_key)
        DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT _xecms_hierarchy_not_self_parent CHECK (parent_document_id IS NULL OR parent_document_id <> document_id)
    );
    CREATE INDEX _xecms_hierarchy_nodes_parent
      ON ${q("_xecms_content_hierarchy_nodes")}
      (workspace_id, collection_id, parent_document_id, sort_key);
    CREATE INDEX _xecms_hierarchy_nodes_depth
      ON ${q("_xecms_content_hierarchy_nodes")}
      (workspace_id, collection_id, depth, sort_key);

    CREATE TABLE ${q("_xecms_content_hierarchy_closure")} (
      workspace_id text NOT NULL,
      collection_id text NOT NULL,
      ancestor_document_id text NOT NULL,
      descendant_document_id text NOT NULL,
      distance integer NOT NULL CHECK (distance >= 0),
      PRIMARY KEY (workspace_id, collection_id, ancestor_document_id, descendant_document_id),
      CONSTRAINT _xecms_hierarchy_closure_ancestor_fk
        FOREIGN KEY (workspace_id, collection_id, ancestor_document_id)
        REFERENCES ${q("_xecms_content_hierarchy_nodes")}(workspace_id, collection_id, document_id)
        ON DELETE CASCADE,
      CONSTRAINT _xecms_hierarchy_closure_descendant_fk
        FOREIGN KEY (workspace_id, collection_id, descendant_document_id)
        REFERENCES ${q("_xecms_content_hierarchy_nodes")}(workspace_id, collection_id, document_id)
        ON DELETE CASCADE,
      CONSTRAINT _xecms_hierarchy_closure_self_distance CHECK (
        (ancestor_document_id = descendant_document_id AND distance = 0)
        OR (ancestor_document_id <> descendant_document_id AND distance > 0)
      )
    );
    CREATE INDEX _xecms_hierarchy_closure_descendant
      ON ${q("_xecms_content_hierarchy_closure")}
      (workspace_id, collection_id, descendant_document_id, distance DESC);

    CREATE TABLE ${q("_xecms_content_hierarchy_events")} (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      workspace_id text NOT NULL,
      collection_id text NOT NULL,
      document_id text,
      event_type text NOT NULL CHECK (event_type IN (
        'tree.node.created', 'tree.node.moved', 'tree.node.reordered', 'tree.node.removed'
      )),
      structure_version bigint NOT NULL CHECK (structure_version > 0),
      actor_id text NOT NULL,
      occurred_at timestamptz NOT NULL,
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
    );
    CREATE INDEX _xecms_hierarchy_events_collection_version
      ON ${q("_xecms_content_hierarchy_events")}
      (workspace_id, collection_id, structure_version DESC, id DESC);
  `);
}

/** Standalone idempotent runner used by store tests and non-server consumers. */
export async function migrateContentHierarchy(pool: Pool, rawSchema: string): Promise<void> {
  const schema = validateDatabaseSchema(rawSchema);
  const migrations = qualifiedName(schema, "_xecms_core_migrations");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`xecms:migrate:${schema}`]);
    const existing = await client.query<{ readonly id: string }>(
      `SELECT id FROM ${migrations} WHERE id = $1`,
      [CONTENT_HIERARCHY_MIGRATION_ID],
    );
    if (existing.rowCount === 0) {
      await applyContentHierarchyMigration(client, schema);
      await client.query(`INSERT INTO ${migrations} (id, applied_at) VALUES ($1, now())`, [
        CONTENT_HIERARCHY_MIGRATION_ID,
      ]);
    }
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Kept public so integration code never has to reconstruct identifier quoting. */
export function contentHierarchyTable(schema: string, name: "state" | "nodes" | "closure" | "events"): string {
  validateDatabaseSchema(schema);
  return `${quoteIdentifier(schema)}.${quoteIdentifier(`_xecms_content_hierarchy_${name}`)}`;
}
