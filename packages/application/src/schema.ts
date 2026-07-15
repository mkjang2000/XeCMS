import {
  decodeSchema,
  diffSchemas,
  type CollectionDefinition,
  type FieldDefinition,
  type SchemaChange,
  type SchemaIrV1,
} from "@xecms/schema";
import { createHash } from "node:crypto";
import { serializeSchema } from "@xecms/schema";
import { ApplicationError, assertCapability, type ActorContext } from "./errors.js";

export interface SchemaRevisionRecord {
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly schema: SchemaIrV1;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly hash: string;
}

export interface SchemaDraftRecord {
  readonly baseRevisionId: string | null;
  readonly draftVersion: string;
  readonly schema: SchemaIrV1;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export type MigrationOperationKind =
  | "create-table"
  | "drop-table"
  | "rename-table"
  | "add-column"
  | "drop-column"
  | "rename-column"
  | "alter-column"
  | "drop-hierarchy"
  | "configure-collection-auth";

export interface MigrationOperation {
  readonly id: string;
  readonly kind: MigrationOperationKind;
  readonly summary: string;
  readonly severity: "safe" | "risky" | "destructive";
  readonly sql: string;
}

export interface SchemaPreview {
  readonly baseRevisionId: string | null;
  readonly draftVersion: string;
  readonly planId: string;
  readonly schema: SchemaIrV1;
  readonly changes: readonly SchemaChange[];
  readonly operations: readonly MigrationOperation[];
  readonly requiresDestructiveApproval: boolean;
}

export interface AppliedSchemaResult {
  readonly revision: SchemaRevisionRecord;
  readonly migrationId: string;
}

export interface SchemaStore {
  issueSchemaIds(input: {
    readonly kind: "collection" | "field" | "relation" | "component";
    readonly count: number;
    readonly actorId: string;
    readonly now: string;
  }): Promise<readonly string[]>;
  getActiveSchema(): Promise<SchemaRevisionRecord | null>;
  getSchemaDraft(): Promise<SchemaDraftRecord | null>;
  saveSchemaDraft(input: {
    readonly baseRevisionId: string | null;
    readonly expectedDraftVersion: string | null;
    readonly schema: SchemaIrV1;
    readonly actorId: string;
    readonly now: string;
    readonly claimUnissuedIds?: boolean;
  }): Promise<SchemaDraftRecord>;
  applySchemaDraft(input: {
    readonly expectedRevisionId: string | null;
    readonly expectedDraftVersion: string;
    readonly planId: string;
    readonly schema: SchemaIrV1;
    readonly changes: readonly SchemaChange[];
    readonly operations: readonly MigrationOperation[];
    readonly actorId: string;
    readonly now: string;
  }): Promise<AppliedSchemaResult>;
}

export interface MigrationPlanner {
  plan(previous: SchemaIrV1, next: SchemaIrV1): readonly MigrationOperation[];
}

const EMPTY_SCHEMA: SchemaIrV1 = Object.freeze({
  format: "xecms.schema",
  formatVersion: 1,
  collections: Object.freeze([]),
});
const SCHEMA_AUTHORIZATION_RESOURCE_ID = "resource:schema";

export class SchemaApplicationService {
  public constructor(
    private readonly store: SchemaStore,
    private readonly planner: MigrationPlanner,
    private readonly now: () => string,
  ) {}

  public async getActive(actor: ActorContext): Promise<SchemaRevisionRecord | null> {
    await assertCapability(actor, "schema:read", { resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID });
    return this.store.getActiveSchema();
  }

  public async getDraft(actor: ActorContext): Promise<SchemaDraftRecord | null> {
    await assertCapability(actor, "schema:read", { resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID });
    return this.store.getSchemaDraft();
  }

  public async issueIds(
    actor: ActorContext,
    input: {
      readonly kind: "collection" | "field" | "relation" | "component";
      readonly count: number;
    },
  ): Promise<readonly string[]> {
    await assertCapability(actor, "schema:write", {
      action: "schema.create",
      resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID,
    });
    if (
      !["collection", "field", "relation", "component"].includes(input.kind) ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > 100
    ) {
      throw new ApplicationError(
        "SCHEMA_ID_REQUEST_INVALID",
        400,
        "kind must be a supported schema object kind, and count must be an integer between 1 and 100.",
      );
    }
    return this.store.issueSchemaIds({
      kind: input.kind,
      count: input.count,
      actorId: actor.subjectId,
      now: this.now(),
    });
  }

