import type { GridPlacement } from "../v2/types.js";

/** Editable source; runtime nodes are generated and never reverse-engineered. */
export interface PageAuthoringDefinition {
  readonly version: 1;
  readonly blocks: readonly PageBlockDefinition[];
}

export interface BlockFieldDefinition {
  readonly fieldId: string;
  readonly label: string;
  readonly maskPolicyId?: string;
}

interface BlockBase {
  readonly id: string;
  readonly title: string;
  readonly collectionId: string;
  readonly placement: GridPlacement;
}

export type PageBlockDefinition =
  | (BlockBase & {
      readonly kind: "search";
      readonly fieldId: string;
    })
  | (BlockBase & {
      readonly kind: "list";
      readonly fields: readonly BlockFieldDefinition[];
      readonly limit: number;
      /** No input means an independent, on-load list. */
      readonly input?: { readonly blockId: string; readonly output: "search" };
    })
  | (BlockBase & {
      readonly kind: "detail";
      readonly fields: readonly BlockFieldDefinition[];
      readonly input?: { readonly blockId: string; readonly output: "selection" };
    })
  | (BlockBase & {
      readonly kind: "form";
      readonly fields: readonly (BlockFieldDefinition & { readonly inputKind: "text" | "textarea" | "number" | "date" })[];
      readonly mode: "create" | "update";
      readonly input?: { readonly blockId: string; readonly output: "selection" };
    })
  | (BlockBase & {
      readonly kind: "chart";
      readonly groupFieldId: string;
    });
