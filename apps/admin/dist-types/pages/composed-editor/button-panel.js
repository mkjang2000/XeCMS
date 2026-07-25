import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import styles from "./composed-editor.module.css";
const EFFECT_KINDS = [
    { kind: "navigate", label: "화면 이동" },
    { kind: "data-source.execute", label: "Data Source 실행" },
    { kind: "data-source.reset", label: "Data Source 초기화" },
    { kind: "state.reset", label: "State 초기화" },
    { kind: "action.execute", label: "작업 실행(생성/수정/삭제)" },
];
const ACTION_IDS = [
    { id: "core.action.create", label: "생성" },
    { id: "core.action.update", label: "수정" },
    { id: "core.action.delete", label: "삭제" },
];
/**
 * Inspector for a `core.button`. Edits its Label and the onClick effect chain
 * (CPB-7). The chain runs in order at runtime; the delete action is gated by the
 * server's access profile and re-checked by the content API, so nothing edited
 * here can grant a permission the actor does not already hold.
 */
export function ButtonPanel({ component, pages, page, collections, onChangeProps, onChangeEvents, onRemove }) {
    const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
    const onClick = (component.events ?? []).find((binding) => binding.event === "onClick");
    const effects = onClick?.effects ?? [];
    const documentStates = page.state.filter((state) => state.valueType === "document-id");
    const formComponents = page.components.filter((entry) => entry.kind === "core.form");
    const setEffects = (next) => {
        const others = (component.events ?? []).filter((binding) => binding.event !== "onClick");
        if (next.length === 0) {
            onChangeEvents(others);
            return;
        }
        const binding = { id: onClick?.id ?? "evt_onclick", event: "onClick", effects: next };
        onChangeEvents([...others, binding]);
    };
    const addEffect = () => {
        const id = `fx_${effects.length + 1}`;
        setEffects([...effects, { id, kind: "navigate", args: {} }]);
    };
    const patchEffect = (id, patch) => {
        setEffects(effects.map((effect) => (effect.id === id ? { ...effect, ...patch } : effect)));
    };
    const patchArgs = (id, args) => {
        setEffects(effects.map((effect) => (effect.id === id ? { ...effect, args: { ...effect.args, ...args } } : effect)));
    };
    const removeEffect = (id) => setEffects(effects.filter((effect) => effect.id !== id));
    return (_jsxs("div", { className: styles.dataForm, children: [_jsxs("h4", { children: ["\uBC84\uD2BC ", component.id] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Label" }), _jsx("input", { value: label, onChange: (event) => onChangeProps({ ...component.props, label: event.target.value }) })] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uD074\uB9AD \uC2DC \uB3D9\uC791" }), _jsx("p", { className: styles.inspectorEmpty, children: "\uC704\uC5D0\uC11C \uC544\uB798 \uC21C\uC11C\uB85C \uC2E4\uD589\uB429\uB2C8\uB2E4. \uC2E4\uD328\uD558\uBA74 \uAC70\uAE30\uC11C \uBA48\uCDA5\uB2C8\uB2E4." }), effects.map((effect) => (_jsxs("div", { className: styles.dataField, style: { borderTop: "1px solid var(--xe-color-border,#eee)", paddingTop: "0.4rem" }, children: [_jsx("select", { value: effect.kind, onChange: (event) => patchEffect(effect.id, { kind: event.target.value, args: {} }), children: EFFECT_KINDS.map((entry) => _jsx("option", { value: entry.kind, children: entry.label }, entry.kind)) }), effect.kind === "navigate" ? (_jsxs("select", { value: stringArg(effect, "pageId"), onChange: (event) => patchArgs(effect.id, { pageId: event.target.value }), children: [_jsx("option", { value: "", children: "\uD654\uBA74 \uC120\uD0DD\u2026" }), pages.map((target) => _jsx("option", { value: target.id, children: target.menuLabel || target.title || target.id }, target.id))] })) : effect.kind === "data-source.execute" || effect.kind === "data-source.reset" ? (_jsxs("select", { value: stringArg(effect, "dataSourceId"), onChange: (event) => patchArgs(effect.id, { dataSourceId: event.target.value }), children: [_jsx("option", { value: "", children: "Data Source \uC120\uD0DD\u2026" }), page.dataSources.map((source) => _jsx("option", { value: source.id, children: source.id }, source.id))] })) : effect.kind === "state.reset" ? (_jsxs("select", { value: stringArg(effect, "stateId"), onChange: (event) => patchArgs(effect.id, { stateId: event.target.value }), children: [_jsx("option", { value: "", children: "State \uC120\uD0DD\u2026" }), page.state.map((state) => _jsx("option", { value: state.id, children: state.id }, state.id))] })) : effect.kind === "action.execute" ? (_jsxs(_Fragment, { children: [_jsxs("select", { value: stringArg(effect, "actionId"), onChange: (event) => patchArgs(effect.id, { actionId: event.target.value }), children: [_jsx("option", { value: "", children: "\uC791\uC5C5 \uC120\uD0DD\u2026" }), ACTION_IDS.map((action) => _jsx("option", { value: action.id, children: action.label }, action.id))] }), _jsxs("select", { value: stringArg(effect, "collectionId"), onChange: (event) => patchArgs(effect.id, { collectionId: event.target.value }), children: [_jsx("option", { value: "", children: "\uCEEC\uB809\uC158 \uC120\uD0DD\u2026" }), collections.map((collection) => _jsx("option", { value: collection.id, children: collection.name }, collection.id))] }), stringArg(effect, "actionId") === "core.action.create" || stringArg(effect, "actionId") === "core.action.update" ? (_jsxs("select", { value: stringArg(effect, "formComponentId"), onChange: (event) => patchArgs(effect.id, { formComponentId: event.target.value }), children: [_jsx("option", { value: "", children: "\uC785\uB825 \uD3FC \uC120\uD0DD\u2026" }), formComponents.map((form) => _jsx("option", { value: form.id, children: typeof form.props["label"] === "string" ? `${form.props["label"]} (${form.id})` : form.id }, form.id))] })) : null, stringArg(effect, "actionId") === "core.action.update" || stringArg(effect, "actionId") === "core.action.delete" ? (_jsxs("select", { value: stringArg(effect, "documentStateId"), onChange: (event) => patchArgs(effect.id, { documentStateId: event.target.value }), children: [_jsx("option", { value: "", children: "\uB300\uC0C1 State(document-id) \uC120\uD0DD\u2026" }), documentStates.map((state) => _jsx("option", { value: state.id, children: state.id }, state.id))] })) : null, stringArg(effect, "actionId") === "core.action.delete" ? (_jsx("input", { placeholder: "\uD655\uC778 \uBB38\uAD6C", value: stringArg(effect, "confirm"), onChange: (event) => patchArgs(effect.id, { confirm: event.target.value }) })) : null, _jsx("p", { className: styles.inspectorEmpty, children: "\uC791\uC5C5 \uAD8C\uD55C\uC740 \uC11C\uBC84\uC5D0\uC11C \uB2E4\uC2DC \uAC80\uC99D\uB429\uB2C8\uB2E4." })] })) : null, _jsx("button", { type: "button", onClick: () => removeEffect(effect.id), children: "\uB3D9\uC791 \uC81C\uAC70" })] }, effect.id))), _jsx(Button, { size: "small", variant: "secondary", onPress: addEffect, children: "+ \uB3D9\uC791" })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "Component \uC81C\uAC70" })] }));
}
function stringArg(effect, key) {
    const value = effect.args?.[key];
    return typeof value === "string" ? value : "";
}
//# sourceMappingURL=button-panel.js.map