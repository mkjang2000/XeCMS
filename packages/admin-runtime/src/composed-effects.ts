import type { AdminAppScalar, ComposedEffectDefinition, RuleCondition } from "@xecms/admin-apps";

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
  | { readonly kind: "await-query"; readonly dataSourceId: string }
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
  | {
      readonly kind: "form.setField";
      readonly formComponentId: string;
      readonly fieldName: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "action.updateFields";
      readonly collectionId: string;
      readonly documentId: string;
      /** Field name → value; merged onto the record (partial update). */
      readonly fields: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "action.denied"; readonly actionId: string }
  | { readonly kind: "action.invalid"; readonly reason: string }
  | { readonly kind: "noop" };

export interface EffectContext {
  readonly stateValue: (stateId: string) => unknown;
  readonly canRunAction: (actionId: string) => boolean;
  /** Resolves a stable Field id (fld_*) to the row-data key (Field name). */
  readonly fieldName?: (fieldId: string) => string | undefined;
  /** Today as an ISO date (YYYY-MM-DD); injectable for deterministic tests. */
  readonly today?: () => string;
}

/**
 * A declarative value source for a rule effect (CPB-WF 슬2): a bound Page State,
 * today's date, or a literal. Never arbitrary code (§3, D-20).
 */
export type RuleValueSource =
  | { readonly from: "state"; readonly stateId: string }
  | { readonly from: "today" }
  | { readonly from: "literal"; readonly value: unknown };

/** Resolves a {@link RuleValueSource} against the current context. */
export function resolveValueSource(source: unknown, context: EffectContext): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  const value = source as Record<string, unknown>;
  switch (value["from"]) {
    case "state":
      return typeof value["stateId"] === "string" ? context.stateValue(value["stateId"]) : undefined;
    case "today":
      return (context.today ?? defaultToday)();
    case "literal":
      return value["value"];
    default:
      return undefined;
  }
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
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
    case "await-query": {
      const dataSourceId = args["dataSourceId"];
      return typeof dataSourceId === "string" ? { kind: "await-query", dataSourceId } : { kind: "noop" };
    }
    case "form.setField":
      return planFormSetField(args, context);
    case "action.updateFields":
      return planUpdateFields(args, context);
    case "navigate": {
      const pageId = args["pageId"];
      return typeof pageId === "string" ? { kind: "navigate", pageId } : { kind: "noop" };
    }
    case "action.execute":
      return planAction(args, context);
  }
}

/** Plans writing one form field from a value source (CPB-WF 슬2). */
function planFormSetField(args: Readonly<Record<string, unknown>>, context: EffectContext): EffectPlan {
  const formComponentId = args["formComponentId"];
  const fieldName = resolveFieldName(args["fieldId"], args["fieldName"], context);
  if (typeof formComponentId !== "string" || formComponentId === "" || fieldName === undefined) {
    return { kind: "action.invalid", reason: "입력 폼/필드 미지정" };
  }
  return { kind: "form.setField", formComponentId, fieldName, value: resolveValueSource(args["value"], context) };
}

/**
 * Plans a partial update of the selected record: only the named fields change
 * (반납일=오늘, 상태=반납 등). The `core.action.update` permission still gates it,
 * and the content API re-checks server-side — this never widens authorization.
 */
function planUpdateFields(args: Readonly<Record<string, unknown>>, context: EffectContext): EffectPlan {
  const collectionId = args["collectionId"];
  if (typeof collectionId !== "string") return { kind: "action.invalid", reason: "collectionId 누락" };
  if (!context.canRunAction("core.action.update")) return { kind: "action.denied", actionId: "core.action.update" };
  const documentId = selectedDocumentId(args, context);
  if (documentId === undefined) return { kind: "action.invalid", reason: "대상 항목 미선택" };
  const rawFields = Array.isArray(args["fields"]) ? args["fields"] : [];
  const fields: Record<string, unknown> = {};
  for (const entry of rawFields) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = resolveFieldName(record["fieldId"], record["fieldName"], context);
    if (name === undefined) continue;
    fields[name] = resolveValueSource(record["value"], context);
  }
  if (Object.keys(fields).length === 0) return { kind: "action.invalid", reason: "변경할 필드가 없습니다." };
  return { kind: "action.updateFields", collectionId, documentId, fields };
}

