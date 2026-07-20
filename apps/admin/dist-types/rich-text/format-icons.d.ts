import type { ReactElement } from "react";
export type FormatIconName = "bold" | "italic" | "underline" | "strike" | "code" | "link" | "unlink" | "bulletList" | "orderedList" | "blockquote" | "alignLeft" | "alignCenter" | "alignRight" | "image" | "table" | "rule" | "undo" | "redo" | "chevronDown";
/**
 * Toolbar glyphs drawn to match the app's navigation icons: 24×24 box, 1.8
 * stroke, round caps. Letterform marks (B/I/U/S) are filled paths instead so
 * they read as type samples rather than outlines.
 */
export declare function FormatIcon({ name, size }: {
    readonly name: FormatIconName;
    readonly size?: number;
}): ReactElement;
//# sourceMappingURL=format-icons.d.ts.map