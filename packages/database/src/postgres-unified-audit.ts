import type {
  StoredUnifiedAuditEntry,
  UnifiedAuditCategory,
  UnifiedAuditOutcome,
  UnifiedAuditSource,
  UnifiedAuditStore,
} from "@xecms/application";
import type { Pool, QueryResultRow } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID } from "./migrate.js";

export class PostgresUnifiedAuditStore implements UnifiedAuditStore {
  private readonly schema: string;

  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async list(input: Parameters<UnifiedAuditStore["list"]>[0]) {
    const values: unknown[] = [];
    const filters: string[] = [];
    const add = (value: unknown): string => { values.push(value); return `$${values.length}`; };
    filters.push(`workspace_id = ${add(input.workspaceId)}`);
    if (input.category !== undefined) filters.push(`category = ${add(input.category)}`);
    if (input.source !== undefined) filters.push(`source = ${add(input.source)}`);
    if (input.action !== undefined) filters.push(`action = ${add(input.action)}`);
    if (input.actorId !== undefined) {
      const index = add(input.actorId);
      filters.push(`(actor_identity_id = ${index} OR actor_subject_id = ${index})`);
    }
    if (input.targetId !== undefined) filters.push(`target_id = ${add(input.targetId)}`);
    if (input.realmId !== undefined) filters.push(`realm_id = ${add(input.realmId)}`);
    if (input.siteId !== undefined) filters.push(`site_id = ${add(input.siteId)}`);
    if (input.outcome !== undefined) filters.push(`outcome = ${add(input.outcome)}`);
    if (input.from !== undefined) filters.push(`occurred_at >= ${add(input.from)}::timestamptz`);
    if (input.to !== undefined) filters.push(`occurred_at < ${add(input.to)}::timestamptz`);
    if (input.cursor !== undefined) {
      const time = add(input.cursor.occurredAt);
      const rank = add(input.cursor.sourceRank);
      const id = add(input.cursor.sortId);
      filters.push(`(occurred_at, source_rank, sort_id) < (${time}::timestamptz, ${rank}::int, ${id}::text)`);
    }
    const limit = add(input.limit + 1);
    const result = await this.pool.query<AuditRow>(
      `${this.unionSql()}
       SELECT * FROM unified
        WHERE ${filters.join(" AND ")}
        ORDER BY occurred_at DESC, source_rank DESC, sort_id DESC
        LIMIT ${limit}`,
      values,
    );
    return {
      items: result.rows.slice(0, input.limit).map(mapAudit),
      hasMore: result.rows.length > input.limit,
    };
  }

  public async get(input: Parameters<UnifiedAuditStore["get"]>[0]) {
    const result = await this.pool.query<AuditRow>(
      `${this.unionSql()}
       SELECT * FROM unified WHERE workspace_id = $1 AND source = $2 AND source_id = $3`,
      [input.workspaceId, input.source, input.sourceId],
    );
    return result.rows[0] === undefined ? null : mapAudit(result.rows[0]);
  }

