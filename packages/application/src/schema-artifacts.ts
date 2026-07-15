import { createHash } from "node:crypto";
import {
  generateTypeScriptTypes,
  parseSchema,
  serializeSchema,
  type SchemaIrV1,
} from "@xecms/schema";
import { ApplicationError, assertCapability, type ActorContext } from "./errors.js";
import type { SchemaDraftRecord, SchemaRevisionRecord, SchemaStore } from "./schema.js";

export const SCHEMA_MANIFEST_FILE_NAME = "xecms.schema.json";
export const SCHEMA_TYPES_FILE_NAME = "xecms.generated.ts";
export const SCHEMA_MANIFEST_MEDIA_TYPE = "application/vnd.xecms.schema+json;version=1";
export const TYPESCRIPT_MEDIA_TYPE = "text/typescript;charset=utf-8";

export interface CanonicalSchemaManifestFile {
  readonly fileName: typeof SCHEMA_MANIFEST_FILE_NAME;
  readonly mediaType: typeof SCHEMA_MANIFEST_MEDIA_TYPE;
  readonly contents: string;
  /** SHA-256 of the exact canonical contents, compatible with Schema Registry hashes. */
  readonly hash: string;
}

export interface GeneratedSchemaTypesFile {
  readonly fileName: typeof SCHEMA_TYPES_FILE_NAME;
  readonly mediaType: typeof TYPESCRIPT_MEDIA_TYPE;
  readonly contents: string;
  readonly hash: string;
  readonly sourceSchemaHash: string;
}

export type SchemaArtifactSource = "active" | "draft";

export function createSchemaManifestArtifact(schema: SchemaIrV1): CanonicalSchemaManifestFile {
  const contents = serializeSchema(schema);
  return {
    fileName: SCHEMA_MANIFEST_FILE_NAME,
    mediaType: SCHEMA_MANIFEST_MEDIA_TYPE,
    contents,
    hash: sha256(contents),
  };
}

export function createSchemaTypesArtifact(schema: SchemaIrV1): GeneratedSchemaTypesFile {
  const manifest = createSchemaManifestArtifact(schema);
  const contents = generateTypeScriptTypes(schema);
  return {
    fileName: SCHEMA_TYPES_FILE_NAME,
    mediaType: TYPESCRIPT_MEDIA_TYPE,
    contents,
    hash: sha256(contents),
    sourceSchemaHash: manifest.hash,
  };
}

/** Strictly imports and canonicalizes a manifest without changing registry state. */
export function importSchemaManifest(contents: string): CanonicalSchemaManifestFile & {
  readonly schema: SchemaIrV1;
} {
  try {
    const schema = parseSchema(contents);
    return { ...createSchemaManifestArtifact(schema), schema };
  } catch (error: unknown) {
    if (hasSchemaIssues(error)) {
      throw new ApplicationError("SCHEMA_MANIFEST_INVALID", 422, error.message, {
        issues: error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path,
        })),
      });
    }
    throw error;
  }
}

/**
 * Authorization-aware registry facade used by HTTP, local API, and a future
 * CLI. Import uses the same optimistic draft contract as the visual builder.
 */
export class SchemaArtifactApplicationService {
  public constructor(
    private readonly store: Pick<
      SchemaStore,
      "getActiveSchema" | "getSchemaDraft" | "saveSchemaDraft"
    >,
    private readonly now: () => string,
  ) {}

  public async exportManifest(
    actor: ActorContext,
    source: SchemaArtifactSource = "active",
  ): Promise<CanonicalSchemaManifestFile> {
    await assertCapability(actor, "schema:read", {
      action: "schema.export",
      resourceId: "resource:schema",
    });
    const schema = await this.requireSource(source);
    return createSchemaManifestArtifact(schema);
  }

  public async generateTypes(
    actor: ActorContext,
    source: SchemaArtifactSource = "active",
  ): Promise<GeneratedSchemaTypesFile> {
    await assertCapability(actor, "schema:read", {
      action: "schema.export",
      resourceId: "resource:schema",
    });
    const schema = await this.requireSource(source);
    return createSchemaTypesArtifact(schema);
  }

  public async importManifest(
    actor: ActorContext,
    input: {
      readonly contents: string;
      readonly baseRevisionId: string | null;
      readonly expectedDraftVersion: string | null;
    },
  ): Promise<{ readonly draft: SchemaDraftRecord; readonly manifest: CanonicalSchemaManifestFile }> {
    await assertCapability(actor, "schema:write", {
      action: "schema.update",
      resourceId: "resource:schema",
    });
    const imported = importSchemaManifest(input.contents);
    const draft = await this.store.saveSchemaDraft({
      baseRevisionId: input.baseRevisionId,
      expectedDraftVersion: input.expectedDraftVersion,
      schema: imported.schema,
      actorId: actor.subjectId,
      now: this.now(),
      claimUnissuedIds: true,
    });
    const { schema: _schema, ...manifest } = imported;
    return { draft, manifest };
  }

  private async requireSource(source: SchemaArtifactSource): Promise<SchemaIrV1> {
    if (source === "draft") {
      const draft = await this.store.getSchemaDraft();
      if (draft === null) {
        throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No schema draft exists.");
      }
      return draft.schema;
    }
    if (source !== "active") {
      throw new ApplicationError("SCHEMA_ARTIFACT_SOURCE_INVALID", 400, "source must be 'active' or 'draft'.");
    }
    const active: SchemaRevisionRecord | null = await this.store.getActiveSchema();
    if (active === null) {
      throw new ApplicationError("SCHEMA_NOT_FOUND", 404, "No active schema exists.");
    }
    return active.schema;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
