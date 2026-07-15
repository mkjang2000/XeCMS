import type { PoolClient } from "pg";

import { qualifiedName } from "./identifiers.js";

/** Expands the stable Schema Object registry for the complete M2 graph. */
export async function applyM2SchemaRegistryMigration(
  client: PoolClient,
  schema: string,
): Promise<void> {
  const objects = qualifiedName(schema, "_xecms_schema_object_ids");
  await client.query(`
    ALTER TABLE ${objects}
      DROP CONSTRAINT IF EXISTS _xecms_schema_object_ids_object_kind_check;
    ALTER TABLE ${objects}
      ADD CONSTRAINT _xecms_schema_object_ids_object_kind_check
      CHECK (object_kind IN ('collection', 'field', 'relation', 'component'))
  `);
}