  private unionSql(): string {
    const q = (name: string): string => this.q(name);
    return `WITH unified AS (
      SELECT
        'system'::text AS source,
        1::int AS source_rank,
        lpad(audit.id::text, 20, '0') AS sort_id,
        audit.id::text AS source_id,
        CASE
          WHEN audit.event_type LIKE 'login.%' OR audit.event_type LIKE 'logout%'
            OR audit.event_type LIKE 'reauthentication.%' OR audit.event_type LIKE 'bootstrap.%' THEN 'security'
          WHEN audit.event_type LIKE 'identity.%' OR audit.event_type LIKE 'session.%'
            OR audit.event_type LIKE 'api-key.%' OR audit.event_type LIKE 'credential.%'
            OR audit.event_type LIKE 'membership.%' OR audit.event_type LIKE 'owner.%' THEN 'identity'
          WHEN audit.event_type LIKE 'realm.%' THEN 'identity'
          WHEN audit.event_type LIKE 'workspace.%' THEN 'settings'
          WHEN audit.event_type LIKE 'site.%' THEN 'site'
          WHEN audit.event_type LIKE 'schema.%' THEN 'schema'
          WHEN audit.event_type LIKE 'media.%' THEN 'media'
          WHEN audit.event_type LIKE 'retention.%' THEN 'retention'
          WHEN audit.event_type LIKE 'plugin.%' THEN 'plugin'
          WHEN audit.event_type LIKE 'job.%' THEN 'worker'
          ELSE 'security'
        END::text AS category,
        audit.event_type AS action,
        CASE WHEN audit.event_type LIKE '%.failed' THEN 'failed' ELSE 'succeeded' END::text AS outcome,
        COALESCE(audit.metadata->>'workspaceId', identity.workspace_id, '${DEFAULT_WORKSPACE_ID}') AS workspace_id,
        COALESCE(audit.metadata->>'realmId', identity.origin_realm_id, identity.realm_id) AS realm_id,
        audit.metadata->>'siteId' AS site_id,
        audit.identity_id AS actor_identity_id,
        audit.metadata->>'actorSubjectId' AS actor_subject_id,
        COALESCE(audit.username, identity.username) AS actor_label,
        CASE
          WHEN audit.metadata ? 'siteId' THEN 'site'
          WHEN audit.metadata ? 'identityId' THEN 'identity'
          WHEN audit.metadata ? 'realmId' THEN 'realm'
          WHEN audit.metadata ? 'membershipId' THEN 'membership'
          WHEN audit.metadata ? 'apiKeyId' THEN 'api-key'
          WHEN audit.metadata ? 'sessionId' THEN 'session'
          WHEN audit.metadata ? 'deliveryId' THEN 'job'
          WHEN audit.metadata ? 'workspaceId' THEN 'workspace'
          ELSE 'system'
        END::text AS target_type,
        COALESCE(audit.metadata->>'siteId', audit.metadata->>'identityId', audit.metadata->>'realmId',
          audit.metadata->>'membershipId', audit.metadata->>'apiKeyId', audit.metadata->>'sessionId',
          audit.metadata->>'deliveryId', audit.metadata->>'workspaceId', audit.identity_id) AS target_id,
        audit.event_type AS summary,
        audit.metadata->'before' AS before_state,
        audit.metadata->'after' AS after_state,
        audit.metadata AS metadata,
        audit.metadata->>'requestId' AS request_id,
        audit.occurred_at
      FROM ${q("_xecms_audit_log")} audit
      LEFT JOIN ${q("_xecms_identities")} identity ON identity.id = audit.identity_id

      UNION ALL

      SELECT
        'document', 2, lpad(event.id::text, 20, '0'), event.id::text,
        'content', event.event_type, 'succeeded',
        COALESCE(outbox.workspace_id, document.workspace_id, '${DEFAULT_WORKSPACE_ID}'),
        outbox.realm_id,
        binding.site_id,
        outbox.actor_identity_id,
        event.actor_id,
        subject.display_name,
        'document', event.document_id,
        event.event_type || ' · ' || event.document_id,
        NULL::jsonb, NULL::jsonb,
        event.payload || jsonb_build_object(
          'collectionId', COALESCE(outbox.payload->>'collectionId', document.collection_id),
          'aggregateVersion', event.aggregate_version
        ),
        NULL::text,
        event.occurred_at
      FROM ${q("_xecms_document_events")} event
      LEFT JOIN ${q("_xecms_outbox_events")} outbox ON outbox.id = 'outbox_document_' || event.id::text
      LEFT JOIN ${q("_xecms_documents")} document ON document.id = event.document_id
      LEFT JOIN ${q("_xecms_collection_sites")} binding
        ON binding.workspace_id = COALESCE(outbox.workspace_id, document.workspace_id, '${DEFAULT_WORKSPACE_ID}')
       AND binding.collection_id = COALESCE(outbox.payload->>'collectionId', document.collection_id)
      LEFT JOIN LATERAL (
        SELECT display_name FROM ${q("_xecms_auth_subjects")} candidate
         WHERE candidate.id = event.actor_id ORDER BY candidate.realm_id LIMIT 1
      ) subject ON true

      UNION ALL

      SELECT
        'authorization', 3, audit.id, audit.id,
        'authorization', audit.action, 'succeeded',
        realm.workspace_id,
        audit.realm_id,
        COALESCE(
          CASE WHEN audit.target_id LIKE 'resource:site:%' THEN substring(audit.target_id from 15) END,
          collection_binding.site_id
        ),
        subject.identity_id,
        audit.actor_subject_id,
        subject.display_name,
        audit.target_type,
        audit.target_id,
        audit.action || ' · ' || audit.target_type,
        audit.before_state,
        audit.after_state,
        jsonb_build_object('policyRevision', audit.policy_revision, 'decision', audit.decision),
        audit.request_id,
        audit.occurred_at
      FROM ${q("_xecms_auth_audit_log")} audit
      JOIN ${q("_xecms_realms")} realm ON realm.id = audit.realm_id
      LEFT JOIN ${q("_xecms_auth_subjects")} subject
        ON subject.realm_id = audit.realm_id AND subject.id = audit.actor_subject_id
      LEFT JOIN ${q("_xecms_collection_sites")} collection_binding
        ON audit.target_id = 'resource:collection:' || collection_binding.collection_id
       AND collection_binding.workspace_id = realm.workspace_id

      UNION ALL

      SELECT
        'delivery', 4, delivery.id, delivery.id,
        'worker', 'worker.delivery.dead', 'failed',
        event.workspace_id,
        event.realm_id,
        binding.site_id,
        event.actor_identity_id,
        event.actor_subject_id,
        identity.username,
        event.aggregate_type,
        event.aggregate_id,
        'Dead delivery · ' || delivery.handler_id,
        NULL::jsonb, NULL::jsonb,
        jsonb_build_object(
          'eventId', event.id, 'topic', event.topic, 'handlerId', delivery.handler_id,
          'attempts', delivery.attempts, 'maxAttempts', delivery.max_attempts,
          'errorCode', delivery.last_error_code, 'errorMessage', delivery.last_error_message
        ),
        NULL::text,
        COALESCE(delivery.completed_at, delivery.updated_at)
      FROM ${q("_xecms_event_deliveries")} delivery
      JOIN ${q("_xecms_outbox_events")} event ON event.id = delivery.event_id
      LEFT JOIN ${q("_xecms_identities")} identity ON identity.id = event.actor_identity_id
      LEFT JOIN ${q("_xecms_collection_sites")} binding
        ON binding.workspace_id = event.workspace_id
       AND binding.collection_id = event.payload->>'collectionId'
      WHERE delivery.status = 'dead'
    )`;
  }

