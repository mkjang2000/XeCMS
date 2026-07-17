import type { AuthorizationResource, AuthorizationScopePropagation } from "@xecms/admin";
export interface ResourceTreeNode {
    readonly resource: AuthorizationResource;
    readonly children: readonly ResourceTreeNode[];
}
/**
 * Turns the policy's parentId edges into a forest without trusting the server
 * ordering. Invalid/orphan/cyclic resources remain visible as top-level nodes
 * so an administrator can still select and repair their bindings.
 */
export declare function buildResourceTree(resources: readonly AuthorizationResource[]): readonly ResourceTreeNode[];
export declare function resourcePath(resources: readonly AuthorizationResource[], resourceId: string): readonly AuthorizationResource[];
export declare function ScopeTreeSelector({ label, description, resources, value, onChange, allowEmpty, emptyLabel, isSelectable, propagation, onPropagationChange, isDisabled, }: {
    readonly label: string;
    readonly description?: string;
    readonly resources: readonly AuthorizationResource[];
    readonly value: string;
    readonly onChange: (resourceId: string) => void;
    readonly allowEmpty?: boolean;
    readonly emptyLabel?: string;
    readonly isSelectable?: (resource: AuthorizationResource) => boolean;
    readonly propagation?: AuthorizationScopePropagation;
    readonly onPropagationChange?: (propagation: AuthorizationScopePropagation) => void;
    readonly isDisabled?: boolean;
}): import("react").JSX.Element;
//# sourceMappingURL=resource-scope-tree.d.ts.map