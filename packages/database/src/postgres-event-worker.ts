import {
  ApplicationError,
  type DurableEvent,
  type EventDelivery,
  type EventDeliveryPage,
  type EventDeliveryStatus,
  type EventWorkerStore,
} from "@xecms/application";
import type { Pool, PoolClient } from "pg";
import { qualifiedName, validateDatabaseSchema } from "./identifiers.js";

export class PostgresEventWorkerStore implements EventWorkerStore {
  private readonly schema: string;
  public constructor(private readonly pool: Pool, schema: string) {
    this.schema = validateDatabaseSchema(schema);
  }

  public async fanOut(
    handlers: readonly { readonly id: string; readonly topics: readonly string[] }[],
    now: string,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let inserted = 0;
      for (const handler of handlers) {
        const topics = [...new Set(handler.topics)];
        const result = await client.query(
          `INSERT INTO ${this.q("_xecms_event_deliveries")}
             (id, event_id, handler_id, status, attempts, max_attempts,
              available_at, created_at, updated_at)
           SELECT 'delivery_' || md5(event.id || ':' || $1), event.id, $1,
                  'pending', 0, 8, $3, $3, $3
             FROM ${this.q("_xecms_outbox_events")} event
            WHERE event.topic = ANY($2::text[])
           ON CONFLICT (event_id, handler_id) DO NOTHING`,
          [handler.id, topics, now],
        );
        inserted += result.rowCount ?? 0;
      }
      await client.query(
        `UPDATE ${this.q("_xecms_outbox_events")} event
            SET dispatched_at = COALESCE(dispatched_at, $1)
          WHERE EXISTS (
            SELECT 1 FROM ${this.q("_xecms_event_deliveries")} delivery
             WHERE delivery.event_id = event.id
          )`,
        [now],
      );
      await client.query("COMMIT");
      return inserted;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async claim(input: {
    readonly workerId: string;
    readonly now: string;
    readonly lockedUntil: string;
    readonly limit: number;
    readonly maxAttempts: number;
  }): Promise<readonly EventDelivery[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
      throw new TypeError("Worker batch limit must be between 1 and 200.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ${this.q("_xecms_event_deliveries")}
            SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
                available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE $1 END,
                locked_by = NULL, locked_until = NULL, updated_at = $1
          WHERE status = 'processing' AND locked_until <= $1`,
        [input.now],
      );
      const result = await client.query<DeliveryRow>(
        `WITH candidates AS (
           SELECT id FROM ${this.q("_xecms_event_deliveries")}
            WHERE status = 'pending' AND available_at <= $2 AND attempts < $5
            ORDER BY available_at ASC, created_at ASC, id ASC
            LIMIT $4
            FOR UPDATE SKIP LOCKED
         ), claimed AS (
           UPDATE ${this.q("_xecms_event_deliveries")} delivery
              SET status = 'processing', attempts = delivery.attempts + 1,
                  max_attempts = $5, locked_by = $1, locked_until = $3, updated_at = $2
             FROM candidates WHERE delivery.id = candidates.id
           RETURNING delivery.*
         )
         SELECT ${DELIVERY_COLUMNS("claimed", "event")}
           FROM claimed
           JOIN ${this.q("_xecms_outbox_events")} event ON event.id = claimed.event_id
          ORDER BY claimed.created_at ASC, claimed.id ASC`,
        [input.workerId, input.now, input.lockedUntil, input.limit, input.maxAttempts],
      );
      await client.query("COMMIT");
      return result.rows.map(deliveryFromRow);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async succeed(input: { readonly deliveryId: string; readonly workerId: string; readonly now: string }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.q("_xecms_event_deliveries")}
          SET status = 'succeeded', locked_by = NULL, locked_until = NULL,
              completed_at = $3, updated_at = $3, last_error_code = NULL,
              last_error_message = NULL
        WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
      [input.deliveryId, input.workerId, input.now],
    );
    if (result.rowCount !== 1) leaseLost();
  }

  public async fail(input: {
    readonly deliveryId: string;
    readonly workerId: string;
    readonly now: string;
    readonly nextAvailableAt: string;
    readonly dead: boolean;
    readonly errorCode: string;
    readonly errorMessage: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE ${this.q("_xecms_event_deliveries")}
          SET status = $3, locked_by = NULL, locked_until = NULL,
              available_at = $4, updated_at = $5,
              completed_at = CASE WHEN $3 = 'dead' THEN $5::timestamptz ELSE NULL END,
              last_error_code = $6, last_error_message = $7
        WHERE id = $1 AND status = 'processing' AND locked_by = $2`,
      [input.deliveryId, input.workerId, input.dead ? "dead" : "pending",
        input.nextAvailableAt, input.now, input.errorCode, input.errorMessage],
    );
    if (result.rowCount !== 1) leaseLost();
  }

  public async list(input: {
    readonly page: number;
    readonly pageSize: number;
    readonly status?: EventDeliveryStatus;
    readonly topic?: string;
    readonly handlerId?: string;
  }): Promise<EventDeliveryPage> {
    const values: unknown[] = [];
    const filters: string[] = [];
    if (input.status !== undefined) { values.push(input.status); filters.push(`delivery.status = $${values.length}`); }
    if (input.topic !== undefined) { values.push(input.topic); filters.push(`event.topic = $${values.length}`); }
    if (input.handlerId !== undefined) { values.push(input.handlerId); filters.push(`delivery.handler_id = $${values.length}`); }
    const where = filters.length === 0 ? "" : `WHERE ${filters.join(" AND ")}`;
    const totalResult = await this.pool.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM ${this.q("_xecms_event_deliveries")} delivery
       JOIN ${this.q("_xecms_outbox_events")} event ON event.id = delivery.event_id ${where}`,
      values,
    );
    values.push(input.pageSize, (input.page - 1) * input.pageSize);
    const rows = await this.pool.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS("delivery", "event")}
         FROM ${this.q("_xecms_event_deliveries")} delivery
         JOIN ${this.q("_xecms_outbox_events")} event ON event.id = delivery.event_id
         ${where}
        ORDER BY delivery.updated_at DESC, delivery.id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const countsResult = await this.pool.query<{ readonly status: EventDeliveryStatus; readonly count: string }>(
      `SELECT status, count(*)::text AS count FROM ${this.q("_xecms_event_deliveries")} GROUP BY status`,
    );
    const counts: Record<EventDeliveryStatus, number> = { pending: 0, processing: 0, succeeded: 0, dead: 0 };
    for (const row of countsResult.rows) counts[row.status] = Number(row.count);
    return { items: rows.rows.map(deliveryFromRow), page: input.page, pageSize: input.pageSize, total: Number(totalResult.rows[0]?.total ?? 0), counts };
  }

  public async get(deliveryId: string): Promise<EventDelivery | null> {
    const result = await this.pool.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS("delivery", "event")}
         FROM ${this.q("_xecms_event_deliveries")} delivery
         JOIN ${this.q("_xecms_outbox_events")} event ON event.id = delivery.event_id
        WHERE delivery.id = $1`,
      [deliveryId],
    );
    return result.rows[0] === undefined ? null : deliveryFromRow(result.rows[0]);
  }

