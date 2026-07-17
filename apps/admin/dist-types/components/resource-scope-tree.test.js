import { jsx as _jsx } from "react/jsx-runtime";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildResourceTree, resourcePath, ScopeTreeSelector } from "./resource-scope-tree.js";
const resources = [
    { id: "workspace", realmId: "realm", type: "workspace", name: "Workspace", protected: true },
    { id: "content", realmId: "realm", type: "section", name: "Content", parentId: "workspace", protected: true },
    { id: "collection:pages", realmId: "realm", type: "collection", name: "Pages", parentId: "content", protected: false },
    { id: "document:home", realmId: "realm", type: "document", name: "Home", parentId: "collection:pages", protected: false },
    { id: "document:team", realmId: "realm", type: "document", name: "Team", parentId: "document:home", protected: false },
];
afterEach(cleanup);
describe("authorization resource tree", () => {
    it("materializes parentId edges and resolves a selected breadcrumb", () => {
        const tree = buildResourceTree(resources);
        expect(tree).toHaveLength(1);
        expect(tree[0]?.resource.id).toBe("workspace");
        expect(tree[0]?.children[0]?.children[0]?.children[0]?.resource.id).toBe("document:home");
        expect(resourcePath(resources, "document:team").map(({ name }) => name)).toEqual([
            "Workspace",
            "Content",
            "Pages",
            "Home",
            "Team",
        ]);
    });
    it("keeps orphaned and cyclic records visible instead of dropping a selectable scope", () => {
        const malformed = [
            { id: "orphan", realmId: "realm", type: "document", name: "Orphan", parentId: "missing", protected: false },
            { id: "a", realmId: "realm", type: "document", name: "A", parentId: "b", protected: false },
            { id: "b", realmId: "realm", type: "document", name: "B", parentId: "a", protected: false },
        ];
        const flattened = JSON.stringify(buildResourceTree(malformed));
        expect(flattened).toContain("Orphan");
        expect(flattened).toContain("A");
        expect(flattened).toContain("B");
    });
    it("selects a document in the accessible tree and exposes propagation meaning", async () => {
        const onChange = vi.fn();
        const onPropagationChange = vi.fn();
        const user = userEvent.setup();
        render(_jsx(ScopeTreeSelector, { label: "Resource Scope", resources: resources, value: "collection:pages", onChange: onChange, propagation: "self", onPropagationChange: onPropagationChange }));
        const tree = screen.getByRole("tree", { name: "Resource Scope 리소스 트리" });
        expect(within(tree).getAllByRole("treeitem")).toHaveLength(resources.length);
        expect(screen.getByText("Workspace / Content / Pages")).toBeTruthy();
        screen.getByRole("button", { name: "Pages, Collection, 선택됨" }).focus();
        await user.keyboard("{ArrowDown}");
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home, Document" }));
        await user.click(screen.getByRole("button", { name: "Team, Document" }));
        await user.click(screen.getByRole("radio", { name: /현재 \+ 모든 하위/ }));
        expect(onChange).toHaveBeenCalledWith("document:team");
        expect(onPropagationChange).toHaveBeenCalledWith("self-and-children");
    });
    it("warns that children propagation excludes the selected resource", () => {
        render(_jsx(ScopeTreeSelector, { label: "Resource Scope", resources: resources, value: "collection:pages", onChange: vi.fn(), propagation: "children", onPropagationChange: vi.fn() }));
        expect(screen.getByRole("note").textContent).toContain("현재 선택한 리소스에서는 이 역할이 적용되지 않습니다");
    });
});
//# sourceMappingURL=resource-scope-tree.test.js.map