import cookie from "@fastify/cookie";
import {
  ApplicationError,
  type ActorContext,
  type AuthenticatedContentRealmSession,
  type GlobalIdentityRecord,
  type IdentityRealmRecord,
  type RealmFullAccessBindingRecord,
  type RealmMembershipRecord,
} from "@xecms/application";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTENT_REALM_SESSION_COOKIE,
  registerIdentityRealmRoutes,
  type ContentRealmAuthenticationRouteService,
  type ContentRealmDocumentRouteAdapter,
  type ContentRealmMetadataRouteSource,
  type ContentRealmProfileRouteAdapter,
  type IdentityRealmAdministrationRouteService,
  type IdentityRealmRouteActorAdapter,
  type IdentityRealmRouteSecurityAdapter,
} from "./identity-realm-routes.js";

const VERIFIED_REAUTHENTICATED_AT = "2026-07-15T02:00:00.000Z";

const realm: IdentityRealmRecord = {
  id: "rlm_community",
  workspaceId: "workspace_default",
  key: "community",
  name: "Community",
  kind: "content",
  status: "active",
  profileCollectionId: "col_members",
  authentication: {
    acceptSystemIdentities: true,
    provisioning: "jit",
    registration: "open",
    defaultRoleIds: ["role_member"],
  },
  revision: 3,
  createdAt: "2026-07-15T00:00:00.000Z",
  createdBy: "identity_admin",
  updatedAt: "2026-07-15T01:00:00.000Z",
  updatedBy: "identity_admin",
};

const identity: GlobalIdentityRecord = {
  id: "identity_member",
  workspaceId: realm.workspaceId,
  primaryIdentifier: "member@example.test",
  originRealmId: realm.id,
  credentialVersion: 1,
};

const membership: RealmMembershipRecord = {
  id: "membership_member",
  identityId: identity.id,
  realmId: realm.id,
  subjectId: "subject_member",
  profileCollectionId: "col_members",
  profileDocumentId: "doc_profile",
  status: "active",
  provisionedBy: "signup",
  revision: 4,
  createdAt: "2026-07-15T00:10:00.000Z",
  activatedAt: "2026-07-15T00:10:01.000Z",
};

const authenticatedContext = {
  identity,
  realm,
  membership,
  expiresAt: "2026-07-15T10:00:00.000Z",
};

const authenticatedSession: AuthenticatedContentRealmSession = {
  ...authenticatedContext,
  sessionToken: "content-session-token",
  csrfToken: "content-csrf",
};

const fullAccess: RealmFullAccessBindingRecord = {
  id: "full_access_1",
  realmId: realm.id,
  subjectId: membership.subjectId,
  grantedByIdentityId: "identity_admin",
  grantedBySubjectId: "subject_admin",
  reason: "Recovery",
  createdAt: "2026-07-15T02:00:00.000Z",
};

const openApps = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all([...openApps].map(async (app) => app.close()));
  openApps.clear();
});

