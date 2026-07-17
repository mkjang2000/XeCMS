import { randomUUID } from "node:crypto";

import { PostgresDatabase, PostgresIdentityRealmStore, qualifiedName, quoteIdentifier } from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./config.js";
import {
  bootstrapTestOwner,
  TEST_OWNER_PASSWORD,
  TEST_OWNER_USERNAME,
} from "./integration-test-support.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const ORIGIN = "http://127.0.0.1:3198";

interface Session { readonly cookie: string; readonly csrfToken: string }
interface Delivery {
  readonly id: string;
  readonly status: string;
  readonly topic: string;
  readonly attempts: number;
  readonly event: { readonly aggregate: { readonly id: string } };
}
interface Policy {
  readonly revision: number;
  readonly subjects: readonly { readonly id: string; readonly name: string }[];
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly resources: readonly { readonly id: string; readonly type: string }[];
}

describe.runIf(RUN)("M4-B event worker acceptance", () => {
  it("persists events atomically and operates jobs through the protected Admin API", async () => {
    const schema = `xecms_m4b_${randomUUID().replaceAll("-", "_")}`;
    const q = (name: string): string => qualifiedName(schema, name);
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 6 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "m4b-integration-session-secret-0123456789",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_CONTENT_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
      XECMS_WORKER_ENABLED: "false",
      XECMS_WORKER_MAX_ATTEMPTS: "3",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      await bootstrapTestOwner(server);
      const owner = await login(server);
      await applySchema(server, owner);

      const realmCreated = await admin(server, owner, "POST", "/api/identity-realms", {
        key: "event-observer",
        name: "Event Observer",
        acceptSystemIdentities: true,
        provisioning: "explicit",
        registration: "closed",
        defaultRoleIds: [],
      });
      expect(realmCreated.statusCode, realmCreated.body).toBe(201);
      const identities = await get(server, owner, "/api/global-identities");
      const ownerIdentityId = identities.json<{ items: { globalIdentityId: string; primaryIdentifier: string }[] }>()
        .items.find(({ primaryIdentifier }) => primaryIdentifier === "admin")!.globalIdentityId;
      await new PostgresIdentityRealmStore(database.pool, schema).createIdentity({
        id: "identity_m4b_observer",
        workspaceId: "wrk_default",
        originRealmId: realmCreated.json<{ realmId: string }>().realmId,
        primaryIdentifier: "m4b-observer@example.test",
        normalizedIdentifier: "m4b-observer@example.test",
        passwordHash: "test-only-hash",
        actorId: ownerIdentityId,
        now: "2026-07-15T12:00:00.000Z",
      });
      let policyResponse = await get(server, owner, "/api/authorization/policy");
      let policy = policyResponse.json<Policy>();
      const subjectResponse = await admin(server, owner, "POST", "/api/authorization/subjects", {
        expectedPolicyRevision: policy.revision,
        type: "user",
        name: "M4-B event subject",
      });
      expect(subjectResponse.statusCode, subjectResponse.body).toBe(201);
      policy = subjectResponse.json<Policy>();
      const subject = policy.subjects.find(({ name }) => name === "M4-B event subject")!;
      const editor = policy.roles.find(({ name }) => name === "Editor")!;
      const root = policy.resources.find(({ type }) => type === "workspace")!;
      policyResponse = await admin(server, owner, "POST", "/api/authorization/bindings", {
        expectedPolicyRevision: policy.revision,
        subjectId: subject.id,
        roleId: editor.id,
        resourceId: root.id,
        propagation: "self",
      });
      expect(policyResponse.statusCode, policyResponse.body).toBe(201);
      const domainTopics = await database.pool.query<{ topic: string }>(
        `SELECT DISTINCT topic FROM ${q("_xecms_outbox_events")} WHERE topic IN ('identity.created', 'realm.created', 'role.binding.changed') ORDER BY topic`,
      );
      expect(domainTopics.rows.map(({ topic }) => topic)).toEqual(["identity.created", "realm.created", "role.binding.changed"]);
      const identityEnvelope = await database.pool.query<{ aggregate_id: string }>(
        `SELECT aggregate_id FROM ${q("_xecms_outbox_events")} WHERE topic = 'identity.created' ORDER BY created_at DESC LIMIT 1`,
      );
      expect(identityEnvelope.rows[0]?.aggregate_id).toBe("identity_m4b_observer");

      const created = await admin(server, owner, "POST", "/api/collections/col_articles/documents", {
        data: { title: "Outbox article", body: "Committed with its event" },
      });
      expect(created.statusCode, created.body).toBe(201);
      const document = created.json<{ id: string; version: number }>();

      const persisted = await database.pool.query<{ document_events: string; outbox_events: string }>(
        `SELECT
           (SELECT count(*)::text FROM ${q("_xecms_document_events")} WHERE document_id = $1) AS document_events,
           (SELECT count(*)::text FROM ${q("_xecms_outbox_events")} WHERE aggregate_id = $1) AS outbox_events`,
        [document.id],
      );
      expect(persisted.rows[0]).toEqual({ document_events: "1", outbox_events: "1" });

      const beforeRun = await get(server, owner, "/api/jobs");
      expect(beforeRun.statusCode, beforeRun.body).toBe(200);
      expect(beforeRun.json<{ total: number }>().total).toBe(0);
      const noCsrf = await server.app.inject({ method: "POST", url: "/api/jobs/run", headers: { cookie: owner.cookie, origin: ORIGIN }, payload: {} });
      expect(noCsrf.statusCode).toBe(403);

      const run = await admin(server, owner, "POST", "/api/jobs/run", {});
      expect(run.statusCode, run.body).toBe(200);
      expect(run.json()).toMatchObject({ fannedOut: 1, claimed: 1, succeeded: 1, failed: 0, dead: 0 });
      const page = await get(server, owner, "/api/jobs?status=succeeded&topic=document.created");
      expect(page.statusCode, page.body).toBe(200);
      const delivery = page.json<{ items: Delivery[] }>().items[0]!;
      expect(delivery).toMatchObject({ status: "succeeded", topic: "document.created", attempts: 1 });
      expect(delivery.event.aggregate.id).toBe(document.id);
      const detail = await get(server, owner, `/api/jobs/${delivery.id}`);
      expect(detail.json()).toMatchObject({ id: delivery.id, event: { payload: { collectionId: "col_articles" } } });
      const retrySucceeded = await admin(server, owner, "POST", `/api/jobs/${delivery.id}/retry`, {});
      expect(retrySucceeded.statusCode).toBe(409);

      const projection = await database.pool.query<{ data: { title: string }; source_event_id: string }>(
        `SELECT data, source_event_id FROM ${q("_xecms_example_search_index")} WHERE document_id = $1`,
        [document.id],
      );
      expect(projection.rows[0]?.data).toEqual({ title: "Outbox article", body: "Committed with its event" });

      await database.pool.query(`UPDATE ${q("_xecms_event_deliveries")} SET status = 'dead', completed_at = now() WHERE id = $1`, [delivery.id]);
      const retried = await admin(server, owner, "POST", `/api/jobs/${delivery.id}/retry`, {});
      expect(retried.statusCode, retried.body).toBe(200);
      expect(retried.json()).toMatchObject({ status: "pending", attempts: 0 });

      const baseline = await database.pool.query<{ events: string; outbox: string }>(
        `SELECT (SELECT count(*)::text FROM ${q("_xecms_document_events")}) AS events,
                (SELECT count(*)::text FROM ${q("_xecms_outbox_events")}) AS outbox`,
      );
      await database.pool.query(`
        CREATE FUNCTION ${q("_xecms_test_reject_outbox")}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.topic = 'document.created' THEN RAISE EXCEPTION 'test outbox rejection'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER _xecms_test_reject_outbox BEFORE INSERT ON ${q("_xecms_outbox_events")}
          FOR EACH ROW EXECUTE FUNCTION ${q("_xecms_test_reject_outbox")}()
      `);
      const rejected = await admin(server, owner, "POST", "/api/collections/col_articles/documents", {
        data: { title: "Must roll back", body: "No partial aggregate or event" },
      });
      expect(rejected.statusCode).toBe(500);
      await database.pool.query(`DROP TRIGGER _xecms_test_reject_outbox ON ${q("_xecms_outbox_events")}; DROP FUNCTION ${q("_xecms_test_reject_outbox")}()`);
      const after = await database.pool.query<{ events: string; outbox: string }>(
        `SELECT (SELECT count(*)::text FROM ${q("_xecms_document_events")}) AS events,
                (SELECT count(*)::text FROM ${q("_xecms_outbox_events")}) AS outbox`,
      );
      expect(after.rows[0]).toEqual(baseline.rows[0]);
      const documents = await get(server, owner, "/api/collections/col_articles/documents");
      expect(documents.json<{ total: number }>().total).toBe(1);
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  });
});

