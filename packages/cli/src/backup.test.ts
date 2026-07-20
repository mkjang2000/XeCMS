import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import type { LoadedProject } from "./config.js";
import { restoreBackup } from "./backup.js";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("backup restore input validation", () => {
  it("rejects artifact paths outside the backup directory before reading them", async () => {
    const { project, backup } = await fixture();
    const outsideDump = resolve(project.root, "outside.dump");
    await writeFile(outsideDump, "outside backup data");
    await writeManifest(backup, {
      ...baseManifest(project, await sha256(outsideDump), await sha256(resolve(backup, "media.tar.gz"))),
      database: { file: "../../outside.dump", sha256: await sha256(outsideDump) },
    });

    await expect(restoreBackup(project, backup, true)).rejects.toMatchObject({
      code: "BACKUP_MANIFEST_INVALID",
    });
  });

  it("rejects media archives containing symbolic links before extraction", async () => {
    const { project, backup } = await fixture({ symlinkArchive: true });
    await writeManifest(backup, baseManifest(project,
      await sha256(resolve(backup, "database.dump")),
      await sha256(resolve(backup, "media.tar.gz"))));

    await expect(restoreBackup(project, backup, true)).rejects.toMatchObject({
      code: "BACKUP_ARCHIVE_UNSAFE",
    });
  });

  it("rejects media archives containing hard links before extraction", async () => {
    const { project, backup } = await fixture({ hardlinkArchive: true });
    await writeManifest(backup, baseManifest(project,
      await sha256(resolve(backup, "database.dump")),
      await sha256(resolve(backup, "media.tar.gz"))));

    await expect(restoreBackup(project, backup, true)).rejects.toMatchObject({
      code: "BACKUP_ARCHIVE_UNSAFE",
    });
  });

  it("rejects backups from a future XeCMS release before touching the target", async () => {
    const { project, backup } = await fixture();
    await writeManifest(backup, {
      ...baseManifest(project, await sha256(resolve(backup, "database.dump")),
        await sha256(resolve(backup, "media.tar.gz"))),
      xecmsVersion: "0.5.1",
    });

    await expect(restoreBackup(project, backup, true)).rejects.toMatchObject({
      code: "BACKUP_VERSION_UNSUPPORTED",
    });
  });
});

async function fixture(options: { symlinkArchive?: boolean; hardlinkArchive?: boolean } = {}): Promise<{
  project: LoadedProject; backup: string;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "xecms-backup-validation-"));
  roots.push(root);
  const projectRoot = resolve(root, "project");
  const backup = resolve(projectRoot, "backups", "fixture");
  const mediaSource = resolve(root, "media-source");
  await mkdir(backup, { recursive: true });
  await mkdir(mediaSource, { recursive: true });
  await writeFile(resolve(backup, "database.dump"), "not reached by validation tests");
  if (options.symlinkArchive) {
    const outside = resolve(root, "outside.txt");
    await writeFile(outside, "must not be linked by restore");
    await symlink(outside, resolve(mediaSource, "escape"));
  } else if (options.hardlinkArchive) {
    const original = resolve(mediaSource, "original.txt");
    await writeFile(original, "hard link payload");
    await link(original, resolve(mediaSource, "duplicate.txt"));
  } else {
    await writeFile(resolve(mediaSource, "safe.txt"), "safe media");
  }
  await run("tar", ["-czf", resolve(backup, "media.tar.gz"), "-C", mediaSource, "."]);
  return {
    backup,
    project: {
      root: projectRoot,
      databaseUrl: "postgresql://xecms:xecms@127.0.0.1:1/unreachable",
      config: {
        projectName: "backup-validation",
        starter: "minimal",
        databaseSchema: "xecms_backup_validation",
        schemaFile: "xecms.schema.json",
        typesFile: "xecms.generated.ts",
        mediaStorageRoot: ".xecms/media",
        adminDist: "apps/admin/dist",
      },
    },
  };
}

function baseManifest(project: LoadedProject, databaseHash: string, mediaHash: string) {
  return {
    format: "xecms.backup",
    formatVersion: 1,
    xecmsVersion: "0.5.0",
    createdAt: "2026-07-16T00:00:00.000Z",
    databaseSchema: project.config.databaseSchema,
    activeSchemaHash: null,
    database: { file: "database.dump", sha256: databaseHash },
    media: { file: "media.tar.gz", sha256: mediaHash },
  };
}

async function writeManifest(directory: string, manifest: unknown): Promise<void> {
  await writeFile(resolve(directory, "backup-manifest.json"), JSON.stringify(manifest));
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function run(command: string, args: string[]): Promise<void> {
  await mkdir(dirname(args[1]!), { recursive: true });
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} failed`)));
  });
}
