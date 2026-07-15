import { describe, expect, it, vi } from "vitest";

import { DocumentLifecycleHookRegistry, documentHookContext } from "./hooks.js";

describe("DocumentLifecycleHookRegistry", () => {
  it("runs matching hooks by priority and preserves registration order for ties", async () => {
    const registry = new DocumentLifecycleHookRegistry();
    const calls: string[] = [];
    registry.register({ id: "late", priority: 20, stages: ["beforeCreate"], run: () => { calls.push("late"); } });
    registry.register({ id: "first-a", priority: -10, stages: ["beforeCreate"], run: () => { calls.push("first-a"); } });
    registry.register({ id: "ignored", priority: -20, stages: ["beforeDelete"], run: () => { calls.push("ignored"); } });
    registry.register({ id: "first-b", priority: -10, stages: ["beforeCreate"], run: () => { calls.push("first-b"); } });

    const context = documentHookContext(
      { subjectId: "subject_owner", workspaceId: "wrk_default", realmId: "rlm_system", capabilities: [] },
      { stage: "beforeCreate", operation: "create", collectionId: "col_posts", data: { title: "hello" } },
    );
    await registry.run(context);

    expect(calls).toEqual(["first-a", "first-b", "late"]);
  });

  it("rejects duplicate ids and unregisters without affecting other hooks", async () => {
    const registry = new DocumentLifecycleHookRegistry();
    const run = vi.fn();
    const unregister = registry.register({ id: "guard", stages: ["beforeDelete"], run });
    expect(() => registry.register({ id: "guard", stages: ["beforeDelete"], run })).toThrow(/already registered/);

    unregister();
    await registry.run({
      stage: "beforeDelete",
      operation: "delete",
      workspaceId: "wrk_default",
      realmId: "rlm_system",
      actorSubjectId: "subject_owner",
      collectionId: "col_posts",
      documentId: "doc_1",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("passes a frozen top-level context to trusted hooks", async () => {
    const registry = new DocumentLifecycleHookRegistry();
    registry.register({
      id: "immutable",
      stages: ["afterValidate"],
      run: (context) => expect(Object.isFrozen(context)).toBe(true),
    });
    await registry.run({
      stage: "afterValidate",
      operation: "update",
      workspaceId: "wrk_default",
      realmId: "rlm_system",
      actorSubjectId: "subject_owner",
      collectionId: "col_posts",
      documentId: "doc_1",
      data: { title: "updated" },
    });
  });
});
