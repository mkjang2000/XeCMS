import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import styles from "./composed-editor.module.css";
const KINDS = ["text", "number", "date", "textarea"];
/**
 * Inspector for a `core.form` component: pick a Collection and the Fields to
 * collect. The form's values feed a create/update Action, whose permission the
 * server enforces — this panel only configures which inputs are shown.
 */
export function FormPanel({ component, collections, onChangeProps, onRemove }) {
    const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
    const collectionId = typeof component.props["collectionId"] === "string" ? component.props["collectionId"] : "";
    const formFields = Array.isArray(component.props["fields"]) ? component.props["fields"] : [];
    const collection = collections.find((entry) => entry.id === collectionId);
    const fields = collection?.fields ?? [];
    const setCollection = (nextId) => onChangeProps({ ...component.props, collectionId: nextId, fields: [] });
    const toggleField = (fieldId, checked) => {
        const next = checked
            ? [...formFields, { fieldId }]
            : formFields.filter((field) => field.fieldId !== fieldId);
        onChangeProps({ ...component.props, fields: next });
    };
    const patchKind = (fieldId, inputKind) => {
        onChangeProps({
            ...component.props,
            fields: formFields.map((field) => (field.fieldId === fieldId ? { ...field, inputKind } : field)),
        });
    };
    return (_jsxs("div", { className: styles.dataForm, children: [_jsxs("h4", { children: ["\uC785\uB825 \uD3FC ", component.id] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "\uC81C\uBAA9" }), _jsx("input", { value: label, onChange: (event) => onChangeProps({ ...component.props, label: event.target.value }) })] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Collection" }), _jsxs("select", { value: collectionId, onChange: (event) => setCollection(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\u2026" }), collections.map((entry) => _jsx("option", { value: entry.id, children: entry.label ?? entry.name }, entry.id))] })] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uC785\uB825 Field" }), _jsx("div", { className: styles.checkList, children: fields.length === 0 ? _jsx("small", { children: "Collection\uC744 \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694." }) : fields.map((field) => {
                            const active = formFields.find((f) => f.fieldId === field.id);
                            return (_jsxs("div", { children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: active !== undefined, onChange: (event) => toggleField(field.id, event.target.checked) }), field.label ?? field.name, " ", _jsxs("small", { children: ["(", field.type, ")"] })] }), active !== undefined ? (_jsx("select", { value: active.inputKind ?? "text", onChange: (event) => patchKind(field.id, event.target.value), children: KINDS.map((kind) => _jsx("option", { value: kind, children: kind }, kind)) })) : null] }, field.id));
                        }) })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "Component \uC81C\uAC70" })] }));
}
//# sourceMappingURL=form-panel.js.map