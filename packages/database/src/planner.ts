import { createHash } from "node:crypto";
import type { MigrationOperation, MigrationPlanner } from "@xecms/application";
import type {
  CollectionDefinition,
  FieldDefinition,
  SchemaIrV1,
} from "@xecms/schema";
import {
  classifyCollectionAuthChange,
  collectionAuthDefinitionsEqual,
} from "@xecms/schema";
import {
  contentTableName,
  fieldColumnName,
  qualifiedName,
  quoteIdentifier,
  uniqueIndexName,
  validateDatabaseSchema,
} from "./identifiers.js";

export interface SqlStatement {
  readonly sql: string;
  readonly parameters?: readonly unknown[];
}

export interface PostgresMigrationOperation extends MigrationOperation {
  readonly statements: readonly SqlStatement[];
}

export class PostgresMigrationPlanner implements MigrationPlanner {
  private readonly schema: string;

  public constructor(schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public plan(previous: SchemaIrV1, next: SchemaIrV1): readonly PostgresMigrationOperation[] {
    const operations: PostgresMigrationOperation[] = [];
    const before = new Map(previous.collections.map((collection) => [collection.id, collection]));
    const after = new Map(next.collections.map((collection) => [collection.id, collection]));

    for (const collection of previous.collections) {
      if (!after.has(collection.id)) {
        operations.push(this.dropCollection(collection));
        if (collection.auth !== undefined) {
          operations.push(this.configureCollectionAuth(collection, undefined));
        }
      }
    }
    for (const collection of next.collections) {
      const oldCollection = before.get(collection.id);
      if (oldCollection === undefined) {
        operations.push(this.createCollection(collection));
        if (collection.auth !== undefined) {
          operations.push(this.configureCollectionAuth(undefined, collection));
        }
      } else {
        operations.push(...this.alterCollection(oldCollection, collection));
      }
    }
    return operations.sort((left, right) => left.id.localeCompare(right.id, "en-US"));
  }

  private createCollection(collection: CollectionDefinition): PostgresMigrationOperation {
    const table = qualifiedName(this.schema, contentTableName(collection.id));
    const fieldColumns = collection.fields.map((field) => {
      return `${quoteIdentifier(fieldColumnName(field.id))} ${postgresType(field)}${field.required === true ? " NOT NULL" : ""}`;
    });
    const createSql = `CREATE TABLE ${table} (\n  id text PRIMARY KEY REFERENCES ${qualifiedName(this.schema, "_xecms_documents")}(id) ON DELETE CASCADE,\n  aggregate_version bigint NOT NULL,\n  created_at timestamptz NOT NULL,\n  updated_at timestamptz NOT NULL,\n  deleted_at timestamptz${fieldColumns.length === 0 ? "" : `,\n  ${fieldColumns.join(",\n  ")}`}\n)`;
    const statements: SqlStatement[] = [{ sql: createSql }];
    for (const field of collection.fields) {
      if (field.unique === true) {
        statements.push({ sql: createUniqueIndex(this.schema, collection.id, field.id) });
      }
    }
    return operation({
      seed: `create:${collection.id}`,
      kind: "create-table",
      summary: `Create physical table for collection '${collection.name}'.`,
      severity: "safe",
      statements,
    });
  }

  private dropCollection(collection: CollectionDefinition): PostgresMigrationOperation {
    return operation({
      seed: `drop:${collection.id}`,
      kind: "drop-table",
      summary: `Delete documents and drop the physical table for collection '${collection.name}'.`,
      severity: "destructive",
      statements: [
        {
          sql: `DELETE FROM ${qualifiedName(this.schema, "_xecms_content_hierarchy_nodes")} WHERE collection_id = $1`,
          parameters: [collection.id],
        },
        {
          sql: `DELETE FROM ${qualifiedName(this.schema, "_xecms_content_hierarchy_state")} WHERE collection_id = $1`,
          parameters: [collection.id],
        },
        {
          sql: `DELETE FROM ${qualifiedName(this.schema, "_xecms_documents")} WHERE collection_id = $1`,
          parameters: [collection.id],
        },
        { sql: `DROP TABLE ${qualifiedName(this.schema, contentTableName(collection.id))}` },
      ],
    });
  }

  private alterCollection(
    previous: CollectionDefinition,
    next: CollectionDefinition,
  ): readonly PostgresMigrationOperation[] {
    const operations: PostgresMigrationOperation[] = [];
    const before = new Map(previous.fields.map((field) => [field.id, field]));
    const after = new Map(next.fields.map((field) => [field.id, field]));
    const table = qualifiedName(this.schema, contentTableName(next.id));

    if (!collectionAuthDefinitionsEqual(previous.auth, next.auth)) {
      operations.push(this.configureCollectionAuth(previous, next));
    }

    if (previous.hierarchy?.enabled === true && next.hierarchy?.enabled !== true) {
      operations.push(operation({
        seed: `disable-hierarchy:${next.id}`,
        kind: "drop-hierarchy",
        summary: `Remove hierarchy positions from collection '${next.name}'.`,
        severity: "destructive",
        statements: [
          {
            sql: `DELETE FROM ${qualifiedName(this.schema, "_xecms_content_hierarchy_nodes")} WHERE collection_id = $1`,
            parameters: [next.id],
          },
          {
            sql: `DELETE FROM ${qualifiedName(this.schema, "_xecms_content_hierarchy_state")} WHERE collection_id = $1`,
            parameters: [next.id],
          },
        ],
      }));
    }

    for (const field of previous.fields) {
      if (!after.has(field.id)) {
        operations.push(
          operation({
            seed: `drop-field:${next.id}:${field.id}`,
            kind: "drop-column",
            summary: `Drop field '${field.name}' from '${next.name}'.`,
            severity: "destructive",
            statements: [
              ...(field.unique === true
                ? [{ sql: `DROP INDEX ${qualifiedName(this.schema, uniqueIndexName(next.id, field.id))}` }]
                : []),
              { sql: `ALTER TABLE ${table} DROP COLUMN ${quoteIdentifier(fieldColumnName(field.id))}` },
            ],
          }),
        );
      }
    }

    for (const field of next.fields) {
      const oldField = before.get(field.id);
      if (oldField === undefined) {
        operations.push(this.addField(next, field));
        continue;
      }
      const statements: SqlStatement[] = [];
      let severity: "safe" | "risky" | "destructive" = "safe";
      const column = quoteIdentifier(fieldColumnName(field.id));
      if (postgresType(oldField) !== postgresType(field)) {
        severity = "destructive";
        statements.push({
          sql: `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${postgresType(field)} USING ${column}::${postgresType(field)}`,
        });
      }
      if (oldField.required !== field.required) {
        severity = field.required === true ? maxSeverity(severity, "risky") : severity;
        statements.push({
          sql: `ALTER TABLE ${table} ALTER COLUMN ${column} ${field.required === true ? "SET" : "DROP"} NOT NULL`,
        });
      }
      if (oldField.unique !== field.unique) {
        if (field.unique === true) {
          severity = maxSeverity(severity, "risky");
          statements.push({ sql: createUniqueIndex(this.schema, next.id, field.id) });
        } else {
          statements.push({
            sql: `DROP INDEX ${qualifiedName(this.schema, uniqueIndexName(next.id, field.id))}`,
          });
        }
      }
      if (statements.length > 0) {
        operations.push(
          operation({
            seed: `alter-field:${next.id}:${field.id}`,
            kind: "alter-column",
            summary: `Alter storage constraints for field '${field.name}' in '${next.name}'.`,
            severity,
            statements,
          }),
        );
      }
    }
    return operations;
  }

  private configureCollectionAuth(
    previous: CollectionDefinition | undefined,
    next: CollectionDefinition | undefined,
  ): PostgresMigrationOperation {
    const collection = next ?? previous!;
    return operation({
      seed: `configure-auth:${collection.id}`,
      kind: "configure-collection-auth",
      summary: `Configure Content Realm auth for collection '${collection.name}'. Actual Realm materialization is handled by the 0013 store coordinator.`,
      severity: classifyCollectionAuthChange(previous?.auth, next?.auth),
      statements: [],
    });
  }

  private addField(
    collection: CollectionDefinition,
    field: FieldDefinition,
  ): PostgresMigrationOperation {
    const table = qualifiedName(this.schema, contentTableName(collection.id));
    const column = quoteIdentifier(fieldColumnName(field.id));
    const statements: SqlStatement[] = [
      { sql: `ALTER TABLE ${table} ADD COLUMN ${column} ${postgresType(field)}` },
    ];
    const defaultValue = "defaultValue" in field ? field.defaultValue : undefined;
    if (field.required === true && defaultValue !== undefined) {
      statements.push({
        sql: `UPDATE ${table} SET ${column} = $1${usesJsonStorage(field) ? "::jsonb" : ""} WHERE ${column} IS NULL`,
        parameters: [storageParameter(field, defaultValue)],
      });
    }
    if (field.required === true) {
      statements.push({ sql: `ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL` });
    }
    if (field.unique === true) {
      statements.push({ sql: createUniqueIndex(this.schema, collection.id, field.id) });
    }
    return operation({
      seed: `add-field:${collection.id}:${field.id}`,
      kind: "add-column",
      summary: `Add field '${field.name}' to '${collection.name}'.`,
      severity: field.required === true && defaultValue === undefined ? "risky" : "safe",
      statements,
    });
  }
}

function operation(input: {
  readonly seed: string;
  readonly kind: PostgresMigrationOperation["kind"];
  readonly summary: string;
  readonly severity: PostgresMigrationOperation["severity"];
  readonly statements: readonly SqlStatement[];
}): PostgresMigrationOperation {
  return {
    id: `op_${createHash("sha256").update(input.seed).digest("hex").slice(0, 20)}`,
    kind: input.kind,
    summary: input.summary,
    severity: input.severity,
    sql: input.statements.map(({ sql }) => sql).join(";\n"),
    statements: input.statements,
  };
}

function postgresType(field: FieldDefinition): string {
  switch (field.type) {
    case "text":
    case "textarea":
      return "text";
    case "select":
    case "enum":
      return field.multiple === true ? "jsonb" : "text";
    case "relation":
      return field.cardinality === "many" ? "jsonb" : "text";
    case "upload":
      return field.multiple === true ? "jsonb" : "text";
    case "number":
      return "double precision";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "json":
    case "object":
    case "array":
    case "component":
    case "blocks":
    case "rich-text":
      return "jsonb";
  }
}

export function usesJsonStorage(field: FieldDefinition): boolean {
  return postgresType(field) === "jsonb";
}

export function storageParameter(field: FieldDefinition, value: unknown): unknown {
  return usesJsonStorage(field) && value !== null ? JSON.stringify(value) : value;
}

function createUniqueIndex(schema: string, collectionId: string, fieldId: string): string {
  return `CREATE UNIQUE INDEX ${quoteIdentifier(uniqueIndexName(collectionId, fieldId))} ON ${qualifiedName(schema, contentTableName(collectionId))} (${quoteIdentifier(fieldColumnName(fieldId))})`;
}

function maxSeverity(
  left: "safe" | "risky" | "destructive",
  right: "safe" | "risky" | "destructive",
): "safe" | "risky" | "destructive" {
  const ranks = { safe: 0, risky: 1, destructive: 2 } as const;
  return ranks[left] >= ranks[right] ? left : right;
}
