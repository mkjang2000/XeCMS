import {
  asPermissionKey,
  asResourceId,
  asSubjectId,
  authorizeSubjectDisable,
  evaluateAccess,
  evaluateFieldAccess,
  type FieldAccessMode,
} from "@xecms/authorization";
import { ApplicationError } from "../errors.js";
import { entitlementAllowsReadField, entitlementAllowsWriteField } from "../entitlement-gate.js";
import {
  isControlPlaneAdministrationActor,
  realmPolicyActor,
  assertContentRealmAdministration,
} from "./actor-guards.js";
import type { AuthorizationEntitlementCeiling } from "./entitlement-ceiling.js";
import { coreResourceId } from "./identifiers.js";
import type { AuthorizationPolicyContext } from "./policy-context.js";
import { toKernelContextProperty, plainDecision, plainFieldDecision } from "./policy-kernel.js";
import type {
  AuthorizationPolicyState,
  AuthorizationAuditPage,
  AuthorizationActor,
  AuthorizationPolicyManagementActor,
  AuthorizationEvaluationContext,
  AuthorizationDecisionRecord,
  AuthorizationFieldDecisionRecord,
  AuthorizationBatchCheck,
  AuthorizationBatchResultItem,
  AuthorizationBatchEvaluation,
  PolicyCacheEntry,
} from "./types.js";
import {
  validateIdentifier,
  validateOptionalInstant,
  assertCanonicalPermission,
  validateFieldName,
  authorizationDenied,
} from "./validation.js";

type AuthorizationAccessEvaluationDependencies = Pick<AuthorizationPolicyContext,
  "assertProjectionAvailable" | "load" | "requireDecision" | "runtime" | "store"
>;

export class AuthorizationAccessEvaluation {
  public constructor(
    private readonly context: AuthorizationAccessEvaluationDependencies,
    private readonly ceiling: Pick<AuthorizationEntitlementCeiling, "gateDecision" | "fieldEntitlementGate">,
  ) {}

  public async getPolicy(actor: AuthorizationPolicyManagementActor): Promise<AuthorizationPolicyState> {
    if (isControlPlaneAdministrationActor(actor)) assertContentRealmAdministration(actor);
    const entry = await this.context.load(actor.realmId);
    if (isControlPlaneAdministrationActor(actor)) {
      return entry.state;
    }
    const realmActor = realmPolicyActor(actor);
    this.context.requireDecision(
      evaluateAccess(entry.snapshot, {
        actorSubjectId: asSubjectId(realmActor.subjectId),
        action: asPermissionKey("authorization.read"),
        resourceId: asResourceId(coreResourceId(actor.realmId, "authorization")),
        now: this.context.runtime.now(),
      }),
    );
    return entry.state;
  }

