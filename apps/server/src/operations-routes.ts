import {
  ApplicationError,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  type ActorContext,
  type AuthorizationApplicationService,
  type RetentionService,
  type UnifiedAuditCategory,
  type UnifiedAuditFilter,
  type UnifiedAuditOutcome,
  type UnifiedAuditService,
  type UnifiedAuditSource,
} from "@xecms/application";
import type {
  ApplyRetentionRequest,
  MediaConsistencyReportDto,
  PreviewRetentionRequest,
  RetentionPlanDto,
  RetentionPolicyDto,
  UnifiedAuditEntryDto,
  UnifiedAuditListDto,
  UpdateRetentionPolicyRequest,
} from "@xecms/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export function registerOperationsRoutes(options: {
  readonly app: FastifyInstance;
  readonly audit: UnifiedAuditService;
  readonly retention: RetentionService;
  readonly authorization: AuthorizationApplicationService;
  readonly requireActor: (request: FastifyRequest, csrf: boolean) => Promise<ActorContext>;
  readonly reauthenticate: (request: FastifyRequest, actor: ActorContext, password: string) => Promise<void>;
  readonly mediaConsistency: (workspaceId: string) => Promise<MediaConsistencyReportDto>;
}): void {
  const allow = async (actor: ActorContext, action: string) => options.authorization.require(
    { realmId: actor.realmId!, subjectId: actor.subjectId },
    { action, resourceId: SYSTEM_WORKSPACE_RESOURCE_ID },
  );
  const mutationActor = async (request: FastifyRequest): Promise<ActorContext> => {
    const actor = await options.requireActor(request, true);
    if (actor.authentication !== "session") {
      throw new ApplicationError("API_KEY_ADMINISTRATION_FORBIDDEN", 403,
        "API keys cannot change retention state.");
    }
    return actor;
  };

  options.app.get("/api/audit", async (request): Promise<UnifiedAuditListDto> => {
    const actor = await options.requireActor(request, false);
    await allow(actor, "audit.read");
    const query = auditQuery(request.query, true);
    return options.audit.list({ workspaceId: actor.workspaceId, ...query });
  });
  options.app.get("/api/audit/export", async (request, reply): Promise<FastifyReply> => {
    const actor = await options.requireActor(request, false);
    await allow(actor, "audit.export");
    const query = auditQuery(request.query, false);
    const body = await options.audit.export({ workspaceId: actor.workspaceId, ...query });
    reply.type("application/x-ndjson; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="xecms-audit-${Date.now()}.ndjson"`);
    return reply.send(body);
  });
  options.app.get("/api/audit/:entryId", async (request): Promise<UnifiedAuditEntryDto> => {
    const actor = await options.requireActor(request, false);
    await allow(actor, "audit.read");
    return options.audit.get(actor.workspaceId, path(request.params, "entryId"));
  });

  options.app.get("/api/retention/policy", async (request): Promise<RetentionPolicyDto> => {
    const actor = await options.requireActor(request, false);
    await allow(actor, "retention.read");
    return options.retention.getPolicy(actor.workspaceId);
  });
  options.app.patch("/api/retention/policy", async (request): Promise<RetentionPolicyDto> => {
    const actor = await mutationActor(request);
    await allow(actor, "retention.update");
    const body = policyBody(request.body);
    await options.reauthenticate(request, actor, body.currentPassword);
    return options.retention.updatePolicy({ workspaceId: actor.workspaceId,
      expectedRevision: body.expectedRevision, auditDays: body.auditDays,
      dispatchedOutboxDays: body.dispatchedOutboxDays,
      succeededDeliveryDays: body.succeededDeliveryDays, deadDeliveryDays: body.deadDeliveryDays,
      expiredSessionDays: body.expiredSessionDays,
      softDeletedDocumentDays: body.softDeletedDocumentDays,
      actorIdentityId: actor.identityId!, actorSubjectId: actor.subjectId });
  });
  options.app.post("/api/retention/preview", async (request, reply): Promise<RetentionPlanDto> => {
    const actor = await mutationActor(request);
    await allow(actor, "retention.preview");
    const body = revisionBody(request.body) as PreviewRetentionRequest;
    const plan = await options.retention.preview({ workspaceId: actor.workspaceId,
      expectedPolicyRevision: body.expectedPolicyRevision, actorIdentityId: actor.identityId! });
    reply.code(201);
    return plan;
  });
  options.app.get("/api/retention/plans/:planId", async (request): Promise<RetentionPlanDto> => {
    const actor = await options.requireActor(request, false);
    await allow(actor, "retention.read");
    return options.retention.getPlan(actor.workspaceId, path(request.params, "planId"));
  });
  options.app.post("/api/retention/plans/:planId/apply", async (request): Promise<RetentionPlanDto> => {
    const actor = await mutationActor(request);
    await allow(actor, "retention.apply");
    const body = applyBody(request.body);
    await options.reauthenticate(request, actor, body.currentPassword);
    return options.retention.apply({ workspaceId: actor.workspaceId,
      planId: path(request.params, "planId"), expectedPolicyRevision: body.expectedPolicyRevision,
      actorIdentityId: actor.identityId!, actorSubjectId: actor.subjectId });
  });
  options.app.get("/api/media/consistency", async (request): Promise<MediaConsistencyReportDto> => {
    const actor = await options.requireActor(request, false);
    await allow(actor, "media.consistency.read");
    return options.mediaConsistency(actor.workspaceId);
  });
}

function auditQuery(value: unknown, cursorAllowed: boolean): UnifiedAuditFilter & { cursor?: string; limit?: number } {
  const query = object(value);
  const allowed = ["category", "source", "action", "actorId", "targetId", "realmId", "siteId",
    "outcome", "from", "to", ...(cursorAllowed ? ["cursor", "limit"] : [])];
  exact(query, allowed);
  const output: Record<string, unknown> = {};
  const category = optionalEnum(query["category"], ["security", "identity", "content", "schema",
    "authorization", "settings", "site", "worker", "media", "retention", "plugin"] as const, "category");
  const source = optionalEnum(query["source"], ["system", "document", "authorization", "delivery"] as const, "source");
  const outcome = optionalEnum(query["outcome"], ["succeeded", "failed", "denied", "informational"] as const, "outcome");
  if (category !== undefined) output["category"] = category as UnifiedAuditCategory;
  if (source !== undefined) output["source"] = source as UnifiedAuditSource;
  if (outcome !== undefined) output["outcome"] = outcome as UnifiedAuditOutcome;
  for (const key of ["action", "actorId", "targetId", "realmId", "siteId", "from", "to", "cursor"] as const) {
    if (query[key] !== undefined) output[key] = string(query[key], key, 1000);
  }
  if (query["limit"] !== undefined) {
    const parsed = Number(query["limit"]);
    if (!Number.isSafeInteger(parsed)) invalid("limit is invalid.");
    output["limit"] = parsed;
  }
  return output as UnifiedAuditFilter & { cursor?: string; limit?: number };
}
function policyBody(value: unknown): UpdateRetentionPolicyRequest {
  const body = object(value);
  exact(body, ["expectedRevision", "auditDays", "dispatchedOutboxDays", "succeededDeliveryDays",
    "deadDeliveryDays", "expiredSessionDays", "softDeletedDocumentDays", "currentPassword"]);
  return { expectedRevision: revision(body["expectedRevision"]), auditDays: nullableDays(body["auditDays"]),
    dispatchedOutboxDays: nullableDays(body["dispatchedOutboxDays"]),
    succeededDeliveryDays: nullableDays(body["succeededDeliveryDays"]),
    deadDeliveryDays: nullableDays(body["deadDeliveryDays"]),
    expiredSessionDays: nullableDays(body["expiredSessionDays"]),
    softDeletedDocumentDays: nullableDays(body["softDeletedDocumentDays"]),
    currentPassword: string(body["currentPassword"], "currentPassword", 1000) };
}
function revisionBody(value: unknown): PreviewRetentionRequest {
  const body = object(value); exact(body, ["expectedPolicyRevision"]);
  return { expectedPolicyRevision: revision(body["expectedPolicyRevision"]) };
}
function applyBody(value: unknown): ApplyRetentionRequest {
  const body = object(value); exact(body, ["expectedPolicyRevision", "currentPassword"]);
  return { expectedPolicyRevision: revision(body["expectedPolicyRevision"]),
    currentPassword: string(body["currentPassword"], "currentPassword", 1000) };
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Request object is invalid.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid("Request contains an unknown field.");
}
function path(value: unknown, key: string): string { return string(object(value)[key], key, 500); }
function string(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max) invalid(`${name} is invalid.`);
  return value;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid("revision is invalid.");
  return Number(value);
}
function nullableDays(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) invalid("retention days is invalid.");
  return Number(value);
}
function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${name} is invalid.`);
  return value as T;
}
function invalid(message: string): never {
  throw new ApplicationError("OPERATIONS_REQUEST_INVALID", 400, message);
}
