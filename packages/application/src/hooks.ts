import type { ActorContext } from "./errors.js";

export type DocumentLifecycleHookStage =
  | "beforeValidate"
  | "afterValidate"
  | "beforeCreate"
  | "beforeUpdate"
  | "beforeDelete";

export interface DocumentLifecycleHookContext {
  readonly stage: DocumentLifecycleHookStage;
  readonly operation: "create" | "update" | "delete";
  readonly workspaceId: string;
  readonly realmId: string;
  readonly actorSubjectId: string;
  readonly collectionId: string;
  readonly documentId?: string;
  readonly data?: unknown;
}

export interface DocumentLifecycleHook {
  readonly id: string;
  readonly priority?: number;
  readonly stages: readonly DocumentLifecycleHookStage[];
  run(context: DocumentLifecycleHookContext): void | Promise<void>;
}

export interface DocumentLifecycleHookRunner {
  run(context: DocumentLifecycleHookContext): Promise<void>;
}

/** Ordered trusted-code registry used by M4-C without exposing mutable internals. */
export class DocumentLifecycleHookRegistry implements DocumentLifecycleHookRunner {
  private readonly hooks: Array<DocumentLifecycleHook & { readonly order: number }> = [];
  private nextOrder = 0;

  public register(hook: DocumentLifecycleHook): () => void {
    if (hook.id.trim() === "") throw new TypeError("Lifecycle Hook id must not be empty.");
    if (this.hooks.some(({ id }) => id === hook.id)) {
      throw new TypeError(`Lifecycle Hook '${hook.id}' is already registered.`);
    }
    const entry = { ...hook, stages: Object.freeze([...new Set(hook.stages)]), order: this.nextOrder++ };
    this.hooks.push(entry);
    this.hooks.sort((left, right) =>
      (left.priority ?? 0) - (right.priority ?? 0) || left.order - right.order);
    return () => {
      const index = this.hooks.indexOf(entry);
      if (index >= 0) this.hooks.splice(index, 1);
    };
  }

  public async run(context: DocumentLifecycleHookContext): Promise<void> {
    const immutable = Object.freeze({ ...context });
    for (const hook of this.hooks) {
      if (hook.stages.includes(context.stage)) await hook.run(immutable);
    }
  }
}

export function documentHookContext(
  actor: ActorContext,
  input: Omit<DocumentLifecycleHookContext, "workspaceId" | "realmId" | "actorSubjectId">,
): DocumentLifecycleHookContext {
  return {
    ...input,
    workspaceId: actor.workspaceId,
    realmId: actor.realmId ?? "rlm_system",
    actorSubjectId: actor.subjectId,
  };
}
