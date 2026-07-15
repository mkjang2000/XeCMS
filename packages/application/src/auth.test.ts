import { describe, expect, it } from "vitest";

import {
  AuthApplicationService,
  type AuthRuntime,
  type AuthStore,
  type IdentityRecord,
  type PasswordHasher,
} from "./auth.js";

const identity: IdentityRecord = {
  id: "identity_owner",
  workspaceId: "wrk_default",
  username: "admin",
  passwordHash: "encoded:correct-password",
  isOwner: true,
  passwordChangeRequired: false,
};

describe("AuthApplicationService reauthentication", () => {
  it("returns server time and audits a matching System identity challenge", async () => {
    const fixture = authFixture();
    const at = await fixture.service.reauthenticate({
      identityId: identity.id,
      username: identity.username,
      password: "correct-password",
    });

    expect(at).toBe("2026-07-15T03:00:00.000Z");
    expect(fixture.events).toEqual([{
      event: "reauthentication.succeeded",
      identityId: identity.id,
      occurredAt: at,
    }]);
  });

  it("fails generically for a wrong password or a different session identity", async () => {
    const wrongPassword = authFixture();
    await expect(wrongPassword.service.reauthenticate({
      identityId: identity.id,
      username: identity.username,
      password: "wrong-password",
    })).rejects.toMatchObject({ code: "REAUTHENTICATION_FAILED", status: 401 });
    expect(wrongPassword.events[0]?.event).toBe("reauthentication.failed");

    const wrongIdentity = authFixture();
    await expect(wrongIdentity.service.reauthenticate({
      identityId: "identity_other",
      username: identity.username,
      password: "correct-password",
    })).rejects.toMatchObject({ code: "REAUTHENTICATION_FAILED", status: 401 });
    expect(wrongIdentity.events[0]).toMatchObject({
      event: "reauthentication.failed",
      identityId: "identity_other",
    });
  });
});

function authFixture(): {
  readonly service: AuthApplicationService;
  readonly events: Array<Parameters<AuthStore["recordAuthEvent"]>[0]>;
} {
  const events: Array<Parameters<AuthStore["recordAuthEvent"]>[0]> = [];
  const unused = async (): Promise<never> => { throw new Error("unused"); };
  const store: AuthStore = {
    bootstrapRequired: async () => false,
    createInitialOwner: unused,
    findIdentityByUsername: async (username) => username === identity.username ? identity : null,
    createSession: async () => undefined,
    findSession: async () => null,
    findSessionWithCsrf: async () => false,
    deleteSession: async () => undefined,
    recordAuthEvent: async (event) => { events.push(event); },
  };
  const passwords: PasswordHasher = {
    hash: async (password) => `encoded:${password}`,
    verify: async (password, hash) => hash === `encoded:${password}`,
    verifyDummy: async () => undefined,
  };
  const runtime: AuthRuntime = {
    now: () => "2026-07-15T03:00:00.000Z",
    newIdentityId: () => "identity_new",
    randomToken: () => "token",
    hashToken: (value) => `hash:${value}`,
    deriveCsrfToken: (value) => `csrf:${value}`,
    verifyCsrfToken: (token, csrf) => csrf === `csrf:${token}`,
  };
  return { service: new AuthApplicationService(store, passwords, runtime), events };
}
