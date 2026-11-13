import type { AdminAppIssue } from "../errors.js";
import { serializeManifestValue } from "../normalize.js";
import type { ComposedPageDefinition } from "../v2/types.js";
import { compilePageAuthoring } from "./compile.js";
import type { PageAuthoringDefinition } from "./types.js";

/** Authoring diagnostics stay on block paths so the editor can show the cause. */
export function validatePageAuthoring(source: PageAuthoringDefinition): readonly AdminAppIssue[] {
  const issues: AdminAppIssue[] = [];
  const ids = new Set<string>();
  const blocks = new Map(source.blocks.map((b) => [b.id, b]));
  source.blocks.forEach((block, index) => {
    const issue = (message: string, key: string) => issues.push({ code: "INVALID_BLOCK", message, path: ["blocks", index, key] });
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(block.id) || ids.has(block.id)) issue("블록 ID가 올바르지 않거나 중복됩니다.", "id");
    ids.add(block.id);
    if (!/^col_[a-z0-9][a-z0-9_-]{0,95}$/.test(block.collectionId)) issue("컬렉션을 선택하세요.", "collectionId");
    const p = block.placement;
    if (![p.x, p.y, p.width, p.height].every(Number.isInteger) || p.x < 0 || p.y < 0 || p.width < 1 || p.height < 1 || p.x + p.width > 48
      || (block.kind === "search" && p.width < 8) || (block.kind === "form" && p.height < 8)) issue("블록의 위치 또는 크기가 유효하지 않습니다.", "placement");
    if ("fields" in block) {
      if (block.fields.length === 0) issue("표시하거나 입력할 필드를 선택하세요.", "fields");
      const fields = new Set<string>();
      for (const f of block.fields) {
        if (!/^fld_[a-z0-9][a-z0-9_-]{0,95}$/.test(f.fieldId) || fields.has(f.fieldId)) issue("필드 ID가 올바르지 않거나 중복됩니다.", "fields");
        fields.add(f.fieldId);
      }
    }
    const fieldId = block.kind === "search" ? block.fieldId : block.kind === "chart" ? block.groupFieldId : undefined;
    if (fieldId !== undefined && !/^fld_[a-z0-9][a-z0-9_-]{0,95}$/.test(fieldId)) issue("필드를 선택하세요.", "fieldId");
    if (block.kind === "list" && (!Number.isInteger(block.limit) || block.limit < 1 || block.limit > 100)) issue("목록 개수는 1~100이어야 합니다.", "limit");
    if ((block.kind === "detail" || (block.kind === "form" && block.mode === "update")) && block.input === undefined) issue("선택 항목을 제공할 목록을 연결하세요.", "input");
    if ("input" in block && block.input !== undefined) {
      const from = blocks.get(block.input.blockId);
      if (from === undefined || from.id === block.id || from.kind !== (block.kind === "list" ? "search" : "list")) issue("연결할 블록을 확인하세요.", "input");
      else if (from.collectionId !== block.collectionId) issue("연결된 블록은 같은 컬렉션을 사용해야 합니다.", "input");
      if (block.kind === "form" && block.mode === "create") issue("새 항목 입력 폼에는 선택 항목을 연결할 수 없습니다.", "input");
    }
    for (let prior = 0; prior < index; prior += 1) {
      const q = source.blocks[prior]!.placement;
      if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) issue("블록이 다른 블록과 겹칩니다.", "placement");
    }
  });
  return issues;
}

/** Never accept edited runtime atoms alongside a different authoring source. */
export function validateAuthoredPage(page: ComposedPageDefinition): readonly AdminAppIssue[] {
  if (page.authoring === undefined) return [];
  const issues = validatePageAuthoring(page.authoring).map((issue) => ({ ...issue, path: ["authoring", ...issue.path] }));
  const compiled = compilePageAuthoring(page.authoring);
  if (page.events !== undefined || Object.entries(compiled).some(([key, value]) =>
    serializeManifestValue(value) !== serializeManifestValue(page[key as keyof typeof compiled]))) {
    issues.push({ code: "AUTHORING_COMPILE_MISMATCH", message: "블록 설정과 실행 데이터가 일치하지 않습니다. 블록 편집기에서 다시 저장하세요.", path: ["authoring"] });
  }
  return issues;
}
