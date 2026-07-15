import { describe, expect, it, vi } from "vitest";
import type { PasswordHasher } from "./auth.js";
import {
  IdentityAdministrationService,
  type IdentityAdministrationStore,
  type ManagedIdentity,
} from "./identity-administration.js";

const NOW = "2026-07-15T10:00:00.000Z";
const IDENTITY: ManagedIdentity = {
  id: "usr_target",
  workspaceId: "wrk_default",
  kind: "human",
  primaryIdentifier: "target.user",
  originRealmId: "rlm_system",
  isOwner: false,
  status: "active",
  credentialVersion: 1,
  passwordChangeRequired: true,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
  memberships: [],
};

function fixture() {
  const store: IdentityAdministrationStore = {
    list: vi.fn(async () => ({ items: [IDENTITY] })),
    get: vi.fn(async (id) => id === IDENTITY.id ? IDENTITY : null),
    createHuman: vi.fn(async (input) => ({
      ...IDENTITY,
      id: input.id,
      primaryIdentifier: input.primaryIdentifier,
      createdAt: input.now,
      updatedAt: input.now,
    })),
    updateIdentifier: vi.fn(async (input) => ({
      ...IDENTITY,
      primaryIdentifier: input.primaryIdentifier,
      revision: IDENTITY.revision + 1,
    })),
    setDisabled: vi.fn(async (input) => ({
      ...IDENTITY,
      status: input.disabled ? "disabled" as const : "active" as const,
      revision: IDENTITY.revision + 1,
    })),
    resetPassword: vi.fn(async () => ({ ...IDENTITY, credentialVersion: 2, revision: 2 })),
    createCredentialToken: vi.fn(async () => undefined),
    resolveCredentialToken: vi.fn(async () => null),
    consumeCredentialToken: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
    createSystemMembership: vi.fn(async () => ({ ...IDENTITY, revision: 2 })),
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async () => null),
    revokeSession: vi.fn(async (input) => ({
      id: input.sessionId, audience: "admin" as const, identityId: IDENTITY.id,
      realmId: "rlm_system", realmName: "System Realm", membershipId: "membership_system",
      createdAt: NOW, authenticatedAt: NOW, expiresAt: NOW, revokedAt: input.now,
      revokedByIdentityId: input.actorIdentityId, revokeReason: "administrator-revoked", current: false,
    })),
    revokeAllSessions: vi.fn(async () => 0),
    transferOwner: vi.fn(async (input) => ({ ...IDENTITY, id: input.targetIdentityId, isOwner: true })),
    createService: vi.fn(async (input) => ({
      ...IDENTITY, id: input.id, kind: "service" as const,
      primaryIdentifier: input.primaryIdentifier, passwordChangeRequired: false,
    })),
    listApiKeys: vi.fn(async () => []),
    createApiKey: vi.fn(async (input) => ({
      id: input.id, identityId: input.identityId, name: input.name,
      prefix: input.prefix, scopes: input.scopes, createdAt: input.now,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })),
    revokeApiKey: vi.fn(async (input) => ({
      id: input.apiKeyId, identityId: IDENTITY.id, name: "Automation",
      prefix: "prefix123", scopes: ["content.read"], createdAt: NOW, revokedAt: input.now,
    })),
    authenticateApiKey: vi.fn(async () => null),
  };
  const passwords: PasswordHasher = {
    hash: vi.fn(async (password) => `hash:${password}`),
    verify: vi.fn(async () => true),
    verifyDummy: vi.fn(async () => undefined),
  };
  const service = new IdentityAdministrationService(store, passwords, {
    now: () => NOW,
    newIdentityId: () => "usr_created",
    newAuditId: () => "audit_created",
    newApiKeyId: () => "api_key_1234567890abcdef",
    randomSecret: () => "a".repeat(43),
    hashApiKey: (rawKey) => `digest:${rawKey}`,
    newCredentialTokenId: () => "token_test",
    hashCredentialToken: (rawToken) => `token-digest:${rawToken}`,
  });
  return { service, store, passwords };
}

describe("IdentityAdministrationService", () => {
  it("normalizes a System identifier and hashes a temporary password before persistence", async () => {
    const { service, store, passwords } = fixture();
    await expect(service.createHuman({
      workspaceId: "wrk_default",
      primaryIdentifier: "  New.User  ",
      temporaryPassword: "Temporary-Password-2026",
      actorIdentityId: "usr_owner",
      actorSubjectId: "usr_owner",
    })).resolves.toMatchObject({ id: "usr_created", primaryIdentifier: "New.User" });
    expect(passwords.hash).toHaveBeenCalledWith("Temporary-Password-2026");
    expect(store.createHuman).toHaveBeenCalledWith(expect.objectContaining({
      primaryIdentifier: "New.User",
      normalizedIdentifier: "new.user",
      passwordHash: "hash:Temporary-Password-2026",
      passwordChangeRequired: true,
    }));
  });

  it("rejects weak temporary passwords before hashing or writing", async () => {
    const { service, store, passwords } = fixture();
    await expect(service.createHuman({
      workspaceId: "wrk_default",
      primaryIdentifier: "new.user",
      temporaryPassword: "short",
      actorIdentityId: "usr_owner",
      actorSubjectId: "usr_owner",
    })).rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT", status: 422 });
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(store.createHuman).not.toHaveBeenCalled();
  });

  it("fails closed when an Identity is missing", async () => {
    const { service } = fixture();
    await expect(service.get("usr_missing", "wrk_default"))
      .rejects.toEqual(expect.objectContaining({
        code: "IDENTITY_NOT_FOUND",
        status: 404,
      }));
  });

  it("prevents the current Identity from disabling itself", async () => {
    const { service, store } = fixture();
    expect(() => service.setDisabled({
      identityId: "usr_owner",
      workspaceId: "wrk_default",
      expectedRevision: 1,
      disabled: true,
      actorIdentityId: "usr_owner",
      actorSubjectId: "usr_owner",
    })).toThrow(expect.objectContaining({ code: "IDENTITY_SELF_DISABLE_FORBIDDEN" }));
    expect(store.setDisabled).not.toHaveBeenCalled();
  });
});
