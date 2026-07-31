import { type ReactNode } from "react";
import { type LayoutProfile } from "@xecms/admin-runtime/geometry";
import type { ComponentDefinition, ComposedPageDefinition, GridPlacement } from "@xecms/admin-apps";
/** An in-progress form→form link drag (connect mode). */
export interface LinkDragState {
    readonly sourceId: string;
    /** Cursor position in canvas coordinates (drives the rubber-band line). */
    readonly cursor: {
        readonly x: number;
        readonly y: number;
    };
    /** The component cell the cursor is currently over, if any. */
    readonly hoverId: string | null;
}
export interface CanvasProps {
    readonly page: ComposedPageDefinition;
    readonly selectedId: string | null;
    readonly locked: boolean;
    readonly onSelect: (id: string | null) => void;
    readonly onPlace: (id: string, placement: GridPlacement) => void;
    /** Fired when a cell is activated (clicked) while the canvas is locked (connect mode). */
    readonly onLockedActivate?: (id: string) => void;
    /**
     * Fired throughout a form→form link drag in connect mode: a non-null state
     * while dragging (source, cursor, hovered cell), then null when it ends. The
     * page uses it to draw the rubber-band line and highlight linkable targets.
     */
    readonly onLinkDrag?: (state: LinkDragState | null) => void;
    /** Fired when a link drag is released over a cell (or empty space → null). */
    readonly onLinkDrop?: (sourceId: string, targetId: string | null) => void;
    /** Highlights cells (e.g. the pending link source / linkable targets). */
    readonly cellTone?: (id: string) => "source" | "target" | null;
    /** Whether a component has a validation issue (renders a ⚠ badge). */
    readonly cellHasIssue?: (id: string) => boolean;
    /** Overlay drawn above the grid (e.g. connection lines). */
    readonly overlay?: ReactNode;
    /** Renders the body of a single component cell. */
    readonly renderComponent: (component: ComponentDefinition) => ReactNode;
    /** CSS scale applied to the canvas by an ancestor, so drag math stays 1:1. */
    readonly scale?: number;
    /** Layout profile, so the canvas floors its height at the real viewport. */
    readonly profile?: LayoutProfile;
    /** Extra px of height the overlay (node strip) needs below the components. */
    readonly extraHeight?: number;
}
/** 48-column drag/resize canvas at the fixed 1152px design width. */
export declare function ComposedCanvas({ page, selectedId, locked, onSelect, onPlace, onLockedActivate, onLinkDrag, onLinkDrop, cellTone, cellHasIssue, overlay, renderComponent, scale, profile, extraHeight, }: CanvasProps): import("react").JSX.Element;
//# sourceMappingURL=canvas.d.ts.map