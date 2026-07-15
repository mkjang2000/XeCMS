import { randomUUID } from "node:crypto";

import type { DurableEvent } from "@xecms/application";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVENT_WORKER_MIGRATION_ID } from "./event-worker-migration.js";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, migrateCore } from "./migrate.js";
import { PostgresEventWorkerStore } from "./postgres-event-worker.js";

describe("PostgresEventWorkerStore validation", () => {
  it("rejects unsafe PostgreSQL schema identifiers", () => {
    expect(() => new PostgresEventWorkerStore({} as Pool, "public; drop schema public")).toThrow();
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("M4-B PostgreSQL outbox and worker", () => {
  const schema = `xecms_event_worker_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  const first = new PostgresEventWorkerStore(pool, schema);
  const second = new PostgresEventWorkerStore(pool, schema);
  const q = (name: string): string => qualifiedName(schema, name);
  const base = Date.parse("2026-07-15T00:00:00.000Z");

  beforeAll(async () => { await migrateCore(pool, schema); });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("installs migration 0014 idempotently", async () => {
    await migrateCore(pool, schema);
    const found = await pool.query(`SELECT id FROM ${q("_xecms_core_migrations")} WHERE id = $1`, [EVENT_WORKER_MIGRATION_ID]);
    expect(found.rowCount).toBe(1);
  });

  it("uses SKIP LOCKED so concurrent workers claim a delivery exactly once", async () => {
    await insertEvent(event("evt_concurrent", "doc_concurrent", 1));
    expect(await first.fanOut([{ id: "search", topics: ["document.created"] }], instant(0))).toBe(1);

    const input = { now: instant(0), lockedUntil: instant(30_000), limit: 10, maxAttempts: 8 };
    const [left, right] = await Promise.all([
      first.claim({ ...input, workerId: "worker_left" }),
      second.claim({ ...input, workerId: "worker_right" }),
    ]);
    expect([...left, ...right]).toHaveLength(1);
    const claimed = [...left, ...right][0]!;
    await (left.length === 1 ? first : second).succeed({
      deliveryId: claimed.id,
      workerId: claimed.lockedBy!,
      now: instant(1_000),
    });
    await expect(first.get(claimed.id)).resolves.toMatchObject({ status: "succeeded", attempts: 1 });
  });

  it("does not steal a live lease and recovers an expired lease after restart", async () => {
    await insertEvent(event("evt_lease", "doc_lease", 1));
    await first.fanOut([{ id: "search", topics: ["document.created"] }], instant(60_000));
    const [locked] = await first.claim({ workerId: "worker_stopped", now: instant(60_000), lockedUntil: instant(90_000), limit: 1, maxAttempts: 3 });
    expect(locked).toMatchObject({ status: "processing", attempts: 1, lockedBy: "worker_stopped" });

    await expect(second.claim({ workerId: "worker_new", now: instant(89_999), lockedUntil: instant(119_999), limit: 1, maxAttempts: 3 })).resolves.toHaveLength(0);
    const [recovered] = await second.claim({ workerId: "worker_new", now: instant(90_000), lockedUntil: instant(120_000), limit: 1, maxAttempts: 3 });
    expect(recovered).toMatchObject({ id: locked!.id, status: "processing", attempts: 2, lockedBy: "worker_new" });
    await second.fail({ deliveryId: recovered!.id, workerId: "worker_new", now: instant(91_000), nextAvailableAt: instant(92_000), dead: true, errorCode: "TEST_FAILURE", errorMessage: "expected" });
    await expect(second.retry(recovered!.id, instant(93_000), { actorSubjectId: "subject_operator" }))
      .resolves.toMatchObject({ status: "pending", attempts: 0 });
    const audit = await pool.query<{ event_type: string; metadata: Record<string, unknown> }>(
      `SELECT event_type, metadata FROM ${q("_xecms_audit_log")}
        WHERE event_type = 'job.delivery.retried'`,
    );
    expect(audit.rows).toEqual([expect.objectContaining({ event_type: "job.delivery.retried",
      metadata: expect.objectContaining({ deliveryId: recovered!.id, actorSubjectId: "subject_operator" }) })]);
  });

  it("commits the example projection and receipt atomically and ignores duplicate handling", async () => {
    const source = event("evt_projection", "doc_projection", 4, { title: "Projected once" });
    await first.applySearchProjection(source, {
      idempotencyKey: "xecms:event:evt_projection:handler:search",
      deliveryId: "delivery_projection",
      handlerId: "search",
      now: instant(120_000),
    });
    await first.applySearchProjection({ ...source, payload: { ...source.payload, revision: { data: { title: "Must not overwrite" } } } }, {
      idempotencyKey: "xecms:event:evt_projection:handler:search",
      deliveryId: "delivery_projection",
      handlerId: "search",
      now: instant(121_000),
    });

    const projection = await pool.query<{ data: { title: string }; aggregate_version: string }>(
      `SELECT data, aggregate_version::text FROM ${q("_xecms_example_search_index")} WHERE document_id = $1`,
      ["doc_projection"],
    );
    expect(projection.rows[0]).toEqual({ data: { title: "Projected once" }, aggregate_version: "4" });
    const receipts = await pool.query(`SELECT 1 FROM ${q("_xecms_event_handler_receipts")} WHERE idempotency_key = $1`, ["xecms:event:evt_projection:handler:search"]);
    expect(receipts.rowCount).toBe(1);
  });

  async function insertEvent(source: DurableEvent): Promise<void> {
    await pool.query(
      `INSERT INTO ${q("_xecms_outbox_events")}
         (id, workspace_id, realm_id, topic, aggregate_type, aggregate_id,
          aggregate_version, actor_subject_id, occurred_at, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $9)`,
      [source.id, source.workspaceId, source.realmId ?? null, source.topic, source.aggregate.type,
        source.aggregate.id, source.aggregate.version ?? null, source.actor.subjectId ?? null,
        source.occurredAt, JSON.stringify(source.payload)],
    );
  }

  function instant(offset: number): string { return new Date(base + offset).toISOString(); }
});

function event(id: string, documentId: string, version: number, data: Readonly<Record<string, unknown>> = { title: id }): DurableEvent {
  return {
    specVersion: "1.0",
    id,
    topic: "document.created",
    workspaceId: DEFAULT_WORKSPACE_ID,
    realmId: SYSTEM_REALM_ID,
    aggregate: { type: "document", id: documentId, version },
    actor: { subjectId: "subject_owner" },
    occurredAt: "2026-07-15T00:00:00.000Z",
    payload: { collectionId: "col_posts", revision: { data } },
  };
}
