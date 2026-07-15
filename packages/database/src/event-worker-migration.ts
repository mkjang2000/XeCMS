import type { PoolClient } from "pg";
import { qualifiedName } from "./identifiers.js";

export const EVENT_WORKER_MIGRATION_ID = "0014_m4b_event_worker";

export async function applyEventWorkerMigration(client: Pick<PoolClient, "query">, schema: string): Promise<void> {
  const q = (name: string): string => qualifiedName(schema, name);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${q("_xecms_outbox_events")} (
      id text PRIMARY KEY,
      workspace_id text NOT NULL REFERENCES ${q("_xecms_workspaces")}(id) ON DELETE CASCADE,
      realm_id text,
      topic text NOT NULL CHECK (topic ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
      aggregate_type text NOT NULL CHECK (aggregate_type IN ('document', 'identity', 'realm', 'authorization', 'media')),
      aggregate_id text NOT NULL,
      aggregate_version bigint,
      actor_subject_id text,
      actor_identity_id text,
      occurred_at timestamptz NOT NULL,
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      created_at timestamptz NOT NULL,
      dispatched_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS _xecms_outbox_topic_time
      ON ${q("_xecms_outbox_events")}(topic, occurred_at, id);
    CREATE INDEX IF NOT EXISTS _xecms_outbox_undispatched
      ON ${q("_xecms_outbox_events")}(occurred_at, id) WHERE dispatched_at IS NULL;

    CREATE TABLE IF NOT EXISTS ${q("_xecms_event_deliveries")} (
      id text PRIMARY KEY,
      event_id text NOT NULL REFERENCES ${q("_xecms_outbox_events")}(id) ON DELETE CASCADE,
      handler_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'dead')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
      available_at timestamptz NOT NULL,
      locked_by text,
      locked_until timestamptz,
      last_error_code text,
      last_error_message text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      UNIQUE (event_id, handler_id),
      CHECK ((status = 'processing') = (locked_by IS NOT NULL AND locked_until IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS _xecms_delivery_claim
      ON ${q("_xecms_event_deliveries")}(available_at, created_at, id)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS _xecms_delivery_lease
      ON ${q("_xecms_event_deliveries")}(locked_until, id)
      WHERE status = 'processing';
    CREATE INDEX IF NOT EXISTS _xecms_delivery_filter
      ON ${q("_xecms_event_deliveries")}(status, handler_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${q("_xecms_event_handler_receipts")} (
      idempotency_key text PRIMARY KEY,
      delivery_id text NOT NULL,
      handler_id text NOT NULL,
      event_id text NOT NULL,
      processed_at timestamptz NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${q("_xecms_example_search_index")} (
      document_id text PRIMARY KEY,
      workspace_id text NOT NULL,
      realm_id text,
      collection_id text NOT NULL,
      aggregate_version bigint NOT NULL,
      data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
      source_event_id text NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
}
