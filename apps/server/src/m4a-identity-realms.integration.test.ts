import { randomUUID } from "node:crypto";

import { PostgresDatabase, qualifiedName, quoteIdentifier } from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./config.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL = process.env["XECMS_TEST_DATABASE_URL"]
  ?? process.env["XECMS_E2E_DATABASE_URL"]
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const ORIGIN = "http://127.0.0.1:3199";

interface Session { readonly cookie: string; readonly csrfToken: string }
interface Realm {
  readonly realmId: string;
  readonly realmKey: string;
  readonly name: string;
  readonly status: "provisioning" | "active" | "disabled";
  readonly revision: number;
  readonly authentication: {
    readonly acceptSystemIdentities: boolean;
    readonly provisioning: "explicit" | "jit";
    readonly registration: "closed" | "open";
    readonly defaultRoleIds: readonly string[];
  };
}
interface Membership {
  readonly membershipId: string;
  readonly subjectId: string;
  readonly status: "pending" | "active" | "suspended";
  readonly revision: number;
}
interface Policy {
  readonly revision: number;
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly resources: readonly { readonly id: string; readonly name: string; readonly type: string }[];
  readonly bindings: readonly { readonly id: string; readonly subjectId: string }[];
}

describe.runIf(RUN)("M4-A Identity Realm acceptance", () => {
  it("isolates Content identities and permissions through restart, Full Access and suspension", async () => {
    const schema = `xecms_m4a_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 6 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "m4a-integration-session-secret-0123456789",
      XECMS_DEV_SEED: "true",
      XECMS_DEV_ADMIN_USERNAME: "admin",
      XECMS_DEV_ADMIN_PASSWORD: "admin",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_CONTENT_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      const owner = await loginAdmin(server);
      const createdRealm = await adminJson<Realm>(server, owner, "POST", "/api/identity-realms", {
        key: "community",
        name: "Community",
        acceptSystemIdentities: true,
        provisioning: "explicit",
        registration: "open",
        defaultRoleIds: [],
      }, 201);
      await applySchema(server, owner);
      let realm = await getJson<Realm>(server, "/api/identity-realms/" + createdRealm.realmId, owner.cookie);
      expect(realm.status).toBe("active");

      const contentAdministratorRoleId = `authorization:${realm.realmId}:role:content-administrator`;
      realm = await updateRealm(server, owner, realm, [contentAdministratorRoleId]);
      const identities = await getJson<{ readonly items: readonly { readonly globalIdentityId: string; readonly primaryIdentifier: string }[] }>(server, "/api/global-identities", owner.cookie);
      const adminIdentity = identities.items.find(({ primaryIdentifier }) => primaryIdentifier === "admin");
      expect(adminIdentity).toBeDefined();
      const adminMembership = await adminJson<Membership>(
        server,
        owner,
        "POST",
        `/api/identity-realms/${realm.realmId}/memberships`,
        { globalIdentityId: adminIdentity!.globalIdentityId, profile: { displayName: "Realm Admin" }, password: "admin" },
        201,
      );
      expect(adminMembership.status).toBe("active");
      realm = await getJson<Realm>(server, `/api/identity-realms/${realm.realmId}`, owner.cookie);
      await updateRealm(server, owner, realm, []);

      const signup = await contentJson<{ readonly subjectId: string; readonly csrfToken: string }>(
        server,
        undefined,
        "POST",
        "/api/content-realms/community/signup",
        { identifier: "member@example.test", password: "Member-password-2026!", profile: { displayName: "Member" } },
        201,
      );
      const member = { cookie: signup.cookie, csrfToken: signup.body.csrfToken };
      const denied = await contentRequest(server, member, "GET", "/api/content-realms/community/collections/col_articles/documents");
      expect(denied.statusCode).toBe(403);

      let policy = await getJson<Policy>(server, `/api/identity-realms/${realm.realmId}/authorization/policy`, owner.cookie);
      const editor = policy.roles.find(({ name }) => name === "Editor");
      const articles = policy.resources.find(({ name, type }) => name === "articles" && type === "collection");
      expect(editor).toBeDefined();
      expect(articles).toBeDefined();
      policy = await adminJson<Policy>(server, owner, "POST", `/api/identity-realms/${realm.realmId}/authorization/bindings`, {
        expectedPolicyRevision: policy.revision,
        subjectId: signup.body.subjectId,
        roleId: editor!.id,
        resourceId: articles!.id,
        propagation: "self-and-children",
      }, 201);
      const editorBinding = policy.bindings.find(({ subjectId }) => subjectId === signup.body.subjectId);
      expect(editorBinding).toBeDefined();

      const created = await contentJson<{ readonly id: string; readonly version: number; readonly data: Readonly<Record<string, unknown>> }>(
        server, member, "POST", "/api/content-realms/community/collections/col_articles/documents",
        { data: { title: "Realm article", body: "Only the Community grant authorizes this." } }, 201,
      );
      expect(created.body.data["title"]).toBe("Realm article");
      const updated = await contentJson<{ readonly version: number; readonly data: Readonly<Record<string, unknown>> }>(
        server, member, "PATCH", `/api/content-realms/community/collections/col_articles/documents/${created.body.id}`,
        { expectedVersion: created.body.version, data: { title: "Updated realm article", body: "Scoped update" } }, 200,
      );
      expect(updated.body.version).toBe(created.body.version + 1);

      await adminJson(server, owner, "DELETE", `/api/identity-realms/${realm.realmId}/authorization/bindings/${editorBinding!.id}`, {
        expectedPolicyRevision: policy.revision,
      }, 200);
      const deniedAfterRevoke = await contentRequest(server, member, "GET", "/api/content-realms/community/collections/col_articles/documents");
      expect(deniedAfterRevoke.statusCode).toBe(403);

      const fullAccess = await adminJson<{ readonly bindingId: string }>(server, owner, "POST", `/api/identity-realms/${realm.realmId}/full-access`, {
        subjectId: signup.body.subjectId,
        reason: "M4-A recovery acceptance",
        password: "admin",
      }, 201);
      const allowedByFullAccess = await contentRequest(server, member, "GET", "/api/content-realms/community/collections/col_articles/documents");
      expect(allowedByFullAccess.statusCode).toBe(200);
      const fullAccessUses = await database.pool.query<{ readonly event_type: string }>(
        `SELECT event_type FROM ${qualifiedName(schema, "_xecms_audit_log")}
          WHERE event_type = 'realm.full-access.used'`,
      );
      expect(fullAccessUses.rowCount).toBeGreaterThan(0);

      await server.close();
      server = await buildServer({ database, config, logger: false });
      const loginAfterRestart = await contentJson<{ readonly csrfToken: string }>(server, undefined, "POST", "/api/content-realms/community/login", {
        identifier: "member@example.test", password: "Member-password-2026!",
      }, 200);
      expect(loginAfterRestart.cookie).toContain("xecms_content_session=");

      const memberships = await getJson<{ readonly items: readonly Membership[] }>(server, `/api/identity-realms/${realm.realmId}/memberships`, owner.cookie);
      const memberMembership = memberships.items.find(({ subjectId }) => subjectId === signup.body.subjectId);
      expect(memberMembership).toBeDefined();
      await adminJson(server, owner, "PATCH", `/api/identity-realms/${realm.realmId}/memberships/${memberMembership!.membershipId}`, {
        expectedRevision: memberMembership!.revision,
        status: "suspended",
      }, 200);
      const suspendedSession = await contentRequest(server, { cookie: loginAfterRestart.cookie, csrfToken: loginAfterRestart.body.csrfToken }, "GET", "/api/content-realms/community/session");
      expect(suspendedSession.statusCode).toBe(200);
      expect(suspendedSession.json().authenticated).toBe(false);

      await adminJson(server, owner, "DELETE", `/api/identity-realms/${realm.realmId}/full-access/${fullAccess.bindingId}`, { password: "admin" }, 200);
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  });
});

async function loginAdmin(server: XeCmsServer): Promise<Session> {
  const response = await server.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN }, payload: { username: "admin", password: "admin" } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: String(response.headers["set-cookie"]).split(";", 1)[0]!, csrfToken: response.json().csrfToken as string };
}

async function applySchema(server: XeCmsServer, owner: Session): Promise<void> {
  const imported = await adminRequest(server, owner, "PUT", "/api/schema/manifest", {
    baseRevisionId: null,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema", formatVersion: 1,
      collections: [
        {
          id: "col_members", name: "members", label: "Members",
          fields: [
            { id: "fld_member_email", name: "email", label: "Email", type: "text", required: true, unique: true },
            { id: "fld_member_name", name: "displayName", label: "Display name", type: "text", required: true },
          ],
          auth: { enabled: true, realmKey: "community", identifierFieldIds: ["fld_member_email"], acceptSystemIdentities: true, provisioning: "explicit", defaultRoleIds: [] },
        },
        {
          id: "col_articles", name: "articles", label: "Articles",
          fields: [
            { id: "fld_article_title", name: "title", label: "Title", type: "text", required: true },
            { id: "fld_article_body", name: "body", label: "Body", type: "textarea", required: true },
          ],
        },
      ],
    },
  });
  expect(imported.statusCode, imported.body).toBe(200);
  const preview = await adminRequest(server, owner, "POST", "/api/schema/preview", { expectedDraftVersion: imported.json().draftVersion });
  expect(preview.statusCode, preview.body).toBe(200);
  const applied = await adminRequest(server, owner, "POST", "/api/schema/apply", {
    planId: preview.json().planId,
    expectedRevisionId: null,
    expectedDraftVersion: imported.json().draftVersion,
    approveDestructive: false,
  });
  expect(applied.statusCode, applied.body).toBe(200);
}

async function updateRealm(server: XeCmsServer, owner: Session, realm: Realm, defaultRoleIds: readonly string[]): Promise<Realm> {
  return adminJson<Realm>(server, owner, "PATCH", `/api/identity-realms/${realm.realmId}`, {
    expectedRevision: realm.revision,
    name: realm.name,
    status: "active",
    acceptSystemIdentities: true,
    provisioning: "explicit",
    registration: "open",
    defaultRoleIds,
  }, 200);
}

async function getJson<T>(server: XeCmsServer, url: string, cookie: string): Promise<T> {
  const response = await server.app.inject({ method: "GET", url, headers: { cookie, origin: ORIGIN } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as T;
}

async function adminJson<T = unknown>(server: XeCmsServer, session: Session, method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload: Readonly<Record<string, unknown>>, expected: number): Promise<T> {
  const response = await adminRequest(server, session, method, url, payload);
  expect(response.statusCode, response.body).toBe(expected);
  return response.json() as T;
}

function adminRequest(server: XeCmsServer, session: Session, method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload: Readonly<Record<string, unknown>>): Promise<LightMyRequestResponse> {
  return server.app.inject({ method, url, headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken, origin: ORIGIN }, payload });
}

async function contentJson<T>(server: XeCmsServer, session: Session | undefined, method: "POST" | "PATCH", url: string, payload: Readonly<Record<string, unknown>>, expected: number): Promise<{ readonly body: T; readonly cookie: string }> {
  const response = await contentRequest(server, session, method, url, payload);
  expect(response.statusCode, response.body).toBe(expected);
  return { body: response.json() as T, cookie: String(response.headers["set-cookie"] ?? session?.cookie ?? "").split(";", 1)[0]! };
}

function contentRequest(server: XeCmsServer, session: Session | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: Readonly<Record<string, unknown>>): Promise<LightMyRequestResponse> {
  return server.app.inject({
    method, url,
    headers: {
      origin: ORIGIN,
      ...(session === undefined ? {} : { cookie: session.cookie, "x-csrf-token": session.csrfToken }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}
