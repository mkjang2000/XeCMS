export function componentPorts(component) {
    switch (component.kind) {
        case "core.input.text":
        case "core.input.scan":
            return [{ portId: "value", label: "값", direction: "out", valueType: "string" }];
        case "core.input.number":
            return [{ portId: "value", label: "값", direction: "out", valueType: "number" }];
        case "core.input.adaptive": {
            // One output port per variant, typed by the variant's input kind.
            const variants = Array.isArray(component.props["variants"])
                ? component.props["variants"]
                : [];
            return variants.map((variant) => ({
                portId: `value:${variant.id}`,
                label: variant.label ?? variant.id,
                direction: "out",
                valueType: variantValueType(variant.inputKind),
            }));
        }
        case "core.button":
            return [{ portId: "clicked", label: "클릭", direction: "out", valueType: "event" }];
        case "core.output.table":
            return [
                { portId: "data", label: "데이터", direction: "in", valueType: "document[]", single: true },
                { portId: "selectedDocumentId", label: "선택", direction: "out", valueType: "document-id" },
            ];
        case "core.output.detail":
            return [{ portId: "documentId", label: "문서 ID", direction: "in", valueType: "document-id", single: true }];
        case "core.output.chart":
            // Fed by an aggregate Data Source's rows port (slG2).
            return [{ portId: "data", label: "데이터", direction: "in", valueType: "document[]", single: true }];
        default:
            return [];
    }
}
function variantValueType(inputKind) {
    if (inputKind === "number")
        return "number";
    if (inputKind === "date")
        return "date";
    return "string";
}
export function statePorts(state) {
    const valueType = state.valueType === "string[]" ? "any" : state.valueType;
    return [
        { portId: "value", label: "값", direction: "out", valueType },
        { portId: "write", label: "쓰기", direction: "in", valueType, single: true },
    ];
}
export function dataSourcePorts(source) {
    const parameterPorts = (source.parameters ?? []).map((parameter) => ({
        portId: `parameter:${parameter.id}`,
        label: `파라미터 ${parameter.id}`,
        direction: "in",
        valueType: parameter.valueType === "string[]" ? "any" : parameter.valueType,
        single: true,
    }));
    return [
        { portId: "execute", label: "실행", direction: "in", valueType: "event", single: true },
        { portId: "rows", label: "행", direction: "out", valueType: "document[]" },
        ...parameterPorts,
    ];
}
export function portsFor(page, reference) {
    if (reference.nodeType === "component") {
        const component = page.components.find(({ id }) => id === reference.nodeId);
        return component === undefined ? [] : componentPorts(component);
    }
    if (reference.nodeType === "state") {
        const state = page.state.find(({ id }) => id === reference.nodeId);
        return state === undefined ? [] : statePorts(state);
    }
    const source = page.dataSources.find(({ id }) => id === reference.nodeId);
    return source === undefined ? [] : dataSourcePorts(source);
}
export function findPort(page, reference) {
    return portsFor(page, reference).find(({ portId }) => portId === reference.portId);
}
/** Value types connect when equal, or when either side accepts anything. */
export function typesCompatible(from, to) {
    if (from === "any" || to === "any")
        return true;
    return from === to;
}
/** Whether a proposed connection is valid without mutating the page. */
export function canConnect(page, attempt) {
    const from = findPort(page, attempt.from);
    const to = findPort(page, attempt.to);
    if (from === undefined || to === undefined)
        return false;
    if (from.direction !== "out" || to.direction !== "in")
        return false;
    if (!typesCompatible(from.valueType, to.valueType))
        return false;
    if (attempt.from.nodeId === attempt.to.nodeId && attempt.from.nodeType === attempt.to.nodeType)
        return false;
    if (to.single === true && hasInbound(page, attempt.to))
        return false;
    if (wouldCycle(page, attempt.from.nodeId, attempt.to.nodeId))
        return false;
    return true;
}
function hasInbound(page, port) {
    return page.connections.some((connection) => connection.to.nodeType === port.nodeType
        && connection.to.nodeId === port.nodeId
        && connection.to.portId === port.portId);
}
function wouldCycle(page, fromNode, toNode) {
    if (fromNode === toNode)
        return true;
    const adjacency = new Map();
    for (const connection of page.connections) {
        const list = adjacency.get(connection.from.nodeId) ?? [];
        list.push(connection.to.nodeId);
        adjacency.set(connection.from.nodeId, list);
    }
    // Adding fromNode → toNode closes a cycle iff toNode already reaches fromNode.
    const stack = [toNode];
    const seen = new Set();
    while (stack.length > 0) {
        const node = stack.pop();
        if (node === fromNode)
            return true;
        if (seen.has(node))
            continue;
        seen.add(node);
        stack.push(...(adjacency.get(node) ?? []));
    }
    return false;
}
export function newConnectionId(existing) {
    let index = existing.length + 1;
    const ids = new Set(existing.map(({ id }) => id));
    while (ids.has(`conn_${index}`))
        index += 1;
    return `conn_${index}`;
}
//# sourceMappingURL=ports.js.map