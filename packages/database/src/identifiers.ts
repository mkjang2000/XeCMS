import { createHash } from "node:crypto";

const DATABASE_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function validateDatabaseSchema(value: string): string {
  if (!DATABASE_SCHEMA_PATTERN.test(value)) {
    throw new TypeError(
      "XECMS_DB_SCHEMA must be a lowercase PostgreSQL identifier containing at most 63 characters.",
    );
  }
  return value;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function contentTableName(collectionId: string): string {
  return `c_${digest(collectionId)}`;
}

export function fieldColumnName(fieldId: string): string {
  return `f_${digest(fieldId)}`;
}

export function uniqueIndexName(collectionId: string, fieldId: string): string {
  return `u_${digest(`${collectionId}:${fieldId}`)}`;
}
