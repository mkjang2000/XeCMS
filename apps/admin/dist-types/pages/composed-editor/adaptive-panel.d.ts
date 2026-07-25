import type { ComponentDefinition } from "@xecms/admin-apps";
export interface AdaptivePanelProps {
    readonly component: ComponentDefinition;
    readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
    readonly onRemove: () => void;
}
/**
 * Inspector form for a `core.input.adaptive` component. Each variant becomes an
 * output port (`value:<id>`) the Builder wires to a State → Data Source
 * parameter; the runtime fills only the active variant so hidden values never
 * reach the query.
 */
export declare function AdaptivePanel({ component, onChangeProps, onRemove }: AdaptivePanelProps): import("react").JSX.Element;
//# sourceMappingURL=adaptive-panel.d.ts.map