import { buildServer } from "./server.js";
import { listenServer } from "./server-lifecycle.js";

const server = await buildServer();

const shutdown = async (): Promise<void> => {
  try {
    await server.close();
  } catch (error: unknown) {
    server.app.log.error({ err: error }, "server shutdown failed");
    process.exit(1);
  }
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await listenServer(server);
