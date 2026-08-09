import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderComposedComponent } from "./composed-components.js";
import { ComposedRuntimeProvider } from "./composed-runtime.js";
import {
  baseViewportHeight,
  computeShellScale,
  placementStyle,
} from "./composed-geometry.js";
import type { ComponentDefinition, ComposedPageDefinition } from "@xecms/admin-apps";

function component(overrides: Partial<ComponentDefinition> & Pick<ComponentDefinition, "kind">): ComponentDefinition {
  return {
    id: "cmp_test",
    placement: { x: 0, y: 0, width: 4, height: 4 },
    props: {},
    ...overrides,
  };
}

/** Renders a component inside a minimal runtime provider (no live data source). */
function renderWithRuntime(
  definition: ComponentDefinition,
  plugins?: ReadonlyMap<string, (props: { readonly component: ComponentDefinition }) => ReactNode>,
): string {
  const page: ComposedPageDefinition = {
    id: "pg", type: "composed-page", screenNo: "S-1", title: "t", menuLabel: "t",
    layout: { columns: 48, rowHeight: 8 }, state: [], dataSources: [],
    components: [definition], connections: [],
  };
  return renderToStaticMarkup(
    <ComposedRuntimeProvider page={page} client={{ queryComposed: () => Promise.reject(new Error("no")), aggregateComposed: () => Promise.resolve({ groups: [], truncated: false }), getComposedDocument: () => Promise.resolve(null), get: () => Promise.reject(new Error("no")), delete: () => Promise.resolve(), create: () => Promise.reject(new Error("no")), update: () => Promise.reject(new Error("no")) }} fieldNames={new Map()} plugins={plugins}>
      {renderComposedComponent(definition)}
    </ComposedRuntimeProvider>,
  );
}

describe("composed geometry", () => {
  it("maps grid placement to 1-based CSS grid lines", () => {
    expect(placementStyle({ x: 0, y: 0, width: 16, height: 5 }))
      .toEqual({ gridColumn: "1 / span 16", gridRow: "1 / span 5" });
    expect(placementStyle({ x: 17, y: 7, width: 5, height: 30 }))
      .toEqual({ gridColumn: "18 / span 5", gridRow: "8 / span 30" });
  });

  it("never enlarges and floors the shell scale at 0.7", () => {
    // Exactly the base viewport → scale 1.
    expect(computeShellScale(1440, 810, "16:9")).toBe(1);
    // Larger viewport is clamped to 1 (never enlarge).
    expect(computeShellScale(2560, 1440, "16:9")).toBe(1);
    // Small viewport scales down but not below the 0.7 floor.
    expect(computeShellScale(720, 405, "16:9")).toBe(0.7);
    // 4:3 uses a taller base viewport.
    expect(baseViewportHeight("4:3")).toBe(1080);
    expect(computeShellScale(1440, 1080, "4:3")).toBe(1);
  });
});

describe("composed component registry", () => {
  it("renders a known input component from its props", () => {
    const html = renderWithRuntime(component({ kind: "core.input.text", props: { label: "고객명" } }));
    expect(html).toContain("고객명");
    expect(html).toContain("<input");
  });

  it("renders a table header from column props with an empty state", () => {
    const html = renderWithRuntime(component({
      kind: "core.output.table",
      props: { columns: [{ id: "c1", label: "이메일", fieldId: "fld_email" }] },
    }));
    expect(html).toContain("이메일");
    expect(html).toContain("표시할 데이터가 없습니다");
  });

  it("shows a degraded placeholder for an unknown kind (fail-safe)", () => {
    const html = renderToStaticMarkup(renderComposedComponent(
      component({ kind: "core.unknown.widget" }),
    ));
    expect(html).toContain("표시할 수 없는 Component");
    expect(html).toContain("core.unknown.widget");
  });

  it("renders a registered trusted Plugin Component by its namespaced kind (CPB-9)", () => {
    const plugins = new Map([[
      "acme.output.chart",
      ({ component: c }: { readonly component: ComponentDefinition }) => <div>차트:{c.id}</div>,
    ]]);
    const html = renderWithRuntime(component({ id: "cmp_chart", kind: "acme.output.chart" }), plugins);
    expect(html).toContain("차트:cmp_chart");
  });

  it("degrades a Plugin Component whose Plugin is not registered (fail-closed)", () => {
    // A Manifest may reference a Plugin kind, but with no host-registered
    // renderer nothing runs — it falls back to a safe placeholder.
    const html = renderWithRuntime(component({ kind: "acme.output.chart" }));
    expect(html).toContain("사용할 수 없는 Plugin Component");
    expect(html).toContain("acme.output.chart");
  });
});
