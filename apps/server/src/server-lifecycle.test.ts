import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerLifecycle, listenServer } from "./server-lifecycle.js";
import type { XeCmsServer } from "./server.js";

afterEach(() => vi.useRealTimers());

describe("server resource lifecycle", () => {
  it("waits for worker acknowledgement before closing HTTP and its owned database exactly once", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const database = { close: vi.fn(async () => { order.push("database"); }) };
    const lifecycle = new ServerLifecycle(database);
    const app = Fastify();
    lifecycle.attachApp(app);
    app.addHook("onClose", async () => { order.push("HTTP"); });
    const worker = {
      runOnce: vi.fn(),
      stop: vi.fn(async () => { await gate; }),
    };
    lifecycle.attachWorker(worker);
    const first = lifecycle.close();
    expect(lifecycle.close()).toBe(first);
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await first;
    expect(order).toEqual(["HTTP", "database"]);
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("releases the database when worker drain and HTTP cleanup fail", async () => {
    const database = { close: vi.fn(async () => {}) };
    const lifecycle = new ServerLifecycle(database);
    const app = Fastify();
    lifecycle.attachApp(app);
    lifecycle.attachWorker({ runOnce: vi.fn(), stop: vi.fn(async () => { throw new Error("worker failed"); }) });
    await expect(lifecycle.close()).rejects.toBeInstanceOf(AggregateError);
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("stops polling when callers close Fastify directly", async () => {
    vi.useFakeTimers();
    const lifecycle = new ServerLifecycle(undefined);
    const app = Fastify();
    lifecycle.attachApp(app);
    const worker = { runOnce: vi.fn(async () => ({ fannedOut: 0, claimed: 0, succeeded: 0, failed: 0, dead: 0 })), stop: vi.fn(async () => {}) };
    lifecycle.attachWorker(worker);
    lifecycle.startWorker(10);
    await app.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(worker.runOnce).toHaveBeenCalledTimes(1);
    expect(worker.stop).toHaveBeenCalledOnce();
  });

  it("still attempts all owned cleanup when a resource exceeds the shutdown deadline", async () => {
    vi.useFakeTimers();
    const database = { close: vi.fn(async () => {}) };
    const lifecycle = new ServerLifecycle(database, 20);
    lifecycle.attachWorker({ runOnce: vi.fn(), stop: vi.fn(() => new Promise<void>(() => {})) });
    const closed = expect(lifecycle.close()).rejects.toBeInstanceOf(AggregateError);
    await vi.advanceTimersByTimeAsync(20);
    await closed;
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("cleans up a partially assembled server before it has an HTTP app", async () => {
    const database = { close: vi.fn(async () => {}) };
    const lifecycle = new ServerLifecycle(database);
    await lifecycle.close();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("closes on listen failure while preserving the original binding error", async () => {
    const failure = new Error("address in use");
    const server = {
      app: { listen: vi.fn(async () => { throw failure; }) },
      config: { host: "127.0.0.1", port: 3000 },
      close: vi.fn(async () => {}),
    } as unknown as XeCmsServer;
    await expect(listenServer(server)).rejects.toBe(failure);
    expect(server.close).toHaveBeenCalledOnce();
  });

  it("retains both binding and cleanup failures", async () => {
    const failure = new Error("address in use");
    const cleanupFailure = new Error("database close failed");
    const server = {
      app: { listen: vi.fn(async () => { throw failure; }) },
      config: { host: "127.0.0.1", port: 3000 },
      close: vi.fn(async () => { throw cleanupFailure; }),
    } as unknown as XeCmsServer;
    await expect(listenServer(server)).rejects.toMatchObject({ cause: failure, errors: [failure, cleanupFailure] });
  });
});
