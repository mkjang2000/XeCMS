import { describe, expect, it } from "vitest";
import type { ComposedEffectDefinition, RuleCondition } from "@xecms/admin-apps";

import { evaluateCondition, planEffect, type ConditionContext, type EffectContext } from "./composed-effects.js";

function context(overrides: Partial<EffectContext> = {}): EffectContext {
  return {
    stateValue: () => undefined,
    canRunAction: () => true,
    ...overrides,
  };
}

function effect(kind: string, args?: Record<string, unknown>): ComposedEffectDefinition {
  return { id: "e", kind, args } as ComposedEffectDefinition;
}

describe("planEffect", () => {
  it("resolves navigate to its target page", () => {
    expect(planEffect(effect("navigate", { pageId: "pg_next" }), context()))
      .toEqual({ kind: "navigate", pageId: "pg_next" });
  });

  it("treats a navigate without a pageId as a noop (never crashes on a bad Manifest)", () => {
    expect(planEffect(effect("navigate", {}), context())).toEqual({ kind: "noop" });
  });

  it("resolves state.set with its literal value and state.reset without one", () => {
    expect(planEffect(effect("state.set", { stateId: "s1", value: "v" }), context()))
      .toEqual({ kind: "state.set", stateId: "s1", value: "v" });
    expect(planEffect(effect("state.reset", { stateId: "s1" }), context()))
      .toEqual({ kind: "state.reset", stateId: "s1" });
  });

  it("denies an action the caller is not permitted to run (gate is honored)", () => {
    const plan = planEffect(
      effect("action.execute", { actionId: "core.action.delete", collectionId: "col_x", documentStateId: "sel" }),
      context({ canRunAction: () => false, stateValue: () => "doc_1" }),
    );
    expect(plan).toEqual({ kind: "action.denied", actionId: "core.action.delete" });
  });

  it("requires a selected document before a delete can be planned", () => {
    const plan = planEffect(
      effect("action.execute", { actionId: "core.action.delete", collectionId: "col_x", documentStateId: "sel" }),
      context({ stateValue: () => "" }),
    );
    expect(plan.kind).toBe("action.invalid");
  });

  it("plans a permitted delete against the selected document with a confirmation", () => {
    const plan = planEffect(
      effect("action.execute", {
        actionId: "core.action.delete", collectionId: "col_x", documentStateId: "sel", confirm: "정말?",
      }),
      context({ stateValue: (id) => (id === "sel" ? "doc_1" : undefined) }),
    );
    expect(plan).toEqual({ kind: "action.delete", collectionId: "col_x", documentId: "doc_1", confirm: "정말?" });
  });

  it("rejects an unsupported action even when permitted (only known Actions run)", () => {
    const plan = planEffect(
      effect("action.execute", { actionId: "core.action.wipe", collectionId: "col_x", documentStateId: "sel" }),
      context({ stateValue: () => "doc_1" }),
    );
    expect(plan.kind).toBe("action.invalid");
  });

  it("plans a create against a form component", () => {
    const plan = planEffect(
      effect("action.execute", { actionId: "core.action.create", collectionId: "col_x", formComponentId: "cmp_form" }),
      context(),
    );
    expect(plan).toEqual({ kind: "action.create", collectionId: "col_x", formComponentId: "cmp_form" });
  });

  it("requires a form component for create", () => {
    const plan = planEffect(
      effect("action.execute", { actionId: "core.action.create", collectionId: "col_x" }),
      context(),
    );
    expect(plan.kind).toBe("action.invalid");
  });

  it("denies create without permission (the gate is honored for every Action)", () => {
    const plan = planEffect(
      effect("action.execute", { actionId: "core.action.create", collectionId: "col_x", formComponentId: "cmp_form" }),
      context({ canRunAction: () => false }),
    );
    expect(plan).toEqual({ kind: "action.denied", actionId: "core.action.create" });
  });

  it("plans an update against the selected document and a form component", () => {
    const plan = planEffect(
      effect("action.execute", {
        actionId: "core.action.update", collectionId: "col_x", formComponentId: "cmp_form", documentStateId: "sel",
      }),
      context({ stateValue: (id) => (id === "sel" ? "doc_1" : undefined) }),
    );
    expect(plan).toEqual({ kind: "action.update", collectionId: "col_x", documentId: "doc_1", formComponentId: "cmp_form" });
  });

  it("requires a selected document for update", () => {
    const plan = planEffect(
      effect("action.execute", {
        actionId: "core.action.update", collectionId: "col_x", formComponentId: "cmp_form", documentStateId: "sel",
      }),
      context({ stateValue: () => "" }),
    );
    expect(plan.kind).toBe("action.invalid");
  });

  it("resolves await-query to its data source (waits for the result at runtime)", () => {
    expect(planEffect(effect("await-query", { dataSourceId: "q1" }), context()))
      .toEqual({ kind: "await-query", dataSourceId: "q1" });
    expect(planEffect(effect("await-query", {}), context())).toEqual({ kind: "noop" });
  });

  it("plans form.setField from a state value source (fieldId → Field name)", () => {
    const plan = planEffect(
      effect("form.setField", {
        formComponentId: "cmp_form", fieldId: "fld_member", value: { from: "state", stateId: "sel" },
      }),
      context({ stateValue: (id) => (id === "sel" ? "m_1" : undefined), fieldName: (id) => (id === "fld_member" ? "memberId" : undefined) }),
    );
    expect(plan).toEqual({ kind: "form.setField", formComponentId: "cmp_form", fieldName: "memberId", value: "m_1" });
  });

  it("plans form.setField with today() (injected, deterministic)", () => {
    const plan = planEffect(
      effect("form.setField", { formComponentId: "cmp_form", fieldName: "loanedAt", value: { from: "today" } }),
      context({ today: () => "2026-08-01" }),
    );
    expect(plan).toEqual({ kind: "form.setField", formComponentId: "cmp_form", fieldName: "loanedAt", value: "2026-08-01" });
  });

  it("requires a form component and a resolvable field for form.setField", () => {
    expect(planEffect(effect("form.setField", { fieldName: "x", value: { from: "literal", value: 1 } }), context()).kind).toBe("action.invalid");
    expect(planEffect(effect("form.setField", { formComponentId: "cmp", value: { from: "literal", value: 1 } }), context()).kind).toBe("action.invalid");
  });

  it("plans action.updateFields as a partial update of the selected record (반납)", () => {
    const plan = planEffect(
      effect("action.updateFields", {
        collectionId: "col_loan", documentStateId: "sel",
        fields: [
          { fieldId: "fld_returned", value: { from: "today" } },
          { fieldName: "status", value: { from: "literal", value: "returned" } },
        ],
      }),
      context({
        stateValue: (id) => (id === "sel" ? "loan_1" : undefined),
        fieldName: (id) => (id === "fld_returned" ? "returnedAt" : undefined),
        today: () => "2026-08-01",
      }),
    );
    expect(plan).toEqual({
      kind: "action.updateFields", collectionId: "col_loan", documentId: "loan_1",
      fields: { returnedAt: "2026-08-01", status: "returned" },
    });
  });

  it("denies action.updateFields without the update permission (gate honored)", () => {
    const plan = planEffect(
      effect("action.updateFields", { collectionId: "col_loan", documentStateId: "sel", fields: [{ fieldName: "status", value: { from: "literal", value: "lost" } }] }),
      context({ canRunAction: () => false, stateValue: () => "loan_1" }),
    );
    expect(plan).toEqual({ kind: "action.denied", actionId: "core.action.update" });
  });

  it("rejects action.updateFields with no selected record or no fields", () => {
    expect(planEffect(effect("action.updateFields", { collectionId: "col_loan", documentStateId: "sel", fields: [{ fieldName: "s", value: { from: "literal", value: 1 } }] }), context({ stateValue: () => "" })).kind).toBe("action.invalid");
    expect(planEffect(effect("action.updateFields", { collectionId: "col_loan", documentStateId: "sel", fields: [] }), context({ stateValue: () => "loan_1" })).kind).toBe("action.invalid");
  });
});

