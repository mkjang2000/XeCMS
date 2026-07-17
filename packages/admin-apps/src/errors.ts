export type AdminAppDecodeIssueCode =
  | "INVALID_JSON_VALUE"
  | "INVALID_JSON_SYNTAX"
  | "INVALID_INPUT_TYPE"
  | "MISSING_PROPERTY"
  | "UNKNOWN_PROPERTY"
  | "INVALID_LITERAL"
  | "UNKNOWN_PAGE_TYPE"
  | "UNKNOWN_LAYOUT_TYPE"
  | "UNKNOWN_PANEL_TYPE";

export interface AdminAppIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export class AdminAppManifestDecodeError extends Error {
  public readonly code = "ADMIN_APP_MANIFEST_DECODE_FAILED";
  public constructor(public readonly issues: readonly AdminAppIssue[]) {
    super(`Admin App Manifest decoding failed with ${issues.length} issue(s).`);
    this.name = "AdminAppManifestDecodeError";
  }
}

export class AdminAppManifestValidationError extends Error {
  public readonly code = "ADMIN_APP_MANIFEST_VALIDATION_FAILED";
  public constructor(public readonly issues: readonly AdminAppIssue[]) {
    super(`Admin App Manifest validation failed with ${issues.length} issue(s).`);
    this.name = "AdminAppManifestValidationError";
  }
}
