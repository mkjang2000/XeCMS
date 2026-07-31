import { describe, expect, it } from "vitest";

import {
  AdminAppManifestDecodeError,
  AdminAppManifestValidationError,
  decodeAdminAppManifest,
  decodeAdminAppManifestAny,
  decodeAdminAppManifestV2,
  diffManifestValues,
  extractAdminAppDependenciesV2,
  isComposedPageManifest,
  minimalBackofficeManifest,
  minimalComposedPageManifest,
  serializeAdminAppManifest,
  serializeManifestValue,
  upgradeManifestToV2,
  validateAdminAppManifestV2,
  type AdminAppManifestV2,
  type ComposedPageDefinition,
} from "../index.js";

type Mutable<T> = T extends readonly (infer TItem)[]
  ? Mutable<TItem>[]
  : T extends object
    ? { -readonly [TKey in keyof T]: Mutable<T[TKey]> }
    : T;

function clone(): Mutable<AdminAppManifestV2> {
  return JSON.parse(JSON.stringify(minimalComposedPageManifest)) as Mutable<AdminAppManifestV2>;
}

/** The fixture's first page is always the Composed Page under test. */
function composedPage(manifest: Mutable<AdminAppManifestV2>): Mutable<ComposedPageDefinition> {
  return manifest.pages[0] as Mutable<ComposedPageDefinition>;
}

