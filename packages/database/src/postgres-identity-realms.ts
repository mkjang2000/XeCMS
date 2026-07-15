import {
  ApplicationError,
  type ContentRealmSessionRecord,
  type GlobalIdentityCredentialRecord,
  type GlobalIdentityRecord,
  type IdentityRealmRecord,
  type IdentityRealmStatus,
  type IdentityRealmStore,
  type RealmAuthenticationPolicyRecord,
  type RealmFullAccessBindingRecord,
  type RealmIdentityProvisioningStore,
  type RealmFullAccessUse,
  type RealmMembershipProvisionedBy,
  type RealmMembershipRecord,
  type RealmMembershipStatus,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export interface IdentityIdentifierRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly identityId: string;
  readonly kind: string;
  readonly normalizedValue: string;
  readonly displayValue: string;
  readonly verifiedAt?: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface AuthCollectionConfigRecord {
  readonly collectionId: string;
  readonly realmId: string;
  readonly identifierFieldIds: readonly string[];
  readonly status: "active" | "retired";
  readonly schemaRevisionId?: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface CreateGlobalIdentityInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly originRealmId: string;
  readonly primaryIdentifier: string;
  readonly normalizedIdentifier: string;
  readonly passwordHash: string;
  readonly identifierKind?: string;
  readonly actorId: string;
  readonly now: string;
}

export interface CreateRealmMembershipInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly identityId: string;
  readonly realmId: string;
  readonly subjectId: string;
  readonly profileCollectionId?: string;
  readonly profileDocumentId?: string;
  readonly status: RealmMembershipStatus;
  readonly provisionedBy: RealmMembershipProvisionedBy;
  readonly actorIdentityId: string;
  readonly now: string;
}

/** PostgreSQL implementation of the M4 Global Identity and Content Realm boundary. */
export class PostgresIdentityRealmStore implements IdentityRealmStore, RealmIdentityProvisioningStore {
  public readonly schema: string;

  public constructor(
    public readonly pool: Pool,
    schema = "xecms",
  ) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async listRealms(workspaceId: string): Promise<readonly IdentityRealmRecord[]> {
    const result = await this.pool.query<RealmRow>(
      `${REALM_SELECT(this.q.bind(this))}
       WHERE realm.workspace_id = $1
       ORDER BY realm.kind, realm.name, realm.id`,
      [workspaceId],
    );
    return result.rows.map(realmFromRow);
  }

  public async getRealmById(realmId: string): Promise<IdentityRealmRecord | null> {
    const result = await this.pool.query<RealmRow>(
      `${REALM_SELECT(this.q.bind(this))} WHERE realm.id = $1`,
      [realmId],
    );
    return result.rows[0] === undefined ? null : realmFromRow(result.rows[0]);
  }

  public async getRealmByKey(
    workspaceId: string,
    realmKey: string,
  ): Promise<IdentityRealmRecord | null> {
    const result = await this.pool.query<RealmRow>(
      `${REALM_SELECT(this.q.bind(this))}
       WHERE realm.workspace_id = $1 AND realm.realm_key = $2`,
      [workspaceId, realmKey],
    );
    return result.rows[0] === undefined ? null : realmFromRow(result.rows[0]);
  }

  public async createRealm(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly key: string;
    readonly name: string;
    readonly authentication: RealmAuthenticationPolicyRecord;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<IdentityRealmRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<RealmRow>(
        `INSERT INTO ${this.q("_xecms_realms")}
           (id, workspace_id, kind, name, created_at, realm_key, status,
            accept_system_identities, membership_provisioning, registration,
            default_role_ids, revision, created_by, updated_at, updated_by)
         SELECT $1, $2, 'content', $3, $4, $5, 'provisioning', $6, $7, $8,
                $9::text[], 1, $10, $4, $10
         FROM ${this.q("_xecms_identities")} actor
         WHERE actor.id = $10 AND actor.workspace_id = $2 AND actor.disabled_at IS NULL
         RETURNING *`,
        [input.id, input.workspaceId, input.name, input.now, input.key,
          input.authentication.acceptSystemIdentities, input.authentication.provisioning,
          input.authentication.registration, [...input.authentication.defaultRoleIds],
          input.actorIdentityId],
      );
      if (result.rowCount !== 1) {
        throw new ApplicationError(
          "REALM_ACTOR_INVALID",
          403,
          "The Realm creator is not an active Identity in this Workspace.",
        );
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_policy_state")}
           (realm_id, current_revision, root_resource_id, updated_at)
         VALUES ($1, 0, NULL, $2)`,
        [input.id, input.now],
      );
      await this.recordSecurityEvent(client, {
        event: "realm.created",
        identityId: input.actorIdentityId,
        occurredAt: input.now,
        metadata: { realmId: input.id, realmKey: input.key },
      });
      await client.query("COMMIT");
      return realmFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public async updateRealm(input: {
    readonly realmId: string;
    readonly expectedRevision: number;
    readonly name: string;
    readonly status: IdentityRealmStatus;
    readonly authentication: RealmAuthenticationPolicyRecord;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<IdentityRealmRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<RealmRow>(
        `UPDATE ${this.q("_xecms_realms")} AS realm
         SET name = $3, status = $4, accept_system_identities = $5,
             membership_provisioning = $6, registration = $7,
             default_role_ids = $8::text[], revision = revision + 1,
             updated_at = $9, updated_by = $10
         WHERE id = $1 AND revision = $2 AND kind = 'content'
           AND EXISTS (
             SELECT 1 FROM ${this.q("_xecms_identities")} AS actor
             WHERE actor.id = $10 AND actor.workspace_id = realm.workspace_id
               AND actor.disabled_at IS NULL
           )
         RETURNING realm.*`,
        [input.realmId, input.expectedRevision, input.name, input.status,
          input.authentication.acceptSystemIdentities, input.authentication.provisioning,
          input.authentication.registration, [...input.authentication.defaultRoleIds], input.now,
          input.actorIdentityId],
      );
      if (result.rows[0] === undefined) {
        await this.throwRealmWriteConflict(input.realmId, input.expectedRevision, client);
      }
      await this.recordSecurityEvent(client, {
        event: "realm.updated",
        identityId: input.actorIdentityId,
        occurredAt: input.now,
        metadata: {
          realmId: input.realmId,
          status: input.status,
          acceptSystemIdentities: input.authentication.acceptSystemIdentities,
          provisioning: input.authentication.provisioning,
          registration: input.authentication.registration,
          revision: input.expectedRevision + 1,
        },
      });
      await client.query("COMMIT");
      return realmFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  /** Removes only an unused, uninitialized Content Realm. */
  public async deleteRealm(realmId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM ${this.q("_xecms_realms")} realm
       WHERE realm.id = $1 AND realm.kind = 'content'
         AND NOT EXISTS (
           SELECT 1 FROM ${this.q("_xecms_realm_memberships")} membership
           WHERE membership.realm_id = realm.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${this.q("_xecms_auth_collection_configs")} config
           WHERE config.realm_id = realm.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM ${this.q("_xecms_auth_policy_state")} state
           WHERE state.realm_id = realm.id AND state.current_revision > 0
         )`,
      [realmId],
    );
    if (result.rowCount !== 1) {
      throw new ApplicationError("IDENTITY_REALM_IN_USE", 409, "The Realm is protected or in use.");
    }
  }

