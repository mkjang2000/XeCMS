/** First vertical slice Component catalog for the Builder palette (§5, §7). */
export const PALETTE = [
    { kind: "core.input.text", label: "짧은 텍스트", group: "input", defaultSize: { width: 16, height: 5 }, defaultProps: { label: "텍스트" } },
    { kind: "core.input.number", label: "숫자", group: "input", defaultSize: { width: 10, height: 5 }, defaultProps: { label: "숫자" } },
    { kind: "core.input.adaptive", label: "적응형 검색", group: "input", defaultSize: { width: 20, height: 6 }, defaultProps: { label: "검색", variants: [] } },
    { kind: "core.button", label: "버튼", group: "input", defaultSize: { width: 6, height: 5 }, defaultProps: { label: "조회", tone: "primary" } },
    { kind: "core.form", label: "입력 폼", group: "input", defaultSize: { width: 20, height: 24 }, defaultProps: { label: "입력", fields: [] } },
    { kind: "core.output.table", label: "목록", group: "output", defaultSize: { width: 30, height: 30 }, defaultProps: { columns: [] } },
    { kind: "core.output.detail", label: "상세", group: "output", defaultSize: { width: 16, height: 30 }, defaultProps: { fields: [] } },
    { kind: "core.layout.title", label: "제목", group: "layout", defaultSize: { width: 24, height: 4 }, defaultProps: { text: "제목" } },
    { kind: "core.layout.divider", label: "구분선", group: "layout", defaultSize: { width: 48, height: 1 }, defaultProps: {} },
];
export function paletteEntry(kind) {
    return PALETTE.find((entry) => entry.kind === kind);
}
export function nextComponentId(existing, kind) {
    const base = `cmp_${kind.split(".").pop() ?? "component"}`.replace(/[^a-z0-9]+/g, "_");
    const ids = new Set(existing.map(({ id }) => id));
    let index = 1;
    while (ids.has(`${base}_${index}`))
        index += 1;
    return `${base}_${index}`;
}
//# sourceMappingURL=catalog.js.map