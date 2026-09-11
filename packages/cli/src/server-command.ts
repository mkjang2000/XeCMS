import { resolve } from "node:path";
import type { XeCmsServer } from "@xecms/server";
import type { CliIo } from "./cli.js";
import type { LoadedProject } from "./config.js";

interface ShutdownProcess {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): void;
}

export async function runServerCommand(project: LoadedProject, command: "dev" | "start", io: CliIo): Promise<number> {
  if (command === "start") process.env["NODE_ENV"] = "production";
  process.env["XECMS_DB_SCHEMA"] ??= project.config.databaseSchema;
  process.env["XECMS_MEDIA_STORAGE_ROOT"] ??= resolve(project.root, project.config.mediaStorageRoot);
  process.env["XECMS_ADMIN_DIST"] ??= resolve(project.root, project.config.adminDist);
  const { buildServer, listenServer } = await import("@xecms/server");
  const server = await buildServer();
  return waitForServerShutdown(server, listenServer, io, () => {
    io.log(`XeCMS ${command === "start" ? "production server" : "development server"} is running at http://${server.config.host}:${server.config.port}/admin/`);
  });
}

/** Resolve the CLI's top-level await after drain; a never-settled main exits 13. */
export async function waitForServerShutdown(
  server: XeCmsServer,
  listen: (server: XeCmsServer) => Promise<void>,
  io: CliIo,
  onListening: () => void,
  runtime: ShutdownProcess = process,
): Promise<number> {
  let finish!: (code: number) => void;
  const stopped = new Promise<number>(resolve => { finish = resolve; });
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      try {
        await server.close();
        finish(0);
      } catch (error: unknown) {
        io.error(`Server shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        finish(1);
        // A timed-out handler or DB connection can still hold the process open.
        // Force termination only after the lifecycle attempted every cleanup.
        runtime.exit(1);
      }
    })();
  };
  runtime.on("SIGINT", shutdown);
  runtime.on("SIGTERM", shutdown);
  try {
    const listening = listen(server).then(() => {
      if (!stopping) onListening();
      return stopped;
    });
    // A signal during startup must also terminate when listen is still pending.
    // Promise.race observes late bind errors, preventing unhandled rejections.
    return await Promise.race([listening, stopped]);
  } finally {
    runtime.removeListener("SIGINT", shutdown);
    runtime.removeListener("SIGTERM", shutdown);
  }
}
