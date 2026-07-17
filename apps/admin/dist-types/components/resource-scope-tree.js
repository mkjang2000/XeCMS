import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "../authorization.module.css";
/**
 * Turns the policy's parentId edges into a forest without trusting the server
 * ordering. Invalid/orphan/cyclic resources remain visible as top-level nodes
 * so an administrator can still select and repair their bindings.
 */
export function buildResourceTree(resources) {
    const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
    const childrenByParent = new Map();
    const roots = [];
    for (const resource of resources) {
        if (resource.parentId === undefined
            || resource.parentId === resource.id
            || !resourcesById.has(resource.parentId)) {
            roots.push(resource);
            continue;
        }
        const siblings = childrenByParent.get(resource.parentId) ?? [];
        siblings.push(resource);
        childrenByParent.set(resource.parentId, siblings);
    }
    const visited = new Set();
    const materialize = (resource, ancestors) => {
        visited.add(resource.id);
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(resource.id);
        const children = (childrenByParent.get(resource.id) ?? [])
            .filter((child) => !nextAncestors.has(child.id))
            .map((child) => materialize(child, nextAncestors));
        return { resource, children };
    };
    const forest = roots.map((resource) => materialize(resource, new Set()));
    for (const resource of resources) {
        if (!visited.has(resource.id))
            forest.push(materialize(resource, new Set()));
    }
    return forest;
}
export function resourcePath(resources, resourceId) {
    const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
    const path = [];
    const visited = new Set();
    let current = resourcesById.get(resourceId);
    while (current !== undefined && !visited.has(current.id)) {
        visited.add(current.id);
        path.unshift(current);
        current = current.parentId === undefined
            ? undefined
            : resourcesById.get(current.parentId);
    }
    return path;
}
function resourceTypeLabel(type) {
    switch (type) {
        case "realm": return "Realm";
        case "workspace": return "Workspace";
        case "section": return "영역";
        case "collection": return "Collection";
        case "document": return "Document";
        default: return type;
    }
}
function ResourceNode({ node, value, onChange, isSelectable, isDisabled, }) {
    const selected = value === node.resource.id;
    const selectable = !isDisabled && isSelectable(node.resource);
    return (_jsxs("li", { className: styles.scopeTreeItem, role: "treeitem", "aria-selected": selected, "aria-expanded": node.children.length > 0 ? true : undefined, children: [_jsxs("button", { className: styles.scopeTreeButton, type: "button", "data-selected": selected, disabled: !selectable, "aria-label": `${node.resource.name}, ${resourceTypeLabel(node.resource.type)}${selected ? ", 선택됨" : ""}`, onClick: () => onChange(node.resource.id), children: [_jsx("span", { className: styles.scopeTreeBranch, "aria-hidden": "true" }), _jsx("span", { className: styles.scopeTreeName, children: node.resource.name }), _jsx("span", { className: styles.scopeTreeType, children: resourceTypeLabel(node.resource.type) }), selected ? _jsx("span", { className: styles.scopeTreeSelected, children: "\uC120\uD0DD\uB428" }) : null] }), node.children.length > 0 ? (_jsx("ul", { className: styles.scopeTreeGroup, role: "group", children: node.children.map((child) => (_jsx(ResourceNode, { node: child, value: value, onChange: onChange, isSelectable: isSelectable, isDisabled: isDisabled }, child.resource.id))) })) : null] }));
}
const propagationOptions = [
    { value: "self", label: "현재 리소스", description: "선택한 리소스에만 적용" },
    {
        value: "children",
        label: "하위만 (현재 제외)",
        description: "선택한 리소스 자체에는 적용하지 않고 모든 깊이의 후손에만 적용",
    },
    {
        value: "self-and-children",
        label: "현재 + 모든 하위",
        description: "선택한 리소스 자체와 모든 깊이의 후손에 함께 적용",
    },
];
export function ScopeTreeSelector({ label, description, resources, value, onChange, allowEmpty = false, emptyLabel = "제한 없음", isSelectable = () => true, propagation, onPropagationChange, isDisabled = false, }) {
    const forest = buildResourceTree(resources);
    const selectedPath = value === "" ? [] : resourcePath(resources, value);
    return (_jsxs("fieldset", { className: styles.scopeFieldset, children: [_jsx("legend", { children: label }), description ? _jsx("p", { className: styles.scopeDescription, children: description }) : null, _jsxs("div", { className: styles.scopeTreeViewport, children: [allowEmpty ? (_jsxs("button", { className: styles.scopeEmptyButton, type: "button", "data-selected": value === "", "aria-pressed": value === "", disabled: isDisabled, onClick: () => onChange(""), children: [_jsx("span", { children: emptyLabel }), _jsx("small", { children: "\uBAA8\uB4E0 \uD544\uB4DC\uB97C \uD5C8\uC6A9\uD569\uB2C8\uB2E4." })] })) : null, _jsx("ul", { className: styles.scopeTree, role: "tree", "aria-label": `${label} 리소스 트리`, onKeyDown: (event) => {
                            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                                return;
                            const buttons = [...event.currentTarget.querySelectorAll(`.${styles.scopeTreeButton}:not(:disabled)`)];
                            if (buttons.length === 0)
                                return;
                            const currentIndex = buttons.findIndex((button) => button === document.activeElement);
                            const nextIndex = event.key === "Home"
                                ? 0
                                : event.key === "End"
                                    ? buttons.length - 1
                                    : event.key === "ArrowDown"
                                        ? Math.min(buttons.length - 1, currentIndex + 1)
                                        : Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
                            buttons[nextIndex]?.focus();
                            event.preventDefault();
                        }, children: forest.map((node) => (_jsx(ResourceNode, { node: node, value: value, onChange: onChange, isSelectable: isSelectable, isDisabled: isDisabled }, node.resource.id))) })] }), value ? (_jsxs("div", { className: styles.scopeSelection, "aria-live": "polite", children: [_jsx("span", { children: "\uC120\uD0DD \uACBD\uB85C" }), _jsx("strong", { children: selectedPath.map(({ name }) => name).join(" / ") || value })] })) : null, propagation !== undefined && onPropagationChange !== undefined ? (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.propagationGroup, role: "radiogroup", "aria-label": "Scope \uC804\uD30C \uBC29\uC2DD", children: propagationOptions.map((option) => (_jsxs("label", { "data-selected": propagation === option.value, children: [_jsx("input", { type: "radio", name: `${label}-propagation`, value: option.value, checked: propagation === option.value, disabled: isDisabled, onChange: () => onPropagationChange(option.value) }), _jsxs("span", { children: [_jsx("strong", { children: option.label }), _jsx("small", { children: option.description })] })] }, option.value))) }), propagation === "children" ? (_jsx("p", { className: styles.scopeDescription, role: "note", children: "\uC8FC\uC758: \uD604\uC7AC \uC120\uD0DD\uD55C \uB9AC\uC18C\uC2A4\uC5D0\uC11C\uB294 \uC774 \uC5ED\uD560\uC774 \uC801\uC6A9\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uB9AC\uC18C\uC2A4\uB3C4 \uD3EC\uD568\uD558\uB824\uBA74 \u2018\uD604\uC7AC + \uBAA8\uB4E0 \uD558\uC704\u2019\uB97C \uC120\uD0DD\uD558\uC138\uC694." })) : null] })) : null] }));
}
//# sourceMappingURL=resource-scope-tree.js.map