import { PostgresDatabase } from "@xecms/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerConfig } from "./config.js";
import { buildServer } from "./server.js";

afterEach(() => vi.restoreAllMocks());

const config = loadServerConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
  XECMS_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
});

describe("server startup resource ownership", () => {
  it("closes its database when migrations fail before routes are assembled", async () => {
    const failure = new Error("migration failed");
    vi.spyOn(PostgresDatabase.prototype, "migrate").mockRejectedValue(failure);
    const close = vi.spyOn(PostgresDatabase.prototype, "close").mockResolvedValue();
    await expect(buildServer({ config })).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("leaves a caller-supplied database open after startup fails", async () => {
    const failure = new Error("migration failed");
    vi.spyOn(PostgresDatabase.prototype, "migrate").mockRejectedValue(failure);
    const close = vi.spyOn(PostgresDatabase.prototype, "close").mockResolvedValue();
    const database = new PostgresDatabase({ connectionString: config.databaseUrl, schema: config.databaseSchema });
    await expect(buildServer({ config, database })).rejects.toBe(failure);
    expect(close).not.toHaveBeenCalled();
  });

  it("preserves the startup error when database cleanup also fails", async () => {
    const failure = new Error("migration failed");
    const cleanupFailure = new Error("connection cleanup failed");
    vi.spyOn(PostgresDatabase.prototype, "migrate").mockRejectedValue(failure);
    vi.spyOn(PostgresDatabase.prototype, "close").mockRejectedValue(cleanupFailure);
    await expect(buildServer({ config })).rejects.toMatchObject({ cause: failure });
  });
});
