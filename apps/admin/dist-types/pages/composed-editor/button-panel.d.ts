import type { ComponentDefinition, ComposedPageDefinition, ComposedPageEventBinding } from "@xecms/admin-apps";
export interface ButtonPanelProps {
    readonly component: ComponentDefinition;
    /** All pages, so a navigate effect can target another screen. */
    readonly pages: readonly ComposedPageDefinition[];
    readonly page: ComposedPageDefinition;
    readonly collections: readonly {
        readonly id: string;
        readonly name: string;
    }[];
    readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
    readonly onChangeEvents: (events: readonly ComposedPageEventBinding[]) => void;
    readonly onRemove: () => void;
}
/**
 * Inspector for a `core.button`. Edits its Label and the onClick effect chain
 * (CPB-7). The chain runs in order at runtime; the delete action is gated by the
 * server's access profile and re-checked by the content API, so nothing edited
 * here can grant a permission the actor does not already hold.
 */
export declare function ButtonPanel({ component, pages, page, collections, onChangeProps, onChangeEvents, onRemove }: ButtonPanelProps): import("react").JSX.Element;
//# sourceMappingURL=button-panel.d.ts.map