function conditionContext(overrides: Partial<ConditionContext> = {}): ConditionContext {
  return { stateValue: () => undefined, lastQueryRowCount: undefined, ...overrides };
}

const cond = (c: RuleCondition): RuleCondition => c;

describe("evaluateCondition", () => {
  it("evaluates state empty / notEmpty", () => {
    const ctx = conditionContext({ stateValue: (id) => (id === "s" ? "x" : "") });
    expect(evaluateCondition(cond({ type: "state", stateId: "s", op: "notEmpty" }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ type: "state", stateId: "empty", op: "empty" }), ctx)).toBe(true);
  });

  it("evaluates state eq / ne with loose scalar equality", () => {
    const ctx = conditionContext({ stateValue: () => "42" });
    expect(evaluateCondition(cond({ type: "state", stateId: "s", op: "eq", value: 42 }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ type: "state", stateId: "s", op: "ne", value: 7 }), ctx)).toBe(true);
  });

  it("evaluates numeric gt / lt", () => {
    const ctx = conditionContext({ stateValue: () => 10 });
    expect(evaluateCondition(cond({ type: "state", stateId: "s", op: "gt", value: 5 }), ctx)).toBe(true);
    expect(evaluateCondition(cond({ type: "state", stateId: "s", op: "lt", value: 5 }), ctx)).toBe(false);
  });

  it("branches on the last await-query result (hasRows / noRows / countGt)", () => {
    const withRows = conditionContext({ lastQueryRowCount: 3 });
    expect(evaluateCondition(cond({ type: "queryResult", source: "lastQuery", op: "hasRows" }), withRows)).toBe(true);
    expect(evaluateCondition(cond({ type: "queryResult", source: "lastQuery", op: "countGt", value: 2 }), withRows)).toBe(true);
    const noRows = conditionContext({ lastQueryRowCount: 0 });
    expect(evaluateCondition(cond({ type: "queryResult", source: "lastQuery", op: "noRows" }), noRows)).toBe(true);
    expect(evaluateCondition(cond({ type: "queryResult", source: "lastQuery", op: "hasRows" }), noRows)).toBe(false);
  });

  it("fails closed when a queryResult condition has no prior await-query", () => {
    const ctx = conditionContext({ lastQueryRowCount: undefined });
    expect(evaluateCondition(cond({ type: "queryResult", source: "lastQuery", op: "hasRows" }), ctx)).toBe(false);
    expect(evaluateCondition(cond({ type: "queryResult", source: "lastQuery", op: "noRows" }), ctx)).toBe(false);
  });

  it("evaluates a field condition against the rendered row (highlightWhen)", () => {
    // Numeric overdue-days field → gt comparison.
    const overdue = conditionContext({ fieldValue: (id) => (id === "fld_overdue_days" ? 5 : undefined) });
    expect(evaluateCondition(cond({ type: "field", fieldId: "fld_overdue_days", op: "gt", value: 0 }), overdue)).toBe(true);
    // Status string → eq comparison.
    expect(evaluateCondition(cond({ type: "field", fieldId: "fld_status", op: "eq", value: "overdue" }),
      conditionContext({ fieldValue: () => "overdue" }))).toBe(true);
  });

  it("a field condition fails closed outside a per-row context (no fieldValue)", () => {
    expect(evaluateCondition(cond({ type: "field", fieldId: "fld_x", op: "notEmpty" }), conditionContext())).toBe(false);
  });

  it("composes and / or (scanner branch: member present AND book on loan)", () => {
    const ctx = conditionContext({ stateValue: (id) => (id === "member" ? "m_1" : ""), lastQueryRowCount: 1 });
    const onLoan = cond({
      type: "and",
      conditions: [
        { type: "state", stateId: "member", op: "notEmpty" },
        { type: "queryResult", source: "lastQuery", op: "hasRows" },
      ],
    });
    expect(evaluateCondition(onLoan, ctx)).toBe(true);
    const eitherWay = cond({ type: "or", conditions: [
      { type: "state", stateId: "missing", op: "notEmpty" },
      { type: "queryResult", source: "lastQuery", op: "hasRows" },
    ] });
    expect(evaluateCondition(eitherWay, ctx)).toBe(true);
  });
});
