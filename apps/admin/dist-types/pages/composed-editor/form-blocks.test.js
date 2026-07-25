import { describe, expect, it } from "vitest";
import { assertValidAdminAppManifestV2 } from "@xecms/admin-apps";
import { addBlockToPage, blockIdOf, blockLinks, canLinkBlocks, describeBlocks, linkBlocks, reconfigureBlock, removeBlockFromPage, setComponentLabel, unlinkBlocks, } from "./form-blocks.js";
function emptyPage() {
    return {
        id: "pg", type: "composed-page", screenNo: "SCR-001", title: "화면", menuLabel: "화면",
        layout: { columns: 48, rowHeight: 8 }, state: [], dataSources: [], components: [], connections: [],
    };
}
/** Wraps a page so it can go through the real V2 validator (same Runtime Contract). */
function assertValid(page) {
    const manifest = {
        format: "xecms.admin-app", formatVersion: 2, id: "app-x", name: "X", key: "app-x",
        audience: { type: "system" },
        presentation: { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" },
        navigation: [{ id: "nav_1", label: "화면", pageId: "pg" }], pages: [page], startPageId: "pg",
    };
    expect(() => assertValidAdminAppManifestV2(manifest)).not.toThrow();
}
const cols = [
    { fieldId: "fld_name", label: "이름" },
    { fieldId: "fld_email", label: "이메일", maskPolicyId: "core.mask.email" },
];
describe("form blocks (CPB-UX)", () => {
    it("adds a search block as a valid bundle (input+button+query+state, wired)", () => {
        const { page, blockId } = addBlockToPage(emptyPage(), { kind: "search", collectionId: "col_people", fields: cols, searchFieldId: "fld_name" });
        assertValid(page);
        // Atoms are all prefixed by the block id.
        expect(page.components.every((c) => blockIdOf(c.id) === blockId)).toBe(true);
        expect(page.state).toHaveLength(1);
        expect(page.dataSources).toHaveLength(1);
        // The search wiring exists (input→state→param, button→execute).
        expect(page.connections).toHaveLength(3);
    });
    it("adds every block kind as a valid, decodable bundle", () => {
        const kinds = [
            "search", "date-search", "select-search", "number-search", "multi-search",
            "list", "cards", "detail", "field", "input-form", "item-actions",
        ];
        for (const kind of kinds) {
            const { page, blockId } = addBlockToPage(emptyPage(), { kind, collectionId: "col_people", fields: cols });
            assertValid(page);
            // describeBlocks recovers the exact kind from the stamped `_blockKind`.
            expect(describeBlocks(page).find((b) => b.id === blockId)?.kind).toBe(kind);
        }
    });
    it("stacks a second block below the first without overlap", () => {
        const first = addBlockToPage(emptyPage(), { kind: "search", collectionId: "col_people", fields: cols });
        const second = addBlockToPage(first.page, { kind: "list", collectionId: "col_people", fields: cols });
        assertValid(second.page);
        expect(second.blockId).not.toBe(first.blockId);
    });
    it("describes placed blocks with inferred kinds and collections", () => {
        let page = emptyPage();
        page = addBlockToPage(page, { kind: "search", collectionId: "col_people", fields: cols }).page;
        page = addBlockToPage(page, { kind: "list", collectionId: "col_loans", fields: cols }).page;
        const blocks = describeBlocks(page);
        expect(blocks.map((b) => b.kind).sort()).toEqual(["list", "search"]);
        expect(blocks.find((b) => b.kind === "search")?.collectionId).toBe("col_people");
        expect(blocks.find((b) => b.kind === "list")?.collectionId).toBe("col_loans");
    });
    it("removes a block and every atom it owns, leaving the other block intact", () => {
        let page = emptyPage();
        const a = addBlockToPage(page, { kind: "search", collectionId: "col_people", fields: cols });
        page = a.page;
        const b = addBlockToPage(page, { kind: "list", collectionId: "col_people", fields: cols });
        page = b.page;
        page = removeBlockFromPage(page, a.blockId);
        assertValid(page);
        // Only the list block's atoms survive.
        expect(page.components.every((c) => blockIdOf(c.id) === b.blockId)).toBe(true);
        expect(page.state).toHaveLength(0);
        expect(page.dataSources).toHaveLength(0);
        expect(describeBlocks(page).map((block) => block.id)).toEqual([b.blockId]);
    });
});
describe("block label editing (CPB-UX slice 5)", () => {
    it("keeps a custom button label across a field reconfigure", () => {
        const { page, blockId } = addBlockToPage(emptyPage(), { kind: "search", collectionId: "col_people", fields: cols });
        const block = describeBlocks(page).find((b) => b.id === blockId);
        const buttonId = `${blockId}_button`;
        const renamed = setComponentLabel(page, buttonId, "찾기");
        // Change fields → block rebuilds, but the custom label survives.
        const after = reconfigureBlock(renamed, describeBlocks(renamed).find((b) => b.id === blockId), {
            collectionId: "col_people", fields: [{ fieldId: "fld_name" }],
        });
        const button = after.components.find((c) => c.id === buttonId);
        expect(button?.props["label"]).toBe("찾기");
        void block;
    });
});
describe("form-to-form links (CPB-UX slice 3)", () => {
    function block(page, blockId) {
        return describeBlocks(page).find((entry) => entry.id === blockId);
    }
    it("only allows meaningful directions (search→list/detail, list→detail)", () => {
        let page = emptyPage();
        const s = addBlockToPage(page, { kind: "search", collectionId: "col_people", fields: cols });
        page = s.page;
        const l = addBlockToPage(page, { kind: "list", collectionId: "col_people", fields: cols });
        page = l.page;
        const d = addBlockToPage(page, { kind: "detail", collectionId: "col_people", fields: cols });
        page = d.page;
        const search = block(page, s.blockId);
        const list = block(page, l.blockId);
        const detail = block(page, d.blockId);
        expect(canLinkBlocks(search, list)).toBe(true);
        expect(canLinkBlocks(list, detail)).toBe(true);
        expect(canLinkBlocks(detail, list)).toBe(false);
        expect(canLinkBlocks(search, search)).toBe(false);
    });
    it("links search→list (rows→table) and validates", () => {
        let page = emptyPage();
        const s = addBlockToPage(page, { kind: "search", collectionId: "col_people", fields: cols });
        page = s.page;
        const l = addBlockToPage(page, { kind: "list", collectionId: "col_people", fields: cols });
        page = l.page;
        page = linkBlocks(page, block(page, s.blockId), block(page, l.blockId));
        assertValid(page);
        expect(blockLinks(page)).toEqual([{ fromBlockId: s.blockId, toBlockId: l.blockId }]);
        // A rows→data connection now exists.
        expect(page.connections.some((c) => c.to.portId === "data")).toBe(true);
    });
    it("links the new output kinds (search→cards, list→field, list→item-actions)", () => {
        let page = emptyPage();
        const s = addBlockToPage(page, { kind: "search", collectionId: "col_people", fields: cols });
        page = s.page;
        const c = addBlockToPage(page, { kind: "cards", collectionId: "col_people", fields: cols });
        page = c.page;
        page = linkBlocks(page, block(page, s.blockId), block(page, c.blockId));
        const l = addBlockToPage(page, { kind: "list", collectionId: "col_people", fields: cols });
        page = l.page;
        const f = addBlockToPage(page, { kind: "field", collectionId: "col_people", fields: cols });
        page = f.page;
        const a = addBlockToPage(page, { kind: "item-actions", collectionId: "col_people", fields: [] });
        page = a.page;
        page = linkBlocks(page, block(page, l.blockId), block(page, f.blockId));
        page = linkBlocks(page, block(page, l.blockId), block(page, a.blockId));
        assertValid(page);
        expect(blockLinks(page)).toHaveLength(3);
    });
    it("links list→detail (row select → detail) and unlink removes it cleanly", () => {
        let page = emptyPage();
        const l = addBlockToPage(page, { kind: "list", collectionId: "col_people", fields: cols });
        page = l.page;
        const d = addBlockToPage(page, { kind: "detail", collectionId: "col_people", fields: cols });
        page = d.page;
        page = linkBlocks(page, block(page, l.blockId), block(page, d.blockId));
        assertValid(page);
        expect(page.connections.some((c) => c.to.portId === "documentId")).toBe(true);
        expect(page.connections.some((c) => c.from.portId === "selectedDocumentId")).toBe(true);
        page = unlinkBlocks(page, block(page, l.blockId), block(page, d.blockId));
        expect(blockLinks(page)).toEqual([]);
        // The link's connections and the selection state are gone.
        expect(page.connections.some((c) => c.id.includes("_link_"))).toBe(false);
        expect(page.state.some((s) => s.id.endsWith("_state_target"))).toBe(false);
    });
});
//# sourceMappingURL=form-blocks.test.js.map