describe("registerIdentityRealmRoutes", () => {
  it("maps the complete System Admin surface, enforces revision bodies, and strips execution", async () => {
    const harness = await createHarness();

    const identities = await harness.app.inject({ method: "GET", url: "/api/global-identities" });
    const listed = await harness.app.inject({ method: "GET", url: "/api/identity-realms" });
    const detail = await harness.app.inject({
      method: "GET",
      url: "/api/identity-realms/rlm_community",
    });
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/identity-realms",
      payload: { key: "community", name: "Community" },
    });
    const updated = await harness.app.inject({
      method: "PATCH",
      url: "/api/identity-realms/rlm_community",
      payload: {
        expectedRevision: 3,
        name: "Community members",
        status: "active",
        acceptSystemIdentities: true,
        provisioning: "jit",
        registration: "open",
        defaultRoleIds: ["role_member"],
      },
    });
    const memberships = await harness.app.inject({
      method: "GET",
      url: "/api/identity-realms/rlm_community/memberships",
    });
    const provisioned = await harness.app.inject({
      method: "POST",
      url: "/api/identity-realms/rlm_community/memberships",
      payload: {
        globalIdentityId: identity.id,
        profile: { displayName: "Member" },
        password: "admin-password",
      },
    });
    const suspended = await harness.app.inject({
      method: "PATCH",
      url: "/api/identity-realms/rlm_community/memberships/membership_member",
      payload: { expectedRevision: 4, status: "suspended" },
    });
    const reactivated = await harness.app.inject({
      method: "PATCH",
      url: "/api/identity-realms/rlm_community/memberships/membership_member",
      payload: { expectedRevision: 5, status: "active" },
    });
    const bindings = await harness.app.inject({
      method: "GET",
      url: "/api/identity-realms/rlm_community/full-access",
    });
    const granted = await harness.app.inject({
      method: "POST",
      url: "/api/identity-realms/rlm_community/full-access",
      payload: {
        subjectId: "subject_member",
        reason: "Recovery",
        password: "admin-password",
      },
    });
    const revoked = await harness.app.inject({
      method: "DELETE",
      url: "/api/identity-realms/rlm_community/full-access/full_access_1",
      payload: { password: "admin-password" },
    });

    expect(identities.json().items[0]).toMatchObject({
      globalIdentityId: identity.id,
      primaryIdentifier: identity.primaryIdentifier,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      realmId: realm.id,
      realmKey: realm.key,
      revision: 3,
    });
    expect(detail.json()).toMatchObject({ realmId: realm.id });
    expect(created.statusCode).toBe(201);
    expect(updated.statusCode).toBe(200);
    expect(memberships.json().items[0]).toMatchObject({
      membershipId: membership.id,
      globalIdentityId: identity.id,
      subjectId: membership.subjectId,
      revision: 4,
    });
    expect(provisioned.statusCode).toBe(201);
    expect(provisioned.json()).toMatchObject({ membershipId: membership.id });
    expect(suspended.json().status).toBe("suspended");
    expect(reactivated.json().status).toBe("active");
    expect(bindings.json().items[0]).toMatchObject({ bindingId: fullAccess.id });
    expect(granted.statusCode).toBe(201);
    expect(revoked.statusCode).toBe(200);

    expect(harness.administration.updateRealm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ realmId: realm.id, expectedRevision: 3 }),
    );
    expect(harness.administration.updateRealm.mock.calls[0]?.[0]).not.toHaveProperty("execution");
    expect(harness.administration.suspendMembership).toHaveBeenCalledWith(
      expect.anything(),
      { realmId: realm.id, membershipId: membership.id, expectedRevision: 4 },
    );
    expect(harness.administration.reactivateMembership).toHaveBeenCalledWith(
      expect.anything(),
      { realmId: realm.id, membershipId: membership.id, expectedRevision: 5 },
    );

    // The password verifier is the only timestamp source exposed to the application service.
    expect(harness.administration.provisionMembership.mock.calls[0]?.[1].reauthenticatedAt)
      .toBe(VERIFIED_REAUTHENTICATED_AT);
    expect(harness.administration.grantFullAccess.mock.calls[0]?.[1].reauthenticatedAt)
      .toBe(VERIFIED_REAUTHENTICATED_AT);
    expect(harness.administration.revokeFullAccess.mock.calls[0]?.[1].reauthenticatedAt)
      .toBe(VERIFIED_REAUTHENTICATED_AT);
    expect(harness.actors.verifySystemReauthentication).toHaveBeenCalledTimes(3);
    expect(harness.actors.verifySystemReauthentication.mock.calls.map(([, , password]) => password))
      .toEqual(["admin-password", "admin-password", "admin-password"]);

    expect(harness.actors.requireSystemActor.mock.calls.map(([, csrf]) => csrf)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
    ]);
  });

  it("registers a brand-new user, reauthenticating with the operator's own password", async () => {
    const harness = await createHarness();
    const registered = await harness.app.inject({
      method: "POST",
      url: "/api/identity-realms/rlm_community/memberships/register",
      payload: {
        identifier: "new.user@example.com",
        password: "new-user-initial-pw",
        profile: { displayName: "New User" },
        reauthPassword: "admin-password",
      },
    });

    expect(registered.statusCode).toBe(201);
    // The new user's identifier and initial credential reach the service; the
    // operator's own password is what re-authenticates the action.
    expect(harness.administration.registerMembership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        realmId: "rlm_community",
        identifier: "new.user@example.com",
        password: "new-user-initial-pw",
        reauthenticatedAt: VERIFIED_REAUTHENTICATED_AT,
      }),
    );
    expect(harness.actors.verifySystemReauthentication.mock.calls.at(-1)?.[2]).toBe("admin-password");
  });

  it("keeps Content cookies, Origin, CSRF, sessions, and Profile actors Realm-scoped", async () => {
    const harness = await createHarness();

    const metadata = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community",
    });
    const anonymous = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/session",
    });
    const signup = await harness.app.inject({
      method: "POST",
      url: "/api/content-realms/community/signup",
      headers: { origin: "https://content.example" },
      payload: {
        identifier: identity.primaryIdentifier,
        password: "correct horse battery staple",
        profile: { displayName: "Member" },
      },
    });
    const login = await harness.app.inject({
      method: "POST",
      url: "/api/content-realms/community/login",
      headers: { origin: "https://content.example" },
      payload: {
        identifier: identity.primaryIdentifier,
        password: "correct horse battery staple",
      },
    });
    const setCookie = String(login.headers["set-cookie"]);
    const browserCookie = setCookie.split(";", 1)[0] ?? "";
    const session = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/session",
      headers: { cookie: browserCookie },
    });
    const profile = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/profile",
      headers: { cookie: browserCookie },
    });
    const patched = await harness.app.inject({
      method: "PATCH",
      url: "/api/content-realms/community/profile",
      headers: {
        cookie: browserCookie,
        origin: "https://content.example",
        "x-csrf-token": "content-csrf",
      },
      payload: { expectedRevision: 7, data: { displayName: "Updated" } },
    });
    const logout = await harness.app.inject({
      method: "POST",
      url: "/api/content-realms/community/logout",
      headers: {
        cookie: browserCookie,
        origin: "https://content.example",
        "x-csrf-token": "content-csrf",
      },
    });

    expect(metadata.json()).toMatchObject({
      realmId: realm.id,
      realmKey: realm.key,
      profileCollectionId: "col_members",
      identifierFieldIds: ["fld_email"],
      revision: 3,
    });
    expect(anonymous.json()).toEqual({
      authenticated: false,
      realmId: realm.id,
      realmKey: realm.key,
      realmRevision: 3,
    });
    expect(signup.statusCode).toBe(201);
    expect(signup.json()).not.toHaveProperty("sessionToken");
    expect(login.json()).toMatchObject({
      authenticated: true,
      globalIdentityId: identity.id,
      realmId: realm.id,
      membershipId: membership.id,
      subjectId: membership.subjectId,
      profileDocumentId: membership.profileDocumentId,
      csrfToken: "content-csrf",
      membershipRevision: 4,
    });
    expect(setCookie).toContain(`${CONTENT_REALM_SESSION_COOKIE}=content-session-token`);
    expect(setCookie).toContain("Path=/api/content-realms/community");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(session.json().csrfToken).toBe("content-csrf");
    expect(session.headers["cache-control"]).toBe("no-store");
    expect(profile.json()).toMatchObject({
      realmId: realm.id,
      membershipId: membership.id,
      profileDocumentId: "doc_profile",
      data: { displayName: "Member" },
      revision: 6,
    });
    expect(patched.json()).toMatchObject({
      data: { displayName: "Updated" },
      revision: 8,
    });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toContain("Path=/api/content-realms/community");

    expect(harness.contentAuthentication.assertCsrfToken).toHaveBeenNthCalledWith(1, {
      realmKey: "community",
      sessionToken: "content-session-token",
      csrfToken: "content-csrf",
    });
    expect(harness.contentAuthentication.assertCsrfToken).toHaveBeenNthCalledWith(2, {
      realmKey: "community",
      sessionToken: "content-session-token",
      csrfToken: "content-csrf",
    });
    expect(harness.profiles.update).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 7,
      actor: expect.objectContaining({
        identityId: identity.id,
        realmId: realm.id,
        subjectId: membership.subjectId,
      }),
    }));
    expect(harness.profiles.update.mock.calls[0]?.[0].actor).not.toHaveProperty("execution");
    expect(harness.security.assertContentOrigin).toHaveBeenCalledTimes(4);
    expect(harness.actors.requireSystemActor).not.toHaveBeenCalled();
  });

  it("routes Content Collection and Document operations through the Membership actor", async () => {
    const harness = await createHarness();
    const headers = { cookie: `${CONTENT_REALM_SESSION_COOKIE}=content-session-token` };
    const mutationHeaders = {
      ...headers,
      origin: "https://content.example",
      "x-csrf-token": "content-csrf",
    };

    const collections = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/collections",
      headers,
    });
    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/collections/col_articles/documents?page=2&pageSize=10",
      headers,
    });
    const queried = await harness.app.inject({
      method: "POST",
      url: "/api/content-realms/community/collections/col_articles/documents/query",
      headers,
      payload: {
        limit: 10,
        filter: {
          type: "condition",
          field: { kind: "data", fieldId: "fld_title" },
          operator: "contains",
          value: "Article",
        },
      },
    });
    const fetched = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/collections/col_articles/documents/doc_article",
      headers,
    });
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/content-realms/community/collections/col_articles/documents",
      headers: mutationHeaders,
      payload: { data: { title: "Created" } },
    });
    const updated = await harness.app.inject({
      method: "PATCH",
      url: "/api/content-realms/community/collections/col_articles/documents/doc_article",
      headers: mutationHeaders,
      payload: { expectedVersion: 1, data: { title: "Updated" } },
    });

    expect(collections.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ page: 1, total: 1 });
    expect(queried.json()).toMatchObject({ hasNextPage: false });
    expect(fetched.json()).toMatchObject({ id: "doc_article" });
    expect(created.statusCode).toBe(201);
    expect(updated.json()).toMatchObject({ version: 2, data: { title: "Updated" } });
    expect(harness.documents.listDocuments).toHaveBeenCalledWith(expect.objectContaining({
      collectionId: "col_articles",
      page: 2,
      pageSize: 10,
      actor: expect.objectContaining({
        identityId: identity.id,
        realmId: realm.id,
        subjectId: membership.subjectId,
      }),
    }));
    expect(harness.documents.queryDocuments).toHaveBeenCalledWith(expect.objectContaining({
      collectionId: "col_articles",
      request: expect.objectContaining({
        limit: 10,
        filter: expect.objectContaining({ operator: "contains", value: "Article" }),
      }),
      actor: expect.objectContaining({
        identityId: identity.id,
        realmId: realm.id,
        subjectId: membership.subjectId,
      }),
    }));
    expect(harness.documents.createDocument.mock.calls[0]?.[0].actor).not.toHaveProperty("execution");
    expect(harness.contentAuthentication.assertCsrfToken).toHaveBeenCalledTimes(2);
    expect(harness.actors.requireSystemActor).not.toHaveBeenCalled();
  });

  it("fails closed on Realm substitution and clears an invalid session only at its Realm path", async () => {
    const harness = await createHarness();
    harness.contentAuthentication.authenticate.mockImplementation(async ({ sessionToken }) => {
      if (sessionToken === "expired-token") {
        throw new ApplicationError(
          "CONTENT_SESSION_INVALID",
          401,
          "The Realm session is invalid or expired.",
        );
      }
      return authenticatedContext;
    });

    const expired = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/community/session",
      headers: { cookie: `${CONTENT_REALM_SESSION_COOKIE}=expired-token` },
    });
    const substituted = await harness.app.inject({
      method: "GET",
      url: "/api/content-realms/other/profile",
      headers: { cookie: `${CONTENT_REALM_SESSION_COOKIE}=content-session-token` },
    });

    expect(expired.statusCode).toBe(200);
    expect(expired.json().authenticated).toBe(false);
    expect(String(expired.headers["set-cookie"])).toContain("Path=/api/content-realms/community");
    expect(substituted.statusCode).toBe(403);
    expect(substituted.headers["content-type"]).toContain("application/problem+json");
    expect(substituted.json()).toMatchObject({
      code: "REALM_SESSION_MISMATCH",
      status: 403,
    });
    expect(harness.profiles.get).not.toHaveBeenCalled();
  });

  it("never accepts Admin CSRF for Content mutation or request-controlled execution", async () => {
    const harness = await createHarness();
    const cookieHeader = `${CONTENT_REALM_SESSION_COOKIE}=content-session-token`;

    const wrongAudienceCsrf = await harness.app.inject({
      method: "PATCH",
      url: "/api/content-realms/community/profile",
      headers: {
        cookie: cookieHeader,
        origin: "https://content.example",
        "x-csrf-token": "admin-csrf",
      },
      payload: { expectedRevision: 6, data: { displayName: "Nope" } },
    });
    const injectedContentExecution = await harness.app.inject({
      method: "PATCH",
      url: "/api/content-realms/community/profile",
      headers: {
        cookie: cookieHeader,
        origin: "https://content.example",
        "x-csrf-token": "content-csrf",
      },
      payload: {
        expectedRevision: 6,
        data: { displayName: "Nope" },
        execution: "identity-provisioning",
      },
    });
    const injectedAdminExecution = await harness.app.inject({
      method: "PATCH",
      url: "/api/identity-realms/rlm_community",
      payload: {
        expectedRevision: 3,
        name: "Nope",
        status: "active",
        acceptSystemIdentities: true,
        provisioning: "jit",
        registration: "open",
        defaultRoleIds: [],
        execution: "identity-provisioning",
      },
    });
    const forgedReauthenticationTime = await harness.app.inject({
      method: "POST",
      url: "/api/identity-realms/rlm_community/full-access",
      payload: {
        subjectId: membership.subjectId,
        reason: "Forged proof",
        password: "admin-password",
        reauthenticatedAt: "2099-12-31T23:59:59.999Z",
      },
    });

    expect(wrongAudienceCsrf.statusCode).toBe(403);
    expect(wrongAudienceCsrf.json().code).toBe("CSRF_TOKEN_INVALID");
    expect(injectedContentExecution.statusCode).toBe(400);
    expect(injectedContentExecution.json().code).toBe("IDENTITY_REALM_REQUEST_INVALID");
    expect(injectedAdminExecution.statusCode).toBe(400);
    expect(injectedAdminExecution.json().code).toBe("IDENTITY_REALM_REQUEST_INVALID");
    expect(forgedReauthenticationTime.statusCode).toBe(400);
    expect(forgedReauthenticationTime.json().code).toBe("IDENTITY_REALM_REQUEST_INVALID");
    expect(harness.profiles.update).not.toHaveBeenCalled();
    expect(harness.administration.updateRealm).not.toHaveBeenCalled();
    expect(harness.administration.grantFullAccess).not.toHaveBeenCalled();
    expect(harness.actors.verifySystemReauthentication).not.toHaveBeenCalled();
    expect(harness.actors.requireSystemActor).toHaveBeenCalledTimes(2);
  });
});

