import type { AuthorizationPolicy } from "@xecms/admin";
export declare function PermissionEditor({ permissions, selected, delegated, query, technical, advanced, readOnly, onQueryChange, onTechnicalChange, onPermissionChange, onDelegationChange, }: {
    readonly permissions: AuthorizationPolicy["permissions"];
    readonly selected: readonly string[];
    readonly delegated: readonly string[];
    readonly query: string;
    readonly technical: boolean;
    readonly advanced: boolean;
    readonly readOnly: boolean;
    readonly onQueryChange: (value: string) => void;
    readonly onTechnicalChange: (value: boolean) => void;
    readonly onPermissionChange: (key: string, selected: boolean) => void;
    readonly onDelegationChange: (key: string, selected: boolean) => void;
}): import("react").JSX.Element;
//# sourceMappingURL=permission-editor.d.ts.map