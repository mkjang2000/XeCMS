import { randomUUID } from "node:crypto";

import {
  createInitialAuthorizationPolicy,
  type AuthorizationAuditDraft,
} from "@xecms/application";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, migrateCore } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";

describe("PostgresAuthorizationStore validation", () => {
  it("rejects an unsafe PostgreSQL schema before issuing a query", () => {
    expect(
      () => new PostgresAuthorizationStore({} as Pool, "public; drop schema public"),
    ).toThrow(/XECMS_DB_SCHEMA/);
  });

  it("rejects invalid audit pagination without touching PostgreSQL", async () => {
    const store = new PostgresAuthorizationStore({} as Pool, "xecms");
    await expect(store.listAudit({ realmId: SYSTEM_REALM_ID, limit: 0 })).rejects.toMatchObject({
      code: "AUDIT_PAGE_INVALID",
      status: 400,
    });
  });
});

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("PostgresAuthorizationStore normalized policy transaction", () => {
  const schema = `xecms_auth_test_${randomUUID().replaceAll("-", "_")}`;
  const pool = new Pool({ connectionString: DATABASE_URL });
  const store = new PostgresAuthorizationStore(pool, schema);
  const ownerId = "subject_test_owner";
  const ownerIdentityId = "identity_test_owner";
  const rootResourceId = "resource_test_root";
  let auditSequence = 0;

  const audit = (
    action: string,
    targetType: AuthorizationAuditDraft["targetType"],
    targetId: string,
  ): AuthorizationAuditDraft => ({
    id: `audit_${++auditSequence}`,
    actorSubjectId: ownerId,
    action,
    targetType,
    targetId,
    before: null,
    after: { targetId },
    decision: null,
    occurredAt: new Date(Date.UTC(2026, 6, 15, 0, auditSequence)).toISOString(),
  });

  beforeAll(async () => {
    await migrateCore(pool, schema);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it("initializes, CAS-mutates, rebuilds group closure, and audits atomically", async () => {
    expect(await store.getPolicyRevision(SYSTEM_REALM_ID)).toBeNull();
    await pool.query(
      `INSERT INTO ${quoteIdentifier(schema)}."_xecms_identities"
         (id, workspace_id, realm_id, username, normalized_username, password_hash,
          is_owner, created_at)
       VALUES ($1, $2, $3, $4, $4, $5, true, $6)`,
      [ownerIdentityId, DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, "authorization-owner",
        "test-password-hash", "2026-07-15T00:00:00.000Z"],
    );
    const seed = createInitialAuthorizationPolicy({
      realmId: SYSTEM_REALM_ID,
      realmName: "System Realm",
      rootResourceId,
      rootResourceName: "System",
      ownerSubjectId: ownerId,
      ownerIdentityId,
      ownerSubjectName: "Owner",
    });
    const restrictedRole = {
      id: "role_deny_all_fields",
      realmId: SYSTEM_REALM_ID,
      levelId: seed.authorityLevels.find(({ rank }) => rank === 10)!.id,
      name: "No fields",
      permissions: ["content.read"],
      delegatablePermissions: [],
      fieldAccess: [],
    };
    const initialized = await store.initialize({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: null,
      state: { ...seed, roles: [...seed.roles, restrictedRole] },
      audit: audit("policy.initialize", "policy", SYSTEM_REALM_ID),
    });
    expect(initialized).toMatchObject({
      revision: 1,
      realm: { id: SYSTEM_REALM_ID, rootResourceId },
    });
    expect(initialized.subjects.find(({ id }) => id === ownerId)).toMatchObject({
      id: ownerId,
      identityId: ownerIdentityId,
    });
    expect(initialized.roles.length).toBeGreaterThan(1);
    expect(initialized.roles.find(({ id }) => id === restrictedRole.id)?.fieldAccess).toEqual([]);
    expect(await store.getPolicyRevision(SYSTEM_REALM_ID)).toBe(1);

    const groupA = {
      id: "subject_group_a",
      realmId: SYSTEM_REALM_ID,
      name: "Group A",
      type: "group" as const,
    };
    const afterGroupA = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 1,
      mutation: { type: "subject.create", value: groupA },
      audit: audit("subject.create", "subject", groupA.id),
    });
    expect(afterGroupA.revision).toBe(2);

    const groupB = {
      id: "subject_group_b",
      realmId: SYSTEM_REALM_ID,
      name: "Group B",
      type: "group" as const,
    };
    await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 2,
      mutation: { type: "subject.create", value: groupB },
      audit: audit("subject.create", "subject", groupB.id),
    });
    const nested = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 3,
      mutation: {
        type: "group-membership.create",
        value: {
          id: "membership_a_b",
          realmId: SYSTEM_REALM_ID,
          groupSubjectId: groupA.id,
          memberSubjectId: groupB.id,
        },
      },
      audit: audit("group-membership.create", "group-membership", "membership_a_b"),
    });
    expect(nested.revision).toBe(4);

    const closure = await pool.query<{ depth: number; membership_path: string[] }>(
      `SELECT depth, membership_path
       FROM ${quoteIdentifier(schema)}."_xecms_auth_group_ancestors"
       WHERE realm_id = $1 AND ancestor_group_id = $2 AND descendant_subject_id = $3`,
      [SYSTEM_REALM_ID, groupA.id, groupB.id],
    );
    expect(closure.rows[0]).toEqual({
      depth: 1,
      membership_path: [groupA.id, groupB.id],
    });

    await expect(
      store.mutatePolicy({
        realmId: SYSTEM_REALM_ID,
        expectedRevision: 4,
        mutation: {
          type: "group-membership.create",
          value: {
            id: "membership_b_a_cycle",
            realmId: SYSTEM_REALM_ID,
            groupSubjectId: groupB.id,
            memberSubjectId: groupA.id,
          },
        },
        audit: audit("group-membership.create", "group-membership", "membership_b_a_cycle"),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_GROUP_CYCLE", status: 422 });
    expect(await store.getPolicyRevision(SYSTEM_REALM_ID)).toBe(4);

    await expect(
      store.mutatePolicy({
        realmId: SYSTEM_REALM_ID,
        expectedRevision: 3,
        mutation: { type: "subject.delete", id: groupB.id },
        audit: audit("subject.delete", "subject", groupB.id),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_POLICY_REVISION_CONFLICT", status: 409 });
    expect(await store.getPolicyRevision(SYSTEM_REALM_ID)).toBe(4);

    const childResource = {
      id: "resource_test_child",
      realmId: SYSTEM_REALM_ID,
      name: "Child",
      type: "test",
      parentId: rootResourceId,
    };
    const childAudit = audit("resource.upsert", "resource", childResource.id);
    const withChild = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 4,
      mutation: { type: "resource.upsert", value: childResource },
      audit: { ...childAudit, actorSubjectId: groupA.id },
    });
    expect(withChild.revision).toBe(5);
    const resourceClosure = await pool.query<{ depth: number }>(
      `SELECT depth FROM ${quoteIdentifier(schema)}."_xecms_auth_resource_ancestors"
       WHERE realm_id = $1 AND ancestor_resource_id = $2 AND descendant_resource_id = $3`,
      [SYSTEM_REALM_ID, rootResourceId, childResource.id],
    );
    expect(resourceClosure.rows[0]?.depth).toBe(1);

    const currentRoot = withChild.resources.find(({ id }) => id === rootResourceId)!;
    await expect(
      store.mutatePolicy({
        realmId: SYSTEM_REALM_ID,
        expectedRevision: 5,
        mutation: {
          type: "resource.upsert",
          value: { ...currentRoot, parentId: childResource.id },
        },
        audit: audit("resource.upsert", "resource", rootResourceId),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_RESOURCE_CYCLE", status: 422 });
    expect(await store.getPolicyRevision(SYSTEM_REALM_ID)).toBe(5);

    const afterGroupDelete = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 5,
      mutation: { type: "subject.delete", id: groupA.id },
      audit: audit("subject.delete", "subject", groupA.id),
    });
    expect(afterGroupDelete.revision).toBe(6);
    expect(afterGroupDelete.subjects.some(({ id }) => id === groupA.id)).toBe(false);
    const removedClosure = await pool.query(
      `SELECT 1 FROM ${quoteIdentifier(schema)}."_xecms_auth_group_ancestors"
       WHERE realm_id = $1 AND ancestor_group_id = $2`,
      [SYSTEM_REALM_ID, groupA.id],
    );
    expect(removedClosure.rowCount).toBe(0);

    const audits = await store.listAudit({ realmId: SYSTEM_REALM_ID, limit: 20 });
    expect(audits.items).toHaveLength(6);
    expect(audits.items.map(({ revision }) => revision)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(audits.items[0]).toMatchObject({
      action: "subject.delete",
      decision: null,
    });
    expect(audits.items.find(({ revision }) => revision === 5)?.actorSubjectId).toBe(groupA.id);

    const collection = {
      id: "resource:collection:pages",
      realmId: SYSTEM_REALM_ID,
      name: "Pages",
      type: "collection",
      parentId: rootResourceId,
    };
    const pageRoot = {
      id: "resource:document:root",
      realmId: SYSTEM_REALM_ID,
      name: "Root",
      type: "document",
      parentId: collection.id,
    };
    const pageChild = {
      id: "resource:document:child",
      realmId: SYSTEM_REALM_ID,
      name: "Child",
      type: "document",
      parentId: pageRoot.id,
    };
    const projected = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 6,
      mutation: { type: "resource.reconcile", upserts: [collection, pageRoot, pageChild], deleteIds: [] },
      audit: audit("resource.reconcile", "policy", "content-hierarchy-resources"),
    });
    expect(projected.revision).toBe(7);
    const viewer = projected.roles.find(({ name }) => name === "Viewer")!;
    const withFieldRule = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 7,
      mutation: {
        type: "role.update",
        value: {
          ...viewer,
          fieldAccess: [{ resourceId: pageChild.id, readableFields: ["title"], writableFields: [] }],
        },
      },
      audit: audit("role.update", "role", viewer.id),
    });
    await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: withFieldRule.revision,
      mutation: {
        type: "binding.create",
        value: {
          id: "binding_child_viewer",
          realmId: SYSTEM_REALM_ID,
          subjectId: groupB.id,
          roleId: viewer.id,
          resourceId: pageChild.id,
          propagation: "self",
        },
      },
      audit: audit("binding.create", "binding", "binding_child_viewer"),
    });
    await expect(store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 9,
      mutation: { type: "resource.reconcile", upserts: [], deleteIds: [pageChild.id] },
      audit: audit("resource.reconcile", "policy", "content-hierarchy-resources"),
    })).rejects.toMatchObject({
      code: "AUTHORIZATION_RESOURCE_REFERENCED",
      status: 409,
    });
    const preservedProjection = await store.loadPolicy(SYSTEM_REALM_ID);
    expect(preservedProjection?.resources.some(({ id }) => id === pageChild.id)).toBe(true);
    expect(preservedProjection?.bindings.some(({ id }) => id === "binding_child_viewer")).toBe(true);
    expect(preservedProjection?.roles.find(({ id }) => id === viewer.id)?.fieldAccess).toEqual([
      { resourceId: pageChild.id, readableFields: ["title"], writableFields: [] },
    ]);
    expect(await store.getPolicyRevision(SYSTEM_REALM_ID)).toBe(9);

    const firstIdentityId = "identity_external_first";
    const secondIdentityId = "identity_external_second";
    for (const [identityId, username] of [
      [firstIdentityId, "external-first"],
      [secondIdentityId, "external-second"],
    ] as const) {
      await pool.query(
        `INSERT INTO ${quoteIdentifier(schema)}."_xecms_identities"
           (id, workspace_id, realm_id, username, normalized_username, password_hash,
            is_owner, created_at)
         VALUES ($1, $2, $3, $4, $4, $5, false, $6)`,
        [identityId, DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID, username,
          "test-password-hash", "2026-07-15T01:00:00.000Z"],
      );
    }
    const decoupledSubject = {
      id: "subject_decoupled_from_identity",
      realmId: SYSTEM_REALM_ID,
      identityId: firstIdentityId,
      name: "Decoupled subject",
      type: "user" as const,
    };
    const withDecoupledSubject = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: 9,
      mutation: { type: "subject.create", value: decoupledSubject },
      audit: audit("subject.create", "subject", decoupledSubject.id),
    });
    expect(withDecoupledSubject.subjects.find(({ id }) => id === decoupledSubject.id))
      .toMatchObject({ identityId: firstIdentityId });
    expect((await pool.query(
      `SELECT 1 FROM ${quoteIdentifier(schema)}."_xecms_identities" WHERE id = $1`,
      [decoupledSubject.id],
    )).rowCount).toBe(0);

    const relinked = await store.mutatePolicy({
      realmId: SYSTEM_REALM_ID,
      expectedRevision: withDecoupledSubject.revision,
      mutation: {
        type: "subject.update",
        value: {
          ...decoupledSubject,
          identityId: secondIdentityId,
          name: "Relinked decoupled subject",
        },
      },
      audit: audit("subject.update", "subject", decoupledSubject.id),
    });
    expect(relinked.subjects.find(({ id }) => id === decoupledSubject.id)).toMatchObject({
      id: decoupledSubject.id,
      identityId: secondIdentityId,
      name: "Relinked decoupled subject",
    });
    const linkedRow = await pool.query<{ identity_id: string | null }>(
      `SELECT identity_id FROM ${quoteIdentifier(schema)}."_xecms_auth_subjects"
       WHERE realm_id = $1 AND id = $2`,
      [SYSTEM_REALM_ID, decoupledSubject.id],
    );
    expect(linkedRow.rows[0]?.identity_id).toBe(secondIdentityId);
  }, 30_000);
});