  public async saveDraft(
    actor: ActorContext,
    input: {
      readonly baseRevisionId: string | null;
      readonly expectedDraftVersion: string | null;
      readonly schema: unknown;
    },
  ): Promise<SchemaDraftRecord> {
    await assertCapability(actor, "schema:write", {
      action: "schema.update",
      resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID,
    });
    const schema = decodeContentSchema(input.schema);
    return this.store.saveSchemaDraft({
      baseRevisionId: input.baseRevisionId,
      expectedDraftVersion: input.expectedDraftVersion,
      schema,
      actorId: actor.subjectId,
      now: this.now(),
    });
  }

  public async importManifest(
    actor: ActorContext,
    input: {
      readonly baseRevisionId: string | null;
      readonly expectedDraftVersion: string | null;
      readonly schema: unknown;
    },
  ): Promise<SchemaDraftRecord> {
    await assertCapability(actor, "schema:write", {
      action: "schema.update",
      resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID,
    });
    const schema = decodeContentSchema(input.schema);
    return this.store.saveSchemaDraft({
      baseRevisionId: input.baseRevisionId,
      expectedDraftVersion: input.expectedDraftVersion,
      schema,
      actorId: actor.subjectId,
      now: this.now(),
      claimUnissuedIds: true,
    });
  }

  public async preview(
    actor: ActorContext,
    input: { readonly expectedDraftVersion: string },
  ): Promise<SchemaPreview> {
    await assertCapability(actor, "schema:read", { resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID });
    const draft = await this.requireDraft();
    const active = await this.store.getActiveSchema();
    assertDraftBase(draft, active);
    if (input.expectedDraftVersion !== draft.draftVersion) {
      draftConflict(input.expectedDraftVersion, draft.draftVersion);
    }
    const previous = active?.schema ?? EMPTY_SCHEMA;
    const changes = diffSchemas(previous, draft.schema);
    const operations = this.planner.plan(previous, draft.schema);
    const planId = createPlanId(draft, operations);
    return {
      baseRevisionId: draft.baseRevisionId,
      draftVersion: draft.draftVersion,
      planId,
      schema: draft.schema,
      changes,
      operations,
      requiresDestructiveApproval:
        changes.some(({ severity }) => severity === "destructive") ||
        operations.some(({ severity }) => severity === "destructive"),
    };
  }

  public async apply(
    actor: ActorContext,
    input: {
      readonly expectedRevisionId: string | null;
      readonly expectedDraftVersion: string;
      readonly planId: string;
      readonly approveDestructive: boolean;
    },
  ): Promise<AppliedSchemaResult> {
    await assertCapability(actor, "schema:apply", { resourceId: SCHEMA_AUTHORIZATION_RESOURCE_ID });
    const preview = await this.preview(actor, {
      expectedDraftVersion: input.expectedDraftVersion,
    });
    if (input.expectedRevisionId !== preview.baseRevisionId) {
      conflict(input.expectedRevisionId, preview.baseRevisionId);
    }
    if (preview.requiresDestructiveApproval && !input.approveDestructive) {
      throw new ApplicationError(
        "DESTRUCTIVE_MIGRATION_APPROVAL_REQUIRED",
        409,
        "This schema migration contains destructive operations and requires explicit approval.",
      );
    }
    if (input.planId !== preview.planId) {
      throw new ApplicationError(
        "SCHEMA_PLAN_STALE",
        409,
        "The migration plan changed after it was previewed. Preview it again before applying.",
      );
    }
    return this.store.applySchemaDraft({
      expectedRevisionId: input.expectedRevisionId,
      expectedDraftVersion: input.expectedDraftVersion,
      planId: input.planId,
      schema: preview.schema,
      changes: preview.changes,
      operations: preview.operations,
      actorId: actor.subjectId,
      now: this.now(),
    });
  }

