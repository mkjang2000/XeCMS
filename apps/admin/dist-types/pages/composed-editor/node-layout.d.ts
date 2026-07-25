import type { ComposedPageDefinition } from "@xecms/admin-apps";
export interface NodeBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
/** Key for a non-visual node in the layout map (nodeType + id). */
export declare function nodeKey(nodeType: "state" | "data-source", nodeId: string): string;
/**
 * Places State and Data Source node boxes in a reserved strip below the
 * component grid. These editor-only coordinates are derived deterministically
 * from declaration order and are never written to the Manifest.
 */
export declare function nodeBoxLayout(page: ComposedPageDefinition): {
    readonly boxes: ReadonlyMap<string, NodeBox>;
    /** Top of the reserved strip in canvas px, so the canvas can extend to fit it. */
    readonly stripTop: number;
    readonly stripHeight: number;
};
//# sourceMappingURL=node-layout.d.ts.map