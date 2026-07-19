import type { ReactElement, ReactNode } from "react";
export type StepStatus = "done" | "current" | "blocked" | "todo";
export interface StepDef {
    readonly id: string;
    readonly label: string;
    readonly status: StepStatus;
    /** Guidance shown under the label — e.g. a preventive deadlock warning. */
    readonly description?: ReactNode;
    /** Optional CTA (typically a Button) shown for the current/blocked step. */
    readonly action?: ReactNode;
}
/**
 * Read-only setup checklist. The caller computes each step's status from its own
 * queries; this component only renders. Reuses Badge/design tokens — no new
 * icons or data fetching.
 */
export declare function Checklist({ title, steps, }: {
    readonly title?: string;
    readonly steps: readonly StepDef[];
}): ReactElement;
//# sourceMappingURL=stepper.d.ts.map