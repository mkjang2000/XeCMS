import type { AdminAppIssue } from "../errors.js";
import type { PageAuthoringDefinition } from "./types.js";

/** Shared by editor diagnostics and server dependency checks. */
export function validateAuthoringSchema(source: PageAuthoringDefinition, collections: readonly {
  readonly id: string;
  readonly fields: readonly { readonly id: string; readonly type: string }[];
}[]): readonly AdminAppIssue[] {
  const issues: AdminAppIssue[] = [];
  source.blocks.forEach((block, i) => {
    const collection = collections.find((c) => c.id === block.collectionId);
    const issue = (message: string, key: string) => issues.push({ code: "INVALID_BLOCK_SCHEMA", message, path: ["blocks", i, key] });
    if (collection === undefined) { issue("사용할 수 없는 컬렉션입니다.", "collectionId"); return; }
    const fieldIds = "fields" in block ? block.fields.map((f) => f.fieldId) : [block.kind === "search" ? block.fieldId : block.groupFieldId];
    for (const id of fieldIds) {
      const field = collection.fields.find((f) => f.id === id);
      if (field === undefined) issue(`선택한 컬렉션에 필드 '${id}'가 없습니다.`, "fields");
      else if (block.kind === "search" && field.type !== "text") issue("텍스트 필드로 검색할 수 있습니다.", "fieldId");
      else if (block.kind === "form" && !["text", "number", "date"].includes(field.type)) issue(`입력 폼에서 지원하지 않는 필드 '${id}'입니다.`, "fields");
      else if (block.kind === "form") {
        const inputKind = block.fields.find((f) => f.fieldId === id)?.inputKind;
        if ((field.type === "number" && inputKind !== "number") || (field.type === "date" && inputKind !== "date")
          || (field.type === "text" && inputKind !== "text" && inputKind !== "textarea")) issue(`필드 '${id}'의 입력 형식을 확인하세요.`, "fields");
      }
    }
  });
  return issues;
}
