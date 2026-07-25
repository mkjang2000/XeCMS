import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { COLUMN_WIDTH, ROW_HEIGHT, CANVAS_WIDTH } from "@xecms/admin-runtime/geometry";
import { nodeBoxLayout, nodeKey } from "./node-layout.js";
import { dataSourcePorts, statePorts } from "./ports.js";
import styles from "./composed-editor.module.css";
/** SVG overlay drawing typed connection lines between node anchors. */
export function ConnectionOverlay({ page, selectedConnectionId, highlightNodeId, showAll, onSelectConnection, }) {
    const layout = nodeBoxLayout(page);
    const height = canvasHeight(page, layout.stripTop + layout.stripHeight);
    return (_jsx("svg", { className: styles.connectionLayer, style: { width: CANVAS_WIDTH, height }, viewBox: `0 0 ${CANVAS_WIDTH} ${height}`, "aria-hidden": "true", children: page.connections.map((connection) => {
            const from = anchorPoint(page, connection.from, "out", layout.boxes);
            const to = anchorPoint(page, connection.to, "in", layout.boxes);
            if (from === null || to === null)
                return null;
            const related = highlightNodeId === null
                || connection.from.nodeId === highlightNodeId
                || connection.to.nodeId === highlightNodeId;
            const dimmed = !showAll && !related;
            return (_jsx("path", { className: [
                    styles.connectionLine,
                    connection.id === selectedConnectionId ? styles.connectionSelected : "",
                    dimmed ? styles.connectionDimmed : "",
                ].filter(Boolean).join(" "), d: curve(from, to), onClick: (event) => { event.stopPropagation(); onSelectConnection(connection.id); } }, connection.id));
        }) }));
}
/** Non-visual State / Data Source node boxes rendered in the reserved strip. */
export function NodeStrip({ page, selectedNodeId, pendingFrom, onSelectNode, onPortClick, canConnect }) {
    const { boxes } = nodeBoxLayout(page);
    const nodes = [
        ...page.state.map((state) => ({ type: "state", id: state.id, label: `상태 ${state.id}`, ports: statePorts(state) })),
        ...page.dataSources.map((source) => ({ type: "data-source", id: source.id, label: `쿼리 ${source.id}`, ports: dataSourcePorts(source) })),
    ];
    return (_jsx(_Fragment, { children: nodes.map((node) => {
            const box = boxes.get(nodeKey(node.type, node.id));
            if (box === undefined)
                return null;
            return (_jsxs("div", { className: [styles.nodeBox, node.id === selectedNodeId ? styles.nodeBoxSelected : ""].filter(Boolean).join(" "), style: { left: box.x, top: box.y, width: box.width, minHeight: box.height }, onPointerDown: (event) => { event.stopPropagation(); onSelectNode(node.type, node.id); }, children: [_jsx("span", { className: styles.nodeBoxKind, children: node.type === "state" ? "STATE" : "QUERY" }), _jsx("strong", { children: node.id }), _jsx("div", { className: styles.ports, children: node.ports.map((spec) => {
                            const reference = { nodeType: node.type, nodeId: node.id, portId: spec.portId };
                            const compatible = spec.direction === "in" && pendingFrom !== null && canConnect({ from: pendingFrom, to: reference });
                            return (_jsx("button", { type: "button", className: [styles.port, spec.direction === "out" ? styles.portOut : styles.portIn, compatible ? styles.portCompatible : ""].filter(Boolean).join(" "), onClick: (event) => { event.stopPropagation(); onPortClick(reference, spec); }, title: `${spec.label} (${spec.valueType})`, children: spec.label }, spec.portId));
                        }) })] }, `${node.type}:${node.id}`));
        }) }));
}
function canvasHeight(page, stripBottom) {
    const rows = Math.max(100, ...page.components.map((component) => component.placement.y + component.placement.height));
    return Math.max(rows * ROW_HEIGHT, stripBottom);
}
/** Anchors a port on the edge of its node box (component grid or strip node). */
function anchorPoint(page, port, direction, boxes) {
    if (port.nodeType === "component") {
        const component = page.components.find(({ id }) => id === port.nodeId);
        if (component === undefined)
            return null;
        const { x, y, width, height } = component.placement;
        return {
            x: (direction === "out" ? x + width : x) * COLUMN_WIDTH,
            y: (y + height / 2) * ROW_HEIGHT,
        };
    }
    const box = boxes.get(nodeKey(port.nodeType, port.nodeId));
    if (box === undefined)
        return null;
    return {
        x: direction === "out" ? box.x + box.width : box.x,
        y: box.y + box.height / 2,
    };
}
function curve(from, to) {
    const midX = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}
export function connectionSummary(connection) {
    return `${connection.from.nodeId}.${connection.from.portId} → ${connection.to.nodeId}.${connection.to.portId}`;
}
//# sourceMappingURL=connections.js.map