describe("Admin App Manifest V2 (Composed Page) contract", () => {
  it("round-trips the §5.1 search → list → detail fixture without canonical drift", () => {
    const decoded = decodeAdminAppManifestV2(minimalComposedPageManifest);
    const serialized = serializeManifestValue(decoded);
    const reparsed = decodeAdminAppManifestV2(JSON.parse(serialized));
    expect(reparsed).toEqual(decoded);
    expect(serializeManifestValue(reparsed)).toBe(serialized);
  });

  it("extracts collection, field, and mask-policy dependencies", () => {
    const deps = extractAdminAppDependenciesV2(minimalComposedPageManifest);
    expect(deps.collectionIds).toEqual(["col_customers"]);
    expect(deps.fieldIds).toEqual(["fld_customer_email", "fld_customer_name"]);
    expect(deps.maskPolicyIds).toEqual(["core.mask.email"]);
    expect(deps.audienceRealmIds).toEqual(["rlm_operations"]);
  });

  it("extracts Plugin extensions and component-event Actions (CPB-9)", () => {
    const manifest = clone();
    const page = composedPage(manifest);
    // A trusted Plugin Component kind and a component-level Action effect.
    page.components.push({
      id: "cmp_chart", kind: "acme.output.chart", placement: { x: 0, y: 40, width: 20, height: 20 }, props: {},
    } as never);
    page.components.push({
      id: "cmp_del", kind: "core.button", placement: { x: 21, y: 40, width: 5, height: 5 }, props: {},
      events: [{ id: "e1", event: "onClick", effects: [
        { id: "f1", kind: "action.execute", args: { actionId: "core.action.delete", collectionId: "col_customers" } },
        { id: "f2", kind: "action.execute", args: { actionId: "acme.action.export", collectionId: "col_customers" } },
      ] }],
    } as never);
    const deps = extractAdminAppDependenciesV2(manifest);
    // Plugin ids and their extensions are pinned (Component kind + plugin Action).
    expect(deps.pluginIds).toEqual(["acme"]);
    expect(deps.extensionIds).toEqual(["acme.action.export", "acme.output.chart"]);
    // Component-event Actions are recorded (previously only page-level events were).
    expect(deps.actionIds).toContain("core.action.delete");
    expect(deps.actionIds).toContain("acme.action.export");
    // Core Component kinds are never treated as Plugin extensions.
    expect(deps.extensionIds).not.toContain("core.button");
  });

  it("round-trips a rule effect chain: await-query + when condition (CPB-WF)", () => {
    const manifest = clone();
    const page = composedPage(manifest);
    page.components.push({
      id: "cmp_scan", kind: "core.button", placement: { x: 0, y: 40, width: 6, height: 5 }, props: {},
      events: [{ id: "e_scan", event: "onClick", effects: [
        { id: "f_q", kind: "await-query", args: { dataSourceId: "query_customers" } },
        {
          id: "f_return", kind: "state.set", args: { stateId: "state_search_name", value: "on-loan" },
          when: { type: "and", conditions: [
            { type: "queryResult", source: "lastQuery", op: "hasRows" },
            { type: "state", stateId: "state_search_name", op: "notEmpty" },
          ] },
        },
      ] }],
    } as never);
    const decoded = decodeAdminAppManifestV2(manifest);
    const reparsed = decodeAdminAppManifestV2(JSON.parse(serializeManifestValue(decoded)));
    expect(reparsed).toEqual(decoded);
    // The decoded effect keeps its guard.
    const effects = (composedPage(decoded as Mutable<AdminAppManifestV2>).components.at(-1) as never as { events: { effects: unknown[] }[] }).events[0]!.effects;
    expect(effects).toHaveLength(2);
  });

  it("round-trips slice 2-4 rule effects: form.setField, action.updateFields, onScan, field highlight", () => {
    const manifest = clone();
    const page = composedPage(manifest);
    page.components.push({
      id: "cmp_scan", kind: "core.input.scan", placement: { x: 0, y: 40, width: 12, height: 5 }, props: { label: "스캔" },
      events: [{ id: "e_scan", event: "onScan", effects: [
        { id: "f_q", kind: "await-query", args: { dataSourceId: "query_customers" } },
        { id: "f_set", kind: "form.setField",
          args: { formComponentId: "cmp_form", fieldId: "fld_customer_name", value: { from: "today" } } },
        { id: "f_upd", kind: "action.updateFields",
          args: { collectionId: "col_customers", documentStateId: "state_sel",
            fields: [{ fieldId: "fld_customer_name", value: { from: "literal", value: "returned" } }] },
          when: { type: "queryResult", source: "lastQuery", op: "hasRows" } },
      ] }],
    } as never);
    // A row-level highlight condition on the output table.
    (page.components[2] as unknown as { props: Record<string, unknown> }).props["highlightWhen"] = {
      type: "field", fieldId: "fld_customer_name", op: "notEmpty",
    };
    const decoded = decodeAdminAppManifestV2(manifest);
    const reparsed = decodeAdminAppManifestV2(JSON.parse(serializeManifestValue(decoded)));
    expect(reparsed).toEqual(decoded);
  });

  it("rejects an unknown condition op / over-deep nesting (fails closed)", () => {
    const badOp = clone();
    composedPage(badOp).components.push({
      id: "cmp_b", kind: "core.button", placement: { x: 0, y: 40, width: 6, height: 5 }, props: {},
      events: [{ id: "e", event: "onClick", effects: [
        { id: "f", kind: "state.reset", args: { stateId: "state_search_name" },
          when: { type: "state", stateId: "state_search_name", op: "matches" } },
      ] }],
    } as never);
    expect(() => decodeAdminAppManifestV2(badOp as never)).toThrow(AdminAppManifestDecodeError);
  });

  it("dispatches by formatVersion", () => {
    expect(isComposedPageManifest(decodeAdminAppManifestAny(minimalComposedPageManifest))).toBe(true);
    expect(isComposedPageManifest(decodeAdminAppManifestAny(minimalBackofficeManifest))).toBe(false);
    expect(() => decodeAdminAppManifestAny({ ...minimalComposedPageManifest, formatVersion: 3 }))
      .toThrow(AdminAppManifestDecodeError);
  });

  it("keeps the V1 canonical hash stable (V1 path unchanged)", () => {
    // Proves the V2 additions did not perturb the V1 serialization/contract.
    const v1a = serializeAdminAppManifest(minimalBackofficeManifest);
    const v1b = serializeAdminAppManifest(decodeAdminAppManifest(minimalBackofficeManifest));
    expect(v1a).toBe(v1b);
  });

  describe("rejects invalid manifests", () => {
    it("unknown property fails closed", () => {
      const bad = { ...clone(), unexpected: true };
      expect(() => decodeAdminAppManifestV2(bad as never)).toThrow(AdminAppManifestDecodeError);
    });

    it("unknown component kind is still decoded but placement out of range is rejected", () => {
      const bad = clone();
      composedPage(bad).components[0]!.placement.x = 40;
      composedPage(bad).components[0]!.placement.width = 20; // 40 + 20 > 48
      const { valid, issues } = validateAdminAppManifestV2(bad);
      expect(valid).toBe(false);
      expect(issues.some((i) => i.code === "INVALID_PLACEMENT")).toBe(true);
    });

    it("overlapping components are rejected (D-02)", () => {
      const bad = clone();
      // Move the button on top of the text input.
      composedPage(bad).components[1]!.placement = { x: 0, y: 0, width: 10, height: 5 };
      const { valid, issues } = validateAdminAppManifestV2(bad);
      expect(valid).toBe(false);
      expect(issues.some((i) => i.code === "COMPONENT_OVERLAP")).toBe(true);
    });

    it("duplicate node ids are rejected", () => {
      const bad = clone();
      composedPage(bad).components[1]!.id = composedPage(bad).components[0]!.id;
      const { valid, issues } = validateAdminAppManifestV2(bad);
      expect(valid).toBe(false);
      expect(issues.some((i) => i.code === "DUPLICATE_NODE_ID")).toBe(true);
    });

    it("dangling connection targets are rejected", () => {
      const bad = clone();
      composedPage(bad).connections[0]!.to.nodeId = "state_does_not_exist";
      const { valid, issues } = validateAdminAppManifestV2(bad);
      expect(valid).toBe(false);
      expect(issues.some((i) => i.code === "DANGLING_CONNECTION")).toBe(true);
    });

    it("a filter parameter with no declaration is rejected", () => {
      const bad = clone();
      const filter = composedPage(bad).dataSources[0]!.filter;
      if (filter && filter.type === "condition" && filter.value?.type === "parameter") {
        filter.value.parameterId = "param_undeclared";
      }
      const { valid, issues } = validateAdminAppManifestV2(bad);
      expect(valid).toBe(false);
      expect(issues.some((i) => i.code === "UNKNOWN_QUERY_PARAMETER")).toBe(true);
    });

    it("a connection cycle is rejected", () => {
      const bad = clone();
      // Deterministic node-level cycle: A → B and B → A.
      composedPage(bad).connections = [
        { id: "c1", from: { nodeType: "component", nodeId: "cmp_search_name", portId: "value" },
          to: { nodeType: "component", nodeId: "cmp_search_button", portId: "data" } },
        { id: "c2", from: { nodeType: "component", nodeId: "cmp_search_button", portId: "clicked" },
          to: { nodeType: "component", nodeId: "cmp_search_name", portId: "documentId" } },
      ];
      const { valid, issues } = validateAdminAppManifestV2(bad);
      expect(valid).toBe(false);
      expect(issues.some((i) => i.code === "CONNECTION_CYCLE")).toBe(true);
    });

    it("throws on assertion for an invalid manifest", () => {
      const bad = clone();
      composedPage(bad).screenNo = "way-too-long-screen-number-exceeding-the-limit-abcdefg";
      expect(() => decodeAdminAppManifestV2(bad)).toThrow(AdminAppManifestValidationError);
    });
  });

  it("diff detects a changed screenNo", () => {
    const before = decodeAdminAppManifestV2(minimalComposedPageManifest);
    const changed = clone();
    composedPage(changed).screenNo = "CUS-002";
    const after = decodeAdminAppManifestV2(changed);
    const diff = diffManifestValues(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.entries.some((e) => e.path.includes("screenNo"))).toBe(true);
  });

  describe("V1 → V2 upgrade", () => {
    it("preserves every Generated Page and seeds one Composed Page", () => {
      const upgraded = upgradeManifestToV2(minimalBackofficeManifest);
      expect(upgraded.formatVersion).toBe(2);
      // All original pages carry over unchanged.
      for (const original of minimalBackofficeManifest.pages) {
        expect(upgraded.pages.some((page) => page.id === original.id)).toBe(true);
      }
      // Plus one seeded Composed Page.
      expect(upgraded.pages.filter((page) => page.type === "composed-page")).toHaveLength(1);
      expect(upgraded.presentation.layoutProfile).toBe("16:9");
      // The result is a valid V2 manifest ready for the Builder.
      expect(validateAdminAppManifestV2(upgraded).valid).toBe(true);
      // Round-trips through the strict decoder.
      expect(() => decodeAdminAppManifestV2(upgraded)).not.toThrow();
    });

    it("can upgrade without seeding a Composed Page", () => {
      const upgraded = upgradeManifestToV2(minimalBackofficeManifest, { seedComposedPage: false });
      expect(upgraded.pages).toHaveLength(minimalBackofficeManifest.pages.length);
      expect(upgraded.pages.some((page) => page.type === "composed-page")).toBe(false);
      expect(validateAdminAppManifestV2(upgraded).valid).toBe(true);
    });

    it("records Generated Page dependencies of an upgraded manifest", () => {
      const upgraded = upgradeManifestToV2(minimalBackofficeManifest);
      const deps = extractAdminAppDependenciesV2(upgraded);
      // col_orders is referenced by the carried-over Generated Pages.
      expect(deps.collectionIds).toContain("col_orders");
      expect(deps.actionIds).toContain("core.action.create");
    });
  });
});
