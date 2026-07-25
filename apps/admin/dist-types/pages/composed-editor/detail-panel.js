import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import styles from "./composed-editor.module.css";
/** Inspector form for a `core.output.detail` component: Collection + Fields. */
export function DetailPanel({ component, collections, onChangeProps, onRemove }) {
    const collectionId = typeof component.props["collectionId"] === "string" ? component.props["collectionId"] : "";
    const detailFields = Array.isArray(component.props["fields"]) ? component.props["fields"] : [];
    const collection = collections.find((entry) => entry.id === collectionId);
    const fields = collection?.fields ?? [];
    const setCollection = (nextId) => {
        onChangeProps({ ...component.props, collectionId: nextId, fields: [] });
    };
    const toggleField = (fieldId, checked) => {
        const next = checked
            ? [...detailFields, { fieldId, protection: { mode: "normal" } }]
            : detailFields.filter((field) => field.fieldId !== fieldId);
        onChangeProps({ ...component.props, fields: next });
    };
    return (_jsxs("div", { className: styles.dataForm, children: [_jsxs("h4", { children: ["\uC0C1\uC138 ", component.id] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Collection" }), _jsxs("select", { value: collectionId, onChange: (event) => setCollection(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\u2026" }), collections.map((entry) => _jsx("option", { value: entry.id, children: entry.label ?? entry.name }, entry.id))] })] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uD45C\uC2DC Field" }), _jsx("div", { className: styles.checkList, children: fields.length === 0 ? _jsx("small", { children: "Collection\uC744 \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694." }) : fields.map((field) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: detailFields.some((f) => f.fieldId === field.id), onChange: (event) => toggleField(field.id, event.target.checked) }), field.label ?? field.name, " ", _jsxs("small", { children: ["(", field.type, ")"] })] }, field.id))) })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "Component \uC81C\uAC70" })] }));
}
//# sourceMappingURL=detail-panel.js.map