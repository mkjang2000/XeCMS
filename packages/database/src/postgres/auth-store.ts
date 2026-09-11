import { qualifiedName } from "../identifiers.js";
import { DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID } from "../migrate.js";
import { type IdentityRow, type SessionRow, identityFromRow } from "./auth-records.js";
import { mapDatabaseError, instant, normalizeUsername, lockWorkspace } from "./shared.js";
import {
  ApplicationError,
  type AuthStore,
  type IdentityRecord,
  type StoredSession,
} from "@xecms/application";
import { type Pool } from "pg";

export class PostgresAuthStore implements AuthStore {
  public constructor(private readonly pool: Pool, private readonly schema: string) {}

  public async bootstrapRequired(): Promise<boolean> {
    const result = await this.pool.query<{ required: boolean }>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM ${this.q("_xecms_identities")} WHERE workspace_id = $1 AND is_owner = true
       ) AS required`,
      [DEFAULT_WORKSPACE_ID],
    );
    return result.rows[0]?.required ?? true;
  }

  public async createInitialOwner(input: {
    readonly id: string;
    readonly username: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<IdentityRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockWorkspace(client);
      const existing = await client.query(
        `SELECT 1 FROM ${this.q("_xecms_identities")} WHERE workspace_id = $1 AND is_owner = true`,
        [DEFAULT_WORKSPACE_ID],
      );
      if (existing.rowCount !== 0) {
        throw new ApplicationError(
          "BOOTSTRAP_ALREADY_COMPLETED",
          409,
          "The initial owner has already been created.",
        );
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_identities")}
           (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
            password_hash, is_owner, credential_version, created_at, updated_at, updated_by)
         VALUES ($1, $2, $3, $3, $4, $5, $6, true, 1, $7, $7, $1)`,
        [input.id, DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, input.username, normalizeUsername(input.username), input.passwordHash, input.now],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_identity_identifiers")}
           (id, workspace_id, identity_id, identifier_kind, normalized_value,
            display_value, verified_at, created_at, created_by)
         VALUES ($1, $2, $3, 'username', $4, $5, $6, $6, $3)`,
        [`identifier_${input.id}`, DEFAULT_WORKSPACE_ID, input.id,
          normalizeUsername(input.username), input.username, input.now],
      );
      await client.query("COMMIT");
      return {
        id: input.id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        username: input.username,
        passwordHash: input.passwordHash,
        isOwner: true,
        passwordChangeRequired: false,
      };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async findIdentityByUsername(username: string): Promise<IdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `SELECT id, workspace_id, username, password_hash, is_owner, password_change_required
       FROM ${this.q("_xecms_identities")}
       WHERE normalized_username = $1 AND disabled_at IS NULL`,
      [normalizeUsername(username)],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }

  /**
   * Recovers the protected workspace owner when an existing M1/M2 database is
   * upgraded and its normalized authorization policy still needs seeding.
   */

  public async findOwnerIdentity(): Promise<IdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `SELECT id, workspace_id, username, password_hash, is_owner, password_change_required
       FROM ${this.q("_xecms_identities")}
       WHERE workspace_id = $1 AND is_owner = true
       LIMIT 1`,
      [DEFAULT_WORKSPACE_ID],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }

  public async createSession(input: {
    readonly sessionTokenHash: string;
    readonly csrfTokenHash: string;
    readonly identityId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const membership = await client.query<{
        readonly id: string;
        readonly realm_id: string;
        readonly subject_id: string;
        readonly credential_version: string | number;
      }>(
        `INSERT INTO ${this.q("_xecms_realm_memberships")}
           (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, suspended_at, updated_at, updated_by)
         SELECT 'membership_system_' || md5(identity.id), identity.workspace_id, identity.id,
                subject.realm_id, subject.id, 'active', 'explicit', 1, $2, identity.id,
                $2, NULL, $2, identity.id
         FROM ${this.q("_xecms_identities")} identity
         JOIN ${this.q("_xecms_auth_subjects")} subject
           ON subject.identity_id = identity.id AND subject.realm_id = $3
         WHERE identity.id = $1 AND identity.disabled_at IS NULL AND subject.disabled_at IS NULL
         ON CONFLICT (identity_id, realm_id) DO UPDATE SET identity_id = EXCLUDED.identity_id
           WHERE ${this.q("_xecms_realm_memberships")}.status = 'active'
         RETURNING id, realm_id, subject_id,
           (SELECT credential_version FROM ${this.q("_xecms_identities")} WHERE id = $1)`,
        [input.identityId, input.createdAt, SYSTEM_REALM_ID],
      );
      const principal = membership.rows[0];
      if (principal === undefined) {
        throw new ApplicationError(
          "SESSION_PRINCIPAL_INVALID",
          401,
          "The System Identity has no active System Realm Membership.",
        );
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_sessions")}
           (id, token_hash, csrf_token_hash, identity_id, created_at, expires_at, audience,
            realm_id, membership_id, subject_id, authenticated_at, credential_version)
         VALUES ('session_' || md5($1), $1, $2, $3, $4, $5, 'admin', $6, $7, $8, $4, $9)`,
        [input.sessionTokenHash, input.csrfTokenHash, input.identityId, input.createdAt,
          input.expiresAt, principal.realm_id, principal.id, principal.subject_id,
          Number(principal.credential_version)],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async findSession(sessionTokenHash: string, now: string): Promise<StoredSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT i.id, i.workspace_id, i.username, i.password_hash, i.is_owner,
              i.password_change_required, s.expires_at
       FROM ${this.q("_xecms_sessions")} s
       JOIN ${this.q("_xecms_identities")} i ON i.id = s.identity_id
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.id = s.membership_id AND membership.identity_id = s.identity_id
        AND membership.realm_id = s.realm_id AND membership.subject_id = s.subject_id
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = s.realm_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = s.realm_id AND subject.id = s.subject_id
       WHERE s.token_hash = $1 AND s.expires_at > $2 AND s.audience = 'admin'
         AND s.revoked_at IS NULL
         AND realm.kind = 'system' AND realm.status = 'active'
         AND membership.status = 'active' AND i.disabled_at IS NULL AND subject.disabled_at IS NULL
         AND s.credential_version = i.credential_version`,
      [sessionTokenHash, now],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { identity: identityFromRow(row), expiresAt: instant(row.expires_at) };
  }

  public async findSessionWithCsrf(
    sessionTokenHash: string,
    csrfTokenHash: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.q("_xecms_sessions")} session
       JOIN ${this.q("_xecms_identities")} identity ON identity.id = session.identity_id
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.id = session.membership_id AND membership.identity_id = session.identity_id
        AND membership.realm_id = session.realm_id AND membership.subject_id = session.subject_id
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = session.realm_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = session.realm_id AND subject.id = session.subject_id
       WHERE session.token_hash = $1 AND session.csrf_token_hash = $2
         AND session.expires_at > $3 AND session.audience = 'admin'
         AND session.revoked_at IS NULL
         AND realm.kind = 'system' AND realm.status = 'active'
         AND membership.status = 'active' AND identity.disabled_at IS NULL
         AND subject.disabled_at IS NULL
         AND session.credential_version = identity.credential_version`,
      [sessionTokenHash, csrfTokenHash, now],
    );
    return result.rowCount === 1;
  }

  public async deleteSession(sessionTokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.q("_xecms_sessions")}
          SET revoked_at = now(), revoked_by_identity_id = identity_id, revoke_reason = 'logout'
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [sessionTokenHash],
    );
  }

  public async recordAuthEvent(input: {
    readonly event:
      | "login.succeeded"
      | "login.failed"
      | "reauthentication.succeeded"
      | "reauthentication.failed"
      | "logout"
      | "bootstrap.owner-created";
    readonly identityId?: string;
    readonly username?: string;
    readonly occurredAt: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.q("_xecms_audit_log")}
         (event_type, identity_id, username, occurred_at)
       VALUES ($1, $2, $3, $4)`,
      [input.event, input.identityId ?? null, input.username ?? null, input.occurredAt],
    );
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

