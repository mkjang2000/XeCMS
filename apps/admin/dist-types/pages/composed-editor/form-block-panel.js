import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "@xecms/ui";
import { blockFields, blockKindLabel, blockLabels, blockSearchField, isSearchBlock, reconfigureBlock, setComponentLabel, } from "./form-blocks.js";
import styles from "./composed-editor.module.css";
const KIND_HELP = {
    search: "스키마에서 조건에 맞는 행을 찾아, 연결된 폼으로 결과를 넘깁니다.",
    "date-search": "시작~끝 날짜 범위로 검색합니다.",
    "select-search": "정해진 값 중 하나를 골라 검색합니다. 선택 항목은 아래 목록에서 편집하세요.",
    "number-search": "최소~최대 숫자 범위로 검색합니다.",
    "multi-search": "여러 필드를 동시에(AND) 검색합니다.",
    list: "여러 행을 표로 보여줍니다. 검색폼에 연결하면 검색 결과를 표시합니다.",
    cards: "여러 행을 카드로 보여줍니다. 검색폼에 연결하면 검색 결과를 표시합니다.",
    detail: "한 행의 상세를 보여줍니다. 검색폼·목록에 연결하면 선택한 행을 표시합니다.",
    field: "한 필드 값을 크게 보여줍니다. 목록·검색폼에 연결하세요.",
    "input-form": "새 행을 입력해 저장합니다.",
    "item-actions": "선택한 행을 수정하거나 삭제합니다. 목록에 연결해 대상을 지정하세요.",
};
function kindHelp(kind) {
    return KIND_HELP[kind] ?? "";
}
/**
 * The block-level inspector — the primary editing surface for a "전산 사용자".
 * It speaks in schemas and fields, never ports or state; reconfiguring rebuilds
 * the block's atoms in place (`reconfigureBlock`) under the same block id.
 */
export function FormBlockPanel({ page, block, collections, onChange, onRemove }) {
    const collectionId = block.collectionId ?? "";
    const collection = collections.find((entry) => entry.id === collectionId);
    const fields = blockFields(page, block);
    const searchFieldId = blockSearchField(page, block);
    const selectedIds = new Set(fields.map((field) => field.fieldId));
    const labels = blockLabels(page, block);
    const apply = (nextFields, nextCollectionId = collectionId, nextSearchField = searchFieldId) => {
        onChange(reconfigureBlock(page, block, {
            collectionId: nextCollectionId,
            fields: nextFields,
            ...(nextSearchField === undefined ? {} : { searchFieldId: nextSearchField }),
        }));
    };
    const changeCollection = (nextId) => {
        // Switching schema resets fields/search (they reference the old schema).
        onChange(reconfigureBlock(page, block, { collectionId: nextId, fields: [] }));
    };
    const toggleField = (fieldId, label, checked) => {
        const next = checked
            ? [...fields, { fieldId, label }]
            : fields.filter((field) => field.fieldId !== fieldId);
        apply(next, collectionId, checked ? searchFieldId : (searchFieldId === fieldId ? undefined : searchFieldId));
    };
    return (_jsxs("div", { className: styles.dataForm, children: [_jsx("h4", { children: blockKindLabel(block.kind) }), _jsx("p", { className: styles.inspectorEmpty, children: kindHelp(block.kind) }), _jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "\uC2A4\uD0A4\uB9C8" }), _jsxs("select", { value: collectionId, onChange: (event) => changeCollection(event.target.value), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\u2026" }), collections.map((entry) => _jsx("option", { value: entry.id, children: entry.label ?? entry.name }, entry.id))] })] }), isSearchBlock(block.kind) ? (_jsxs("label", { className: styles.dataField, children: [_jsx("span", { children: "\uAC80\uC0C9\uD560 \uD544\uB4DC" }), _jsxs("select", { value: searchFieldId ?? "", onChange: (event) => apply(fields, collectionId, event.target.value || undefined), children: [_jsx("option", { value: "", children: "\uC120\uD0DD\u2026" }), (collection?.fields ?? []).map((field) => _jsx("option", { value: field.id, children: field.label ?? field.name }, field.id))] })] })) : null, block.kind === "item-actions" ? (_jsx("p", { className: styles.inspectorEmpty, children: "\uC774 \uD3FC\uC740 \uBAA9\uB85D\uC5D0 \uC5F0\uACB0\uD55C \uB4A4, \uC120\uD0DD\uB41C \uD589\uC744 \uC218\uC815\u00B7\uC0AD\uC81C\uD569\uB2C8\uB2E4. \uD544\uB4DC \uC124\uC815\uC740 \uD544\uC694 \uC5C6\uC2B5\uB2C8\uB2E4." })) : (_jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: block.kind === "input-form" ? "입력 필드" : block.kind === "field" ? "표시할 필드(1개)" : "표시 필드" }), _jsx("div", { className: styles.checkList, children: collection === undefined ? _jsx("small", { children: "\uC2A4\uD0A4\uB9C8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694." })
                            : collection.fields.length === 0 ? _jsx("small", { children: "\uC774 \uC2A4\uD0A4\uB9C8\uC5D0\uB294 \uD544\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." })
                                : collection.fields.map((field) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: selectedIds.has(field.id), onChange: (event) => toggleField(field.id, field.label ?? field.name, event.target.checked) }), field.label ?? field.name, " ", _jsxs("small", { children: ["(", field.type, ")"] })] }, field.id))) })] })), labels.length > 0 ? (_jsxs("div", { className: styles.dataField, children: [_jsx("span", { children: "\uD14D\uC2A4\uD2B8" }), labels.map((entry) => (_jsxs("div", { className: styles.dataField, children: [_jsx("small", { children: entry.role }), _jsx("input", { value: entry.value, onChange: (event) => onChange(setComponentLabel(page, entry.componentId, event.target.value)) })] }, entry.componentId)))] })) : null, _jsx(Button, { size: "small", variant: "secondary", onPress: onRemove, children: "\uD3FC \uC81C\uAC70" })] }));
}
//# sourceMappingURL=form-block-panel.js.map