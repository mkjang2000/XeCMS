import { withPageAuthoring, type ComposedPageDefinition, type PageBlockDefinition, type BlockFieldDefinition } from "@xecms/admin-apps";
import type { CollectionSummaryDto } from "@xecms/client";

export const BLOCK_TITLES = { search: "검색", list: "목록", detail: "상세", form: "입력 폼", chart: "차트" } as const;

export function collectionFields(collection: CollectionSummaryDto): readonly BlockFieldDefinition[] {
  return collection.fields.map((field) => ({ fieldId: field.id, label: field.label ?? field.name,
    ...(field.sensitivity?.defaultMaskPolicyId === undefined ? {} : { maskPolicyId: field.sensitivity.defaultMaskPolicyId }) }));
}

export function newPageBlock(page: ComposedPageDefinition, kind: PageBlockDefinition["kind"], collection: CollectionSummaryDto): PageBlockDefinition {
  const blocks = page.authoring?.blocks ?? [];
  let number = 1;
  while (blocks.some((block) => block.id === `b${number}`)) number += 1;
  const fields = collectionFields(collection).slice(0, 4);
  const base = { id: `b${number}`, title: BLOCK_TITLES[kind], collectionId: collection.id,
    placement: { x: 0, y: blocks.reduce((max, b) => Math.max(max, b.placement.y + b.placement.height + 2), 0), width: 30, height: kind === "search" ? 5 : 26 } };
  if (kind === "search") return { ...base, kind, fieldId: collection.fields.find((f) => f.type === "text")?.id ?? fields[0]?.fieldId ?? "" };
  if (kind === "chart") return { ...base, kind, groupFieldId: fields[0]?.fieldId ?? "" };
  const search = blocks.find((b) => b.kind === "search" && b.collectionId === collection.id);
  const list = blocks.find((b) => b.kind === "list" && b.collectionId === collection.id);
  const selection = list === undefined ? {} : { input: { blockId: list.id, output: "selection" as const } };
  if (kind === "list") return { ...base, kind, fields, limit: 20, ...(search === undefined ? {} : { input: { blockId: search.id, output: "search" } }) };
  if (kind === "detail") return { ...base, kind, fields, ...selection };
  return { ...base, kind, fields: fields.filter((f) => ["text", "number", "date"].includes(collection.fields.find((c) => c.id === f.fieldId)?.type ?? ""))
    .map((f) => ({ ...f, inputKind: formInputKind(collection.fields.find((c) => c.id === f.fieldId)?.type ?? "text") })), mode: list === undefined ? "create" : "update", ...selection };
}

export function formInputKind(type: string): "text" | "number" | "date" {
  return type === "number" ? "number" : type === "date" ? "date" : "text";
}

export function replaceBlock(page: ComposedPageDefinition, block: PageBlockDefinition): ComposedPageDefinition {
  return withPageAuthoring(page, { version: 1, blocks: (page.authoring?.blocks ?? []).map((b) => b.id === block.id ? block : b) });
}

/** Preserve references to a removed block as visible diagnostics, never silently rewire. */
export function removeAuthoredBlock(page: ComposedPageDefinition, id: string): ComposedPageDefinition {
  return withPageAuthoring(page, { version: 1, blocks: (page.authoring?.blocks ?? []).filter((b) => b.id !== id) });
}

export function addBusinessTemplate(page: ComposedPageDefinition, collection: CollectionSummaryDto, kinds: readonly PageBlockDefinition["kind"][] = ["search", "list", "detail", "form"]): ComposedPageDefinition {
  let result = page;
  for (const kind of kinds) {
    const block = newPageBlock(result, kind, collection);
    result = withPageAuthoring(result, { version: 1, blocks: [...(result.authoring?.blocks ?? []), block] });
  }
  return result;
}
