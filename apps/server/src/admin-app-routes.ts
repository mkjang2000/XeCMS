import {
  ApplicationError,
  type ActorContext,
  type AdminAppActivationResult,
  type AdminAppApplicationService,
  type AdminAppDependencyResolution,
  type AdminAppDraftRecord,
  type AdminAppRecord,
  type AdminAppRevisionRecord,
} from "@xecms/application";
import type {
  AdminAppActivationDto,
  AdminAppDraftDto,
  AdminAppDraftEnvelopeDto,
  AdminAppDto,
  AdminAppListDto,
  AdminAppManifestArtifactDto,
  AdminAppPreviewDto,
  AdminAppRevisionDto,
  AdminAppRevisionListDto,
} from "@xecms/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

interface Options {
  readonly app: FastifyInstance;
  readonly adminApps: AdminAppApplicationService;
  readonly requireActor: (request: FastifyRequest, csrf: boolean) => Promise<ActorContext>;
  readonly reauthenticate: (
    request: FastifyRequest,
    actor: ActorContext,
    password: string,
  ) => Promise<void>;
}

export function registerAdminAppRoutes(options: Options): void {
  const actor = async (request: FastifyRequest, mutation: boolean): Promise<ActorContext> => {
    const value = await options.requireActor(request, mutation);
    if (mutation && value.authentication !== "session") {
      throw new ApplicationError(
        "API_KEY_ADMINISTRATION_FORBIDDEN",
        403,
        "API keys cannot mutate Admin Apps.",
      );
    }
    return value;
  };

  options.app.get("/api/admin-apps", async (request): Promise<AdminAppListDto> => {
    const value = await actor(request, false);
    const query = optionalObject(request.query);
    const includeArchived = query["includeArchived"] === "true";
    return { items: (await options.adminApps.list(value, includeArchived)).map(appDto) };
  });

  options.app.post("/api/admin-apps", async (request, reply): Promise<AdminAppDraftEnvelopeDto> => {
    const value = await actor(request, true);
    const body = exactObject(request.body, ["manifest"]);
    const created = await options.adminApps.create(value, { manifest: required(body, "manifest") });
    reply.code(201);
    return { app: appDto(created.app), draft: draftDto(created.draft) };
  });

  options.app.post("/api/admin-apps/validate", async (request) => {
    const value = await actor(request, false);
    const body = exactObject(request.body, ["manifest"]);
    const result = await options.adminApps.validate(value, { manifest: required(body, "manifest") });
    return { ...result, resolution: resolutionDto(result.resolution) };
  });

  options.app.put("/api/admin-apps/import", async (request): Promise<AdminAppDraftEnvelopeDto> => {
    const value = await actor(request, true);
    const body = exactObject(request.body, [
      "appId", "expectedRouteVersion", "expectedDraftVersion", "expectedBaseRevisionId", "manifest",
    ]);
    const imported = await options.adminApps.importManifest(value, {
      ...(body["appId"] === undefined ? {} : { appId: string(body["appId"], "appId") }),
      ...(body["expectedRouteVersion"] === undefined ? {} : {
        expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
      }),
      ...(body["expectedDraftVersion"] === undefined ? {} : {
        expectedDraftVersion: nullablePositiveInteger(body["expectedDraftVersion"], "expectedDraftVersion"),
      }),
      ...(body["expectedBaseRevisionId"] === undefined ? {} : {
        expectedBaseRevisionId: nullableString(body["expectedBaseRevisionId"], "expectedBaseRevisionId"),
      }),
      manifest: required(body, "manifest"),
    });
    return { app: appDto(imported.app), draft: draftDto(imported.draft) };
  });

  options.app.get("/api/admin-apps/:appId", async (request): Promise<AdminAppDto> => {
    const value = await actor(request, false);
    return appDto(await options.adminApps.get(value, path(request.params, "appId")));
  });

  options.app.get("/api/admin-apps/:appId/draft", async (request): Promise<AdminAppDraftDto | null> => {
    const value = await actor(request, false);
    const draft = await options.adminApps.getDraft(value, path(request.params, "appId"));
    return draft === null ? null : draftDto(draft);
  });

  options.app.post("/api/admin-apps/:appId/draft", async (request, reply): Promise<AdminAppDraftDto> => {
    const value = await actor(request, true);
    const body = exactObject(request.body, ["expectedRouteVersion"]);
    const draft = await options.adminApps.createDraft(value, {
      appId: path(request.params, "appId"),
      expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
    });
    reply.code(201);
    return draftDto(draft);
  });

  options.app.put("/api/admin-apps/:appId/draft", async (request): Promise<AdminAppDraftDto> => {
    const value = await actor(request, true);
    const body = exactObject(request.body, ["expectedDraftVersion", "expectedBaseRevisionId", "manifest"]);
    return draftDto(await options.adminApps.saveDraft(value, {
      appId: path(request.params, "appId"),
      expectedDraftVersion: positiveInteger(body["expectedDraftVersion"], "expectedDraftVersion"),
      expectedBaseRevisionId: nullableString(body["expectedBaseRevisionId"], "expectedBaseRevisionId"),
      manifest: required(body, "manifest"),
    }));
  });

  options.app.delete("/api/admin-apps/:appId/draft", async (request, reply) => {
    const value = await actor(request, true);
    const body = exactObject(request.body, ["expectedDraftVersion"]);
    await options.adminApps.discardDraft(value, {
      appId: path(request.params, "appId"),
      expectedDraftVersion: positiveInteger(body["expectedDraftVersion"], "expectedDraftVersion"),
    });
    reply.code(204).send();
  });

  options.app.post("/api/admin-apps/:appId/preview", async (request): Promise<AdminAppPreviewDto> => {
    const value = await actor(request, true);
    const input = previewBody(request.body);
    return options.adminApps.preview(value, { appId: path(request.params, "appId"), ...input });
  });

  options.app.post("/api/admin-apps/:appId/apply", async (request): Promise<AdminAppActivationDto> => {
    const value = await actor(request, true);
    const body = exactObject(request.body, [
      "expectedActiveRevisionId", "expectedRouteVersion", "expectedDraftVersion", "planId",
    ]);
    const result = await options.adminApps.apply(value, {
      appId: path(request.params, "appId"),
      expectedActiveRevisionId: nullableString(body["expectedActiveRevisionId"], "expectedActiveRevisionId"),
      expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
      expectedDraftVersion: positiveInteger(body["expectedDraftVersion"], "expectedDraftVersion"),
      planId: string(body["planId"], "planId"),
    });
    return activationDto(result);
  });

  options.app.get("/api/admin-apps/:appId/revisions", async (request): Promise<AdminAppRevisionListDto> => {
    const value = await actor(request, false);
    return {
      items: (await options.adminApps.listRevisions(value, path(request.params, "appId"))).map(revisionDto),
    };
  });

  options.app.post("/api/admin-apps/:appId/rollback", async (request): Promise<AdminAppActivationDto> => {
    const value = await actor(request, true);
    const body = exactObject(request.body, [
      "targetRevisionId", "expectedActiveRevisionId", "expectedRouteVersion",
    ]);
    return activationDto(await options.adminApps.rollback(value, {
      appId: path(request.params, "appId"),
      targetRevisionId: string(body["targetRevisionId"], "targetRevisionId"),
      expectedActiveRevisionId: string(body["expectedActiveRevisionId"], "expectedActiveRevisionId"),
      expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
    }));
  });

  for (const archived of [true, false] as const) {
    options.app.post(`/api/admin-apps/:appId/${archived ? "archive" : "reactivate"}`, async (request): Promise<AdminAppDto> => {
      const value = await actor(request, true);
      const body = exactObject(request.body, ["expectedRouteVersion", "currentPassword"]);
      await options.reauthenticate(request, value, string(body["currentPassword"], "currentPassword"));
      return appDto(await options.adminApps.setArchived(value, {
        appId: path(request.params, "appId"),
        expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
        archived,
      }));
    });
  }

  options.app.delete("/api/admin-apps/:appId", async (request, reply) => {
    const value = await actor(request, true);
    const body = exactObject(request.body, ["expectedRouteVersion", "currentPassword"]);
    await options.reauthenticate(request, value, string(body["currentPassword"], "currentPassword"));
    await options.adminApps.deleteUnapplied(value, {
      appId: path(request.params, "appId"),
      expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
    });
    reply.code(204).send();
  });

  options.app.get("/api/admin-apps/:appId/export", async (request): Promise<AdminAppManifestArtifactDto> => {
    const value = await actor(request, false);
    const query = optionalObject(request.query);
    return options.adminApps.exportManifest(value, {
      appId: path(request.params, "appId"),
      ...(query["revisionId"] === undefined ? {} : {
        revisionId: string(query["revisionId"], "revisionId"),
      }),
    });
  });
}

