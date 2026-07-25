import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Button } from "@xecms/ui";
import { validateAdminAppManifestV2, } from "@xecms/admin-apps";
import { ComposedCanvas } from "./canvas.js";
import { ConnectionOverlay, connectionSummary } from "./connections.js";
import { PALETTE, nextComponentId, paletteEntry } from "./catalog.js";
import { addComponent, addConnection, removeComponent, removeConnection, replacePage, updateComponentProps, updatePlacement, } from "./model.js";
import { canConnect, componentPorts, newConnectionId, portsFor } from "./ports.js";
import styles from "./composed-editor.module.css";
export function ComposedPageEditor({ manifest, page, onChange }) {
    const [mode, setMode] = useState("layout");
    const [selectedId, setSelectedId] = useState(null);
    const [selectedConnectionId, setSelectedConnectionId] = useState(null);
    const [showAllConnections, setShowAllConnections] = useState(false);
    const [pendingFrom, setPendingFrom] = useState(null);
    const issues = useMemo(() => validateAdminAppManifestV2(manifest).issues, [manifest]);
    const pageIssues = issues.filter((issue) => issue.path[0] === "pages" && issue.path[1] === pageIndex(manifest, page.id));
    const commit = (next) => onChange(replacePage(manifest, page.id, next));
    const addFromPalette = (kind) => {
        const entry = paletteEntry(kind);
        if (entry === undefined)
            return;
        const id = nextComponentId(page.components, kind);
        commit(addComponent(page, { id, kind, props: { ...entry.defaultProps } }, entry.defaultSize));
        setSelectedId(id);
    };
    const place = (id, placement) => commit(updatePlacement(page, id, placement));
    const selected = page.components.find(({ id }) => id === selectedId) ?? null;
    const onPortClick = (reference, spec) => {
        if (spec.direction === "out") {
            setPendingFrom(reference);
            return;
        }
        if (pendingFrom === null)
            return;
        const attempt = { from: pendingFrom, to: reference };
        if (canConnect(page, attempt)) {
            commit(addConnection(page, {
                id: newConnectionId(page.connections),
                from: pendingFrom,
                to: reference,
            }));
        }
        setPendingFrom(null);
    };
    return (_jsxs("div", { className: styles.editor, children: [_jsxs("div", { className: styles.toolbar, children: [_jsxs("div", { className: styles.modeToggle, role: "tablist", "aria-label": "\uD3B8\uC9D1 \uBAA8\uB4DC", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": mode === "layout", onClick: () => setMode("layout"), children: "\uBC30\uCE58" }), _jsx("button", { type: "button", role: "tab", "aria-selected": mode === "connect", onClick: () => setMode("connect"), children: "\uC5F0\uACB0" })] }), mode === "connect" ? (_jsxs("label", { className: styles.showAll, children: [_jsx("input", { type: "checkbox", checked: showAllConnections, onChange: (event) => setShowAllConnections(event.target.checked) }), "\uC804\uCCB4 \uC5F0\uACB0 \uBCF4\uAE30"] })) : null, pageIssues.length > 0 ? _jsxs("span", { className: styles.issueBadge, children: [pageIssues.length, "\uAC1C \uBB38\uC81C"] }) : null] }), _jsxs("div", { className: styles.workspace, children: [_jsx("aside", { className: styles.palette, "aria-label": "Component \uD314\uB808\uD2B8", children: ["input", "output", "layout"].map((group) => (_jsxs("section", { children: [_jsx("h4", { children: group === "input" ? "입력" : group === "output" ? "출력" : "레이아웃" }), PALETTE.filter((entry) => entry.group === group).map((entry) => (_jsx("button", { type: "button", className: styles.paletteItem, onClick: () => addFromPalette(entry.kind), disabled: mode === "connect", children: entry.label }, entry.kind)))] }, group))) }), _jsx("div", { className: styles.canvasScroll, children: _jsx(ComposedCanvas, { page: page, selectedId: selectedId, locked: mode === "connect", onSelect: (id) => { setSelectedId(id); setSelectedConnectionId(null); }, onPlace: place, overlay: mode === "connect" ? (_jsx(ConnectionOverlay, { page: page, selectedConnectionId: selectedConnectionId, highlightNodeId: selectedId, showAll: showAllConnections, onSelectConnection: setSelectedConnectionId })) : undefined, renderComponent: (component) => (_jsx(ComponentPreview, { component: component, mode: mode, pendingFrom: pendingFrom, page: page, onPortClick: onPortClick })) }) }), _jsx("aside", { className: styles.inspector, "aria-label": "\uC18D\uC131", children: mode === "connect" ? (_jsx(ConnectionInspector, { page: page, selectedConnectionId: selectedConnectionId, onRemove: (id) => { commit(removeConnection(page, id)); setSelectedConnectionId(null); } })) : selected !== null ? (_jsx(ComponentInspector, { component: selected, onChangeProps: (props) => commit(updateComponentProps(page, selected.id, props)), onRemove: () => { commit(removeComponent(page, selected.id)); setSelectedId(null); } })) : (_jsx("p", { className: styles.inspectorEmpty, children: "Component\uB97C \uC120\uD0DD\uD558\uC138\uC694." })) })] })] }));
}
function ComponentPreview({ component, mode, pendingFrom, page, onPortClick }) {
    const label = typeof component.props["label"] === "string" ? component.props["label"] : component.kind;
    return (_jsxs("div", { className: styles.componentPreview, children: [_jsx("span", { className: styles.componentKind, children: component.kind }), _jsx("strong", { children: label }), mode === "connect" ? (_jsx("div", { className: styles.ports, children: componentPorts(component).map((spec) => {
                    const reference = { nodeType: "component", nodeId: component.id, portId: spec.portId };
                    const compatible = spec.direction === "in" && pendingFrom !== null
                        && canConnect(page, { from: pendingFrom, to: reference });
                    return (_jsx("button", { type: "button", className: [
                            styles.port,
                            spec.direction === "out" ? styles.portOut : styles.portIn,
                            compatible ? styles.portCompatible : "",
                        ].filter(Boolean).join(" "), onClick: (event) => { event.stopPropagation(); onPortClick(reference, spec); }, title: `${spec.label} (${spec.valueType})`, children: spec.label }, spec.portId));
                }) })) : null] }));
}
function ComponentInspector({ component, onChangeProps, onRemove }) {
    const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
    return (_jsxs("div", { className: styles.inspectorBody, children: [_jsx("h4", { children: component.kind }), _jsx("code", { children: component.id }), "label" in component.props || label !== "" ? (_jsxs("label", { className: styles.inspectorField, children: [_jsx("span", { children: "Label" }), _jsx("input", { value: label, onChange: (event) => onChangeProps({ ...component.props, label: event.target.value }) })] })) : null, _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "Component \uC81C\uAC70" })] }));
}
function ConnectionInspector({ page, selectedConnectionId, onRemove }) {
    const connection = page.connections.find(({ id }) => id === selectedConnectionId) ?? null;
    return (_jsxs("div", { className: styles.inspectorBody, children: [_jsx("h4", { children: "\uC5F0\uACB0" }), _jsxs("p", { className: styles.inspectorEmpty, children: [page.connections.length, "\uAC1C\uC758 \uC5F0\uACB0. \uCD9C\uB825 Port\uB97C \uB204\uB978 \uB4A4 \uD638\uD658\uB418\uB294 \uC785\uB825 Port\uB97C \uB20C\uB7EC \uC5F0\uACB0\uD569\uB2C8\uB2E4."] }), connection !== null ? (_jsxs(_Fragment, { children: [_jsx("code", { children: connectionSummary(connection) }), _jsx(Button, { size: "small", variant: "secondary", onPress: () => onRemove(connection.id), children: "\uC5F0\uACB0 \uC0AD\uC81C" })] })) : null] }));
}
function pageIndex(manifest, pageId) {
    return manifest.pages.findIndex((page) => page.id === pageId);
}
export { portsFor };
//# sourceMappingURL=editor.js.map