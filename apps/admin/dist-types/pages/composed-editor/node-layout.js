import { CANVAS_WIDTH, ROW_HEIGHT } from "@xecms/admin-runtime/geometry";
const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;
const NODE_GAP = 16;
const STRIP_PADDING = 24;
/** Key for a non-visual node in the layout map (nodeType + id). */
export function nodeKey(nodeType, nodeId) {
    return `${nodeType}\0${nodeId}`;
}
/**
 * Places State and Data Source node boxes in a reserved strip below the
 * component grid. These editor-only coordinates are derived deterministically
 * from declaration order and are never written to the Manifest.
 */
export function nodeBoxLayout(page) {
    const lowestComponentRow = page.components.reduce((max, component) => Math.max(max, component.placement.y + component.placement.height), 0);
    const stripTop = (lowestComponentRow + 2) * ROW_HEIGHT;
    const boxes = new Map();
    const perRow = Math.max(1, Math.floor((CANVAS_WIDTH - STRIP_PADDING * 2 + NODE_GAP) / (NODE_WIDTH + NODE_GAP)));
    const nodes = [
        ...page.state.map((state) => ({ key: nodeKey("state", state.id) })),
        ...page.dataSources.map((source) => ({ key: nodeKey("data-source", source.id) })),
    ];
    nodes.forEach((node, index) => {
        const col = index % perRow;
        const row = Math.floor(index / perRow);
        boxes.set(node.key, {
            x: STRIP_PADDING + col * (NODE_WIDTH + NODE_GAP),
            y: stripTop + STRIP_PADDING + row * (NODE_HEIGHT + NODE_GAP),
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
        });
    });
    const rows = Math.ceil(nodes.length / perRow);
    const stripHeight = nodes.length === 0 ? 0 : STRIP_PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP;
    return { boxes, stripTop, stripHeight };
}
//# sourceMappingURL=node-layout.js.map