import { Readable } from "node:stream";
import {
  ApplicationError,
  AuthorizationApplicationService,
  MediaApplicationService,
} from "@xecms/application";
import type { MediaConsistencyReportDto, MediaListDto, MediaRecordDto } from "@xecms/contracts";
import { type FastifyInstance } from "fastify";
import { type ServerConfig } from "./config.js";
import { publicActor, requirePolicyPermission } from "./request-authentication.js";
import { mediaRecordDto, incompleteMediaRecordDto } from "./response-presenters.js";
import { byteStream, singleHeader, badRequest } from "./request-input.js";
import type { RequestActorResolver } from "./request-authentication.js";

interface Options {
  readonly app: FastifyInstance;
  readonly config: ServerConfig;
  readonly authorization: AuthorizationApplicationService;
  readonly media: MediaApplicationService;
  readonly requireActor: RequestActorResolver;
}

export function registerMediaRoutes(options: Options): void {
  const { app, config, authorization, media, requireActor } = options;

  app.get("/api/media", async (request): Promise<MediaListDto> => {
    const { actor } = await requireActor(request, false);
    await requirePolicyPermission(actor, "media.read");
    const [records, consistency] = await Promise.all([
      media.list(actor.workspaceId),
      media.checkConsistency(actor.workspaceId),
    ]);
    const missing = new Set(consistency.missing.map(({ id }) => id));
    return { items: records.map((record) => mediaRecordDto(record, missing.has(record.id))) };
  });

  app.post("/api/media", async (request, reply): Promise<MediaRecordDto> => {
    const { actor } = await requireActor(request, true);
    await requirePolicyPermission(actor, "media.upload");
    const encodedFileName = singleHeader(request.headers["x-file-name"], "x-file-name");
    let originalFileName: string;
    try {
      originalFileName = decodeURIComponent(encodedFileName);
    } catch {
      throw badRequest("MEDIA_FILE_NAME_INVALID", "x-file-name must be URI encoded UTF-8.");
    }
    const declaredMimeType = (request.headers["content-type"] ?? "").split(";", 1)[0]?.trim() ?? "";
    const declaredLength = request.headers["content-length"];
    if (declaredLength !== undefined) {
      const byteLength = Number(declaredLength);
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw badRequest("MEDIA_CONTENT_LENGTH_INVALID", "content-length must be a non-negative integer.");
      }
      if (byteLength > config.mediaMaxUploadBytes) {
        throw new ApplicationError(
          "MEDIA_SIZE_LIMIT_EXCEEDED",
          413,
          `Media exceeds the ${config.mediaMaxUploadBytes} byte upload limit.`,
        );
      }
    }
    const uploaded = await media.upload({
      workspaceId: actor.workspaceId,
      actorId: actor.subjectId,
      originalFileName,
      declaredMimeType,
      stream: byteStream(request.body),
    });
    reply.code(201);
    return mediaRecordDto(uploaded.media, false);
  });

  app.get<{ Params: { mediaId: string } }>(
    "/api/media/:mediaId/content",
    async (request, reply) => {
      const actor = publicActor(authorization);
      await requirePolicyPermission(actor, "media.read");
      const opened = await media.open(request.params.mediaId);
      reply.header("content-type", opened.media.mimeType);
      reply.header("content-length", String(opened.media.size));
      reply.header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(opened.media.originalFileName)}`,
      );
      reply.header("cache-control", "public, max-age=3600, immutable");
      return reply.send(Readable.from(opened.stream));
    },
  );

  app.delete<{ Params: { mediaId: string } }>("/api/media/:mediaId", async (request, reply) => {
    const { actor } = await requireActor(request, true);
    await requirePolicyPermission(actor, "media.delete");
    await media.delete(request.params.mediaId);
    reply.code(204).send();
  });

  app.post("/api/media/consistency", async (request): Promise<MediaConsistencyReportDto> => {
    const { actor } = await requireActor(request, true);
    await requirePolicyPermission(actor, "media.read");
    const report = await media.checkConsistency(actor.workspaceId);
    return {
      missing: report.missing.map((record) => mediaRecordDto(record, true)),
      orphanStorageKeys: report.orphanStorageKeys,
      incomplete: report.incomplete.map(incompleteMediaRecordDto),
      healthyCount: report.healthyCount,
    };
  });

}
