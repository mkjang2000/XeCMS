import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "xecms.rich-text.height.";

function readStored(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Private mode or blocked storage: fall back to the default height.
    return null;
  }
}

function writeStored(key: string, value: number): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value)));
  } catch {
    // Ignore: a lost height preference is not worth surfacing.
  }
}

export interface ResizableHeight {
  /** Fixed body height in px, or null before the user has resized. */
  readonly height: number | null;
  /** Bind to the drag handle's onPointerDown. */
  readonly onHandlePointerDown: (event: React.PointerEvent) => void;
  /** True while a drag is in progress (for cursor/overlay styling). */
  readonly isResizing: boolean;
}

/**
 * Makes an element's height draggable from a bottom handle and remembers the
 * chosen height under `storageKey`. The height is clamped to [minHeight, ∞);
 * before the first resize it stays null so the caller can use its natural
 * auto-growing height instead of a fixed box.
 */
export function useResizableHeight(
  bodyRef: React.RefObject<HTMLElement | null>,
  storageKey: string,
  minHeight: number,
): ResizableHeight {
  const [height, setHeight] = useState<number | null>(() => readStored(storageKey));
  const [isResizing, setResizing] = useState(false);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  // Adopt a newly loaded preference when the key changes (different field).
  useEffect(() => {
    setHeight(readStored(storageKey));
  }, [storageKey]);

  const onHandlePointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const current = bodyRef.current?.getBoundingClientRect().height ?? minHeight;
    drag.current = { startY: event.clientY, startHeight: current };
    setResizing(true);
  }, [bodyRef, minHeight]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (event: PointerEvent) => {
      if (drag.current === null) return;
      const next = Math.max(minHeight, drag.current.startHeight + (event.clientY - drag.current.startY));
      setHeight(next);
    };
    const onUp = () => {
      setResizing(false);
      drag.current = null;
      setHeight((value) => {
        if (value !== null) writeStored(storageKey, value);
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
