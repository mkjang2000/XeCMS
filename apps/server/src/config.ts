import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ADMIN_DIST = fileURLToPath(new URL("../../admin/dist", import.meta.url));

export interface ServerConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseSchema: string;
  readonly adminOrigins: readonly string[];
  readonly contentOrigins: readonly string[];
  readonly adminDist: string;
  readonly sessionSecret: string;
  readonly secureCookies: boolean;
  readonly developmentSeed: boolean;
  readonly developmentAdminUsername: string;
  readonly developmentAdminPassword: string;
  readonly mediaStorageRoot: string;
  readonly mediaMaxUploadBytes: number;
  readonly mediaAllowedMimeTypes: readonly string[];
  readonly workerEnabled: boolean;
  readonly workerPollMs: number;
  readonly workerBatchSize: number;
  readonly workerLeaseMs: number;
  readonly workerMaxAttempts: number;
  readonly schemaMode: "editable" | "locked" | "manifest-only";
}

export function loadServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServerConfig {
  const rawNodeEnv = env["NODE_ENV"] ?? "development";
  if (rawNodeEnv !== "development" && rawNodeEnv !== "test" && rawNodeEnv !== "production") {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  const developmentSeed = parseBoolean(env["XECMS_DEV_SEED"] ?? "false", "XECMS_DEV_SEED");
  if (rawNodeEnv !== "development" && developmentSeed) {
    throw new Error("XECMS_DEV_SEED is only allowed when NODE_ENV=development.");
  }

  const sessionSecret =
    env["XECMS_SESSION_SECRET"] ??
    (rawNodeEnv === "production" ? "" : "xecms-local-development-secret-change-before-production");
  if (rawNodeEnv === "production" && Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("XECMS_SESSION_SECRET must contain at least 32 bytes in production.");
  }
  const port = Number(env["XECMS_PORT"] ?? "3100");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("XECMS_PORT must be an integer between 1 and 65535.");
  }
  const databaseUrl =
    env["DATABASE_URL"] ??
    (rawNodeEnv === "production"
      ? ""
      : "postgres://xecms:xecms@127.0.0.1:54320/xecms");
  if (databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required in production.");
  }
  const adminOrigins = normalizeOrigins(
    env["XECMS_ADMIN_ORIGINS"] ?? env["XECMS_ADMIN_ORIGIN"],
    "XECMS_ADMIN_ORIGINS",
  );
  const contentOrigins = normalizeOrigins(env["XECMS_CONTENT_ORIGINS"], "XECMS_CONTENT_ORIGINS");
  const mediaMaxUploadBytes = Number(env["XECMS_MEDIA_MAX_UPLOAD_BYTES"] ?? String(25 * 1024 * 1024));
  if (!Number.isSafeInteger(mediaMaxUploadBytes) || mediaMaxUploadBytes < 1) {
    throw new Error("XECMS_MEDIA_MAX_UPLOAD_BYTES must be a positive safe integer.");
  }
  const mediaAllowedMimeTypes = (env["XECMS_MEDIA_ALLOWED_MIME_TYPES"] ??
    "image/png,image/jpeg,image/gif,image/webp,application/pdf")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (mediaAllowedMimeTypes.length === 0) {
    throw new Error("XECMS_MEDIA_ALLOWED_MIME_TYPES must contain at least one MIME type.");
  }
  const workerEnabled = parseBoolean(
    env["XECMS_WORKER_ENABLED"] ?? (rawNodeEnv === "test" ? "false" : "true"),
    "XECMS_WORKER_ENABLED",
  );
  const workerPollMs = positiveInteger(env["XECMS_WORKER_POLL_MS"] ?? "1000", "XECMS_WORKER_POLL_MS", 60_000);
  const workerBatchSize = positiveInteger(env["XECMS_WORKER_BATCH_SIZE"] ?? "20", "XECMS_WORKER_BATCH_SIZE", 200);
  const workerLeaseMs = positiveInteger(env["XECMS_WORKER_LEASE_MS"] ?? "30000", "XECMS_WORKER_LEASE_MS", 3_600_000);
  const workerMaxAttempts = positiveInteger(env["XECMS_WORKER_MAX_ATTEMPTS"] ?? "8", "XECMS_WORKER_MAX_ATTEMPTS", 100);
  const schemaMode = env["XECMS_SCHEMA_MODE"] ?? (rawNodeEnv === "production" ? "locked" : "editable");
  if (schemaMode !== "editable" && schemaMode !== "locked" && schemaMode !== "manifest-only") {
    throw new Error("XECMS_SCHEMA_MODE must be editable, locked, or manifest-only.");
  }
  return {
    nodeEnv: rawNodeEnv,
    host: env["XECMS_HOST"] ?? "127.0.0.1",
    port,
    databaseUrl,
    databaseSchema: env["XECMS_DB_SCHEMA"] ?? "xecms",
    adminOrigins,
    contentOrigins,
    adminDist:
      env["XECMS_ADMIN_DIST"] === undefined
        ? DEFAULT_ADMIN_DIST
        : resolve(env["XECMS_ADMIN_DIST"]),
    sessionSecret,
    secureCookies: rawNodeEnv === "production",
    developmentSeed,
    developmentAdminUsername: env["XECMS_DEV_ADMIN_USERNAME"] ?? "admin",
    developmentAdminPassword: env["XECMS_DEV_ADMIN_PASSWORD"] ?? "admin",
    mediaStorageRoot: resolve(env["XECMS_MEDIA_STORAGE_ROOT"] ?? ".xecms/media"),
    mediaMaxUploadBytes,
    mediaAllowedMimeTypes: Object.freeze(mediaAllowedMimeTypes),
    workerEnabled,
    workerPollMs,
    workerBatchSize,
    workerLeaseMs,
    workerMaxAttempts,
    schemaMode,
  };
}

function positiveInteger(value: string, name: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseBoolean(value: string, name: string): boolean {
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0.`);
}

function normalizeOrigins(value: string | undefined, variableName: string): readonly string[] {
  if (value === undefined || value.trim().length === 0) return [];

  const origins = value.split(",").map((entry) => {
    const rawOrigin = entry.trim();
    if (rawOrigin.length === 0) {
      throw new Error(`${variableName} cannot contain an empty origin.`);
    }
    const url = new URL(rawOrigin);
    if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
      throw new Error(`${variableName} must contain only URL origins.`);
    }
    return url.origin;
  });
  return Object.freeze([...new Set(origins)]);
}
