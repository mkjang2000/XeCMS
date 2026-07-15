import {
  ApplicationError,
  type IdentityAdministrationStore,
  type ApiKeyRecord,
  type AuthenticatedApiKey,
  type ManagedIdentity,
  type ManagedIdentityKind,
  type ManagedIdentityMembership,
  type ManagedIdentityPage,
  type ManagedIdentityStatus,
  type ManagedSession,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";
import { SYSTEM_REALM_ID } from "./migrate.js";

export class PostgresIdentityAdministrationStore implements IdentityAdministrationStore {
  private readonly schema: string;

  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async list(input: {
    readonly workspaceId: string;
    readonly limit: number;
    readonly cursor?: string;
    readonly query?: string;
    readonly kind?: ManagedIdentityKind;
    readonly status?: ManagedIdentityStatus;
    readonly originRealmId?: string;
    readonly realmId?: string;
  }): Promise<ManagedIdentityPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ApplicationError("IDENTITY_PAGE_INVALID", 400, "Identity limit must be between 1 and 100.");
    }
    const values: unknown[] = [input.workspaceId];
    const filters = ["identity.workspace_id = $1"];
    if (input.cursor !== undefined) {
      const cursor = decodeCursor(input.cursor);
      values.push(cursor.normalizedIdentifier, cursor.id);
      filters.push(`(identity.normalized_username, identity.id) > ($${values.length - 1}, $${values.length})`);
    }
    if (input.query !== undefined) {
      const query = input.query.trim();
      if (query.length === 0 || query.length > 120) invalidFilter("query");
      values.push(`%${escapeLike(query.toLocaleLowerCase("en-US"))}%`);
      filters.push(`identity.normalized_username LIKE $${values.length} ESCAPE '\\'`);
    }
    if (input.kind !== undefined) { values.push(input.kind); filters.push(`identity.identity_kind = $${values.length}`); }
    if (input.status !== undefined) {
      filters.push(input.status === "active" ? "identity.disabled_at IS NULL" : "identity.disabled_at IS NOT NULL");
    }
    if (input.originRealmId !== undefined) { values.push(input.originRealmId); filters.push(`identity.origin_realm_id = $${values.length}`); }
    if (input.realmId !== undefined) {
      values.push(input.realmId);
      filters.push(`EXISTS (SELECT 1 FROM ${this.q("_xecms_realm_memberships")} realm_filter WHERE realm_filter.identity_id = identity.id AND realm_filter.realm_id = $${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query<IdentityAdministrationRow>(
      `${IDENTITY_ADMIN_SELECT(this.q.bind(this))}
       WHERE ${filters.join(" AND ")}
       ORDER BY identity.normalized_username ASC, identity.id ASC
       LIMIT $${values.length}`,
      values,
    );
    const hasNext = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(identityFromRow),
      ...(hasNext && last !== undefined
        ? { nextCursor: encodeCursor(last.normalized_username, last.id) }
        : {}),
    };
  }

  public async get(identityId: string, workspaceId: string): Promise<ManagedIdentity | null> {
    const result = await this.pool.query<IdentityAdministrationRow>(
      `${IDENTITY_ADMIN_SELECT(this.q.bind(this))}
       WHERE identity.id = $1 AND identity.workspace_id = $2`,
      [identityId, workspaceId],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }

  public async createHuman(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly primaryIdentifier: string;
    readonly normalizedIdentifier: string;
    readonly passwordHash: string;
    readonly passwordChangeRequired: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${this.q("_xecms_identities")}
           (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
            password_hash, is_owner, credential_version, identity_kind, revision,
            password_change_required, created_at, updated_at, updated_by)
         SELECT $1, $2, realm.id, realm.id, $3, $4, $5, false, 1, 'human', 1,
                $6, $7, $7, $8
           FROM ${this.q("_xecms_realms")} realm
          WHERE realm.id = $9 AND realm.workspace_id = $2 AND realm.kind = 'system'`,
        [input.id, input.workspaceId, input.primaryIdentifier, input.normalizedIdentifier,
          input.passwordHash, input.passwordChangeRequired, input.now, input.actorIdentityId,
          SYSTEM_REALM_ID],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_identity_identifiers")}
           (id, workspace_id, identity_id, identifier_kind, normalized_value,
            display_value, verified_at, created_at, created_by)
         VALUES ($1, $2, $3, 'username', $4, $5, $6, $6, $7)`,
        [`identifier_${input.id}`, input.workspaceId, input.id, input.normalizedIdentifier,
          input.primaryIdentifier, input.now, input.actorIdentityId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_subjects")}
           (id, realm_id, subject_type, display_name, identity_id, protected,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, 'user', $3, $1, false, $4, $5, $4, $5)`,
        [input.id, SYSTEM_REALM_ID, input.primaryIdentifier, input.now, input.actorSubjectId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_realm_memberships")}
           (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, updated_at, updated_by)
         VALUES ('membership_system_' || md5($1), $2, $1, $3, $1, 'active', 'explicit',
                 1, $4, $5, $4, $4, $5)`,
        [input.id, input.workspaceId, SYSTEM_REALM_ID, input.now, input.actorIdentityId],
      );
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID,
        actorSubjectId: input.actorSubjectId,
        action: "identity.create",
        targetId: input.id,
        auditId: input.auditId,
        before: null,
        after: { id: input.id, primaryIdentifier: input.primaryIdentifier, kind: "human" },
        now: input.now,
      });
      await this.securityEvent(client, {
        event: "identity.created",
        identityId: input.id,
        actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId,
        payload: { identityId: input.id, originRealmId: SYSTEM_REALM_ID, kind: "human" },
        now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(input.id, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally {
      client.release();
    }
  }

  public async updateIdentifier(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly primaryIdentifier: string;
    readonly normalizedIdentifier: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await this.lockIdentity(client, input.identityId, input.workspaceId);
      assertRevision(before, input.expectedRevision);
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET username = $3, normalized_username = $4, revision = revision + 1,
                updated_at = $5, updated_by = $6
          WHERE id = $1 AND workspace_id = $2`,
        [input.identityId, input.workspaceId, input.primaryIdentifier,
          input.normalizedIdentifier, input.now, input.actorIdentityId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_identity_identifiers")}
            SET normalized_value = $2, display_value = $3
          WHERE identity_id = $1 AND normalized_value = $4`,
        [input.identityId, input.normalizedIdentifier, input.primaryIdentifier,
          before.normalized_username],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_auth_subjects")}
            SET display_name = $2, updated_at = $3, updated_by = $4
          WHERE realm_id = $5 AND identity_id = $1`,
        [input.identityId, input.primaryIdentifier, input.now, input.actorSubjectId, SYSTEM_REALM_ID],
      );
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID, actorSubjectId: input.actorSubjectId,
        action: "identity.update", targetId: input.identityId, auditId: input.auditId,
        before: { primaryIdentifier: before.username },
        after: { primaryIdentifier: input.primaryIdentifier }, now: input.now,
      });
      await this.securityEvent(client, {
        event: "identity.updated", identityId: input.identityId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId,
        payload: { identityId: input.identityId, before: { primaryIdentifier: before.username }, after: { primaryIdentifier: input.primaryIdentifier } },
        now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(input.identityId, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async setDisabled(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly disabled: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await this.lockIdentity(client, input.identityId, input.workspaceId);
      assertRevision(before, input.expectedRevision);
      if (before.is_owner && input.disabled) {
        throw new ApplicationError("IDENTITY_OWNER_DISABLE_FORBIDDEN", 409, "Transfer Workspace ownership before disabling the Owner.");
      }
      const alreadyDisabled = before.disabled_at !== null;
      if (alreadyDisabled === input.disabled) {
        throw new ApplicationError("IDENTITY_STATUS_UNCHANGED", 409, "The Identity already has the requested status.");
      }
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET disabled_at = $3, revision = revision + 1,
                credential_version = credential_version + CASE WHEN $3::timestamptz IS NULL THEN 0 ELSE 1 END,
                updated_at = $4, updated_by = $5
          WHERE id = $1 AND workspace_id = $2`,
        [input.identityId, input.workspaceId, input.disabled ? input.now : null,
          input.now, input.actorIdentityId],
      );
      const subjects = await client.query<{ realm_id: string; id: string }>(
        `UPDATE ${this.q("_xecms_auth_subjects")} subject
            SET disabled_at = CASE WHEN $2 THEN $3::timestamptz
                 WHEN membership.status = 'active' THEN NULL ELSE subject.disabled_at END,
                updated_at = $3, updated_by = $4
           FROM ${this.q("_xecms_realm_memberships")} membership
          WHERE subject.identity_id = $1 AND membership.identity_id = $1
            AND membership.realm_id = subject.realm_id AND membership.subject_id = subject.id
            AND ($2 OR membership.status = 'active')
          RETURNING subject.realm_id, subject.id`,
        [input.identityId, input.disabled, input.now, input.actorSubjectId],
      );
      if (input.disabled) {
        await client.query(
          `UPDATE ${this.q("_xecms_sessions")}
              SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'identity-disabled'
            WHERE identity_id = $1 AND revoked_at IS NULL`,
          [input.identityId, input.now, input.actorIdentityId],
        );
        await client.query(
          `UPDATE ${this.q("_xecms_api_keys")}
              SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'identity-disabled'
            WHERE identity_id = $1 AND revoked_at IS NULL`,
          [input.identityId, input.now, input.actorIdentityId],
        );
        await client.query(
          `UPDATE ${this.q("_xecms_credential_tokens")}
              SET revoked_at = $2
            WHERE identity_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
          [input.identityId, input.now],
        );
      }
      for (const [index, subject] of subjects.rows.entries()) {
        await this.bumpSubjectPolicy(client, {
          realmId: subject.realm_id, actorSubjectId: input.actorSubjectId,
          action: input.disabled ? "identity.disable" : "identity.reactivate",
          targetId: subject.id, auditId: `${input.auditId}_${index}`,
          before: { disabled: !input.disabled }, after: { disabled: input.disabled }, now: input.now,
        });
      }
      await this.securityEvent(client, {
        event: input.disabled ? "identity.disabled" : "identity.reactivated",
        identityId: input.identityId, actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId, workspaceId: input.workspaceId,
        payload: { identityId: input.identityId }, now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(input.identityId, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async resetPassword(input: {
    readonly identityId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly passwordHash: string; readonly revokeApiKeys: boolean;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string; readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await this.lockIdentity(client, input.identityId, input.workspaceId);
      assertRevision(before, input.expectedRevision);
      if (before.identity_kind !== "human") {
        throw new ApplicationError("SERVICE_IDENTITY_PASSWORD_FORBIDDEN", 409, "Service Identities cannot have passwords.");
      }
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET password_hash = $3, password_change_required = true,
                credential_version = credential_version + 1, revision = revision + 1,
                updated_at = $4, updated_by = $5
          WHERE id = $1 AND workspace_id = $2`,
        [input.identityId, input.workspaceId, input.passwordHash, input.now, input.actorIdentityId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_sessions")}
            SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'credential-reset'
          WHERE identity_id = $1 AND revoked_at IS NULL`,
        [input.identityId, input.now, input.actorIdentityId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_credential_tokens")}
            SET revoked_at = $2
          WHERE identity_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [input.identityId, input.now],
      );
      if (input.revokeApiKeys) {
        await client.query(
          `UPDATE ${this.q("_xecms_api_keys")}
              SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'credential-reset'
            WHERE identity_id = $1 AND revoked_at IS NULL`,
          [input.identityId, input.now, input.actorIdentityId],
        );
      }
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID, actorSubjectId: input.actorSubjectId,
        action: "identity.credentials.reset", targetId: input.identityId, auditId: input.auditId,
        before: { credentialVersion: "previous" }, after: { credentialVersion: "incremented", revokeApiKeys: input.revokeApiKeys }, now: input.now,
      });
      await this.securityEvent(client, {
        event: "identity.credentials.reset", identityId: input.identityId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId,
        payload: { identityId: input.identityId, revokeApiKeys: input.revokeApiKeys }, now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(input.identityId, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async createCredentialToken(input: {
    readonly id: string; readonly identityId: string; readonly workspaceId: string;
    readonly expectedRevision: number; readonly purpose: "invitation" | "password-reset";
    readonly digest: string; readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string; readonly expiresAt: string; readonly auditId: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await this.lockIdentity(client, input.identityId, input.workspaceId);
      assertRevision(before, input.expectedRevision);
      if (before.identity_kind !== "human" || before.disabled_at !== null) {
        throw new ApplicationError("CREDENTIAL_TOKEN_IDENTITY_INVALID", 409, "Credential tokens require an active human Identity.");
      }
      await client.query(
        `UPDATE ${this.q("_xecms_credential_tokens")}
            SET revoked_at = $2
          WHERE identity_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [input.identityId, input.now],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_credential_tokens")}
           (id, workspace_id, identity_id, purpose, token_digest, created_at,
            created_by_identity_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [input.id, input.workspaceId, input.identityId, input.purpose, input.digest,
          input.now, input.actorIdentityId, input.expiresAt],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET revision = revision + 1, updated_at = $3, updated_by = $4,
                credential_version = credential_version + CASE WHEN $5 = 'password-reset' THEN 1 ELSE 0 END
          WHERE id = $1 AND workspace_id = $2`,
        [input.identityId, input.workspaceId, input.now, input.actorIdentityId, input.purpose],
      );
      if (input.purpose === "password-reset") {
        await client.query(
          `UPDATE ${this.q("_xecms_sessions")}
              SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'credential-reset-token-issued'
            WHERE identity_id = $1 AND revoked_at IS NULL`,
          [input.identityId, input.now, input.actorIdentityId],
        );
      }
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID, actorSubjectId: input.actorSubjectId,
        action: input.purpose === "invitation" ? "identity.invite" : "identity.credentials.reset",
        targetId: input.identityId, auditId: input.auditId, before: null,
        after: { purpose: input.purpose, expiresAt: input.expiresAt }, now: input.now,
      });
      await this.securityEvent(client, {
        event: `identity.${input.purpose}.issued`, identityId: input.identityId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId,
        payload: { identityId: input.identityId, purpose: input.purpose, expiresAt: input.expiresAt },
        now: input.now,
      });
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async resolveCredentialToken(input: {
    readonly purpose: "invitation" | "password-reset"; readonly digest: string; readonly now: string;
  }): Promise<{ readonly identityId: string; readonly primaryIdentifier: string; readonly purpose: "invitation" | "password-reset" } | null> {
    const result = await this.pool.query<{ identity_id: string; username: string; purpose: "invitation" | "password-reset" }>(
      `SELECT token.identity_id, identity.username, token.purpose
         FROM ${this.q("_xecms_credential_tokens")} token
         JOIN ${this.q("_xecms_identities")} identity ON identity.id = token.identity_id
        WHERE token.purpose = $1 AND token.token_digest = $2 AND token.expires_at > $3
          AND token.used_at IS NULL AND token.revoked_at IS NULL
          AND identity.identity_kind = 'human' AND identity.disabled_at IS NULL`,
      [input.purpose, input.digest, input.now],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      identityId: row.identity_id, primaryIdentifier: row.username, purpose: row.purpose,
    };
  }

  public async consumeCredentialToken(input: {
    readonly purpose: "invitation" | "password-reset"; readonly digest: string;
    readonly identityId: string; readonly passwordHash: string; readonly now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query(
        `UPDATE ${this.q("_xecms_credential_tokens")} token
            SET used_at = $4
           FROM ${this.q("_xecms_identities")} identity
          WHERE token.identity_id = $1 AND token.purpose = $2 AND token.token_digest = $3
            AND token.identity_id = identity.id AND identity.identity_kind = 'human'
            AND identity.disabled_at IS NULL AND token.expires_at > $4
            AND token.used_at IS NULL AND token.revoked_at IS NULL
          RETURNING token.id`,
        [input.identityId, input.purpose, input.digest, input.now],
      );
      if (consumed.rowCount !== 1) credentialTokenInvalid();
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET password_hash = $2, password_change_required = false,
                credential_version = credential_version + 1, revision = revision + 1,
                updated_at = $3, updated_by = id
          WHERE id = $1`,
        [input.identityId, input.passwordHash, input.now],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_credential_tokens")}
            SET revoked_at = $2
          WHERE identity_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [input.identityId, input.now],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_sessions")}
            SET revoked_at = $2, revoked_by_identity_id = $1, revoke_reason = 'credential-token-consumed'
          WHERE identity_id = $1 AND revoked_at IS NULL`,
        [input.identityId, input.now],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_audit_log")}(event_type, identity_id, occurred_at, metadata)
         VALUES ('identity.credential-token.consumed', $1, $2, $3::jsonb)`,
        [input.identityId, input.now, JSON.stringify({ identityId: input.identityId, purpose: input.purpose })],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async changePassword(input: {
    readonly identityId: string; readonly workspaceId: string;
    readonly passwordHash: string; readonly now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET password_hash = $3, password_change_required = false,
                credential_version = credential_version + 1, revision = revision + 1,
                updated_at = $4, updated_by = id
          WHERE id = $1 AND workspace_id = $2 AND identity_kind = 'human' AND disabled_at IS NULL
          RETURNING id`,
        [input.identityId, input.workspaceId, input.passwordHash, input.now],
      );
      if (changed.rowCount !== 1) {
        throw new ApplicationError("PASSWORD_CHANGE_IDENTITY_INVALID", 409, "The password cannot be changed for this Identity.");
      }
      await client.query(
        `UPDATE ${this.q("_xecms_sessions")}
            SET revoked_at = $2, revoked_by_identity_id = $1, revoke_reason = 'password-changed'
          WHERE identity_id = $1 AND revoked_at IS NULL`,
        [input.identityId, input.now],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_credential_tokens")} SET revoked_at = $2
          WHERE identity_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [input.identityId, input.now],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK"); throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async createSystemMembership(input: {
    readonly identityId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string; readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const before = await this.lockIdentity(client, input.identityId, input.workspaceId);
      assertRevision(before, input.expectedRevision);
      if (before.identity_kind !== "human" || before.disabled_at !== null) {
        throw new ApplicationError("SYSTEM_MEMBERSHIP_IDENTITY_INVALID", 409, "System Membership requires an active human Identity.");
      }
      const exists = await client.query(
        `SELECT 1 FROM ${this.q("_xecms_realm_memberships")} WHERE identity_id = $1 AND realm_id = $2`,
        [input.identityId, SYSTEM_REALM_ID],
      );
      if (exists.rowCount !== 0) {
        throw new ApplicationError("SYSTEM_MEMBERSHIP_EXISTS", 409, "The Identity already has a System Membership.");
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_subjects")}
           (id, realm_id, subject_type, display_name, identity_id, protected,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, 'user', $3, $1, false, $4, $5, $4, $5)`,
        [input.identityId, SYSTEM_REALM_ID, before.username, input.now, input.actorSubjectId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_realm_memberships")}
           (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, updated_at, updated_by)
         VALUES ('membership_system_' || md5($1), $2, $1, $3, $1, 'active', 'explicit',
                 1, $4, $5, $4, $4, $5)`,
        [input.identityId, input.workspaceId, SYSTEM_REALM_ID, input.now, input.actorIdentityId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET revision = revision + 1, updated_at = $3, updated_by = $4
          WHERE id = $1 AND workspace_id = $2`,
        [input.identityId, input.workspaceId, input.now, input.actorIdentityId],
      );
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID, actorSubjectId: input.actorSubjectId,
        action: "identity.system-membership.create", targetId: input.identityId,
        auditId: input.auditId, before: null, after: { status: "active" }, now: input.now,
      });
      await this.securityEvent(client, {
        event: "identity.system-membership.created", identityId: input.identityId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId, payload: { identityId: input.identityId }, now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(input.identityId, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK"); throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async listSessions(input: {
    readonly identityId: string; readonly workspaceId: string; readonly currentSessionId?: string;
  }): Promise<readonly ManagedSession[]> {
    const result = await this.pool.query<ManagedSessionRow>(
      `SELECT session.id, session.audience, session.identity_id, session.realm_id,
              realm.name AS realm_name, session.membership_id, session.created_at,
              session.authenticated_at, session.expires_at, session.revoked_at,
              session.revoked_by_identity_id, session.revoke_reason
         FROM ${this.q("_xecms_sessions")} session
         JOIN ${this.q("_xecms_identities")} identity ON identity.id = session.identity_id
         JOIN ${this.q("_xecms_realms")} realm ON realm.id = session.realm_id
        WHERE session.identity_id = $1 AND identity.workspace_id = $2
        ORDER BY session.created_at DESC, session.id DESC`,
      [input.identityId, input.workspaceId],
    );
    return result.rows.map((row) => sessionFromRow(row, row.id === input.currentSessionId));
  }

  public async getSession(sessionId: string, workspaceId: string): Promise<ManagedSession | null> {
    const result = await this.pool.query<ManagedSessionRow>(
      `SELECT session.id, session.audience, session.identity_id, session.realm_id,
              realm.name AS realm_name, session.membership_id, session.created_at,
              session.authenticated_at, session.expires_at, session.revoked_at,
              session.revoked_by_identity_id, session.revoke_reason
         FROM ${this.q("_xecms_sessions")} session
         JOIN ${this.q("_xecms_identities")} identity ON identity.id = session.identity_id
         JOIN ${this.q("_xecms_realms")} realm ON realm.id = session.realm_id
        WHERE session.id = $1 AND identity.workspace_id = $2`,
      [sessionId, workspaceId],
    );
    return result.rows[0] === undefined ? null : sessionFromRow(result.rows[0], false);
  }

  public async revokeSession(input: {
    readonly sessionId: string; readonly workspaceId: string;
    readonly actorIdentityId: string; readonly now: string;
  }): Promise<ManagedSession> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<ManagedSessionRow>(
        `SELECT session.id, session.audience, session.identity_id, session.realm_id,
                realm.name AS realm_name, session.membership_id, session.created_at,
                session.authenticated_at, session.expires_at, session.revoked_at,
                session.revoked_by_identity_id, session.revoke_reason
           FROM ${this.q("_xecms_sessions")} session
           JOIN ${this.q("_xecms_identities")} identity ON identity.id = session.identity_id
           JOIN ${this.q("_xecms_realms")} realm ON realm.id = session.realm_id
          WHERE session.id = $1 AND identity.workspace_id = $2 FOR UPDATE OF session`,
        [input.sessionId, input.workspaceId],
      );
      const row = selected.rows[0];
      if (row === undefined) throw new ApplicationError("SESSION_NOT_FOUND", 404, "The session does not exist.");
      if (row.revoked_at !== null) throw new ApplicationError("SESSION_ALREADY_REVOKED", 409, "The session is already revoked.");
      await client.query(
        `UPDATE ${this.q("_xecms_sessions")}
            SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'administrator-revoked'
          WHERE id = $1`,
        [input.sessionId, input.now, input.actorIdentityId],
      );
      await client.query("COMMIT");
      return sessionFromRow({ ...row, revoked_at: input.now, revoked_by_identity_id: input.actorIdentityId, revoke_reason: "administrator-revoked" }, false);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async revokeAllSessions(input: {
    readonly identityId: string; readonly workspaceId: string;
    readonly actorIdentityId: string; readonly now: string;
  }): Promise<number> {
    const result = await this.pool.query(
      `UPDATE ${this.q("_xecms_sessions")} session
          SET revoked_at = $3, revoked_by_identity_id = $4, revoke_reason = 'administrator-revoked-all'
         FROM ${this.q("_xecms_identities")} identity
        WHERE session.identity_id = $1 AND identity.id = session.identity_id
          AND identity.workspace_id = $2 AND session.revoked_at IS NULL`,
      [input.identityId, input.workspaceId, input.now, input.actorIdentityId],
    );
    return result.rowCount ?? 0;
  }

  public async transferOwner(input: {
    readonly workspaceId: string; readonly targetIdentityId: string; readonly reason: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string; readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<LockedIdentityRow>(
        `SELECT id, username, normalized_username, identity_kind, revision, is_owner, disabled_at
           FROM ${this.q("_xecms_identities")}
          WHERE workspace_id = $1 AND is_owner = true FOR UPDATE`,
        [input.workspaceId],
      );
      const current = currentResult.rows[0];
      if (current === undefined || current.id !== input.actorIdentityId) {
        throw new ApplicationError("OWNER_TRANSFER_OWNER_REQUIRED", 403, "Only the current Workspace Owner can transfer ownership.");
      }
      const target = await this.lockIdentity(client, input.targetIdentityId, input.workspaceId);
      if (target.identity_kind !== "human" || target.disabled_at !== null) {
        throw new ApplicationError("OWNER_TRANSFER_TARGET_INVALID", 409, "The new Owner must be an active human Identity.");
      }
      const targetMembership = await client.query<{ subject_id: string }>(
        `SELECT membership.subject_id
           FROM ${this.q("_xecms_realm_memberships")} membership
           JOIN ${this.q("_xecms_auth_subjects")} subject
             ON subject.realm_id = membership.realm_id AND subject.id = membership.subject_id
          WHERE membership.identity_id = $1 AND membership.realm_id = $2
            AND membership.status = 'active' AND subject.disabled_at IS NULL FOR UPDATE OF membership, subject`,
        [target.id, SYSTEM_REALM_ID],
      );
      const targetSubjectId = targetMembership.rows[0]?.subject_id;
      if (targetSubjectId === undefined) {
        throw new ApplicationError("OWNER_TRANSFER_TARGET_INVALID", 409, "The new Owner needs an active System Membership.");
      }
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET is_owner = false, credential_version = credential_version + 1,
                revision = revision + 1, updated_at = $3, updated_by = $2
          WHERE id = $1`,
        [current.id, input.actorIdentityId, input.now],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_identities")}
            SET is_owner = true, credential_version = credential_version + 1,
                revision = revision + 1, updated_at = $3, updated_by = $2
          WHERE id = $1`,
        [target.id, input.actorIdentityId, input.now],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_auth_subjects")}
            SET protected = CASE WHEN id = $2 THEN true ELSE false END,
                updated_at = $3, updated_by = $2
          WHERE realm_id = $4 AND id IN ($1, $2)`,
        [input.actorSubjectId, targetSubjectId, input.now, SYSTEM_REALM_ID],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_auth_role_bindings")}
            SET subject_id = $2, updated_at = $3, updated_by = $2
          WHERE realm_id = $4 AND subject_id = $1
            AND role_id = 'authorization:' || $4 || ':role:owner' AND protected = true`,
        [input.actorSubjectId, targetSubjectId, input.now, SYSTEM_REALM_ID],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_sessions")} session
            SET revoked_at = $2, revoked_by_identity_id = $3, revoke_reason = 'owner-transferred'
           FROM ${this.q("_xecms_identities")} identity
          WHERE session.identity_id = identity.id AND identity.workspace_id = $1
            AND session.audience = 'admin' AND session.revoked_at IS NULL`,
        [input.workspaceId, input.now, input.actorIdentityId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_credential_tokens")}
            SET revoked_at = $3
          WHERE identity_id IN ($1, $2) AND used_at IS NULL AND revoked_at IS NULL`,
        [current.id, target.id, input.now],
      );
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID, actorSubjectId: input.actorSubjectId,
        action: "identity.owner.transfer", targetId: targetSubjectId, auditId: input.auditId,
        before: { ownerIdentityId: current.id }, after: { ownerIdentityId: target.id, reason: input.reason }, now: input.now,
      });
      await this.securityEvent(client, {
        event: "identity.owner.transferred", identityId: target.id,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId,
        payload: { previousOwnerIdentityId: current.id, ownerIdentityId: target.id, reason: input.reason }, now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(target.id, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async createService(input: {
    readonly id: string; readonly workspaceId: string;
    readonly primaryIdentifier: string; readonly normalizedIdentifier: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string; readonly auditId: string;
  }): Promise<ManagedIdentity> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${this.q("_xecms_identities")}
           (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
            password_hash, is_owner, credential_version, identity_kind, revision,
            password_change_required, created_at, updated_at, updated_by)
         SELECT $1, $2, realm.id, realm.id, $3, $4, '$xecms$service$disabled',
                false, 1, 'service', 1, false, $5, $5, $6
           FROM ${this.q("_xecms_realms")} realm
          WHERE realm.id = $7 AND realm.workspace_id = $2 AND realm.kind = 'system'`,
        [input.id, input.workspaceId, input.primaryIdentifier, input.normalizedIdentifier,
          input.now, input.actorIdentityId, SYSTEM_REALM_ID],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_identity_identifiers")}
           (id, workspace_id, identity_id, identifier_kind, normalized_value,
            display_value, verified_at, created_at, created_by)
         VALUES ($1, $2, $3, 'username', $4, $5, $6, $6, $7)`,
        [`identifier_${input.id}`, input.workspaceId, input.id, input.normalizedIdentifier,
          input.primaryIdentifier, input.now, input.actorIdentityId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_subjects")}
           (id, realm_id, subject_type, display_name, identity_id, protected,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, 'service-account', $3, $1, false, $4, $5, $4, $5)`,
        [input.id, SYSTEM_REALM_ID, input.primaryIdentifier, input.now, input.actorSubjectId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_realm_memberships")}
           (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, updated_at, updated_by)
         VALUES ('membership_system_' || md5($1), $2, $1, $3, $1, 'active', 'explicit',
                 1, $4, $5, $4, $4, $5)`,
        [input.id, input.workspaceId, SYSTEM_REALM_ID, input.now, input.actorIdentityId],
      );
      await this.bumpSubjectPolicy(client, {
        realmId: SYSTEM_REALM_ID, actorSubjectId: input.actorSubjectId,
        action: "service-account.create", targetId: input.id, auditId: input.auditId,
        before: null, after: { id: input.id, primaryIdentifier: input.primaryIdentifier, kind: "service" }, now: input.now,
      });
      await this.securityEvent(client, {
        event: "service-account.created", identityId: input.id,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId, payload: { identityId: input.id }, now: input.now,
      });
      await client.query("COMMIT");
      return (await this.get(input.id, input.workspaceId))!;
    } catch (error: unknown) {
      await client.query("ROLLBACK"); throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async listApiKeys(identityId: string, workspaceId: string): Promise<readonly ApiKeyRecord[]> {
    const result = await this.pool.query<ApiKeyRow>(
      `${API_KEY_SELECT(this.q.bind(this))}
        JOIN ${this.q("_xecms_identities")} identity ON identity.id = api_key.identity_id
       WHERE api_key.identity_id = $1 AND identity.workspace_id = $2
       ORDER BY api_key.created_at DESC, api_key.id DESC`,
      [identityId, workspaceId],
    );
    return result.rows.map(apiKeyFromRow);
  }

  public async createApiKey(input: {
    readonly id: string; readonly identityId: string; readonly workspaceId: string;
    readonly name: string; readonly prefix: string; readonly digest: string;
    readonly scopes: readonly string[]; readonly expiresAt?: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string;
  }): Promise<ApiKeyRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await this.lockIdentity(client, input.identityId, input.workspaceId);
      if (identity.identity_kind !== "service" || identity.disabled_at !== null) {
        throw new ApplicationError("API_KEY_IDENTITY_INVALID", 409, "API keys require an active Service Identity.");
      }
      if (input.scopes.length > 0) {
        const permissions = await client.query<{ permission_key: string }>(
          `SELECT permission_key FROM ${this.q("_xecms_auth_permissions")}
            WHERE permission_key = ANY($1::text[]) AND retired_at IS NULL`,
          [input.scopes],
        );
        if (permissions.rowCount !== input.scopes.length) {
          throw new ApplicationError("API_KEY_SCOPE_INVALID", 422, "API key scopes must reference active Permissions.");
        }
      }
      const result = await client.query<ApiKeyRow>(
        `INSERT INTO ${this.q("_xecms_api_keys")}
           (id, workspace_id, identity_id, name, key_prefix, key_digest, scopes,
            created_at, created_by_identity_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         RETURNING id, identity_id, name, key_prefix, scopes, created_at,
                   expires_at, last_used_at, revoked_at`,
        [input.id, input.workspaceId, input.identityId, input.name, input.prefix,
          input.digest, JSON.stringify(input.scopes), input.now, input.actorIdentityId,
          input.expiresAt ?? null],
      );
      await this.securityEvent(client, {
        event: "api-key.created", identityId: input.identityId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        workspaceId: input.workspaceId,
        payload: { apiKeyId: input.id, identityId: input.identityId, name: input.name, scopes: input.scopes }, now: input.now,
      });
      await client.query("COMMIT");
      return apiKeyFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK"); throw mapIdentityError(error);
    } finally { client.release(); }
  }

  public async revokeApiKey(input: {
    readonly apiKeyId: string; readonly workspaceId: string;
    readonly actorIdentityId: string; readonly now: string;
  }): Promise<ApiKeyRecord> {
    const result = await this.pool.query<ApiKeyRow>(
      `UPDATE ${this.q("_xecms_api_keys")} api_key
          SET revoked_at = $3, revoked_by_identity_id = $4, revoke_reason = 'administrator-revoked'
         FROM ${this.q("_xecms_identities")} identity
        WHERE api_key.id = $1 AND api_key.identity_id = identity.id
          AND identity.workspace_id = $2 AND api_key.revoked_at IS NULL
        RETURNING api_key.id, api_key.identity_id, api_key.name, api_key.key_prefix,
                  api_key.scopes, api_key.created_at, api_key.expires_at,
                  api_key.last_used_at, api_key.revoked_at`,
      [input.apiKeyId, input.workspaceId, input.now, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApplicationError("API_KEY_NOT_FOUND", 404, "The active API key does not exist.");
    return apiKeyFromRow(row);
  }

  public async authenticateApiKey(input: {
    readonly prefix: string; readonly digest: string; readonly now: string;
  }): Promise<AuthenticatedApiKey | null> {
    const result = await this.pool.query<AuthenticatedApiKeyRow>(
      `SELECT api_key.id, api_key.identity_id, api_key.scopes, identity.workspace_id,
              membership.subject_id
         FROM ${this.q("_xecms_api_keys")} api_key
         JOIN ${this.q("_xecms_identities")} identity ON identity.id = api_key.identity_id
         JOIN ${this.q("_xecms_realm_memberships")} membership
           ON membership.identity_id = identity.id AND membership.realm_id = $4
         JOIN ${this.q("_xecms_auth_subjects")} subject
           ON subject.realm_id = membership.realm_id AND subject.id = membership.subject_id
        WHERE api_key.key_prefix = $1 AND api_key.key_digest = $2
          AND api_key.revoked_at IS NULL AND (api_key.expires_at IS NULL OR api_key.expires_at > $3)
          AND identity.identity_kind = 'service' AND identity.disabled_at IS NULL
          AND membership.status = 'active' AND subject.disabled_at IS NULL`,
      [input.prefix, input.digest, input.now, SYSTEM_REALM_ID],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    await this.pool.query(
      `UPDATE ${this.q("_xecms_api_keys")}
          SET last_used_at = $2
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2::timestamptz - interval '5 minutes')`,
      [row.id, input.now],
    );
    return {
      apiKeyId: row.id, identityId: row.identity_id, workspaceId: row.workspace_id,
      subjectId: row.subject_id, scopes: row.scopes,
    };
  }

  private async lockIdentity(client: PoolClient, identityId: string, workspaceId: string): Promise<LockedIdentityRow> {
    const result = await client.query<LockedIdentityRow>(
      `SELECT id, username, normalized_username, identity_kind, revision, is_owner, disabled_at
         FROM ${this.q("_xecms_identities")}
        WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [identityId, workspaceId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ApplicationError("IDENTITY_NOT_FOUND", 404, "The Identity does not exist.");
    return row;
  }

  private async bumpSubjectPolicy(client: PoolClient, input: {
    readonly realmId: string; readonly actorSubjectId: string; readonly action: string;
    readonly targetId: string; readonly auditId: string; readonly before: unknown;
    readonly after: unknown; readonly now: string;
  }): Promise<void> {
    const state = await client.query<{ current_revision: string | number }>(
      `SELECT current_revision FROM ${this.q("_xecms_auth_policy_state")}
        WHERE realm_id = $1 FOR UPDATE`,
      [input.realmId],
    );
    const current = state.rows[0];
    if (current === undefined || Number(current.current_revision) < 1) {
      throw new ApplicationError("AUTHORIZATION_NOT_INITIALIZED", 503, "Authorization policy is unavailable.");
    }
    const revision = Number(current.current_revision) + 1;
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_policy_revisions")}
         (realm_id, revision, actor_subject_id, change_kind, target_type, target_id, occurred_at)
       VALUES ($1, $2, $3, $4, 'subject', $5, $6)`,
      [input.realmId, revision, input.actorSubjectId, input.action, input.targetId, input.now],
    );
    await client.query(
      `UPDATE ${this.q("_xecms_auth_policy_state")}
          SET current_revision = $2, updated_at = $3 WHERE realm_id = $1`,
      [input.realmId, revision, input.now],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_audit_log")}
         (id, realm_id, policy_revision, actor_subject_id, action, target_type, target_id,
          before_state, after_state, decision, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'subject', $6, $7::jsonb, $8::jsonb, NULL, $9)`,
      [input.auditId, input.realmId, revision, input.actorSubjectId, input.action,
        input.targetId, nullableJson(input.before), nullableJson(input.after), input.now],
    );
  }

  private async securityEvent(client: PoolClient, input: {
    readonly event: string; readonly identityId: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly workspaceId: string;
    readonly payload: Readonly<Record<string, unknown>>; readonly now: string;
  }): Promise<void> {
    const audit = await client.query<{ id: string | number }>(
      `INSERT INTO ${this.q("_xecms_audit_log")}
         (event_type, identity_id, occurred_at, metadata)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [input.event, input.actorIdentityId, input.now, JSON.stringify(input.payload)],
    );
    const sourceId = audit.rows[0]!.id;
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id,
          aggregate_version, actor_subject_id, actor_identity_id, occurred_at, payload, created_at)
       SELECT $1, $2, $3, $4, 'identity', $5, identity.revision,
              $6, $7, $8, $9::jsonb, $8
         FROM ${this.q("_xecms_identities")} identity WHERE identity.id = $5`,
      [`outbox_security_${sourceId}`, input.workspaceId, SYSTEM_REALM_ID, input.event,
        input.identityId, input.actorSubjectId, input.actorIdentityId, input.now,
        JSON.stringify(input.payload)],
    );
  }

  private q(name: string): string { return qualifiedName(this.schema, name); }
}

function IDENTITY_ADMIN_SELECT(q: (name: string) => string): string {
  return `SELECT identity.id, identity.workspace_id, identity.identity_kind,
    identity.username, identity.normalized_username, identity.origin_realm_id,
    identity.is_owner, identity.credential_version, identity.password_change_required,
    identity.revision, identity.created_at, identity.updated_at, identity.disabled_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'membershipId', membership.id, 'realmId', membership.realm_id,
      'realmKey', realm.realm_key, 'realmName', realm.name, 'realmKind', realm.kind,
      'subjectId', membership.subject_id, 'status', membership.status,
      'profileDocumentId', membership.profile_document_id
    ) ORDER BY realm.kind, realm.name, membership.id)
      FROM ${q("_xecms_realm_memberships")} membership
      JOIN ${q("_xecms_realms")} realm ON realm.id = membership.realm_id
     WHERE membership.identity_id = identity.id), '[]'::jsonb) AS memberships
    FROM ${q("_xecms_identities")} identity`;
}

function API_KEY_SELECT(q: (name: string) => string): string {
  return `SELECT api_key.id, api_key.identity_id, api_key.name, api_key.key_prefix,
                 api_key.scopes, api_key.created_at, api_key.expires_at,
                 api_key.last_used_at, api_key.revoked_at
            FROM ${q("_xecms_api_keys")} api_key`;
}

interface IdentityAdministrationRow extends QueryResultRow {
  readonly id: string; readonly workspace_id: string; readonly identity_kind: ManagedIdentityKind;
  readonly username: string; readonly normalized_username: string; readonly origin_realm_id: string;
  readonly is_owner: boolean; readonly credential_version: string | number;
  readonly password_change_required: boolean; readonly revision: string | number;
  readonly created_at: Date | string; readonly updated_at: Date | string;
  readonly disabled_at: Date | string | null; readonly memberships: readonly MembershipJson[];
}
interface MembershipJson {
  readonly membershipId: string; readonly realmId: string; readonly realmKey: string;
  readonly realmName: string; readonly realmKind: "system" | "content";
  readonly subjectId: string; readonly status: "pending" | "active" | "suspended";
  readonly profileDocumentId: string | null;
}
interface LockedIdentityRow extends QueryResultRow {
  readonly id: string; readonly username: string; readonly normalized_username: string;
  readonly identity_kind: ManagedIdentityKind;
  readonly revision: string | number;
  readonly is_owner: boolean; readonly disabled_at: Date | string | null;
}

interface ManagedSessionRow extends QueryResultRow {
  readonly id: string; readonly audience: "admin" | "content"; readonly identity_id: string;
  readonly realm_id: string; readonly realm_name: string; readonly membership_id: string;
  readonly created_at: Date | string; readonly authenticated_at: Date | string;
  readonly expires_at: Date | string; readonly revoked_at: Date | string | null;
  readonly revoked_by_identity_id: string | null; readonly revoke_reason: string | null;
}

interface ApiKeyRow extends QueryResultRow {
  readonly id: string; readonly identity_id: string; readonly name: string;
  readonly key_prefix: string; readonly scopes: readonly string[];
  readonly created_at: Date | string; readonly expires_at: Date | string | null;
  readonly last_used_at: Date | string | null; readonly revoked_at: Date | string | null;
}
interface AuthenticatedApiKeyRow extends QueryResultRow {
  readonly id: string; readonly identity_id: string; readonly workspace_id: string;
  readonly subject_id: string; readonly scopes: readonly string[];
}

function apiKeyFromRow(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id, identityId: row.identity_id, name: row.name, prefix: row.key_prefix,
    scopes: row.scopes, createdAt: instant(row.created_at),
    ...(row.expires_at === null ? {} : { expiresAt: instant(row.expires_at) }),
    ...(row.last_used_at === null ? {} : { lastUsedAt: instant(row.last_used_at) }),
    ...(row.revoked_at === null ? {} : { revokedAt: instant(row.revoked_at) }),
  };
}

function sessionFromRow(row: ManagedSessionRow, current: boolean): ManagedSession {
  return {
    id: row.id, audience: row.audience, identityId: row.identity_id,
    realmId: row.realm_id, realmName: row.realm_name, membershipId: row.membership_id,
    createdAt: instant(row.created_at), authenticatedAt: instant(row.authenticated_at),
    expiresAt: instant(row.expires_at), current,
    ...(row.revoked_at === null ? {} : { revokedAt: instant(row.revoked_at) }),
    ...(row.revoked_by_identity_id === null ? {} : { revokedByIdentityId: row.revoked_by_identity_id }),
    ...(row.revoke_reason === null ? {} : { revokeReason: row.revoke_reason }),
  };
}

function identityFromRow(row: IdentityAdministrationRow): ManagedIdentity {
  return {
    id: row.id, workspaceId: row.workspace_id, kind: row.identity_kind,
    primaryIdentifier: row.username, originRealmId: row.origin_realm_id,
    isOwner: row.is_owner, status: row.disabled_at === null ? "active" : "disabled",
    credentialVersion: Number(row.credential_version),
    passwordChangeRequired: row.password_change_required, revision: Number(row.revision),
    createdAt: instant(row.created_at), updatedAt: instant(row.updated_at),
    ...(row.disabled_at === null ? {} : { disabledAt: instant(row.disabled_at) }),
    memberships: row.memberships.map((membership): ManagedIdentityMembership => ({
      membershipId: membership.membershipId, realmId: membership.realmId,
      realmKey: membership.realmKey, realmName: membership.realmName,
      realmKind: membership.realmKind, subjectId: membership.subjectId, status: membership.status,
      ...(membership.profileDocumentId === null ? {} : { profileDocumentId: membership.profileDocumentId }),
    })),
  };
}

function assertRevision(row: LockedIdentityRow, expected: number): void {
  const actual = Number(row.revision);
  if (actual !== expected) {
    throw new ApplicationError("IDENTITY_REVISION_CONFLICT", 409, "The Identity changed after it was read.", {
      details: { expectedRevision: expected, actualRevision: actual },
    });
  }
}
function mapIdentityError(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    return new ApplicationError("IDENTITY_IDENTIFIER_CONFLICT", 409, "The Identity identifier is already in use.");
  }
  return error;
}
function invalidFilter(label: string): never { throw new ApplicationError("IDENTITY_FILTER_INVALID", 400, `${label} is invalid.`); }
function credentialTokenInvalid(): never { throw new ApplicationError("CREDENTIAL_TOKEN_INVALID", 400, "The credential token is invalid or inactive."); }
function nullableJson(value: unknown): string | null { return value === null ? null : JSON.stringify(value); }
function instant(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function escapeLike(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_"); }
function encodeCursor(normalizedIdentifier: string, id: string): string {
  return Buffer.from(JSON.stringify([normalizedIdentifier, id]), "utf8").toString("base64url");
}
function decodeCursor(value: string): { readonly normalizedIdentifier: string; readonly id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2 || decoded.some((item) => typeof item !== "string" || item.length === 0)) throw new Error();
    return { normalizedIdentifier: decoded[0] as string, id: decoded[1] as string };
  } catch {
    throw new ApplicationError("IDENTITY_CURSOR_INVALID", 400, "The Identity cursor is invalid.");
  }
}
