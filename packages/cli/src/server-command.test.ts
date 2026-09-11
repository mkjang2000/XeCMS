import { EventEmitter } from "node:events";
import type { XeCmsServer } from "@xecms/server";
import { describe, expect, it, vi } from "vitest";
import { waitForServerShutdown } from "./server-command.js";

function fixture() {
  const runtime = Object.assign(new EventEmitter(), { exit: vi.fn() });
  const server = { close: vi.fn(async () => undefined) } as unknown as XeCmsServer;
  const io = { log: vi.fn(), error: vi.fn() };
  return { runtime, server, io, onListening: vi.fn() };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function expectDetached(runtime: EventEmitter) {
  expect(runtime.listenerCount("SIGINT")).toBe(0);
  expect(runtime.listenerCount("SIGTERM")).toBe(0);
}

describe("CLI server command shutdown", () => {
  it("settles main with exit code zero only after drain and handles repeated signals once", async () => {
    const { runtime, server, io, onListening } = fixture();
    const drain = deferred();
    vi.mocked(server.close).mockReturnValue(drain.promise);
    const running = waitForServerShutdown(server, async () => undefined, io, onListening, runtime);
    await Promise.resolve();
    expect(onListening).toHaveBeenCalledOnce();
    runtime.emit("SIGINT");
    runtime.emit("SIGINT");
    runtime.emit("SIGTERM");
    expect(server.close).toHaveBeenCalledOnce();
    let ended = false;
    void running.then(() => { ended = true; });
    await Promise.resolve();
    expect(ended).toBe(false);
    drain.resolve();
    await expect(running).resolves.toBe(0);
    expect(runtime.exit).not.toHaveBeenCalled();
    expectDetached(runtime);
  });

  it("handles a signal while listen is pending and observes late listen failure", async () => {
    const { runtime, server, io, onListening } = fixture();
    const bind = deferred();
    const running = waitForServerShutdown(server, () => bind.promise, io, onListening, runtime);
    runtime.emit("SIGTERM");
    await expect(running).resolves.toBe(0);
    bind.reject(new Error("listen interrupted by close"));
    await Promise.resolve();
    expect(onListening).not.toHaveBeenCalled();
    expect(server.close).toHaveBeenCalledOnce();
    expectDetached(runtime);
  });

  it("does not announce a late successful bind after shutdown was requested", async () => {
    const { runtime, server, io, onListening } = fixture();
    const bind = deferred();
    const running = waitForServerShutdown(server, () => bind.promise, io, onListening, runtime);
    runtime.emit("SIGTERM");
    bind.resolve();
    await expect(running).resolves.toBe(0);
    expect(onListening).not.toHaveBeenCalled();
    expectDetached(runtime);
  });

  it("propagates listen failure and removes both signal listeners", async () => {
    const { runtime, server, io, onListening } = fixture();
    const failure = new Error("address already in use");
    // Production listenServer performs cleanup before rejecting this promise.
    const running = waitForServerShutdown(server, async () => { throw failure; }, io, onListening, runtime);
    await expect(running).rejects.toBe(failure);
    runtime.emit("SIGTERM");
    expect(server.close).not.toHaveBeenCalled();
    expect(onListening).not.toHaveBeenCalled();
    expectDetached(runtime);
  });

  it("reports failed drain once and forces nonzero exit even while listen is pending", async () => {
    const { runtime, server, io, onListening } = fixture();
    vi.mocked(server.close).mockRejectedValue(new Error("shutdown deadline exceeded"));
    const running = waitForServerShutdown(server, () => new Promise(() => undefined), io, onListening, runtime);
    runtime.emit("SIGTERM");
    runtime.emit("SIGINT");
    await expect(running).resolves.toBe(1);
    expect(server.close).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(io.error).toHaveBeenCalledWith("Server shutdown failed: shutdown deadline exceeded");
    expectDetached(runtime);
  });
});
