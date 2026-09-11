import { type PostgresMigrationOperation, type SqlStatement } from "../planner.js";
import { instant } from "./shared.js";
import {
  ApplicationError,
  decodeM1Schema,
  type MigrationOperation,
  type SchemaDraftRecord,
  type SchemaRevisionRecord,
} from "@xecms/application";
import { type FieldDefinition, type SchemaIrV1 } from "@xecms/schema";

export interface SchemaRevisionRow {
  readonly revision_id: string | null;
  readonly parent_revision_id: string | null;
  readonly schema_json: unknown;
  readonly created_at: Date | string | null;
  readonly created_by: string | null;
  readonly hash: string | null;
}

export interface SchemaDraftRow {
  readonly base_revision_id: string | null;
  readonly draft_version: string;
  readonly schema_json: unknown;
  readonly updated_at: Date | string;
  readonly updated_by: string;
}

export function schemaRevisionFromRow(row: SchemaRevisionRow): SchemaRevisionRecord {
  if (
    row.revision_id === null ||
    row.created_at === null ||
    row.created_by === null ||
    row.hash === null
  ) {
    throw new ApplicationError("SCHEMA_REGISTRY_CORRUPT", 500, "The schema registry row is incomplete.");
  }
  return {
    revisionId: row.revision_id,
    parentRevisionId: row.parent_revision_id,
    schema: decodeM1Schema(row.schema_json),
    createdAt: instant(row.created_at),
    createdBy: row.created_by,
    hash: row.hash,
  };
}

export function schemaDraftFromRow(row: SchemaDraftRow): SchemaDraftRecord {
  return {
    baseRevisionId: row.base_revision_id,
    draftVersion: row.draft_version,
    schema: decodeM1Schema(row.schema_json),
    updatedAt: instant(row.updated_at),
    updatedBy: row.updated_by,
  };
}

export function schemaObjects(schema: SchemaIrV1): readonly {
  readonly id: string;
  readonly kind: "collection" | "field" | "relation" | "component";
  readonly path: readonly (string | number)[];
}[] {
  return [
    ...schema.collections.flatMap((collection, collectionIndex) => [
      { id: collection.id, kind: "collection" as const, path: ["collections", collectionIndex, "id"] },
      ...fieldSchemaObjects(collection.fields, ["collections", collectionIndex, "fields"]),
    ]),
    ...(schema.components ?? []).flatMap((component, componentIndex) => [
      { id: component.id, kind: "component" as const, path: ["components", componentIndex, "id"] },
      ...fieldSchemaObjects(component.fields, ["components", componentIndex, "fields"]),
    ]),
  ];
}

export function fieldSchemaObjects(
  fields: readonly FieldDefinition[],
  path: readonly (string | number)[],
): readonly {
  readonly id: string;
  readonly kind: "field" | "relation";
  readonly path: readonly (string | number)[];
}[] {
  return fields.flatMap((field, fieldIndex) => {
    const fieldPath = [...path, fieldIndex] as const;
    return [
      { id: field.id, kind: "field" as const, path: [...fieldPath, "id"] },
      ...(field.type === "relation"
        ? [{ id: field.relationId, kind: "relation" as const, path: [...fieldPath, "relationId"] }]
        : []),
      ...(field.type === "object" || field.type === "array"
        ? fieldSchemaObjects(field.fields, [...fieldPath, "fields"])
        : []),
    ];
  });
}

export function migrationStatements(operation: MigrationOperation): readonly SqlStatement[] {
  if ("statements" in operation && Array.isArray(operation.statements)) {
    return (operation as PostgresMigrationOperation).statements;
  }
  return [{ sql: operation.sql }];
}

export function publicOperations(operations: readonly MigrationOperation[]): readonly unknown[] {
  return operations.map(({ id, kind, summary, severity, sql }) => ({ id, kind, summary, severity, sql }));
}

export function schemaConflict(expected: string | null, actual: string | null): ApplicationError {
  return new ApplicationError(
    "SCHEMA_REVISION_CONFLICT",
    409,
    "The active schema no longer matches the draft base revision.",
    { details: { expectedRevisionId: expected, actualRevisionId: actual } },
  );
}

export function schemaDraftConflict(expected: string | null, actual: string | null): ApplicationError {
  return new ApplicationError(
    "SCHEMA_DRAFT_CONFLICT",
    409,
    "The schema draft was changed by another editor.",
    { details: { expectedDraftVersion: expected, actualDraftVersion: actual } },
  );
}

export function schemaContainsRelationField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(schemaContainsRelationField);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const object = value as Readonly<Record<string, unknown>>;
  if (object["type"] === "relation") {
    return true;
  }
  return Object.values(object).some(schemaContainsRelationField);
}

/**
 * Audit history intentionally keeps lifecycle metadata but never revision
 * content. This remains true after purge, when the event table is the only
 * surviving document record.
 */
