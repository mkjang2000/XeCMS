import { buildServer } from "./server.js";

const server = await buildServer();

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.app.listen({ host: server.config.host, port: server.config.port });
