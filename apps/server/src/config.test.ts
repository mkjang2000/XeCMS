import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.js";

describe("loadServerConfig", () => {
  it("uses the Docker Compose PostgreSQL port for local development", () => {
    const config = loadServerConfig({ NODE_ENV: "development" });
    expect(config.databaseUrl).toContain(":54320/");
  });

  it("accepts multiple Admin origins and keeps the legacy singular variable compatible", () => {
    const multiple = loadServerConfig({
      NODE_ENV: "development",
      XECMS_ADMIN_ORIGINS: "http://127.0.0.1:5173, http://localhost:5173",
    });
    expect(multiple.adminOrigins).toEqual([
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]);

    const legacy = loadServerConfig({
      NODE_ENV: "development",
      XECMS_ADMIN_ORIGIN: "http://localhost:5173",
    });
    expect(legacy.adminOrigins).toEqual(["http://localhost:5173"]);
  });

  it("keeps Content origins separate from Admin Studio origins", () => {
    const config = loadServerConfig({
      NODE_ENV: "development",
      XECMS_ADMIN_ORIGINS: "http://localhost:5173",
      XECMS_CONTENT_ORIGINS: "http://localhost:4173,https://community.example",
    });
    expect(config.adminOrigins).toEqual(["http://localhost:5173"]);
    expect(config.contentOrigins).toEqual([
      "http://localhost:4173",
      "https://community.example",
    ]);
  });

  it("configures the durable Worker and disables it by default in tests", () => {
    const testing = loadServerConfig({ NODE_ENV: "test" });
    expect(testing.workerEnabled).toBe(false);

    const configured = loadServerConfig({
      NODE_ENV: "development",
      XECMS_WORKER_ENABLED: "false",
      XECMS_WORKER_POLL_MS: "2500",
      XECMS_WORKER_BATCH_SIZE: "40",
      XECMS_WORKER_LEASE_MS: "45000",
      XECMS_WORKER_MAX_ATTEMPTS: "12",
    });
    expect(configured).toMatchObject({
      workerEnabled: false,
      workerPollMs: 2_500,
      workerBatchSize: 40,
      workerLeaseMs: 45_000,
      workerMaxAttempts: 12,
    });
  });

  it("rejects invalid Worker bounds", () => {
    expect(() => loadServerConfig({ NODE_ENV: "development", XECMS_WORKER_BATCH_SIZE: "0" }))
      .toThrow("XECMS_WORKER_BATCH_SIZE");
    expect(() => loadServerConfig({ NODE_ENV: "development", XECMS_WORKER_MAX_ATTEMPTS: "101" }))
      .toThrow("XECMS_WORKER_MAX_ATTEMPTS");
  });

  it("requires a production session secret of at least 32 bytes", () => {
    expect(() =>
      loadServerConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://unused",
        XECMS_SESSION_SECRET: "too-short",
      }),
    ).toThrow("at least 32 bytes");
  });

  it("locks production Schema by default and validates explicit Schema modes", () => {
    expect(loadServerConfig({ NODE_ENV: "production", DATABASE_URL: "postgresql://unused",
      XECMS_SESSION_SECRET: "0123456789abcdef0123456789abcdef" }).schemaMode).toBe("locked");
    expect(loadServerConfig({ NODE_ENV: "development", XECMS_SCHEMA_MODE: "manifest-only" }).schemaMode)
      .toBe("manifest-only");
    expect(() => loadServerConfig({ NODE_ENV: "development", XECMS_SCHEMA_MODE: "open" }))
      .toThrow("XECMS_SCHEMA_MODE");
  });
});
