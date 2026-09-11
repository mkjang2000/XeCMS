import type { EventWorkerService } from "@xecms/application";
import type { FastifyInstance } from "fastify";
import type { XeCmsServer } from "./server.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/** Owns only resources created by this server, including partial startup. */
export class ServerLifecycle {
  private app: FastifyInstance | undefined;
  private worker: Pick<EventWorkerService, "runOnce" | "stop"> | undefined;
  private workerTimer: NodeJS.Timeout | undefined;
  private closing: Promise<void> | undefined;

  public constructor(
    private readonly ownedDatabase: { close(): Promise<void> } | undefined,
    private readonly timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new TypeError("Server shutdown timeout must be a non-negative safe integer.");
    }
  }

  public attachApp(app: FastifyInstance): void {
    this.app = app;
    // Fastify's public close path also stops polling before callers release a
    // database supplied to buildServer (for example, integration fixtures).
    app.addHook("onClose", async () => this.stopWorker());
  }

  public attachWorker(worker: Pick<EventWorkerService, "runOnce" | "stop">): void {
    this.worker = worker;
  }

  public startWorker(pollMs: number): void {
    if (this.workerTimer !== undefined || this.closing !== undefined) return;
    const run = (): void => {
      void this.worker?.runOnce().catch((error: unknown) => {
        this.app?.log.error({ err: error }, "event worker cycle failed");
      });
    };
    this.workerTimer = setInterval(run, pollMs);
    this.workerTimer.unref();
    run();
  }

  public close(): Promise<void> {
    this.closing ??= this.releaseResources();
    return this.closing;
  }

  private async stopWorker(timeoutMs = this.timeoutMs): Promise<void> {
    if (this.workerTimer !== undefined) {
      clearInterval(this.workerTimer);
      this.workerTimer = undefined;
    }
    await this.worker?.stop(timeoutMs);
  }

  private async releaseResources(): Promise<void> {
    const errors = new Set<unknown>();
    const deadline = Date.now() + this.timeoutMs;
    const release = async (name: string, cleanup: (remainingMs: number) => Promise<unknown>): Promise<void> => {
      try {
        const remainingMs = Math.max(0, deadline - Date.now());
        await withinDeadline(() => cleanup(remainingMs), remainingMs, name);
      } catch (error: unknown) {
        errors.add(error);
      }
    };
    // A delivery may still need its DB connection to acknowledge completion.
    await release("worker", (remainingMs) => this.stopWorker(remainingMs));
    if (this.app !== undefined) await release("HTTP server", () => this.app!.close());
    if (this.ownedDatabase !== undefined) await release("database", () => this.ownedDatabase!.close());
    if (errors.size > 0) throw new AggregateError([...errors], "Server shutdown did not complete cleanly.");
  }
}

async function withinDeadline(
  cleanup: () => Promise<unknown>, timeoutMs: number, resource: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      cleanup(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out closing ${resource}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Binding failures must release the same resources as a normal shutdown. */
export async function listenServer(server: XeCmsServer): Promise<void> {
  try {
    await server.app.listen({ host: server.config.host, port: server.config.port });
  } catch (error: unknown) {
    try {
      await server.close();
    } catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "Server listen failed and cleanup was incomplete.", { cause: error });
    }
    throw error;
  }
}
