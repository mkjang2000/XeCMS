import { describe, expect, it } from "vitest";
import { decodeAdminAppManifestV2 } from "../v2/decode.js";
import { minimalComposedPageManifest } from "../v2/fixture.js";
import { extractAdminAppDependenciesV2 } from "../v2/dependencies.js";
import { serializeManifestValue } from "../normalize.js";
import { validateAuthoredPage, validatePageAuthoring } from "./validate.js";
import { withPageAuthoring } from "./compile.js";
import { validateAuthoringSchema } from "./schema.js";
import type { PageAuthoringDefinition } from "./types.js";

const source: PageAuthoringDefinition = { version: 1, blocks: [
  { id: "find", kind: "search", title: "고객 검색", collectionId: "col_customers", fieldId: "fld_customer_name", placement: { x: 0, y: 0, width: 30, height: 5 } },
  { id: "customers", kind: "list", title: "고객", collectionId: "col_customers", fields: [{ fieldId: "fld_customer_name", label: "고객명" }], limit: 20,
    input: { blockId: "find", output: "search" }, placement: { x: 0, y: 7, width: 30, height: 24 } },
  { id: "edit", kind: "form", mode: "update", title: "수정", collectionId: "col_customers", fields: [{ fieldId: "fld_customer_name", label: "고객명", inputKind: "text" }],
    input: { blockId: "customers", output: "selection" }, placement: { x: 0, y: 33, width: 30, height: 26 } },
] };
const page = () => withPageAuthoring(minimalComposedPageManifest.pages[0], source);

describe("explicit block authoring", () => {
  it("round-trips source and compiled behavior through the strict manifest decoder", () => {
    const manifest = { ...minimalComposedPageManifest, pages: [page()] };
    const parsed = decodeAdminAppManifestV2(JSON.parse(serializeManifestValue(manifest)));
    expect(parsed.pages[0]).toEqual(page());
    expect(extractAdminAppDependenciesV2(parsed).actionIds).toContain("core.action.update");
    expect(serializeManifestValue(decodeAdminAppManifestV2(JSON.parse(serializeManifestValue(parsed))))).toBe(serializeManifestValue(parsed));
  });

  it("preserves named connections and node identities when fields, labels and placement change", () => {
    const before = page();
    const after = withPageAuthoring(before, { ...source, blocks: source.blocks.map((block) => block.kind === "search"
      ? { ...block, title: "이메일 검색", fieldId: "fld_customer_email" } : block) });
    expect(after.connections).toEqual(before.connections);
    expect(after.components.map((c) => c.id)).toEqual(before.components.map((c) => c.id));
    expect(after.dataSources[0]?.filter).toMatchObject({ field: { fieldId: "fld_customer_email" } });
  });

  it("rejects runtime tampering, unknown authoring properties and future source versions", () => {
    const original = page();
    expect(validateAuthoredPage({ ...original, connections: [] })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "AUTHORING_COMPILE_MISMATCH" })]));
    for (const authoring of [{ ...source, version: 99 }, { ...source, script: "arbitrary" }]) {
      expect(() => decodeAdminAppManifestV2({ ...minimalComposedPageManifest, pages: [{ ...original, authoring }] })).toThrow();
    }
  });

  it("reports deletion and cross-collection input errors without repairing the source silently", () => {
    const deleted = { ...source, blocks: source.blocks.filter((b) => b.id !== "find") };
    expect(validatePageAuthoring(deleted)).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["blocks", 0, "input"] })]));
    const crossed = { ...source, blocks: source.blocks.map((b) => b.id === "find" ? { ...b, collectionId: "col_other" } : b) };
    expect(validatePageAuthoring(crossed).some((issue) => issue.message.includes("같은 컬렉션"))).toBe(true);
  });

  it("checks field ownership and schema type changes before applying", () => {
    const schema = [{ id: "col_customers", fields: [{ id: "fld_customer_name", type: "number" }] }];
    expect(validateAuthoringSchema(source, schema)).toHaveLength(2);
    expect(validateAuthoringSchema(source, [{ id: "col_customers", fields: [] }])).toHaveLength(3);
  });

  it("leaves legacy manifests byte-stable without adding an authoring source", () => {
    expect(serializeManifestValue(decodeAdminAppManifestV2(minimalComposedPageManifest))).toBe(serializeManifestValue(minimalComposedPageManifest));
  });
});
