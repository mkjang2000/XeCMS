import { describe, expect, it } from "vitest";
import { pointToCell, clampPlacement, placementsOverlap } from "@xecms/admin-runtime/geometry";
import { addComponent, addConnection, addDataSource, addState, canPlace, nextDataSourceId, nextStateId, removeComponent, removeDataSource, removeState, updatePlacement, } from "./model.js";
import { canConnect, newConnectionId } from "./ports.js";
function emptyPage() {
    return {
        id: "pg_edit",
        type: "composed-page",
        screenNo: "EDT-001",
        title: "편집",
        menuLabel: "편집",
        layout: { columns: 48, rowHeight: 8 },
        state: [
            { id: "state_name", valueType: "string", initialValue: "" },
            { id: "state_other", valueType: "string", initialValue: "" },
        ],
        dataSources: [{
                id: "query_x",
                type: "document-query",
                collectionId: "col_customers",
                trigger: "manual",
                fields: ["fld_name"],
                parameters: [{ id: "param_name", valueType: "string" }],
                limit: 20,
            }],
        components: [
            { id: "cmp_input", kind: "core.input.text", placement: { x: 0, y: 0, width: 16, height: 5 }, props: {} },
            { id: "cmp_button", kind: "core.button", placement: { x: 17, y: 0, width: 5, height: 5 }, props: {} },
            { id: "cmp_table", kind: "core.output.table", placement: { x: 0, y: 7, width: 30, height: 30 }, props: {} },
        ],
        connections: [],
    };
}
describe("editor geometry", () => {
    it("snaps pixel offsets to grid cells", () => {
        expect(pointToCell(0, 0)).toEqual({ x: 0, y: 0 });
        expect(pointToCell(24 * 3 + 5, 8 * 4 + 2)).toEqual({ x: 3, y: 4 });
    });
    it("clamps placement into canvas bounds", () => {
        expect(clampPlacement({ x: 45, y: -2, width: 10, height: 0 }))
            .toEqual({ x: 38, y: 0, width: 10, height: 1 });
    });
    it("detects rectangle overlap", () => {
        expect(placementsOverlap({ x: 0, y: 0, width: 4, height: 4 }, { x: 2, y: 2, width: 4, height: 4 })).toBe(true);
        expect(placementsOverlap({ x: 0, y: 0, width: 4, height: 4 }, { x: 4, y: 0, width: 4, height: 4 })).toBe(false);
    });
});
describe("component placement", () => {
    it("rejects a move that collides and keeps the page unchanged", () => {
        const page = emptyPage();
        const moved = updatePlacement(page, "cmp_button", { x: 0, y: 0, width: 5, height: 5 });
        expect(moved).toBe(page); // overlaps cmp_input → no change
    });
    it("accepts a non-colliding move", () => {
        const page = emptyPage();
        const moved = updatePlacement(page, "cmp_button", { x: 24, y: 0, width: 5, height: 5 });
        expect(moved.components.find(({ id }) => id === "cmp_button").placement.x).toBe(24);
    });
    it("adds a component into the first free slot", () => {
        const page = emptyPage();
        const next = addComponent(page, { id: "cmp_new", kind: "core.layout.title", props: {} }, { width: 10, height: 4 });
        const added = next.components.find(({ id }) => id === "cmp_new");
        expect(canPlace(next, "cmp_new", added.placement)).toBe(true);
    });
    it("removing a component drops its connections", () => {
        let page = emptyPage();
        page = addConnection(page, {
            id: "c1",
            from: { nodeType: "component", nodeId: "cmp_input", portId: "value" },
            to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        });
        const next = removeComponent(page, "cmp_input");
        expect(next.connections).toHaveLength(0);
    });
});
describe("state and data-source CRUD", () => {
    it("adds a state with a unique id", () => {
        const page = emptyPage();
        const id = nextStateId(page);
        expect(id).toBe("state_1"); // state_name has no numeric suffix
        const next = addState(page, { id, valueType: "string", initialValue: "" });
        expect(next.state.some((entry) => entry.id === id)).toBe(true);
    });
    it("removing a state drops connections that reference it", () => {
        let page = emptyPage();
        page = addConnection(page, {
            id: "c1",
            from: { nodeType: "component", nodeId: "cmp_input", portId: "value" },
            to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        });
        const next = removeState(page, "state_name");
        expect(next.state.some((entry) => entry.id === "state_name")).toBe(false);
        expect(next.connections).toHaveLength(0);
    });
    it("adds and removes a data source, cleaning connections", () => {
        let page = emptyPage();
        const id = nextDataSourceId(page); // query_x exists → query_1
        page = addDataSource(page, {
            id, type: "document-query", collectionId: "col_customers", trigger: "manual", fields: [], limit: 20,
        });
        page = addConnection(page, {
            id: "c1",
            from: { nodeType: "component", nodeId: "cmp_button", portId: "clicked" },
            to: { nodeType: "data-source", nodeId: id, portId: "execute" },
        });
        const next = removeDataSource(page, id);
        expect(next.dataSources.some((source) => source.id === id)).toBe(false);
        expect(next.connections).toHaveLength(0);
    });
});
describe("connection validation", () => {
    it("allows an output→input connection with compatible types", () => {
        const page = emptyPage();
        expect(canConnect(page, {
            from: { nodeType: "component", nodeId: "cmp_input", portId: "value" },
            to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        })).toBe(true);
    });
    it("rejects wrong direction (input as source)", () => {
        const page = emptyPage();
        expect(canConnect(page, {
            from: { nodeType: "state", nodeId: "state_name", portId: "write" },
            to: { nodeType: "component", nodeId: "cmp_input", portId: "value" },
        })).toBe(false);
    });
    it("rejects incompatible value types", () => {
        const page = emptyPage();
        // button.clicked (event) → detail.documentId (document-id)
        expect(canConnect(page, {
            from: { nodeType: "component", nodeId: "cmp_button", portId: "clicked" },
            to: { nodeType: "component", nodeId: "cmp_table", portId: "data" },
        })).toBe(false);
    });
    it("rejects a second inbound connection on a single-input port", () => {
        let page = emptyPage();
        page = addConnection(page, {
            id: "c1",
            from: { nodeType: "component", nodeId: "cmp_input", portId: "value" },
            to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        });
        // state_name.write already has one inbound; another must be rejected.
        expect(canConnect(page, {
            from: { nodeType: "data-source", nodeId: "query_x", portId: "rows" },
            to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        })).toBe(false);
    });
    it("rejects a connection that would create a cycle", () => {
        let page = emptyPage();
        // state_name.value(string) → state_other.write closes a loop once the reverse exists.
        page = addConnection(page, {
            id: "c1",
            from: { nodeType: "state", nodeId: "state_name", portId: "value" },
            to: { nodeType: "state", nodeId: "state_other", portId: "write" },
        });
        // state_other.value → state_name.write would form state_name → state_other → state_name.
        expect(canConnect(page, {
            from: { nodeType: "state", nodeId: "state_other", portId: "value" },
            to: { nodeType: "state", nodeId: "state_name", portId: "write" },
        })).toBe(false);
    });
    it("generates unique connection ids", () => {
        const existing = [{ id: "conn_1" }];
        expect(newConnectionId(existing)).toBe("conn_2");
    });
});
//# sourceMappingURL=model.test.js.map