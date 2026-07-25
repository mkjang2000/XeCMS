import { createHash } from "node:crypto";

import {
  decodeAdminAppManifestAny,
  serializeManifestValue,
  type AdminAppAudience,
  type AdminAppManifest,
} from "@xecms/admin-apps";
import {
  ApplicationError,
  adminAppAuthorizationResources,
  adminAppAuthorizationResourceId,
  type AdminAppActivationResult,
  type AdminAppDependencyKind,
  type AdminAppDependencyRecord,
  type AdminAppDraftRecord,
  type AdminAppRecord,
  type AdminAppRevisionRecord,
  type AdminAppStore,
  type AuthorizationAuditDraft,
  type AuthorizationResourceRecord,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";

export class PostgresAdminAppStore implements AdminAppStore {
  private readonly schema: string;
  private readonly authorization: PostgresAuthorizationStore;

  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
    this.authorization = new PostgresAuthorizationStore(pool, this.schema);
  }

  public async listApps(
    workspaceId: string,
    includeArchived = false,
  ): Promise<readonly AdminAppRecord[]> {
    const result = await this.pool.query<AdminAppRow>(
      `SELECT * FROM ${this.q("_xecms_admin_apps")}
        WHERE workspace_id = $1 AND ($2 OR status = 'active')
        ORDER BY name, id`,
      [workspaceId, includeArchived],
    );
    return result.rows.map(mapApp);
  }

  public async getApp(workspaceId: string, appId: string): Promise<AdminAppRecord | null> {
    const result = await this.pool.query<AdminAppRow>(
      `SELECT * FROM ${this.q("_xecms_admin_apps")} WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, appId],
    );
    return result.rows[0] === undefined ? null : mapApp(result.rows[0]);
  }

  public async getAppByKey(workspaceId: string, appKey: string): Promise<AdminAppRecord | null> {
    const result = await this.pool.query<AdminAppRow>(
      `SELECT * FROM ${this.q("_xecms_admin_apps")} WHERE workspace_id = $1 AND app_key = $2`,
      [workspaceId, appKey],
    );
    return result.rows[0] === undefined ? null : mapApp(result.rows[0]);
  }

  public async createAppDraft(
    input: Parameters<AdminAppStore["createAppDraft"]>[0],
  ): Promise<{ readonly app: AdminAppRecord; readonly draft: AdminAppDraftRecord }> {
    const canonical = canonicalManifest(input.manifest);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      await this.assertRouteAvailable(client, input.workspaceId, canonical.manifest.key, input.id);
      const audience = audienceColumns(canonical.manifest.audience);
      await client.query(
        `INSERT INTO ${this.q("_xecms_admin_apps")}
          (id, workspace_id, manifest_id, app_key, name, audience_type, audience_realm_id,
           status, active_revision_id, route_version, created_at, created_by_identity_id,
           created_by_subject_id, updated_at, updated_by_identity_id, updated_by_subject_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NULL, 1, $8, $9, $10, $8, $9, $10)`,
        [input.id, input.workspaceId, canonical.manifest.id, canonical.manifest.key,
          canonical.manifest.name, audience.type, audience.realmId, input.now,
          input.actorIdentityId, input.actorSubjectId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_admin_app_drafts")}
          (app_id, workspace_id, base_revision_id, draft_version, desired_key, manifest_json,
           manifest_hash, created_at, created_by_identity_id, created_by_subject_id,
           updated_at, updated_by_identity_id, updated_by_subject_id)
         VALUES ($1, $2, NULL, 1, $3, $4::jsonb, $5, $6, $7, $8, $6, $7, $8)`,
        [input.id, input.workspaceId, canonical.manifest.key, canonical.serialized,
          canonical.hash, input.now, input.actorIdentityId, input.actorSubjectId],
      );
      await client.query("COMMIT");
      return {
        app: required(await this.getApp(input.workspaceId, input.id)),
        draft: required(await this.getDraft(input.workspaceId, input.id)),
      };
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async createDraft(
    input: Parameters<AdminAppStore["createDraft"]>[0],
  ): Promise<AdminAppDraftRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      const app = await this.lockApp(client, input.workspaceId, input.appId);
      assertRouteVersion(app, input.expectedRouteVersion);
      assertAppEditable(app);
      if (app.active_revision_id === null) {
        throw new ApplicationError(
          "ADMIN_APP_ACTIVE_REVISION_NOT_FOUND",
          409,
          "An App without an active revision must keep its initial Draft.",
        );
      }
      const existing = await this.findDraft(client, input.workspaceId, input.appId, true);
      if (existing !== null) {
        throw new ApplicationError("ADMIN_APP_DRAFT_EXISTS", 409, "The App already has a Draft.");
      }
      const revision = await this.findRevision(
        client,
        input.workspaceId,
        input.appId,
        app.active_revision_id,
      );
      if (revision === null) integrity("The active Admin App revision is missing.");
      await this.assertRouteAvailable(client, input.workspaceId, revision.manifest.key, input.appId);
      await client.query(
        `INSERT INTO ${this.q("_xecms_admin_app_drafts")}
          (app_id, workspace_id, base_revision_id, draft_version, desired_key, manifest_json,
           manifest_hash, created_at, created_by_identity_id, created_by_subject_id,
           updated_at, updated_by_identity_id, updated_by_subject_id)
         VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6, $7, $8, $9, $7, $8, $9)`,
        [input.appId, input.workspaceId, revision.id, revision.manifest.key,
          serializeManifestValue(revision.manifest), revision.manifestHash, input.now,
          input.actorIdentityId, input.actorSubjectId],
      );
      await client.query("COMMIT");
      return required(await this.getDraft(input.workspaceId, input.appId));
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async getDraft(
    workspaceId: string,
    appId: string,
  ): Promise<AdminAppDraftRecord | null> {
    const result = await this.pool.query<AdminAppDraftRow>(
      `SELECT * FROM ${this.q("_xecms_admin_app_drafts")}
        WHERE workspace_id = $1 AND app_id = $2`,
      [workspaceId, appId],
    );
    return result.rows[0] === undefined ? null : mapDraft(result.rows[0]);
  }

  public async saveDraft(
    input: Parameters<AdminAppStore["saveDraft"]>[0],
  ): Promise<AdminAppDraftRecord> {
    const canonical = canonicalManifest(input.manifest);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      const app = await this.lockApp(client, input.workspaceId, input.appId);
      assertAppEditable(app);
      assertManifestId(app, canonical.manifest);
      const draftRow = await this.findDraft(client, input.workspaceId, input.appId, true);
      if (draftRow === null) {
        throw new ApplicationError("ADMIN_APP_DRAFT_NOT_FOUND", 404, "The App Draft does not exist.");
      }
      const draft = mapDraft(draftRow);
      assertDraftVersion(draft, input.expectedDraftVersion);
      if (draft.baseRevisionId !== input.expectedBaseRevisionId ||
          app.active_revision_id !== draft.baseRevisionId) {
        throw revisionConflict(input.expectedBaseRevisionId, app.active_revision_id);
      }
      await this.assertRouteAvailable(client, input.workspaceId, canonical.manifest.key, input.appId);
      const result = await client.query<AdminAppDraftRow>(
        `UPDATE ${this.q("_xecms_admin_app_drafts")}
            SET desired_key = $3, manifest_json = $4::jsonb, manifest_hash = $5,
                draft_version = draft_version + 1, updated_at = $6,
                updated_by_identity_id = $7, updated_by_subject_id = $8
          WHERE workspace_id = $1 AND app_id = $2
          RETURNING *`,
        [input.workspaceId, input.appId, canonical.manifest.key, canonical.serialized,
          canonical.hash, input.now, input.actorIdentityId, input.actorSubjectId],
      );
      await client.query("COMMIT");
      return mapDraft(required(result.rows[0]));
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async listRevisions(
    workspaceId: string,
    appId: string,
  ): Promise<readonly AdminAppRevisionRecord[]> {
    const result = await this.pool.query<AdminAppRevisionRow>(
      `SELECT * FROM ${this.q("_xecms_admin_app_revisions")}
        WHERE workspace_id = $1 AND app_id = $2 ORDER BY sequence DESC`,
      [workspaceId, appId],
    );
    const dependencies = await this.loadDependencies(result.rows.map(({ revision_id }) => revision_id));
    return result.rows.map((row) => mapRevision(row, dependencies.get(row.revision_id) ?? []));
  }

  public async discardDraft(
    input: Parameters<AdminAppStore["discardDraft"]>[0],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      await this.lockApp(client, input.workspaceId, input.appId);
      const draftRow = await this.findDraft(client, input.workspaceId, input.appId, true);
      if (draftRow === null) {
        throw new ApplicationError("ADMIN_APP_DRAFT_NOT_FOUND", 404, "The App Draft does not exist.");
      }
      assertDraftVersion(mapDraft(draftRow), input.expectedDraftVersion);
      await client.query(
        `DELETE FROM ${this.q("_xecms_admin_app_drafts")} WHERE workspace_id = $1 AND app_id = $2`,
        [input.workspaceId, input.appId],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async getRevision(
    workspaceId: string,
    appId: string,
    revisionId: string,
  ): Promise<AdminAppRevisionRecord | null> {
    const result = await this.pool.query<AdminAppRevisionRow>(
      `SELECT * FROM ${this.q("_xecms_admin_app_revisions")}
        WHERE workspace_id = $1 AND app_id = $2 AND revision_id = $3`,
      [workspaceId, appId, revisionId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const dependencies = await this.loadDependencies([revisionId]);
    return mapRevision(row, dependencies.get(revisionId) ?? []);
  }

  public async applyDraft(
    input: Parameters<AdminAppStore["applyDraft"]>[0],
  ): Promise<AdminAppActivationResult> {
    const dependencies = normalizeDependencies(input.dependencies);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      const app = await this.lockApp(client, input.workspaceId, input.appId);
      assertAppEditable(app);
      assertRouteVersion(app, input.expectedRouteVersion);
      assertActiveRevision(app, input.expectedActiveRevisionId);
      const draftRow = await this.findDraft(client, input.workspaceId, input.appId, true);
      if (draftRow === null) {
        throw new ApplicationError("ADMIN_APP_DRAFT_NOT_FOUND", 404, "The App Draft does not exist.");
      }
      const draft = mapDraft(draftRow);
      assertDraftVersion(draft, input.expectedDraftVersion);
      if (draft.baseRevisionId !== app.active_revision_id) {
        throw revisionConflict(draft.baseRevisionId, app.active_revision_id);
      }
      assertManifestId(app, draft.manifest);
      await this.assertRouteAvailable(client, input.workspaceId, draft.manifest.key, input.appId);
      const sequenceResult = await client.query<{ next_sequence: string }>(
        `SELECT (COALESCE(max(sequence), 0) + 1)::text AS next_sequence
           FROM ${this.q("_xecms_admin_app_revisions")} WHERE app_id = $1`,
        [input.appId],
      );
      const sequence = safePositiveInteger(sequenceResult.rows[0]?.next_sequence, "revision sequence");
      await client.query(
        `INSERT INTO ${this.q("_xecms_admin_app_revisions")}
          (revision_id, app_id, workspace_id, sequence, parent_revision_id, manifest_json,
           manifest_hash, created_at, created_by_identity_id, created_by_subject_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [input.revisionId, input.appId, input.workspaceId, sequence, app.active_revision_id,
          serializeManifestValue(draft.manifest), draft.manifestHash, input.now,
          input.actorIdentityId, input.actorSubjectId],
      );
      for (const dependency of dependencies) {
        await client.query(
          `INSERT INTO ${this.q("_xecms_admin_app_dependencies")}
            (revision_id, dependency_kind, dependency_id, fingerprint, metadata)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [input.revisionId, dependency.kind, dependency.id, dependency.fingerprint ?? null,
            JSON.stringify(dependency.metadata ?? {})],
        );
      }
      await this.syncAuthorizationResource(client, app, draft.manifest, {
        actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId,
        now: input.now,
        nextRouteVersion: input.expectedRouteVersion + 1,
      });
      const audience = audienceColumns(draft.manifest.audience);
      await client.query(
        `UPDATE ${this.q("_xecms_admin_apps")}
            SET app_key = $3, name = $4, audience_type = $5, audience_realm_id = $6,
                active_revision_id = $7, route_version = route_version + 1,
                updated_at = $8, updated_by_identity_id = $9, updated_by_subject_id = $10
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.appId, draft.manifest.key, draft.manifest.name,
          audience.type, audience.realmId, input.revisionId, input.now,
          input.actorIdentityId, input.actorSubjectId],
      );
      await client.query(
        `DELETE FROM ${this.q("_xecms_admin_app_drafts")} WHERE workspace_id = $1 AND app_id = $2`,
        [input.workspaceId, input.appId],
      );
      await client.query("COMMIT");
      return this.activation(input.workspaceId, input.appId, input.revisionId);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async activateRevision(
    input: Parameters<AdminAppStore["activateRevision"]>[0],
  ): Promise<AdminAppActivationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      const app = await this.lockApp(client, input.workspaceId, input.appId);
      assertAppEditable(app);
      assertRouteVersion(app, input.expectedRouteVersion);
      assertActiveRevision(app, input.expectedActiveRevisionId);
      if (input.targetRevisionId === app.active_revision_id) {
        throw new ApplicationError(
          "ADMIN_APP_REVISION_ALREADY_ACTIVE",
          409,
          "The selected Admin App revision is already active.",
        );
      }
      if (await this.findDraft(client, input.workspaceId, input.appId, true) !== null) {
        throw new ApplicationError(
          "ADMIN_APP_DRAFT_EXISTS",
          409,
          "Rollback requires the current Draft to be applied or discarded first.",
        );
      }
      const revision = await this.findRevision(
        client,
        input.workspaceId,
        input.appId,
        input.targetRevisionId,
      );
      if (revision === null) {
        throw new ApplicationError(
          "ADMIN_APP_REVISION_NOT_FOUND",
          404,
          "The selected Admin App revision does not exist.",
        );
      }
      await this.assertRouteAvailable(client, input.workspaceId, revision.manifest.key, input.appId);
      await this.syncAuthorizationResource(client, app, revision.manifest, {
        actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId,
        now: input.now,
        nextRouteVersion: input.expectedRouteVersion + 1,
      });
      const audience = audienceColumns(revision.manifest.audience);
      await client.query(
        `UPDATE ${this.q("_xecms_admin_apps")}
            SET app_key = $3, name = $4, audience_type = $5, audience_realm_id = $6,
                active_revision_id = $7, route_version = route_version + 1,
                updated_at = $8, updated_by_identity_id = $9, updated_by_subject_id = $10
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.appId, revision.manifest.key, revision.manifest.name,
          audience.type, audience.realmId, revision.id, input.now,
          input.actorIdentityId, input.actorSubjectId],
      );
      await client.query("COMMIT");
      return this.activation(input.workspaceId, input.appId, revision.id);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async setArchived(
    input: Parameters<AdminAppStore["setArchived"]>[0],
  ): Promise<AdminAppRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      const app = await this.lockApp(client, input.workspaceId, input.appId);
      assertRouteVersion(app, input.expectedRouteVersion);
      if ((app.status === "archived") === input.archived) {
        throw new ApplicationError(
          "ADMIN_APP_STATUS_UNCHANGED",
          409,
          "The Admin App already has the requested status.",
        );
      }
      await client.query(
        `UPDATE ${this.q("_xecms_admin_apps")}
            SET status = $3, route_version = route_version + 1,
                archived_at = $4, archived_by_identity_id = $5,
                archived_by_subject_id = $6, updated_at = $7,
                updated_by_identity_id = $5, updated_by_subject_id = $6
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.appId, input.archived ? "archived" : "active",
          input.archived ? input.now : null,
          input.archived ? input.actorIdentityId : null,
          input.archived ? input.actorSubjectId : null,
          input.now],
      );
      await client.query("COMMIT");
      return required(await this.getApp(input.workspaceId, input.appId));
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async deleteUnappliedApp(
    input: Parameters<AdminAppStore["deleteUnappliedApp"]>[0],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockWorkspace(client, input.workspaceId);
      const app = await this.lockApp(client, input.workspaceId, input.appId);
      assertRouteVersion(app, input.expectedRouteVersion);
      if (app.active_revision_id !== null) {
        throw new ApplicationError(
          "ADMIN_APP_DELETE_REQUIRES_ARCHIVE",
          409,
          "An applied Admin App is retained for rollback and must be archived instead.",
        );
      }
      await client.query(
        `DELETE FROM ${this.q("_xecms_admin_apps")} WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.appId],
      );
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw mapAdminAppDatabaseError(error);
    } finally {
      client.release();
    }
  }

  private async activation(
    workspaceId: string,
    appId: string,
    revisionId: string,
  ): Promise<AdminAppActivationResult> {
    const [app, revision] = await Promise.all([
      this.getApp(workspaceId, appId),
      this.getRevision(workspaceId, appId, revisionId),
    ]);
    return { app: required(app), revision: required(revision) };
  }

  /**
   * Keeps the active App pointer and its authorization target on one commit.
   * Policy rows are locked in Realm-ID order before the Resource, matching the
   * normal authorization mutation lock order and avoiding cross-Realm moves
   * that can deadlock each other.
   */
  private async syncAuthorizationResource(
    client: PoolClient,
    app: AdminAppRow,
    manifest: AdminAppManifest,
    input: AdminAppResourceAuthor & { readonly nextRouteVersion: number },
  ): Promise<void> {
    const resourceId = adminAppAuthorizationResourceId(app.id);
    const targetRealmId = manifest.audience.type === "system"
      ? "rlm_system"
      : manifest.audience.realmId;
    const observed = await client.query<AdminAppResourceRow>(
      `SELECT id, realm_id, name, resource_type, parent_id, protected, retired_at
         FROM ${this.q("_xecms_auth_resources")} WHERE id = $1`,
      [resourceId],
    );
    const realmIds = [...new Set([
      targetRealmId,
      ...(observed.rows[0] === undefined ? [] : [observed.rows[0].realm_id]),
    ])].sort();
    const policies = await client.query<AdminAppPolicyRow>(
      `SELECT state.realm_id, state.current_revision, state.root_resource_id
         FROM ${this.q("_xecms_auth_policy_state")} state
         JOIN ${this.q("_xecms_realms")} realm
           ON realm.id = state.realm_id AND realm.workspace_id = $2
        WHERE state.realm_id = ANY($1::text[])
        ORDER BY state.realm_id
        FOR UPDATE OF state`,
      [realmIds, app.workspace_id],
    );
    const policyByRealm = new Map(policies.rows.map((policy) => [policy.realm_id, policy]));
    for (const realmId of realmIds) {
      const policy = policyByRealm.get(realmId);
      if (policy === undefined || Number(policy.current_revision) < 1 || policy.root_resource_id === null) {
        throw new ApplicationError(
          "ADMIN_APP_AUDIENCE_POLICY_UNAVAILABLE",
          409,
          `The Admin App audience Realm '${realmId}' has no active authorization policy.`,
        );
      }
    }

    const lockedRoot = await client.query<AdminAppResourceRow>(
      `SELECT id, realm_id, name, resource_type, parent_id, protected, retired_at
         FROM ${this.q("_xecms_auth_resources")} WHERE id = $1 FOR UPDATE`,
      [resourceId],
    );
    const beforeRoot = lockedRoot.rows[0];
    if (beforeRoot !== undefined && !policyByRealm.has(beforeRoot.realm_id)) {
      throw new ApplicationError(
        "ADMIN_APP_RESOURCE_CONCURRENT_CHANGE",
        409,
        "The Admin App authorization Resource moved concurrently; retry Apply.",
      );
    }
    if (beforeRoot !== undefined && (
      beforeRoot.resource_type !== "admin-app"
      || beforeRoot.protected !== true
      || beforeRoot.retired_at !== null
    )) {
      throw new ApplicationError(
        "ADMIN_APP_RESOURCE_ID_CONFLICT",
        409,
        `Authorization Resource '${resourceId}' is not owned by the Admin App projection.`,
      );
    }

    if (beforeRoot !== undefined && beforeRoot.realm_id !== targetRealmId) {
      const previousRows = await this.lockAdminAppResourceTree(client, resourceId, beforeRoot.realm_id);
      this.assertAdminAppResourceTree(app.id, previousRows);
      const previous = previousRows.map(resourceRecord);
      const policy = required(policyByRealm.get(beforeRoot.realm_id));
      await this.authorization.mutatePolicyInTransaction(client, {
        realmId: beforeRoot.realm_id,
        expectedRevision: Number(policy.current_revision),
        mutation: {
          type: "resource.reconcile",
          upserts: [],
          deleteIds: previousRows.map(({ id }) => id),
        },
        audit: resourceAudit(app.id, input, beforeRoot.realm_id, "remove", previous, null),
      });
    }

    const targetPolicy = required(policyByRealm.get(targetRealmId));
    const desired = adminAppAuthorizationResources(
      app.id,
      targetRealmId,
      manifest,
      required(targetPolicy.root_resource_id),
    );
    const desiredIds = desired.map(({ id }) => id);
    const lockedDesired = await client.query<AdminAppResourceRow>(
      `SELECT id, realm_id, name, resource_type, parent_id, protected, retired_at
         FROM ${this.q("_xecms_auth_resources")}
        WHERE id = ANY($1::text[])
        ORDER BY id
        FOR UPDATE`,
      [desiredIds],
    );
    const desiredById = new Map(desired.map((resource) => [resource.id, resource]));
    for (const row of lockedDesired.rows) {
      const expected = required(desiredById.get(row.id));
      if (
        row.realm_id !== targetRealmId
        || row.resource_type !== expected.type
        || row.parent_id !== (expected.parentId ?? null)
        || row.protected !== true
        || row.retired_at !== null
      ) {
        throw new ApplicationError(
          "ADMIN_APP_RESOURCE_ID_CONFLICT",
          409,
          `Authorization Resource '${row.id}' is not owned by the Admin App projection.`,
        );
      }
    }
    const beforeById = new Map(lockedDesired.rows.map((row) => [row.id, resourceRecord(row)]));
    const upserts = desired.filter((resource) => {
      const before = beforeById.get(resource.id);
      return before === undefined || !resourcesEqual(before, resource);
    });
    if (upserts.length === 0) return;
    await this.authorization.mutatePolicyInTransaction(client, {
      realmId: targetRealmId,
      expectedRevision: Number(targetPolicy.current_revision),
      mutation: { type: "resource.reconcile", upserts, deleteIds: [] },
      audit: resourceAudit(
        app.id,
        input,
        targetRealmId,
        "sync",
        lockedDesired.rows.map(resourceRecord),
        desired,
      ),
    });
  }

  private async lockAdminAppResourceTree(
    client: PoolClient,
    rootId: string,
    realmId: string,
  ): Promise<readonly AdminAppResourceRow[]> {
    const result = await client.query<AdminAppResourceRow>(
      `WITH RECURSIVE tree AS (
         SELECT id, realm_id, name, resource_type, parent_id, protected, retired_at, 0 AS depth
           FROM ${this.q("_xecms_auth_resources")}
          WHERE id = $1 AND realm_id = $2
         UNION ALL
         SELECT child.id, child.realm_id, child.name, child.resource_type, child.parent_id,
                child.protected, child.retired_at, tree.depth + 1
           FROM ${this.q("_xecms_auth_resources")} child
           JOIN tree ON child.parent_id = tree.id AND child.realm_id = tree.realm_id
       )
       SELECT id, realm_id, name, resource_type, parent_id, protected, retired_at
         FROM tree ORDER BY depth DESC, id FOR UPDATE`,
      [rootId, realmId],
    );
    return result.rows;
  }

  private assertAdminAppResourceTree(
    appId: string,
    rows: readonly AdminAppResourceRow[],
  ): void {
    const rootId = adminAppAuthorizationResourceId(appId);
    const root = rows.find((row) => row.id === rootId);
    const pages = new Set(
      rows.filter((row) => row.resource_type === "admin-app-page").map(({ id }) => id),
    );
    if (
      root === undefined
      || root.resource_type !== "admin-app"
      || rows.some((row) => (
        row.protected !== true
        || row.retired_at !== null
        || (row.id !== rootId && row.resource_type === "admin-app-page" && (
          !row.id.startsWith(`${rootId}:page:`) || row.parent_id !== rootId
        ))
        || (row.id !== rootId && row.resource_type === "admin-app-action" && (
          row.parent_id === null
          || !pages.has(row.parent_id)
          || !row.id.startsWith(`${row.parent_id}:action:`)
        ))
        || (row.id !== rootId
          && row.resource_type !== "admin-app-page"
          && row.resource_type !== "admin-app-action")
      ))
    ) {
      throw new ApplicationError(
        "ADMIN_APP_RESOURCE_ID_CONFLICT",
        409,
        `Authorization Resource '${rootId}' has an invalid projected subtree.`,
      );
    }
  }

  private async lockWorkspace(client: PoolClient, workspaceId: string): Promise<void> {
    const result = await client.query(
      `SELECT id FROM ${this.q("_xecms_workspaces")} WHERE id = $1 FOR UPDATE`,
      [workspaceId],
    );
    if (result.rowCount !== 1) {
      throw new ApplicationError("WORKSPACE_NOT_FOUND", 404, "The Workspace does not exist.");
    }
  }

  private async lockApp(
    client: PoolClient,
    workspaceId: string,
    appId: string,
  ): Promise<AdminAppRow> {
    const result = await client.query<AdminAppRow>(
      `SELECT * FROM ${this.q("_xecms_admin_apps")}
        WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, appId],
    );
    if (result.rows[0] === undefined) {
      throw new ApplicationError("ADMIN_APP_NOT_FOUND", 404, "The Admin App does not exist.");
    }
    return result.rows[0];
  }

  private async findDraft(
    client: PoolClient,
    workspaceId: string,
    appId: string,
    lock: boolean,
  ): Promise<AdminAppDraftRow | null> {
    const result = await client.query<AdminAppDraftRow>(
      `SELECT * FROM ${this.q("_xecms_admin_app_drafts")}
        WHERE workspace_id = $1 AND app_id = $2${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, appId],
    );
    return result.rows[0] ?? null;
  }

  private async findRevision(
    client: PoolClient,
    workspaceId: string,
    appId: string,
    revisionId: string,
  ): Promise<AdminAppRevisionRecord | null> {
    const result = await client.query<AdminAppRevisionRow>(
      `SELECT * FROM ${this.q("_xecms_admin_app_revisions")}
        WHERE workspace_id = $1 AND app_id = $2 AND revision_id = $3`,
      [workspaceId, appId, revisionId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const dependencies = await this.loadDependencies([revisionId], client);
    return mapRevision(row, dependencies.get(revisionId) ?? []);
  }

  private async assertRouteAvailable(
    client: PoolClient,
    workspaceId: string,
    key: string,
    appId: string,
  ): Promise<void> {
    const result = await client.query<{ id: string; source: string }>(
      `SELECT id, source FROM (
         SELECT id, 'active'::text AS source
           FROM ${this.q("_xecms_admin_apps")}
          WHERE workspace_id = $1 AND app_key = $2 AND id <> $3
         UNION ALL
         SELECT app_id AS id, 'draft'::text AS source
           FROM ${this.q("_xecms_admin_app_drafts")}
          WHERE workspace_id = $1 AND desired_key = $2 AND app_id <> $3
       ) conflict LIMIT 1`,
      [workspaceId, key, appId],
    );
    if (result.rows[0] !== undefined) {
      throw new ApplicationError(
        "ADMIN_APP_KEY_CONFLICT",
        409,
        `Admin App route key '${key}' is already reserved.`,
        { details: { key, conflictingAppId: result.rows[0].id, source: result.rows[0].source } },
      );
    }
  }

  private async loadDependencies(
    revisionIds: readonly string[],
    client: Pick<PoolClient, "query"> = this.pool,
  ): Promise<ReadonlyMap<string, readonly AdminAppDependencyRecord[]>> {
    if (revisionIds.length === 0) return new Map();
    const result = await client.query<AdminAppDependencyRow>(
      `SELECT * FROM ${this.q("_xecms_admin_app_dependencies")}
        WHERE revision_id = ANY($1::text[])
        ORDER BY revision_id, dependency_kind, dependency_id`,
      [revisionIds],
    );
    const grouped = new Map<string, AdminAppDependencyRecord[]>();
    for (const row of result.rows) {
      const values = grouped.get(row.revision_id) ?? [];
      values.push(mapDependency(row));
      grouped.set(row.revision_id, values);
    }
    return grouped;
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

interface AdminAppRow extends QueryResultRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly manifest_id: string;
  readonly app_key: string;
  readonly name: string;
  readonly audience_type: "system" | "content-realm";
  readonly audience_realm_id: string | null;
  readonly status: "active" | "archived";
  readonly active_revision_id: string | null;
  readonly route_version: string | number;
  readonly created_at: Date | string;
  readonly created_by_identity_id: string;
  readonly created_by_subject_id: string;
  readonly updated_at: Date | string;
  readonly updated_by_identity_id: string;
  readonly updated_by_subject_id: string;
  readonly archived_at: Date | string | null;
  readonly archived_by_identity_id: string | null;
  readonly archived_by_subject_id: string | null;
}

interface AdminAppResourceAuthor {
  readonly actorIdentityId: string;
  readonly actorSubjectId: string;
  readonly now: string;
}

interface AdminAppPolicyRow extends QueryResultRow {
  readonly realm_id: string;
  readonly current_revision: string | number;
  readonly root_resource_id: string | null;
}

interface AdminAppResourceRow extends QueryResultRow {
  readonly id: string;
  readonly realm_id: string;
  readonly name: string;
  readonly resource_type: string;
  readonly parent_id: string | null;
  readonly protected: boolean;
  readonly retired_at: Date | string | null;
}

interface AdminAppDraftRow extends QueryResultRow {
  readonly app_id: string;
  readonly workspace_id: string;
  readonly base_revision_id: string | null;
  readonly draft_version: string | number;
  readonly desired_key: string;
  readonly manifest_json: unknown;
  readonly manifest_hash: string;
  readonly created_at: Date | string;
  readonly created_by_identity_id: string;
  readonly created_by_subject_id: string;
  readonly updated_at: Date | string;
  readonly updated_by_identity_id: string;
  readonly updated_by_subject_id: string;
}

interface AdminAppRevisionRow extends QueryResultRow {
  readonly revision_id: string;
  readonly app_id: string;
  readonly workspace_id: string;
  readonly sequence: string | number;
  readonly parent_revision_id: string | null;
  readonly manifest_json: unknown;
  readonly manifest_hash: string;
  readonly created_at: Date | string;
  readonly created_by_identity_id: string;
  readonly created_by_subject_id: string;
}

interface AdminAppDependencyRow extends QueryResultRow {
  readonly revision_id: string;
  readonly dependency_kind: AdminAppDependencyKind;
  readonly dependency_id: string;
  readonly fingerprint: string | null;
  readonly metadata: unknown;
}

function mapApp(row: AdminAppRow): AdminAppRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    manifestId: row.manifest_id,
    key: row.app_key,
    name: row.name,
    audience: audienceFromColumns(row.audience_type, row.audience_realm_id),
    status: row.status,
    activeRevisionId: row.active_revision_id,
    routeVersion: safePositiveInteger(row.route_version, "route version"),
    createdAt: instant(row.created_at),
    createdByIdentityId: row.created_by_identity_id,
    createdBySubjectId: row.created_by_subject_id,
    updatedAt: instant(row.updated_at),
    updatedByIdentityId: row.updated_by_identity_id,
    updatedBySubjectId: row.updated_by_subject_id,
    ...(row.archived_at === null ? {} : {
      archivedAt: instant(row.archived_at),
      archivedByIdentityId: required(row.archived_by_identity_id),
      archivedBySubjectId: required(row.archived_by_subject_id),
    }),
  };
}

function mapDraft(row: AdminAppDraftRow): AdminAppDraftRecord {
  const canonical = storedManifest(row.manifest_json, row.manifest_hash);
  return {
    appId: row.app_id,
    workspaceId: row.workspace_id,
    baseRevisionId: row.base_revision_id,
    draftVersion: safePositiveInteger(row.draft_version, "draft version"),
    desiredKey: row.desired_key,
    manifest: canonical.manifest,
    manifestHash: canonical.hash,
    createdAt: instant(row.created_at),
    createdByIdentityId: row.created_by_identity_id,
    createdBySubjectId: row.created_by_subject_id,
    updatedAt: instant(row.updated_at),
    updatedByIdentityId: row.updated_by_identity_id,
    updatedBySubjectId: row.updated_by_subject_id,
  };
}

function mapRevision(
  row: AdminAppRevisionRow,
  dependencies: readonly AdminAppDependencyRecord[],
): AdminAppRevisionRecord {
  const canonical = storedManifest(row.manifest_json, row.manifest_hash);
  return {
    id: row.revision_id,
    appId: row.app_id,
    workspaceId: row.workspace_id,
    sequence: safePositiveInteger(row.sequence, "revision sequence"),
    parentRevisionId: row.parent_revision_id,
    manifest: canonical.manifest,
    manifestHash: canonical.hash,
    dependencies,
    createdAt: instant(row.created_at),
    createdByIdentityId: row.created_by_identity_id,
    createdBySubjectId: row.created_by_subject_id,
  };
}

function mapDependency(row: AdminAppDependencyRow): AdminAppDependencyRecord {
  return {
    kind: row.dependency_kind,
    id: row.dependency_id,
    ...(row.fingerprint === null ? {} : { fingerprint: row.fingerprint }),
    ...(isEmptyRecord(row.metadata) ? {} : { metadata: jsonRecord(row.metadata) }),
  };
}

function resourceRecord(row: AdminAppResourceRow): AuthorizationResourceRecord {
  return {
    id: row.id,
    realmId: row.realm_id,
    name: row.name,
    type: row.resource_type,
    ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
    ...(row.protected ? { protected: true } : {}),
  };
}

function resourcesEqual(
  left: AuthorizationResourceRecord,
  right: AuthorizationResourceRecord,
): boolean {
  return left.id === right.id
    && left.realmId === right.realmId
    && left.name === right.name
    && left.type === right.type
    && left.parentId === right.parentId
    && left.protected === right.protected;
}

function resourceAudit(
  appId: string,
  input: AdminAppResourceAuthor & { readonly nextRouteVersion: number },
  realmId: string,
  operation: "sync" | "remove",
  before: unknown | null,
  after: unknown | null,
): AuthorizationAuditDraft {
  const digest = createHash("sha256")
    .update(appId)
    .update("\0")
    .update(String(input.nextRouteVersion))
    .update("\0")
    .update(realmId)
    .update("\0")
    .update(operation)
    .digest("hex")
    .slice(0, 32);
  return {
    id: `audit_admin_app_resource_${digest}`,
    // Forward BOTH actors: the audit CHECK requires at least one, and a
    // content-realm App is applied by a Realm Subject (identity may be absent).
    actorIdentityId: input.actorIdentityId,
    actorSubjectId: input.actorSubjectId,
    action: `admin-app.resource.${operation}`,
    targetType: "resource",
    targetId: adminAppAuthorizationResourceId(appId),
    // audit_log.before_state/after_state require a JSON object (or null); the
    // resource projection is an array, so wrap it under `resources`.
    before: wrapResourceState(before),
    after: wrapResourceState(after),
    decision: null,
    occurredAt: input.now,
  };
}

/** Wraps an array resource-projection into `{ resources: [...] }` (object CHECK). */
function wrapResourceState(value: unknown | null): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? { resources: value } : (value as Record<string, unknown>);
}

function canonicalManifest(manifest: AdminAppManifest): {
  readonly manifest: AdminAppManifest;
  readonly serialized: string;
  readonly hash: string;
} {
  const decoded = decodeAdminAppManifestAny(manifest);
  const serialized = serializeManifestValue(decoded);
  return { manifest: decoded, serialized, hash: sha256(serialized) };
}

function storedManifest(input: unknown, expectedHash: string): {
  readonly manifest: AdminAppManifest;
  readonly hash: string;
} {
  const canonical = canonicalManifest(decodeAdminAppManifestAny(input));
  if (canonical.hash !== expectedHash) {
    integrity("Stored Admin App Manifest hash does not match its canonical contents.");
  }
  return { manifest: canonical.manifest, hash: canonical.hash };
}

function normalizeDependencies(
  values: readonly AdminAppDependencyRecord[],
): readonly AdminAppDependencyRecord[] {
  const unique = new Set<string>();
  return values.map((value) => {
    if (value.id.trim().length === 0 || value.id.length > 512) {
      throw new ApplicationError(
        "ADMIN_APP_DEPENDENCY_INVALID",
        422,
        "Admin App dependency IDs must contain 1-512 characters.",
      );
    }
    const key = `${value.kind}\0${value.id}`;
    if (unique.has(key)) {
      throw new ApplicationError(
        "ADMIN_APP_DEPENDENCY_DUPLICATE",
        422,
        `Admin App dependency '${value.kind}:${value.id}' is duplicated.`,
      );
    }
    unique.add(key);
    const metadata = value.metadata === undefined ? undefined : jsonRecord(value.metadata);
    JSON.stringify(metadata ?? {});
    return {
      kind: value.kind,
      id: value.id,
      ...(value.fingerprint === undefined ? {} : { fingerprint: value.fingerprint }),
      ...(metadata === undefined ? {} : { metadata }),
    };
  }).sort((left, right) => compareText(left.kind, right.kind) || compareText(left.id, right.id));
}

function assertManifestId(app: AdminAppRow, manifest: AdminAppManifest): void {
  if (app.manifest_id !== manifest.id) {
    throw new ApplicationError(
      "ADMIN_APP_MANIFEST_ID_IMMUTABLE",
      409,
      "An existing Admin App cannot change its Manifest ID.",
      { details: { expectedManifestId: app.manifest_id, actualManifestId: manifest.id } },
    );
  }
}

function assertAppEditable(app: AdminAppRow): void {
  if (app.status !== "active") {
    throw new ApplicationError("ADMIN_APP_ARCHIVED", 409, "An archived Admin App cannot be edited.");
  }
}

function assertRouteVersion(app: AdminAppRow, expected: number): void {
  const actual = safePositiveInteger(app.route_version, "route version");
  if (actual !== expected) {
    throw new ApplicationError(
      "ADMIN_APP_ROUTE_CONFLICT",
      409,
      "The Admin App route changed after it was loaded.",
      { details: { expectedRouteVersion: expected, actualRouteVersion: actual } },
    );
  }
}

function assertActiveRevision(app: AdminAppRow, expected: string | null): void {
  if (app.active_revision_id !== expected) throw revisionConflict(expected, app.active_revision_id);
}

function assertDraftVersion(draft: AdminAppDraftRecord, expected: number): void {
  if (draft.draftVersion !== expected) {
    throw new ApplicationError(
      "ADMIN_APP_DRAFT_CONFLICT",
      409,
      "The Admin App Draft was changed by another editor.",
      { details: { expectedDraftVersion: expected, actualDraftVersion: draft.draftVersion } },
    );
  }
}

function revisionConflict(expected: string | null, actual: string | null): ApplicationError {
  return new ApplicationError(
    "ADMIN_APP_REVISION_CONFLICT",
    409,
    "The active Admin App revision changed after the Draft was created.",
    { details: { expectedRevisionId: expected, actualRevisionId: actual } },
  );
}

function audienceColumns(audience: AdminAppAudience): {
  readonly type: AdminAppAudience["type"];
  readonly realmId: string | null;
} {
  return audience.type === "system"
    ? { type: "system", realmId: null }
    : { type: "content-realm", realmId: audience.realmId };
}

function audienceFromColumns(
  type: "system" | "content-realm",
  realmId: string | null,
): AdminAppAudience {
  if (type === "system") {
    if (realmId !== null) integrity("System Admin App audience unexpectedly has a Realm ID.");
    return { type: "system" };
  }
  if (realmId === null) integrity("Content Admin App audience is missing its Realm ID.");
  return { type: "content-realm", realmId };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safePositiveInteger(value: string | number | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) integrity(`Stored ${label} is invalid.`);
  return parsed;
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError(
      "ADMIN_APP_DEPENDENCY_INVALID",
      422,
      "Admin App dependency metadata must be a JSON object.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function isEmptyRecord(value: unknown): boolean {
  return Object.keys(jsonRecord(value)).length === 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) integrity("Required Admin App storage data is missing.");
  return value;
}

function integrity(message: string): never {
  throw new ApplicationError("ADMIN_APP_STORAGE_INTEGRITY", 500, message);
}

interface PostgresLikeError {
  readonly code?: string;
  readonly constraint?: string;
}

function mapAdminAppDatabaseError(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  const postgres = error as PostgresLikeError;
  if (postgres.code === "23505") {
    if (postgres.constraint?.includes("manifest_id") === true) {
      return new ApplicationError(
        "ADMIN_APP_MANIFEST_ID_CONFLICT",
        409,
        "That Admin App Manifest ID already exists in this Workspace.",
      );
    }
    if (postgres.constraint?.includes("app_key") === true ||
        postgres.constraint?.includes("desired_key") === true) {
      return new ApplicationError(
        "ADMIN_APP_KEY_CONFLICT",
        409,
        "That Admin App route key is already reserved in this Workspace.",
      );
    }
    return new ApplicationError(
      "ADMIN_APP_STORAGE_CONFLICT",
      409,
      "The Admin App changed concurrently or uses a duplicate identifier.",
    );
  }
  if (postgres.code === "23503" || postgres.code === "23514" || postgres.code === "22P02") {
    return new ApplicationError(
      "ADMIN_APP_STORAGE_CONSTRAINT",
      422,
      "Admin App storage constraints rejected the operation.",
    );
  }
  return error;
}
