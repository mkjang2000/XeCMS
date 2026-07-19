import type { ReactNode } from "react";
import { type AuthorizationPolicy, type AuthorizationRoleBinding } from "@xecms/admin";
/**
 * Unified header for every authorization screen. Makes the "same screen, two
 * contexts" ambiguity explicit: a global (System) policy vs a specific user
 * space's policy — the latter shows the realm's name so operators know which
 * space they are editing. Replaces the per-page ad-hoc eyebrows.
 */
export declare function AccessPageHeader({ realmId, title, description, actions, }: {
    readonly realmId?: string;
    readonly title: string;
    readonly description?: string;
    readonly actions?: ReactNode;
}): import("react").JSX.Element;
export declare function PolicySummary({ policy }: {
    readonly policy: AuthorizationPolicy;
}): import("react").JSX.Element;
export declare function MutationError({ error }: {
    readonly error: unknown;
}): import("react").JSX.Element | null;
export declare function textList(value: string): readonly string[];
export declare function dateTimeValue(value?: string): string;
export declare function optionalInstant(value: string): string | undefined;
export declare function subjectNameOf(policy: AuthorizationPolicy, id: string): string;
export declare function roleNameOf(policy: AuthorizationPolicy, id: string): string;
export declare function resourceNameOf(policy: AuthorizationPolicy, id: string): string;
export declare function resourcePathOf(policy: AuthorizationPolicy, id: string): string;
export declare function emptyBinding(policy: AuthorizationPolicy): AuthorizationRoleBinding;
//# sourceMappingURL=common.d.ts.map