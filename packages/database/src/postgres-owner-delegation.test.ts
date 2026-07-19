import { randomUUID } from "node:crypto";

import {
  AuthorizationApplicationService,
  SYSTEM_WORKSPACE_RESOURCE_ID,
} from "@xecms/application";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { qualifiedName, quoteIdentifier } from "./identifiers.js";
import {
  OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID,
  applyOwnerDelegationReconciliationMigration,
} from "./owner-delegation-migration.js";
import { DEFAULT_WORKSPACE_NAME, SYSTEM_REALM_ID } from "./migrate.js";
import { PostgresAuthorizationStore } from "./postgres-authorization.js";
import { PostgresRealmCollectionEntitlementStore } from "./postgres-realm-collection-entitlements.js";
import { PostgresDatabase } from "./postgres.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

describe.runIf(RUN)("Owner delegation reconciliation", () => {
  const schema = `xecms_owner_delegation_${randomUUID().replaceAll("-", "_")}`;
  const database = new PostgresDatabase({
    connectionString: DATABASE_URL,
    schema,
    maxConnections: 3,
  });
  const ownerId = "usr_owner_delegation";
  const q = (name: string): string => qualifiedName(schema, name);

  beforeAll(async () => {
    await database.migrate();
    await database.createInitialOwner({
      id: ownerId,
      username: "delegation.owner",
      passwordHash: "hash",
      now: "2026-07-16T00:00:00.000Z",
    });
    const authorization = new AuthorizationApplicationService(
      new PostgresAuthorizationStore(database.pool, schema),
      {
        now: () => "2026-07-16T00:00:00.000Z",
        newAuditId: () => `audit_${randomUUID()}`,
        newId: (prefix) => `${prefix}_${randomUUID()}`,
      },
      new PostgresRealmCollectionEntitlementStore(database.pool, schema),
    );
    await authorization.initialize({
      realmId: SYSTEM_REALM_ID,
      realmName: "System Realm",
      rootResourceId: SYSTEM_WORKSPACE_RESOURCE_ID,
      rootResourceName: DEFAULT_WORKSPACE_NAME,
      ownerSubjectId: ownerId,
      ownerIdentityId: ownerId,
      ownerSubjectName: "delegation.owner",
    });
  });

  afterAll(async () => {
    await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await database.close();
  });

  it("backfills every assigned delegatable permission and removes protected delegation", async () => {
    expect((await database.pool.query(
      `SELECT 1 FROM ${q("_xecms_core_migrations")} WHERE id = $1`,
      [OWNER_DELEGATION_RECONCILIATION_MIGRATION_ID],
    )).rowCount).toBe(1);

    const ownerRoleId = `authorization:${SYSTEM_REALM_ID}:role:owner`;
    const expected = await database.pool.query<{ permission_key: string }>(`
      SELECT role_permission.permission_key
        FROM ${q("_xecms_auth_role_permissions")} role_permission
        JOIN ${q("_xecms_auth_permissions")} permission
          ON permission.permission_key = role_permission.permission_key
       WHERE role_permission.realm_id = $1
         AND role_permission.role_id = $2
         AND permission.delegatable = true
         AND permission.protected = false
       ORDER BY role_permission.permission_key
    `, [SYSTEM_REALM_ID, ownerRoleId]);

    await database.pool.query(
      `DELETE FROM ${q("_xecms_auth_role_delegations")}
        WHERE realm_id = $1 AND role_id = $2`,
      [SYSTEM_REALM_ID, ownerRoleId],
    );
    await database.pool.query(
      `INSERT INTO ${q("_xecms_auth_role_delegations")}
         (realm_id, role_id, permission_key)
       VALUES ($1, $2, 'authorization.manage')`,
      [SYSTEM_REALM_ID, ownerRoleId],
    );

    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await applyOwnerDelegationReconciliationMigration(client, schema);
      await applyOwnerDelegationReconciliationMigration(client, schema);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const actual = await database.pool.query<{ permission_key: string }>(
      `SELECT permission_key
         FROM ${q("_xecms_auth_role_delegations")}
        WHERE realm_id = $1 AND role_id = $2
        ORDER BY permission_key`,
      [SYSTEM_REALM_ID, ownerRoleId],
    );
    expect(actual.rows).toEqual(expected.rows);
    expect(actual.rows).not.toContainEqual({ permission_key: "authorization.manage" });
    expect(actual.rows).not.toContainEqual({ permission_key: "identity.owner.transfer" });
  });
});
