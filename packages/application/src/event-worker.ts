import { ApplicationError } from "./errors.js";

export type EventDeliveryStatus = "pending" | "processing" | "succeeded" | "dead";

export interface DurableEvent {
  readonly specVersion: "1.0";
  readonly id: string;
  readonly topic: string;
  readonly workspaceId: string;
  readonly realmId?: string;
  readonly aggregate: {
    readonly type: "document" | "identity" | "realm" | "authorization" | "media"
      | "workspace" | "site" | "retention";
    readonly id: string;
    readonly version?: number;
  };
  readonly actor: { readonly subjectId?: string; readonly identityId?: string };
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventDelivery {
  readonly id: string;
  readonly eventId: string;
  readonly topic: string;
  readonly handlerId: string;
  readonly status: EventDeliveryStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly lockedBy?: string;
  readonly lockedUntil?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly event: DurableEvent;
}

export interface EventDeliveryPage {
  readonly items: readonly EventDelivery[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly counts: Readonly<Record<EventDeliveryStatus, number>>;
}

export interface EventHandler {
  readonly id: string;
  readonly topics: readonly string[];
  handle(event: DurableEvent, context: { readonly idempotencyKey: string; readonly deliveryId: string }): Promise<void>;
}

export interface EventWorkerStore {
  fanOut(handlers: readonly { readonly id: string; readonly topics: readonly string[] }[], now: string): Promise<number>;
  claim(input: {
    readonly workerId: string;
    readonly now: string;
    readonly lockedUntil: string;
    readonly limit: number;
    readonly maxAttempts: number;
  }): Promise<readonly EventDelivery[]>;
  succeed(input: { readonly deliveryId: string; readonly workerId: string; readonly now: string }): Promise<void>;
  fail(input: {
    readonly deliveryId: string;
    readonly workerId: string;
    readonly now: string;
    readonly nextAvailableAt: string;
    readonly dead: boolean;
    readonly errorCode: string;
    readonly errorMessage: string;
  }): Promise<void>;
  list(input: {
    readonly page: number;
    readonly pageSize: number;
    readonly status?: EventDeliveryStatus;
    readonly topic?: string;
    readonly handlerId?: string;
  }): Promise<EventDeliveryPage>;
  get(deliveryId: string): Promise<EventDelivery | null>;
  retry(deliveryId: string, now: string, actor?: {
    readonly actorSubjectId?: string; readonly actorIdentityId?: string;
  }): Promise<EventDelivery>;
}

export interface EventWorkerRuntime {
  readonly now: () => string;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly maxAttempts: number;
}

export class EventWorkerService {
  private running: Promise<EventWorkerCycleResult> | undefined;
  private stopped = false;
  private abandoned = false;
  private stopping: Promise<void> | undefined;

  public constructor(
    private readonly store: EventWorkerStore,
    private readonly handlers: readonly EventHandler[],
    private readonly runtime: EventWorkerRuntime,
  ) {
    const ids = new Set<string>();
    for (const handler of handlers) {
      if (handler.id.trim() === "" || handler.topics.length === 0) {
        throw new TypeError("Event Handler requires an id and at least one topic.");
      }
      if (ids.has(handler.id)) throw new TypeError(`Event Handler '${handler.id}' is duplicated.`);
      ids.add(handler.id);
    }
  }

  public runOnce(): Promise<EventWorkerCycleResult> {
    if (this.stopped) {
      return Promise.reject(new ApplicationError("WORKER_STOPPED", 503, "The event worker is stopping."));
    }
    this.running ??= this.executeCycle().finally(() => { this.running = undefined; });
    return this.running;
  }

