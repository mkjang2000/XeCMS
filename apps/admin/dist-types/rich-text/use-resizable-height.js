import { useCallback, useEffect, useRef, useState } from "react";
const STORAGE_PREFIX = "xecms.rich-text.height.";
function readStored(key) {
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === null)
            return null;
        const value = Number.parseInt(raw, 10);
        return Number.isFinite(value) ? value : null;
    }
    catch {
        // Private mode or blocked storage: fall back to the default height.
        return null;
    }
}
function writeStored(key, value) {
    try {
        window.localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value)));
    }
    catch {
        // Ignore: a lost height preference is not worth surfacing.
    }
}
/**
 * Makes an element's height draggable from a bottom handle and remembers the
 * chosen height under `storageKey`. The height is clamped to [minHeight, ∞);
 * before the first resize it stays null so the caller can use its natural
 * auto-growing height instead of a fixed box.
 */
export function useResizableHeight(bodyRef, storageKey, minHeight) {
    const [height, setHeight] = useState(() => readStored(storageKey));
    const [isResizing, setResizing] = useState(false);
    const drag = useRef(null);
    // Adopt a newly loaded preference when the key changes (different field).
    useEffect(() => {
        setHeight(readStored(storageKey));
    }, [storageKey]);
    const onHandlePointerDown = useCallback((event) => {
        event.preventDefault();
        const current = bodyRef.current?.getBoundingClientRect().height ?? minHeight;
        drag.current = { startY: event.clientY, startHeight: current };
        setResizing(true);
    }, [bodyRef, minHeight]);
    useEffect(() => {
        if (!isResizing)
            return;
        const onMove = (event) => {
            if (drag.current === null)
                return;
            const next = Math.max(minHeight, drag.current.startHeight + (event.clientY - drag.current.startY));
            setHeight(next);
        };
        const onUp = () => {
            setResizing(false);
            drag.current = null;
            setHeight((value) => {
                if (value !== null)
                    writeStored(storageKey, value);
                return value;
            });
        };
        // Capture so the drag keeps tracking even when the pointer leaves the handle.
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [isResizing, minHeight, storageKey]);
    return { height, onHandlePointerDown, isResizing };
}
//# sourceMappingURL=use-resizable-height.js.map