/** A field target may be given as a stable Field id (preferred) or a raw name. */
function resolveFieldName(
  fieldId: unknown,
  fieldName: unknown,
  context: EffectContext,
): string | undefined {
  if (typeof fieldId === "string" && fieldId !== "") {
    const resolved = context.fieldName?.(fieldId);
    if (resolved !== undefined) return resolved;
  }
  return typeof fieldName === "string" && fieldName !== "" ? fieldName : undefined;
}

/** State + last-query + (optional) row view a {@link RuleCondition} is evaluated against. */
export interface ConditionContext {
  readonly stateValue: (stateId: string) => unknown;
  /** Row count of the last `await-query` effect in the chain (undefined ⇒ none ran). */
  readonly lastQueryRowCount: number | undefined;
  /**
   * Value of a Field of the row being rendered (CPB-WF 슬4 `highlightWhen`).
   * Absent outside a per-row context, where a `field` condition fails closed.
   */
  readonly fieldValue?: (fieldId: string) => unknown;
}

/**
 * Evaluates a declarative effect guard (CPB-WF). Pure and total: an unknown
 * state reads `undefined`, and a `queryResult` condition with no prior
 * `await-query` fails closed (false) rather than firing the effect.
 */
export function evaluateCondition(condition: RuleCondition, context: ConditionContext): boolean {
  switch (condition.type) {
    case "and":
      return condition.conditions.every((child) => evaluateCondition(child, context));
    case "or":
      return condition.conditions.some((child) => evaluateCondition(child, context));
    case "state":
      return evaluateScalarCondition(context.stateValue(condition.stateId), condition.op, condition.value);
    case "field":
      return evaluateScalarCondition(context.fieldValue?.(condition.fieldId), condition.op, condition.value);
    case "queryResult":
      return evaluateQueryCondition(condition, context);
  }
}

type ScalarOp = "eq" | "ne" | "empty" | "notEmpty" | "gt" | "lt";

/** Shared scalar comparison used by `state` and `field` conditions. */
function evaluateScalarCondition(actual: unknown, op: ScalarOp, expected: AdminAppScalar | undefined): boolean {
  switch (op) {
    case "empty":
      return isEmpty(actual);
    case "notEmpty":
      return !isEmpty(actual);
    case "eq":
      return scalarEq(actual, expected);
    case "ne":
      return !scalarEq(actual, expected);
    case "gt":
      return compareNumbers(actual, expected) > 0;
    case "lt":
      return compareNumbers(actual, expected) < 0;
  }
}

function evaluateQueryCondition(
  condition: Extract<RuleCondition, { type: "queryResult" }>,
  context: ConditionContext,
): boolean {
  const count = context.lastQueryRowCount;
  if (count === undefined) return false; // no await-query ran → fail closed.
  switch (condition.op) {
    case "hasRows":
      return count > 0;
    case "noRows":
      return count === 0;
    case "countGt":
      return typeof condition.value === "number" && count > condition.value;
  }
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Loose scalar equality (numbers/strings/booleans compared by value). */
function scalarEq(actual: unknown, expected: AdminAppScalar | undefined): boolean {
  if (expected === undefined) return isEmpty(actual);
  if (typeof actual === "number" || typeof actual === "boolean") return actual === expected;
  return String(actual ?? "") === String(expected);
}

/** Numeric comparison; non-numeric operands compare as 0 (never throws). */
function compareNumbers(actual: unknown, expected: AdminAppScalar | undefined): number {
  const a = Number(actual);
  const b = Number(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return a - b;
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
