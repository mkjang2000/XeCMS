import type { ReactElement, ReactNode } from "react";
export interface TabDef<Id extends string> {
    readonly id: Id;
    readonly label: string;
    readonly disabled?: boolean;
    /** Optional trailing marker (e.g. a danger dot) rendered inside the tab. */
    readonly badge?: ReactNode;
}
/**
 * Accessible tablist shared across detail pages. Generalises the previously
 * hard-coded RealmDetailTabs so any page can render URL- or state-driven tabs
 * with the same look and keyboard behaviour.
 */
export declare function Tabs<Id extends string>({ ariaLabel, tabs, active, onChange, }: {
    readonly ariaLabel: string;
    readonly tabs: readonly TabDef<Id>[];
    readonly active: Id;
    readonly onChange: (id: Id) => void;
}): ReactElement;
/** Shared danger marker for tabs (replaces detailTabDangerDot). */
export declare function TabDangerDot({ label }: {
    readonly label: string;
}): ReactElement;
//# sourceMappingURL=tabs.d.ts.map