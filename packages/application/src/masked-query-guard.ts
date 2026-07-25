import { ApplicationError } from "./errors.js";
import type { DocumentQueryOperator } from "./document-query.js";

/**
 * Whether a masked Field may participate in a query at all, and with which
 * operators. A masked value must never be inferable through free filter, sort,
 * group, or distinct count (see custom-admin-apps §4.10), so the default policy
 * is deny-by-default: a Field that is masked for the requesting user rejects
 * every filter and sort operator. A Mask Policy may later widen this to an
 * explicit safe-operator allowlist, but nothing is allowed until it does.
 */
export interface MaskedFieldQueryPolicy {
  /** Operators permitted in a filter condition on this masked Field. */
  readonly filterOperators?: readonly DocumentQueryOperator[];
  /** Whether the masked Field may be used as a sort key. */
  readonly sortable?: boolean;
}

const DENY_ALL: MaskedFieldQueryPolicy = Object.freeze({ filterOperators: Object.freeze([]), sortable: false });

/**
 * Asserts that a filter operator is safe on a Field that is masked for the
 * requesting user. Fields that are not masked (plain output or full-read on a
 * mask-when-required output) are unaffected and never reach this guard.
 */
export function assertMaskedFilterOperatorAllowed(
  fieldName: string,
  operator: DocumentQueryOperator,
  policy: MaskedFieldQueryPolicy = DENY_ALL,
): void {
  const allowed = policy.filterOperators ?? [];
  if (!allowed.includes(operator)) {
    throw new ApplicationError(
      "MASKED_FIELD_FILTER_FORBIDDEN",
      403,
      `Field '${fieldName}' is masked and cannot be filtered with operator '${operator}'.`,
    );
  }
}

/** Asserts that a Field that is masked for the requesting user may be a sort key. */
export function assertMaskedSortAllowed(
  fieldName: string,
  policy: MaskedFieldQueryPolicy = DENY_ALL,
): void {
  if (policy.sortable !== true) {
    throw new ApplicationError(
      "MASKED_FIELD_SORT_FORBIDDEN",
      403,
      `Field '${fieldName}' is masked and cannot be used as a sort key.`,
    );
  }
}
