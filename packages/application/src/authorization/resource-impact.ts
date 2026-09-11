import {
  asPermissionKey,
  asResourceId,
  asSubjectId,
  evaluateAccess,
  evaluateFieldAccess,
  scopeAppliesToResource,
  type PolicySnapshot,
} from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import { coreResourceId } from "./identifiers.js";
import type { AuthorizationPolicyContext } from "./policy-context.js";
import { createKernelSnapshot, toKernelContextProperty } from "./policy-kernel.js";
import { applyPolicyMutation } from "./policy-mutation.js";
import type {
  AuthorizationActor,
  AuthorizationEvaluationContext,
  EffectivePermissionChangeRecord,
  EffectiveFieldAccessChangeRecord,
  ResourceParentChangePreview,
} from "./types.js";
import { requireRecord } from "./validation.js";

function fieldAllowlistsEqual(
  left: readonly string[] | null,
  right: readonly string[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function classifyFieldAllowlistChange(
  before: readonly string[] | null,
  after: readonly string[] | null,
): "broadened" | "narrowed" | "changed" {
  if (before === null) return "narrowed";
  if (after === null) return "broadened";
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  if (before.every((field) => afterSet.has(field))) return "broadened";
  if (after.every((field) => beforeSet.has(field))) return "narrowed";
  return "changed";
}

type AuthorizationResourceImpactDependencies = Pick<AuthorizationPolicyContext,
  "load" | "runtime"
>;

export class AuthorizationResourceImpact {
  public constructor(
    private readonly context: AuthorizationResourceImpactDependencies,
  ) {}

  /** Computes a no-write effective allow delta against a hypothetical parent edge. */
  public async previewResourceParentChange(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly newParentResourceId: string;
      readonly affectedResourceIds: readonly string[];
      readonly contextsByResourceId?: Readonly<Record<string, AuthorizationEvaluationContext>>;
    },
  ): Promise<ResourceParentChangePreview> {
    const entry = await this.context.load(actor.realmId);
    const mayInspectEffectivePermissions = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey("authorization.read"),
      resourceId: asResourceId(coreResourceId(actor.realmId, "authorization")),
      now: this.context.runtime.now(),
    }).allowed;
    const current = requireRecord(entry.state.resources, input.resourceId, "resource");
    if (!entry.state.resources.some(({ id }) => id === input.newParentResourceId)) {
      throw new ApplicationError(
        "AUTHORIZATION_RESOURCE_PARENT_NOT_FOUND",
        409,
        `Resource parent '${input.newParentResourceId}' does not exist.`,
      );
    }
    const nextResource = { ...current, parentId: input.newParentResourceId };
    const nextState = applyPolicyMutation(entry.state, { type: "resource.upsert", value: nextResource });
    const nextSnapshot = createKernelSnapshot(nextState);
    const affected = [...new Set(input.affectedResourceIds)];
    if (affected.length > 500) {
      throw new ApplicationError(
        "AUTHORIZATION_IMPACT_TOO_LARGE",
        413,
        "Synchronous hierarchy authorization impact is limited to 500 resources.",
        { details: { limit: 500, actual: affected.length } },
      );
    }
    affected.forEach((resourceId) => {
      if (!entry.state.resources.some(({ id }) => id === resourceId)) {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_NOT_FOUND",
          409,
          `Affected resource '${resourceId}' does not exist.`,
        );
      }
    });
    const affectedSet = new Set(affected);
    const parentChanges = current.parentId !== input.newParentResourceId;
    const coverageChanges = parentChanges && (
      entry.state.bindings.some((binding) => affectedSet.has(binding.resourceId) ||
        scopeAppliesToResource(entry.snapshot, {
          resourceId: asResourceId(binding.resourceId),
          propagation: binding.propagation,
        }, asResourceId(input.resourceId)) !==
        scopeAppliesToResource(nextSnapshot, {
          resourceId: asResourceId(binding.resourceId),
          propagation: binding.propagation,
        }, asResourceId(input.resourceId))) || entry.state.roles.some((role) =>
        (role.fieldAccess ?? []).some((rule) => affectedSet.has(rule.resourceId) ||
          scopeAppliesToResource(entry.snapshot, {
            resourceId: asResourceId(rule.resourceId),
            propagation: "self-and-children",
          }, asResourceId(input.resourceId)) !==
          scopeAppliesToResource(nextSnapshot, {
            resourceId: asResourceId(rule.resourceId),
            propagation: "self-and-children",
          }, asResourceId(input.resourceId))))
    );
    if (!mayInspectEffectivePermissions) {
      return {
        policyRevision: entry.state.revision,
        requiresAuthorizationManagement: coverageChanges,
        effectivePermissionChanges: [],
        effectiveFieldAccessChanges: [],
        effectivePermissionChangesTruncated: false,
      };
    }
    const now = this.context.runtime.now();
    const changes: EffectivePermissionChangeRecord[] = [];
    const fieldChanges: EffectiveFieldAccessChangeRecord[] = [];
    const maxEvaluations = 20_000;
    const maxChanges = 500;
    let evaluations = 0;
    let truncated = false;
    permissionLoop: for (const subject of entry.state.subjects) {
      for (const permission of entry.state.permissions) {
        for (const resourceId of affected) {
          if (evaluations + 2 > maxEvaluations || changes.length + fieldChanges.length >= maxChanges) {
            truncated = true;
            break permissionLoop;
          }
          const request = {
            actorSubjectId: asSubjectId(subject.id),
            action: asPermissionKey(permission.key),
            resourceId: asResourceId(resourceId),
            now,
            ...toKernelContextProperty(input.contextsByResourceId?.[resourceId]),
          } as const;
          evaluations += 2;
          const before = evaluateAccess(entry.snapshot, request);
          const after = evaluateAccess(nextSnapshot, request);
          if (before.allowed === after.allowed) continue;
          changes.push({
            subjectId: subject.id,
            resourceId,
            permission: permission.key,
            beforeAllowed: before.allowed,
            afterAllowed: after.allowed,
            change: after.allowed ? "granted" : "revoked",
          });
        }
      }
    }
    const namedFields = {
      read: [...new Set(entry.state.roles.flatMap((role) =>
        (role.fieldAccess ?? []).flatMap(({ readableFields }) => readableFields)))].sort(),
      write: [...new Set(entry.state.roles.flatMap((role) =>
        (role.fieldAccess ?? []).flatMap(({ writableFields }) => writableFields)))].sort(),
    } as const;
    const evaluateFields = (
      snapshot: PolicySnapshot,
      subjectId: string,
      resourceId: string,
      operation: "read" | "write",
    ): readonly string[] | null | undefined => {
      const candidates = namedFields[operation];
      if (evaluations + candidates.length + 1 > maxEvaluations) return undefined;
      const action = operation === "read" ? "content.read" : "content.update";
      const base = {
        actorSubjectId: asSubjectId(subjectId),
        resourceId: asResourceId(resourceId),
        access: operation,
        permission: asPermissionKey(action),
        now,
        ...toKernelContextProperty(input.contextsByResourceId?.[resourceId]),
      } as const;
      evaluations += 1;
      if (evaluateFieldAccess(snapshot, { ...base, field: "__xecms_unlisted_field_probe__" }).allowed) {
        return null;
      }
      const allowed: string[] = [];
      for (const field of candidates) {
        evaluations += 1;
        if (evaluateFieldAccess(snapshot, { ...base, field }).allowed) allowed.push(field);
      }
      return allowed;
    };
    fieldLoop: for (const subject of entry.state.subjects) {
      for (const resourceId of affected) {
        for (const operation of ["read", "write"] as const) {
          if (changes.length + fieldChanges.length >= maxChanges) {
            truncated = true;
            break fieldLoop;
          }
          const beforeFields = evaluateFields(entry.snapshot, subject.id, resourceId, operation);
          const afterFields = evaluateFields(nextSnapshot, subject.id, resourceId, operation);
          if (beforeFields === undefined || afterFields === undefined) {
            truncated = true;
            break fieldLoop;
          }
          if (fieldAllowlistsEqual(beforeFields, afterFields)) continue;
          fieldChanges.push({
            subjectId: subject.id,
            resourceId,
            operation,
            beforeFields,
            afterFields,
            change: classifyFieldAllowlistChange(beforeFields, afterFields),
          });
        }
      }
    }
    return {
      policyRevision: entry.state.revision,
      requiresAuthorizationManagement: coverageChanges,
      effectivePermissionChanges: changes,
      effectiveFieldAccessChanges: fieldChanges,
      effectivePermissionChangesTruncated: truncated,
    };
  }
}
