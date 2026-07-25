import { jsx as _jsx } from "react/jsx-runtime";
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSourcePanel } from "./data-source-panel.js";
afterEach(cleanup);
const collections = [{
        id: "col_people", name: "people", label: "People", kind: "collection",
        fields: [
            { id: "fld_name", name: "fullName", label: "이름", type: "text", required: true },
            { id: "fld_email", name: "email", label: "이메일", type: "text", required: false },
        ],
        status: "applied", hasPendingChanges: false, revisionId: "rev_1",
    }];
function dataSource(overrides = {}) {
    return {
        id: "query_1", type: "document-query", collectionId: "", trigger: "manual",
        fields: [], parameters: [], limit: 20, ...overrides,
    };
}
describe("DataSourcePanel", () => {
    it("selecting a Collection reports the change", async () => {
        const onChange = vi.fn();
        render(_jsx(DataSourcePanel, { dataSource: dataSource(), collections: collections, onChange: onChange, onRemove: () => { } }));
        // The Collection select is the first combobox.
        await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "col_people");
        expect(onChange).toHaveBeenCalled();
        const next = onChange.mock.calls.at(-1)[0];
        expect(next.collectionId).toBe("col_people");
    });
    it("lists the selected Collection's fields as output options", () => {
        render(_jsx(DataSourcePanel, { dataSource: dataSource({ collectionId: "col_people" }), collections: collections, onChange: () => { }, onRemove: () => { } }));
        // The output field checklist exposes each field as a checkbox label.
        expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });
    it("toggling an output field updates fields", async () => {
        const onChange = vi.fn();
        render(_jsx(DataSourcePanel, { dataSource: dataSource({ collectionId: "col_people" }), collections: collections, onChange: onChange, onRemove: () => { } }));
        // First checkbox is the fld_name output field.
        await userEvent.click(screen.getAllByRole("checkbox")[0]);
        const next = onChange.mock.calls.at(-1)[0];
        expect(next.fields).toContain("fld_name");
    });
    it("adds a parameter and can bind a filter value to it", async () => {
        const onChange = vi.fn();
        render(_jsx(DataSourcePanel, { dataSource: dataSource({ collectionId: "col_people" }), collections: collections, onChange: onChange, onRemove: () => { } }));
        await userEvent.click(screen.getByRole("button", { name: "+ 파라미터" }));
        const next = onChange.mock.calls.at(-1)[0];
        expect(next.parameters).toEqual([{ id: "param_1", valueType: "string" }]);
    });
});
//# sourceMappingURL=data-source-panel.test.js.map