  public async listIdentities(workspaceId: string): Promise<readonly GlobalIdentityRecord[]> {
    const result = await this.pool.query<IdentityRow>(
      `${IDENTITY_SELECT(this.q.bind(this))}
       WHERE identity.workspace_id = $1
       ORDER BY identity.username, identity.id`,
      [workspaceId],
    );
    return result.rows.map(identityFromRow);
  }

  public async findIdentityById(identityId: string): Promise<GlobalIdentityRecord | null> {
    const result = await this.pool.query<IdentityRow>(
      `${IDENTITY_SELECT(this.q.bind(this))} WHERE identity.id = $1`,
      [identityId],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }

  public async findIdentityCredentialByIdentifier(
    workspaceId: string,
    normalizedIdentifier: string,
  ): Promise<GlobalIdentityCredentialRecord | null> {
    const result = await this.pool.query<IdentityCredentialRow>(
      `${IDENTITY_CREDENTIAL_SELECT(this.q.bind(this))}
       JOIN ${this.q("_xecms_identity_identifiers")} identifier
         ON identifier.identity_id = identity.id AND identifier.workspace_id = identity.workspace_id
       WHERE identity.workspace_id = $1 AND identifier.normalized_value = $2
         AND identity.disabled_at IS NULL`,
      [workspaceId, normalizedIdentifier],
    );
    return result.rows[0] === undefined ? null : identityCredentialFromRow(result.rows[0]);
  }

  public async createIdentity(input: CreateGlobalIdentityInput): Promise<GlobalIdentityRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query<IdentityRow>(
        `INSERT INTO ${this.q("_xecms_identities")}
           (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
            password_hash, is_owner, credential_version, created_at, updated_at, updated_by)
         SELECT $1, $2, $3, $3, $4, $5, $6, false, 1, $7, $7, $8
         FROM ${this.q("_xecms_realms")} realm
         WHERE realm.id = $3 AND realm.workspace_id = $2
         RETURNING *`,
        [input.id, input.workspaceId, input.originRealmId, input.primaryIdentifier,
          input.normalizedIdentifier, input.passwordHash, input.now, input.actorId],
      );
      if (identity.rowCount !== 1) {
        throw new ApplicationError("IDENTITY_ORIGIN_REALM_INVALID", 409, "The origin Realm is invalid.");
      }
      await client.query(
        `INSERT INTO ${this.q("_xecms_identity_identifiers")}
           (id, workspace_id, identity_id, identifier_kind, normalized_value,
            display_value, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [`identifier_${input.id}`, input.workspaceId, input.id, input.identifierKind ?? "primary",
          input.normalizedIdentifier, input.primaryIdentifier, input.now, input.actorId],
      );
      await this.recordSecurityEvent(client, {
        event: "identity.created",
        identityId: input.actorId,
        occurredAt: input.now,
        metadata: { identityId: input.id, originRealmId: input.originRealmId },
      });
      await client.query("COMMIT");
      return identityFromRow(identity.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  /** Creates a distinct Global Identity; duplicate identifiers require verified account linking. */
  public async createGlobalIdentity(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly originRealmId: string;
    readonly normalizedIdentifier: string;
    readonly displayIdentifier: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<GlobalIdentityRecord> {
    return this.createIdentity({
      id: input.id,
      workspaceId: input.workspaceId,
      originRealmId: input.originRealmId,
      primaryIdentifier: input.displayIdentifier,
      normalizedIdentifier: input.normalizedIdentifier,
      passwordHash: input.passwordHash,
      identifierKind: "primary",
      actorId: input.id,
      now: input.now,
    });
  }

  public async listIdentityIdentifiers(identityId: string): Promise<readonly IdentityIdentifierRecord[]> {
    const result = await this.pool.query<IdentifierRow>(
      `SELECT id, workspace_id, identity_id, identifier_kind, normalized_value,
              display_value, verified_at, created_at, created_by
       FROM ${this.q("_xecms_identity_identifiers")}
       WHERE identity_id = $1 ORDER BY identifier_kind, id`,
      [identityId],
    );
    return result.rows.map(identifierFromRow);
  }

  public async listMemberships(realmId: string): Promise<readonly RealmMembershipRecord[]> {
    const result = await this.pool.query<MembershipRow>(
      `${MEMBERSHIP_SELECT(this.q.bind(this))}
       WHERE membership.realm_id = $1 ORDER BY membership.created_at, membership.id`,
      [realmId],
    );
    return result.rows.map(membershipFromRow);
  }

  public async findMembershipByIdentity(
    realmId: string,
    identityId: string,
  ): Promise<RealmMembershipRecord | null> {
    const result = await this.pool.query<MembershipRow>(
      `${MEMBERSHIP_SELECT(this.q.bind(this))}
       WHERE membership.realm_id = $1 AND membership.identity_id = $2`,
      [realmId, identityId],
    );
    return result.rows[0] === undefined ? null : membershipFromRow(result.rows[0]);
  }

  public async findMembershipById(membershipId: string): Promise<RealmMembershipRecord | null> {
    const result = await this.pool.query<MembershipRow>(
      `${MEMBERSHIP_SELECT(this.q.bind(this))} WHERE membership.id = $1`,
      [membershipId],
    );
    return result.rows[0] === undefined ? null : membershipFromRow(result.rows[0]);
  }

  public async resolveActiveMembership(
    realmId: string,
    identityId: string,
  ): Promise<RealmMembershipRecord | null> {
    const result = await this.pool.query<MembershipRow>(
      `${MEMBERSHIP_SELECT(this.q.bind(this))}
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = membership.realm_id
       JOIN ${this.q("_xecms_identities")} identity ON identity.id = membership.identity_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = membership.realm_id AND subject.id = membership.subject_id
       WHERE membership.realm_id = $1 AND membership.identity_id = $2
         AND membership.status = 'active' AND realm.status = 'active'
         AND identity.disabled_at IS NULL AND subject.disabled_at IS NULL`,
      [realmId, identityId],
    );
    return result.rows[0] === undefined ? null : membershipFromRow(result.rows[0]);
  }

  public async createMembership(input: CreateRealmMembershipInput): Promise<RealmMembershipRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const linked = await client.query(
        `UPDATE ${this.q("_xecms_auth_subjects")} subject
         SET identity_id = $3, updated_at = $4, updated_by = $5
         WHERE subject.realm_id = $1 AND subject.id = $2 AND subject.subject_type = 'user'
           AND (subject.identity_id IS NULL OR subject.identity_id = $3)`,
        [input.realmId, input.subjectId, input.identityId, input.now, input.actorIdentityId],
      );
      if (linked.rowCount !== 1) {
        throw new ApplicationError(
          "MEMBERSHIP_SUBJECT_LINK_INVALID",
          409,
          "The Realm Subject cannot be linked to this Identity.",
        );
      }
      const active = input.status === "active";
      const suspended = input.status === "suspended";
      const result = await client.query<MembershipRow>(
        `INSERT INTO ${this.q("_xecms_realm_memberships")} AS membership
           (id, workspace_id, identity_id, realm_id, subject_id,
            profile_collection_id, profile_document_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, suspended_at, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11,
                 $12, $13, $10, $11)
         RETURNING membership.*`,
        [input.id, input.workspaceId, input.identityId, input.realmId, input.subjectId,
          input.profileCollectionId ?? null, input.profileDocumentId ?? null, input.status,
          input.provisionedBy, input.now, input.actorIdentityId,
          active ? input.now : null, suspended ? input.now : null],
      );
      await this.recordSecurityEvent(client, {
        event: "realm.membership.created",
        identityId: input.actorIdentityId,
        occurredAt: input.now,
        metadata: {
          realmId: input.realmId,
          membershipId: input.id,
          identityId: input.identityId,
          status: input.status,
        },
      });
      await client.query("COMMIT");
      return membershipFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public async createPendingMembership(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly identityId: string;
    readonly realmId: string;
    readonly subjectId: string;
    readonly provisionedBy: RealmMembershipProvisionedBy;
    readonly createdByIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`realm-membership:${input.realmId}:${input.identityId}`],
      );
      const existing = await client.query<MembershipRow>(
        `${MEMBERSHIP_SELECT(this.q.bind(this))}
         WHERE membership.realm_id = $1 AND membership.identity_id = $2
         FOR UPDATE`,
        [input.realmId, input.identityId],
      );
      const previous = existing.rows[0];
      if (previous !== undefined) {
        if (previous.subject_id !== input.subjectId) {
          throw new ApplicationError(
            "REALM_MEMBERSHIP_SUBJECT_CONFLICT",
            409,
            "The existing Realm Membership belongs to a different Subject.",
          );
        }
        if (previous.status === "suspended") {
          throw new ApplicationError(
            "REALM_MEMBERSHIP_SUSPENDED",
            403,
            "The Realm Membership is suspended.",
          );
        }
        await client.query("COMMIT");
        return membershipFromRow(previous);
      }

      const linked = await client.query(
        `UPDATE ${this.q("_xecms_auth_subjects")} AS subject
         SET identity_id = $3, updated_at = $6, updated_by = $5
         FROM ${this.q("_xecms_identities")} AS identity,
              ${this.q("_xecms_realms")} AS realm
         WHERE subject.realm_id = $1 AND subject.id = $2 AND subject.subject_type = 'user'
           AND (subject.identity_id IS NULL OR subject.identity_id = $3)
           AND identity.id = $3 AND identity.workspace_id = $4 AND identity.disabled_at IS NULL
           AND realm.id = $1 AND realm.workspace_id = $4
           AND realm.kind = 'content' AND realm.status = 'active'`,
        [input.realmId, input.subjectId, input.identityId, input.workspaceId,
          input.createdByIdentityId, input.now],
      );
      if (linked.rowCount !== 1) {
        throw new ApplicationError(
          "MEMBERSHIP_SUBJECT_LINK_INVALID",
          409,
          "The active Content Realm Subject cannot be linked to this Identity.",
        );
      }
      const result = await client.query<MembershipRow>(
        `INSERT INTO ${this.q("_xecms_realm_memberships")} AS membership
           (id, workspace_id, identity_id, realm_id, subject_id, status, provisioned_by,
            revision, created_at, created_by, activated_at, suspended_at, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, 1, $7, $8, NULL, NULL, $7, $8)
         RETURNING membership.*`,
        [input.id, input.workspaceId, input.identityId, input.realmId, input.subjectId,
          input.provisionedBy, input.now, input.createdByIdentityId],
      );
      await this.recordSecurityEvent(client, {
        event: "realm.membership.pending-created",
        identityId: input.createdByIdentityId,
        occurredAt: input.now,
        metadata: { realmId: input.realmId, membershipId: input.id, identityId: input.identityId },
      });
      await client.query("COMMIT");
      return membershipFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public async activateMembership(input: {
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly profileCollectionId: string;
    readonly profileDocumentId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<ProvisioningMembershipRow>(
        `SELECT membership.*,
                realm.profile_collection_id AS configured_profile_collection_id,
                realm.kind AS realm_kind, realm.status AS realm_status,
                identity.disabled_at AS identity_disabled_at,
                subject.disabled_at AS subject_disabled_at
         FROM ${this.q("_xecms_realm_memberships")} AS membership
         JOIN ${this.q("_xecms_realms")} AS realm ON realm.id = membership.realm_id
         JOIN ${this.q("_xecms_identities")} AS identity ON identity.id = membership.identity_id
         JOIN ${this.q("_xecms_auth_subjects")} AS subject
           ON subject.realm_id = membership.realm_id AND subject.id = membership.subject_id
         WHERE membership.id = $1
         FOR UPDATE OF membership, realm, identity, subject`,
        [input.membershipId],
      );
      const before = locked.rows[0];
      if (before === undefined) membershipNotFound();
      if (Number(before.revision) !== input.expectedRevision) {
        throw new ApplicationError(
          "REALM_MEMBERSHIP_REVISION_CONFLICT",
          409,
          "The Realm Membership changed after it was read.",
          { details: { expectedRevision: input.expectedRevision, actualRevision: Number(before.revision) } },
        );
      }
      if (before.status === "suspended") {
        throw new ApplicationError("REALM_MEMBERSHIP_SUSPENDED", 403, "The Realm Membership is suspended.");
      }
      if (before.status !== "pending") {
        throw new ApplicationError(
          "REALM_MEMBERSHIP_STATE_CONFLICT",
          409,
          "Only a pending Realm Membership can be activated.",
        );
      }
      if (before.realm_kind !== "content" || before.realm_status !== "active") {
        throw new ApplicationError("CONTENT_REALM_UNAVAILABLE", 409, "The Content Realm is not active.");
      }
      if (before.identity_disabled_at !== null || before.subject_disabled_at !== null) {
        throw new ApplicationError(
          "REALM_MEMBERSHIP_PRINCIPAL_INVALID",
          409,
          "The Realm Membership principal is disabled.",
        );
      }
      const profile = await client.query(
        `SELECT 1
         FROM ${this.q("_xecms_documents")} AS document
         WHERE document.id = $1 AND document.workspace_id = $2
           AND document.collection_id = $3 AND document.deletion IS NULL`,
        [input.profileDocumentId, before.workspace_id, input.profileCollectionId],
      );
      if (before.configured_profile_collection_id !== input.profileCollectionId || profile.rowCount !== 1) {
        throw new ApplicationError(
          "REALM_MEMBERSHIP_PROFILE_INVALID",
          409,
          "The profile Document does not belong to this Realm's active profile Collection.",
        );
      }
      const result = await client.query<MembershipRow>(
        `UPDATE ${this.q("_xecms_realm_memberships")} AS membership
         SET profile_collection_id = $3, profile_document_id = $4,
             status = 'active', revision = revision + 1,
             activated_at = $5, suspended_at = NULL, updated_at = $5, updated_by = $6
         WHERE membership.id = $1 AND membership.revision = $2 AND membership.status = 'pending'
           AND EXISTS (
             SELECT 1 FROM ${this.q("_xecms_identities")} AS actor
             WHERE actor.id = $6 AND actor.workspace_id = membership.workspace_id
               AND actor.disabled_at IS NULL
           )
         RETURNING membership.*`,
        [input.membershipId, input.expectedRevision, input.profileCollectionId,
          input.profileDocumentId, input.now, input.actorIdentityId],
      );
      if (result.rows[0] === undefined) {
        throw new ApplicationError(
          "REALM_MEMBERSHIP_REVISION_CONFLICT",
          409,
          "The Realm Membership changed while it was being activated.",
        );
      }
      await this.recordSecurityEvent(client, {
        event: "realm.membership.activated",
        identityId: input.actorIdentityId,
        occurredAt: input.now,
        metadata: {
          realmId: before.realm_id,
          membershipId: input.membershipId,
          profileDocumentId: input.profileDocumentId,
        },
      });
      await client.query("COMMIT");
      return membershipFromRow(result.rows[0]);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public suspendMembership(input: {
    readonly realmId: string;
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    return this.transitionMembership({ ...input, status: "suspended" });
  }

  public reactivateMembership(input: {
    readonly realmId: string;
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmMembershipRecord> {
    return this.transitionMembership({ ...input, status: "active" });
  }

  public async deleteMembership(realmId: string, membershipId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM ${this.q("_xecms_realm_memberships")}
       WHERE realm_id = $1 AND id = $2`,
      [realmId, membershipId],
    );
    if (result.rowCount !== 1) membershipNotFound();
  }

