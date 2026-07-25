import { decodeAdminAppManifest } from "./decode.js";
import { AdminAppManifestDecodeError } from "./errors.js";
import type { AdminAppManifestV1 } from "./types.js";
import { decodeAdminAppManifestV2 } from "./v2/decode.js";
import type { AdminAppManifestV2 } from "./v2/types.js";

export type AdminAppManifest = AdminAppManifestV1 | AdminAppManifestV2;

/**
 * Decodes an Admin App Manifest of either version. The `formatVersion` selects
 * the strict decoder; V1 remains byte-for-byte unchanged (D-07). Unknown
 * versions fail closed.
 */
export function decodeAdminAppManifestAny(input: unknown): AdminAppManifest {
  const version = readFormatVersion(input);
  if (version === 1) return decodeAdminAppManifest(input);
  if (version === 2) return decodeAdminAppManifestV2(input);
  throw new AdminAppManifestDecodeError([{
    code: "UNSUPPORTED_FORMAT_VERSION",
    message: `Unsupported Admin App Manifest formatVersion '${String(version)}'.`,
    path: ["formatVersion"],
  }]);
}

export function isComposedPageManifest(manifest: AdminAppManifest): manifest is AdminAppManifestV2 {
  return manifest.formatVersion === 2;
}

function readFormatVersion(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AdminAppManifestDecodeError([{
      code: "INVALID_INPUT_TYPE",
      message: "Expected an Admin App Manifest object.",
      path: [],
    }]);
  }
  return (input as Readonly<Record<string, unknown>>)["formatVersion"];
}
