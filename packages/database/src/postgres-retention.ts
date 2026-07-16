import {
  ApplicationError,
  SYSTEM_AUTHORIZATION_REALM_ID,
  type RetentionCounts,
  type RetentionCutoffs,
  type RetentionPlan,
  type RetentionPolicy,
  type RetentionStore,
} from "@xecms/application";
import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

const COUNT_KEYS = [
  "systemAudit", "documentAudit", "authorizationAudit", "dispatchedOutbox",
  "succeededDeliveries", "deadDeliveries", "expiredSessions", "softDeletedDocuments",
] as const;

export class PostgresRetentionStore implements RetentionStore {
  private readonly schema: string;

  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async getPolicy(workspaceId: string): Promise<RetentionPolicy | null> {
    const result = await this.pool.query<PolicyRow>(
      `SELECT * FROM ${this.q("_xecms_retention_policies")} WHERE workspace_id = $1`,
      [workspaceId],
    );
    return result.rows[0] === undefined ? null : mapPolicy(result.rows[0]);
  }

  public async updatePolicy(input: Parameters<RetentionStore["updatePolicy"]>[0]): Promise<RetentionPolicy> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await this.lockPolicy(client, input.workspaceId);
      assertPolicyRevision(previous, input.expectedRevision);
      const result = await client.query<PolicyRow>(
        `UPDATE ${this.q("_xecms_retention_policies")}
            SET audit_days = $3, dispatched_outbox_days = $4, succeeded_delivery_days = $5,
                dead_delivery_days = $6, expired_session_days = $7,
                soft_deleted_document_days = $8, revision = revision + 1,
                updated_at = $9, updated_by = $10
          WHERE workspace_id = $1 AND revision = $2
          RETURNING *`,
        [input.workspaceId, input.expectedRevision, input.auditDays, input.dispatchedOutboxDays,
          input.succeededDeliveryDays, input.deadDeliveryDays, input.expiredSessionDays,
          input.softDeletedDocumentDays, input.now, input.actorIdentityId],
      );
      const policy = mapPolicy(result.rows[0]!);
      await this.audit(client, {
        eventType: "retention.policy.updated", workspaceId: input.workspaceId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        aggregateVersion: policy.revision, now: input.now,
        metadata: { before: policyValues(mapPolicy(previous)), after: policyValues(policy) },
      });
      await client.query("COMMIT");
      return policy;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async createPlan(input: Parameters<RetentionStore["createPlan"]>[0]): Promise<RetentionPlan> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const policy = await this.lockPolicy(client, input.workspaceId);
      assertPolicyRevision(policy, input.expectedPolicyRevision);
      const snapshot = await this.measure(client, input.workspaceId, input.cutoffs, input.referenceAt);
      const digest = planDigest(input.digestSeed, snapshot.candidateDigest);
      const result = await client.query<PlanRow>(
        `INSERT INTO ${this.q("_xecms_retention_plans")}
           (id, workspace_id, policy_revision, status, reference_at, cutoffs, counts,
            estimated_bytes, digest, created_at, created_by, expires_at)
         VALUES ($1, $2, $3, 'previewed', $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
         RETURNING *`,
        [input.id, input.workspaceId, input.expectedPolicyRevision, input.referenceAt,
          JSON.stringify(input.cutoffs), JSON.stringify(snapshot.counts),
          JSON.stringify(snapshot.estimatedBytes), digest, input.createdAt, input.createdBy,
          input.expiresAt],
      );
      await client.query("COMMIT");
      return mapPlan(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getPlan(workspaceId: string, planId: string): Promise<RetentionPlan | null> {
    const result = await this.pool.query<PlanRow>(
      `SELECT * FROM ${this.q("_xecms_retention_plans")} WHERE id = $1 AND workspace_id = $2`,
      [planId, workspaceId],
    );
    return result.rows[0] === undefined ? null : mapPlan(result.rows[0]);
  }

  public async applyPlan(input: Parameters<RetentionStore["applyPlan"]>[0]): Promise<RetentionPlan> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const planResult = await client.query<PlanRow>(
        `SELECT * FROM ${this.q("_xecms_retention_plans")}
          WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [input.planId, input.workspaceId],
      );
      const planRow = planResult.rows[0];
      if (planRow === undefined) {
        throw new ApplicationError("RETENTION_PLAN_NOT_FOUND", 404, "Retention plan does not exist.");
      }
      const plan = mapPlan(planRow);
      if (plan.status === "applied") {
        await client.query("COMMIT");
        return plan;
      }
      if (Date.parse(plan.expiresAt) <= Date.parse(input.now)) {
        throw new ApplicationError("RETENTION_PLAN_EXPIRED", 409, "Retention plan has expired.");
      }
      const policy = await this.lockPolicy(client, input.workspaceId);
      assertPolicyRevision(policy, input.expectedPolicyRevision);
      if (plan.policyRevision !== Number(policy.revision)) {
        throw new ApplicationError(
          "RETENTION_PLAN_POLICY_CHANGED", 409, "Retention policy changed after this preview.",
          { details: { planRevision: plan.policyRevision, actualRevision: Number(policy.revision) } },
        );
      }
      const current = await this.measure(client, input.workspaceId, plan.cutoffs, plan.referenceAt);
      const digestSeed = planDigestSeed(plan.digest);
      const currentDigest = digestSeed === null ? null : planDigest(digestSeed, current.candidateDigest);
      if (!sameCounts(current.counts, plan.counts) || currentDigest !== plan.digest) {
        throw new ApplicationError(
          "RETENTION_PLAN_STALE", 409,
          "Retention candidates changed after preview. Create a new preview before applying.",
          { details: { previewed: plan.counts, current: current.counts,
            candidateSetChanged: currentDigest !== plan.digest } },
        );
      }

      const results = await this.deleteCandidates(client, input.workspaceId, plan.cutoffs, plan.referenceAt);
      const expectedDeleted = { ...plan.counts, softDeletedDocuments: 0 };
      if (!sameCounts(results, expectedDeleted)) {
        throw new ApplicationError("RETENTION_APPLY_MISMATCH", 409,
          "Retention candidates changed while applying. No records were deleted.");
      }
      const applied = await client.query<PlanRow>(
        `UPDATE ${this.q("_xecms_retention_plans")}
            SET status = 'applied', applied_at = $3, applied_by = $4, results = $5::jsonb
          WHERE id = $1 AND workspace_id = $2 RETURNING *`,
        [input.planId, input.workspaceId, input.now, input.actorIdentityId, JSON.stringify(results)],
      );
      await this.audit(client, {
        eventType: "retention.plan.applied", workspaceId: input.workspaceId,
        actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
        aggregateVersion: plan.policyRevision, now: input.now,
        metadata: { planId: plan.id, digest: plan.digest, results },
      });
      await client.query("COMMIT");
      return mapPlan(applied.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async measure(client: PoolClient, workspaceId: string, cutoffs: RetentionCutoffs,
    referenceAt: string): Promise<{ counts: RetentionCounts; estimatedBytes: Record<string, number>;
      candidateDigest: string }> {
    const specs = this.candidateSpecs(workspaceId, cutoffs, referenceAt);
    const counts = emptyCounts();
    const estimatedBytes: Record<string, number> = {};
    const candidates: [typeof COUNT_KEYS[number], string[]][] = [];
    for (const [key, spec] of specs) {
      if (spec === null) {
        counts[key] = 0; estimatedBytes[key] = 0; candidates.push([key, []]); continue;
      }
      const result = await client.query<{ count: string; bytes: string; ids: string[] }>(
        `SELECT count(*)::text AS count,
                COALESCE(sum(pg_column_size(candidate)), 0)::text AS bytes,
                COALESCE(array_agg(candidate.id::text ORDER BY candidate.id::text),
                         '{}'::text[]) AS ids
           FROM (${spec.sql}) candidate`,
        spec.values,
      );
      counts[key] = Number(result.rows[0]!.count);
      estimatedBytes[key] = Number(result.rows[0]!.bytes);
      candidates.push([key, result.rows[0]!.ids]);
    }
    return { counts, estimatedBytes,
      candidateDigest: createHash("sha256").update(JSON.stringify(candidates)).digest("hex") };
  }

  private async deleteCandidates(client: PoolClient, workspaceId: string, cutoffs: RetentionCutoffs,
    referenceAt: string): Promise<RetentionCounts> {
    const results = emptyCounts();
    // Audit is removed before its workspace-bearing Outbox source. This preserves
    // exact scoping even for a hard-purged Document whose only remaining workspace
    // association is the immutable outbox envelope.
    if (cutoffs.audit !== null) {
      const system = await client.query(
        `DELETE FROM ${this.q("_xecms_audit_log")} audit
          WHERE audit.occurred_at < $2::timestamptz
            AND (audit.metadata->>'workspaceId' = $1 OR EXISTS (
              SELECT 1 FROM ${this.q("_xecms_identities")} identity
               WHERE identity.id = audit.identity_id AND identity.workspace_id = $1))`,
        [workspaceId, cutoffs.audit],
      );
      results.systemAudit = system.rowCount ?? 0;
      const document = await client.query(
        `DELETE FROM ${this.q("_xecms_document_events")} document_event
          WHERE document_event.occurred_at < $2::timestamptz AND (
            EXISTS (SELECT 1 FROM ${this.q("_xecms_documents")} document
              WHERE document.id = document_event.document_id AND document.workspace_id = $1)
            OR EXISTS (SELECT 1 FROM ${this.q("_xecms_outbox_events")} event
              WHERE event.id = 'outbox_document_' || document_event.id::text
                AND event.workspace_id = $1))`,
        [workspaceId, cutoffs.audit],
      );
      results.documentAudit = document.rowCount ?? 0;
      const authorization = await client.query(
        `DELETE FROM ${this.q("_xecms_auth_audit_log")} audit
          USING ${this.q("_xecms_realms")} realm
          WHERE audit.realm_id = realm.id AND realm.workspace_id = $1
            AND audit.occurred_at < $2::timestamptz`,
        [workspaceId, cutoffs.audit],
      );
      results.authorizationAudit = authorization.rowCount ?? 0;
    }
    // Delete only outboxes that were already orphaned at preview time. Delivery
    // cleanup below can create new orphans, which intentionally wait for the next plan.
    if (cutoffs.dispatchedOutbox !== null) {
      const deleted = await client.query(
        `DELETE FROM ${this.q("_xecms_outbox_events")} event
          WHERE event.workspace_id = $1 AND event.dispatched_at IS NOT NULL
            AND event.occurred_at < $2::timestamptz
            AND NOT EXISTS (SELECT 1 FROM ${this.q("_xecms_event_deliveries")} delivery
              WHERE delivery.event_id = event.id)`,
        [workspaceId, cutoffs.dispatchedOutbox],
      );
      results.dispatchedOutbox = deleted.rowCount ?? 0;
    }
    const deliveryCutoffs = [
      ["succeededDeliveries", "succeeded", cutoffs.succeededDelivery],
      ["deadDeliveries", "dead", cutoffs.deadDelivery],
    ] as const;
    for (const [key, status, cutoff] of deliveryCutoffs) {
      if (cutoff === null) continue;
      await client.query(
        `DELETE FROM ${this.q("_xecms_event_handler_receipts")} receipt
          USING ${this.q("_xecms_event_deliveries")} delivery,
                ${this.q("_xecms_outbox_events")} event
          WHERE receipt.delivery_id = delivery.id AND delivery.event_id = event.id
            AND event.workspace_id = $1 AND delivery.status = $2
            AND delivery.completed_at < $3::timestamptz`,
        [workspaceId, status, cutoff],
      );
      const deleted = await client.query(
        `DELETE FROM ${this.q("_xecms_event_deliveries")} delivery
          USING ${this.q("_xecms_outbox_events")} event
          WHERE delivery.event_id = event.id AND event.workspace_id = $1
            AND delivery.status = $2 AND delivery.completed_at < $3::timestamptz`,
        [workspaceId, status, cutoff],
      );
      results[key] = deleted.rowCount ?? 0;
    }
    if (cutoffs.expiredSession !== null) {
      const deleted = await client.query(
        `DELETE FROM ${this.q("_xecms_sessions")} session
          USING ${this.q("_xecms_identities")} identity
          WHERE session.identity_id = identity.id AND identity.workspace_id = $1
            AND COALESCE(session.revoked_at, session.expires_at) < $2::timestamptz
            AND (session.revoked_at IS NOT NULL OR session.expires_at < $3::timestamptz)`,
        [workspaceId, cutoffs.expiredSession, referenceAt],
      );
      results.expiredSessions = deleted.rowCount ?? 0;
    }
    return results;
  }

  private candidateSpecs(workspaceId: string, cutoffs: RetentionCutoffs, referenceAt: string) {
    const q = (name: string) => this.q(name);
    type Key = typeof COUNT_KEYS[number];
    type Spec = { sql: string; values: unknown[] } | null;
    const entries: [Key, Spec][] = [
      ["systemAudit", cutoffs.audit === null ? null : { sql:
        `SELECT audit.* FROM ${q("_xecms_audit_log")} audit
          WHERE audit.occurred_at < $2::timestamptz AND
            (audit.metadata->>'workspaceId' = $1 OR EXISTS (SELECT 1 FROM ${q("_xecms_identities")} identity
              WHERE identity.id = audit.identity_id AND identity.workspace_id = $1))`,
        values: [workspaceId, cutoffs.audit] }],
      ["documentAudit", cutoffs.audit === null ? null : { sql:
        `SELECT event.* FROM ${q("_xecms_document_events")} event
          WHERE event.occurred_at < $2::timestamptz AND
            (EXISTS (SELECT 1 FROM ${q("_xecms_documents")} document
              WHERE document.id = event.document_id AND document.workspace_id = $1)
             OR EXISTS (SELECT 1 FROM ${q("_xecms_outbox_events")} outbox
              WHERE outbox.id = 'outbox_document_' || event.id::text AND outbox.workspace_id = $1))`,
        values: [workspaceId, cutoffs.audit] }],
      ["authorizationAudit", cutoffs.audit === null ? null : { sql:
        `SELECT audit.* FROM ${q("_xecms_auth_audit_log")} audit
          JOIN ${q("_xecms_realms")} realm ON realm.id = audit.realm_id
          WHERE realm.workspace_id = $1 AND audit.occurred_at < $2::timestamptz`,
        values: [workspaceId, cutoffs.audit] }],
      ["dispatchedOutbox", cutoffs.dispatchedOutbox === null ? null : { sql:
        `SELECT event.* FROM ${q("_xecms_outbox_events")} event
          WHERE event.workspace_id = $1 AND event.dispatched_at IS NOT NULL
            AND event.occurred_at < $2::timestamptz
            AND NOT EXISTS (SELECT 1 FROM ${q("_xecms_event_deliveries")} delivery
              WHERE delivery.event_id = event.id)`, values: [workspaceId, cutoffs.dispatchedOutbox] }],
      ["succeededDeliveries", deliverySpec("succeeded", cutoffs.succeededDelivery)],
      ["deadDeliveries", deliverySpec("dead", cutoffs.deadDelivery)],
      ["expiredSessions", cutoffs.expiredSession === null ? null : { sql:
        `SELECT session.* FROM ${q("_xecms_sessions")} session
          JOIN ${q("_xecms_identities")} identity ON identity.id = session.identity_id
          WHERE identity.workspace_id = $1
            AND COALESCE(session.revoked_at, session.expires_at) < $2::timestamptz
            AND (session.revoked_at IS NOT NULL OR session.expires_at < $3::timestamptz)`,
        values: [workspaceId, cutoffs.expiredSession, referenceAt] }],
      ["softDeletedDocuments", cutoffs.softDeletedDocument === null ? null : { sql:
        `SELECT document.* FROM ${q("_xecms_documents")} document
          WHERE document.workspace_id = $1 AND document.deletion IS NOT NULL
            AND (document.deletion->>'deletedAt')::timestamptz < $2::timestamptz`,
        values: [workspaceId, cutoffs.softDeletedDocument] }],
    ];
    function deliverySpec(status: string, cutoff: string | null): Spec {
      return cutoff === null ? null : { sql:
        `SELECT delivery.* FROM ${q("_xecms_event_deliveries")} delivery
          JOIN ${q("_xecms_outbox_events")} event ON event.id = delivery.event_id
          WHERE event.workspace_id = $1 AND delivery.status = $2
            AND delivery.completed_at < $3::timestamptz`, values: [workspaceId, status, cutoff] };
    }
    return entries;
  }

  private async lockPolicy(client: PoolClient, workspaceId: string): Promise<PolicyRow> {
    const result = await client.query<PolicyRow>(
      `SELECT * FROM ${this.q("_xecms_retention_policies")} WHERE workspace_id = $1 FOR UPDATE`,
      [workspaceId],
    );
    if (result.rows[0] === undefined) {
      throw new ApplicationError("RETENTION_POLICY_NOT_FOUND", 404, "Retention policy does not exist.");
    }
    return result.rows[0];
  }

  private async audit(client: PoolClient, input: { eventType: string; workspaceId: string;
    actorIdentityId: string; actorSubjectId: string; aggregateVersion: number; now: string;
    metadata: Record<string, unknown> }): Promise<void> {
    const metadata = { workspaceId: input.workspaceId, ...input.metadata };
    const audit = await client.query<{ id: string | number }>(
      `INSERT INTO ${this.q("_xecms_audit_log")}(event_type, identity_id, occurred_at, metadata)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [input.eventType, input.actorIdentityId, input.now, JSON.stringify(metadata)],
    );
    await client.query(
      `INSERT INTO ${this.q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id, aggregate_version,
          actor_subject_id, actor_identity_id, occurred_at, payload, created_at)
       VALUES ($1, $2, $3, $4, 'retention', $2, $5, $6, $7, $8, $9::jsonb, $8)`,
      [`outbox_retention_${audit.rows[0]!.id}`, input.workspaceId, SYSTEM_AUTHORIZATION_REALM_ID,
        input.eventType, input.aggregateVersion, input.actorSubjectId, input.actorIdentityId,
        input.now, JSON.stringify(metadata)],
    );
  }

