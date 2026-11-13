import type { PageBlockDefinition } from "@xecms/admin-apps";
import type { CollectionSummaryDto } from "@xecms/client";
import { collectionFields, formInputKind } from "./model.js";
import styles from "./block-editor.module.css";

export function BlockInspector({ block, blocks, collections, onChange }: {
  readonly block: PageBlockDefinition;
  readonly blocks: readonly PageBlockDefinition[];
  readonly collections: readonly CollectionSummaryDto[];
  readonly onChange: (block: PageBlockDefinition) => void;
}) {
  const collection = collections.find((c) => c.id === block.collectionId);
  const fields = collection === undefined ? [] : collectionFields(collection);
  const sources = blocks.filter((b) => b.id !== block.id && b.collectionId === block.collectionId && b.kind === (block.kind === "list" ? "search" : "list"));
  const input = "input" in block ? block.input : undefined;
  const changeCollection = (collectionId: string): void => {
    // Preserve stable field/connection references so mismatches are diagnosed explicitly.
    onChange({ ...block, collectionId });
  };
  return <div className={styles.settings}>
    <label>블록 이름<input value={block.title} onChange={(e) => onChange({ ...block, title: e.target.value })} /></label>
    <label>컬렉션<select value={block.collectionId} onChange={(e) => changeCollection(e.target.value)}>
      {collection === undefined ? <option value={block.collectionId}>사용할 수 없는 컬렉션</option> : null}
      {collections.map((c) => <option key={c.id} value={c.id}>{c.label ?? c.name}</option>)}
    </select></label>
    {block.kind === "search" || block.kind === "chart" ? <label>{block.kind === "search" ? "검색 필드" : "집계 기준"}
      <select value={block.kind === "search" ? block.fieldId : block.groupFieldId} onChange={(e) => onChange(block.kind === "search" ? { ...block, fieldId: e.target.value } : { ...block, groupFieldId: e.target.value })}>
        <option value="">필드 선택</option>{fields.map((f) => <option key={f.fieldId} value={f.fieldId}>{f.label}</option>)}
      </select>
    </label> : <fieldset><legend>{block.kind === "form" ? "입력 필드" : "표시 필드"}</legend>
      {block.fields.filter((f) => !fields.some((candidate) => candidate.fieldId === f.fieldId)).map((f) => <p key={f.fieldId} role="alert">사용할 수 없는 필드: {f.label}
        <button type="button" onClick={() => onChange({ ...block, fields: block.fields.filter((x) => x.fieldId !== f.fieldId) } as PageBlockDefinition)}>제거</button></p>)}
      {fields.filter((f) => block.kind !== "form" || ["text", "number", "date"].includes(collection?.fields.find((c) => c.id === f.fieldId)?.type ?? "")).map((f) => <label key={f.fieldId} className={styles.check}>
        <input type="checkbox" checked={block.fields.some((x) => x.fieldId === f.fieldId)} onChange={(e) => {
          const kept = block.fields.filter((x) => x.fieldId !== f.fieldId);
          if (block.kind === "form") onChange({ ...block, fields: e.target.checked ? [...block.fields, { ...f, inputKind: formInputKind(collection?.fields.find((c) => c.id === f.fieldId)?.type ?? "text") }] : block.fields.filter((x) => x.fieldId !== f.fieldId) });
          else onChange({ ...block, fields: e.target.checked ? [...block.fields, f] : kept });
        }} />{f.label}
      </label>)}
    </fieldset>}
    {block.kind === "form" ? <label>저장 동작<select value={block.mode} onChange={(e) => {
      const { input: _, ...rest } = block;
      onChange({ ...rest, mode: e.target.value as "create" | "update" });
    }}><option value="create">새 항목 만들기</option><option value="update">선택 항목 수정</option></select></label> : null}
    {block.kind === "list" || block.kind === "detail" || (block.kind === "form" && block.mode === "update") ? <label>{block.kind === "list" ? "검색 조건 받기" : "선택 항목 받기"}
      <select value={input?.blockId ?? ""} onChange={(e) => {
        const { input: _, ...base } = block;
        if (e.target.value === "") onChange(base);
        else if (base.kind === "list") onChange({ ...base, input: { blockId: e.target.value, output: "search" } });
        else onChange({ ...base, input: { blockId: e.target.value, output: "selection" } });
      }}>
        <option value="">{block.kind === "list" ? "전체 항목 자동 조회" : "목록 선택"}</option>
        {input !== undefined && !sources.some((s) => s.id === input.blockId) ? <option value={input.blockId}>연결 확인 필요 ({input.blockId})</option> : null}
        {sources.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
      </select>
    </label> : null}
    {block.kind === "list" ? <label>조회 개수<input type="number" min={1} max={100} value={block.limit} onChange={(e) => onChange({ ...block, limit: Number(e.target.value) })} /></label> : null}
    <fieldset><legend>배치</legend><div className={styles.coordinates}>
      {(["x", "y", "width", "height"] as const).map((key, i) => <label key={key}>{["가로 위치", "세로 위치", "너비", "높이"][i]}<input type="number" min={key === "x" || key === "y" ? 0 : 1} value={block.placement[key]} onChange={(e) => onChange({ ...block, placement: { ...block.placement, [key]: Number(e.target.value) } })} /></label>)}
    </div></fieldset>
  </div>;
}
