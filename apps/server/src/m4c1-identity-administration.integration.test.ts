import { randomUUID } from "node:crypto";

import { PostgresDatabase, qualifiedName, quoteIdentifier } from "@xecms/database";
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
  ?? process.env["DATABASE_URL"]
  ?? "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";
const ORIGIN = "http://127.0.0.1:3199";

interface Session { readonly cookie: string; readonly csrfToken: string }
interface Identity {
  readonly identityId: string;
  readonly primaryIdentifier: string;
  readonly status: "active" | "disabled";
  readonly revision: number;
  readonly credentialVersion: number;
  readonly passwordChangeRequired: boolean;
  readonly memberships: readonly { readonly realmId: string; readonly subjectId: string }[];
}

describe.runIf(RUN)("M4-C1 Identity administration HTTP acceptance", () => {
  it("enforces session, CSRF, RBAC, CAS and immediate login revocation", async () => {
    const schema = `xecms_m4c1_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema, maxConnections: 5 });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schema,
      XECMS_SESSION_SECRET: "m4c1-integration-session-secret-0123456789",
      XECMS_ADMIN_ORIGINS: ORIGIN,
      XECMS_ADMIN_DIST: "/not-used-in-http-test",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, config, logger: false });
      await bootstrapTestOwner(server);
      const anonymous = await server.app.inject({ method: "GET", url: "/api/identities" });
      expect(anonymous.statusCode).toBe(401);
      const owner = await login(server, TEST_OWNER_USERNAME, TEST_OWNER_PASSWORD);

      const missingCsrf = await server.app.inject({
        method: "POST",
        url: "/api/identities",
        headers: { cookie: owner.cookie, origin: ORIGIN },
        payload: { primaryIdentifier: "c1.operator", temporaryPassword: "Operator-password-2026!" },
      });
      expect(missingCsrf.statusCode).toBe(403);

      const createdResponse = await adminRequest(server, owner, "POST", "/api/identities", {
        primaryIdentifier: "c1.operator",
        temporaryPassword: "Operator-password-2026!",
      });
      expect(createdResponse.statusCode, createdResponse.body).toBe(201);
      let identity = createdResponse.json<Identity>();
      expect(identity).toMatchObject({
        primaryIdentifier: "c1.operator",
        status: "active",
        revision: 1,
        credentialVersion: 1,
        passwordChangeRequired: true,
      });
      expect(identity.memberships).toEqual([expect.objectContaining({ realmId: "rlm_system" })]);

      const list = await server.app.inject({
        method: "GET",
        url: "/api/identities?query=operator&status=active",
        headers: { cookie: owner.cookie },
      });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().items).toEqual([expect.objectContaining({ identityId: identity.identityId })]);

      const renamed = await adminRequest(server, owner, "PATCH", `/api/identities/${identity.identityId}`, {
        expectedRevision: identity.revision,
        primaryIdentifier: "c1.renamed",
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      identity = renamed.json<Identity>();
      expect(identity).toMatchObject({ primaryIdentifier: "c1.renamed", revision: 2 });

      const stale = await adminRequest(server, owner, "PATCH", `/api/identities/${identity.identityId}`, {
        expectedRevision: 1,
        primaryIdentifier: "c1.stale",
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().code).toBe("IDENTITY_REVISION_CONFLICT");

      const targetSession = await login(server, "c1.renamed", "Operator-password-2026!");
      expect(targetSession.cookie).toContain("xecms_session=");
      const disabled = await adminRequest(server, owner, "POST", `/api/identities/${identity.identityId}/disable`, {
        expectedRevision: identity.revision,
      });
      expect(disabled.statusCode, disabled.body).toBe(200);
      identity = disabled.json<Identity>();
      expect(identity).toMatchObject({ status: "disabled", revision: 3, credentialVersion: 2 });
      const revoked = await server.app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { cookie: targetSession.cookie },
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json().user).toBeNull();
      await expect(login(server, "c1.renamed", "Operator-password-2026!"))
        .rejects.toThrow(/login failed: 401/);

      const reactivated = await adminRequest(server, owner, "POST", `/api/identities/${identity.identityId}/reactivate`, {
        expectedRevision: identity.revision,
      });
      expect(reactivated.statusCode, reactivated.body).toBe(200);
      identity = reactivated.json<Identity>();
      expect(identity).toMatchObject({ status: "active", revision: 4, credentialVersion: 2 });

      const invitationResponse = await adminRequest(server, owner, "POST", `/api/identities/${identity.identityId}/invitations`, {
        expectedRevision: identity.revision,
        currentPassword: TEST_OWNER_PASSWORD,
      });
      expect(invitationResponse.statusCode, invitationResponse.body).toBe(201);
      const invitation = invitationResponse.json() as { secret: string; expiresAt: string };
      expect(invitation.secret).toMatch(/^xecms_setup_/);
      const completeInvitation = await server.app.inject({
        method: "POST", url: "/api/credentials/setup",
        payload: { token: invitation.secret, newPassword: "Invitation-completed-2026!" },
      });
      expect(completeInvitation.statusCode, completeInvitation.body).toBe(204);
      const replayInvitation = await server.app.inject({
        method: "POST", url: "/api/credentials/setup",
        payload: { token: invitation.secret, newPassword: "Replay-password-2026!" },
      });
      expect(replayInvitation.statusCode).toBe(400);
      expect(replayInvitation.json().code).toBe("CREDENTIAL_TOKEN_INVALID");
      identity = (await server.app.inject({
        method: "GET", url: `/api/identities/${identity.identityId}`, headers: { cookie: owner.cookie },
      })).json<Identity>();
      expect(identity).toMatchObject({ revision: 6, passwordChangeRequired: false });

      const ownerList = await server.app.inject({
        method: "GET", url: "/api/identities?query=admin", headers: { cookie: owner.cookie },
      });
      const ownerIdentity = ownerList.json().items[0] as Identity;
      const selfDisable = await adminRequest(server, owner, "POST", `/api/identities/${ownerIdentity.identityId}/disable`, {
        expectedRevision: ownerIdentity.revision,
      });
      expect(selfDisable.statusCode).toBe(403);

      const targetAfterReactivate = await login(server, "c1.renamed", "Invitation-completed-2026!");
      const sessions = await server.app.inject({
        method: "GET",
        url: `/api/identities/${identity.identityId}/sessions`,
        headers: { cookie: owner.cookie },
      });
      expect(sessions.statusCode, sessions.body).toBe(200);
      expect(sessions.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ identityId: identity.identityId, audience: "admin" }),
      ]));

      const resetTokenResponse = await adminRequest(server, owner, "POST", `/api/identities/${identity.identityId}/credentials/reset-token`, {
        expectedRevision: 6,
        currentPassword: TEST_OWNER_PASSWORD,
      });
      expect(resetTokenResponse.statusCode, resetTokenResponse.body).toBe(201);
      const resetToken = resetTokenResponse.json() as { secret: string };
      expect(resetToken.secret).toMatch(/^xecms_reset_/);
      const tokenRevokedSession = await server.app.inject({
        method: "GET", url: "/api/auth/session", headers: { cookie: targetAfterReactivate.cookie },
      });
      expect(tokenRevokedSession.json().user).toBeNull();
      const completeReset = await server.app.inject({
        method: "POST", url: "/api/credentials/reset/complete",
        payload: { token: resetToken.secret, newPassword: "Reset-token-completed-2026!" },
      });
      expect(completeReset.statusCode, completeReset.body).toBe(204);

      const resetTokenLogin = await login(server, "c1.renamed", "Reset-token-completed-2026!");
      const reset = await adminRequest(server, owner, "POST", `/api/identities/${identity.identityId}/credentials/reset`, {
        expectedRevision: 8,
        temporaryPassword: "Temporary-after-reset-2026!",
        currentPassword: TEST_OWNER_PASSWORD,
        revokeApiKeys: true,
      });
      expect(reset.statusCode, reset.body).toBe(200);
      identity = reset.json<Identity>();
      expect(identity).toMatchObject({ revision: 9, passwordChangeRequired: true });
      const resetRevokedSession = await server.app.inject({
        method: "GET", url: "/api/auth/session", headers: { cookie: resetTokenLogin.cookie },
      });
      expect(resetRevokedSession.json().user).toBeNull();
      await expect(login(server, "c1.renamed", "Reset-token-completed-2026!"))
        .rejects.toThrow(/login failed: 401/);

      const resetLogin = await login(server, "c1.renamed", "Temporary-after-reset-2026!");
      const forcedMutation = await adminRequest(server, resetLogin, "PATCH", `/api/identities/${identity.identityId}`, {
        expectedRevision: identity.revision, primaryIdentifier: "c1.blocked",
      });
      expect(forcedMutation.statusCode).toBe(403);
      expect(forcedMutation.json().code).toBe("PASSWORD_CHANGE_REQUIRED");
      const changedPassword = await adminRequest(server, resetLogin, "POST", "/api/credentials/password", {
        currentPassword: "Temporary-after-reset-2026!",
        newPassword: "Final-operator-password-2026!",
      });
      expect(changedPassword.statusCode, changedPassword.body).toBe(204);
      const changedSession = await server.app.inject({
        method: "GET", url: "/api/auth/session", headers: { cookie: resetLogin.cookie },
      });
      expect(changedSession.json().user).toBeNull();
      const finalLogin = await login(server, "c1.renamed", "Final-operator-password-2026!");
      const currentSessions = await server.app.inject({
        method: "GET",
        url: `/api/identities/${identity.identityId}/sessions`,
        headers: { cookie: finalLogin.cookie },
      });
      expect(currentSessions.statusCode, currentSessions.body).toBe(200);
      const current = currentSessions.json().items.find((item: { current: boolean }) => item.current) as { sessionId: string } | undefined;
      expect(current).toBeDefined();
      const revokeCurrent = await server.app.inject({
        method: "DELETE",
        url: `/api/sessions/${current!.sessionId}`,
        headers: { cookie: finalLogin.cookie, origin: ORIGIN, "x-csrf-token": finalLogin.csrfToken },
      });
      expect(revokeCurrent.statusCode, revokeCurrent.body).toBe(200);
      const afterCurrentRevoke = await server.app.inject({
        method: "GET", url: "/api/auth/session", headers: { cookie: finalLogin.cookie },
      });
      expect(afterCurrentRevoke.json().user).toBeNull();

      const ownerTransfer = await adminRequest(server, owner, "POST", "/api/owner/transfer", {
        targetIdentityId: identity.identityId,
        reason: "Acceptance test ownership handover",
        currentPassword: TEST_OWNER_PASSWORD,
      });
      expect(ownerTransfer.statusCode, ownerTransfer.body).toBe(200);
      expect(ownerTransfer.json()).toMatchObject({ identityId: identity.identityId, isOwner: true });
      const previousOwnerSession = await server.app.inject({
        method: "GET", url: "/api/auth/session", headers: { cookie: owner.cookie },
      });
      expect(previousOwnerSession.json().user).toBeNull();
      const newOwner = await login(server, "c1.renamed", "Final-operator-password-2026!");
      const authorizedAsNewOwner = await server.app.inject({
        method: "GET", url: "/api/identities", headers: { cookie: newOwner.cookie },
      });
      expect(authorizedAsNewOwner.statusCode, authorizedAsNewOwner.body).toBe(200);

      await database.pool.query(
        `INSERT INTO ${qualifiedName(schema, "_xecms_identities")}
           (id, workspace_id, realm_id, origin_realm_id, username, normalized_username,
            password_hash, is_owner, credential_version, created_at, updated_at, updated_by)
         VALUES ('c1_content_promoted', 'wrk_default', 'rlm_system', 'rlm_system',
                 'content.promoted', 'content.promoted', 'not-a-system-login-yet', false, 1,
                 now(), now(), 'c1_content_promoted')`,
      );
      await database.pool.query(
        `INSERT INTO ${qualifiedName(schema, "_xecms_identity_identifiers")}
           (id, workspace_id, identity_id, identifier_kind, normalized_value, display_value,
            created_at, created_by)
         VALUES ('identifier_c1_content_promoted', 'wrk_default', 'c1_content_promoted',
                 'primary', 'content.promoted', 'content.promoted', now(), 'c1_content_promoted')`,
      );
      const promoted = await adminRequest(server, newOwner, "POST", "/api/identities/c1_content_promoted/system-membership", {
        expectedRevision: 1,
      });
      expect(promoted.statusCode, promoted.body).toBe(201);
      expect(promoted.json().memberships).toEqual([expect.objectContaining({ realmId: "rlm_system" })]);

      const serviceResponse = await adminRequest(server, newOwner, "POST", "/api/service-identities", {
        primaryIdentifier: "acceptance.reader",
      });
      expect(serviceResponse.statusCode, serviceResponse.body).toBe(201);
      const serviceIdentity = serviceResponse.json<Identity>();
      expect(serviceIdentity).toMatchObject({ primaryIdentifier: "acceptance.reader" });

      const policyResponse = await server.app.inject({
        method: "GET", url: "/api/authorization/policy", headers: { cookie: newOwner.cookie },
      });
      expect(policyResponse.statusCode, policyResponse.body).toBe(200);
      const policy = policyResponse.json() as {
        revision: number;
        roles: readonly { id: string; name: string }[];
        resources: readonly { id: string; type: string }[];
      };
      const viewer = policy.roles.find(({ name }) => name === "Viewer");
      const workspace = policy.resources.find(({ type }) => type === "workspace");
      expect(viewer).toBeDefined();
      expect(workspace).toBeDefined();
      const binding = await adminRequest(server, newOwner, "POST", "/api/authorization/bindings", {
        expectedPolicyRevision: policy.revision,
        subjectId: serviceIdentity.identityId,
        roleId: viewer!.id,
        resourceId: workspace!.id,
        propagation: "self-and-children",
      });
      expect(binding.statusCode, binding.body).toBe(201);

      const keyResponse = await adminRequest(
        server,
        newOwner,
        "POST",
        `/api/service-identities/${serviceIdentity.identityId}/api-keys`,
        { name: "Acceptance read key", scopes: ["schema.read"] },
      );
      expect(keyResponse.statusCode, keyResponse.body).toBe(201);
      const apiKey = keyResponse.json() as { apiKeyId: string; secret: string; prefix: string };
      expect(apiKey.secret).toMatch(/^xecms_/);
      const bearerCollections = await server.app.inject({
        method: "GET", url: "/api/collections", headers: { authorization: `Bearer ${apiKey.secret}` },
      });
      expect(bearerCollections.statusCode, bearerCollections.body).toBe(200);
      const scopeDenied = await server.app.inject({
        method: "GET", url: "/api/media", headers: { authorization: `Bearer ${apiKey.secret}` },
      });
      expect(scopeDenied.statusCode).toBe(403);
      expect(scopeDenied.json().code).toBe("API_KEY_SCOPE_DENIED");
      const mixedAuthentication = await server.app.inject({
        method: "GET", url: "/api/collections",
        headers: { authorization: `Bearer ${apiKey.secret}`, cookie: newOwner.cookie },
      });
      expect(mixedAuthentication.statusCode).toBe(400);
      const forbiddenAdministration = await server.app.inject({
        method: "GET", url: "/api/identities", headers: { authorization: `Bearer ${apiKey.secret}` },
      });
      expect(forbiddenAdministration.statusCode).toBe(403);
      const forbiddenRealmAdministration = await server.app.inject({
        method: "GET", url: "/api/identity-realms", headers: { authorization: `Bearer ${apiKey.secret}` },
      });
      expect(forbiddenRealmAdministration.statusCode).toBe(403);
      expect(forbiddenRealmAdministration.json().code).toBe("API_KEY_ADMINISTRATION_FORBIDDEN");

      const revokedKey = await server.app.inject({
        method: "DELETE", url: `/api/api-keys/${apiKey.apiKeyId}`,
        headers: { cookie: newOwner.cookie, origin: ORIGIN, "x-csrf-token": newOwner.csrfToken },
      });
      expect(revokedKey.statusCode, revokedKey.body).toBe(200);
      const afterKeyRevoke = await server.app.inject({
        method: "GET", url: "/api/collections", headers: { authorization: `Bearer ${apiKey.secret}` },
      });
      expect(afterKeyRevoke.statusCode).toBe(401);
    } finally {
      await server?.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => undefined);
      await database.close();
    }
  }, 30_000);
});

async function login(server: XeCmsServer, username: string, password: string): Promise<Session> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { username, password },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  return {
    cookie: String(response.headers["set-cookie"]).split(";", 1)[0]!,
    csrfToken: response.json().csrfToken as string,
  };
}

async function adminRequest(
  server: XeCmsServer,
  session: Session,
  method: "POST" | "PATCH",
  url: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<LightMyRequestResponse> {
  return await server.app.inject({
    method,
    url,
    headers: { cookie: session.cookie, origin: ORIGIN, "x-csrf-token": session.csrfToken },
    payload,
  });
}
