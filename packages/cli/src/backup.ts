import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { PostgresDatabase, qualifiedName, quoteIdentifier } from "@xecms/database";
import { cliError, type LoadedProject } from "./config.js";

const CURRENT_XECMS_VERSION = "0.4.1";
const DATABASE_ARTIFACT = "database.dump";
const MEDIA_ARTIFACT = "media.tar.gz";
const SHA256 = /^[a-f0-9]{64}$/;

export interface BackupManifest {
  readonly format: "xecms.backup";
  readonly formatVersion: 1;
  readonly xecmsVersion: string;
  readonly createdAt: string;
  readonly databaseSchema: string;
  readonly activeSchemaHash: string | null;
  readonly database: { readonly file: typeof DATABASE_ARTIFACT; readonly sha256: string };
  readonly media: { readonly file: typeof MEDIA_ARTIFACT; readonly sha256: string };
}

export async function createBackup(project: LoadedProject, directory: string): Promise<BackupManifest> {
  const destination = resolve(project.root, directory);
  await assertDestinationAvailable(destination);
  const staging = await mkdtemp(resolve(dirname(destination), `.xecms-backup-${process.pid}-`));
  try {
    const dump = resolve(staging, DATABASE_ARTIFACT);
    const media = resolve(staging, MEDIA_ARTIFACT);
    await runToFile(command("XECMS_PG_DUMP_COMMAND_JSON", "pg_dump"), [
      "--format=custom", "--no-owner", "--no-privileges",
      `--schema=${project.config.databaseSchema}`,
      process.env["XECMS_BACKUP_DATABASE_URL"] ?? project.databaseUrl,
    ], dump, project.root);
    const mediaRoot = resolve(project.root, project.config.mediaStorageRoot);
    const empty = await mkdtemp(resolve(tmpdir(), "xecms-empty-media-"));
    try {
      let source = mediaRoot;
      try { await access(mediaRoot); } catch { source = empty; }
      await run(command("XECMS_TAR_COMMAND_JSON", "tar"), [
        "--create", "--gzip", `--file=${media}`, "--directory", source, ".",
      ], "inherit", project.root);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
    const database = new PostgresDatabase({
      connectionString: project.databaseUrl,
      schema: project.config.databaseSchema,
      maxConnections: 2,
    });
    let activeSchemaHash: string | null = null;
    try {
      const state = qualifiedName(database.schema, "_xecms_schema_state");
      const revisions = qualifiedName(database.schema, "_xecms_schema_revisions");
      const result = await database.pool.query<{ hash: string }>(
        `SELECT revision.hash FROM ${state} state
          JOIN ${revisions} revision ON revision.revision_id = state.active_revision_id
         WHERE state.singleton = true`,
      );
      activeSchemaHash = result.rows[0]?.hash ?? null;
    } finally {
      await database.close();
    }
    const manifest: BackupManifest = {
      format: "xecms.backup",
      formatVersion: 1,
      xecmsVersion: CURRENT_XECMS_VERSION,
      createdAt: new Date().toISOString(),
      databaseSchema: project.config.databaseSchema,
      activeSchemaHash,
      database: { file: DATABASE_ARTIFACT, sha256: await fileHash(dump) },
      media: { file: MEDIA_ARTIFACT, sha256: await fileHash(media) },
    };
    await writeFile(resolve(staging, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(staging, destination);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreBackup(project: LoadedProject, directory: string,
  confirmEmpty: boolean): Promise<BackupManifest> {
  if (!confirmEmpty) {
    throw cliError("RESTORE_CONFIRMATION_REQUIRED", "Restore requires --confirm-empty.");
  }
  const source = resolve(project.root, directory);
  const manifest = await readManifest(resolve(source, "backup-manifest.json"));
  assertCompatibleVersion(manifest.xecmsVersion);
  if (manifest.databaseSchema !== project.config.databaseSchema) {
    throw cliError("BACKUP_SCHEMA_MISMATCH",
      `Backup schema '${manifest.databaseSchema}' does not match target '${project.config.databaseSchema}'.`);
  }
  const dump = resolve(source, DATABASE_ARTIFACT);
  const archive = resolve(source, MEDIA_ARTIFACT);
  if (await fileHash(dump) !== manifest.database.sha256
    || await fileHash(archive) !== manifest.media.sha256) {
    throw cliError("BACKUP_CHECKSUM_MISMATCH", "Backup artifact checksum validation failed.");
  }
  await assertSafeArchive(archive, project.root);

  const database = new PostgresDatabase({
    connectionString: project.databaseUrl,
    schema: project.config.databaseSchema,
    maxConnections: 2,
  });
  const mediaRoot = resolve(project.root, project.config.mediaStorageRoot);
  const staging = resolve(dirname(mediaRoot), `.restore-${randomUUID()}`);
  let mediaPromoted = false;
  try {
    const exists = await database.pool.query<{ exists: boolean }>(
      "SELECT to_regnamespace($1) IS NOT NULL exists", [project.config.databaseSchema],
    );
    if (exists.rows[0]!.exists) {
      throw cliError("RESTORE_TARGET_NOT_EMPTY",
        `Target schema '${project.config.databaseSchema}' already exists.`);
    }
    try {
      if ((await readdir(mediaRoot)).length > 0) {
        throw cliError("RESTORE_MEDIA_NOT_EMPTY", `Target media directory '${mediaRoot}' is not empty.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(staging, { recursive: true });
    await runFromFile(command("XECMS_PG_RESTORE_COMMAND_JSON", "pg_restore"), [
      "--exit-on-error", "--no-owner", "--no-privileges",
      `--dbname=${process.env["XECMS_RESTORE_DATABASE_URL"] ?? project.databaseUrl}`,
    ], dump, project.root);
    await run(command("XECMS_TAR_COMMAND_JSON", "tar"), [
      "--extract", "--gzip", `--file=${archive}`, "--directory", staging,
      "--no-same-owner", "--no-same-permissions",
    ], "inherit", project.root);
    await mkdir(dirname(mediaRoot), { recursive: true });
    await rm(mediaRoot, { recursive: true, force: true });
    await rename(staging, mediaRoot);
    mediaPromoted = true;
    const migrations = await database.pool.query(
      `SELECT 1 FROM ${qualifiedName(project.config.databaseSchema, "_xecms_core_migrations")} LIMIT 1`,
    );
    if (migrations.rowCount !== 1) {
      throw cliError("RESTORE_INTEGRITY_FAILED", "Restored migration history is missing.");
    }
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (mediaPromoted) await rm(mediaRoot, { recursive: true, force: true });
    if ((error as { code?: string }).code !== "RESTORE_TARGET_NOT_EMPTY") {
      await database.pool.query(
        `DROP SCHEMA IF EXISTS ${quoteIdentifier(project.config.databaseSchema)} CASCADE`,
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    await database.close();
  }
}

async function readManifest(file: string): Promise<BackupManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw cliError("BACKUP_MANIFEST_INVALID", "Backup manifest is not valid JSON.");
  }
  if (!isRecord(value)) {
    throw cliError("BACKUP_MANIFEST_INVALID", "Backup manifest must be an object.");
  }
  if (value["format"] !== "xecms.backup" || value["formatVersion"] !== 1) {
    throw cliError("BACKUP_FORMAT_UNSUPPORTED", "Backup format is unsupported.");
  }
  const database = value["database"];
  const media = value["media"];
  const activeSchemaHash = value["activeSchemaHash"];
  if (typeof value["xecmsVersion"] !== "string"
    || typeof value["createdAt"] !== "string" || !Number.isFinite(Date.parse(value["createdAt"]))
    || typeof value["databaseSchema"] !== "string" || value["databaseSchema"].length === 0
    || (activeSchemaHash !== null && (typeof activeSchemaHash !== "string" || !SHA256.test(activeSchemaHash)))
    || !isRecord(database) || database["file"] !== DATABASE_ARTIFACT
    || typeof database["sha256"] !== "string" || !SHA256.test(database["sha256"])
    || !isRecord(media) || media["file"] !== MEDIA_ARTIFACT
    || typeof media["sha256"] !== "string" || !SHA256.test(media["sha256"])) {
    throw cliError("BACKUP_MANIFEST_INVALID", "Backup manifest fields are invalid.");
  }
  return value as unknown as BackupManifest;
}

function assertCompatibleVersion(version: string): void {
  const backup = parseVersion(version);
  const current = parseVersion(CURRENT_XECMS_VERSION)!;
  if (backup === null || backup.major !== current.major || backup.minor !== current.minor
    || backup.patch > current.patch) {
    throw cliError("BACKUP_VERSION_UNSUPPORTED",
      `Backup XeCMS version '${version}' is not supported by ${CURRENT_XECMS_VERSION}.`);
  }
}

function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? null : {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
  };
}

async function assertSafeArchive(archive: string, cwd: string): Promise<void> {
  const tar = command("XECMS_TAR_COMMAND_JSON", "tar");
  const common = ["--list", "--gzip", `--file=${archive}`, "--quoting-style=escape"];
  const listing = await capture(tar, common, cwd);
  for (const entry of listing.split("\n").filter(Boolean)) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw cliError("BACKUP_ARCHIVE_UNSAFE", `Unsafe media archive entry '${entry}'.`);
    }
  }
  const verbose = await capture(tar, [...common, "--verbose"], cwd);
  for (const entry of verbose.split("\n").filter(Boolean)) {
    const type = entry[0];
    if (type !== "-" && type !== "d") {
      throw cliError("BACKUP_ARCHIVE_UNSAFE",
        `Unsupported media archive entry type '${type ?? "unknown"}'.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertDestinationAvailable(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (info.isDirectory() && (await readdir(path)).length === 0) {
      await rm(path, { recursive: true });
      return;
    }
    throw cliError("BACKUP_DESTINATION_EXISTS", `Backup destination '${path}' is not empty.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
}

function command(variable: string, fallback: string): readonly string[] {
  const raw = process.env[variable];
  if (!raw) return [fallback];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0
    || parsed.some((value) => typeof value !== "string" || value.length === 0)) {
    throw cliError("COMMAND_CONFIG_INVALID", `${variable} must be a JSON string array.`);
  }
  return parsed as string[];
}

async function run(parts: readonly string[], args: readonly string[],
  stdio: "pipe" | "inherit" = "inherit", cwd = process.cwd()): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(parts[0]!, [...parts.slice(1), ...args], { stdio, cwd });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise()
      : reject(cliError("EXTERNAL_COMMAND_FAILED", `${parts[0]} failed (${signal ?? code}).`)));
  });
}

async function runToFile(parts: readonly string[], args: readonly string[], file: string,
  cwd = process.cwd()): Promise<void> {
  const output = createWriteStream(file, { flags: "wx" });
  const child = spawn(parts[0]!, [...parts.slice(1), ...args], {
    stdio: ["ignore", "pipe", "inherit"], cwd,
  });
  await Promise.all([pipeline(child.stdout!, output), completed(child, parts[0]!)]);
}

async function runFromFile(parts: readonly string[], args: readonly string[], file: string,
  cwd = process.cwd()): Promise<void> {
  const child = spawn(parts[0]!, [...parts.slice(1), ...args], {
    stdio: ["pipe", "inherit", "inherit"], cwd,
  });
  await Promise.all([pipeline(createReadStream(file), child.stdin!), completed(child, parts[0]!)]);
}

async function capture(parts: readonly string[], args: readonly string[],
  cwd = process.cwd()): Promise<string> {
  const child = spawn(parts[0]!, [...parts.slice(1), ...args], {
    stdio: ["ignore", "pipe", "inherit"], cwd,
  });
  const chunks: Buffer[] = [];
  child.stdout!.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await completed(child, parts[0]!);
  return Buffer.concat(chunks).toString("utf8");
}

function completed(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise()
      : reject(cliError("EXTERNAL_COMMAND_FAILED", `${name} failed (${signal ?? code}).`)));
  });
}

async function fileHash(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}
