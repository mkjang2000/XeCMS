import { randomUUID } from "node:crypto";
import {
  ApplicationError,
  SYSTEM_AUTHORIZATION_REALM_ID,
  SYSTEM_CONTENT_RESOURCE_ID,
  SYSTEM_WORKSPACE_RESOURCE_ID,
  collectionResourceId,
  type SiteRecord,
  type SiteStore,
} from "@xecms/application";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export class PostgresSiteStore implements SiteStore {
  private readonly schema: string;

  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async list(workspaceId: string): Promise<readonly SiteRecord[]> {
    const result = await this.pool.query<SiteRow>(
      `${siteSelect(this.q.bind(this))}
       WHERE site.workspace_id = $1
       ORDER BY site.is_default DESC, site.name, site.id`,
      [workspaceId],
    );
    return result.rows.map(mapSite);
  }

  public async get(siteId: string, workspaceId: string): Promise<SiteRecord | null> {
    const result = await this.pool.query<SiteRow>(
      `${siteSelect(this.q.bind(this))} WHERE site.id = $1 AND site.workspace_id = $2`,
      [siteId, workspaceId],
    );
    return result.rows[0] === undefined ? null : mapSite(result.rows[0]);
  }

  public async create(input: {
    readonly id: string; readonly workspaceId: string; readonly key: string; readonly name: string;
    readonly canonicalUrl?: string; readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string;
  }): Promise<SiteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const workspace = await client.query(
        `SELECT id FROM ${this.q("_xecms_workspaces")} WHERE id = $1 FOR UPDATE`,
        [input.workspaceId],
      );
      if (workspace.rowCount !== 1) {
        throw new ApplicationError("WORKSPACE_NOT_FOUND", 404, "The Workspace does not exist.");
      }
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM ${this.q("_xecms_sites")} WHERE workspace_id = $1`,
        [input.workspaceId],
      );
      const isDefault = Number(count.rows[0]!.count) === 0;
      await client.query(
        `INSERT INTO ${this.q("_xecms_sites")}
           (id, workspace_id, site_key, name, canonical_url, status, is_default, revision,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, 1, $7, $8, $7, $8)`,
        [input.id, input.workspaceId, input.key, input.name, input.canonicalUrl ?? null,
          isDefault, input.now, input.actorIdentityId],
      );
      await client.query(
        `INSERT INTO ${this.q("_xecms_auth_resources")}
           (id, realm_id, name, resource_type, parent_id, external_type, external_id, protected,
            attributes, created_at, created_by, updated_at, updated_by)
         VALUES ($1, $2, $3, 'site', $4, 'site', $5, false, '{}'::jsonb, $6, $7, $6, $7)`,
        [siteResourceId(input.id), SYSTEM_AUTHORIZATION_REALM_ID, input.name,
          SYSTEM_WORKSPACE_RESOURCE_ID, input.id, input.now, input.actorSubjectId],
      );
      await this.finishPolicy(client, {
        workspaceId: input.workspaceId,
        actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId,
        action: "site.create",
        targetId: siteResourceId(input.id),
        before: null,
        after: { name: input.name, parentId: SYSTEM_WORKSPACE_RESOURCE_ID },
        now: input.now,
      });
      await this.auditSite(client, {
        event: "site.created", workspaceId: input.workspaceId, siteId: input.id, siteRevision: 1,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        now: input.now, metadata: { siteId: input.id, key: input.key, isDefault },
      });
      await client.query("COMMIT");
      return (await this.get(input.id, input.workspaceId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async update(input: {
    readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly name: string; readonly canonicalUrl?: string; readonly actorIdentityId: string;
    readonly actorSubjectId: string; readonly now: string;
  }): Promise<SiteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await this.lockSite(client, input.siteId, input.workspaceId);
      assertRevision(previous, input.expectedRevision);
      await client.query(
        `UPDATE ${this.q("_xecms_sites")}
            SET name = $3, canonical_url = $4, revision = revision + 1,
                updated_at = $5, updated_by = $6
          WHERE id = $1 AND workspace_id = $2`,
        [input.siteId, input.workspaceId, input.name, input.canonicalUrl ?? null,
          input.now, input.actorIdentityId],
      );
      if (previous.name !== input.name) {
        await client.query(
          `UPDATE ${this.q("_xecms_auth_resources")}
              SET name = $3, updated_at = $4, updated_by = $5
            WHERE realm_id = $1 AND id = $2`,
          [SYSTEM_AUTHORIZATION_REALM_ID, siteResourceId(input.siteId), input.name,
            input.now, input.actorSubjectId],
        );
        await this.finishPolicy(client, {
          workspaceId: input.workspaceId,
          actorIdentityId: input.actorIdentityId,
          actorSubjectId: input.actorSubjectId,
          action: "site.update",
          targetId: siteResourceId(input.siteId),
          before: { name: previous.name },
          after: { name: input.name },
          now: input.now,
        });
      }
      await this.auditSite(client, {
        event: "site.updated", workspaceId: input.workspaceId, siteId: input.siteId,
        siteRevision: input.expectedRevision + 1, actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId, now: input.now,
        metadata: { siteId: input.siteId },
      });
      await client.query("COMMIT");
      return (await this.get(input.siteId, input.workspaceId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async setArchived(input: {
    readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly archived: boolean; readonly replacementDefaultSiteId?: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string;
  }): Promise<SiteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const site = await this.lockSite(client, input.siteId, input.workspaceId);
      assertRevision(site, input.expectedRevision);
      if ((site.status === "archived") === input.archived) {
        throw new ApplicationError("SITE_STATUS_UNCHANGED", 409, "The Site already has the requested status.");
      }
      let replacement: LockedSiteRow | undefined;
      if (input.archived && site.is_default) {
        if (input.replacementDefaultSiteId === undefined) {
          throw new ApplicationError(
            "SITE_DEFAULT_REPLACEMENT_REQUIRED", 409,
            "Archiving the default Site requires an active replacement.",
          );
        }
        replacement = await this.lockSite(client, input.replacementDefaultSiteId, input.workspaceId);
        if (replacement.status !== "active" || replacement.id === site.id) {
          throw new ApplicationError(
            "SITE_DEFAULT_REPLACEMENT_INVALID", 409, "The replacement default Site is invalid.",
          );
        }
      }
      await client.query(
        `UPDATE ${this.q("_xecms_sites")}
            SET status = $3, archived_at = $4,
                is_default = CASE WHEN $3 = 'archived' THEN false ELSE is_default END,
                revision = revision + 1, updated_at = $5, updated_by = $6
          WHERE id = $1 AND workspace_id = $2`,
        [input.siteId, input.workspaceId, input.archived ? "archived" : "active",
          input.archived ? input.now : null, input.now, input.actorIdentityId],
      );
      if (replacement !== undefined) {
        await client.query(
          `UPDATE ${this.q("_xecms_sites")}
              SET is_default = true, revision = revision + 1, updated_at = $2, updated_by = $3
            WHERE id = $1`,
          [replacement.id, input.now, input.actorIdentityId],
        );
      }
      const event = input.archived ? "site.archived" : "site.reactivated";
      await this.auditSite(client, {
        event, workspaceId: input.workspaceId, siteId: input.siteId,
        siteRevision: input.expectedRevision + 1, actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId, now: input.now,
        metadata: { siteId: input.siteId, replacementDefaultSiteId: input.replacementDefaultSiteId },
      });
      await client.query("COMMIT");
      return (await this.get(input.siteId, input.workspaceId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async setDefault(input: {
    readonly siteId: string; readonly workspaceId: string; readonly expectedRevision: number;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string;
  }): Promise<SiteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const site = await this.lockSite(client, input.siteId, input.workspaceId);
      assertRevision(site, input.expectedRevision);
      if (site.status !== "active") {
        throw new ApplicationError("SITE_DEFAULT_INACTIVE", 409, "An archived Site cannot be default.");
      }
      if (site.is_default) {
        throw new ApplicationError("SITE_DEFAULT_UNCHANGED", 409, "The Site is already default.");
      }
      await client.query(
        `UPDATE ${this.q("_xecms_sites")}
            SET is_default = false, revision = revision + 1, updated_at = $2, updated_by = $3
          WHERE workspace_id = $1 AND is_default`,
        [input.workspaceId, input.now, input.actorIdentityId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_sites")}
            SET is_default = true, revision = revision + 1, updated_at = $3, updated_by = $4
          WHERE id = $1 AND workspace_id = $2`,
        [input.siteId, input.workspaceId, input.now, input.actorIdentityId],
      );
      await this.auditSite(client, {
        event: "site.default.changed", workspaceId: input.workspaceId, siteId: input.siteId,
        siteRevision: input.expectedRevision + 1, actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId, now: input.now,
        metadata: { siteId: input.siteId },
      });
      await client.query("COMMIT");
      return (await this.get(input.siteId, input.workspaceId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public bindCollection(input: BindingInput): Promise<SiteRecord> {
    return this.setCollectionBinding(input, false);
  }

  public unbindCollection(input: BindingInput): Promise<SiteRecord> {
    return this.setCollectionBinding(input, true);
  }

  public async assertCollectionWritable(workspaceId: string, collectionId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT 1
         FROM ${this.q("_xecms_collection_sites")} binding
         JOIN ${this.q("_xecms_sites")} site ON site.id = binding.site_id
        WHERE binding.workspace_id = $1 AND binding.collection_id = $2 AND site.status = 'archived'`,
      [workspaceId, collectionId],
    );
    if (result.rowCount !== 0) {
      throw new ApplicationError(
        "SITE_ARCHIVED", 423,
        "Content mutations are locked because the Collection belongs to an archived Site.",
      );
    }
  }

  private async setCollectionBinding(input: BindingInput, remove: boolean): Promise<SiteRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const site = await this.lockSite(client, input.siteId, input.workspaceId);
      assertRevision(site, input.expectedSiteRevision);
      if (site.status !== "active") {
        throw new ApplicationError("SITE_ARCHIVED", 409, "Archived Sites cannot change Collection bindings.");
      }
      const policy = await client.query<{ current_revision: string | number }>(
        `SELECT current_revision FROM ${this.q("_xecms_auth_policy_state")}
          WHERE realm_id = $1 FOR UPDATE`,
        [SYSTEM_AUTHORIZATION_REALM_ID],
      );
      const actualPolicyRevision = Number(policy.rows[0]?.current_revision);
      if (actualPolicyRevision !== input.expectedPolicyRevision) {
        throw new ApplicationError(
          "AUTHORIZATION_POLICY_REVISION_CONFLICT", 409,
          "The authorization policy changed after it was read.",
          { details: { expectedRevision: input.expectedPolicyRevision, actualRevision: actualPolicyRevision } },
        );
      }
      const resource = await client.query(
        `SELECT 1 FROM ${this.q("_xecms_auth_resources")}
          WHERE realm_id = $1 AND id = $2 AND resource_type = 'collection'`,
        [SYSTEM_AUTHORIZATION_REALM_ID, collectionResourceId(input.collectionId)],
      );
      if (resource.rowCount !== 1) {
        throw new ApplicationError("SITE_COLLECTION_NOT_FOUND", 404, "The Collection resource does not exist.");
      }

      let previousSiteId: string | undefined;
      if (remove) {
        const deleted = await client.query(
          `DELETE FROM ${this.q("_xecms_collection_sites")}
            WHERE workspace_id = $1 AND collection_id = $2 AND site_id = $3`,
          [input.workspaceId, input.collectionId, input.siteId],
        );
        if (deleted.rowCount !== 1) {
          throw new ApplicationError(
            "SITE_COLLECTION_BINDING_NOT_FOUND", 404, "The Collection binding does not exist.",
          );
        }
      } else {
        const current = await client.query<{ site_id: string }>(
          `SELECT site_id FROM ${this.q("_xecms_collection_sites")}
            WHERE workspace_id = $1 AND collection_id = $2 FOR UPDATE`,
          [input.workspaceId, input.collectionId],
        );
        previousSiteId = current.rows[0]?.site_id;
        await client.query(
          `INSERT INTO ${this.q("_xecms_collection_sites")}
             (workspace_id, collection_id, site_id, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, collection_id) DO UPDATE
             SET site_id = EXCLUDED.site_id, created_at = EXCLUDED.created_at, created_by = EXCLUDED.created_by`,
          [input.workspaceId, input.collectionId, input.siteId, input.now, input.actorIdentityId],
        );
      }

      const parentId = remove ? SYSTEM_CONTENT_RESOURCE_ID : siteResourceId(input.siteId);
      await client.query(
        `UPDATE ${this.q("_xecms_auth_resources")}
            SET parent_id = $3, updated_at = $4, updated_by = $5
          WHERE realm_id = $1 AND id = $2`,
        [SYSTEM_AUTHORIZATION_REALM_ID, collectionResourceId(input.collectionId), parentId,
          input.now, input.actorSubjectId],
      );
      await client.query(
        `UPDATE ${this.q("_xecms_sites")}
            SET revision = revision + 1, updated_at = $3, updated_by = $4
          WHERE id = $1 AND workspace_id = $2`,
        [input.siteId, input.workspaceId, input.now, input.actorIdentityId],
      );
      if (previousSiteId !== undefined && previousSiteId !== input.siteId) {
        await client.query(
          `UPDATE ${this.q("_xecms_sites")}
              SET revision = revision + 1, updated_at = $3, updated_by = $4
            WHERE id = $1 AND workspace_id = $2`,
          [previousSiteId, input.workspaceId, input.now, input.actorIdentityId],
        );
      }
      const event = remove ? "site.collection.unbound" : "site.collection.bound";
      await this.finishPolicy(client, {
        workspaceId: input.workspaceId,
        actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId,
        action: remove ? "site.collection.unbind" : "site.collection.bind",
        targetId: collectionResourceId(input.collectionId),
        before: { parentId: remove ? siteResourceId(input.siteId) :
          (previousSiteId === undefined ? SYSTEM_CONTENT_RESOURCE_ID : siteResourceId(previousSiteId)) },
        after: { parentId },
        now: input.now,
        lockedPolicyRevision: actualPolicyRevision,
      });
      await this.auditSite(client, {
        event, workspaceId: input.workspaceId, siteId: input.siteId,
        siteRevision: input.expectedSiteRevision + 1, actorIdentityId: input.actorIdentityId,
        actorSubjectId: input.actorSubjectId, now: input.now,
        metadata: { siteId: input.siteId, collectionId: input.collectionId, previousSiteId },
      });
      await client.query("COMMIT");
      return (await this.get(input.siteId, input.workspaceId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  public async reconcileCollections(input: {
    readonly workspaceId: string; readonly activeCollectionIds: readonly string[];
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stale = await client.query<{ site_id: string; collection_id: string }>(
        `SELECT site_id, collection_id FROM ${this.q("_xecms_collection_sites")}
          WHERE workspace_id = $1 AND NOT (collection_id = ANY($2::text[])) FOR UPDATE`,
        [input.workspaceId, [...input.activeCollectionIds]],
      );
      if (stale.rowCount === 0) {
        await client.query("COMMIT");
        return;
      }
      await client.query(
        `DELETE FROM ${this.q("_xecms_collection_sites")}
          WHERE workspace_id = $1 AND NOT (collection_id = ANY($2::text[]))`,
        [input.workspaceId, [...input.activeCollectionIds]],
      );
      for (const siteId of new Set(stale.rows.map(({ site_id }) => site_id))) {
        const revision = await client.query<{ revision: string | number }>(
          `UPDATE ${this.q("_xecms_sites")}
              SET revision = revision + 1, updated_at = $3, updated_by = $4
            WHERE id = $1 AND workspace_id = $2 RETURNING revision`,
          [siteId, input.workspaceId, input.now, input.actorIdentityId],
        );
        await this.auditSite(client, {
          event: "site.collection.reconciled", workspaceId: input.workspaceId, siteId,
          siteRevision: Number(revision.rows[0]!.revision), actorIdentityId: input.actorIdentityId,
          actorSubjectId: input.actorSubjectId, now: input.now,
          metadata: {
            siteId,
            removedCollectionIds: stale.rows
              .filter(({ site_id }) => site_id === siteId)
              .map(({ collection_id }) => collection_id),
          },
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }

  private async lockSite(client: PoolClient, id: string, workspaceId: string): Promise<LockedSiteRow> {
    const result = await client.query<LockedSiteRow>(
      `SELECT id, name, status, is_default, revision
         FROM ${this.q("_xecms_sites")}
        WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [id, workspaceId],
    );
    if (result.rows[0] === undefined) {
      throw new ApplicationError("SITE_NOT_FOUND", 404, "The Site does not exist.");
    }
    return result.rows[0];
  }

  private async finishPolicy(client: PoolClient, input: PolicyEventInput): Promise<void> {
    let currentRevision = input.lockedPolicyRevision;
    if (currentRevision === undefined) {
      const state = await client.query<{ current_revision: string | number }>(
        `SELECT current_revision FROM ${this.q("_xecms_auth_policy_state")}
          WHERE realm_id = $1 FOR UPDATE`,
        [SYSTEM_AUTHORIZATION_REALM_ID],
      );
      currentRevision = Number(state.rows[0]?.current_revision);
    }
    const revision = currentRevision + 1;
    if (!Number.isSafeInteger(revision) || revision < 2) {
      throw new ApplicationError(
        "AUTHORIZATION_NOT_INITIALIZED", 503, "Authorization policy is unavailable.",
      );
    }
    await client.query(
      `DELETE FROM ${this.q("_xecms_auth_resource_ancestors")} WHERE realm_id = $1`,
      [SYSTEM_AUTHORIZATION_REALM_ID],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_resource_ancestors")}
         (realm_id, ancestor_resource_id, descendant_resource_id, depth)
       WITH RECURSIVE paths(realm_id, ancestor_id, descendant_id, depth) AS (
         SELECT realm_id, id, id, 0
           FROM ${this.q("_xecms_auth_resources")} WHERE realm_id = $1
         UNION ALL
         SELECT paths.realm_id, paths.ancestor_id, child.id, paths.depth + 1
           FROM paths
           JOIN ${this.q("_xecms_auth_resources")} child
             ON child.realm_id = paths.realm_id AND child.parent_id = paths.descendant_id
       )
       SELECT realm_id, ancestor_id, descendant_id, depth FROM paths`,
      [SYSTEM_AUTHORIZATION_REALM_ID],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_policy_revisions")}
         (realm_id, revision, actor_subject_id, change_kind, target_type, target_id, occurred_at)
       VALUES ($1, $2, $3, $4, 'resource', $5, $6)`,
      [SYSTEM_AUTHORIZATION_REALM_ID, revision, input.actorSubjectId, input.action,
        input.targetId, input.now],
    );
    const auditId = `audit_${randomUUID()}`;
    await client.query(
      `INSERT INTO ${this.q("_xecms_auth_audit_log")}
         (id, realm_id, policy_revision, actor_subject_id, action, target_type, target_id,
          before_state, after_state, decision, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'resource', $6, $7::jsonb, $8::jsonb, NULL, $9)`,
      [auditId, SYSTEM_AUTHORIZATION_REALM_ID, revision, input.actorSubjectId, input.action,
        input.targetId, nullableJson(input.before), nullableJson(input.after), input.now],
    );
    await client.query(
      `UPDATE ${this.q("_xecms_auth_policy_state")}
          SET current_revision = $2, updated_at = $3 WHERE realm_id = $1`,
      [SYSTEM_AUTHORIZATION_REALM_ID, revision, input.now],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id, aggregate_version,
          actor_subject_id, actor_identity_id, occurred_at, payload, created_at)
       VALUES ($1, $2, $3, $4, 'authorization', $5, $6, $7, $8, $9, $10::jsonb, $9)`,
      [`outbox_authorization_${auditId}`, input.workspaceId, SYSTEM_AUTHORIZATION_REALM_ID,
        `authorization.${input.action}`, input.targetId, revision, input.actorSubjectId,
        input.actorIdentityId, input.now, JSON.stringify({ before: input.before, after: input.after })],
    );
  }

  private async auditSite(client: PoolClient, input: SiteEventInput): Promise<void> {
    const audit = await client.query<{ id: string | number }>(
      `INSERT INTO ${this.q("_xecms_audit_log")}
         (event_type, identity_id, occurred_at, metadata)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [input.event, input.actorIdentityId, input.now, JSON.stringify(input.metadata)],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id, aggregate_version,
          actor_subject_id, actor_identity_id, occurred_at, payload, created_at)
       VALUES ($1, $2, $3, $4, 'site', $5, $6, $7, $8, $9, $10::jsonb, $9)`,
      [`outbox_site_${audit.rows[0]!.id}`, input.workspaceId, SYSTEM_AUTHORIZATION_REALM_ID,
        input.event, input.siteId, input.siteRevision, input.actorSubjectId,
        input.actorIdentityId, input.now, JSON.stringify(input.metadata)],
    );
  }

  private q(name: string): string {
    return qualifiedName(this.schema, name);
  }
}

interface BindingInput {
  readonly siteId: string; readonly workspaceId: string; readonly collectionId: string;
  readonly expectedSiteRevision: number; readonly expectedPolicyRevision: number;
  readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string;
}

interface PolicyEventInput {
  readonly workspaceId: string; readonly actorIdentityId: string; readonly actorSubjectId: string;
  readonly action: string; readonly targetId: string; readonly before: unknown; readonly after: unknown;
  readonly now: string; readonly lockedPolicyRevision?: number;
}

interface SiteEventInput {
  readonly event: string; readonly workspaceId: string; readonly siteId: string;
  readonly siteRevision: number; readonly actorIdentityId: string; readonly actorSubjectId: string;
  readonly now: string; readonly metadata: Readonly<Record<string, unknown>>;
}

function siteSelect(q: (name: string) => string): string {
  return `SELECT site.id, site.workspace_id, site.site_key, site.name, site.canonical_url,
    site.status, site.is_default, site.revision, site.created_at, site.created_by,
    site.updated_at, site.updated_by, site.archived_at,
    COALESCE((SELECT array_agg(binding.collection_id ORDER BY binding.collection_id)
      FROM ${q("_xecms_collection_sites")} binding WHERE binding.site_id = site.id),
      '{}'::text[]) AS collection_ids
    FROM ${q("_xecms_sites")} site`;
}

interface SiteRow extends QueryResultRow {
  readonly id: string; readonly workspace_id: string; readonly site_key: string;
  readonly name: string; readonly canonical_url: string | null;
  readonly status: "active" | "archived"; readonly is_default: boolean;
  readonly revision: string | number; readonly created_at: Date | string; readonly created_by: string;
  readonly updated_at: Date | string; readonly updated_by: string;
  readonly archived_at: Date | string | null; readonly collection_ids: string[];
}

interface LockedSiteRow extends QueryResultRow {
  readonly id: string; readonly name: string; readonly status: "active" | "archived";
  readonly is_default: boolean; readonly revision: string | number;
}

function mapSite(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.site_key,
    name: row.name,
    ...(row.canonical_url === null ? {} : { canonicalUrl: row.canonical_url }),
    status: row.status,
    isDefault: row.is_default,
    revision: Number(row.revision),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
    ...(row.archived_at === null ? {} : { archivedAt: new Date(row.archived_at).toISOString() }),
    collectionIds: row.collection_ids,
  };
}

function assertRevision(row: LockedSiteRow, expectedRevision: number): void {
  const actualRevision = Number(row.revision);
  if (actualRevision !== expectedRevision) {
    throw new ApplicationError(
      "SITE_REVISION_CONFLICT", 409, "The Site changed after it was read.",
      { details: { expectedRevision, actualRevision } },
    );
  }
}

function siteResourceId(siteId: string): string {
  return `resource:site:${siteId}`;
}

function nullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof ApplicationError) return error;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    return new ApplicationError("SITE_CONFLICT", 409, "The Site key or default conflicts with existing state.");
  }
  return error;
}
