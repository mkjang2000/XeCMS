import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import type { ComponentDefinition } from "@xecms/admin-apps";

import { useComposedRuntime } from "./composed-runtime.js";
import styles from "../src/runtime.module.css";

/**
 * Chart output for an aggregate Data Source (slG2). Renders grouped {group,value}
 * as a bar chart. It is a single-measure form, so one hue carries magnitude — bars
 * are NOT rainbow-colored by rank (that would encode identity where there is none).
 * The Recharts renderer is lazy-loaded so it never weighs down the initial bundle,
 * and it renders self-contained SVG (CSP-safe: no external fetch). A table view is
 * always reachable so identity/values never depend on color alone (dataviz a11y).
 */

/** The validated dataviz single-series blue (see dataviz skill palette). */
const BAR_COLOR_LIGHT = "#2a78d6";
const BAR_COLOR_DARK = "#3987e5";

interface ChartDatum {
  readonly group: string;
  readonly value: number;
}

// Recharts is heavy (d3); load it only when a chart actually renders.
const BarChartCanvas = lazy(() => import("./composed-bar-chart.js"));

export function ChartOutput({ component }: { readonly component: ComponentDefinition }): ReactNode {
  const runtime = useComposedRuntime();
  const title = textProp(component, "label", "차트");
  const measureLabel = textProp(component, "measureLabel", "값");
  const aggregate = runtime.aggregateForOutput(component.id);
  const [asTable, setAsTable] = useState(false);

  const data = useMemo<readonly ChartDatum[]>(
    () => (aggregate?.groups ?? []).map((entry) => ({
      group: entry.group === null || entry.group === "" ? "(없음)" : String(entry.group),
      value: entry.value,
    })),
    [aggregate?.groups],
  );

  const status = aggregate?.status ?? "idle";
  return (
    <figure className={styles.composedChart} aria-label={title}>
      <figcaption className={styles.composedChartHead}>
        <span>{title}</span>
        <button
          type="button"
          className={styles.composedChartToggle}
          aria-pressed={asTable}
          onClick={() => setAsTable((value) => !value)}
        >
          {asTable ? "차트로" : "표로"}
        </button>
      </figcaption>
      {status === "loading" ? (
        <div className={styles.composedEmpty}>불러오는 중…</div>
      ) : status === "error" ? (
        <div className={styles.composedEmpty}>집계에 실패했습니다. {aggregate?.error}</div>
      ) : data.length === 0 ? (
        <div className={styles.composedEmpty}>표시할 데이터가 없습니다.</div>
      ) : asTable ? (
        <ChartTable data={data} measureLabel={measureLabel} />
      ) : (
        <Suspense fallback={<div className={styles.composedEmpty}>차트 로딩 중…</div>}>
          <BarChartCanvas data={data} measureLabel={measureLabel} colorLight={BAR_COLOR_LIGHT} colorDark={BAR_COLOR_DARK} />
        </Suspense>
      )}
      {aggregate?.truncated === true ? (
        <small className={styles.composedChartNote}>표시할 항목이 많아 일부만 집계했습니다.</small>
      ) : null}
    </figure>
  );
}

/** The always-available table view — identity/values never rely on color alone. */
function ChartTable({ data, measureLabel }: { readonly data: readonly ChartDatum[]; readonly measureLabel: string }) {
  return (
    <table className={styles.composedChartTable}>
      <thead><tr><th>항목</th><th>{measureLabel}</th></tr></thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.group}><td>{datum.group}</td><td>{formatNumber(datum.value)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function textProp(component: ComponentDefinition, key: string, fallback: string): string {
  const value = component.props[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

export type { ChartDatum };
