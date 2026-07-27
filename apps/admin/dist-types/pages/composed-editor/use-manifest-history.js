import { useCallback, useRef, useState } from "react";
/** Session-scoped undo/redo cap (§4, CPB-3 D-10: last 100 edits). */
const HISTORY_LIMIT = 100;
/**
 * Manifest state with an in-memory undo/redo stack. The editor keeps treating
 * `manifest`/`set` like a normal `useState` pair; every `set` pushes a snapshot
 * so edits are reversible within the session. `reset` is used on initial load and
 * after a successful save so those don't become undo steps.
 */
export function useManifestHistory() {
    // past = older snapshots (undo targets); future = redone-away snapshots.
    const [past, setPast] = useState([]);
    const [present, setPresent] = useState(null);
    const [future, setFuture] = useState([]);
    const presentRef = useRef(null);
    presentRef.current = present;
    const set = useCallback((next) => {
        const current = presentRef.current;
        setPast((prev) => {
            if (current === null)
                return prev;
            const appended = [...prev, current];
            return appended.length > HISTORY_LIMIT ? appended.slice(appended.length - HISTORY_LIMIT) : appended;
        });
        setFuture([]);
        setPresent(next);
    }, []);
    const reset = useCallback((next) => {
        setPast([]);
        setFuture([]);
        setPresent(next);
    }, []);
    const undo = useCallback(() => {
        setPast((prev) => {
            if (prev.length === 0)
                return prev;
            const previous = prev[prev.length - 1];
            const current = presentRef.current;
            if (current !== null)
                setFuture((f) => [current, ...f]);
            setPresent(previous);
            return prev.slice(0, -1);
        });
    }, []);
    const redo = useCallback(() => {
        setFuture((prev) => {
            if (prev.length === 0)
                return prev;
            const nextPresent = prev[0];
            const current = presentRef.current;
            if (current !== null)
                setPast((p) => [...p, current]);
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
//# sourceMappingURL=use-manifest-history.js.map