  public async retry(deliveryId: string, now: string): Promise<EventDelivery> {
    const result = await this.pool.query(
      `UPDATE ${this.q("_xecms_event_deliveries")}
          SET status = 'pending', attempts = 0, available_at = $2,
              locked_by = NULL, locked_until = NULL, last_error_code = NULL,
              last_error_message = NULL, completed_at = NULL, updated_at = $2
        WHERE id = $1 AND status IN ('dead', 'pending')`,
      [deliveryId, now],
    );
    if (result.rowCount !== 1) {
      const existing = await this.get(deliveryId);
      if (existing === null) throw new ApplicationError("JOB_NOT_FOUND", 404, "The event delivery does not exist.");
      throw new ApplicationError("JOB_RETRY_CONFLICT", 409, "A processing or succeeded delivery cannot be retried.");
    }
    return (await this.get(deliveryId))!;
  }

  /** Example Handler effect and idempotency receipt are committed together. */
  public async applySearchProjection(event: DurableEvent, input: {
    readonly idempotencyKey: string;
    readonly deliveryId: string;
    readonly handlerId: string;
    readonly now: string;
  }): Promise<void> {
    if (event.aggregate.type !== "document") return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const receipt = await client.query(
        `INSERT INTO ${this.q("_xecms_event_handler_receipts")}
           (idempotency_key, delivery_id, handler_id, event_id, processed_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [input.idempotencyKey, input.deliveryId, input.handlerId, event.id, input.now],
      );
      if (receipt.rowCount === 0) { await client.query("COMMIT"); return; }
      if (event.topic === "document.deleted" || event.topic === "document.purged") {
        await client.query(`DELETE FROM ${this.q("_xecms_example_search_index")} WHERE document_id = $1`, [event.aggregate.id]);
      } else {
        const revision = event.payload["revision"];
        const data = typeof revision === "object" && revision !== null && !Array.isArray(revision)
          ? (revision as Readonly<Record<string, unknown>>)["data"]
          : undefined;
        const collectionId = event.payload["collectionId"];
        if (typeof data === "object" && data !== null && !Array.isArray(data) && typeof collectionId === "string") {
          await client.query(
            `INSERT INTO ${this.q("_xecms_example_search_index")}
               (document_id, workspace_id, realm_id, collection_id, aggregate_version,
                data, source_event_id, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             ON CONFLICT (document_id) DO UPDATE SET
               workspace_id = EXCLUDED.workspace_id, realm_id = EXCLUDED.realm_id,
               collection_id = EXCLUDED.collection_id,
               aggregate_version = EXCLUDED.aggregate_version, data = EXCLUDED.data,
               source_event_id = EXCLUDED.source_event_id, updated_at = EXCLUDED.updated_at
             WHERE ${this.q("_xecms_example_search_index")}.aggregate_version <= EXCLUDED.aggregate_version`,
            [event.aggregate.id, event.workspaceId, event.realmId ?? null, collectionId,
              event.aggregate.version ?? 1, JSON.stringify(data), event.id, input.now],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private q(name: string): string { return qualifiedName(this.schema, name); }
}

function leaseLost(): never {
  throw new ApplicationError("JOB_LEASE_LOST", 409, "The event delivery lease is no longer owned by this Worker.");
}

function DELIVERY_COLUMNS(delivery: string, event: string): string {
  return `${delivery}.id, ${delivery}.event_id, ${delivery}.handler_id, ${delivery}.status,
    ${delivery}.attempts, ${delivery}.max_attempts, ${delivery}.available_at,
    ${delivery}.locked_by, ${delivery}.locked_until, ${delivery}.last_error_code,
    ${delivery}.last_error_message, ${delivery}.created_at, ${delivery}.updated_at,
    ${delivery}.completed_at, ${event}.topic, ${event}.workspace_id, ${event}.realm_id,
    ${event}.aggregate_type, ${event}.aggregate_id, ${event}.aggregate_version,
    ${event}.actor_subject_id, ${event}.actor_identity_id, ${event}.occurred_at,
    ${event}.payload`;
}

interface DeliveryRow {
  readonly id: string; readonly event_id: string; readonly handler_id: string;
  readonly status: EventDeliveryStatus; readonly attempts: number; readonly max_attempts: number;
  readonly available_at: Date | string; readonly locked_by: string | null; readonly locked_until: Date | string | null;
  readonly last_error_code: string | null; readonly last_error_message: string | null;
  readonly created_at: Date | string; readonly updated_at: Date | string; readonly completed_at: Date | string | null;
  readonly topic: string; readonly workspace_id: string; readonly realm_id: string | null;
  readonly aggregate_type: DurableEvent["aggregate"]["type"]; readonly aggregate_id: string;
  readonly aggregate_version: string | number | null; readonly actor_subject_id: string | null;
  readonly actor_identity_id: string | null; readonly occurred_at: Date | string;
  readonly payload: Readonly<Record<string, unknown>>;
}

function deliveryFromRow(row: DeliveryRow): EventDelivery {
  const event: DurableEvent = {
    specVersion: "1.0", id: row.event_id, topic: row.topic, workspaceId: row.workspace_id,
    ...(row.realm_id === null ? {} : { realmId: row.realm_id }),
    aggregate: { type: row.aggregate_type, id: row.aggregate_id,
      ...(row.aggregate_version === null ? {} : { version: Number(row.aggregate_version) }) },
    actor: { ...(row.actor_subject_id === null ? {} : { subjectId: row.actor_subject_id }),
      ...(row.actor_identity_id === null ? {} : { identityId: row.actor_identity_id }) },
    occurredAt: instant(row.occurred_at), payload: row.payload,
  };
  return {
    id: row.id, eventId: row.event_id, topic: row.topic, handlerId: row.handler_id,
    status: row.status, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
    availableAt: instant(row.available_at), ...(row.locked_by === null ? {} : { lockedBy: row.locked_by }),
    ...(row.locked_until === null ? {} : { lockedUntil: instant(row.locked_until) }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.last_error_message === null ? {} : { lastErrorMessage: row.last_error_message }),
    createdAt: instant(row.created_at), updatedAt: instant(row.updated_at),
    ...(row.completed_at === null ? {} : { completedAt: instant(row.completed_at) }), event,
  };
}

function instant(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
