import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartDatum } from "./composed-chart.js";
import { formatNumber } from "./composed-chart.js";

/**
 * The lazy-loaded Recharts canvas (slG2). Split into its own chunk so Recharts +
 * d3 never land in the initial bundle. Horizontal bars keep category labels
 * readable; a single hue carries magnitude; axes/grid are recessive; each bar
 * carries a direct value label and a hover tooltip (dataviz marks & interaction).
 */
export default function ComposedBarChart({ data, measureLabel, colorLight, colorDark }: {
  readonly data: readonly ChartDatum[];
  readonly measureLabel: string;
  readonly colorLight: string;
  readonly colorDark: string;
}) {
  const dark = usePrefersDark();
  const color = dark ? colorDark : colorLight;
  const axis = dark ? "#c3c2b7" : "#52514e";
  const grid = dark ? "#333331" : "#e8e8e3";
  // Height grows with the number of bars so labels never collide.
  const height = Math.max(160, data.length * 34 + 40);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={[...data]} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
        <CartesianGrid horizontal={false} stroke={grid} />
        <XAxis type="number" tick={{ fill: axis, fontSize: 12 }} stroke={grid} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="group"
          tick={{ fill: axis, fontSize: 12 }}
          stroke={grid}
          width={120}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: dark ? "#ffffff14" : "#0b0b0b0a" }}
          formatter={(value) => [formatNumber(Number(value)), measureLabel]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar dataKey="value" name={measureLabel} fill={color} radius={[0, 4, 4, 0]} maxBarSize={26}>
          <LabelList dataKey="value" position="right" fill={axis} fontSize={12} formatter={(value) => formatNumber(Number(value))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Tracks the effective dark mode (OS setting + a `data-theme` toggle on <html>). */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => detectDark());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(detectDark());
    media.addEventListener("change", update);
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { media.removeEventListener("change", update); observer?.disconnect(); };
  }, []);
  return dark;
}

function detectDark(): boolean {
  if (typeof document !== "undefined") {
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") return true;
    if (theme === "light") return false;
  }
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
