import {
  asCollectionId,
  asDocumentId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
} from "@xecms/core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContentHierarchyStoreContext } from "@xecms/application";
import { quoteIdentifier, qualifiedName } from "./identifiers.js";
import { migrateContentHierarchy } from "./hierarchy-migration.js";
import { migrateCore } from "./migrate.js";
import { PostgresContentHierarchyStore } from "./postgres-hierarchy.js";

describe("PostgresContentHierarchyStore validation", () => {
  it("rejects unsafe PostgreSQL schema names before issuing a query", () => {
    expect(() => new PostgresContentHierarchyStore({} as Pool, "public; drop schema public"))
      .toThrow(/XECMS_DB_SCHEMA/);
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("PostgresContentHierarchyStore transactional forest", () => {
  const schema = `xecms_hierarchy_test_${crypto.randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  const store = new PostgresContentHierarchyStore(pool, schema);
  const context: ContentHierarchyStoreContext = {
    workspaceId: asWorkspaceId("wrk_default"),
    collectionId: asCollectionId("col_pages"),
  };
  const actorId = asSubjectId("subject_owner");
  const now = asUtcInstant("2026-07-15T00:00:00.000Z");
  const rootA = asDocumentId("doc_root_a");
  const rootB = asDocumentId("doc_root_b");
  const child = asDocumentId("doc_child");
  const grandchild = asDocumentId("doc_grandchild");
  const otherCollectionParent = asDocumentId("doc_other_parent");

  beforeAll(async () => {
    await migrateCore(pool, schema);
    await migrateContentHierarchy(pool, schema);
    await migrateContentHierarchy(pool, schema);
    for (const [documentId, collectionId] of [
      [rootA, "col_pages"],
      [rootB, "col_pages"],
      [child, "col_pages"],
      [grandchild, "col_pages"],
      [otherCollectionParent, "col_other"],
    ] as const) {
      await insertDocument(pool, schema, documentId, collectionId);
    }
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("creates a forest and serves lazy/tree/closure-backed queries", async () => {
    await store.addNode(context, metadata(0, { documentId: rootA, parentId: null, position: 0 }));
    await store.addNode(context, metadata(1, { documentId: rootB, parentId: null, position: 1 }));
    await store.addNode(context, metadata(2, { documentId: child, parentId: rootA, position: 0 }));
    await store.addNode(context, metadata(3, { documentId: grandchild, parentId: child, position: 0 }));

    await expect(store.listRoots(context)).resolves.toMatchObject({
      version: 4,
      items: [
        { documentId: rootA, parentId: null, sortKey: 0, depth: 0 },
        { documentId: rootB, parentId: null, sortKey: 1, depth: 0 },
      ],
    });
    expect((await store.listChildren(context, rootA)).items.map(({ documentId }) => documentId)).toEqual([child]);
    expect((await store.listAncestors(context, grandchild)).items.map(({ documentId }) => documentId))
      .toEqual([rootA, child]);
    expect((await store.listDescendants(context, rootA)).items.map(({ documentId }) => documentId))
      .toEqual([child, grandchild]);
    expect((await store.getSubtree(context, child)).items.map(({ documentId }) => documentId))
      .toEqual([child, grandchild]);

    const closure = await pool.query<{ ancestor_document_id: string; descendant_document_id: string; distance: number }>(
      `SELECT ancestor_document_id, descendant_document_id, distance
       FROM ${qualifiedName(schema, "_xecms_content_hierarchy_closure")}
       WHERE workspace_id = $1 AND collection_id = $2
       ORDER BY ancestor_document_id, descendant_document_id`,
      [context.workspaceId, context.collectionId],
    );
    expect(closure.rows).toContainEqual({
      ancestor_document_id: rootA,
      descendant_document_id: grandchild,
      distance: 2,
    });
  });

  it("moves and reorders atomically while rebuilding closure and preserving an audit trail", async () => {
    const moved = await store.moveNode(context, metadata(4, {
      documentId: child,
      newParentId: rootB,
      position: 0,
      maxDepth: 2,
    }));
    expect(moved.state.version).toBe(5);
    expect(moved.event).toMatchObject({
      type: "tree.node.moved",
      affectedDocumentIds: [child, grandchild],
      before: { path: [rootA, child] },
      after: { path: [rootB, child] },
    });
    await store.reorderChildren(context, metadata(5, {
      parentId: null,
      orderedDocumentIds: [rootB, rootA],
    }));

    expect((await store.listRoots(context)).items.map(({ documentId }) => documentId)).toEqual([rootB, rootA]);
    expect((await store.listAncestors(context, grandchild)).items.map(({ documentId }) => documentId))
      .toEqual([rootB, child]);
    const staleClosure = await pool.query(
      `SELECT 1 FROM ${qualifiedName(schema, "_xecms_content_hierarchy_closure")}
       WHERE workspace_id = $1 AND collection_id = $2
         AND ancestor_document_id = $3 AND descendant_document_id = $4`,
      [context.workspaceId, context.collectionId, rootA, grandchild],
    );
    expect(staleClosure.rowCount).toBe(0);
    const events = await pool.query<{ event_type: string; structure_version: string }>(
      `SELECT event_type, structure_version::text
       FROM ${qualifiedName(schema, "_xecms_content_hierarchy_events")}
       ORDER BY structure_version`,
    );
    expect(events.rows.map(({ event_type, structure_version }) => [event_type, structure_version])).toEqual([
      ["tree.node.created", "1"],
      ["tree.node.created", "2"],
      ["tree.node.created", "3"],
      ["tree.node.created", "4"],
      ["tree.node.moved", "5"],
      ["tree.node.reordered", "6"],
    ]);
  });

  it("rolls back cycle, cross-collection, max-depth and stale-version failures", async () => {
    const before = await store.getSubtree(context, rootB);
    await expect(store.moveNode(context, metadata(6, {
      documentId: rootB,
      newParentId: grandchild,
      position: 0,
      maxDepth: 5,
    }))).rejects.toMatchObject({ code: "HIERARCHY_CYCLE" });
    await expect(store.moveNode(context, metadata(6, {
      documentId: rootA,
      newParentId: otherCollectionParent,
      position: 0,
      maxDepth: 5,
    }))).rejects.toMatchObject({ code: "HIERARCHY_CROSS_COLLECTION_PARENT" });
    await expect(store.moveNode(context, metadata(6, {
      documentId: rootA,
      newParentId: grandchild,
      position: 0,
      maxDepth: 2,
    }))).rejects.toMatchObject({ code: "HIERARCHY_MAX_DEPTH_EXCEEDED" });
    await expect(store.moveNode(context, metadata(5, {
      documentId: rootA,
      newParentId: null,
      position: 1,
    }))).rejects.toMatchObject({ code: "HIERARCHY_VERSION_CONFLICT" });

    expect(await store.getSubtree(context, rootB)).toEqual(before);
    const eventCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${qualifiedName(schema, "_xecms_content_hierarchy_events")}`,
    );
    expect(eventCount.rows[0]?.count).toBe("6");
  });

  it("serializes concurrent writers so one stale expected version loses without partial changes", async () => {
    const attempts = await Promise.allSettled([
      store.reorderChildren(context, metadata(6, { parentId: null, orderedDocumentIds: [rootA, rootB] })),
      store.reorderChildren(context, metadata(6, { parentId: null, orderedDocumentIds: [rootB, rootA] })),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "HIERARCHY_VERSION_CONFLICT" },
    });
    expect((await store.listRoots(context)).version).toBe(7);
  });
});

function metadata<T extends object>(expectedVersion: number, value: T): T & {
  readonly expectedVersion: number;
  readonly actorId: ReturnType<typeof asSubjectId>;
  readonly now: ReturnType<typeof asUtcInstant>;
} {
  return { ...value, expectedVersion, actorId: asSubjectId("subject_owner"), now: asUtcInstant("2026-07-15T00:00:00.000Z") };
}

async function insertDocument(
  pool: Pool,
  schema: string,
  documentId: string,
  collectionId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ${qualifiedName(schema, "_xecms_documents")}
       (id, workspace_id, collection_id, current_draft_revision_id, publication, lifecycle,
        deletion, created_at, created_by, updated_at, updated_by, aggregate_version)
     VALUES ($1, 'wrk_default', $2, NULL, NULL, '{"kind":"active"}'::jsonb,
             NULL, $3, 'subject_owner', $3, 'subject_owner', 1)`,
    [documentId, collectionId, "2026-07-15T00:00:00.000Z"],
  );
}

