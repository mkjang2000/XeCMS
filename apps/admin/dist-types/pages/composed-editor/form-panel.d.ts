import type { CollectionSummaryDto } from "@xecms/client";
import type { ComponentDefinition } from "@xecms/admin-apps";
export interface FormPanelProps {
    readonly component: ComponentDefinition;
    readonly collections: readonly CollectionSummaryDto[];
    readonly onChangeProps: (props: Readonly<Record<string, unknown>>) => void;
    readonly onRemove: () => void;
}
/**
 * Inspector for a `core.form` component: pick a Collection and the Fields to
 * collect. The form's values feed a create/update Action, whose permission the
 * server enforces — this panel only configures which inputs are shown.
 */
export declare function FormPanel({ component, collections, onChangeProps, onRemove }: FormPanelProps): import("react").JSX.Element;
//# sourceMappingURL=form-panel.d.ts.map