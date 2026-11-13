import { describe, expect, it } from "vitest";
import { decodeAdminAppManifestV2, validatePageAuthoring, minimalComposedPageManifest } from "@xecms/admin-apps";
import { addBusinessTemplate, removeAuthoredBlock, replaceBlock } from "./model.js";

describe("business screen editing", () => {
  const collection = { id: "col_customers", name: "customers", fields: [{ id: "fld_customer_name", name: "name", type: "text" as const, required: true }], status: "applied" as const, hasPendingChanges: false, revisionId: "rev_1" };
  const original = minimalComposedPageManifest.pages[0];
  const empty = { ...original, components: [], state: [], dataSources: [], connections: [], authoring: { version: 1 as const, blocks: [] } };
  it("creates a search/list/detail/edit journey and retains settings after save/reopen", () => {
    const page = addBusinessTemplate(empty, collection);
    expect(page.authoring?.blocks.map((b) => b.kind)).toEqual(["search", "list", "detail", "form"]);
    const search = page.authoring!.blocks[0]!;
    const edited = replaceBlock(page, { ...search, title: "고객명 검색", placement: { ...search.placement, width: 40 } });
    const reopened = decodeAdminAppManifestV2(JSON.parse(JSON.stringify({ ...minimalComposedPageManifest, pages: [edited] })));
    expect(reopened.pages[0]).toEqual(edited);
    expect(edited.connections).toEqual(page.connections);
  });
  it("keeps a deleted selection source visible as an unresolved reference", () => {
    const page = addBusinessTemplate(empty, collection);
    const deleted = removeAuthoredBlock(page, page.authoring!.blocks[1]!.id);
    expect(validatePageAuthoring(deleted.authoring!).filter((i) => i.path[2] === "input")).toHaveLength(2);
  });
});
