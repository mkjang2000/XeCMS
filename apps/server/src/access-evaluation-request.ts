import {
  ApplicationError,
  type AuthorizationBatchEvaluation,
  type AuthorizationBatchCheck,
  type AuthorizationDecisionRecord,
} from "@xecms/application";
import type {
  AuthorizationDecisionDto,
  EvaluateAccessBatchRequest,
  EvaluateAccessBatchResponse,
} from "@xecms/contracts";

export function parseEvaluateAccessBatchRequest(input: unknown): EvaluateAccessBatchRequest {
  const body = exactObject(input, ["checks"], "Access evaluation batch");
  if (!Array.isArray(body["checks"])) {
    invalid("checks must be an array.");
  }
  return {
    checks: body["checks"].map((value, index) => parseCheck(value, index)),
  };
}

export function toEvaluateAccessBatchResponse(
  evaluation: AuthorizationBatchEvaluation,
): EvaluateAccessBatchResponse {
  return {
    policyRevision: evaluation.policyRevision,
    items: evaluation.items.map((item) => {
      if (item.type === "permission") {
        return {
          id: item.id,
          type: "permission",
          supported: item.supported,
          decision: toDecisionDto(
            item.decision,
            item.resourceId,
            evaluation.policyRevision,
          ),
        };
      }
      return {
        id: item.id,
        type: "field",
        action: item.action,
        supported: item.supported,
        decision: {
          allowed: item.decision.allowed,
          access: item.decision.access,
          field: item.decision.field,
          resourceId: item.decision.resourceId,
          reasonCode: item.decision.reasonCode,
          policyRevision: evaluation.policyRevision,
          matchedGrants: item.decision.matchedGrants.map((grant) => ({
            sourceRoleId: grant.sourceRoleId,
            sourceBindingId: grant.sourceBindingId,
            sourceResourceId: grant.sourceResourceId,
            membershipPath: grant.membershipPath,
          })),
        },
      };
    }),
  };
}

function parseCheck(value: unknown, index: number): AuthorizationBatchCheck {
  const label = `checks[${index}]`;
  const candidate = object(value, label);
  if (candidate["type"] === "permission") {
    const body = exactObject(
      candidate,
      ["id", "type", "action", "resourceId", "context"],
      label,
    );
    return {
      id: requiredString(body["id"], `${label}.id`),
      type: "permission",
      action: requiredString(body["action"], `${label}.action`),
      resourceId: requiredString(body["resourceId"], `${label}.resourceId`),
      ...parseOptionalContext(body["context"], `${label}.context`),
    };
  }
  if (candidate["type"] === "field") {
    const body = exactObject(
      candidate,
      ["id", "type", "action", "resourceId", "field", "access", "context"],
      label,
    );
    const access = body["access"];
    if (access !== "read" && access !== "write") {
      invalid(`${label}.access must be 'read' or 'write'.`);
    }
    return {
      id: requiredString(body["id"], `${label}.id`),
      type: "field",
      action: requiredString(body["action"], `${label}.action`),
      resourceId: requiredString(body["resourceId"], `${label}.resourceId`),
      field: requiredString(body["field"], `${label}.field`),
      access,
      ...parseOptionalContext(body["context"], `${label}.context`),
    };
  }
  invalid(`${label}.type must be 'permission' or 'field'.`);
}

function parseOptionalContext(
  input: unknown,
  label: string,
): { readonly context?: { readonly ownerSubjectId?: string; readonly status?: string } } {
  if (input === undefined) return {};
  const body = exactObject(input, ["ownerSubjectId", "status"], label);
  const ownerSubjectId = optionalString(body["ownerSubjectId"], `${label}.ownerSubjectId`);
  const status = optionalString(body["status"], `${label}.status`);
  return {
    context: {
      ...(ownerSubjectId === undefined ? {} : { ownerSubjectId }),
      ...(status === undefined ? {} : { status }),
    },
  };
}

function toDecisionDto(
  decision: AuthorizationDecisionRecord,
  requestedResourceId: string,
  policyRevision: number,
): AuthorizationDecisionDto {
  return {
    allowed: decision.allowed,
    action: decision.action,
    reasonCode: decision.reasonCode,
    resourceId: decision.evaluatedScope?.resourceId ?? requestedResourceId,
    ...(decision.actorLevel === undefined ? {} : { actorLevel: decision.actorLevel }),
    ...(decision.targetLevel === undefined ? {} : { targetLevel: decision.targetLevel }),
    policyRevision,
    matchedGrants: decision.matchedGrants.map((grant) => ({
      permission: grant.permission,
      sourceRoleId: grant.sourceRoleId,
      sourceLevelId: grant.sourceLevelId,
      sourceRank: grant.sourceRank,
      sourceBindingId: grant.sourceBindingId,
      sourceResourceId: grant.sourceScope.resourceId,
      sourcePropagation: grant.sourceScope.propagation,
      membershipPath: grant.membershipPath,
    })),
  };
}

function exactObject(
  input: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  const body = object(input, label);
  const extras = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extras.length > 0) invalid(`${label} contains unknown fields: ${extras.join(", ")}.`);
  return body;
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    invalid(`${label} must be a JSON object.`);
  }
  return input as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255) {
    invalid(`${label} must contain 1-255 characters.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function invalid(message: string): never {
  throw new ApplicationError("ACCESS_BATCH_INVALID", 400, message);
}
