import { createHash } from "node:crypto";
import { ApplicationError } from "./errors.js";

export interface RetentionPolicy {
  readonly workspaceId: string;
  readonly auditDays: number | null;
  readonly dispatchedOutboxDays: number | null;
  readonly succeededDeliveryDays: number | null;
  readonly deadDeliveryDays: number | null;
  readonly expiredSessionDays: number | null;
  readonly softDeletedDocumentDays: number | null;
  readonly revision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface RetentionCounts {
  readonly systemAudit: number;
  readonly documentAudit: number;
  readonly authorizationAudit: number;
  readonly dispatchedOutbox: number;
  readonly succeededDeliveries: number;
  readonly deadDeliveries: number;
  readonly expiredSessions: number;
  readonly softDeletedDocuments: number;
}

export type RetentionCutoffs = Readonly<Record<
  "audit" | "dispatchedOutbox" | "succeededDelivery" | "deadDelivery"
    | "expiredSession" | "softDeletedDocument",
  string | null
>>;

export interface RetentionPlan {
  readonly id: string;
  readonly workspaceId: string;
  readonly policyRevision: number;
  readonly status: "previewed" | "applied" | "expired";
  readonly referenceAt: string;
  readonly cutoffs: RetentionCutoffs;
  readonly counts: RetentionCounts;
  readonly estimatedBytes: Readonly<Record<string, number>>;
  readonly digest: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly expiresAt: string;
  readonly appliedAt?: string;
  readonly appliedBy?: string;
  readonly results?: RetentionCounts;
}

export interface RetentionStore {
  getPolicy(workspaceId: string): Promise<RetentionPolicy | null>;
  updatePolicy(input: Omit<RetentionPolicy, "revision" | "updatedAt" | "updatedBy"> & {
    readonly expectedRevision: number; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string;
  }): Promise<RetentionPolicy>;
  createPlan(input: { readonly id: string; readonly workspaceId: string;
    readonly expectedPolicyRevision: number; readonly referenceAt: string;
    readonly cutoffs: RetentionCutoffs; readonly digestSeed: string; readonly createdAt: string;
    readonly createdBy: string; readonly expiresAt: string }): Promise<RetentionPlan>;
  getPlan(workspaceId: string, planId: string): Promise<RetentionPlan | null>;
  applyPlan(input: { readonly workspaceId: string; readonly planId: string;
    readonly expectedPolicyRevision: number; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string }): Promise<RetentionPlan>;
}

export interface RetentionRuntime {
  readonly now: () => string;
  readonly newPlanId: () => string;
}

export class RetentionService {
  public constructor(private readonly store: RetentionStore, private readonly runtime: RetentionRuntime) {}

  public async getPolicy(workspaceId: string): Promise<RetentionPolicy> {
    const policy = await this.store.getPolicy(workspaceId);
    if (policy === null) throw new ApplicationError("RETENTION_POLICY_NOT_FOUND", 404, "Retention policy does not exist.");
    return policy;
  }

  public updatePolicy(input: {
    readonly workspaceId: string; readonly expectedRevision: number;
    readonly auditDays: number | null; readonly dispatchedOutboxDays: number | null;
    readonly succeededDeliveryDays: number | null; readonly deadDeliveryDays: number | null;
    readonly expiredSessionDays: number | null; readonly softDeletedDocumentDays: number | null;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
  }): Promise<RetentionPolicy> {
    validateDays(input.auditDays, 90, "auditDays");
    validateDays(input.dispatchedOutboxDays, 7, "dispatchedOutboxDays");
    validateDays(input.succeededDeliveryDays, 7, "succeededDeliveryDays");
    validateDays(input.deadDeliveryDays, 30, "deadDeliveryDays");
    validateDays(input.expiredSessionDays, 1, "expiredSessionDays");
    validateDays(input.softDeletedDocumentDays, 1, "softDeletedDocumentDays");
    return this.store.updatePolicy({ ...input, now: this.runtime.now() });
  }

  public async preview(input: { readonly workspaceId: string; readonly expectedPolicyRevision: number;
    readonly actorIdentityId: string }): Promise<RetentionPlan> {
    const policy = await this.getPolicy(input.workspaceId);
    if (policy.revision !== input.expectedPolicyRevision) conflict(input.expectedPolicyRevision, policy.revision);
    const now = this.runtime.now();
    const cutoffs: RetentionCutoffs = {
      audit: cutoff(now, policy.auditDays),
      dispatchedOutbox: cutoff(now, policy.dispatchedOutboxDays),
      succeededDelivery: cutoff(now, policy.succeededDeliveryDays),
      deadDelivery: cutoff(now, policy.deadDeliveryDays),
      expiredSession: cutoff(now, policy.expiredSessionDays),
      softDeletedDocument: cutoff(now, policy.softDeletedDocumentDays),
    };
    const digestSeed = JSON.stringify({ workspaceId: input.workspaceId, policyRevision: policy.revision,
      referenceAt: now, cutoffs });
    return this.store.createPlan({
      id: this.runtime.newPlanId(), workspaceId: input.workspaceId,
      expectedPolicyRevision: input.expectedPolicyRevision, referenceAt: now, cutoffs,
      digestSeed: createHash("sha256").update(digestSeed).digest("hex"), createdAt: now,
      createdBy: input.actorIdentityId, expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
    });
  }

  public async getPlan(workspaceId: string, planId: string): Promise<RetentionPlan> {
    const plan = await this.store.getPlan(workspaceId, planId);
    if (plan === null) throw new ApplicationError("RETENTION_PLAN_NOT_FOUND", 404, "Retention plan does not exist.");
    return plan;
  }

  public apply(input: { readonly workspaceId: string; readonly planId: string;
    readonly expectedPolicyRevision: number; readonly actorIdentityId: string;
    readonly actorSubjectId: string }): Promise<RetentionPlan> {
    return this.store.applyPlan({ ...input, now: this.runtime.now() });
  }
}

function validateDays(value: number | null, minimum: number, name: string): void {
  if (value !== null && (!Number.isInteger(value) || value < minimum || value > 36_500)) {
    throw new ApplicationError("RETENTION_POLICY_INVALID", 422, `${name} must be null or ${minimum}..36500.`);
  }
}
function cutoff(now: string, days: number | null): string | null {
  return days === null ? null : new Date(Date.parse(now) - days * 86_400_000).toISOString();
}
function conflict(expectedRevision: number, actualRevision: number): never {
  throw new ApplicationError("RETENTION_POLICY_REVISION_CONFLICT", 409,
    "Retention policy changed after it was read.", { details: { expectedRevision, actualRevision } });
}
