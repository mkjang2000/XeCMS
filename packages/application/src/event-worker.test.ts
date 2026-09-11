import { describe, expect, it, vi } from "vitest";

import {
  EventWorkerService,
  retryDelayMs,
  type DurableEvent,
  type EventDelivery,
  type EventDeliveryPage,
  type EventDeliveryStatus,
  type EventWorkerStore,
} from "./event-worker.js";

const event: DurableEvent = {
  specVersion: "1.0",
  id: "evt_1",
  topic: "document.created",
  workspaceId: "wrk_default",
  realmId: "rlm_system",
  aggregate: { type: "document", id: "doc_1", version: 1 },
  actor: { subjectId: "subject_owner" },
  occurredAt: "2026-07-15T00:00:00.000Z",
  payload: { collectionId: "col_posts", revision: { data: { title: "hello" } } },
};

describe("EventWorkerService", () => {
  it("fans out once, passes a stable idempotency key, and completes a delivery", async () => {
    const store = new MemoryEventWorkerStore([event]);
    const handle = vi.fn();
    const worker = service(store, handle);

    await expect(worker.runOnce()).resolves.toEqual({ fannedOut: 1, claimed: 1, succeeded: 1, failed: 0, dead: 0 });
    expect(handle).toHaveBeenCalledWith(event, {
      deliveryId: expect.stringMatching(/^delivery_/),
      idempotencyKey: "xecms:event:evt_1:handler:search",
    });
    expect((await worker.list({ page: 1, pageSize: 20 })).items[0]?.status).toBe("succeeded");
    await expect(worker.runOnce()).resolves.toMatchObject({ fannedOut: 0, claimed: 0 });
  });

  it("uses one in-flight cycle when concurrent callers request a run", async () => {
    const store = new MemoryEventWorkerStore([event]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const worker = service(store, async () => gate);

    const first = worker.runOnce();
    const second = worker.runOnce();
    expect(first).toBe(second);
    release();
    await Promise.all([first, second]);
    expect(store.claimCalls).toBe(1);
  });

  it("retries with safe errors and moves a delivery to dead at the attempt limit", async () => {
    const store = new MemoryEventWorkerStore([event]);
    const worker = service(store, async () => { throw new Error("projection failed"); }, 2);

    await expect(worker.runOnce()).resolves.toMatchObject({ failed: 1, dead: 0 });
    const pending = (await worker.list({ page: 1, pageSize: 20 })).items[0]!;
    expect(pending).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "HANDLER_FAILED" });
    store.makeAvailable(pending.id);
    await expect(worker.runOnce()).resolves.toMatchObject({ failed: 1, dead: 1 });
    const dead = await worker.get(pending.id);
    expect(dead).toMatchObject({ status: "dead", attempts: 2, lastErrorMessage: "projection failed" });

    await expect(worker.retry(dead.id)).resolves.toMatchObject({ status: "pending", attempts: 0 });
  });

  it("caps exponential retry delay at five minutes", () => {
    expect([1, 2, 3, 10, 30].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, 300_000, 300_000]);
  });

  it("drains the active handler once and leaves the remaining claims for lease recovery", async () => {
    const store = new MemoryEventWorkerStore([event, { ...event, id: "evt_2" }]);
    const entered = deferred();
    const gate = deferred();
    const handle = vi.fn(async () => { entered.resolve(); await gate.promise; });
    const worker = service(store, handle);
    const run = worker.runOnce();
    await entered.promise;

    const stopped = worker.stop();
    expect(worker.stop()).toBe(stopped);
    await expect(worker.runOnce()).rejects.toMatchObject({ code: "WORKER_STOPPED" });
    let drained = false;
    void stopped.then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    gate.resolve();
    await stopped;
    await expect(run).resolves.toMatchObject({ claimed: 2, succeeded: 1 });
    expect(handle).toHaveBeenCalledTimes(1);
    expect((await worker.list({ page: 1, pageSize: 20 })).items.map(({ status }) => status))
      .toEqual(["succeeded", "processing"]);
  });

  it("does not claim after shutdown starts during fan-out", async () => {
    const store = new MemoryEventWorkerStore([event]);
    const worker = service(store, vi.fn());
    const run = worker.runOnce();
    await worker.stop();
    await expect(run).resolves.toMatchObject({ claimed: 0 });
    expect(store.claimCalls).toBe(0);
  });

  it.each([false, true])("reports a drain deadline and ignores late handler settlement (failed=%s)", async (fail) => {
    vi.useFakeTimers();
    try {
      const store = new MemoryEventWorkerStore([event]);
      const entered = deferred();
      const gate = deferred();
      const worker = service(store, async () => {
        entered.resolve();
        await gate.promise;
        if (fail) throw new Error("late failure");
      });
      const run = worker.runOnce();
      await entered.promise;
      const stopped = worker.stop(25);
      const rejected = expect(stopped).rejects.toMatchObject({ code: "WORKER_DRAIN_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      gate.resolve();
      await run;
      expect((await worker.list({ page: 1, pageSize: 20 })).items[0]?.status).toBe("processing");
      expect(worker.stop()).toBe(stopped);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates an active store failure to the drain caller", async () => {
    const store = new MemoryEventWorkerStore([event]);
    const gate = deferred();
    const failure = new Error("database unavailable");
    vi.spyOn(store, "fanOut").mockImplementation(async () => { await gate.promise; throw failure; });
    const worker = service(store, vi.fn());
    const run = worker.runOnce();
    const stopped = worker.stop();
    const assertions = [expect(run).rejects.toBe(failure), expect(stopped).rejects.toBe(failure)];
    gate.resolve();
    await Promise.all(assertions);
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function service(store: MemoryEventWorkerStore, handle: (event: DurableEvent, context: { idempotencyKey: string; deliveryId: string }) => Promise<void> | void, maxAttempts = 8): EventWorkerService {
  let tick = 0;
  return new EventWorkerService(store, [{ id: "search", topics: ["document.created"], handle: async (event, context) => { await handle(event, context); } }], {
    workerId: "worker_a",
    now: () => new Date(Date.parse("2026-07-15T00:00:00.000Z") + tick++ * 1_000).toISOString(),
    leaseMs: 30_000,
    batchSize: 20,
    maxAttempts,
  });
}

class MemoryEventWorkerStore implements EventWorkerStore {
  private readonly events: DurableEvent[];
  private readonly deliveries = new Map<string, EventDelivery>();
  public claimCalls = 0;

  constructor(events: DurableEvent[]) { this.events = events; }

  async fanOut(handlers: readonly { id: string; topics: readonly string[] }[], now: string): Promise<number> {
    let inserted = 0;
    for (const item of this.events) for (const handler of handlers) {
      if (!handler.topics.includes(item.topic)) continue;
      const id = `delivery_${item.id}_${handler.id}`;
      if (this.deliveries.has(id)) continue;
      this.deliveries.set(id, delivery(id, item, handler.id, now));
      inserted += 1;
    }
    return inserted;
  }

  async claim(input: { workerId: string; now: string; lockedUntil: string; limit: number; maxAttempts: number }): Promise<readonly EventDelivery[]> {
    this.claimCalls += 1;
    const found = [...this.deliveries.values()].filter((item) => item.status === "pending" && item.availableAt <= input.now).slice(0, input.limit);
    return found.map((item) => {
      const claimed: EventDelivery = { ...item, status: "processing", attempts: item.attempts + 1, maxAttempts: input.maxAttempts, lockedBy: input.workerId, lockedUntil: input.lockedUntil, updatedAt: input.now };
      this.deliveries.set(item.id, claimed);
      return claimed;
    });
  }

  async succeed(input: { deliveryId: string; workerId: string; now: string }): Promise<void> {
    const item = this.required(input.deliveryId);
    const { lockedBy: _lockedBy, lockedUntil: _lockedUntil, ...unlocked } = item;
    this.deliveries.set(item.id, { ...unlocked, status: "succeeded", completedAt: input.now, updatedAt: input.now });
  }

  async fail(input: { deliveryId: string; workerId: string; now: string; nextAvailableAt: string; dead: boolean; errorCode: string; errorMessage: string }): Promise<void> {
    const item = this.required(input.deliveryId);
    const { lockedBy: _lockedBy, lockedUntil: _lockedUntil, completedAt: _completedAt, ...unlocked } = item;
    this.deliveries.set(item.id, { ...unlocked, status: input.dead ? "dead" : "pending", availableAt: input.nextAvailableAt, ...(input.dead ? { completedAt: input.now } : {}), updatedAt: input.now, lastErrorCode: input.errorCode, lastErrorMessage: input.errorMessage });
  }

  async list(input: { page: number; pageSize: number; status?: EventDeliveryStatus; topic?: string; handlerId?: string }): Promise<EventDeliveryPage> {
    const all = [...this.deliveries.values()];
    const items = all.filter((item) => (!input.status || item.status === input.status) && (!input.topic || item.topic === input.topic) && (!input.handlerId || item.handlerId === input.handlerId));
    const counts = { pending: 0, processing: 0, succeeded: 0, dead: 0 } satisfies Record<EventDeliveryStatus, number>;
    for (const item of all) counts[item.status] += 1;
    return { items: items.slice((input.page - 1) * input.pageSize, input.page * input.pageSize), page: input.page, pageSize: input.pageSize, total: items.length, counts };
  }

  async get(id: string): Promise<EventDelivery | null> { return this.deliveries.get(id) ?? null; }
  async retry(id: string, now: string): Promise<EventDelivery> {
    const item = this.required(id);
    const { lockedBy: _lockedBy, lockedUntil: _lockedUntil, completedAt: _completedAt, lastErrorCode: _lastErrorCode, lastErrorMessage: _lastErrorMessage, ...resettable } = item;
    const next: EventDelivery = { ...resettable, status: "pending", attempts: 0, availableAt: now, updatedAt: now };
    this.deliveries.set(id, next);
    return next;
  }
  makeAvailable(id: string): void {
    const item = this.required(id);
    this.deliveries.set(id, { ...item, availableAt: "2026-07-15T00:00:00.000Z" });
  }
  private required(id: string): EventDelivery { const found = this.deliveries.get(id); if (!found) throw new Error("missing delivery"); return found; }
}

function delivery(id: string, source: DurableEvent, handlerId: string, now: string): EventDelivery {
  return { id, eventId: source.id, topic: source.topic, handlerId, status: "pending", attempts: 0, maxAttempts: 8, availableAt: now, createdAt: now, updatedAt: now, event: source };
}