  private q(name: string): string { return qualifiedName(this.schema, name); }
}

interface PolicyRow extends QueryResultRow {
  workspace_id: string; audit_days: number | null; dispatched_outbox_days: number | null;
  succeeded_delivery_days: number | null; dead_delivery_days: number | null;
  expired_session_days: number | null; soft_deleted_document_days: number | null;
  revision: number | string; updated_at: Date | string; updated_by: string;
}
interface PlanRow extends QueryResultRow {
  id: string; workspace_id: string; policy_revision: number | string;
  status: "previewed" | "applied" | "expired"; reference_at: Date | string;
  cutoffs: RetentionCutoffs; counts: RetentionCounts; estimated_bytes: Record<string, number>;
  digest: string; created_at: Date | string; created_by: string; expires_at: Date | string;
  applied_at: Date | string | null; applied_by: string | null; results: RetentionCounts | null;
}

function mapPolicy(row: PolicyRow): RetentionPolicy {
  return { workspaceId: row.workspace_id, auditDays: row.audit_days,
    dispatchedOutboxDays: row.dispatched_outbox_days,
    succeededDeliveryDays: row.succeeded_delivery_days, deadDeliveryDays: row.dead_delivery_days,
    expiredSessionDays: row.expired_session_days, softDeletedDocumentDays: row.soft_deleted_document_days,
    revision: Number(row.revision), updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by };
}
function mapPlan(row: PlanRow): RetentionPlan {
  return { id: row.id, workspaceId: row.workspace_id, policyRevision: Number(row.policy_revision),
    status: row.status, referenceAt: new Date(row.reference_at).toISOString(), cutoffs: row.cutoffs,
    counts: row.counts, estimatedBytes: row.estimated_bytes, digest: row.digest,
    createdAt: new Date(row.created_at).toISOString(), createdBy: row.created_by,
    expiresAt: new Date(row.expires_at).toISOString(),
    ...(row.applied_at === null ? {} : { appliedAt: new Date(row.applied_at).toISOString() }),
    ...(row.applied_by === null ? {} : { appliedBy: row.applied_by }),
    ...(row.results === null ? {} : { results: row.results }) };
}
function policyValues(policy: RetentionPolicy): Record<string, number | null> {
  return { auditDays: policy.auditDays, dispatchedOutboxDays: policy.dispatchedOutboxDays,
    succeededDeliveryDays: policy.succeededDeliveryDays, deadDeliveryDays: policy.deadDeliveryDays,
    expiredSessionDays: policy.expiredSessionDays, softDeletedDocumentDays: policy.softDeletedDocumentDays };
}
function emptyCounts(): Record<typeof COUNT_KEYS[number], number> {
  return { systemAudit: 0, documentAudit: 0, authorizationAudit: 0, dispatchedOutbox: 0,
    succeededDeliveries: 0, deadDeliveries: 0, expiredSessions: 0, softDeletedDocuments: 0 };
}
function sameCounts(left: RetentionCounts, right: RetentionCounts): boolean {
  return COUNT_KEYS.every((key) => left[key] === right[key]);
}
function planDigest(seed: string, candidateDigest: string): string {
  return `v2:${seed}:${candidateDigest}`;
}
function planDigestSeed(digest: string): string | null {
  const match = /^v2:([a-f0-9]{64}):[a-f0-9]{64}$/.exec(digest);
  return match?.[1] ?? null;
}
function assertPolicyRevision(row: PolicyRow, expectedRevision: number): void {
  const actualRevision = Number(row.revision);
  if (actualRevision !== expectedRevision) {
    throw new ApplicationError("RETENTION_POLICY_REVISION_CONFLICT", 409,
      "Retention policy changed after it was read.", { details: { expectedRevision, actualRevision } });
  }
}
