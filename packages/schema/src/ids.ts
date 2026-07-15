import { SchemaIdGenerationError } from "./errors.js";
import type {
  CollectionId,
  ComponentId,
  FieldId,
  RelationId,
  SchemaObjectId,
} from "./types.js";

export type SchemaObjectKind = "collection" | "field" | "relation" | "component";

export interface SchemaIdByKind {
  readonly collection: CollectionId;
  readonly field: FieldId;
  readonly relation: RelationId;
  readonly component: ComponentId;
}

/**
 * Supplies only the opaque suffix. Prefixing, validation, and reuse protection
 * are owned by XeCMS so callers can inject deterministic or random entropy.
 */
export type SchemaIdTokenSource = (kind: SchemaObjectKind) => string;

export interface SchemaIdGenerator {
  next<TKind extends SchemaObjectKind>(kind: TKind): SchemaIdByKind[TKind];
}

export const SCHEMA_ID_PREFIX = {
  collection: "col",
  field: "fld",
  relation: "rel",
  component: "cmp",
} as const satisfies Readonly<Record<SchemaObjectKind, string>>;

export const SCHEMA_ID_PATTERN = /^(?:col|fld|rel|cmp)_[a-z0-9][a-z0-9_-]{0,95}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,95}$/;

/**
 * Creates a stateful generator. A generated full ID may never be returned a
 * second time during this generator's lifetime, even for a different kind.
 */
export function createSchemaIdGenerator(source: SchemaIdTokenSource): SchemaIdGenerator {
  const issued = new Set<string>();

  return {
    next<TKind extends SchemaObjectKind>(kind: TKind): SchemaIdByKind[TKind] {
      const token = source(kind);
      if (!TOKEN_PATTERN.test(token)) {
        throw new SchemaIdGenerationError(
          "Schema ID token must contain 1-96 lowercase ASCII letters, digits, '_' or '-', and start with a letter or digit.",
          token,
        );
      }

      const id = `${SCHEMA_ID_PREFIX[kind]}_${token}`;
      if (issued.has(id)) {
        throw new SchemaIdGenerationError(
          `Schema ID '${id}' was already issued by this generator.`,
          id,
        );
      }
      issued.add(id);
      return id as SchemaIdByKind[TKind];
    },
  };
}

export function hasSchemaIdPrefix(value: string, kind: SchemaObjectKind): boolean {
  return value.startsWith(`${SCHEMA_ID_PREFIX[kind]}_`) && SCHEMA_ID_PATTERN.test(value);
}

export function isSchemaObjectId(value: string): value is SchemaObjectId {
  return SCHEMA_ID_PATTERN.test(value);
}
