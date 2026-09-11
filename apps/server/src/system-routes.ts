import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import {
  ApplicationError,
  AuthApplicationService,
  WorkspaceSettingsService,
  PluginService,
  SYSTEM_WORKSPACE_RESOURCE_ID,
} from "@xecms/application";
import type { HealthResponse, SystemDiagnosticsDto, WorkspaceSettingsDto } from "@xecms/contracts";
import { DEFAULT_WORKSPACE_ID, CORE_MIGRATION_IDS, PostgresDatabase, qualifiedName } from "@xecms/database";
import { type FastifyInstance } from "fastify";
import { type ServerConfig } from "./config.js";
import { requireSession } from "./request-authentication.js";
import { workspaceSettingsDto } from "./response-presenters.js";
import { workspaceSettingsInput } from "./request-input.js";
import type { RequestActorResolver } from "./request-authentication.js";

const XECMS_VERSION = "0.5.0";

interface Options {
  readonly app: FastifyInstance;
  readonly database: PostgresDatabase;
  readonly config: ServerConfig;
  readonly plugins: PluginService;
  readonly workspaceSettings: WorkspaceSettingsService;
  readonly auth: AuthApplicationService;
  readonly requireActor: RequestActorResolver;
}

export function registerSystemRoutes(options: Options): void {
  const { app, database, config, plugins, workspaceSettings, auth, requireActor } = options;

  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("x-xecms-version", XECMS_VERSION);
    reply.header("x-xecms-api-version", "1");
  });

  app.get("/api/live", async () => ({ status: "live", version: XECMS_VERSION }));

  app.get("/api/ready", async (_request, reply) => {
    const checks = { database: false, migrations: false, storage: false, plugins: false };
    try {
      await database.ping();
      checks.database = true;
      const migrationTable = qualifiedName(database.schema, "_xecms_core_migrations");
      const result = await database.pool.query<{ id: string }>(`SELECT id FROM ${migrationTable} ORDER BY id`);
      checks.migrations = CORE_MIGRATION_IDS.every((id) => result.rows.some((row) => row.id === id))
        && !result.rows.some((row) => !CORE_MIGRATION_IDS.includes(row.id as never));
      await mkdir(config.mediaStorageRoot, { recursive: true });
      await access(config.mediaStorageRoot, constants.R_OK | constants.W_OK);
      checks.storage = true;
      const catalog = await plugins.listCatalog(DEFAULT_WORKSPACE_ID);
      checks.plugins = catalog.every((plugin) => plugin.installed?.desiredState !== "enabled"
        || plugin.runtimeLoaded && !plugin.restartRequired);
    } catch {
      reply.code(503);
      return { status: "not-ready", checks, version: XECMS_VERSION };
    }
    const ready = Object.values(checks).every(Boolean);
    if (!ready) reply.code(503);
    return { status: ready ? "ready" : "not-ready", checks, version: XECMS_VERSION };
  });

  app.get("/api/health", async (): Promise<HealthResponse> => {
    await database.ping();
    return { status: "ok", database: "connected", version: XECMS_VERSION };
  });

  app.get("/api/system/diagnostics", async (request): Promise<SystemDiagnosticsDto> => {
    const { actor } = await requireActor(request, false);
    await actor.authorization!.require({ action: "system.settings.read", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
    const postgres = await database.pool.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    return { environment: config.nodeEnv, xecmsVersion: XECMS_VERSION, nodeVersion: process.version,
      postgresVersion: postgres.rows[0]!.version, schemaMode: config.schemaMode,
      workerEnabled: config.workerEnabled, uploadLimitBytes: config.mediaMaxUploadBytes,
      allowedMimeTypes: config.mediaAllowedMimeTypes, adminOriginCount: config.adminOrigins.length,
      contentOriginCount: config.contentOrigins.length, storageAdapter: "local" };
  });

  app.get("/api/workspace/settings", async (request): Promise<WorkspaceSettingsDto> => {
    const { actor } = await requireActor(request, false);
    await actor.authorization!.require({ action: "system.settings.read", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
    return workspaceSettingsDto(await workspaceSettings.get(actor.workspaceId));
  });

  app.patch("/api/workspace/settings", async (request): Promise<WorkspaceSettingsDto> => {
    const { actor } = await requireActor(request, true);
    if (actor.authentication === "api-key") throw new ApplicationError("API_KEY_ADMINISTRATION_FORBIDDEN", 403, "API keys cannot change Workspace settings.");
    await actor.authorization!.require({ action: "system.settings.update", resourceId: SYSTEM_WORKSPACE_RESOURCE_ID });
    const body = workspaceSettingsInput(request.body);
    const authenticated = await requireSession(request, auth, config, false);
    await auth.reauthenticate({ identityId: authenticated.session.identity.id,
      username: authenticated.session.identity.username, password: body.currentPassword });
    return workspaceSettingsDto(await workspaceSettings.update({ workspaceId: actor.workspaceId,
      expectedRevision: body.expectedRevision, displayName: body.displayName,
      defaultTimezone: body.defaultTimezone, adminLocale: body.adminLocale,
      actorIdentityId: actor.identityId ?? actor.subjectId, actorSubjectId: actor.subjectId }));
  });

}
