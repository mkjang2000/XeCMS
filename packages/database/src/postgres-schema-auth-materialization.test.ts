import { randomUUID } from "node:crypto";

import {
  asCollectionId,
  asFieldId,
  type CollectionAuthDefinition,
  type SchemaIrV1,
} from "@xecms/schema";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";

import { contentTableName, qualifiedName, quoteIdentifier } from "./identifiers.js";
import { DEFAULT_WORKSPACE_ID } from "./migrate.js";
import { PostgresIdentityRealmStore } from "./postgres-identity-realms.js";
import { PostgresMigrationPlanner } from "./planner.js";
import { PostgresDatabase } from "./postgres.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const NOW = "2026-07-15T09:00:00.000Z";
const OWNER_ID = "usr_schema_auth_owner";
const EMPTY_SCHEMA: SchemaIrV1 = {
  format: "xecms.schema",
  formatVersion: 1,
  collections: [],
};

describe.runIf(RUN)("Schema auth and Content Realm atomic materialization", () => {
  it("materializes and removes auth atomically while preserving registration", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_schema_community", "community");
      await initializePolicy(database.pool, schema, realm.id);
      const applied = await applySchema(database, schema, profileSchema(authDefinition({
        acceptSystemIdentities: true,
        provisioning: "jit",
        defaultRoleIds: ["role_member"],
      })));

      const config = await database.pool.query<{
        realm_id: string;
        identifier_field_ids: string[];
        status: string;
        schema_revision_id: string;
      }>(
        `SELECT realm_id, identifier_field_ids, status, schema_revision_id
         FROM ${qualifiedName(schema, "_xecms_auth_collection_configs")}
         WHERE collection_id = 'col_members'`,
      );
      expect(config.rows).toEqual([{
        realm_id: realm.id,
        identifier_field_ids: ["fld_member_email"],
        status: "active",
        schema_revision_id: applied.revision.revisionId,
      }]);
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({
        status: "active",
        profileCollectionId: "col_members",
        authentication: {
          acceptSystemIdentities: true,
          provisioning: "jit",
          registration: "open",
          defaultRoleIds: ["role_member"],
        },
      });
      await expect(database.getActiveSchema()).resolves.toMatchObject({
        revisionId: applied.revision.revisionId,
      });

      const removed = await applySchema(database, schema, profileSchema(undefined));
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({
        status: "disabled",
        revision: 3,
        authentication: { registration: "open" },
      });
      expect((await realms.getRealmById(realm.id))?.profileCollectionId).toBeUndefined();
      await expect(database.getActiveSchema()).resolves.toMatchObject({
        revisionId: removed.revision.revisionId,
        schema: profileSchema(undefined),
      });
    });
  });

  it("rejects a pre-existing Realm whose authorization policy is not initialized", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_uninitialized_policy", "community");
      await expect(applySchema(database, schema, profileSchema(authDefinition())))
        .rejects.toMatchObject({ code: "SCHEMA_AUTH_POLICY_UNINITIALIZED", status: 409 });
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({ status: "provisioning" });
      await expect(database.getActiveSchema()).resolves.toBeNull();
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
    });
  });

  it("rejects auth when the referenced Content Realm does not exist", async () => {
    await withDatabase(async ({ database, schema }) => {
      await expect(applySchema(database, schema, profileSchema(authDefinition())))
        .rejects.toMatchObject({ code: "SCHEMA_AUTH_REALM_NOT_FOUND", status: 409 });
      await expect(database.getActiveSchema()).resolves.toBeNull();
      await expect(countRows(database.pool, schema, "_xecms_schema_revisions")).resolves.toBe(0);
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
      await expect(physicalTable(database.pool, schema, "col_members")).resolves.toBeNull();
    });
  });

  it("rejects enabling auth on a Collection that already has Documents", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const initial = await applySchema(database, schema, profileSchema(undefined));
      const realm = await createRealm(realms, "rlm_existing_docs", "community");
      await initializePolicy(database.pool, schema, realm.id);
      await database.pool.query(
        `INSERT INTO ${qualifiedName(schema, "_xecms_documents")}
           (id, workspace_id, collection_id, current_draft_revision_id, publication,
            lifecycle, deletion, created_at, created_by, updated_at, updated_by, aggregate_version)
         VALUES ('doc_existing_member', $1, 'col_members', NULL, NULL,
                 '{"kind":"active"}'::jsonb, NULL, $2, $3, $2, $3, 1)`,
        [DEFAULT_WORKSPACE_ID, NOW, OWNER_ID],
      );

      await expect(applySchema(database, schema, profileSchema(authDefinition())))
        .rejects.toMatchObject({ code: "SCHEMA_AUTH_EXISTING_DOCUMENTS", status: 409 });
      await expect(database.getActiveSchema()).resolves.toMatchObject({
        revisionId: initial.revision.revisionId,
        schema: profileSchema(undefined),
      });
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({
        status: "provisioning",
      });
      expect((await realms.getRealmById(realm.id))?.profileCollectionId).toBeUndefined();
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
    });
  });

  it("rejects identifier, Realm link or disable changes while Memberships exist", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_membership_guard", "community");
      await initializePolicy(database.pool, schema, realm.id);
      const initial = await applySchema(database, schema, profileSchema(authDefinition()));
      await database.pool.query(
        `INSERT INTO ${qualifiedName(schema, "_xecms_auth_subjects")}
           (id, realm_id, subject_type, display_name, protected,
            created_at, created_by, updated_at, updated_by)
         VALUES ('subject_schema_member', $1, 'user', 'Schema member', false,
                 $2, $3, $2, $3)`,
        [realm.id, NOW, OWNER_ID],
      );
      await realms.createMembership({
        id: "membership_schema_member",
        workspaceId: DEFAULT_WORKSPACE_ID,
        identityId: OWNER_ID,
        realmId: realm.id,
        subjectId: "subject_schema_member",
        status: "active",
        provisionedBy: "explicit",
        actorIdentityId: OWNER_ID,
        now: NOW,
      });

      await expect(applySchema(database, schema, profileSchema(authDefinition({
        identifierFieldIds: [asFieldId("fld_member_username")],
      })))).rejects.toMatchObject({ code: "SCHEMA_AUTH_MEMBERSHIP_CONFLICT", status: 409 });
      await expect(database.getActiveSchema()).resolves.toMatchObject({
        revisionId: initial.revision.revisionId,
      });
      const config = await database.pool.query<{ identifier_field_ids: string[] }>(
        `SELECT identifier_field_ids
         FROM ${qualifiedName(schema, "_xecms_auth_collection_configs")}
         WHERE collection_id = 'col_members'`,
      );
      expect(config.rows[0]?.identifier_field_ids).toEqual(["fld_member_email"]);
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({ status: "active" });
    });
  });

  it("keeps a disabled Realm disabled while synchronizing its auth Collection", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_disabled_materialization", "community");
      await initializePolicy(database.pool, schema, realm.id);
      await database.pool.query(
        `UPDATE ${qualifiedName(schema, "_xecms_realms")}
         SET status = 'disabled' WHERE id = $1`,
        [realm.id],
      );
      await applySchema(database, schema, profileSchema(authDefinition()));
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({
        status: "disabled",
        profileCollectionId: "col_members",
      });
    });
  });

  it("rejects a second profile Collection for the same Realm", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_profile_conflict", "community");
      await initializePolicy(database.pool, schema, realm.id);
      await database.pool.query(
        `UPDATE ${qualifiedName(schema, "_xecms_realms")}
         SET profile_collection_id = 'col_other_profile' WHERE id = $1`,
        [realm.id],
      );
      await expect(applySchema(database, schema, profileSchema(authDefinition())))
        .rejects.toMatchObject({ code: "SCHEMA_AUTH_REALM_PROFILE_CONFLICT", status: 409 });
      await expect(database.getActiveSchema()).resolves.toBeNull();
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
    });
  });

  it("rolls back the schema revision, physical table, config and Realm on a late failure", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_atomic_rollback", "community");
      await initializePolicy(database.pool, schema, realm.id);
      await database.pool.query(`
        CREATE FUNCTION ${qualifiedName(schema, "_xecms_fail_schema_state_update")}()
          RETURNS trigger LANGUAGE plpgsql AS $failure$
        BEGIN
          RAISE EXCEPTION 'forced schema-state failure';
        END;
        $failure$;
        CREATE TRIGGER _xecms_fail_schema_state_update
          BEFORE UPDATE OF active_revision_id ON ${qualifiedName(schema, "_xecms_schema_state")}
          FOR EACH ROW EXECUTE FUNCTION ${qualifiedName(schema, "_xecms_fail_schema_state_update")}();
      `);

      await expect(applySchema(database, schema, profileSchema(authDefinition())))
        .rejects.toThrow(/forced schema-state failure/);
      await expect(database.getActiveSchema()).resolves.toBeNull();
      await expect(countRows(database.pool, schema, "_xecms_schema_revisions")).resolves.toBe(0);
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
      await expect(physicalTable(database.pool, schema, "col_members")).resolves.toBeNull();
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({
        status: "provisioning",
        authentication: {
          acceptSystemIdentities: false,
          provisioning: "explicit",
          registration: "open",
          defaultRoleIds: [],
        },
      });
      expect((await realms.getRealmById(realm.id))?.profileCollectionId).toBeUndefined();
      const failedRun = await database.pool.query<{ status: string; error_code: string }>(
        `SELECT status, error_code FROM ${qualifiedName(schema, "_xecms_migration_runs")}`,
      );
      expect(failedRun.rows).toEqual([{ status: "failed", error_code: "P0001" }]);
    });
  });

  it("does not materialize Realm state when schema revision CAS is stale", async () => {
    await withDatabase(async ({ database, schema, realms }) => {
      const realm = await createRealm(realms, "rlm_stale_cas", "community");
      await initializePolicy(database.pool, schema, realm.id);
      const next = profileSchema(authDefinition());
      const draft = await database.saveSchemaDraft({
        baseRevisionId: null,
        expectedDraftVersion: null,
        schema: next,
        actorId: OWNER_ID,
        now: NOW,
        claimUnissuedIds: true,
      });
      const operations = new PostgresMigrationPlanner(schema).plan(EMPTY_SCHEMA, next);
      await expect(database.applySchemaDraft({
        expectedRevisionId: "sch_stale",
        expectedDraftVersion: draft.draftVersion,
        planId: "plan_stale",
        schema: next,
        changes: [],
        operations,
        actorId: OWNER_ID,
        now: NOW,
      })).rejects.toMatchObject({ code: "SCHEMA_REVISION_CONFLICT", status: 409 });
      await expect(database.getActiveSchema()).resolves.toBeNull();
      await expect(countRows(database.pool, schema, "_xecms_auth_collection_configs")).resolves.toBe(0);
      await expect(realms.getRealmById(realm.id)).resolves.toMatchObject({ status: "provisioning" });
    });
  });

  async function withDatabase(
    run: (context: {
      readonly database: PostgresDatabase;
      readonly schema: string;
      readonly realms: PostgresIdentityRealmStore;
    }) => Promise<void>,
  ): Promise<void> {
    const schema = `xecms_schema_auth_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 4 });
    try {
      await database.migrate();
      await database.createInitialOwner({
        id: OWNER_ID,
        username: "schema-auth-owner",
        passwordHash: "hash-owner",
        now: NOW,
      });
      await run({
        database,
        schema,
        realms: new PostgresIdentityRealmStore(database.pool, schema),
      });
    } finally {
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await database.close();
    }
  }
});

function authDefinition(
  overrides: Partial<CollectionAuthDefinition> = {},
): CollectionAuthDefinition {
  return {
    enabled: true,
    realmKey: "community",
    identifierFieldIds: [asFieldId("fld_member_email")],
    acceptSystemIdentities: false,
    provisioning: "explicit",
    defaultRoleIds: [],
    ...overrides,
  };
}

function profileSchema(auth: CollectionAuthDefinition | undefined): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [{
      id: asCollectionId("col_members"),
      name: "members",
      fields: [
        {
          id: asFieldId("fld_member_email"),
          name: "email",
          type: "text",
          required: true,
          unique: true,
        },
        {
          id: asFieldId("fld_member_username"),
          name: "username",
          type: "text",
          required: true,
          unique: true,
        },
      ],
      ...(auth === undefined ? {} : { auth }),
    }],
  };
}

async function createRealm(
  realms: PostgresIdentityRealmStore,
  id: string,
  key: string,
) {
  return realms.createRealm({
    id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    key,
    name: `Realm ${key}`,
    authentication: {
      acceptSystemIdentities: false,
      provisioning: "explicit",
      registration: "open",
      defaultRoleIds: [],
    },
    actorIdentityId: OWNER_ID,
    now: NOW,
  });
}

async function initializePolicy(pool: Pool, schema: string, realmId: string): Promise<void> {
  const rootResourceId = `resource:${realmId}:root`;
  await pool.query(
    `INSERT INTO ${qualifiedName(schema, "_xecms_auth_resources")}
       (id, realm_id, name, resource_type, parent_id, protected, attributes,
        created_at, created_by, updated_at, updated_by)
     VALUES ($1, $2, 'Realm root', 'realm-root', NULL, true, '{}'::jsonb,
             $3, $4, $3, $4)`,
    [rootResourceId, realmId, NOW, OWNER_ID],
  );
  await pool.query(
    `INSERT INTO ${qualifiedName(schema, "_xecms_auth_policy_revisions")}
       (realm_id, revision, actor_subject_id, change_kind, target_type, target_id, occurred_at)
     VALUES ($1, 1, NULL, 'initialize', 'realm', $1, $2)`,
    [realmId, NOW],
  );
  await pool.query(
    `UPDATE ${qualifiedName(schema, "_xecms_auth_policy_state")}
     SET current_revision = 1, root_resource_id = $2, updated_at = $3
     WHERE realm_id = $1`,
    [realmId, rootResourceId, NOW],
  );
}

async function applySchema(
  database: PostgresDatabase,
  databaseSchema: string,
  next: SchemaIrV1,
) {
  const active = await database.getActiveSchema();
  const previous = active?.schema ?? EMPTY_SCHEMA;
  const draft = await database.saveSchemaDraft({
    baseRevisionId: active?.revisionId ?? null,
    expectedDraftVersion: null,
    schema: next,
    actorId: OWNER_ID,
    now: NOW,
    claimUnissuedIds: true,
  });
  const operations = new PostgresMigrationPlanner(databaseSchema).plan(previous, next);
  return database.applySchemaDraft({
    expectedRevisionId: active?.revisionId ?? null,
    expectedDraftVersion: draft.draftVersion,
    planId: `plan_${randomUUID()}`,
    schema: next,
    changes: [],
    operations,
    actorId: OWNER_ID,
    now: NOW,
  });
}

async function countRows(pool: Pool, schema: string, table: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${qualifiedName(schema, table)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function physicalTable(
  pool: Pool,
  schema: string,
  collectionId: string,
): Promise<string | null> {
  const result = await pool.query<{ table_name: string | null }>(
    "SELECT to_regclass($1)::text AS table_name",
    [qualifiedName(schema, contentTableName(collectionId))],
  );
  return result.rows[0]?.table_name ?? null;
}
