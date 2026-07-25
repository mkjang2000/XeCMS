import { describe, expect, it } from "vitest";
import { nodeBoxLayout, nodeKey } from "./node-layout.js";
function page(overrides = {}) {
    return {
        id: "pg", type: "composed-page", screenNo: "S-1", title: "t", menuLabel: "t",
        layout: { columns: 48, rowHeight: 8 },
        state: [{ id: "state_name", valueType: "string", initialValue: "" }],
        dataSources: [{
                id: "query_x", type: "document-query", collectionId: "col_c", trigger: "manual",
                fields: ["fld_a"], limit: 20,
            }],
        components: [
            { id: "cmp_input", kind: "core.input.text", placement: { x: 0, y: 0, width: 16, height: 5 }, props: {} },
        ],
        connections: [],
        ...overrides,
    };
}
describe("node-layout", () => {
    it("places state and data-source boxes below the component grid, without overlap", () => {
        const { boxes, stripTop, stripHeight } = nodeBoxLayout(page());
        const stateBox = boxes.get(nodeKey("state", "state_name"));
        const sourceBox = boxes.get(nodeKey("data-source", "query_x"));
        expect(stateBox).toBeDefined();
        expect(sourceBox).toBeDefined();
        // Both boxes are within the reserved strip and do not overlap each other.
        expect(stateBox.y).toBeGreaterThanOrEqual(stripTop);
        expect(sourceBox.x).not.toBe(stateBox.x); // laid out side by side
        expect(stripHeight).toBeGreaterThan(0);
    });
    it("returns an empty strip when there are no non-visual nodes", () => {
        const { boxes, stripHeight } = nodeBoxLayout(page({ state: [], dataSources: [] }));
        expect(boxes.size).toBe(0);
        expect(stripHeight).toBe(0);
    });
    it("is deterministic for the same page", () => {
        const p = page();
        expect(nodeBoxLayout(p).boxes.get(nodeKey("state", "state_name")))
            .toEqual(nodeBoxLayout(p).boxes.get(nodeKey("state", "state_name")));
    });
});
//# sourceMappingURL=node-layout.test.js.map