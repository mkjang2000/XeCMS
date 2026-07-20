import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  AuthorizationApplicationService, PluginCatalog, PluginService, SYSTEM_WORKSPACE_RESOURCE_ID,
  UnifiedAuditService, type ContentHierarchyStoreContext,
} from "@xecms/application";
import { asCollectionId, asDocumentId, asSubjectId, asUtcInstant, asWorkspaceId } from "@xecms/core";
import { definePlugin } from "@xecms/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, SYSTEM_REALM_ID } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresRealmCollectionEntitlementStore } from "./postgres-realm-collection-entitlements.js";
import { PostgresContentHierarchyStore } from "./postgres-hierarchy.js";
import { PostgresPluginStore } from "./postgres-plugins.js";
import { PostgresUnifiedAuditStore } from "./postgres-unified-audit.js";
import { PostgresDatabase } from "./postgres.js";

const RUN = process.env["XECMS_RUN_P2_BENCHMARKS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["DATABASE_URL"] ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("P2 scalability characterization", () => {
  const schema = `xecms_p2_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 8 });
  const q = (name: string) => qualifiedName(schema, name);
  const ownerId = "usr_p2_owner";
  const now = "2026-07-16T00:00:00.000Z";

  beforeAll(async () => {
    await database.migrate();
    await database.createInitialOwner({ id: ownerId, username: "p2.owner", passwordHash: "hash", now });
    await new AuthorizationApplicationService(new PostgresAuthorizationStore(database.pool, schema), {
      now: () => now, newAuditId: () => `audit_${randomUUID()}`,
      newId: (prefix) => `${prefix}_${randomUUID()}`,
    }, new PostgresRealmCollectionEntitlementStore(database.pool, schema)).initialize({
      realmId: SYSTEM_REALM_ID, realmName: "System Realm",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID, rootResourceName: DEFAULT_WORKSPACE_NAME,
      ownerSubjectId: ownerId, ownerIdentityId: ownerId, ownerSubjectName: "p2.owner",
    });
  }, 30_000);

  afterAll(async () => {
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await database.close();
  });

  it("measures full-snapshot hierarchy mutation and read paths", async () => {
    const sizes = numberList(process.env["XECMS_P2_HIERARCHY_SIZES"], [100, 1_000, 5_000]);
    const results = [];
    for (const size of sizes) {
      const collectionId = `col_p2_hierarchy_${size}`;
      await seedHierarchy(collectionId, size);
      const context: ContentHierarchyStoreContext = {
        workspaceId: asWorkspaceId(DEFAULT_WORKSPACE_ID), collectionId: asCollectionId(collectionId),
      };
      const store = new PostgresContentHierarchyStore(database.pool, schema);
      const beforeHeap = process.memoryUsage().heapUsed;
      const moveMs = await elapsed(async () => store.moveNode(context, {
        documentId: asDocumentId(documentId(collectionId, size)),
        newParentId: asDocumentId(documentId(collectionId, 2)), position: 0,
        expectedVersion: 1, actorId: asSubjectId(ownerId), now: asUtcInstant(now), maxDepth: 100,
      }));
      const rootsMs = await elapsed(async () => store.listRoots(context));
      const childrenMs = await elapsed(async () => store.listChildren(context,
        asDocumentId(documentId(collectionId, 1))));
      const ancestorsMs = await elapsed(async () => store.listAncestors(context,
        asDocumentId(documentId(collectionId, size))));
      const descendantsMs = await elapsed(async () => store.listDescendants(context,
        asDocumentId(documentId(collectionId, 1))));
      const allMs = await elapsed(async () => store.listAll(context));
      const closure = await database.pool.query<{ count: string }>(
        `SELECT count(*)::text count FROM ${q("_xecms_content_hierarchy_closure")}
          WHERE workspace_id=$1 AND collection_id=$2`, [DEFAULT_WORKSPACE_ID, collectionId],
      );
      results.push({ size, closureRows: Number(closure.rows[0]!.count), moveMs, rootsMs, childrenMs,
        ancestorsMs, descendantsMs, allMs, heapDeltaMb: mb(process.memoryUsage().heapUsed-beforeHeap) });
    }
    report("hierarchy", results);
    expect(results).toHaveLength(sizes.length);
  }, 240_000);

  it("measures unified audit pagination and captures the PostgreSQL execution plan", async () => {
    const perSourceSizes = numberList(process.env["XECMS_P2_AUDIT_PER_SOURCE_SIZES"], [10_000, 50_000]);
    const auditStore = new PostgresUnifiedAuditStore(database.pool, schema);
    const audit = new UnifiedAuditService(auditStore);
    const results = [];
    let seeded = 0;
    for (const size of perSourceSizes) {
      await seedAuditRange(seeded + 1, size);
      seeded = size;
      await database.pool.query(`ANALYZE ${q("_xecms_audit_log")}; ANALYZE ${q("_xecms_document_events")}; ANALYZE ${q("_xecms_auth_audit_log")}; ANALYZE ${q("_xecms_outbox_events")}; ANALYZE ${q("_xecms_event_deliveries")}`);
      let first!: Awaited<ReturnType<UnifiedAuditService["list"]>>;
      const firstPageMs = await elapsed(async () => { first = await audit.list({ workspaceId: DEFAULT_WORKSPACE_ID, limit: 100 }); });
      const cursorPageMs = await elapsed(async () => audit.list({ workspaceId: DEFAULT_WORKSPACE_ID,
        cursor: first.nextCursor!, limit: 100 }));
      const actorFilterMs = await elapsed(async () => audit.list({ workspaceId: DEFAULT_WORKSPACE_ID,
        actorId: ownerId, limit: 100 }));
      const unionSql = (auditStore as unknown as { unionSql(): string }).unionSql();
      const explained = await database.pool.query<{ "QUERY PLAN": Array<{ "Execution Time": number;
        "Planning Time": number; Plan: unknown }> }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${unionSql}
         SELECT * FROM unified WHERE workspace_id=$1
          ORDER BY occurred_at DESC,source_rank DESC,sort_id DESC LIMIT 101`,
        [DEFAULT_WORKSPACE_ID],
      );
      const plan = explained.rows[0]!["QUERY PLAN"][0]!;
      results.push({ perSource: size, unifiedRows: size*4, firstPageMs, cursorPageMs, actorFilterMs,
        explainExecutionMs: plan["Execution Time"], explainPlanningMs: plan["Planning Time"],
        planNodes: summarizePlan(plan.Plan) });
    }
    report("unified-audit", results);
    expect(results.every(({ unifiedRows }) => unifiedRows > 0)).toBe(true);
  }, 240_000);

  it("measures the current in-transaction Plugin JSONB export path", async () => {
    const sizes = numberList(process.env["XECMS_P2_PLUGIN_EXPORT_SIZES"], [10_000, 100_000]);
    const results = [];
    for (const size of sizes) {
      const id = `export-bench-${size}`;
      const table = `_xecms_plugin_${id.replaceAll("-", "_")}_rows`;
      const module = definePlugin({
        manifest: { manifestVersion: 1, id, packageName: `@test/${id}`, version: "1.0.0",
          displayName: `Export ${size}`, compatibility: { core: ">=0.5.0 <0.6.0",
            admin: ">=0.5.0 <0.6.0", sdk: "1.x" }, serverEntry: "server",
          migrations: [{ id: "0001_rows", checksum: `sha256:${id}:v1` }], dataTables: [table] },
        server: { migrations: [{ id: "0001_rows", checksum: `sha256:${id}:v1`,
          up: async ({ query, table: tableName }) => { await query(`CREATE TABLE ${tableName(table)}(id bigint PRIMARY KEY,payload text NOT NULL)`); },
          down: async ({ query, table: tableName }) => { await query(`DROP TABLE ${tableName(table)}`); } }] },
      });
      let planSequence = 0;
      const service = new PluginService(new PostgresPluginStore(database.pool, schema),
        new PluginCatalog([module]), { now: () => now, newPlanId: () => `${id}_plan_${++planSequence}`,
          loadedPluginIds: new Set() });
      const install = await service.preview({ workspaceId: DEFAULT_WORKSPACE_ID, pluginId: id,
        action: "install", expectedPluginRevision: null, actorIdentityId: ownerId });
      await service.apply({ workspaceId: DEFAULT_WORKSPACE_ID, planId: install.id, pluginId: id,
        expectedPluginRevision: null, actorIdentityId: ownerId, actorSubjectId: ownerId });
      await database.pool.query(`UPDATE ${q("_xecms_plugins")} SET desired_state='disabled',revision=2,restart_required=false WHERE workspace_id=$1 AND plugin_id=$2`,[DEFAULT_WORKSPACE_ID,id]);
      await database.pool.query(`INSERT INTO ${q(table)}(id,payload) SELECT value,repeat(md5(value::text),4) FROM generate_series(1,$1::int) value`,[size]);
      const preview = await service.preview({ workspaceId: DEFAULT_WORKSPACE_ID, pluginId: id,
        action: "uninstall", dataAction: "export", expectedPluginRevision: 2, actorIdentityId: ownerId });
      const beforeHeap = process.memoryUsage().heapUsed;
      let applied!: Awaited<ReturnType<PluginService["apply"]>>;
      const exportMs = await elapsed(async () => { applied = await service.apply({
        workspaceId: DEFAULT_WORKSPACE_ID, planId: preview.id, pluginId: id,
        expectedPluginRevision: 2, actorIdentityId: ownerId, actorSubjectId: ownerId,
      }); });
      const artifact = await database.pool.query<{ bytes: string }>(
        `SELECT pg_column_size(data)::text bytes FROM ${q("_xecms_plugin_exports")} WHERE id=$1`,
        [applied.exportId],
      );
      results.push({ rows: size, exportMs, artifactMb: mb(Number(artifact.rows[0]!.bytes)),
        heapDeltaMb: mb(process.memoryUsage().heapUsed-beforeHeap) });
    }
    report("plugin-export", results);
    expect(results).toHaveLength(sizes.length);
  }, 240_000);

  async function seedHierarchy(collectionId: string, size: number): Promise<void> {
    await database.pool.query(
      `INSERT INTO ${q("_xecms_documents")}
         (id,workspace_id,collection_id,current_draft_revision_id,publication,lifecycle,deletion,
          created_at,created_by,updated_at,updated_by,aggregate_version)
       SELECT $3||value,$1,$2,NULL,NULL,'{"kind":"active"}'::jsonb,NULL,$4,$5,$4,$5,1
         FROM generate_series(1,$6::int) value`,
      [DEFAULT_WORKSPACE_ID, collectionId, `${collectionId}_doc_`, now, ownerId, size],
    );
    await database.pool.query(`INSERT INTO ${q("_xecms_content_hierarchy_state")}(workspace_id,collection_id,structure_version,updated_at,updated_by) VALUES($1,$2,1,$3,$4)`,[DEFAULT_WORKSPACE_ID,collectionId,now,ownerId]);
    await database.pool.query(
      `WITH RECURSIVE tree(n,parent_n,depth) AS (
         VALUES(1,NULL::int,0)
         UNION ALL
         SELECT child.n,tree.n,tree.depth+1 FROM tree
         JOIN LATERAL generate_series((tree.n-1)*8+2,LEAST(tree.n*8+1,$3::int)) child(n) ON true
       )
       INSERT INTO ${q("_xecms_content_hierarchy_nodes")}
         (workspace_id,collection_id,document_id,parent_document_id,sort_key,depth)
       SELECT $1,$2,$4||n,CASE WHEN parent_n IS NULL THEN NULL ELSE $4||parent_n END,
              CASE WHEN parent_n IS NULL THEN 0 ELSE (n-2)%8 END,depth FROM tree`,
      [DEFAULT_WORKSPACE_ID, collectionId, size, `${collectionId}_doc_`],
    );
    await database.pool.query(
      `WITH RECURSIVE paths AS (
         SELECT workspace_id,collection_id,document_id ancestor_document_id,
                document_id descendant_document_id,0 distance
           FROM ${q("_xecms_content_hierarchy_nodes")} WHERE workspace_id=$1 AND collection_id=$2
         UNION ALL
         SELECT paths.workspace_id,paths.collection_id,paths.ancestor_document_id,
                child.document_id,paths.distance+1 FROM paths
         JOIN ${q("_xecms_content_hierarchy_nodes")} child
           ON child.workspace_id=paths.workspace_id AND child.collection_id=paths.collection_id
          AND child.parent_document_id=paths.descendant_document_id)
       INSERT INTO ${q("_xecms_content_hierarchy_closure")}
       SELECT workspace_id,collection_id,ancestor_document_id,descendant_document_id,distance FROM paths`,
      [DEFAULT_WORKSPACE_ID, collectionId],
    );
  }

  async function seedAuditRange(from: number, to: number): Promise<void> {
    if (from > to) return;
    const policy = await database.pool.query<{ revision: string }>(
      `SELECT max(revision)::text revision FROM ${q("_xecms_auth_policy_revisions")} WHERE realm_id=$1`,
      [SYSTEM_REALM_ID],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_audit_log")}(event_type,identity_id,occurred_at,metadata)
       SELECT 'benchmark.system',$1,$2::timestamptz-(value||' milliseconds')::interval,
              jsonb_build_object('workspaceId',$3::text,'sequence',value)
         FROM generate_series($4::int,$5::int) value`, [ownerId, now, DEFAULT_WORKSPACE_ID, from, to],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_document_events")}(document_id,event_type,aggregate_version,actor_id,occurred_at,payload)
       SELECT 'bench_doc_'||value,'document.updated',value,$1,$2::timestamptz-(value||' milliseconds')::interval,
              jsonb_build_object('sequence',value) FROM generate_series($3::int,$4::int) value`,
      [ownerId, now, from, to],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_audit_log")}(id,realm_id,policy_revision,actor_subject_id,
         action,target_type,target_id,decision,occurred_at)
       SELECT 'bench_auth_'||value,$1,$2,$3,'role.updated','role','bench_role_'||value,
              '{}'::jsonb,$4::timestamptz-(value||' milliseconds')::interval
         FROM generate_series($5::int,$6::int) value`,
      [SYSTEM_REALM_ID, Number(policy.rows[0]!.revision), ownerId, now, from, to],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_outbox_events")}(id,workspace_id,realm_id,topic,aggregate_type,
         aggregate_id,aggregate_version,actor_subject_id,actor_identity_id,occurred_at,payload,created_at,dispatched_at)
       SELECT 'bench_delivery_event_'||value,$1,$2,'document.updated','document','bench_doc_'||value,
              value,$3,$3,$4::timestamptz-(value||' milliseconds')::interval,
              '{"collectionId":"bench"}'::jsonb,$4::timestamptz-(value||' milliseconds')::interval,$4
         FROM generate_series($5::int,$6::int) value`,
      [DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, ownerId, now, from, to],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_event_deliveries")}(id,event_id,handler_id,status,attempts,max_attempts,
         available_at,last_error_code,last_error_message,created_at,updated_at,completed_at)
       SELECT 'bench_delivery_'||value,'bench_delivery_event_'||value,'benchmark','dead',8,8,
              $1,'BENCH','benchmark failure',$1,$1,$1 FROM generate_series($2::int,$3::int) value`,
      [now, from, to],
    );
  }
});

function documentId(collectionId: string, value: number): string { return `${collectionId}_doc_${value}`; }
async function elapsed(action: () => Promise<unknown>): Promise<number> {
  const started = performance.now(); await action(); return round(performance.now()-started);
}
function round(value: number): number { return Math.round(value*100)/100; }
function mb(bytes: number): number { return round(bytes/1024/1024); }
function numberList(raw: string|undefined, fallback: number[]): number[] {
  return raw?.split(",").map(Number).filter((value) => Number.isInteger(value)&&value>0) ?? fallback;
}
function report(name: string, result: unknown): void {
  console.info(`P2_BENCHMARK ${name} ${JSON.stringify(result)}`);
}
function summarizePlan(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const visit = (node: unknown): void => {
    if (typeof node!=="object"||node===null) return;
    const record=node as Record<string,unknown>,type=record["Node Type"];
    if(typeof type==="string") counts[type]=(counts[type]??0)+1;
    if(Array.isArray(record["Plans"])) for(const child of record["Plans"]) visit(child);
  };
  visit(value); return counts;
}