async function createHarness(): Promise<{
  readonly app: FastifyInstance;
  readonly administration: MockAdministration;
  readonly contentAuthentication: MockContentAuthentication;
  readonly actors: MockActors;
  readonly profiles: MockProfiles;
  readonly documents: MockDocuments;
  readonly security: MockSecurity;
}> {
  const systemActor: ActorContext = {
    subjectId: "subject_admin",
    identityId: "identity_admin",
    workspaceId: realm.workspaceId,
    realmId: "rlm_system",
    capabilities: ["schema:apply"],
    execution: "identity-provisioning",
  };
  const contentActor: ActorContext = {
    subjectId: membership.subjectId,
    identityId: identity.id,
    workspaceId: realm.workspaceId,
    realmId: realm.id,
    capabilities: [],
    execution: "identity-provisioning",
  };

  const administration = {
    listGlobalIdentities: vi.fn<IdentityRealmAdministrationRouteService["listGlobalIdentities"]>(
      async () => [identity],
    ),
    listRealms: vi.fn<IdentityRealmAdministrationRouteService["listRealms"]>(
      async () => [realm],
    ),
    createRealm: vi.fn<IdentityRealmAdministrationRouteService["createRealm"]>(
      async () => realm,
    ),
    updateRealm: vi.fn<IdentityRealmAdministrationRouteService["updateRealm"]>(
      async (_actor, input) => ({ ...realm, name: input.name, revision: realm.revision + 1 }),
    ),
    listMemberships: vi.fn<IdentityRealmAdministrationRouteService["listMemberships"]>(
      async () => [membership],
    ),
    provisionMembership: vi.fn<IdentityRealmAdministrationRouteService["provisionMembership"]>(
      async () => membership,
    ),
    registerMembership: vi.fn<IdentityRealmAdministrationRouteService["registerMembership"]>(
      async () => membership,
    ),
    grantRealmAdministrator: vi.fn<IdentityRealmAdministrationRouteService["grantRealmAdministrator"]>(
      async () => membership,
    ),
    suspendMembership: vi.fn<IdentityRealmAdministrationRouteService["suspendMembership"]>(
      async () => ({ ...membership, status: "suspended", revision: 5, suspendedAt: realm.updatedAt }),
    ),
    reactivateMembership: vi.fn<IdentityRealmAdministrationRouteService["reactivateMembership"]>(
      async () => ({ ...membership, revision: 6 }),
    ),
    listFullAccessBindings: vi.fn<IdentityRealmAdministrationRouteService["listFullAccessBindings"]>(
      async () => [fullAccess],
    ),
    grantFullAccess: vi.fn<IdentityRealmAdministrationRouteService["grantFullAccess"]>(
      async () => fullAccess,
    ),
    revokeFullAccess: vi.fn<IdentityRealmAdministrationRouteService["revokeFullAccess"]>(
      async () => ({
        ...fullAccess,
        revokedAt: VERIFIED_REAUTHENTICATED_AT,
        revokedByIdentityId: "identity_admin",
      }),
    ),
  };

  const contentAuthentication = {
    signup: vi.fn<ContentRealmAuthenticationRouteService["signup"]>(
      async () => authenticatedSession,
    ),
    login: vi.fn<ContentRealmAuthenticationRouteService["login"]>(
      async () => authenticatedSession,
    ),
    authenticate: vi.fn<ContentRealmAuthenticationRouteService["authenticate"]>(
      async () => authenticatedContext,
    ),
    assertCsrfToken: vi.fn<ContentRealmAuthenticationRouteService["assertCsrfToken"]>(
      async ({ csrfToken }) => {
        if (csrfToken !== "content-csrf") {
          throw new ApplicationError("CSRF_TOKEN_INVALID", 403, "The CSRF token is invalid.");
        }
      },
    ),
    logout: vi.fn<ContentRealmAuthenticationRouteService["logout"]>(async () => undefined),
  };

  const metadata = {
    getByKey: vi.fn<ContentRealmMetadataRouteSource["getByKey"]>(async (realmKey) =>
      realmKey === realm.key ? { realm, identifierFieldIds: ["fld_email"] } : null),
  };

  const actors = {
    requireSystemActor: vi.fn<IdentityRealmRouteActorAdapter["requireSystemActor"]>(
      async () => systemActor,
    ),
    verifySystemReauthentication: vi.fn<
      IdentityRealmRouteActorAdapter["verifySystemReauthentication"]
    >(async () => ({ reauthenticatedAt: VERIFIED_REAUTHENTICATED_AT })),
    contentActorForSession: vi.fn<IdentityRealmRouteActorAdapter["contentActorForSession"]>(
      async () => contentActor,
    ),
  };

  const profiles = {
    get: vi.fn<ContentRealmProfileRouteAdapter["get"]>(async () => ({
      data: { displayName: "Member" },
      revision: 6,
    })),
    update: vi.fn<ContentRealmProfileRouteAdapter["update"]>(async (input) => ({
      data: input.data,
      revision: input.expectedRevision + 1,
    })),
  };

  const document = {
    id: "doc_article",
    collectionId: "col_articles",
    data: { title: "Article" },
    version: 1,
    createdAt: realm.createdAt,
    updatedAt: realm.updatedAt,
    displayState: "draft" as const,
    draftRevisionId: "rev_article",
    publication: null,
    deletion: null,
  };
  const documents = {
    listCollections: vi.fn<ContentRealmDocumentRouteAdapter["listCollections"]>(async () => ({
      items: [],
    })),
    listDocuments: vi.fn<ContentRealmDocumentRouteAdapter["listDocuments"]>(async () => ({
      items: [document], page: 1, pageSize: 25, total: 1,
    })),
    queryDocuments: vi.fn<ContentRealmDocumentRouteAdapter["queryDocuments"]>(async () => ({
      items: [document], hasNextPage: false,
    })),
    getDocument: vi.fn<ContentRealmDocumentRouteAdapter["getDocument"]>(async () => document),
    createDocument: vi.fn<ContentRealmDocumentRouteAdapter["createDocument"]>(async () => document),
    updateDocument: vi.fn<ContentRealmDocumentRouteAdapter["updateDocument"]>(
      async ({ request }) => ({ ...document, data: request.data, version: request.expectedVersion + 1 }),
    ),
  };

  const security = {
    assertContentOrigin: vi.fn<IdentityRealmRouteSecurityAdapter["assertContentOrigin"]>(
      async () => undefined,
    ),
    csrfTokenForContentSession: vi.fn<
      IdentityRealmRouteSecurityAdapter["csrfTokenForContentSession"]
    >(() => "content-csrf"),
  };

  const app = Fastify({ logger: false });
  openApps.add(app);
  await app.register(cookie);
  registerIdentityRealmRoutes({
    app,
    administration,
    contentAuthentication,
    metadata,
    actors,
    profiles,
    documents,
    security,
    secureCookies: false,
  });
  app.setErrorHandler((error, request, reply) => {
    const application = error instanceof ApplicationError ? error : undefined;
    const status = application?.status ?? 500;
    reply.type("application/problem+json").code(status).send({
      type: `urn:xecms:error:${application?.code.toLocaleLowerCase("en-US") ?? "internal-server-error"}`,
      title: status === 400 ? "Bad Request" : status === 403 ? "Forbidden" : "Error",
      status,
      detail: application?.message ?? "An unexpected server error occurred.",
      code: application?.code ?? "INTERNAL_SERVER_ERROR",
      requestId: request.id,
    });
  });
  await app.ready();
  return { app, administration, contentAuthentication, actors, profiles, documents, security };
}

type MockAdministration = ReturnTypeForAdministration;
type MockContentAuthentication = ReturnTypeForContentAuthentication;
type MockActors = ReturnTypeForActors;
type MockProfiles = ReturnTypeForProfiles;
type MockDocuments = ReturnTypeForDocuments;
type MockSecurity = ReturnTypeForSecurity;

type MockedService<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
    ? ReturnType<typeof vi.fn<(...args: TArgs) => TResult>>
    : T[K];
};

type ReturnTypeForAdministration = MockedService<IdentityRealmAdministrationRouteService>;
type ReturnTypeForContentAuthentication = MockedService<ContentRealmAuthenticationRouteService>;
type ReturnTypeForActors = MockedService<IdentityRealmRouteActorAdapter>;
type ReturnTypeForProfiles = MockedService<ContentRealmProfileRouteAdapter>;
type ReturnTypeForDocuments = MockedService<ContentRealmDocumentRouteAdapter>;
type ReturnTypeForSecurity = MockedService<IdentityRealmRouteSecurityAdapter>;
