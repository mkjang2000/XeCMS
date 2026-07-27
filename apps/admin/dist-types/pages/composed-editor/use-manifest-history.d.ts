import type { AdminAppManifestV2 } from "@xecms/admin-apps";
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
export declare function useManifestHistory(): ManifestHistory;
//# sourceMappingURL=use-manifest-history.d.ts.map