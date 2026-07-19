import type { ReactElement, ReactNode } from "react";
import { Badge } from "@xecms/ui";

import styles from "./stepper.module.css";

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

const statusBadge: Record<StepStatus, { readonly tone: "success" | "primary" | "warning" | "neutral"; readonly label: string }> = {
  done: { tone: "success", label: "완료" },
  current: { tone: "primary", label: "진행할 차례" },
  blocked: { tone: "warning", label: "먼저 필요" },
  todo: { tone: "neutral", label: "대기" },
};

function marker(status: StepStatus, index: number): string {
  if (status === "done") return "✓";
  if (status === "blocked") return "!";
  return String(index + 1);
}

/**
 * Read-only setup checklist. The caller computes each step's status from its own
 * queries; this component only renders. Reuses Badge/design tokens — no new
 * icons or data fetching.
 */
export function Checklist({
  title,
  steps,
}: {
  readonly title?: string;
  readonly steps: readonly StepDef[];
}): ReactElement {
  return (
    <div>
      {title === undefined ? null : <p className={styles.title}>{title}</p>}
      <ol className={styles.checklist}>
        {steps.map((step, index) => {
          const badge = statusBadge[step.status];
          return (
            <li key={step.id} className={styles.step} data-status={step.status}>
              <span className={styles.marker} aria-hidden="true">{marker(step.status, index)}</span>
              <div className={styles.body}>
                <div className={styles.headline}>
                  <span className={styles.label}>{step.label}</span>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>
                {step.description === undefined ? null : (
                  <p className={styles.description}>{step.description}</p>
                )}
                {step.action === undefined ? null : <div className={styles.action}>{step.action}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
