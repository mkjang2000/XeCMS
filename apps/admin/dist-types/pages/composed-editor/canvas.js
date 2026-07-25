import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { COLUMN_WIDTH, ROW_HEIGHT, CANVAS_WIDTH, baseViewportHeight, clampPlacement, placementsOverlap, } from "@xecms/admin-runtime/geometry";
import { canPlace } from "./model.js";
import styles from "./composed-editor.module.css";
/** 48-column drag/resize canvas at the fixed 1152px design width. */
export function ComposedCanvas({ page, selectedId, locked, onSelect, onPlace, onLockedActivate, cellTone, overlay, renderComponent, scale = 1, profile = "16:9", extraHeight = 0, }) {
    const ref = useRef(null);
    // Match the runtime: grow the canvas to the lowest component (and the overlay),
    // floored at the real viewport height, so nothing is clipped by a fixed min.
    const contentHeight = Math.max(baseViewportHeight(profile), extraHeight, ...page.components.map((component) => (component.placement.y + component.placement.height) * ROW_HEIGHT));
    const [drag, setDrag] = useState(null);
    const [preview, setPreview] = useState(null);
    // Capture on the canvas container (which owns the move/up handlers) rather than
    // the cell/handle, so a fast drag or a pointer that leaves the cell never drops
    // events mid-drag.
    const captureCanvas = (pointerId) => ref.current?.setPointerCapture?.(pointerId);
    const beginMove = (event, component) => {
        if (locked)
            return;
        event.stopPropagation();
        onSelect(component.id);
        captureCanvas(event.pointerId);
        setDrag({ kind: "move", id: component.id, startX: event.clientX, startY: event.clientY, origin: component.placement });
    };
    const beginResize = (event, component) => {
        if (locked)
            return;
        event.stopPropagation();
        onSelect(component.id);
        captureCanvas(event.pointerId);
        setDrag({ kind: "resize", id: component.id, startX: event.clientX, startY: event.clientY, origin: component.placement });
    };
    const onMove = (event) => {
        if (drag === null)
            return;
        // Screen pixels are scaled by `scale`; divide it out to get canvas cells.
        const factor = scale > 0 ? scale : 1;
        const dx = Math.round((event.clientX - drag.startX) / (COLUMN_WIDTH * factor));
        const dy = Math.round((event.clientY - drag.startY) / (ROW_HEIGHT * factor));
        const next = drag.kind === "move"
            ? clampPlacement({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy })
            : clampPlacement({ ...drag.origin, width: drag.origin.width + dx, height: drag.origin.height + dy });
        setPreview({ id: drag.id, placement: next });
    };
    const endDrag = (event) => {
        if (drag === null)
            return;
        if (preview !== null && canPlace(page, drag.id, preview.placement)) {
            onPlace(drag.id, preview.placement);
        }
        if (event !== undefined)
            ref.current?.releasePointerCapture?.(event.pointerId);
        setDrag(null);
        setPreview(null);
    };
    const placementOf = (component) => preview?.id === component.id ? preview.placement : component.placement;
    const previewCollides = preview !== null && !canPlace(page, preview.id, preview.placement);
    return (_jsxs("div", { ref: ref, className: styles.canvas, style: { width: CANVAS_WIDTH, minHeight: contentHeight }, onPointerMove: onMove, onPointerUp: endDrag, onPointerCancel: endDrag, 
        // Deselect only when the empty canvas itself is pressed, so selecting a
        // component isn't immediately cleared by the bubbled click/press.
        onPointerDown: (event) => { if (event.target === event.currentTarget)
            onSelect(null); }, role: "application", "aria-label": "\uD654\uBA74 \uD3B8\uC9D1 \uCE94\uBC84\uC2A4", children: [page.components.map((component) => {
                const placement = placementOf(component);
                const selected = component.id === selectedId;
                const invalid = previewCollides && preview?.id === component.id;
                const tone = cellTone?.(component.id) ?? null;
                return (_jsxs("div", { className: [
                        styles.cell,
                        selected ? styles.cellSelected : "",
                        invalid ? styles.cellInvalid : "",
                        tone === "source" ? styles.cellLinkSource : "",
                        tone === "target" ? styles.cellLinkTarget : "",
                    ].filter(Boolean).join(" "), style: {
                        gridColumn: `${placement.x + 1} / span ${placement.width}`,
                        gridRow: `${placement.y + 1} / span ${placement.height}`,
                    }, onPointerDown: (event) => beginMove(event, component), onClick: locked ? () => onLockedActivate?.(component.id) : undefined, onKeyDown: (event) => handleKeyboard(event, page, component, onPlace), tabIndex: 0, role: "group", "aria-label": `${component.kind} (${component.id})`, children: [_jsx("div", { className: styles.cellBody, children: renderComponent(component) }), !locked ? (_jsx("span", { className: styles.resizeHandle, onPointerDown: (event) => beginResize(event, component), "aria-hidden": "true" })) : null] }, component.id));
            }), overlay] }));
}
/** Keyboard alternative for move (arrows) and resize (Shift+arrows). */
function handleKeyboard(event, page, component, onPlace) {
    const delta = keyDelta(event.key);
    if (delta === null)
        return;
    event.preventDefault();
    const base = component.placement;
    const next = event.shiftKey
        ? clampPlacement({ ...base, width: base.width + delta.x, height: base.height + delta.y })
        : clampPlacement({ ...base, x: base.x + delta.x, y: base.y + delta.y });
    if (page.components.every((other) => other.id === component.id || !placementsOverlap(other.placement, next))) {
        onPlace(component.id, next);
    }
}
function keyDelta(key) {
    switch (key) {
        case "ArrowLeft": return { x: -1, y: 0 };
        case "ArrowRight": return { x: 1, y: 0 };
        case "ArrowUp": return { x: 0, y: -1 };
        case "ArrowDown": return { x: 0, y: 1 };
        default: return null;
    }
}
//# sourceMappingURL=canvas.js.map