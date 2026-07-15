import { PostgresDatabase } from "@xecms/database";
import { loadServerConfig } from "./config.js";

const config = loadServerConfig();
const database = new PostgresDatabase({
  connectionString: config.databaseUrl,
  schema: config.databaseSchema,
});

try {
  await database.migrate();
} finally {
  await database.close();
}
