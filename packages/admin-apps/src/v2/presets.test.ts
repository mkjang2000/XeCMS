import { describe, expect, it } from "vitest";

import { decodeAdminAppManifestV2 } from "./decode.js";
import { assertValidAdminAppManifestV2 } from "./validate.js";
import {
  convertGeneratedToComposed,
  masterDetailPreset,
  searchListPreset,
  viewEditPreset,
} from "./presets.js";
import type { AdminAppManifestV2, ComposedPageDefinition } from "./types.js";
import type { AdminPageDefinition } from "../types.js";

/** Wraps a Composed Page in a minimal V2 manifest so it can be decoded/validated. */
function wrap(page: ComposedPageDefinition): AdminAppManifestV2 {
  return {
    format: "xecms.admin-app",
    formatVersion: 2,
    id: "app-preset",
    name: "Preset App",
    key: "app-preset",
    audience: { type: "system" },
    presentation: { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" },
    navigation: [{ id: "nav_1", label: page.menuLabel, pageId: page.id }],
    pages: [page],
    startPageId: page.id,
  };
}

/** Every Preset must produce a page that survives decode round-trip + validation. */
function expectSameRuntimeContract(page: ComposedPageDefinition): void {
  const manifest = wrap(page);
  // Round-trip: a preset-built page decodes to the identical structure.
  expect(decodeAdminAppManifestV2(manifest).pages[0]).toEqual(page);
  // And it satisfies every structural rule (placement/overlap/ids/wiring).
  expect(() => assertValidAdminAppManifestV2(manifest)).not.toThrow();
}

const meta = { pageId: "pg_x", screenNo: "SCR-001", title: "화면", menuLabel: "화면" };

describe("composed page presets (CPB-8)", () => {
  it("searchList produces a valid, decodable page (same Runtime Contract)", () => {
    expectSameRuntimeContract(searchListPreset({
      meta, collectionId: "col_people", searchFieldId: "fld_name",
      columns: [
        { fieldId: "fld_name", label: "이름" },
        { fieldId: "fld_email", label: "이메일", maskPolicyId: "core.mask.email" },
      ],
    }));
  });

  it("masterDetail wires the table selection to a detail panel", () => {
    const page = masterDetailPreset({
      meta, collectionId: "col_people", searchFieldId: "fld_name",
      listColumns: [{ fieldId: "fld_name" }],
      detailFields: [{ fieldId: "fld_name" }, { fieldId: "fld_email", maskPolicyId: "core.mask.email" }],
    });
    expectSameRuntimeContract(page);
    // The selection connection and the detail component both exist.
    expect(page.components.some((c) => c.kind === "core.output.detail")).toBe(true);
    expect(page.connections.some((c) => c.to.portId === "documentId")).toBe(true);
  });

  it("viewEdit adds a form and a save button whose Action targets the selection", () => {
    const page = viewEditPreset({
      meta, collectionId: "col_people", searchFieldId: "fld_name",
      listColumns: [{ fieldId: "fld_name" }],
      detailFields: [{ fieldId: "fld_name" }],
      formFieldIds: ["fld_name", "fld_email"],
    });
    expectSameRuntimeContract(page);
    const save = page.components.find((c) => c.id === "pg_x_save");
    const effect = save?.events?.[0]?.effects[0];
    expect(effect?.kind).toBe("action.execute");
    expect(effect?.args?.["actionId"]).toBe("core.action.update");
    expect(effect?.args?.["formComponentId"]).toBe("pg_x_form");
  });
});

describe("convertGeneratedToComposed (CPB-8)", () => {
  it("converts a collection-list into a search+list Composed Page with a new id", () => {
    const generated: AdminPageDefinition = {
      id: "orders", type: "collection-list", collectionId: "col_orders",
      columns: [
        { id: "c1", field: { kind: "data", fieldId: "fld_number" }, label: "번호" },
        { id: "c2", field: { kind: "system", field: "createdAt" }, label: "생성" },
      ],
    };
    const composed = convertGeneratedToComposed(generated, meta);
    expect(composed).not.toBeNull();
    expectSameRuntimeContract(composed!);
    // The original id is not reused, and only the data column survives as a column.
    expect(composed!.id).toBe("pg_x");
    const table = composed!.components.find((c) => c.kind === "core.output.table");
    expect((table!.props["columns"] as unknown[])).toHaveLength(1);
  });

  it("converts a document-detail into a detail-only Composed Page", () => {
    const generated: AdminPageDefinition = {
      id: "order", type: "document-detail", collectionId: "col_orders",
      layout: { panels: [{ id: "p1", type: "summary", fieldIds: ["fld_number", "fld_total"] }] },
    };
    const composed = convertGeneratedToComposed(generated, meta);
    expect(composed).not.toBeNull();
    expectSameRuntimeContract(composed!);
    expect(composed!.components.some((c) => c.kind === "core.output.detail")).toBe(true);
  });

  it("returns null for a page type with no composed equivalent", () => {
    const dashboard: AdminPageDefinition = {
      id: "home", type: "dashboard", widgets: [],
    } as AdminPageDefinition;
    expect(convertGeneratedToComposed(dashboard, meta)).toBeNull();
  });
});
