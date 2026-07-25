import { describe, expect, it } from "vitest";
import type { ComposedEffectDefinition } from "@xecms/admin-apps";

import { planEffect, type EffectContext } from "./composed-effects.js";

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
});
