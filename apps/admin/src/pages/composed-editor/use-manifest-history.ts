import { useCallback, useRef, useState } from "react";
import type { AdminAppManifestV2 } from "@xecms/admin-apps";

/** Session-scoped undo/redo cap (§4, CPB-3 D-10: last 100 edits). */
const HISTORY_LIMIT = 100;

export interface ManifestHistory {
  readonly manifest: AdminAppManifestV2 | null;
  /** Records a new manifest as one undoable edit (truncates the redo tail). */
  readonly set: (next: AdminAppManifestV2) => void;
  /** Replaces the baseline without creating history (load / save round-trip). */
  readonly reset: (next: AdminAppManifestV2) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * Manifest state with an in-memory undo/redo stack. The editor keeps treating
 * `manifest`/`set` like a normal `useState` pair; every `set` pushes a snapshot
 * so edits are reversible within the session. `reset` is used on initial load and
 * after a successful save so those don't become undo steps.
 */
export function useManifestHistory(): ManifestHistory {
  // past = older snapshots (undo targets); future = redone-away snapshots.
  const [past, setPast] = useState<readonly AdminAppManifestV2[]>([]);
  const [present, setPresent] = useState<AdminAppManifestV2 | null>(null);
  const [future, setFuture] = useState<readonly AdminAppManifestV2[]>([]);
  const presentRef = useRef<AdminAppManifestV2 | null>(null);
  presentRef.current = present;

  const set = useCallback((next: AdminAppManifestV2): void => {
    const current = presentRef.current;
    setPast((prev) => {
      if (current === null) return prev;
      const appended = [...prev, current];
      return appended.length > HISTORY_LIMIT ? appended.slice(appended.length - HISTORY_LIMIT) : appended;
    });
    setFuture([]);
    setPresent(next);
  }, []);

  const reset = useCallback((next: AdminAppManifestV2): void => {
    setPast([]);
    setFuture([]);
    setPresent(next);
  }, []);

  const undo = useCallback((): void => {
    setPast((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1]!;
      const current = presentRef.current;
      if (current !== null) setFuture((f) => [current, ...f]);
      setPresent(previous);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback((): void => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const nextPresent = prev[0]!;
      const current = presentRef.current;
      if (current !== null) setPast((p) => [...p, current]);
      setPresent(nextPresent);
      return prev.slice(1);
    });
  }, []);

  return {
    manifest: present,
    set,
    reset,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
