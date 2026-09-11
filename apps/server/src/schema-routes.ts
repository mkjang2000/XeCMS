import { SchemaArtifactApplicationService, SchemaApplicationService } from "@xecms/application";
import type {
  CollectionListDto,
  GeneratedTypesDto,
  IssueSchemaIdsResponse,
  SchemaDraftEnvelopeDto,
  SchemaManifestDto,
  SchemaPreviewDto,
  SchemaRevisionEnvelopeDto,
} from "@xecms/contracts";
import { type FastifyInstance } from "fastify";
import { type ServerConfig } from "./config.js";
import { revisionDto, collectionList } from "./response-presenters.js";
import {
  assertSchemaMutationAllowed,
  objectBody,
  requiredString,
  nullableString,
  badRequest,
} from "./request-input.js";
import type { RequestActorResolver } from "./request-authentication.js";

interface Options {
  readonly app: FastifyInstance;
  readonly config: ServerConfig;
  readonly schema: SchemaApplicationService;
  readonly schemaArtifacts: SchemaArtifactApplicationService;
  readonly requireActor: RequestActorResolver;
  readonly applySchemaWithProjection: (
    actor: Parameters<SchemaApplicationService["apply"]>[0],
    input: Parameters<SchemaApplicationService["apply"]>[1],
  ) => Promise<Parameters<typeof revisionDto>[0]>;
}

export function registerSchemaRoutes(options: Options): void {
  const { app, config, schema, schemaArtifacts, requireActor, applySchemaWithProjection } = options;

  app.get("/api/schema", async (request): Promise<SchemaRevisionEnvelopeDto | null> => {
    const { actor } = await requireActor(request, false);
    const current = await schema.getActive(actor);
    return current === null ? null : revisionDto(current);
  });

  app.get("/api/schema/draft", async (request): Promise<SchemaDraftEnvelopeDto | null> => {
    const { actor } = await requireActor(request, false);
    return schema.getDraft(actor);
  });

  app.get("/api/schema/manifest", async (request): Promise<SchemaManifestDto> => {
    const { actor } = await requireActor(request, false);
    const artifact = await schemaArtifacts.exportManifest(actor);
    return {
      schema: JSON.parse(artifact.contents) as SchemaManifestDto["schema"],
      serialized: artifact.contents,
      hash: artifact.hash,
    };
  });

  app.get("/api/schema/types", async (request): Promise<GeneratedTypesDto> => {
    const { actor } = await requireActor(request, false);
    const artifact = await schemaArtifacts.generateTypes(actor);
    return {
      fileName: artifact.fileName,
      source: artifact.contents,
      hash: artifact.hash,
    };
  });

  app.put("/api/schema/manifest", async (request): Promise<SchemaDraftEnvelopeDto> => {
    assertSchemaMutationAllowed(config, "manifest");
    const { actor } = await requireActor(request, true);
    const body = objectBody(request.body);
    if (!("schema" in body)) {
      throw badRequest("REQUEST_BODY_INVALID", "schema is required.");
    }
    return schema.importManifest(actor, {
      baseRevisionId: nullableString(body["baseRevisionId"], "baseRevisionId"),
      expectedDraftVersion: nullableString(
        body["expectedDraftVersion"],
        "expectedDraftVersion",
      ),
      schema: body["schema"],
    });
  });

  app.post("/api/schema/ids", async (request): Promise<IssueSchemaIdsResponse> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, true);
    const body = objectBody(request.body);
    const kind = body["kind"];
    const count = body["count"];
    if (
      (kind !== "collection" &&
        kind !== "field" &&
        kind !== "relation" &&
        kind !== "component") ||
      typeof count !== "number"
    ) {
      throw badRequest("SCHEMA_ID_REQUEST_INVALID", "kind and count are required.");
    }
    const ids = await schema.issueIds(actor, { kind, count });
    return { ids } satisfies IssueSchemaIdsResponse;
  });

  app.put("/api/schema/draft", async (request): Promise<SchemaDraftEnvelopeDto> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, true);
    const body = objectBody(request.body);
    const baseRevisionId = nullableString(body["baseRevisionId"], "baseRevisionId");
    const expectedDraftVersion = nullableString(
      body["expectedDraftVersion"],
      "expectedDraftVersion",
    );
    if (!("schema" in body)) {
      throw badRequest("REQUEST_BODY_INVALID", "schema is required.");
    }
    return schema.saveDraft(actor, {
      baseRevisionId,
      expectedDraftVersion,
      schema: body["schema"],
    });
  });

  app.post("/api/schema/preview", async (request): Promise<SchemaPreviewDto> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, true);
    const body = objectBody(request.body);
    const expectedDraftVersion = requiredString(
      body["expectedDraftVersion"],
      "expectedDraftVersion",
    );
    const preview = await schema.preview(actor, { expectedDraftVersion });
    return {
      planId: preview.planId,
      baseRevisionId: preview.baseRevisionId,
      draftVersion: preview.draftVersion,
      schema: preview.schema,
      changes: preview.changes,
      operations: preview.operations.map(({ id, kind, summary, severity, sql }) => ({
        id,
        kind,
        summary,
        severity,
        sql,
      })),
      requiresDestructiveApproval: preview.requiresDestructiveApproval,
    };
  });

  app.post("/api/schema/apply", async (request): Promise<SchemaRevisionEnvelopeDto> => {
    assertSchemaMutationAllowed(config, "editor");
    const { actor } = await requireActor(request, true);
    const body = objectBody(request.body);
    const expectedRevisionId = nullableString(body["expectedRevisionId"], "expectedRevisionId");
    const expectedDraftVersion = requiredString(body["expectedDraftVersion"], "expectedDraftVersion");
    const planId = requiredString(body["planId"], "planId");
    const approveDestructive = body["approveDestructive"];
    if (typeof approveDestructive !== "boolean") {
      throw badRequest("REQUEST_BODY_INVALID", "approveDestructive must be a boolean.");
    }
    return revisionDto(await applySchemaWithProjection(actor, {
      expectedRevisionId,
      expectedDraftVersion,
      planId,
      approveDestructive,
    }));
  });

  app.get("/api/collections", async (request): Promise<CollectionListDto> => {
    const { actor } = await requireActor(request, false);
    const [active, draft] = await Promise.all([schema.getActive(actor), schema.getDraft(actor)]);
    return collectionList(active, draft);
  });

}
