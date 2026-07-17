import { normalizeAdminAppManifest } from "./normalize.js";
import type { AdminAppManifestV1 } from "./types.js";

export type AdminAppManifestDiffKind = "added" | "removed" | "changed";

export interface AdminAppManifestDiffEntry {
  readonly kind: AdminAppManifestDiffKind;
  readonly path: readonly (string | number)[];
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface AdminAppManifestDiff {
  readonly changed: boolean;
  readonly entries: readonly AdminAppManifestDiffEntry[];
}

export function diffAdminAppManifests(
  before: AdminAppManifestV1,
  after: AdminAppManifestV1,
): AdminAppManifestDiff {
  const entries: AdminAppManifestDiffEntry[] = [];
  compare(normalizeAdminAppManifest(before), normalizeAdminAppManifest(after), [], entries);
  return { changed: entries.length > 0, entries };
}

function compare(
  before: unknown,
  after: unknown,
  path: readonly (string | number)[],
  entries: AdminAppManifestDiffEntry[],
): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= before.length) {
        entries.push({ kind: "added", path: [...path, index], after: after[index] });
      } else if (index >= after.length) {
        entries.push({ kind: "removed", path: [...path, index], before: before[index] });
      } else {
        compare(before[index], after[index], [...path, index], entries);
      }
    }
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort(compareText)) {
      if (!Object.prototype.hasOwnProperty.call(before, key)) {
        entries.push({ kind: "added", path: [...path, key], after: after[key] });
      } else if (!Object.prototype.hasOwnProperty.call(after, key)) {
        entries.push({ kind: "removed", path: [...path, key], before: before[key] });
      } else {
        compare(before[key], after[key], [...path, key], entries);
      }
    }
    return;
  }
  entries.push({ kind: "changed", path, before, after });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