  public async authorize(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationDecisionRecord> {
    return this.authorizeAt(actor, input, this.context.runtime.now());
  }

  public async require(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationDecisionRecord> {
    const decision = await this.authorize(actor, input);
    if (!decision.allowed) {
      authorizationDenied(decision);
    }
    return decision;
  }

  /**
   * Evaluates a target-subject management permission with the same rank and
   * protected-target rules used by authorization policy mutations.
   */
  public async requireSubjectManagement(
    actor: AuthorizationActor,
    input: { readonly action: string; readonly targetSubjectId: string },
  ): Promise<AuthorizationDecisionRecord> {
    const entry = await this.context.load(actor.realmId);
    const decision = authorizeSubjectDisable(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      targetSubjectId: asSubjectId(input.targetSubjectId),
      action: asPermissionKey(input.action),
      now: this.context.runtime.now(),
    });
    if (!decision.allowed) authorizationDenied(decision);
    return plainDecision(decision);
  }

  /** Simulation deliberately calls the same production path and uses the same cache. */
  public async simulate(
    requestingActor: AuthorizationPolicyManagementActor,
    input: {
      readonly subjectId: string;
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
      readonly at?: string;
    },
  ): Promise<AuthorizationDecisionRecord> {
    validateIdentifier(input.subjectId, "simulate.subjectId");
    await this.getPolicy(requestingActor);
    const at = input.at ?? this.context.runtime.now();
    validateOptionalInstant(at, "simulate.at");
    // Only the evaluated identity changes. The requester's separate permission
    // check above prevents the simulator from becoming an authorization proxy.
    return this.authorizeAt(
      { subjectId: input.subjectId, realmId: requestingActor.realmId },
      input,
      at,
    );
  }

  public async evaluateField(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly field: string;
      readonly access: FieldAccessMode;
      /** Permission whose granting roles participate in the field decision. */
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<AuthorizationFieldDecisionRecord> {
    validateFieldName(input.field);
    await this.context.assertProjectionAvailable(actor.realmId, input.resourceId);
    if (input.action !== undefined) assertCanonicalPermission(input.action);
    const entry = await this.context.load(actor.realmId);
    return this.evaluateFieldAt(actor, input, entry, this.context.runtime.now());
  }

  /**
   * Evaluates the authenticated Subject's UI access profile in one immutable
   * policy snapshot. It intentionally cannot proxy evaluation for another
   * Subject; administrators already have the separately authorized simulator.
   */
  public async evaluateBatch(
    actor: AuthorizationActor,
    input: { readonly checks: readonly AuthorizationBatchCheck[] },
  ): Promise<AuthorizationBatchEvaluation> {
    if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 100) {
      throw new ApplicationError(
        "ACCESS_BATCH_SIZE_INVALID",
        422,
        "Access evaluation batches must contain 1-100 checks.",
      );
    }
    const checkIds = new Set<string>();
    for (const check of input.checks) {
      validateIdentifier(check.id, "accessBatch.check.id");
      if (checkIds.has(check.id)) {
        throw new ApplicationError(
          "ACCESS_BATCH_DUPLICATE_ID",
          422,
          `Access evaluation batch contains duplicate check ID '${check.id}'.`,
        );
      }
      checkIds.add(check.id);
      if (check.type !== "permission" && check.type !== "field") {
        throw new ApplicationError(
          "ACCESS_BATCH_CHECK_INVALID",
          422,
          `Access evaluation check '${check.id}' has an unsupported type.`,
        );
      }
      assertCanonicalPermission(check.action);
      validateIdentifier(check.resourceId, `accessBatch.checks.${check.id}.resourceId`);
      if (check.type === "field") {
        validateFieldName(check.field);
        if (check.access !== "read" && check.access !== "write") {
          throw new ApplicationError(
            "ACCESS_BATCH_FIELD_MODE_INVALID",
            422,
            `Access evaluation check '${check.id}' must use read or write field access.`,
          );
        }
      }
    }

    const entry = await this.context.load(actor.realmId);
    const now = this.context.runtime.now();
    const items: AuthorizationBatchResultItem[] = [];
    for (const check of input.checks) {
      await this.context.assertProjectionAvailable(actor.realmId, check.resourceId);
      const permission = entry.state.permissions.find(({ key }) => key === check.action);
      const supported = permission !== undefined && permission.hierarchyGuard === "none";
      if (check.type === "permission") {
        items.push({
          id: check.id,
          type: "permission",
          resourceId: check.resourceId,
          supported,
          decision: await this.authorizeAt(actor, check, now, entry),
        });
        continue;
      }
      items.push({
        id: check.id,
        type: "field",
        action: check.action,
        supported,
        decision: await this.evaluateFieldAt(actor, check, entry, now),
      });
    }
    return { policyRevision: entry.state.revision, items };
  }

  private async evaluateFieldAt(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly field: string;
      readonly access: FieldAccessMode;
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
    entry: PolicyCacheEntry,
    now: string,
  ): Promise<AuthorizationFieldDecisionRecord> {
    const decision = evaluateFieldAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      resourceId: asResourceId(input.resourceId),
      field: input.field,
      access: input.access,
      now,
      ...(input.action === undefined ? {} : { permission: asPermissionKey(input.action) }),
      ...toKernelContextProperty(input.context),
    });
    return plainFieldDecision(decision);
  }

  public async filterReadableData<TData extends Readonly<Record<string, unknown>>>(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly data: TData;
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<Partial<TData>> {
    const action = input.action ?? "content.read";
    await this.context.assertProjectionAvailable(actor.realmId, input.resourceId);
    assertCanonicalPermission(action);
    const entry = await this.context.load(actor.realmId);
    const now = this.context.runtime.now();
    const enclosingDecision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(action),
      resourceId: asResourceId(input.resourceId),
      now,
      ...toKernelContextProperty(input.context),
    });
    this.context.requireDecision(enclosingDecision);
    // Entitlement ceiling: action gate (deny → treat as denied), then field intersection.
    const fieldGate = await this.ceiling.fieldEntitlementGate(actor, entry, { ...input, action });
    if (fieldGate === "deny-action") {
      authorizationDenied({ allowed: false, action, reasonCode: "DENY_ENTITLEMENT_GATE", matchedGrants: [] });
    }
    const ceilingEntitlement = fieldGate === "skip" ? undefined : fieldGate.entitlement;
    const output: [string, unknown][] = [];
    for (const [field, value] of Object.entries(input.data)) {
      validateFieldName(field);
      const decision = evaluateFieldAccess(entry.snapshot, {
        actorSubjectId: asSubjectId(actor.subjectId),
        resourceId: asResourceId(input.resourceId),
        field,
        access: "read",
        permission: asPermissionKey(action),
        now,
        ...toKernelContextProperty(input.context),
      });
      // Field passes only if realm policy allows it AND the ceiling allows it.
      const ceilingAllows = fieldGate === "skip"
        || (ceilingEntitlement !== undefined && entitlementAllowsReadField(ceilingEntitlement, field));
      if (decision.allowed && ceilingAllows) {
        output.push([field, value]);
      }
    }
    return Object.fromEntries(output) as Partial<TData>;
  }

  public async assertWritableData(
    actor: AuthorizationActor,
    input: {
      readonly resourceId: string;
      readonly data: Readonly<Record<string, unknown>>;
      readonly action?: string;
      readonly context?: AuthorizationEvaluationContext;
    },
  ): Promise<void> {
    const action = input.action ?? "content.update";
    await this.context.assertProjectionAvailable(actor.realmId, input.resourceId);
    assertCanonicalPermission(action);
    const entry = await this.context.load(actor.realmId);
    const now = this.context.runtime.now();
    const enclosingDecision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(action),
      resourceId: asResourceId(input.resourceId),
      now,
      ...toKernelContextProperty(input.context),
    });
    const fields = Object.keys(input.data);
    this.context.requireDecision(enclosingDecision);
    // Entitlement ceiling: action gate (deny → forbidden), then field intersection.
    const fieldGate = await this.ceiling.fieldEntitlementGate(actor, entry, { ...input, action });
    if (fieldGate === "deny-action") {
      authorizationDenied({ allowed: false, action, reasonCode: "DENY_ENTITLEMENT_GATE", matchedGrants: [] });
    }
    const ceilingEntitlement = fieldGate === "skip" ? undefined : fieldGate.entitlement;
    const decisions = fields.map((field) => {
      validateFieldName(field);
      const decision = plainFieldDecision(evaluateFieldAccess(entry.snapshot, {
        actorSubjectId: asSubjectId(actor.subjectId),
        resourceId: asResourceId(input.resourceId),
        field,
        access: "write",
        permission: asPermissionKey(action),
        now,
        ...toKernelContextProperty(input.context),
      }));
      // A field is writable only if realm policy AND the ceiling permit it.
      const ceilingAllows = fieldGate === "skip"
        || (ceilingEntitlement !== undefined && entitlementAllowsWriteField(ceilingEntitlement, field));
      return ceilingAllows ? decision : { ...decision, allowed: false };
    });
    const denied = decisions.filter(({ allowed }) => !allowed);
    if (denied.length > 0) {
      throw new ApplicationError(
        "FIELD_WRITE_FORBIDDEN",
        403,
        `Write access was denied for field${denied.length === 1 ? "" : "s"}: ${denied.map(({ field }) => field).join(", ")}.`,
        { details: { decisions: denied } },
      );
    }
  }

  public async listAudit(
    actor: AuthorizationPolicyManagementActor,
    input: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<AuthorizationAuditPage> {
    await this.context.load(actor.realmId);
    if (isControlPlaneAdministrationActor(actor)) {
      assertContentRealmAdministration(actor);
    } else {
      await this.require(realmPolicyActor(actor), {
        action: "audit.read",
        resourceId: coreResourceId(actor.realmId, "audit"),
      });
    }
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ApplicationError("AUDIT_LIMIT_INVALID", 400, "Audit limit must be an integer from 1 to 200.");
    }
    return this.context.store.listAudit({
      realmId: actor.realmId,
      limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
  }

  private async authorizeAt(
    actor: AuthorizationActor,
    input: {
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AuthorizationEvaluationContext;
    },
    now: string,
    entryOverride?: PolicyCacheEntry,
  ): Promise<AuthorizationDecisionRecord> {
    assertCanonicalPermission(input.action);
    await this.context.assertProjectionAvailable(actor.realmId, input.resourceId);
    const entry = entryOverride ?? await this.context.load(actor.realmId);
    const decision = evaluateAccess(entry.snapshot, {
      actorSubjectId: asSubjectId(actor.subjectId),
      action: asPermissionKey(input.action),
      resourceId: asResourceId(input.resourceId),
      now,
      ...toKernelContextProperty(input.context),
    });
    // Narrow the realm-policy decision by the CMS entitlement ceiling.
    return this.ceiling.gateDecision(actor, entry, input, plainDecision(decision));
  }
}
