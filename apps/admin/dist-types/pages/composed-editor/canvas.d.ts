import { type ReactNode } from "react";
import { type LayoutProfile } from "@xecms/admin-runtime/geometry";
import type { ComponentDefinition, ComposedPageDefinition, GridPlacement } from "@xecms/admin-apps";
export interface CanvasProps {
    readonly page: ComposedPageDefinition;
    readonly selectedId: string | null;
    readonly locked: boolean;
    readonly onSelect: (id: string | null) => void;
    readonly onPlace: (id: string, placement: GridPlacement) => void;
    /** Fired when a cell is activated while the canvas is locked (connect mode). */
    readonly onLockedActivate?: (id: string) => void;
    /** Highlights cells (e.g. the pending link source / linkable targets). */
    readonly cellTone?: (id: string) => "source" | "target" | null;
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
export declare function ComposedCanvas({ page, selectedId, locked, onSelect, onPlace, onLockedActivate, cellTone, overlay, renderComponent, scale, profile, extraHeight, }: CanvasProps): import("react").JSX.Element;
//# sourceMappingURL=canvas.d.ts.map