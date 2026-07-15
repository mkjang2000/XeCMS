import type { FieldId } from "./types.js";

export type SchemaIssueCode =
  | "INVALID_MANIFEST"
  | "INVALID_OBJECT_ID"
  | "INVALID_NAME"
  | "DUPLICATE_OBJECT_ID"
  | "DUPLICATE_NAME"
  | "UNKNOWN_RELATION_TARGET"
  | "UNKNOWN_COMPONENT_TARGET"
  | "DUPLICATE_SELECT_VALUE"
  | "INVALID_RANGE"
  | "INVALID_HIERARCHY"
  | "INVALID_AUTH"
  | "DUPLICATE_REALM_KEY"
  | "INVALID_DEFAULT_VALUE"
  | "INVALID_RICH_TEXT_EDITOR"
  | "DUPLICATE_COMPONENT_TARGET"
  | "INVALID_MIME_PATTERN"
  | "UNSUPPORTED_NESTED_REFERENCE"
  | "UNSUPPORTED_LOCALIZED";

export interface SchemaIssue {
  readonly code: SchemaIssueCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly objectId?: string;
}

export class SchemaValidationError extends Error {
  public readonly code = "SCHEMA_VALIDATION_FAILED";

  public constructor(public readonly issues: readonly SchemaIssue[]) {
    super(`Schema validation failed with ${issues.length} issue(s).`);
    this.name = "SchemaValidationError";
  }
}

export type SchemaDecodeIssueCode =
  | "INVALID_JSON_VALUE"
  | "INVALID_JSON_SYNTAX"
  | "INVALID_INPUT_TYPE"
  | "MISSING_PROPERTY"
  | "UNKNOWN_PROPERTY"
  | "UNKNOWN_FIELD_TYPE"
  | "INVALID_LITERAL";

export interface SchemaDecodeIssue {
  readonly code: SchemaDecodeIssueCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** Raised when an unknown value cannot be decoded into the Schema IR shape. */
export class SchemaDecodeError extends Error {
  public readonly code = "SCHEMA_DECODE_FAILED";

  public constructor(public readonly issues: readonly SchemaDecodeIssue[]) {
    super(`Schema decoding failed with ${issues.length} issue(s).`);
    this.name = "SchemaDecodeError";
  }
}

export class SchemaIdGenerationError extends Error {
  public readonly code = "SCHEMA_ID_GENERATION_FAILED";

  public constructor(
    message: string,
    public readonly generatedValue: string,
  ) {
    super(message);
    this.name = "SchemaIdGenerationError";
  }
}

export type ContentIssueCode =
  | "INVALID_CONTENT_TYPE"
  | "UNKNOWN_FIELD"
  | "FIELD_REQUIRED"
  | "FIELD_CONSTRAINT_FAILED"
  | "UNKNOWN_COLLECTION"
  | "UNKNOWN_COMPONENT"
  | "INVALID_RICH_TEXT";

export interface ContentIssue {
  readonly code: ContentIssueCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly fieldId?: FieldId;
}

/** Raised when document data does not conform to a canonical collection schema. */
export class ContentValidationError extends Error {
  public readonly code = "CONTENT_VALIDATION_FAILED";

  public constructor(public readonly issues: readonly ContentIssue[]) {
    super(`Content validation failed with ${issues.length} issue(s).`);
    this.name = "ContentValidationError";
  }
}
