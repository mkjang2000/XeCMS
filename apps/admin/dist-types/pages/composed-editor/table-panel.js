import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import styles from "./composed-editor.module.css";
const FORMATS = ["auto", "text", "long-text", "number", "date", "datetime", "boolean", "badge"];
/** Inspector form for a `core.output.table`: column editing (field/label/format). */
export function TablePanel({ component, collectionId, collections, onChangeProps, onRemove }) {
    const columns = Array.isArray(component.props["columns"]) ? component.props["columns"] : [];
    const collection = collections.find((entry) => entry.id === collectionId);
    const fields = collection?.fields ?? [];
    const setColumns = (next) => onChangeProps({ ...component.props, columns: next });
    const addColumn = () => {
        const existing = new Set(columns.map((c) => c.id));
        let index = columns.length + 1;
        while (existing.has(`column_${index}`))
            index += 1;
        setColumns([...columns, { id: `column_${index}`, protection: { mode: "normal" } }]);
    };
    const patchColumn = (id, patch) => {
        setColumns(columns.map((column) => (column.id === id ? { ...column, ...patch } : column)));
    };
    const removeColumn = (id) => setColumns(columns.filter((column) => column.id !== id));
    return (_jsxs("div", { className: styles.dataForm, children: [_jsxs("h4", { children: ["\uBAA9\uB85D ", component.id] }), collectionId === undefined ? (_jsx("p", { className: styles.inspectorEmpty, children: "Data Source(rows)\uB97C \uC5F0\uACB0\uD558\uBA74 \uADF8 Collection\uC758 Field\uB85C \uC5F4\uC744 \uAD6C\uC131\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." })) : null, columns.map((column) => (_jsxs("div", { className: styles.dataField, style: { borderTop: "1px solid var(--xe-color-border,#eee)", paddingTop: "0.4rem" }, children: [_jsxs("div", { className: styles.dataFieldRow, children: [_jsxs("select", { value: column.fieldId ?? "", onChange: (event) => patchColumn(column.id, { fieldId: event.target.value || undefined }), children: [_jsx("option", { value: "", children: "Field \uC120\uD0DD\u2026" }), fields.map((field) => _jsx("option", { value: field.id, children: field.label ?? field.name }, field.id))] }), _jsx("select", { value: column.format ?? "auto", onChange: (event) => patchColumn(column.id, { format: event.target.value }), children: FORMATS.map((format) => _jsx("option", { value: format, children: format }, format)) })] }), _jsx("input", { placeholder: "\uC5F4 \uC81C\uBAA9(\uC120\uD0DD)", value: column.label ?? "", onChange: (event) => patchColumn(column.id, { label: event.target.value || undefined }) }), _jsx("button", { type: "button", onClick: () => removeColumn(column.id), children: "\uC5F4 \uC81C\uAC70" })] }, column.id))), _jsx(Button, { size: "small", variant: "secondary", onPress: addColumn, children: "+ \uC5F4" }), _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "Component \uC81C\uAC70" })] }));
}
//# sourceMappingURL=table-panel.js.map