  public async createContentSession(input: {
    readonly tokenHash: string;
    readonly csrfTokenHash: string;
    readonly identityId: string;
    readonly realmId: string;
    readonly membershipId: string;
    readonly subjectId: string;
    readonly credentialVersion: number;
    readonly authenticatedAt: string;
    readonly expiresAt: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO ${this.q("_xecms_sessions")}
         (id, token_hash, csrf_token_hash, identity_id, created_at, expires_at, audience,
          realm_id, membership_id, subject_id, authenticated_at, credential_version)
       SELECT 'session_' || md5($1), $1, $2, identity.id, $7, $8, 'content', membership.realm_id,
              membership.id, membership.subject_id, $7, identity.credential_version
       FROM ${this.q("_xecms_realm_memberships")} membership
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = membership.realm_id
       JOIN ${this.q("_xecms_identities")} identity ON identity.id = membership.identity_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = membership.realm_id AND subject.id = membership.subject_id
       WHERE identity.id = $3 AND membership.realm_id = $4 AND membership.id = $5
         AND membership.subject_id = $6 AND identity.credential_version = $9
         AND membership.status = 'active' AND realm.status = 'active'
         AND realm.kind = 'content' AND identity.disabled_at IS NULL AND subject.disabled_at IS NULL`,
      [input.tokenHash, input.csrfTokenHash, input.identityId, input.realmId,
        input.membershipId, input.subjectId, input.authenticatedAt, input.expiresAt,
        input.credentialVersion],
    );
    if (result.rowCount !== 1) {
      throw new ApplicationError(
        "CONTENT_SESSION_PRINCIPAL_INVALID",
        401,
        "The Content Realm session principal is inactive or inconsistent.",
      );
    }
  }

  public async findContentSession(
    tokenHash: string,
    realmId: string,
    now: string,
  ): Promise<ContentRealmSessionRecord | null> {
    const result = await this.pool.query<ContentSessionRow>(
      `${CONTENT_SESSION_SELECT(this.q.bind(this))}
       WHERE session.token_hash = $1 AND session.realm_id = $2 AND session.audience = 'content'
         AND session.expires_at > $3 AND session.revoked_at IS NULL
         AND realm.status = 'active' AND realm.kind = 'content'
         AND membership.status = 'active' AND identity.disabled_at IS NULL
         AND subject.disabled_at IS NULL
         AND session.credential_version = identity.credential_version`,
      [tokenHash, realmId, now],
    );
    return result.rows[0] === undefined ? null : contentSessionFromRow(result.rows[0]);
  }

  public async findContentSessionWithCsrf(
    tokenHash: string,
    csrfTokenHash: string,
    realmId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM ${this.q("_xecms_sessions")} session
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.id = session.membership_id AND membership.identity_id = session.identity_id
        AND membership.realm_id = session.realm_id AND membership.subject_id = session.subject_id
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = session.realm_id
       JOIN ${this.q("_xecms_identities")} identity ON identity.id = session.identity_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = session.realm_id AND subject.id = session.subject_id
       WHERE session.token_hash = $1 AND session.csrf_token_hash = $2
         AND session.realm_id = $3 AND session.audience = 'content' AND session.expires_at > $4
         AND session.revoked_at IS NULL
         AND realm.kind = 'content' AND realm.status = 'active' AND membership.status = 'active'
         AND identity.disabled_at IS NULL AND subject.disabled_at IS NULL
         AND session.credential_version = identity.credential_version`,
      [tokenHash, csrfTokenHash, realmId, now],
    );
    return result.rowCount === 1;
  }

