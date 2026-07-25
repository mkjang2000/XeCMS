import type { ComposedEffectDefinition } from "@xecms/admin-apps";

/**
 * A resolved effect step the runtime executes. Resolving effects to plain plans
 * keeps the security-relevant decisions (which Action, which target, whether it
 * is permitted) unit-testable without React.
 */
export type EffectPlan =
  | { readonly kind: "state.set"; readonly stateId: string; readonly value: unknown }
  | { readonly kind: "state.reset"; readonly stateId: string }
  | { readonly kind: "data-source.execute"; readonly dataSourceId: string }
  | { readonly kind: "data-source.reset"; readonly dataSourceId: string }
  | { readonly kind: "navigate"; readonly pageId: string }
  | {
      readonly kind: "action.delete";
      readonly collectionId: string;
      readonly documentId: string;
      readonly confirm: string;
    }
  | {
      readonly kind: "action.create";
      readonly collectionId: string;
      readonly formComponentId: string;
    }
  | {
      readonly kind: "action.update";
      readonly collectionId: string;
      readonly documentId: string;
      readonly formComponentId: string;
    }
  | { readonly kind: "action.denied"; readonly actionId: string }
  | { readonly kind: "action.invalid"; readonly reason: string }
  | { readonly kind: "noop" };

export interface EffectContext {
  readonly stateValue: (stateId: string) => unknown;
  readonly canRunAction: (actionId: string) => boolean;
}

/** Resolves one effect definition into an executable plan (pure). */
export function planEffect(effect: ComposedEffectDefinition, context: EffectContext): EffectPlan {
  const args = effect.args ?? {};
  switch (effect.kind) {
    case "state.set": {
      const stateId = args["stateId"];
      return typeof stateId === "string"
        ? { kind: "state.set", stateId, value: args["value"] ?? "" }
        : { kind: "noop" };
    }
    case "state.reset": {
      const stateId = args["stateId"];
      return typeof stateId === "string" ? { kind: "state.reset", stateId } : { kind: "noop" };
    }
    case "data-source.execute": {
      const dataSourceId = args["dataSourceId"];
      return typeof dataSourceId === "string" ? { kind: "data-source.execute", dataSourceId } : { kind: "noop" };
    }
    case "data-source.reset": {
      const dataSourceId = args["dataSourceId"];
      return typeof dataSourceId === "string" ? { kind: "data-source.reset", dataSourceId } : { kind: "noop" };
    }
    case "navigate": {
      const pageId = args["pageId"];
      return typeof pageId === "string" ? { kind: "navigate", pageId } : { kind: "noop" };
    }
    case "action.execute":
      return planAction(args, context);
  }
}

function planAction(args: Readonly<Record<string, unknown>>, context: EffectContext): EffectPlan {
  const actionId = args["actionId"];
  const collectionId = args["collectionId"];
  if (typeof actionId !== "string" || typeof collectionId !== "string") {
    return { kind: "action.invalid", reason: "actionId/collectionId 누락" };
  }
  // The runtime gate is a UX optimization; the server re-checks on mutation.
  if (!context.canRunAction(actionId)) return { kind: "action.denied", actionId };
  switch (actionId) {
    case "core.action.delete":
      return planDelete(args, collectionId, context);
    case "core.action.create":
      return planCreate(args, collectionId);
    case "core.action.update":
      return planUpdate(args, collectionId, context);
    default:
      return { kind: "action.invalid", reason: `미지원 작업 '${actionId}'` };
  }
}

function planDelete(
  args: Readonly<Record<string, unknown>>,
  collectionId: string,
  context: EffectContext,
): EffectPlan {
  const documentId = selectedDocumentId(args, context);
  if (documentId === undefined) return { kind: "action.invalid", reason: "대상 항목 미선택" };
  const confirm = typeof args["confirm"] === "string" ? args["confirm"] : "선택한 항목을 삭제할까요?";
  return { kind: "action.delete", collectionId, documentId, confirm };
}

function planCreate(args: Readonly<Record<string, unknown>>, collectionId: string): EffectPlan {
  const formComponentId = args["formComponentId"];
  if (typeof formComponentId !== "string" || formComponentId === "") {
    return { kind: "action.invalid", reason: "입력 폼 미지정" };
  }
  return { kind: "action.create", collectionId, formComponentId };
}

function planUpdate(
  args: Readonly<Record<string, unknown>>,
  collectionId: string,
  context: EffectContext,
): EffectPlan {
  const formComponentId = args["formComponentId"];
  if (typeof formComponentId !== "string" || formComponentId === "") {
    return { kind: "action.invalid", reason: "입력 폼 미지정" };
  }
  const documentId = selectedDocumentId(args, context);
  if (documentId === undefined) return { kind: "action.invalid", reason: "대상 항목 미선택" };
  return { kind: "action.update", collectionId, documentId, formComponentId };
}

/** Reads the target documentId from the state named by `documentStateId`. */
function selectedDocumentId(
  args: Readonly<Record<string, unknown>>,
  context: EffectContext,
): string | undefined {
  const documentStateId = args["documentStateId"];
  const documentId = typeof documentStateId === "string" ? context.stateValue(documentStateId) : undefined;
  return typeof documentId === "string" && documentId !== "" ? documentId : undefined;
}
