import type { AdminAppManifestV1 } from "./types.js";
import { assertValidAdminAppManifest } from "./validate.js";

export function normalizeAdminAppManifest(manifest: AdminAppManifestV1): AdminAppManifestV1 {
  assertValidAdminAppManifest(manifest);
  return normalizeAdminAppManifestUnchecked(manifest);
}

/** Produces a detached value with recursively sorted object keys and stable numbers. */
export function normalizeAdminAppManifestUnchecked(
  manifest: AdminAppManifestV1,
): AdminAppManifestV1 {
  return canonicalValue(manifest) as unknown as AdminAppManifestV1;
}

export function serializeAdminAppManifest(manifest: AdminAppManifestV1): string {
  return JSON.stringify(normalizeAdminAppManifest(manifest), null, 2);
}

export async function hashAdminAppManifest(manifest: AdminAppManifestV1): Promise<string> {
  const contents = new TextEncoder().encode(serializeAdminAppManifest(manifest));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", contents);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Shape-agnostic canonicalization: recursively sorts object keys, drops
 * undefined, and normalizes -0. Reused by V1 and V2 manifests alike. */
export function canonicalManifestValue<T>(value: T): T {
  return canonicalValue(value) as T;
}

/** Shape-agnostic canonical JSON serialization for any manifest version. */
export function serializeManifestValue(value: unknown): string {
  return JSON.stringify(canonicalValue(value), null, 2);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}
