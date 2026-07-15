import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMediaStorage } from "./local-media-storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "xecms-media-"));
  temporaryDirectories.push(path);
  return path;
}

function chunks(...values: readonly number[][]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const value of values) yield Uint8Array.from(value);
  })();
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const values: Uint8Array[] = [];
  for await (const chunk of stream) values.push(chunk);
  return Uint8Array.from(Buffer.concat(values));
}

describe("LocalMediaStorage", () => {
  it("atomically streams bytes, hashes them, lists them, and never overwrites", async () => {
    const storage = new LocalMediaStorage(await root());
    const result = await storage.write({
      storageKey: "objects/media_1",
      stream: chunks([1, 2], [3, 4]),
      maxBytes: 4,
    });

    expect(result).toEqual({
      size: 4,
      sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    });
    expect(await readAll(await storage.open("objects/media_1"))).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(await storage.listKeys()).toEqual(["objects/media_1"]);
    await expect(storage.write({
      storageKey: "objects/media_1",
      stream: chunks([9]),
      maxBytes: 4,
    })).rejects.toMatchObject({ code: "MEDIA_STORAGE_KEY_CONFLICT" });
    expect(await readAll(await storage.open("objects/media_1"))).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it("removes partial oversized uploads", async () => {
    const storage = new LocalMediaStorage(await root());
    await expect(storage.write({
      storageKey: "objects/too-large",
      stream: chunks([1, 2, 3], [4, 5]),
      maxBytes: 4,
    })).rejects.toMatchObject({ code: "MEDIA_SIZE_LIMIT_EXCEEDED", status: 413 });
    expect(await storage.exists("objects/too-large")).toBe(false);
    expect(await storage.listKeys()).toEqual([]);
  });

  it("rejects traversal, absolute paths, backslashes, and symlinked parents", async () => {
    const mediaRoot = await root();
    const outside = await root();
    const storage = new LocalMediaStorage(mediaRoot);
    await expect(storage.exists("../secret")).rejects.toMatchObject({ code: "MEDIA_STORAGE_PATH_INVALID" });
    await expect(storage.exists("/etc/passwd")).rejects.toMatchObject({ code: "MEDIA_STORAGE_PATH_INVALID" });
    await expect(storage.exists("objects\\secret")).rejects.toMatchObject({ code: "MEDIA_STORAGE_PATH_INVALID" });

    await mkdir(mediaRoot, { recursive: true });
    await symlink(outside, join(mediaRoot, "objects"));
    await expect(storage.write({
      storageKey: "objects/escape",
      stream: chunks([1]),
      maxBytes: 4,
    })).rejects.toMatchObject({ code: "MEDIA_STORAGE_PATH_INVALID" });
  });
});
