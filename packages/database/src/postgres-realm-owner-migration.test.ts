import { randomUUID } from "node:crypto";

import { createInitialAuthorizationPolicy } from "@xecms/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID, SYSTEM_REALM_ID } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresIdentityRealmStore } from "./postgres-identity-realms.js";
import { PostgresDatabase } from "./postgres.js";
import { applyRealmOwnerModelMigration } from "./realm-owner-migration.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const NOW = "2026-07-18T09:00:00.000Z";
const CMS_OWNER_ID = "usr_realm_owner_migration_cms_owner";
const ELIGIBLE_REALM_ID = "rlm_owner_migration_eligible";

interface LegacyRealmCase {
  readonly realmId: string;
  readonly identityId: string;
  readonly contentMembershipStatus?: "active" | "suspended";
  readonly systemMembershipStatus?: "active" | "suspended";
  readonly identityKind?: "human" | "service";
  readonly disabled?: boolean;
  readonly damageCanonicalRoot?: boolean;
  readonly damageLegacyOwnerBinding?: boolean;
}

describe.runIf(RUN)("Realm Owner model PostgreSQL migration", () => {
  const schema = `xecms_realm_owner_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({
    connectionString: DATABASE_URL,
    schema,
    maxConnections: 3,
  });
  const identities = new PostgresIdentityRealmStore(database.pool, schema);
  const authorization = new PostgresAuthorizationStore(database.pool, schema);
  const q = (name: string): string => qualifiedName(schema, name);
  const ineligibleCases: readonly LegacyRealmCase[] = [
    {
      realmId: "rlm_owner_migration_disabled_identity",
      identityId: "usr_owner_migration_disabled_identity",
      disabled: true,
    },
    {
      realmId: "rlm_owner_migration_suspended_content",
      identityId: "usr_owner_migration_suspended_content",
      contentMembershipStatus: "suspended",
    },
    {
      realmId: "rlm_owner_migration_suspended_system",
      identityId: "usr_owner_migration_suspended_system",
      systemMembershipStatus: "suspended",
    },
    {
      realmId: "rlm_owner_migration_service_identity",
      identityId: "usr_owner_migration_service_identity",
      identityKind: "service",
    },
    {
      realmId: "rlm_owner_migration_cms_owner",
      identityId: CMS_OWNER_ID,
    },
  ];

  beforeAll(async () => {
    await database.migrate();
    await database.createInitialOwner({
      id: CMS_OWNER_ID,
      username: "realm-owner-migration-cms-owner",
      passwordHash: "hash",
      now: NOW,
    });
    await createSystemMembership(CMS_OWNER_ID, "active");

    const eligible: LegacyRealmCase = {
      realmId: ELIGIBLE_REALM_ID,
      identityId: "usr_owner_migration_eligible",
      damageCanonicalRoot: true,
      damageLegacyOwnerBinding: true,
    };
    for (const testCase of [eligible, ...ineligibleCases]) {
      if (testCase.identityId !== CMS_OWNER_ID) {
        await identities.createIdentity({
          id: testCase.identityId,
          workspaceId: DEFAULT_WORKSPACE_ID,
          originRealmId: SYSTEM_REALM_ID,
          primaryIdentifier: `${testCase.identityId}@example.test`,
          normalizedIdentifier: `${testCase.identityId}@example.test`,
          passwordHash: "hash",
          actorId: CMS_OWNER_ID,
          now: NOW,
        });
        if (testCase.identityKind === "service") {
          await database.pool.query(
            `UPDATE ${q("_xecms_identities")} SET identity_kind = 'service' WHERE id = $1`,
            [testCase.identityId],
          );
        }
        await createSystemMembership(
          testCase.identityId,
          testCase.systemMembershipStatus ?? "active",
        );
      }
      await createLegacyRealm(testCase);
      if (testCase.disabled === true) {
        await database.pool.query(
          `UPDATE ${q("_xecms_identities")} SET disabled_at = $2 WHERE id = $1`,
          [testCase.identityId, NOW],
        );
      }
    }

    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await applyRealmOwnerModelMigration(client, schema);
      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await database.close();
  });

  it("promotes only an active human legacy owner to the canonical Primary Owner binding", async () => {
    const rootResourceId = `authorization:${ELIGIBLE_REALM_ID}:resource:workspace`;
    const result = await database.pool.query<{
      readonly id: string;
      readonly subject_id: string;
      readonly role_id: string;
      readonly resource_id: string;
      readonly propagation: string;
      readonly valid_from: Date | null;
      readonly valid_until: Date | null;
      readonly constraints: Record<string, unknown>;
      readonly protected: boolean;
    }>(
      `SELECT id, subject_id, role_id, resource_id, propagation, valid_from, valid_until,
              constraints, protected
         FROM ${q("_xecms_auth_role_bindings")}
        WHERE realm_id = $1
          AND id IN ($2, $3)
        ORDER BY id`,
      [
        ELIGIBLE_REALM_ID,
        `authorization:${ELIGIBLE_REALM_ID}:binding:owner`,
        `authorization:${ELIGIBLE_REALM_ID}:binding:primary-owner`,
      ],
    );

    expect(result.rows).toEqual([{
      id: `authorization:${ELIGIBLE_REALM_ID}:binding:primary-owner`,
      subject_id: "subject_usr_owner_migration_eligible",
      role_id: `authorization:${ELIGIBLE_REALM_ID}:role:owner`,
      resource_id: rootResourceId,
      propagation: "self-and-children",
      valid_from: null,
      valid_until: null,
      constraints: {},
      protected: true,
    }]);
  });

  it("removes legacy Owner bindings for every ineligible identity", async () => {
    const realmIds = ineligibleCases.map(({ realmId }) => realmId);
    const result = await database.pool.query<{ readonly realm_id: string; readonly id: string }>(
      `SELECT realm_id, id
         FROM ${q("_xecms_auth_role_bindings")}
        WHERE realm_id = ANY($1::text[])
          AND id = ANY(ARRAY[
            'authorization:' || realm_id || ':binding:owner',
            'authorization:' || realm_id || ':binding:primary-owner'
          ])
        ORDER BY realm_id, id`,
      [realmIds],
    );
    expect(result.rows).toEqual([]);
  });

  it("repairs partially damaged canonical System Policy Root objects", async () => {
    const prefix = `authorization:${ELIGIBLE_REALM_ID}`;
    const level = await database.pool.query<{
      readonly name: string;
      readonly rank: string;
      readonly protected: boolean;
      readonly updated_by: string;
    }>(
      `SELECT name, rank, protected, updated_by
         FROM ${q("_xecms_auth_authority_levels")}
        WHERE realm_id = $1 AND id = $2`,
      [ELIGIBLE_REALM_ID, `${prefix}:level:system-policy-root`],
    );
    expect(level.rows).toEqual([{
      name: "System Policy Root",
      rank: "110",
      protected: true,
      updated_by: `${prefix}:subject:provisioner`,
    }]);

    const role = await database.pool.query<{
      readonly level_id: string;
      readonly name: string;
      readonly description: string | null;
      readonly protected: boolean;
      readonly field_access_restricted: boolean;
      readonly updated_by: string;
    }>(
      `SELECT level_id, name, description, protected, field_access_restricted, updated_by
         FROM ${q("_xecms_auth_roles")}
        WHERE realm_id = $1 AND id = $2`,
      [ELIGIBLE_REALM_ID, `${prefix}:role:system-policy-root`],
    );
    expect(role.rows).toEqual([{
      level_id: `${prefix}:level:system-policy-root`,
      name: "System Policy Root",
      description: "Internal trusted policy root; not assignable or visible.",
      protected: true,
      field_access_restricted: false,
      updated_by: `${prefix}:subject:provisioner`,
    }]);

    const binding = await database.pool.query<{
      readonly subject_id: string;
      readonly role_id: string;
      readonly resource_id: string;
      readonly propagation: string;
      readonly valid_from: Date | null;
      readonly valid_until: Date | null;
      readonly constraints: Record<string, unknown>;
      readonly protected: boolean;
      readonly updated_by: string;
    }>(
      `SELECT subject_id, role_id, resource_id, propagation, valid_from, valid_until,
              constraints, protected, updated_by
         FROM ${q("_xecms_auth_role_bindings")}
        WHERE realm_id = $1 AND id = $2`,
      [ELIGIBLE_REALM_ID, `${prefix}:binding:system-policy-root`],
    );
    expect(binding.rows).toEqual([{
      subject_id: `${prefix}:subject:provisioner`,
      role_id: `${prefix}:role:system-policy-root`,
      resource_id: `${prefix}:resource:workspace`,
      propagation: "self-and-children",
      valid_from: null,
      valid_until: null,
      constraints: {},
      protected: true,
      updated_by: `${prefix}:subject:provisioner`,
    }]);
  });

  async function createSystemMembership(
    identityId: string,
    status: "active" | "suspended",
  ): Promise<void> {
    const subjectId = `system_subject_${identityId}`;
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, protected,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, 'user', $3, false, $4, $5, $4, $5)`,
      [subjectId, SYSTEM_REALM_ID, identityId, NOW, CMS_OWNER_ID],
    );
    await identities.createMembership({
      id: `system_membership_${identityId}`,
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId,
      realmId: SYSTEM_REALM_ID,
      subjectId,
      status,
      provisionedBy: "explicit",
      actorIdentityId: CMS_OWNER_ID,
      now: NOW,
    });
  }

  async function createLegacyRealm(testCase: LegacyRealmCase): Promise<void> {
    const prefix = `authorization:${testCase.realmId}`;
    const rootResourceId = `${prefix}:resource:workspace`;
    const realm = await identities.createRealm({
      id: testCase.realmId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      key: testCase.realmId.replace("rlm_", "").replaceAll("_", "-"),
      name: testCase.realmId,
      authentication: {
        acceptSystemIdentities: true,
        provisioning: "explicit",
        registration: "closed",
        defaultRoleIds: [],
      },
      actorIdentityId: CMS_OWNER_ID,
      now: NOW,
    });
    await identities.updateRealm({
      realmId: realm.id,
      expectedRevision: realm.revision,
      name: realm.name,
      status: "active",
      authentication: realm.authentication,
      actorIdentityId: CMS_OWNER_ID,
      now: NOW,
    });
    await authorization.initialize({
      realmId: testCase.realmId,
      expectedRevision: null,
      state: createInitialAuthorizationPolicy({
        realmId: testCase.realmId,
        realmName: testCase.realmId,
        rootResourceId,
        rootResourceName: testCase.realmId,
        ownerSubjectId: `${prefix}:subject:provisioner`,
        ownerSubjectType: "service-account",
        ownerSubjectName: "Realm authorization provisioner",
      }),
      audit: {
        id: `audit_initialize_${testCase.realmId}`,
        actorSubjectId: `${prefix}:subject:provisioner`,
        action: "policy.initialize",
        targetType: "policy",
        targetId: testCase.realmId,
        before: null,
        after: { realmId: testCase.realmId },
        decision: null,
        occurredAt: NOW,
      },
    });

    const subjectId = `subject_${testCase.identityId}`;
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_subjects")}
         (id, realm_id, subject_type, display_name, protected,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, 'user', $3, false, $4, $5, $4, $5)`,
      [subjectId, testCase.realmId, testCase.identityId, NOW, CMS_OWNER_ID],
    );
    await identities.createMembership({
      id: `content_membership_${testCase.identityId}`,
      workspaceId: DEFAULT_WORKSPACE_ID,
      identityId: testCase.identityId,
      realmId: testCase.realmId,
      subjectId,
      status: testCase.contentMembershipStatus ?? "active",
      provisionedBy: "explicit",
      actorIdentityId: CMS_OWNER_ID,
      now: NOW,
    });

    await database.pool.query(
      `UPDATE ${q("_xecms_auth_role_bindings")}
          SET subject_id = $3
        WHERE realm_id = $1 AND id = $2`,
      [testCase.realmId, `${prefix}:binding:owner`, subjectId],
    );
    if (testCase.damageLegacyOwnerBinding === true) {
      await database.pool.query(
        `UPDATE ${q("_xecms_auth_role_bindings")}
            SET role_id = $3,
                resource_id = $4,
                propagation = 'self',
                valid_from = $5,
                valid_until = $6,
                constraints = '{"legacy":"damaged"}'::jsonb,
                protected = false
          WHERE realm_id = $1 AND id = $2`,
        [
          testCase.realmId,
          `${prefix}:binding:owner`,
          `${prefix}:role:viewer`,
          `${prefix}:resource:schema`,
          "2026-07-18T09:00:00.000Z",
          "2026-07-18T10:00:00.000Z",
        ],
      );
    }
    if (testCase.damageCanonicalRoot === true) {
      await damageCanonicalRoot(testCase.realmId);
    }
  }

  async function damageCanonicalRoot(realmId: string): Promise<void> {
    const prefix = `authorization:${realmId}`;
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_authority_levels")}
         (id, realm_id, name, rank, protected, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, 'Damaged System Root', 109, false, $3, $4, $3, $4)`,
      [`${prefix}:level:system-policy-root`, realmId, NOW, CMS_OWNER_ID],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_roles")}
         (id, realm_id, level_id, name, description, protected, field_access_restricted,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, 'Damaged System Role', 'damaged', false, true,
               $4, $5, $4, $5)`,
      [
        `${prefix}:role:system-policy-root`,
        realmId,
        `${prefix}:level:editor`,
        NOW,
        CMS_OWNER_ID,
      ],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_role_bindings")}
         (id, realm_id, subject_id, role_id, resource_id, propagation, valid_from,
          valid_until, constraints, protected, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'self', $6, $7, '{"damaged":true}'::jsonb,
               false, $6, $8, $6, $8)`,
      [
        `${prefix}:binding:system-policy-root`,
        realmId,
        `${prefix}:subject:public`,
        `${prefix}:role:system-policy-root`,
        rootResourceId(realmId),
        "2026-07-18T09:00:00.000Z",
        "2026-07-18T10:00:00.000Z",
        CMS_OWNER_ID,
      ],
    );
  }
});

function rootResourceId(realmId: string): string {
  return `authorization:${realmId}:resource:workspace`;
}