async function login(server: XeCmsServer): Promise<Session> {
  const response = await server.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN }, payload: { username: TEST_OWNER_USERNAME, password: TEST_OWNER_PASSWORD } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: String(response.headers["set-cookie"]).split(";", 1)[0]!, csrfToken: response.json().csrfToken as string };
}

async function applySchema(server: XeCmsServer, session: Session): Promise<void> {
  const imported = await admin(server, session, "PUT", "/api/schema/manifest", {
    baseRevisionId: null,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [{
        id: "col_articles",
        name: "articles",
        label: "Articles",
        fields: [
          { id: "fld_title", name: "title", label: "Title", type: "text", required: true },
          { id: "fld_body", name: "body", label: "Body", type: "textarea", required: true },
        ],
      }],
    },
  });
  expect(imported.statusCode, imported.body).toBe(200);
  const draft = imported.json<{ draftVersion: string }>();
  const preview = await admin(server, session, "POST", "/api/schema/preview", { expectedDraftVersion: draft.draftVersion });
  expect(preview.statusCode, preview.body).toBe(200);
  const applied = await admin(server, session, "POST", "/api/schema/apply", {
    planId: preview.json().planId,
    expectedRevisionId: null,
    expectedDraftVersion: draft.draftVersion,
    approveDestructive: false,
  });
  expect(applied.statusCode, applied.body).toBe(200);
}

function get(server: XeCmsServer, session: Session, url: string): Promise<LightMyRequestResponse> {
  return server.app.inject({ method: "GET", url, headers: { cookie: session.cookie, origin: ORIGIN } });
}

function admin(server: XeCmsServer, session: Session, method: "POST" | "PUT", url: string, payload: Readonly<Record<string, unknown>>): Promise<LightMyRequestResponse> {
  return server.app.inject({ method, url, headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken, origin: ORIGIN }, payload });
}
