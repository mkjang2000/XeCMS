import type { ComponentDefinition } from "@xecms/admin-apps";
export interface PaletteEntry {
    readonly kind: string;
    readonly label: string;
    readonly group: "input" | "output" | "layout";
    readonly defaultSize: {
        readonly width: number;
        readonly height: number;
    };
    readonly defaultProps: Readonly<Record<string, unknown>>;
}
/** First vertical slice Component catalog for the Builder palette (§5, §7). */
export declare const PALETTE: readonly PaletteEntry[];
export declare function paletteEntry(kind: string): PaletteEntry | undefined;
export declare function nextComponentId(existing: readonly ComponentDefinition[], kind: string): string;
//# sourceMappingURL=catalog.d.ts.map