  public async deleteContentSession(tokenHash: string, realmId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.q("_xecms_sessions")}
          SET revoked_at = now(), revoked_by_identity_id = identity_id, revoke_reason = 'logout'
        WHERE token_hash = $1 AND realm_id = $2 AND audience = 'content' AND revoked_at IS NULL`,
      [tokenHash, realmId],
    );
  }

  public async revokeMembershipSessions(membershipId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.q("_xecms_sessions")}
          SET revoked_at = now(), revoke_reason = 'membership-suspended'
        WHERE membership_id = $1 AND revoked_at IS NULL`,
      [membershipId],
    );
  }

  public async listFullAccessBindings(
    realmId: string,
  ): Promise<readonly RealmFullAccessBindingRecord[]> {
    const result = await this.pool.query<FullAccessRow>(
      `${FULL_ACCESS_SELECT(this.q.bind(this))}
       WHERE binding.realm_id = $1 ORDER BY binding.created_at DESC, binding.id`,
      [realmId],
    );
    return result.rows.map(fullAccessFromRow);
  }

  public async grantFullAccess(
    input: RealmFullAccessBindingRecord,
  ): Promise<RealmFullAccessBindingRecord> {
    if (input.revokedAt !== undefined || input.revokedByIdentityId !== undefined) {
      throw new ApplicationError(
        "FULL_ACCESS_GRANT_INVALID",
        422,
        "A new Full Access binding cannot already be revoked.",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // An expired temporal grant is inactive even before an explicit cleanup
      // job runs. Close it in the same transaction so a new grant can be made.
      await client.query(
        `UPDATE ${this.q("_xecms_realm_full_access_bindings")}
         SET revoked_at = $3, revoked_by_identity_id = $4
         WHERE realm_id = $1 AND subject_id = $2 AND revoked_at IS NULL
           AND valid_until IS NOT NULL AND valid_until <= $3`,
        [input.realmId, input.subjectId, input.createdAt, input.grantedByIdentityId],
      );
      const result = await client.query<FullAccessRow>(
        `INSERT INTO ${this.q("_xecms_realm_full_access_bindings")} AS binding
           (id, realm_id, subject_id, granted_by_identity_id, granted_by_subject_id,
            reason, created_at, valid_until)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
         FROM ${this.q("_xecms_realms")} AS realm
         JOIN ${this.q("_xecms_realm_memberships")} AS membership
           ON membership.realm_id = realm.id AND membership.subject_id = $3
          AND membership.status = 'active'
         JOIN ${this.q("_xecms_identities")} AS member_identity
           ON member_identity.id = membership.identity_id AND member_identity.disabled_at IS NULL
         JOIN ${this.q("_xecms_auth_subjects")} AS member_subject
           ON member_subject.realm_id = realm.id AND member_subject.id = membership.subject_id
          AND member_subject.disabled_at IS NULL
         JOIN ${this.q("_xecms_identities")} AS grantor_identity
           ON grantor_identity.id = $4 AND grantor_identity.workspace_id = realm.workspace_id
          AND grantor_identity.disabled_at IS NULL
         JOIN ${this.q("_xecms_auth_subjects")} AS grantor_subject
           ON grantor_subject.id = $5 AND grantor_subject.identity_id = grantor_identity.id
          AND grantor_subject.disabled_at IS NULL
         WHERE realm.id = $2 AND realm.kind = 'content' AND realm.status = 'active'
         RETURNING binding.*`,
        [input.id, input.realmId, input.subjectId, input.grantedByIdentityId,
          input.grantedBySubjectId, input.reason, input.createdAt, input.validUntil ?? null],
      );
      if (result.rowCount !== 1) {
        throw new ApplicationError("FULL_ACCESS_GRANT_INVALID", 409, "The Full Access grant is invalid.");
      }
      await this.recordSecurityEvent(client, {
        event: "realm.full-access.granted",
        identityId: input.grantedByIdentityId,
        occurredAt: input.createdAt,
        metadata: {
          realmId: input.realmId,
          subjectId: input.subjectId,
          bindingId: input.id,
          validUntil: input.validUntil ?? null,
        },
      });
      await client.query("COMMIT");
      return fullAccessFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public async revokeFullAccess(input: {
    readonly realmId: string;
    readonly bindingId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<RealmFullAccessBindingRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<FullAccessRow>(
        `UPDATE ${this.q("_xecms_realm_full_access_bindings")} AS binding
         SET revoked_at = $3, revoked_by_identity_id = $4
         WHERE binding.realm_id = $1 AND binding.id = $2 AND binding.revoked_at IS NULL
           AND binding.created_at <= $3
           AND EXISTS (
             SELECT 1
             FROM ${this.q("_xecms_identities")} AS actor
             JOIN ${this.q("_xecms_realms")} AS realm ON realm.id = binding.realm_id
             WHERE actor.id = $4 AND actor.workspace_id = realm.workspace_id
               AND actor.disabled_at IS NULL
           )
         RETURNING binding.*`,
        [input.realmId, input.bindingId, input.now, input.actorIdentityId],
      );
      const revoked = result.rows[0];
      if (revoked === undefined) {
        throw new ApplicationError(
          "FULL_ACCESS_BINDING_NOT_FOUND",
          404,
          "The active Full Access binding was not found.",
        );
      }
      await this.recordSecurityEvent(client, {
        event: "realm.full-access.revoked",
        identityId: input.actorIdentityId,
        occurredAt: input.now,
        metadata: { realmId: input.realmId, subjectId: revoked.subject_id, bindingId: input.bindingId },
      });
      await client.query("COMMIT");
      return fullAccessFromRow(revoked);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public async hasActiveFullAccess(
    realmId: string,
    subjectId: string,
    now: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM ${this.q("_xecms_realm_full_access_bindings")} binding
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = binding.realm_id
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.realm_id = binding.realm_id AND membership.subject_id = binding.subject_id
        AND membership.status = 'active'
       JOIN ${this.q("_xecms_identities")} identity
         ON identity.id = membership.identity_id AND identity.disabled_at IS NULL
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = binding.realm_id AND subject.id = binding.subject_id
       WHERE binding.realm_id = $1 AND binding.subject_id = $2
         AND binding.revoked_at IS NULL
         AND (binding.valid_until IS NULL OR binding.valid_until > $3)
         AND realm.kind = 'content' AND realm.status = 'active' AND subject.disabled_at IS NULL`,
      [realmId, subjectId, now],
    );
    return result.rowCount === 1;
  }

  /** Revalidates the grant while durably recording each successful bypass. */
  public async recordFullAccessUse(input: RealmFullAccessUse): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO ${this.q("_xecms_audit_log")}
         (event_type, identity_id, occurred_at, metadata)
       SELECT 'realm.full-access.used', membership.identity_id, $5,
              jsonb_build_object(
                'realmId', $1::text,
                'subjectId', $2::text,
                'action', $3::text,
                'resourceId', $4::text,
                'operation', $6::text,
                'field', $7::text,
                'fields', $8::jsonb
              )
       FROM ${this.q("_xecms_realm_full_access_bindings")} binding
       JOIN ${this.q("_xecms_realm_memberships")} membership
         ON membership.realm_id = binding.realm_id
        AND membership.subject_id = binding.subject_id
       JOIN ${this.q("_xecms_identities")} identity
         ON identity.id = membership.identity_id
       JOIN ${this.q("_xecms_auth_subjects")} subject
         ON subject.realm_id = binding.realm_id AND subject.id = binding.subject_id
       JOIN ${this.q("_xecms_realms")} realm ON realm.id = binding.realm_id
       WHERE binding.realm_id = $1 AND binding.subject_id = $2
         AND binding.revoked_at IS NULL
         AND (binding.valid_until IS NULL OR binding.valid_until > $5)
         AND membership.status = 'active' AND identity.disabled_at IS NULL
         AND subject.disabled_at IS NULL AND realm.status = 'active'
         AND realm.kind = 'content'`,
      [
        input.realmId,
        input.subjectId,
        input.action,
        input.resourceId,
        input.at,
        input.operation,
        input.field ?? null,
        JSON.stringify(input.fields ?? null),
      ],
    );
    if (result.rowCount !== 1) {
      throw new ApplicationError(
        "REALM_FULL_ACCESS_NO_LONGER_ACTIVE",
        403,
        "Realm Full Access is no longer active.",
      );
    }
  }

  public async getAuthCollectionConfig(
    collectionId: string,
  ): Promise<AuthCollectionConfigRecord | null> {
    const result = await this.pool.query<AuthCollectionConfigRow>(
      `${AUTH_COLLECTION_CONFIG_SELECT(this.q.bind(this))} WHERE config.collection_id = $1`,
      [collectionId],
    );
    return result.rows[0] === undefined ? null : authCollectionConfigFromRow(result.rows[0]);
  }

  public async listAuthCollectionConfigs(): Promise<readonly AuthCollectionConfigRecord[]> {
    const result = await this.pool.query<AuthCollectionConfigRow>(
      `${AUTH_COLLECTION_CONFIG_SELECT(this.q.bind(this))} ORDER BY config.collection_id`,
    );
    return result.rows.map(authCollectionConfigFromRow);
  }

  public async upsertAuthCollectionConfig(input: {
    readonly collectionId: string;
    readonly realmId: string;
    readonly identifierFieldIds: readonly string[];
    readonly status: "active" | "retired";
    readonly schemaRevisionId?: string;
    readonly actorId: string;
    readonly now: string;
  }): Promise<AuthCollectionConfigRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<AuthCollectionConfigRow>(
        `INSERT INTO ${this.q("_xecms_auth_collection_configs")} AS config
           (collection_id, realm_id, identifier_field_ids, status, schema_revision_id,
            created_at, created_by, updated_at, updated_by)
         SELECT $1, realm.id, $3::text[], $4, $5, $6, actor.id, $6, actor.id
         FROM ${this.q("_xecms_realms")} AS realm
         JOIN ${this.q("_xecms_identities")} AS actor
           ON actor.id = $7 AND actor.workspace_id = realm.workspace_id
          AND actor.disabled_at IS NULL
         WHERE realm.id = $2 AND realm.kind = 'content'
         ON CONFLICT (collection_id) DO UPDATE SET
           identifier_field_ids = EXCLUDED.identifier_field_ids,
           status = EXCLUDED.status,
           schema_revision_id = EXCLUDED.schema_revision_id,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by
         WHERE config.realm_id = EXCLUDED.realm_id
         RETURNING config.*`,
        [input.collectionId, input.realmId, [...input.identifierFieldIds], input.status,
          input.schemaRevisionId ?? null, input.now, input.actorId],
      );
      if (result.rows[0] === undefined) {
        throw new ApplicationError(
          "AUTH_COLLECTION_CONFIG_INVALID",
          409,
          "The auth Collection cannot be attached to that Realm.",
        );
      }
      const realm = await client.query(
        `UPDATE ${this.q("_xecms_realms")} AS realm
         SET profile_collection_id = CASE WHEN $3 = 'active' THEN $2 ELSE NULL END,
             updated_at = $4, updated_by = $5
         WHERE realm.id = $1 AND realm.kind = 'content'
           AND (realm.profile_collection_id IS NULL OR realm.profile_collection_id = $2)
           AND EXISTS (
             SELECT 1 FROM ${this.q("_xecms_identities")} AS actor
             WHERE actor.id = $5 AND actor.workspace_id = realm.workspace_id
               AND actor.disabled_at IS NULL
           )`,
        [input.realmId, input.collectionId, input.status, input.now, input.actorId],
      );
      if (realm.rowCount !== 1) {
        throw new ApplicationError(
          "AUTH_COLLECTION_REALM_CONFLICT",
          409,
          "The Realm already has a different profile Collection.",
        );
      }
      await this.recordSecurityEvent(client, {
        event: "realm.auth-collection.configured",
        identityId: input.actorId,
        occurredAt: input.now,
        metadata: {
          realmId: input.realmId,
          collectionId: input.collectionId,
          status: input.status,
          schemaRevisionId: input.schemaRevisionId ?? null,
        },
      });
      await client.query("COMMIT");
      return authCollectionConfigFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  public async removeAuthCollectionConfig(collectionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ realm_id: string }>(
        `DELETE FROM ${this.q("_xecms_auth_collection_configs")}
         WHERE collection_id = $1 RETURNING realm_id`,
        [collectionId],
      );
      const realmId = result.rows[0]?.realm_id;
      if (realmId !== undefined) {
        await client.query(
          `UPDATE ${this.q("_xecms_realms")}
           SET profile_collection_id = NULL
           WHERE id = $1 AND profile_collection_id = $2`,
          [realmId, collectionId],
        );
      }
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  private async transitionMembership(input: {
    readonly realmId: string;
    readonly membershipId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly now: string;
    readonly status: "active" | "suspended";
  }): Promise<RealmMembershipRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<MembershipRow>(
        `UPDATE ${this.q("_xecms_realm_memberships")} membership
         SET status = $4, revision = revision + 1,
             activated_at = CASE WHEN $4 = 'active' THEN COALESCE(activated_at, $5::timestamptz)
                                 ELSE activated_at END,
             suspended_at = CASE WHEN $4 = 'suspended' THEN $5::timestamptz ELSE NULL END,
             updated_at = $5, updated_by = $6
         WHERE realm_id = $1 AND id = $2 AND revision = $3
           AND status <> $4
           AND EXISTS (
             SELECT 1 FROM ${this.q("_xecms_identities")} AS actor
             WHERE actor.id = $6 AND actor.workspace_id = membership.workspace_id
               AND actor.disabled_at IS NULL
           )
         RETURNING membership.*`,
        [input.realmId, input.membershipId, input.expectedRevision, input.status, input.now,
          input.actorIdentityId],
      );
      if (result.rows[0] === undefined) {
        await this.throwMembershipWriteConflict(client, input.realmId, input.membershipId, input.expectedRevision);
      }
      if (input.status === "suspended") {
        await client.query(
          `DELETE FROM ${this.q("_xecms_sessions")} WHERE membership_id = $1`,
          [input.membershipId],
        );
      }
      await this.recordSecurityEvent(client, {
        event: input.status === "active" ? "realm.membership.reactivated" : "realm.membership.suspended",
        identityId: input.actorIdentityId,
        occurredAt: input.now,
        metadata: { realmId: input.realmId, membershipId: input.membershipId },
      });
      await client.query("COMMIT");
      return membershipFromRow(result.rows[0]!);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapIdentityRealmError(error);
    } finally {
      client.release();
    }
  }

  private async throwRealmWriteConflict(
    realmId: string,
    expectedRevision: number,
    executor: Pick<PoolClient, "query"> = this.pool,
  ): Promise<never> {
    const result = await executor.query<{ revision: string | number; kind: string }>(
      `SELECT revision, kind FROM ${this.q("_xecms_realms")} WHERE id = $1`,
      [realmId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ApplicationError("IDENTITY_REALM_NOT_FOUND", 404, "The Realm does not exist.");
    }
    if (row.kind !== "content") {
      throw new ApplicationError("IDENTITY_REALM_PROTECTED", 403, "The System Realm is protected.");
    }
    throw new ApplicationError(
      "IDENTITY_REALM_REVISION_CONFLICT",
      409,
      "The Realm changed after it was read.",
      { details: { expectedRevision, actualRevision: Number(row.revision) } },
    );
  }

  private async throwMembershipWriteConflict(
    client: PoolClient,
    realmId: string,
    membershipId: string,
    expectedRevision: number,
  ): Promise<never> {
    const result = await client.query<{ revision: string | number }>(
      `SELECT revision FROM ${this.q("_xecms_realm_memberships")}
       WHERE realm_id = $1 AND id = $2`,
      [realmId, membershipId],
    );
    const row = result.rows[0];
    if (row === undefined) membershipNotFound();
    throw new ApplicationError(
      "REALM_MEMBERSHIP_REVISION_CONFLICT",
      409,
      "The Realm Membership changed after it was read.",
      { details: { expectedRevision, actualRevision: Number(row.revision) } },
    );
  }

  private async recordSecurityEvent(
    client: Pick<PoolClient, "query">,
    input: {
      readonly event: string;
      readonly identityId: string;
      readonly occurredAt: string;
      readonly metadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    const inserted = await client.query<{ readonly id: string | number }>(
      `INSERT INTO ${this.q("_xecms_audit_log")}
         (event_type, identity_id, occurred_at, metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id`,
      [input.event, input.identityId, input.occurredAt, JSON.stringify(input.metadata)],
    );
    const sourceId = inserted.rows[0]?.id;
    if (sourceId === undefined) throw new Error("Security event insert returned no id.");
    const aggregateType = input.event.startsWith("identity.") ? "identity" : "realm";
    const aggregateId = typeof input.metadata["identityId"] === "string"
      ? input.metadata["identityId"]
      : typeof input.metadata["membershipId"] === "string"
        ? input.metadata["membershipId"]
      : typeof input.metadata["realmId"] === "string"
        ? input.metadata["realmId"]
        : input.identityId;
    const realmId = typeof input.metadata["realmId"] === "string" ? input.metadata["realmId"] : null;
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id,
          actor_identity_id, occurred_at, payload, created_at)
       SELECT $1, identity.workspace_id, $2, $3, $4, $5, $6, $7, $8::jsonb, $7
         FROM ${this.q("_xecms_identities")} identity WHERE identity.id = $6`,
      [`outbox_security_${sourceId}`, realmId, input.event, aggregateType, aggregateId,
        input.identityId, input.occurredAt, JSON.stringify(input.metadata)],
    );
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

function REALM_SELECT(q: (name: string) => string): string {
  return `SELECT realm.id, realm.workspace_id, realm.realm_key, realm.name, realm.kind,
                 realm.status, realm.profile_collection_id, realm.accept_system_identities,
                 realm.membership_provisioning, realm.registration, realm.default_role_ids,
                 realm.revision, realm.created_at, realm.created_by, realm.updated_at, realm.updated_by
          FROM ${q("_xecms_realms")} realm`;
}

function IDENTITY_SELECT(q: (name: string) => string): string {
  return `SELECT identity.id, identity.workspace_id, identity.username,
                 identity.origin_realm_id, identity.credential_version,
                 identity.disabled_at
          FROM ${q("_xecms_identities")} identity`;
}

function IDENTITY_CREDENTIAL_SELECT(q: (name: string) => string): string {
  return `SELECT identity.id, identity.workspace_id, identity.username,
                 identity.origin_realm_id, identity.credential_version,
                 identity.disabled_at, identity.password_hash
          FROM ${q("_xecms_identities")} identity`;
}

function MEMBERSHIP_SELECT(q: (name: string) => string): string {
  return `SELECT membership.id, membership.identity_id, membership.realm_id,
                 membership.subject_id, membership.profile_collection_id,
                 membership.profile_document_id, membership.status,
                 membership.provisioned_by, membership.revision,
                 membership.created_at, membership.activated_at, membership.suspended_at
          FROM ${q("_xecms_realm_memberships")} membership`;
}

function CONTENT_SESSION_SELECT(q: (name: string) => string): string {
  return `SELECT
            identity.id AS identity_record_id,
            identity.workspace_id AS identity_workspace_id,
            identity.username AS identity_username,
            identity.origin_realm_id AS identity_origin_realm_id,
            identity.credential_version AS identity_credential_version,
            identity.disabled_at AS identity_disabled_at,
            realm.id AS realm_record_id,
            realm.workspace_id AS realm_workspace_id,
            realm.realm_key, realm.name AS realm_name, realm.kind AS realm_kind,
            realm.status AS realm_status, realm.profile_collection_id AS realm_profile_collection_id,
            realm.accept_system_identities, realm.membership_provisioning,
            realm.registration, realm.default_role_ids, realm.revision AS realm_revision,
            realm.created_at AS realm_created_at, realm.created_by AS realm_created_by,
            realm.updated_at AS realm_updated_at, realm.updated_by AS realm_updated_by,
            membership.id AS membership_record_id,
            membership.identity_id AS membership_identity_id,
            membership.realm_id AS membership_realm_id,
            membership.subject_id AS membership_subject_id,
            membership.profile_collection_id AS membership_profile_collection_id,
            membership.profile_document_id AS membership_profile_document_id,
            membership.status AS membership_status,
            membership.provisioned_by AS membership_provisioned_by,
            membership.revision AS membership_revision,
            membership.created_at AS membership_created_at,
            membership.activated_at AS membership_activated_at,
            membership.suspended_at AS membership_suspended_at,
            session.expires_at, session.authenticated_at
          FROM ${q("_xecms_sessions")} session
          JOIN ${q("_xecms_realm_memberships")} membership
            ON membership.id = session.membership_id AND membership.identity_id = session.identity_id
           AND membership.realm_id = session.realm_id AND membership.subject_id = session.subject_id
          JOIN ${q("_xecms_realms")} realm ON realm.id = session.realm_id
          JOIN ${q("_xecms_identities")} identity ON identity.id = session.identity_id
          JOIN ${q("_xecms_auth_subjects")} subject
            ON subject.realm_id = session.realm_id AND subject.id = session.subject_id`;
}

function FULL_ACCESS_SELECT(q: (name: string) => string): string {
  return `SELECT binding.id, binding.realm_id, binding.subject_id,
                 binding.granted_by_identity_id, binding.granted_by_subject_id,
                 binding.reason, binding.created_at, binding.valid_until,
                 binding.revoked_at, binding.revoked_by_identity_id
          FROM ${q("_xecms_realm_full_access_bindings")} binding`;
}

function AUTH_COLLECTION_CONFIG_SELECT(q: (name: string) => string): string {
  return `SELECT config.collection_id, config.realm_id, config.identifier_field_ids,
                 config.status, config.schema_revision_id, config.created_at,
                 config.created_by, config.updated_at, config.updated_by
          FROM ${q("_xecms_auth_collection_configs")} config`;
}

interface RealmRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly realm_key: string;
  readonly name: string;
  readonly kind: "system" | "content";
  readonly status: IdentityRealmStatus;
  readonly profile_collection_id: string | null;
  readonly accept_system_identities: boolean;
  readonly membership_provisioning: RealmAuthenticationPolicyRecord["provisioning"];
  readonly registration: RealmAuthenticationPolicyRecord["registration"];
  readonly default_role_ids: string[];
  readonly revision: string | number;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly updated_at: Date | string;
  readonly updated_by: string;
}

interface IdentityRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly username: string;
  readonly origin_realm_id: string;
  readonly credential_version: string | number;
  readonly disabled_at: Date | string | null;
}

interface IdentityCredentialRow extends IdentityRow {
  readonly password_hash: string;
}

interface IdentifierRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly identity_id: string;
  readonly identifier_kind: string;
  readonly normalized_value: string;
  readonly display_value: string;
  readonly verified_at: Date | string | null;
  readonly created_at: Date | string;
  readonly created_by: string;
}

interface MembershipRow extends QueryResultRow {
  readonly id: string;
  readonly identity_id: string;
  readonly realm_id: string;
  readonly subject_id: string;
  readonly profile_collection_id: string | null;
  readonly profile_document_id: string | null;
  readonly status: RealmMembershipStatus;
  readonly provisioned_by: RealmMembershipProvisionedBy;
  readonly revision: string | number;
  readonly created_at: Date | string;
  readonly activated_at: Date | string | null;
  readonly suspended_at: Date | string | null;
}

interface ProvisioningMembershipRow extends MembershipRow {
  readonly workspace_id: string;
  readonly configured_profile_collection_id: string | null;
  readonly realm_kind: "system" | "content";
  readonly realm_status: IdentityRealmStatus;
  readonly identity_disabled_at: Date | string | null;
  readonly subject_disabled_at: Date | string | null;
}

interface ContentSessionRow extends QueryResultRow {
  readonly identity_record_id: string;
  readonly identity_workspace_id: string;
  readonly identity_username: string;
  readonly identity_origin_realm_id: string;
  readonly identity_credential_version: string | number;
  readonly identity_disabled_at: Date | string | null;
  readonly realm_record_id: string;
  readonly realm_workspace_id: string;
  readonly realm_key: string;
  readonly realm_name: string;
  readonly realm_kind: "system" | "content";
  readonly realm_status: IdentityRealmStatus;
  readonly realm_profile_collection_id: string | null;
  readonly accept_system_identities: boolean;
  readonly membership_provisioning: RealmAuthenticationPolicyRecord["provisioning"];
  readonly registration: RealmAuthenticationPolicyRecord["registration"];
  readonly default_role_ids: string[];
  readonly realm_revision: string | number;
  readonly realm_created_at: Date | string;
  readonly realm_created_by: string;
  readonly realm_updated_at: Date | string;
  readonly realm_updated_by: string;
  readonly membership_record_id: string;
  readonly membership_identity_id: string;
  readonly membership_realm_id: string;
  readonly membership_subject_id: string;
  readonly membership_profile_collection_id: string | null;
  readonly membership_profile_document_id: string | null;
  readonly membership_status: RealmMembershipStatus;
  readonly membership_provisioned_by: RealmMembershipProvisionedBy;
  readonly membership_revision: string | number;
  readonly membership_created_at: Date | string;
  readonly membership_activated_at: Date | string | null;
  readonly membership_suspended_at: Date | string | null;
  readonly expires_at: Date | string;
  readonly authenticated_at: Date | string;
}

interface FullAccessRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly subject_id: string;
  readonly granted_by_identity_id: string;
  readonly granted_by_subject_id: string;
  readonly reason: string;
  readonly created_at: Date | string;
  readonly valid_until: Date | string | null;
  readonly revoked_at: Date | string | null;
  readonly revoked_by_identity_id: string | null;
}

interface AuthCollectionConfigRow extends QueryResultRow {
  readonly collection_id: string;
  readonly realm_id: string;
  readonly identifier_field_ids: string[];
  readonly status: "active" | "retired";
  readonly schema_revision_id: string | null;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly updated_at: Date | string;
  readonly updated_by: string;
}

function realmFromRow(row: RealmRow): IdentityRealmRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.realm_key,
    name: row.name,
    kind: row.kind,
    status: row.status,
    ...(row.profile_collection_id === null ? {} : { profileCollectionId: row.profile_collection_id }),
    authentication: {
      acceptSystemIdentities: row.accept_system_identities,
      provisioning: row.membership_provisioning,
      registration: row.registration,
      defaultRoleIds: Object.freeze([...row.default_role_ids]),
    },
    revision: Number(row.revision),
    createdAt: instant(row.created_at),
    createdBy: row.created_by,
    updatedAt: instant(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function identityFromRow(row: IdentityRow): GlobalIdentityRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    primaryIdentifier: row.username,
    originRealmId: row.origin_realm_id,
    credentialVersion: Number(row.credential_version),
    ...(row.disabled_at === null ? {} : { disabledAt: instant(row.disabled_at) }),
  };
}

function identityCredentialFromRow(row: IdentityCredentialRow): GlobalIdentityCredentialRecord {
  return { ...identityFromRow(row), passwordHash: row.password_hash };
}

function identifierFromRow(row: IdentifierRow): IdentityIdentifierRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    identityId: row.identity_id,
    kind: row.identifier_kind,
    normalizedValue: row.normalized_value,
    displayValue: row.display_value,
    ...(row.verified_at === null ? {} : { verifiedAt: instant(row.verified_at) }),
    createdAt: instant(row.created_at),
    createdBy: row.created_by,
  };
}

function membershipFromRow(row: MembershipRow): RealmMembershipRecord {
  return {
    id: row.id,
    identityId: row.identity_id,
    realmId: row.realm_id,
    subjectId: row.subject_id,
    ...(row.profile_collection_id === null ? {} : { profileCollectionId: row.profile_collection_id }),
    ...(row.profile_document_id === null ? {} : { profileDocumentId: row.profile_document_id }),
    status: row.status,
    provisionedBy: row.provisioned_by,
    revision: Number(row.revision),
    createdAt: instant(row.created_at),
    ...(row.activated_at === null ? {} : { activatedAt: instant(row.activated_at) }),
    ...(row.suspended_at === null ? {} : { suspendedAt: instant(row.suspended_at) }),
  };
}

function contentSessionFromRow(row: ContentSessionRow): ContentRealmSessionRecord {
  const realm = realmFromRow({
    id: row.realm_record_id,
    workspace_id: row.realm_workspace_id,
    realm_key: row.realm_key,
    name: row.realm_name,
    kind: row.realm_kind,
    status: row.realm_status,
    profile_collection_id: row.realm_profile_collection_id,
    accept_system_identities: row.accept_system_identities,
    membership_provisioning: row.membership_provisioning,
    registration: row.registration,
    default_role_ids: row.default_role_ids,
    revision: row.realm_revision,
    created_at: row.realm_created_at,
    created_by: row.realm_created_by,
    updated_at: row.realm_updated_at,
    updated_by: row.realm_updated_by,
  });
  const identity = identityFromRow({
    id: row.identity_record_id,
    workspace_id: row.identity_workspace_id,
    username: row.identity_username,
    origin_realm_id: row.identity_origin_realm_id,
    credential_version: row.identity_credential_version,
    disabled_at: row.identity_disabled_at,
  });
  const membership = membershipFromRow({
    id: row.membership_record_id,
    identity_id: row.membership_identity_id,
    realm_id: row.membership_realm_id,
    subject_id: row.membership_subject_id,
    profile_collection_id: row.membership_profile_collection_id,
    profile_document_id: row.membership_profile_document_id,
    status: row.membership_status,
    provisioned_by: row.membership_provisioned_by,
    revision: row.membership_revision,
    created_at: row.membership_created_at,
    activated_at: row.membership_activated_at,
    suspended_at: row.membership_suspended_at,
  });
  return {
    identity,
    realm,
    membership,
    expiresAt: instant(row.expires_at),
    authenticatedAt: instant(row.authenticated_at),
  };
}

function fullAccessFromRow(row: FullAccessRow): RealmFullAccessBindingRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    subjectId: row.subject_id,
    grantedByIdentityId: row.granted_by_identity_id,
    grantedBySubjectId: row.granted_by_subject_id,
    reason: row.reason,
    createdAt: instant(row.created_at),
    ...(row.valid_until === null ? {} : { validUntil: instant(row.valid_until) }),
    ...(row.revoked_at === null ? {} : { revokedAt: instant(row.revoked_at) }),
    ...(row.revoked_by_identity_id === null ? {} : { revokedByIdentityId: row.revoked_by_identity_id }),
  };
}

function authCollectionConfigFromRow(row: AuthCollectionConfigRow): AuthCollectionConfigRecord {
  return {
    collectionId: row.collection_id,
    realmId: row.realm_id,
    identifierFieldIds: Object.freeze([...row.identifier_field_ids]),
    status: row.status,
    ...(row.schema_revision_id === null ? {} : { schemaRevisionId: row.schema_revision_id }),
    createdAt: instant(row.created_at),
    createdBy: row.created_by,
    updatedAt: instant(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function membershipNotFound(): never {
  throw new ApplicationError("REALM_MEMBERSHIP_NOT_FOUND", 404, "The Realm Membership does not exist.");
}

interface PostgresErrorLike {
  readonly code?: string;
  readonly constraint?: string;
}

function mapIdentityRealmError(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  const pg = error as PostgresErrorLike;
  if (pg.code === "23505") {
    if (pg.constraint === "_xecms_realms_workspace_key") {
      return new ApplicationError("IDENTITY_REALM_KEY_CONFLICT", 409, "That Realm key already exists.");
    }
    if (pg.constraint?.includes("identity_identifiers") === true ||
      pg.constraint === "_xecms_identities_normalized_username_key") {
      return new ApplicationError("IDENTITY_IDENTIFIER_CONFLICT", 409, "That Identity identifier already exists.");
    }
    if (pg.constraint === "_xecms_realm_memberships_profile_document") {
      return new ApplicationError(
        "REALM_MEMBERSHIP_PROFILE_CONFLICT",
        409,
        "That profile Document is already assigned to another Realm Membership.",
      );
    }
    if (pg.constraint?.includes("realm_memberships") === true) {
      return new ApplicationError("REALM_MEMBERSHIP_CONFLICT", 409, "That Realm Membership already exists.");
    }
    if (pg.constraint === "_xecms_realm_full_access_active_subject") {
      return new ApplicationError("FULL_ACCESS_ALREADY_GRANTED", 409, "The Subject already has active Full Access.");
    }
    return new ApplicationError("IDENTITY_REALM_CONFLICT", 409, "The Identity Realm record already exists.");
  }
  if (pg.code === "23503") {
    return new ApplicationError(
      "IDENTITY_REALM_REFERENCE_INVALID",
      409,
      "An Identity Realm reference is missing or belongs to another Realm.",
    );
  }
  if (pg.code === "23514" || pg.code === "23502" || pg.code === "22P02") {
    return new ApplicationError("IDENTITY_REALM_INVALID", 422, "The Identity Realm record is invalid.");
  }
  return error;
}
