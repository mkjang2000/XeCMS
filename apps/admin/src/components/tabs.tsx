import type { ReactElement, ReactNode } from "react";

import styles from "./tabs.module.css";

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
export function Tabs<Id extends string>({
  ariaLabel,
  tabs,
  active,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly tabs: readonly TabDef<Id>[];
  readonly active: Id;
  readonly onChange: (id: Id) => void;
}): ReactElement {
  return (
    <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge}
        </button>
      ))}
    </div>
  );
}

/** Shared danger marker for tabs (replaces detailTabDangerDot). */
export function TabDangerDot({ label }: { readonly label: string }): ReactElement {
  return <span className={styles.dangerDot} aria-label={label} />;
}
