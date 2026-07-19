import { describe, expect, it, vi } from "vitest";

import { createXeCmsClient, XeCmsApiError } from "./index.js";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createXeCmsClient", () => {
  it("loads a session and sends its CSRF token on mutations", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "user_owner", username: "admin" },
          csrfToken: "csrf-token",
          workspace: { id: "workspace_default", name: "Default" },
          capabilities: [],
          schema: { revisionId: null },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createXeCmsClient({ fetch });

    await client.auth.getSession();
    await client.auth.logout();

    const [, logoutRequest] = fetch.mock.calls[1] ?? [];
    expect(new Headers(logoutRequest?.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(logoutRequest?.credentials).toBe("same-origin");
  });

  it("throws a structured error and maps issue paths to field errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          type: "https://xecms.dev/problems/validation",
          title: "Validation failed",
          status: 400,
          detail: "The request is invalid.",
          code: "VALIDATION_FAILED",
          requestId: "req_1",
          issues: [{ code: "REQUIRED", message: "Required", path: ["data", "title"] }],
        },
        { status: 400 },
      ),
    );
    const client = createXeCmsClient({ fetch });

    const error = await client.auth.login({ username: "", password: "" }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(XeCmsApiError);
    expect((error as XeCmsApiError).fieldErrors).toEqual({ "data.title": "Required" });
    expect((error as XeCmsApiError).requestId).toBe("req_1");
  });

  it("refuses protected mutations until a session has supplied a CSRF token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createXeCmsClient({ fetch });

    await expect(client.documents.create("col_posts", { data: {} })).rejects.toThrow(
      "A session must be loaded",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("encodes the server-side session status and pagination query", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({ items: [], page: 3, pageSize: 10, total: 24 }),
    );
    const client = createXeCmsClient({ fetch });

    await expect(client.identities.listSessions("user / one", {
      status: "history", page: 3, pageSize: 10,
    })).resolves.toMatchObject({ page: 3, pageSize: 10, total: 24 });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/identities/user%20%2F%20one/sessions?status=history&page=3&pageSize=10",
    );
  });

  it("maps job inspection, manual execution, and retry to typed protected routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-jobs" }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 2, pageSize: 10, total: 0, counts: { pending: 0, processing: 0, succeeded: 0, dead: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ id: "delivery / 1", status: "dead" }))
      .mockResolvedValueOnce(jsonResponse({ fannedOut: 1, claimed: 1, succeeded: 1, failed: 0, dead: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: "delivery / 1", status: "pending" }));
    const client = createXeCmsClient({ fetch });

    await client.auth.getSession();
    await client.jobs.list({ page: 2, pageSize: 10, status: "dead", topic: "document.created", handlerId: "search worker" });
    await client.jobs.get("delivery / 1");
    await client.jobs.run();
    await client.jobs.retry("delivery / 1");

    expect(fetch.mock.calls[1]?.[0]).toBe("/api/jobs?page=2&pageSize=10&status=dead&topic=document.created&handlerId=search+worker");
    expect(fetch.mock.calls[2]?.[0]).toBe("/api/jobs/delivery%20%2F%201");
    expect(fetch.mock.calls[3]?.[0]).toBe("/api/jobs/run");
    expect(fetch.mock.calls[3]?.[1]?.method).toBe("POST");
    expect(new Headers(fetch.mock.calls[3]?.[1]?.headers).get("x-csrf-token")).toBe("csrf-jobs");
    expect(fetch.mock.calls[4]?.[0]).toBe("/api/jobs/delivery%20%2F%201/retry");
    expect(new Headers(fetch.mock.calls[4]?.[1]?.headers).get("x-csrf-token")).toBe("csrf-jobs");
  });

  it("maps lifecycle, revision, trash, and public content methods to stable routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "user_owner", username: "admin" },
          csrfToken: "csrf-lifecycle",
          workspace: { id: "wrk_default", name: "Default" },
          capabilities: ["document:publish", "document:purge"],
          schema: { revisionId: "sch_1" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 2, pageSize: 10, total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: "doc_1", version: 4 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], documentVersion: 4 }))
      .mockResolvedValueOnce(jsonResponse({ id: "doc_1", version: 5 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 1, pageSize: 5, total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: "doc_1", revisionId: "rev_1" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createXeCmsClient({ fetch });

    await client.auth.getSession();
    await client.documents.list("col_posts", { page: 2, pageSize: 10, state: "deleted" });
    await client.documents.publish("col_posts", "doc_1", { expectedVersion: 3 });
    await client.revisions.list("col_posts", "doc_1");
    await client.revisions.restore("col_posts", "doc_1", "rev_1", { expectedVersion: 4 });
    await client.content.list("col_posts", { page: 1, pageSize: 5 });
    await client.content.get("col_posts", "doc_1");
    await client.documents.purge("col_posts", "doc_1", { expectedVersion: 6 });

    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/collections/col_posts/documents?page=2&pageSize=10&state=deleted",
    );

    const [publishUrl, publishRequest] = fetch.mock.calls[2] ?? [];
    expect(publishUrl).toBe("/api/collections/col_posts/documents/doc_1/publish");
    expect(publishRequest?.method).toBe("POST");
    expect(publishRequest?.body).toBe(JSON.stringify({ expectedVersion: 3 }));
    expect(new Headers(publishRequest?.headers).get("x-csrf-token")).toBe("csrf-lifecycle");

    expect(fetch.mock.calls[3]?.[0]).toBe(
      "/api/collections/col_posts/documents/doc_1/revisions",
    );
    const [restoreUrl, restoreRequest] = fetch.mock.calls[4] ?? [];
    expect(restoreUrl).toBe(
      "/api/collections/col_posts/documents/doc_1/revisions/rev_1/restore",
    );
    expect(restoreRequest?.method).toBe("POST");
    expect(restoreRequest?.body).toBe(JSON.stringify({ expectedVersion: 4 }));

    expect(fetch.mock.calls[5]?.[0]).toBe("/api/content/col_posts/documents?page=1&pageSize=5");
    expect(fetch.mock.calls[6]?.[0]).toBe("/api/content/col_posts/documents/doc_1");

    const [purgeUrl, purgeRequest] = fetch.mock.calls[7] ?? [];
    expect(purgeUrl).toBe("/api/collections/col_posts/documents/doc_1/purge");
    expect(purgeRequest?.method).toBe("DELETE");
    expect(purgeRequest?.body).toBe(JSON.stringify({ expectedVersion: 6 }));
  });

  it("sends typed document queries as read-only POST bodies", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => jsonResponse({ items: [], hasNextPage: false }));
    const client = createXeCmsClient({ fetch });
    const query = {
      limit: 20,
      fields: ["fld_title"],
      filter: {
        type: "condition" as const,
        field: { kind: "data" as const, fieldId: "fld_title" },
        operator: "contains" as const,
        value: "XeCMS",
      },
      sort: [{
        field: { kind: "system" as const, field: "updatedAt" as const },
        direction: "desc" as const,
      }],
    };

    await client.documents.query("articles / featured", query);
    await client.contentRealms.forRealm("community / beta")
      .queryDocuments("articles / featured", query);

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/collections/articles%20%2F%20featured/documents/query",
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/content-realms/community%20%2F%20beta/collections/articles%20%2F%20featured/documents/query",
    );
    for (const [, request] of fetch.mock.calls) {
      expect(request?.method).toBe("POST");
      expect(request?.body).toBe(JSON.stringify(query));
      expect(new Headers(request?.headers).get("x-csrf-token")).toBeNull();
    }
  });

  it("sends self access profile checks as a read-only typed POST", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({ policyRevision: 3, items: [] }),
    );
    const client = createXeCmsClient({ fetch });
    const input = {
      checks: [
        {
          id: "navigation.content",
          type: "permission" as const,
          action: "content.read",
          resourceId: "resource:content",
        },
        {
          id: "field.title.write",
          type: "field" as const,
          action: "content.update",
          resourceId: "resource:collection:posts",
          field: "field_title",
          access: "write" as const,
        },
      ],
    };

    await client.access.evaluateBatch(input);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/access/evaluate-batch");
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-csrf-token")).toBeNull();
  });

  it("maps the typed Identity Realm administration surface to encoded Admin routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-admin" }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1" }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm-created" }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", profileCollectionId: "col_profile" }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", profileCollectionId: "col_profile" }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ membershipId: "membership-created", status: "active" }))
      .mockResolvedValueOnce(jsonResponse({ membershipId: "membership / 1", status: "suspended" }))
      .mockResolvedValueOnce(jsonResponse({ membershipId: "membership / 1", status: "active" }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", status: "ownerless", policyRevision: 1 }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", status: "healthy", policyRevision: 2 }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", status: "healthy", policyRevision: 3 }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", status: "healthy", policyRevision: 4 }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ bindingId: "binding-created" }))
      .mockResolvedValueOnce(jsonResponse({ bindingId: "binding / 1", revokedAt: "2026-07-15T01:00:00.000Z" }));
    const client = createXeCmsClient({ fetch });
    const realmId = "realm / 1";

    await client.auth.getSession();
    await client.identityRealms.listGlobalIdentities();
    await client.identityRealms.list();
    await client.identityRealms.get(realmId);
    await client.identityRealms.create({ key: "community", name: "Community" });
    await client.identityRealms.createProfileSchema(realmId, {
      collectionName: "communityAccounts",
      collectionLabel: "Community Accounts",
      identifierFieldName: "memberEmail",
      includeDisplayName: true,
    });
    await client.identityRealms.createProfileField(realmId, {
      name: "nickname",
      label: "Nickname",
      type: "text",
    });
    await client.identityRealms.update(realmId, {
      expectedRevision: 1,
      name: "Community",
      status: "active",
      acceptSystemIdentities: true,
      provisioning: "jit",
      registration: "open",
      defaultRoleIds: ["role_member"],
    });
    await client.identityRealms.listMemberships(realmId);
    await client.identityRealms.provisionMembership(realmId, {
      globalIdentityId: "identity_owner",
      profile: { displayName: "Operator" },
      password: "correct horse battery staple",
    });
    await client.identityRealms.suspendMembership(realmId, "membership / 1", {
      expectedRevision: 3,
    });
    await client.identityRealms.reactivateMembership(realmId, "membership / 1", {
      expectedRevision: 4,
    });
    await client.identityRealms.getOwner(realmId);
    await client.identityRealms.assignOwner(realmId, {
      targetMembershipId: "membership / 1",
      expectedPolicyRevision: 1,
      reason: "Initial owner",
      password: "correct horse battery staple",
    });
    await client.identityRealms.transferOwner(realmId, {
      targetMembershipId: "membership / 2",
      expectedPolicyRevision: 2,
      reason: "Handover",
      password: "correct horse battery staple",
      revokePreviousSessions: true,
    });
    await client.identityRealms.recoverOwner(realmId, {
      targetMembershipId: "membership / 3",
      expectedPolicyRevision: 3,
      reason: "Ownerless recovery",
      password: "correct horse battery staple",
    });
    await client.identityRealms.listFullAccess(realmId);
    await client.identityRealms.grantFullAccess(realmId, {
      reason: "Emergency recovery",
      password: "correct horse battery staple",
      validUntil: "2026-07-15T02:00:00.000Z",
    });
    await client.identityRealms.revokeFullAccess(realmId, "binding / 1", {
      password: "correct horse battery staple",
    });

    expect(fetch.mock.calls[1]?.[0]).toBe("/api/global-identities");
    expect(fetch.mock.calls[2]?.[0]).toBe("/api/identity-realms");
    expect(fetch.mock.calls[3]?.[0]).toBe("/api/identity-realms/realm%20%2F%201");

    const [createUrl, createRequest] = fetch.mock.calls[4] ?? [];
    expect(createUrl).toBe("/api/identity-realms");
    expect(createRequest?.method).toBe("POST");
    expect(new Headers(createRequest?.headers).get("x-csrf-token")).toBe("csrf-admin");

    const [profileSchemaUrl, profileSchemaRequest] = fetch.mock.calls[5] ?? [];
    expect(profileSchemaUrl).toBe("/api/identity-realms/realm%20%2F%201/profile-schema");
    expect(profileSchemaRequest?.method).toBe("POST");
    expect(profileSchemaRequest?.body).toContain('"identifierFieldName":"memberEmail"');
    expect(new Headers(profileSchemaRequest?.headers).get("x-csrf-token")).toBe("csrf-admin");

    const [profileFieldUrl, profileFieldRequest] = fetch.mock.calls[6] ?? [];
    expect(profileFieldUrl).toBe("/api/identity-realms/realm%20%2F%201/profile-fields");
    expect(profileFieldRequest?.method).toBe("POST");
    expect(profileFieldRequest?.body).toBe(JSON.stringify({
      name: "nickname",
      label: "Nickname",
      type: "text",
    }));
    expect(new Headers(profileFieldRequest?.headers).get("x-csrf-token")).toBe("csrf-admin");

    const [updateUrl, updateRequest] = fetch.mock.calls[7] ?? [];
    expect(updateUrl).toBe("/api/identity-realms/realm%20%2F%201");
    expect(updateRequest?.method).toBe("PATCH");
    expect(updateRequest?.body).toContain('"expectedRevision":1');

    expect(fetch.mock.calls[8]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/memberships",
    );
    const [provisionUrl, provisionRequest] = fetch.mock.calls[9] ?? [];
    expect(provisionUrl).toBe("/api/identity-realms/realm%20%2F%201/memberships");
    expect(provisionRequest?.method).toBe("POST");
    expect(provisionRequest?.body).toContain('"globalIdentityId":"identity_owner"');
    const [suspendUrl, suspendRequest] = fetch.mock.calls[10] ?? [];
    expect(suspendUrl).toBe(
      "/api/identity-realms/realm%20%2F%201/memberships/membership%20%2F%201",
    );
    expect(suspendRequest?.body).toBe(JSON.stringify({ expectedRevision: 3, status: "suspended" }));
    const [, reactivateRequest] = fetch.mock.calls[11] ?? [];
    expect(reactivateRequest?.body).toBe(JSON.stringify({ expectedRevision: 4, status: "active" }));

    expect(fetch.mock.calls[12]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/owner",
    );
    expect(fetch.mock.calls[13]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/owner/assign",
    );
    expect(fetch.mock.calls[14]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/owner/transfer",
    );
    expect(fetch.mock.calls[15]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/owner/recover",
    );
    expect(fetch.mock.calls[16]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/full-access",
    );
    expect(fetch.mock.calls[17]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/full-access",
    );
    const [revokeUrl, revokeRequest] = fetch.mock.calls[18] ?? [];
    expect(revokeUrl).toBe(
      "/api/identity-realms/realm%20%2F%201/full-access/binding%20%2F%201",
    );
    expect(revokeRequest?.method).toBe("DELETE");
    expect(new Headers(revokeRequest?.headers).get("x-csrf-token")).toBe("csrf-admin");
  });

  it("maps the collection entitlement control-plane routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-admin" }))
      .mockResolvedValueOnce(jsonResponse({ status: null, items: [] }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm / 1", collectionId: "col / a", actions: ["read"], revision: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ collectionId: "col / a", items: [] }));
    const client = createXeCmsClient({ fetch });
    const realmId = "realm / 1";
    const collectionId = "col / a";

    await client.auth.getSession();
    await client.identityRealms.listCollectionEntitlements(realmId);
    await client.identityRealms.putCollectionEntitlement(realmId, collectionId, {
      actions: ["read"],
      constraint: { ownerOnly: true },
      expectedRevision: null,
      password: "correct horse battery staple",
    });
    await client.identityRealms.deleteCollectionEntitlement(realmId, collectionId, {
      expectedRevision: 1,
      password: "correct horse battery staple",
    });
    await client.identityRealms.listEntitlementsForCollection(collectionId);

    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/collection-entitlements",
    );
    const [putUrl, putRequest] = fetch.mock.calls[2] ?? [];
    expect(putUrl).toBe(
      "/api/identity-realms/realm%20%2F%201/collection-entitlements/col%20%2F%20a",
    );
    expect(putRequest?.method).toBe("PUT");
    expect(putRequest?.body).toContain('"ownerOnly":true');
    expect(new Headers(putRequest?.headers).get("x-csrf-token")).toBe("csrf-admin");
    const [deleteUrl, deleteRequest] = fetch.mock.calls[3] ?? [];
    expect(deleteUrl).toBe(
      "/api/identity-realms/realm%20%2F%201/collection-entitlements/col%20%2F%20a",
    );
    expect(deleteRequest?.method).toBe("DELETE");
    expect(fetch.mock.calls[4]?.[0]).toBe(
      "/api/collections/col%20%2F%20a/entitlements",
    );
  });

  it("maps the management delegation control-plane routes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-admin" }))
      .mockResolvedValueOnce(jsonResponse({ managingRealmId: "realm / 1", items: [] }))
      .mockResolvedValueOnce(jsonResponse({ managedRealmId: "realm / 1", items: [] }))
      .mockResolvedValueOnce(jsonResponse({ managingRealmId: "realm / 1", managedRealmId: "realm / 2", actions: ["identity.disable"], scopeByAction: { "identity.disable": "any" }, revision: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createXeCmsClient({ fetch });
    const realmId = "realm / 1";
    const managedRealmId = "realm / 2";

    await client.auth.getSession();
    await client.identityRealms.listManagementDelegations(realmId);
    await client.identityRealms.listManagedByDelegations(realmId);
    await client.identityRealms.putManagementDelegation(realmId, managedRealmId, {
      actions: ["identity.disable"],
      scopeByAction: { "identity.disable": "any" },
      expectedRevision: null,
      password: "correct horse battery staple",
    });
    await client.identityRealms.deleteManagementDelegation(realmId, managedRealmId, {
      expectedRevision: 1,
      password: "correct horse battery staple",
    });

    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/management-delegations",
    );
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/managed-by-delegations",
    );
    const [putUrl, putRequest] = fetch.mock.calls[3] ?? [];
    expect(putUrl).toBe(
      "/api/identity-realms/realm%20%2F%201/management-delegations/realm%20%2F%202",
    );
    expect(putRequest?.method).toBe("PUT");
    expect(putRequest?.body).toContain('"identity.disable":"any"');
    expect(new Headers(putRequest?.headers).get("x-csrf-token")).toBe("csrf-admin");
    const [deleteUrl, deleteRequest] = fetch.mock.calls[4] ?? [];
    expect(deleteUrl).toBe(
      "/api/identity-realms/realm%20%2F%201/management-delegations/realm%20%2F%202",
    );
    expect(deleteRequest?.method).toBe("DELETE");
  });

  it("maps a Realm-scoped Content client and stores only that Realm's response token", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ realmKey: "community / beta" }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: "csrf-signup" }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: "csrf-login" }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: "csrf-session" }))
      .mockResolvedValueOnce(jsonResponse({ profileDocumentId: "profile-1", revision: 5 }))
      .mockResolvedValueOnce(jsonResponse({ profileDocumentId: "profile-1", revision: 6 }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [], page: 2, pageSize: 10, total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: "doc / 1", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ id: "doc-created", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ id: "doc / 1", version: 2 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createXeCmsClient({ fetch });
    const realm = client.contentRealms.forRealm("community / beta");

    await realm.getMetadata();
    await realm.signup({
      identifier: "member@example.test",
      password: "correct horse battery staple",
      profile: { displayName: "Member" },
    });
    await realm.login({
      identifier: "member@example.test",
      password: "correct horse battery staple",
      jitProfile: { displayName: "Member" },
    });
    await realm.getSession();
    await realm.getProfile();
    await realm.updateProfile({ expectedRevision: 5, data: { displayName: "Updated" } });
    await realm.listCollections();
    await realm.listDocuments("articles / featured", { page: 2, pageSize: 10 });
    await realm.getDocument("articles / featured", "doc / 1");
    await realm.createDocument("articles / featured", { data: { title: "Created" } });
    await realm.updateDocument("articles / featured", "doc / 1", {
      expectedVersion: 1,
      data: { title: "Updated" },
    });
    await realm.logout();

    const prefix = "/api/content-realms/community%20%2F%20beta";
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      prefix,
      `${prefix}/signup`,
      `${prefix}/login`,
      `${prefix}/session`,
      `${prefix}/profile`,
      `${prefix}/profile`,
      `${prefix}/collections`,
      `${prefix}/collections/articles%20%2F%20featured/documents?page=2&pageSize=10`,
      `${prefix}/collections/articles%20%2F%20featured/documents/doc%20%2F%201`,
      `${prefix}/collections/articles%20%2F%20featured/documents`,
      `${prefix}/collections/articles%20%2F%20featured/documents/doc%20%2F%201`,
      `${prefix}/logout`,
    ]);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      identifier: "member@example.test",
      password: "correct horse battery staple",
      profile: { displayName: "Member" },
    }));
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get("x-csrf-token")).toBeNull();
    expect(new Headers(fetch.mock.calls[5]?.[1]?.headers).get("x-csrf-token")).toBe(
      "csrf-session",
    );
    expect(new Headers(fetch.mock.calls[9]?.[1]?.headers).get("x-csrf-token")).toBe(
      "csrf-session",
    );
    expect(new Headers(fetch.mock.calls[10]?.[1]?.headers).get("x-csrf-token")).toBe(
      "csrf-session",
    );
    expect(new Headers(fetch.mock.calls[11]?.[1]?.headers).get("x-csrf-token")).toBe(
      "csrf-session",
    );

    await expect(
      realm.updateProfile({ expectedRevision: 6, data: { displayName: "Again" } }),
    ).rejects.toThrow("A Content Realm session for 'community / beta' must be loaded");
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it("reuses the authorization client under an encoded Content Realm prefix", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-admin" }))
      .mockResolvedValueOnce(jsonResponse({ realm: { id: "realm / 1" }, revision: 1 }))
      .mockResolvedValueOnce(jsonResponse({ realm: { id: "realm / 1" }, revision: 2 }));
    const client = createXeCmsClient({ fetch });
    await client.auth.getSession();
    const authorization = client.identityRealms.authorizationFor("realm / 1");
    await authorization.getPolicy();
    await authorization.createBinding({
      expectedPolicyRevision: 1,
      subjectId: "subject_member",
      roleId: "role_editor",
      resourceId: "resource:collection:articles",
      propagation: "self",
    });

    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/authorization/policy",
    );
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "/api/identity-realms/realm%20%2F%201/authorization/bindings",
    );
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get("x-csrf-token")).toBe("csrf-admin");
  });

  it("isolates Admin and per-Realm CSRF tokens and clears only the Realm that receives 401", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-admin" }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: "csrf-a" }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: "csrf-b" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "https://xecms.dev/problems/content-session-invalid",
            title: "Unauthorized",
            status: 401,
            detail: "The Realm session is invalid or expired.",
            code: "CONTENT_SESSION_INVALID",
            requestId: "req-realm-a",
          },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ profileDocumentId: "profile-b", revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({ realmId: "realm-created" }));
    const client = createXeCmsClient({ fetch });
    const realmA = client.contentRealms.forRealm("realm-a");
    const realmB = client.contentRealms.forRealm("realm-b");
    const credentials = { identifier: "member@example.test", password: "a secure password" };

    await client.auth.getSession();
    await realmA.login(credentials);
    await realmB.login(credentials);
    await expect(
      realmA.updateProfile({ expectedRevision: 1, data: { displayName: "A" } }),
    ).rejects.toMatchObject({ status: 401, code: "CONTENT_SESSION_INVALID" });
    await realmB.updateProfile({ expectedRevision: 1, data: { displayName: "B" } });
    await client.identityRealms.create({ key: "created", name: "Created" });

    expect(new Headers(fetch.mock.calls[3]?.[1]?.headers).get("x-csrf-token")).toBe("csrf-a");
    expect(new Headers(fetch.mock.calls[4]?.[1]?.headers).get("x-csrf-token")).toBe("csrf-b");
    expect(new Headers(fetch.mock.calls[5]?.[1]?.headers).get("x-csrf-token")).toBe(
      "csrf-admin",
    );

    await expect(
      realmA.updateProfile({ expectedRevision: 1, data: { displayName: "A2" } }),
    ).rejects.toThrow("A Content Realm session for 'realm-a' must be loaded");
    expect(fetch).toHaveBeenCalledTimes(6);
  });
});
