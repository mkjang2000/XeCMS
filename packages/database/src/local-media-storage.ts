import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  lstat,
  link,
  mkdir,
  open,
  opendir,
  realpath,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  ApplicationError,
  type MediaStorage,
  type MediaStorageWriteResult,
} from "@xecms/application";

const storageSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class LocalMediaStorage implements MediaStorage {
  readonly #configuredRoot: string;
  #rootPromise: Promise<string> | undefined;

  public constructor(rootDirectory: string) {
    if (typeof rootDirectory !== "string" || rootDirectory.trim().length === 0) {
      throw new TypeError("Media storage root cannot be empty.");
    }
    this.#configuredRoot = resolve(rootDirectory);
  }

  public async write(input: {
    readonly storageKey: string;
    readonly stream: AsyncIterable<Uint8Array>;
    readonly maxBytes: number;
  }): Promise<MediaStorageWriteResult> {
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) {
      throw new TypeError("maxBytes must be a positive safe integer.");
    }
    const target = await this.resolveKey(input.storageKey, true);
    const parent = dirname(target);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await this.assertRealDirectoryInsideRoot(parent);
    const temporary = resolve(parent, `.upload-${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    let closed = false;
    try {
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of input.stream) {
        if (!(chunk instanceof Uint8Array)) {
          throw new ApplicationError("MEDIA_STREAM_INVALID", 422, "Media chunks must be Uint8Array values.");
        }
        if (size + chunk.byteLength > input.maxBytes) {
          throw new ApplicationError(
            "MEDIA_SIZE_LIMIT_EXCEEDED",
            413,
            `Media exceeds the ${input.maxBytes} byte upload limit.`,
          );
        }
        if (chunk.byteLength > 0) {
          await handle.write(chunk);
          hash.update(chunk);
          size += chunk.byteLength;
        }
      }
      await handle.sync();
      await handle.close();
      closed = true;
      try {
        // Hard-link promotion is atomic and, unlike rename, never overwrites.
        await link(temporary, target);
      } catch (error) {
        if (nodeErrorCode(error) === "EEXIST") {
          throw new ApplicationError(
            "MEDIA_STORAGE_KEY_CONFLICT",
            409,
            `Storage key '${input.storageKey}' already exists.`,
          );
        }
        throw error;
      }
      return { size, sha256: hash.digest("hex") };
    } finally {
      if (!closed) await handle.close().catch(() => undefined);
      await unlink(temporary).catch((error: unknown) => {
        if (nodeErrorCode(error) !== "ENOENT") throw error;
      });
    }
  }

  public async open(storageKey: string): Promise<AsyncIterable<Uint8Array>> {
    const path = await this.resolveKey(storageKey, false);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: unknown) => {
      if (nodeErrorCode(error) === "ENOENT") {
        throw new ApplicationError("MEDIA_FILE_MISSING", 404, `Storage key '${storageKey}' was not found.`);
      }
      if (nodeErrorCode(error) === "ELOOP") unsafePath(storageKey);
      throw error;
    });
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      throw new ApplicationError("MEDIA_STORAGE_OBJECT_INVALID", 500, "Media storage object is not a file.");
    }
    return handle.createReadStream({ autoClose: true });
  }

  public async exists(storageKey: string): Promise<boolean> {
    const path = await this.resolveKey(storageKey, false);
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) unsafePath(storageKey);
      return stats.isFile();
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  public async delete(storageKey: string): Promise<void> {
    const path = await this.resolveKey(storageKey, false);
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) unsafePath(storageKey);
      if (!stats.isFile()) {
        throw new ApplicationError("MEDIA_STORAGE_OBJECT_INVALID", 500, "Media storage object is not a file.");
      }
      await unlink(path);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return;
      throw error;
    }
  }

  public async listKeys(): Promise<readonly string[]> {
    const root = await this.root();
    const keys: string[] = [];
    await visit(root, "", keys);
    return keys.sort();
  }

  private async root(): Promise<string> {
    this.#rootPromise ??= (async () => {
      await mkdir(this.#configuredRoot, { recursive: true, mode: 0o700 });
      return realpath(this.#configuredRoot);
    })();
    return this.#rootPromise;
  }

  private async resolveKey(storageKey: string, parentMayNotExist: boolean): Promise<string> {
    validateStorageKey(storageKey);
    const root = await this.root();
    const path = resolve(root, ...storageKey.split("/"));
    assertInside(root, path, storageKey);
    if (!parentMayNotExist) {
      await this.assertExistingAncestorsInsideRoot(dirname(path), root, storageKey);
    }
    return path;
  }

  private async assertRealDirectoryInsideRoot(directory: string): Promise<void> {
    const root = await this.root();
    const actual = await realpath(directory);
    assertInside(root, actual, directory, true);
  }

  private async assertExistingAncestorsInsideRoot(
    directory: string,
    root: string,
    storageKey: string,
  ): Promise<void> {
    try {
      const actual = await realpath(directory);
      assertInside(root, actual, storageKey, true);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return;
      throw error;
    }
  }
}

export function validateStorageKey(storageKey: string): void {
  if (typeof storageKey !== "string" || storageKey.length === 0 || storageKey.length > 1_024 ||
    isAbsolute(storageKey) || storageKey.includes("\\")) {
    unsafePath(storageKey);
  }
  const segments = storageKey.split("/");
  if (segments.length === 0 || segments.some((segment) =>
    segment === "." || segment === ".." || !storageSegmentPattern.test(segment))) {
    unsafePath(storageKey);
  }
}

async function visit(directory: string, prefix: string, output: string[]): Promise<void> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const key = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path, key, output);
    else if (entry.isFile() && !entry.name.startsWith(".upload-")) output.push(key);
  }
}

function assertInside(root: string, path: string, storageKey: string, allowRoot = false): void {
  const child = relative(root, path);
  if ((!allowRoot && child === "") || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    unsafePath(storageKey);
  }
}

function unsafePath(storageKey: string): never {
  throw new ApplicationError(
    "MEDIA_STORAGE_PATH_INVALID",
    422,
    `Storage key '${storageKey}' is not a safe relative path.`,
  );
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" ? error.code : undefined;
}
