import { describe, expect, it } from "vitest";
import type { PolicySnapshot } from "@xecms/authorization";
import {
  applyActionGate,
  entitlementAllowsReadField,
  entitlementAllowsWriteField,
  gateActionFor,
  resolveEntitlementCollectionId,
} from "./entitlement-gate.js";
import type { RealmCollectionEntitlement } from "./realm-collection-entitlements.js";

const REALM = "rlm_community";

/** Minimal snapshot: only `resources` (the only field the resolver touches). */
function snapshotWith(resources: readonly { readonly id: string; readonly parentId?: string }[]): PolicySnapshot {
  return {
    resources: new Map(resources.map((r) => [r.id, { id: r.id, realmId: REALM, ...(r.parentId === undefined ? {} : { parentId: r.parentId }) }])),
  } as unknown as PolicySnapshot;
}

function entitlement(overrides: Partial<RealmCollectionEntitlement> = {}): RealmCollectionEntitlement {
  return {
    workspaceId: "wrk_default", realmId: REALM, collectionId: "col_posts",
    actions: ["read", "update"], revision: 1, updatedAt: "2026-07-19T00:00:00.000Z", updatedBy: "u",
    ...overrides,
  };
}

const collectionPrefix = `authorization:${REALM}:resource:collection:`;
const documentPrefix = `authorization:${REALM}:resource:document:`;

describe("gateActionFor", () => {
  it("maps all 11 content actions and ignores others", () => {
    expect(gateActionFor("content.list")).toBe("list");
    expect(gateActionFor("content.revision.restore")).toBe("revision.restore");
    expect(gateActionFor("content.purge")).toBe("purge");
    expect(gateActionFor("authorization.manage")).toBeUndefined();
    expect(gateActionFor("schema.apply")).toBeUndefined();
  });
});

describe("resolveEntitlementCollectionId", () => {
  it("resolves a direct collection resource", () => {
    const res = resolveEntitlementCollectionId(snapshotWith([]), REALM, `${collectionPrefix}col_posts`);
    expect(res).toEqual({ kind: "collection", collectionId: "col_posts" });
  });

  it("walks a document parent chain to its collection (3 levels deep)", () => {
    const snap = snapshotWith([
      { id: `${collectionPrefix}col_pages` },
      { id: `${documentPrefix}root`, parentId: `${collectionPrefix}col_pages` },
      { id: `${documentPrefix}child`, parentId: `${documentPrefix}root` },
      { id: `${documentPrefix}grandchild`, parentId: `${documentPrefix}child` },
    ]);
    const res = resolveEntitlementCollectionId(snap, REALM, `${documentPrefix}grandchild`);
    expect(res).toEqual({ kind: "collection", collectionId: "col_pages" });
  });

  it("fails closed when a document chain breaks (retired-document → content root)", () => {
    // parentId points at the content core resource, not a collection → cannot resolve.
    const snap = snapshotWith([
      { id: `${documentPrefix}orphan`, parentId: `authorization:${REALM}:resource:content` },
    ]);
    expect(resolveEntitlementCollectionId(snap, REALM, `${documentPrefix}orphan`))
      .toEqual({ kind: "unresolved-content" });
  });

  it("fails closed for an unknown document resource (not in snapshot)", () => {
    expect(resolveEntitlementCollectionId(snapshotWith([]), REALM, `${documentPrefix}missing`))
      .toEqual({ kind: "unresolved-content" });
  });

  it("skips non-content resources", () => {
    for (const id of [`authorization:${REALM}:resource:schema`, `authorization:${REALM}:resource:authorization`, `authorization:${REALM}:resource:audit`]) {
      expect(resolveEntitlementCollectionId(snapshotWith([]), REALM, id)).toEqual({ kind: "skip" });
    }
  });
});

describe("applyActionGate", () => {
  const base = { actorSubjectId: "subject:alice" };

  it("denies when the ceiling is absent (no entitlement for the collection)", () => {
    expect(applyActionGate({ ...base, entitlement: undefined, gateAction: "read" }).kind).toBe("deny");
  });

  it("denies an action not in the ceiling and allows one that is", () => {
    const ent = entitlement({ actions: ["read"] });
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "update" }).kind).toBe("deny");
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read" }).kind).toBe("allow");
  });

  it("enforces ownerOnly (fail-closed on mismatch/missing owner)", () => {
    const ent = entitlement({ actions: ["read"], constraint: { ownerOnly: true } });
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read", ownerSubjectId: "subject:alice" }).kind).toBe("allow");
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read", ownerSubjectId: "subject:bob" }).kind).toBe("deny");
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read" }).kind).toBe("deny"); // owner missing
  });

  it("enforces status set (fail-closed on missing/out-of-set status)", () => {
    const ent = entitlement({ actions: ["read"], constraint: { statuses: ["published"] } });
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read", status: "published" }).kind).toBe("allow");
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read", status: "draft" }).kind).toBe("deny");
    expect(applyActionGate({ ...base, entitlement: ent, gateAction: "read" }).kind).toBe("deny"); // status missing
  });
});

describe("field ceiling (undefined = all fields)", () => {
  it("read: undefined allows any field; array restricts to includes", () => {
    expect(entitlementAllowsReadField(entitlement({}), "anything")).toBe(true);
    expect(entitlementAllowsReadField(entitlement({ readableFields: ["title"] }), "title")).toBe(true);
    expect(entitlementAllowsReadField(entitlement({ readableFields: ["title"] }), "secret")).toBe(false);
  });

  it("write: undefined allows any field; array restricts to includes", () => {
    expect(entitlementAllowsWriteField(entitlement({}), "anything")).toBe(true);
    expect(entitlementAllowsWriteField(entitlement({ writableFields: ["title"] }), "title")).toBe(true);
    expect(entitlementAllowsWriteField(entitlement({ writableFields: ["title"] }), "secret")).toBe(false);
  });
});
