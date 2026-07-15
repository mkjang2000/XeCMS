import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

/** M2-C stable DocumentId edge projection. migrate.ts wires this as a numbered migration. */
export async function applyRelationMigration(
  client: Pick<PoolClient, "query">,
  schema: string,
): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE ${q("_xecms_document_relations")} (
      relation_id text NOT NULL,
      field_name text NOT NULL CHECK (length(btrim(field_name)) > 0),
      source_collection_id text NOT NULL,
      source_document_id text NOT NULL
        REFERENCES ${q("_xecms_documents")}(id) ON DELETE CASCADE,
      target_collection_id text NOT NULL,
      target_document_id text NOT NULL
        REFERENCES ${q("_xecms_documents")}(id) ON DELETE RESTRICT,
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      on_delete text NOT NULL CHECK (on_delete IN ('restrict', 'nullify', 'cascade')),
      PRIMARY KEY (relation_id, source_document_id, ordinal),
      UNIQUE (relation_id, source_document_id, target_document_id)
    );
    CREATE INDEX _xecms_document_relations_target
      ON ${q("_xecms_document_relations")}(target_document_id, relation_id, source_document_id);
    CREATE INDEX _xecms_document_relations_source
      ON ${q("_xecms_document_relations")}(source_document_id, relation_id, ordinal);
  `);
}
