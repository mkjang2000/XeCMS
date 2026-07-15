export type PolicyIssueCode =
  | "DUPLICATE_ID"
  | "REALM_ROOT_NOT_FOUND"
  | "REALM_MISMATCH"
  | "REFERENCE_NOT_FOUND"
  | "RESOURCE_CYCLE"
  | "RESOURCE_NOT_CONNECTED_TO_REALM_ROOT"
  | "GROUP_MEMBERSHIP_TARGET_NOT_GROUP"
  | "GROUP_MEMBERSHIP_CYCLE"
  | "DUPLICATE_GROUP_MEMBERSHIP"
  | "DUPLICATE_LEVEL_RANK"
  | "UNKNOWN_PERMISSION"
  | "WILDCARD_PERMISSION_NOT_ALLOWED"
  | "INVALID_DELEGATION"
  | "INVALID_BINDING_PERIOD"
  | "INVALID_BINDING_CONSTRAINT"
  | "INVALID_FIELD_ACCESS_RULE";

export interface PolicyIssue {
  readonly code: PolicyIssueCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly objectId?: string;
}

export class PolicyValidationError extends Error {
  public readonly code = "INVALID_POLICY_GRAPH";

  public constructor(public readonly issues: readonly PolicyIssue[]) {
    super(`Authorization policy validation failed with ${issues.length} issue(s).`);
    this.name = "PolicyValidationError";
  }
}