function appDto(value: AdminAppRecord): AdminAppDto { return { ...value }; }
function draftDto(value: AdminAppDraftRecord): AdminAppDraftDto { return { ...value }; }
function revisionDto(value: AdminAppRevisionRecord): AdminAppRevisionDto { return { ...value }; }
function activationDto(value: AdminAppActivationResult): AdminAppActivationDto {
  return { app: appDto(value.app), revision: revisionDto(value.revision) };
}
function resolutionDto(value: AdminAppDependencyResolution): AdminAppDependencyResolution {
  return value;
}

function previewBody(value: unknown): {
  readonly expectedActiveRevisionId: string | null;
  readonly expectedRouteVersion: number;
  readonly expectedDraftVersion: number;
} {
  const body = exactObject(value, [
    "expectedActiveRevisionId", "expectedRouteVersion", "expectedDraftVersion",
  ]);
  return {
    expectedActiveRevisionId: nullableString(body["expectedActiveRevisionId"], "expectedActiveRevisionId"),
    expectedRouteVersion: positiveInteger(body["expectedRouteVersion"], "expectedRouteVersion"),
    expectedDraftVersion: positiveInteger(body["expectedDraftVersion"], "expectedDraftVersion"),
  };
}

function optionalObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  return object(value);
}
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid("Request contains an unknown field.");
  return result;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Request must be an object.");
  return value as Record<string, unknown>;
}
function required(value: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(value, key)) invalid(`${key} is required.`);
  return value[key];
}
function path(value: unknown, key: string): string { return string(object(value)[key], key); }
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1000) invalid(`${name} is invalid.`);
  return value;
}
function nullableString(value: unknown, name: string): string | null {
  return value === null ? null : string(value, name);
}
function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(`${name} is invalid.`);
  return Number(value);
}
function nullablePositiveInteger(value: unknown, name: string): number | null {
  return value === null ? null : positiveInteger(value, name);
}
function invalid(message: string): never {
  throw new ApplicationError("ADMIN_APP_REQUEST_INVALID", 400, message);
}
