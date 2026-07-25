import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import styles from "./composed-editor.module.css";
/** Operators offered per Field type (aligned with document-query validation). */
function operatorsFor(fieldType) {
    const common = ["eq", "ne", "in", "isNull", "isNotNull"];
    if (fieldType === "text" || fieldType === "textarea")
        return ["contains", "startsWith", ...common];
    if (fieldType === "number" || fieldType === "date" || fieldType === "datetime")
        return ["lt", "lte", "gt", "gte", ...common];
    return common;
}
export function DataSourcePanel({ dataSource, collections, onChange, onRemove }) {
    const collection = collections.find((entry) => entry.id === dataSource.collectionId);
    const fields = collection?.fields ?? [];
    const condition = dataSource.filter?.type === "condition" ? dataSource.filter : undefined;
    const patch = (next) => onChange({ ...dataSource, ...next });
    const setCollection = (collectionId) => {
        // Changing the Collection invalidates field/filter references.
        patch({ collectionId, fields: [], ...(dataSource.filter === undefined ? {} : { filter: undefined }) });
    };
    const toggleField = (fieldId, checked) => {
        patch({ fields: checked ? [...dataSource.fields, fieldId] : dataSource.fields.filter((id) => id !== fieldId) });
    };
    const setFilterField = (fieldId) => {
        if (fieldId === "") {
            patch({ filter: undefined });
            return;
        }
        const filter = {
            type: "condition",
            field: { kind: "data", fieldId },
            operator: condition?.operator ?? "contains",
            ...(condition?.value === undefined ? {} : { value: condition.value }),
        };
        patch({ filter });
    };
    const setFilterOperator = (operator) => {
        if (condition === undefined)
            return;
        patch({ filter: { ...condition, operator } });
    };
    const setFilterParameter = (parameterId) => {
        if (condition === undefined)
            return;
        patch({ filter: { ...condition, value: { type: "parameter", parameterId } } });
    };
    const addParameter = () => {
        const existing = new Set((dataSource.parameters ?? []).map(({ id }) => id));
        let index = 1;
        while (existing.has(`param_${index}`))
            index += 1;
        const parameter = { id: `param_${index}`, valueType: "string" };
        patch({ parameters: [...(dataSource.parameters ?? []), parameter] });
    };
    const removeParameter = (parameterId) => {
        patch({ parameters: (dataSource.parameters ?? []).filter((param) => param.id !== parameterId) });
    };
    return (_jsxs("div", { className: styles.dataForm, children: [_jsxs("h4", { children: ["\uCFFC\uB9AC ", dataSource.id] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Collection" }), _jsxs("select", { value: dataSource.collectionId, onChange: (event) => setCollection(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\u2026" }), collections.map((entry) => _jsx("option", { value: entry.id, children: entry.label ?? entry.name }, entry.id))] })] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uCD9C\uB825 Field" }), _jsx("div", { className: styles.checkList, children: fields.length === 0 ? _jsx("small", { children: "Collection\uC744 \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694." }) : fields.map((field) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: dataSource.fields.includes(field.id), onChange: (event) => toggleField(field.id, event.target.checked) }), field.label ?? field.name, " ", _jsxs("small", { children: ["(", field.type, ")"] })] }, field.id))) })] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uD544\uD130" }), _jsxs("div", { className: styles.dataFieldRow, children: [_jsxs("select", { value: condition?.field.kind === "data" ? condition.field.fieldId : "", onChange: (event) => setFilterField(event.target.value), children: [_jsx("option", { value: "", children: "\uD544\uD130 \uC5C6\uC74C" }), fields.map((field) => _jsx("option", { value: field.id, children: field.label ?? field.name }, field.id))] }), condition !== undefined ? (_jsx("select", { value: condition.operator, onChange: (event) => setFilterOperator(event.target.value), children: operatorsFor(condition.field.kind === "data"
                                    ? fields.find((f) => f.id === condition.field.fieldId)?.type
                                    : undefined)
                                    .map((op) => _jsx("option", { value: op, children: op }, op)) })) : null] }), condition !== undefined ? (_jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "\uAC12 = \uD30C\uB77C\uBBF8\uD130" }), _jsxs("select", { value: condition.value?.type === "parameter" ? condition.value.parameterId : "", onChange: (event) => setFilterParameter(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\u2026" }), (dataSource.parameters ?? []).map((param) => _jsx("option", { value: param.id, children: param.id }, param.id))] })] })) : null] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uD30C\uB77C\uBBF8\uD130" }), (dataSource.parameters ?? []).map((param) => (_jsxs("div", { className: styles.dataFieldRow, children: [_jsx("code", { children: param.id }), _jsx("small", { children: param.valueType }), _jsx("button", { type: "button", onClick: () => removeParameter(param.id), children: "\uC81C\uAC70" })] }, param.id))), _jsx(Button, { size: "small", variant: "secondary", onPress: addParameter, children: "+ \uD30C\uB77C\uBBF8\uD130" })] }), _jsxs("div", { className: styles.dataFieldRow, children: [_jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Limit" }), _jsx("input", { type: "number", min: 1, max: 100, value: dataSource.limit, onChange: (event) => patch({ limit: Math.max(1, Math.min(100, Number(event.target.value) || 1)) }) })] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Trigger" }), _jsxs("select", { value: dataSource.trigger, onChange: (event) => patch({ trigger: event.target.value }), children: [_jsx("option", { value: "manual", children: "\uC218\uB3D9(\uBC84\uD2BC)" }), _jsx("option", { value: "on-load", children: "\uD654\uBA74 \uB85C\uB4DC" }), _jsx("option", { value: "on-change", children: "\uC785\uB825 \uBCC0\uACBD" })] })] })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "\uCFFC\uB9AC \uC81C\uAC70" })] }));
}
//# sourceMappingURL=data-source-panel.js.map