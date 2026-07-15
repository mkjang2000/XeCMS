import {
  ApplicationError,
  type AuthorizationActor,
  type AuthorizationApplicationService,
  type EventDelivery,
  type EventDeliveryStatus,
  type EventWorkerService,
} from "@xecms/application";
import type {
  EventDeliveryDto,
  EventDeliveryListDto,
  EventWorkerCycleDto,
} from "@xecms/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

export function registerJobRoutes(options: {
  readonly app: FastifyInstance;
  readonly worker: EventWorkerService;
  readonly authorization: AuthorizationApplicationService;
  readonly resourceId: string;
  readonly requireActor: (request: FastifyRequest, requireCsrf: boolean) => Promise<AuthorizationActor>;
}): void {
  const actor = async (request: FastifyRequest, mutate: boolean, action: "job.read" | "job.retry") => {
    const current = await options.requireActor(request, mutate);
    await options.authorization.require(current, { action, resourceId: options.resourceId });
    return current;
  };

  options.app.get("/api/jobs", async (request): Promise<EventDeliveryListDto> => {
    await actor(request, false, "job.read");
    const query = parseListQuery(request.query);
    const page = await options.worker.list(query);
    return { ...page, items: page.items.map(toDto) };
  });

  options.app.get("/api/jobs/:deliveryId", async (request): Promise<EventDeliveryDto> => {
    await actor(request, false, "job.read");
    return toDto(await options.worker.get(deliveryId(request.params)));
  });

  options.app.post("/api/jobs/:deliveryId/retry", async (request): Promise<EventDeliveryDto> => {
    const current = await actor(request, true, "job.retry");
    return toDto(await options.worker.retry(deliveryId(request.params), {
      actorSubjectId: current.subjectId,
    }));
  });

  options.app.post("/api/jobs/run", async (request): Promise<EventWorkerCycleDto> => {
    await actor(request, true, "job.retry");
    return options.worker.runOnce();
  });
}

function parseListQuery(value: unknown): {
  readonly page: number;
  readonly pageSize: number;
  readonly status?: EventDeliveryStatus;
  readonly topic?: string;
  readonly handlerId?: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Query must be an object.");
  const query = value as Readonly<Record<string, unknown>>;
  const unexpected = Object.keys(query).find((key) => !["page", "pageSize", "status", "topic", "handlerId"].includes(key));
  if (unexpected !== undefined) invalid(`Unexpected query '${unexpected}'.`);
  const page = integer(query["page"], 1, 1, 1_000_000, "page");
  const pageSize = integer(query["pageSize"], 25, 1, 100, "pageSize");
  const statusValue = query["status"];
  const statuses: readonly EventDeliveryStatus[] = ["pending", "processing", "succeeded", "dead"];
  if (statusValue !== undefined && (typeof statusValue !== "string" || !statuses.includes(statusValue as EventDeliveryStatus))) {
    invalid("status is invalid.");
  }
  const topic = optionalFilter(query["topic"], "topic");
  const handlerId = optionalFilter(query["handlerId"], "handlerId");
  return {
    page,
    pageSize,
    ...(statusValue === undefined ? {} : { status: statusValue as EventDeliveryStatus }),
    ...(topic === undefined ? {} : { topic }),
    ...(handlerId === undefined ? {} : { handlerId }),
  };
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < minimum || (parsed as number) > maximum) invalid(`${label} is invalid.`);
  return parsed as number;
}

function optionalFilter(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "" || value.length > 160) invalid(`${label} is invalid.`);
  return value;
}

function deliveryId(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("deliveryId is required.");
  const id = (value as Readonly<Record<string, unknown>>)["deliveryId"];
  if (typeof id !== "string" || id.length === 0 || id.length > 200) invalid("deliveryId is invalid.");
  return id;
}

function toDto(delivery: EventDelivery): EventDeliveryDto { return delivery; }

function invalid(message: string): never {
  throw new ApplicationError("JOB_REQUEST_INVALID", 400, message);
}
