import { type IdentityRecord } from "@xecms/application";

export interface IdentityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly is_owner: boolean;
  readonly password_change_required: boolean;
}

export interface SessionRow extends IdentityRow {
  readonly expires_at: Date | string;
}

export function identityFromRow(row: IdentityRow): IdentityRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    username: row.username,
    passwordHash: row.password_hash,
    isOwner: row.is_owner,
    passwordChangeRequired: row.password_change_required,
  };
}
