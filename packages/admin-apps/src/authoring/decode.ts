import { choice, exact, has, integer, list, literal, object, required, text, type Path } from "../decode.js";
import type { BlockFieldDefinition, PageAuthoringDefinition, PageBlockDefinition } from "./types.js";

export function decodePageAuthoring(input: unknown, path: Path): PageAuthoringDefinition {
  const value = object(input, path);
  exact(value, ["version", "blocks"], path);
  return {
    version: literal(required(value, "version", path), 1, [...path, "version"]),
    blocks: list(required(value, "blocks", path), [...path, "blocks"]).map((block, i) => decodeBlock(block, [...path, "blocks", i])),
  };
}

function decodeBlock(input: unknown, path: Path): PageBlockDefinition {
  const value = object(input, path);
  const kind = choice(required(value, "kind", path), ["search", "list", "detail", "form", "chart"] as const, [...path, "kind"]);
  const extra = kind === "search" ? ["fieldId"] : kind === "chart" ? ["groupFieldId"]
    : kind === "list" ? ["fields", "limit", "input"] : kind === "form" ? ["fields", "mode", "input"] : ["fields", "input"];
  exact(value, ["id", "title", "collectionId", "placement", "kind", ...extra], path);
  const placementPath = [...path, "placement"];
  const p = object(required(value, "placement", path), placementPath);
  exact(p, ["x", "y", "width", "height"], placementPath);
  const base = {
    id: text(required(value, "id", path), [...path, "id"]),
    title: text(required(value, "title", path), [...path, "title"]),
    collectionId: text(required(value, "collectionId", path), [...path, "collectionId"]),
    placement: {
      x: integer(required(p, "x", placementPath), [...placementPath, "x"]),
      y: integer(required(p, "y", placementPath), [...placementPath, "y"]),
      width: integer(required(p, "width", placementPath), [...placementPath, "width"]),
      height: integer(required(p, "height", placementPath), [...placementPath, "height"]),
    },
  };
  if (kind === "search") return { ...base, kind, fieldId: text(required(value, "fieldId", path), [...path, "fieldId"]) };
  if (kind === "chart") return { ...base, kind, groupFieldId: text(required(value, "groupFieldId", path), [...path, "groupFieldId"]) };
  const rawFields = list(required(value, "fields", path), [...path, "fields"]);
  const decodeField = (input: unknown, index: number): BlockFieldDefinition & { readonly inputKind: "text" | "textarea" | "number" | "date" } => {
    const fp = [...path, "fields", index];
    const f = object(input, fp);
    exact(f, ["fieldId", "label", "maskPolicyId", ...(kind === "form" ? ["inputKind"] : [])], fp);
    return {
      fieldId: text(required(f, "fieldId", fp), [...fp, "fieldId"]),
      label: text(required(f, "label", fp), [...fp, "label"]),
      ...(has(f, "maskPolicyId") ? { maskPolicyId: text(f["maskPolicyId"], [...fp, "maskPolicyId"]) } : {}),
      inputKind: kind === "form" ? choice(required(f, "inputKind", fp), ["text", "textarea", "number", "date"] as const, [...fp, "inputKind"]) : "text",
    };
  };
  const inputValue = has(value, "input") ? object(value["input"], [...path, "input"]) : undefined;
  if (inputValue !== undefined) exact(inputValue, ["blockId", "output"], [...path, "input"]);
  const readInput = <T extends "search" | "selection">(output: T) => inputValue === undefined ? {} : { input: {
    blockId: text(required(inputValue, "blockId", [...path, "input"]), [...path, "input", "blockId"]),
    output: literal(required(inputValue, "output", [...path, "input"]), output, [...path, "input", "output"]),
  } };
  if (kind === "form") return { ...base, kind, fields: rawFields.map(decodeField),
    mode: choice(required(value, "mode", path), ["create", "update"] as const, [...path, "mode"]), ...readInput("selection") };
  const fields = rawFields.map(decodeField).map(({ inputKind: _, ...field }) => field);
  if (kind === "list") return { ...base, kind, fields, limit: integer(required(value, "limit", path), [...path, "limit"]), ...readInput("search") };
  return { ...base, kind, fields, ...readInput("selection") };
}
