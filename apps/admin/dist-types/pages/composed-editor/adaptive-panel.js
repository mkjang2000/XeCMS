import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import styles from "./composed-editor.module.css";
const KINDS = ["text", "number", "date", "select"];
/**
 * Inspector form for a `core.input.adaptive` component. Each variant becomes an
 * output port (`value:<id>`) the Builder wires to a State → Data Source
 * parameter; the runtime fills only the active variant so hidden values never
 * reach the query.
 */
export function AdaptivePanel({ component, onChangeProps, onRemove }) {
    const label = typeof component.props["label"] === "string" ? component.props["label"] : "";
    const variants = Array.isArray(component.props["variants"]) ? component.props["variants"] : [];
    const setVariants = (next) => onChangeProps({ ...component.props, variants: next });
    const addVariant = () => {
        const existing = new Set(variants.map((v) => v.id));
        let index = variants.length + 1;
        while (existing.has(`v_${index}`))
            index += 1;
        const id = `v_${index}`;
        setVariants([...variants, { id, label: `형식 ${index}`, inputKind: "text" }]);
    };
    const patchVariant = (id, patch) => {
        setVariants(variants.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)));
    };
    const removeVariant = (id) => setVariants(variants.filter((variant) => variant.id !== id));
    return (_jsxs("div", { className: styles.dataForm, children: [_jsxs("h4", { children: ["\uC801\uC751\uD615 \uAC80\uC0C9 ", component.id] }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "Label" }), _jsx("input", { value: label, onChange: (event) => onChangeProps({ ...component.props, label: event.target.value }) })] }), _jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uD615\uC2DD(variant)" }), _jsx("p", { className: styles.inspectorEmpty, children: "\uAC01 \uD615\uC2DD\uC740 \uCD9C\uB825 Port\uB85C \uB178\uCD9C\uB429\uB2C8\uB2E4. \uC5F0\uACB0 \uBAA8\uB4DC\uC5D0\uC11C State\u2192Data Source \uD30C\uB77C\uBBF8\uD130\uB85C \uC5F0\uACB0\uD558\uC138\uC694." }), variants.map((variant) => (_jsxs("div", { className: styles.dataField, style: { borderTop: "1px solid var(--xe-color-border,#eee)", paddingTop: "0.4rem" }, children: [_jsxs("div", { className: styles.dataFieldRow, children: [_jsx("input", { placeholder: "\uC774\uB984", value: variant.label ?? "", onChange: (event) => patchVariant(variant.id, { label: event.target.value || undefined }) }), _jsx("select", { value: variant.inputKind ?? "text", onChange: (event) => patchVariant(variant.id, { inputKind: event.target.value }), children: KINDS.map((kind) => _jsx("option", { value: kind, children: kind }, kind)) })] }), _jsxs("code", { children: ["value:", variant.id] }), _jsx("button", { type: "button", onClick: () => removeVariant(variant.id), children: "\uD615\uC2DD \uC81C\uAC70" })] }, variant.id))), _jsx(Button, { size: "small", variant: "secondary", onPress: addVariant, children: "+ \uD615\uC2DD" })] }), _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "Component \uC81C\uAC70" })] }));
}
//# sourceMappingURL=adaptive-panel.js.map