  /** Stop claiming work and wait for the active delivery before releasing its store. */
  public stop(timeoutMs = 30_000): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new TypeError("Worker drain timeout must be a non-negative safe integer."));
    }
    this.stopped = true;
    const running = this.running;
    this.stopping = running === undefined ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The handler cannot be cancelled. Leave its delivery leased for retry and
        // prevent a late completion from writing to an already closed store.
        this.abandoned = true;
        reject(new ApplicationError("WORKER_DRAIN_TIMEOUT", 503, `The event worker did not drain within ${timeoutMs} ms.`));
      }, timeoutMs);
      running.then(() => {
        clearTimeout(timer);
        resolve();
      }, (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return this.stopping;
  }

  public list(input: Parameters<EventWorkerStore["list"]>[0]): Promise<EventDeliveryPage> {
    return this.store.list(input);
  }

  public async get(deliveryId: string): Promise<EventDelivery> {
    const delivery = await this.store.get(deliveryId);
    if (delivery === null) throw new ApplicationError("JOB_NOT_FOUND", 404, "The event delivery does not exist.");
    return delivery;
  }

  public retry(deliveryId: string, actor?: {
    readonly actorSubjectId?: string; readonly actorIdentityId?: string;
  }): Promise<EventDelivery> {
    return this.store.retry(deliveryId, this.runtime.now(), actor);
  }

  private async executeCycle(): Promise<EventWorkerCycleResult> {
    const now = this.runtime.now();
    const fannedOut = await this.store.fanOut(
      this.handlers.map(({ id, topics }) => ({ id, topics })),
      now,
    );
    if (this.stopped) return { fannedOut, claimed: 0, succeeded: 0, failed: 0, dead: 0 };
    const lockedUntil = new Date(Date.parse(now) + this.runtime.leaseMs).toISOString();
    const deliveries = await this.store.claim({
      workerId: this.runtime.workerId,
      now,
      lockedUntil,
      limit: this.runtime.batchSize,
      maxAttempts: this.runtime.maxAttempts,
    });
    let succeeded = 0;
    let failed = 0;
    let dead = 0;
    for (const delivery of deliveries) {
      if (this.stopped) break;
      const handler = this.handlers.find(({ id }) => id === delivery.handlerId);
      if (handler === undefined) {
        await this.recordFailure(delivery, new Error(`Handler '${delivery.handlerId}' is not registered.`));
        failed += 1;
        if (delivery.attempts >= delivery.maxAttempts) dead += 1;
        continue;
      }
      try {
        await handler.handle(delivery.event, {
          deliveryId: delivery.id,
          idempotencyKey: `xecms:event:${delivery.eventId}:handler:${handler.id}`,
        });
        if (this.abandoned) break;
        await this.store.succeed({ deliveryId: delivery.id, workerId: this.runtime.workerId, now: this.runtime.now() });
        succeeded += 1;
      } catch (error: unknown) {
        if (this.abandoned) break;
        await this.recordFailure(delivery, error);
        failed += 1;
        if (delivery.attempts >= delivery.maxAttempts) dead += 1;
      }
    }
    return { fannedOut, claimed: deliveries.length, succeeded, failed, dead };
  }

  private async recordFailure(delivery: EventDelivery, error: unknown): Promise<void> {
    const now = this.runtime.now();
    const next = new Date(Date.parse(now) + retryDelayMs(delivery.attempts)).toISOString();
    const safe = safeWorkerError(error);
    await this.store.fail({
      deliveryId: delivery.id,
      workerId: this.runtime.workerId,
      now,
      nextAvailableAt: next,
      dead: delivery.attempts >= delivery.maxAttempts,
      errorCode: safe.code,
      errorMessage: safe.message,
    });
  }
}

export interface EventWorkerCycleResult {
  readonly fannedOut: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly dead: number;
}

export function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(18, attempt - 1));
  return Math.min(1_000 * 2 ** exponent, 5 * 60_000);
}

function safeWorkerError(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof ApplicationError) {
    return { code: error.code, message: error.message.slice(0, 1_000) };
  }
  if (error instanceof Error) return { code: "HANDLER_FAILED", message: error.message.slice(0, 1_000) };
  return { code: "HANDLER_FAILED", message: "The event handler failed." };
}
