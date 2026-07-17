export interface AccessEvaluationContext {
  readonly ownerSubjectId?: string;
  readonly status?: string;
}

export type AccessEvaluationCheck =
  | {
      readonly id: string;
      readonly type: "permission";
      readonly action: string;
      readonly resourceId: string;
      readonly context?: AccessEvaluationContext;
    }
  | {
      readonly id: string;
      readonly type: "field";
      readonly action: string;
      readonly resourceId: string;
      readonly field: string;
      readonly access: "read" | "write";
      readonly context?: AccessEvaluationContext;
    };

export interface AccessEvaluationDecision {
  readonly allowed: boolean;
  readonly reasonCode: string;
  readonly policyRevision: number;
}

export type AccessEvaluationResult =
  | {
      readonly id: string;
      readonly type: "permission";
      readonly supported: boolean;
      readonly decision: AccessEvaluationDecision & {
        readonly action: string;
        readonly resourceId: string;
      };
    }
  | {
      readonly id: string;
      readonly type: "field";
      readonly action: string;
      readonly supported: boolean;
      readonly decision: AccessEvaluationDecision & {
        readonly access: "read" | "write";
        readonly field: string;
        readonly resourceId: string;
      };
    };

export interface AccessEvaluationProfile {
  readonly policyRevision: number;
  readonly items: readonly AccessEvaluationResult[];
}

export type AccessVisibility = "allowed" | "denied" | "unsupported" | "missing";

export function accessVisibility(
  profile: AccessEvaluationProfile | undefined,
  checkId: string,
): AccessVisibility {
  const item = profile?.items.find(({ id }) => id === checkId);
  if (item === undefined) return "missing";
  if (!item.supported) return "unsupported";
  return item.decision.allowed ? "allowed" : "denied";
}

export function accessAllowed(
  profile: AccessEvaluationProfile | undefined,
  checkId: string,
): boolean {
  return accessVisibility(profile, checkId) === "allowed";
}

export function anyAccessAllowed(
  profile: AccessEvaluationProfile | undefined,
  checkIds: readonly string[],
): boolean {
  return checkIds.some((checkId) => accessAllowed(profile, checkId));
}

export function allAccessAllowed(
  profile: AccessEvaluationProfile | undefined,
  checkIds: readonly string[],
): boolean {
  return checkIds.length > 0 && checkIds.every((checkId) => accessAllowed(profile, checkId));
}