  private async requireDraft(): Promise<SchemaDraftRecord> {
    const draft = await this.store.getSchemaDraft();
    if (draft === null) {
      throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No schema draft exists.");
    }
    return draft;
  }
}

function createPlanId(
  draft: SchemaDraftRecord,
  operations: readonly MigrationOperation[],
): string {
  const material = JSON.stringify({
    baseRevisionId: draft.baseRevisionId,
    draftVersion: draft.draftVersion,
    schema: serializeSchema(draft.schema),
    operations: operations.map(({ id, kind, summary, severity, sql }) => ({
      id,
      kind,
      summary,
      severity,
      sql,
    })),
  });
  return `plan_${createHash("sha256").update(material).digest("hex")}`;
}

export function decodeContentSchema(input: unknown): SchemaIrV1 {
  let schema: SchemaIrV1;
  try {
    schema = decodeSchema(input);
  } catch (error: unknown) {
    if (hasSchemaIssues(error)) {
      throw new ApplicationError("SCHEMA_INVALID", 422, error.message, {
        issues: error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path,
        })),
      });
    }
    throw error;
  }

  return schema;
}

/** @deprecated Kept as a storage compatibility alias for databases created during M1. */
export const decodeM1Schema = decodeContentSchema;

function validateM1Collection(
  collection: CollectionDefinition,
  collectionIndex: number,
  issues: Array<{ code: string; message: string; path: readonly (string | number)[] }>,
): void {
  if (collection.kind === "singleton") {
    issues.push({
      code: "M1_UNSUPPORTED_SINGLETON",
      message: "Singleton collections are introduced in M2.",
      path: ["collections", collectionIndex, "kind"],
    });
  }
  if (collection.hierarchy !== undefined) {
    issues.push({
      code: "M1_UNSUPPORTED_HIERARCHY",
      message: "Collection hierarchy is introduced in M2.",
      path: ["collections", collectionIndex, "hierarchy"],
    });
  }
  collection.fields.forEach((field, fieldIndex) => {
    if (!isM1Field(field)) {
      issues.push({
        code: "M1_UNSUPPORTED_FIELD_TYPE",
        message: `Field type '${field.type}' is not available in M1.`,
        path: ["collections", collectionIndex, "fields", fieldIndex, "type"],
      });
    }
  });
}

export type M1FieldDefinition =
  | Extract<FieldDefinition, { readonly type: "number" | "boolean" }>
  | (Extract<FieldDefinition, { readonly type: "text" | "textarea" }> & {
      readonly type: "text";
    })
  | (Extract<FieldDefinition, { readonly type: "date" | "datetime" }> & {
      readonly type: "datetime";
    });

export function isM1Field(field: FieldDefinition): field is M1FieldDefinition {
  return (
    field.type === "text" ||
    field.type === "number" ||
    field.type === "boolean" ||
    field.type === "datetime"
  );
}

function assertDraftBase(draft: SchemaDraftRecord, active: SchemaRevisionRecord | null): void {
  const activeId = active?.revisionId ?? null;
  if (draft.baseRevisionId !== activeId) {
    conflict(draft.baseRevisionId, activeId);
  }
}

function conflict(expected: string | null, actual: string | null): never {
  throw new ApplicationError(
    "SCHEMA_REVISION_CONFLICT",
    409,
    "The active schema changed after this draft was created.",
    { details: { expectedRevisionId: expected, actualRevisionId: actual } },
  );
}

function draftConflict(expected: string | null, actual: string | null): never {
  throw new ApplicationError(
    "SCHEMA_DRAFT_CONFLICT",
    409,
    "The schema draft was changed by another editor.",
    { details: { expectedDraftVersion: expected, actualDraftVersion: actual } },
  );
}

function hasSchemaIssues(error: unknown): error is Error & {
  readonly issues: readonly {
    readonly code: string;
    readonly message: string;
    readonly path: readonly (string | number)[];
  }[];
} {
  return (
    error instanceof Error &&
    "issues" in error &&
    Array.isArray((error as { readonly issues?: unknown }).issues)
  );
}