  private q(name: string): string { return qualifiedName(this.schema, name); }
}

interface AuditRow extends QueryResultRow {
  readonly source: UnifiedAuditSource;
  readonly source_rank: number;
  readonly sort_id: string;
  readonly source_id: string;
  readonly category: UnifiedAuditCategory;
  readonly action: string;
  readonly outcome: UnifiedAuditOutcome;
  readonly workspace_id: string;
  readonly realm_id: string | null;
  readonly site_id: string | null;
  readonly actor_identity_id: string | null;
  readonly actor_subject_id: string | null;
  readonly actor_label: string | null;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly summary: string;
  readonly before_state: unknown | null;
  readonly after_state: unknown | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly request_id: string | null;
  readonly occurred_at: Date | string;
}

function mapAudit(row: AuditRow): StoredUnifiedAuditEntry {
  return {
    source: row.source,
    sourceRank: Number(row.source_rank),
    sortId: row.sort_id,
    sourceId: row.source_id,
    category: row.category,
    action: row.action,
    outcome: row.outcome,
    workspaceId: row.workspace_id,
    ...(row.realm_id === null ? {} : { realmId: row.realm_id }),
    ...(row.site_id === null ? {} : { siteId: row.site_id }),
    ...(row.actor_identity_id === null ? {} : { actorIdentityId: row.actor_identity_id }),
    ...(row.actor_subject_id === null ? {} : { actorSubjectId: row.actor_subject_id }),
    ...(row.actor_label === null ? {} : { actorLabel: row.actor_label }),
    targetType: row.target_type,
    ...(row.target_id === null ? {} : { targetId: row.target_id }),
    summary: row.summary,
    ...(row.before_state === null ? {} : { before: row.before_state }),
    ...(row.after_state === null ? {} : { after: row.after_state }),
    ...(row.metadata === null ? {} : { metadata: row.metadata }),
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
    occurredAt: new Date(row.occurred_at).toISOString(),
  };
}
