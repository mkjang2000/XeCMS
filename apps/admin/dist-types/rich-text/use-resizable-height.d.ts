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
export declare function useResizableHeight(bodyRef: React.RefObject<HTMLElement | null>, storageKey: string, minHeight: number): ResizableHeight;
//# sourceMappingURL=use-resizable-height.d.ts.map