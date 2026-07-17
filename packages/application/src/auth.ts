import { ApplicationError, type AdminCapability } from "./errors.js";

export const OWNER_CAPABILITIES: readonly AdminCapability[] = Object.freeze([
  "schema:read",
  "schema:write",
  "schema:apply",
  "document:read",
  "document:create",
  "document:update",
  "document:delete",
  "document:publish",
  "document:purge",
]);

export interface IdentityRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly isOwner: boolean;
  readonly passwordChangeRequired: boolean;
}

export interface StoredSession {
  readonly identity: IdentityRecord;
  readonly expiresAt: string;
}

export interface AuthStore {
  bootstrapRequired(): Promise<boolean>;
  createInitialOwner(input: {
    readonly id: string;
    readonly username: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<IdentityRecord>;
  findIdentityByUsername(username: string): Promise<IdentityRecord | null>;
  createSession(input: {
    readonly sessionTokenHash: string;
    readonly csrfTokenHash: string;
    readonly identityId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void>;
  findSession(sessionTokenHash: string, now: string): Promise<StoredSession | null>;
  findSessionWithCsrf(
    sessionTokenHash: string,
    csrfTokenHash: string,
    now: string,
  ): Promise<boolean>;
  deleteSession(sessionTokenHash: string): Promise<void>;
  recordAuthEvent(input: {
    readonly event:
      | "login.succeeded"
      | "login.failed"
      | "reauthentication.succeeded"
      | "reauthentication.failed"
      | "logout"
      | "bootstrap.owner-created";
    readonly identityId?: string;
    readonly username?: string;
    readonly occurredAt: string;
  }): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
  verifyDummy(password: string): Promise<void>;
}

export interface AuthRuntime {
  readonly now: () => string;
  readonly newIdentityId: () => string;
  readonly randomToken: () => string;
  readonly hashToken: (token: string) => string;
  readonly deriveCsrfToken: (sessionToken: string) => string;
  readonly verifyCsrfToken: (sessionToken: string, csrfToken: string) => boolean;
}

export interface AuthenticatedSession {
  readonly identity: IdentityRecord;
  readonly capabilities: readonly AdminCapability[];
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export class AuthApplicationService {
  public constructor(
    private readonly store: AuthStore,
    private readonly passwords: PasswordHasher,
    private readonly runtime: AuthRuntime,
    private readonly sessionLifetimeMs = 8 * 60 * 60 * 1000,
  ) {}

  public bootstrapRequired(): Promise<boolean> {
    return this.store.bootstrapRequired();
  }

  public async bootstrap(input: {
    readonly username: string;
    readonly password: string;
  }): Promise<IdentityRecord> {
    const username = normalizeSystemIdentityIdentifier(input.username);
    validateIdentityPassword(input.password, username);
    const now = this.runtime.now();
    const identity = await this.store.createInitialOwner({
      id: this.runtime.newIdentityId(),
      username,
      passwordHash: await this.passwords.hash(input.password),
      now,
    });
    await this.store.recordAuthEvent({
      event: "bootstrap.owner-created",
      identityId: identity.id,
      username: identity.username,
      occurredAt: now,
    });
    return identity;
  }

  public async login(input: {
    readonly username: string;
    readonly password: string;
  }): Promise<AuthenticatedSession> {
    const username = normalizeSystemIdentityIdentifier(input.username);
    const identity = await this.store.findIdentityByUsername(username);
    const now = this.runtime.now();
    let verified = false;
    if (identity === null) {
      await this.passwords.verifyDummy(input.password);
    } else {
      verified = await this.passwords.verify(input.password, identity.passwordHash);
    }
    if (identity === null || !verified) {
      await this.store.recordAuthEvent({
        event: "login.failed",
        username,
        occurredAt: now,
      });
      throw new ApplicationError("AUTHENTICATION_FAILED", 401, "The username or password is incorrect.");
    }
    const sessionToken = this.runtime.randomToken();
    const csrfToken = this.runtime.deriveCsrfToken(sessionToken);
    const expiresAt = new Date(Date.parse(now) + this.sessionLifetimeMs).toISOString();
    await this.store.createSession({
      sessionTokenHash: this.runtime.hashToken(sessionToken),
      csrfTokenHash: this.runtime.hashToken(csrfToken),
      identityId: identity.id,
      createdAt: now,
      expiresAt,
    });
    await this.store.recordAuthEvent({
      event: "login.succeeded",
      identityId: identity.id,
      username: identity.username,
      occurredAt: now,
    });
    return {
      identity,
      capabilities: identity.isOwner ? OWNER_CAPABILITIES : [],
      sessionToken,
      csrfToken,
      expiresAt,
    };
  }

  public async authenticate(input: {
    readonly sessionToken: string;
  }): Promise<Omit<AuthenticatedSession, "sessionToken" | "csrfToken">> {
    const session = await this.store.findSession(
      this.runtime.hashToken(input.sessionToken),
      this.runtime.now(),
    );
    if (session === null) {
      throw new ApplicationError("SESSION_INVALID", 401, "The session is missing, expired, or revoked.");
    }
    return {
      identity: session.identity,
      capabilities: session.identity.isOwner ? OWNER_CAPABILITIES : [],
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Verifies a sensitive-operation challenge without issuing another session.
   * Its server-generated timestamp is the only reauthentication evidence that
   * a caller may pass to protected application services.
   */
  public async reauthenticate(input: {
    readonly identityId: string;
    readonly username: string;
    readonly password: string;
  }): Promise<string> {
    const username = normalizeSystemIdentityIdentifier(input.username);
    const identity = await this.store.findIdentityByUsername(username);
    const now = this.runtime.now();
    let verified = false;
    if (identity === null) {
      await this.passwords.verifyDummy(input.password);
    } else {
      verified = await this.passwords.verify(input.password, identity.passwordHash);
    }
    if (identity === null || identity.id !== input.identityId || !verified) {
      await this.store.recordAuthEvent({
        event: "reauthentication.failed",
        identityId: input.identityId,
        occurredAt: now,
      });
      throw new ApplicationError("REAUTHENTICATION_FAILED", 401, "Password verification failed.");
    }
    await this.store.recordAuthEvent({
      event: "reauthentication.succeeded",
      identityId: identity.id,
      occurredAt: now,
    });
    return now;
  }

  public csrfTokenForSession(sessionToken: string): string {
    return this.runtime.deriveCsrfToken(sessionToken);
  }

  public async assertCsrfToken(sessionToken: string, csrfToken: string): Promise<void> {
    if (!this.runtime.verifyCsrfToken(sessionToken, csrfToken)) {
      throw new ApplicationError("CSRF_TOKEN_INVALID", 403, "The CSRF token is invalid.");
    }
    const active = await this.store.findSessionWithCsrf(
      this.runtime.hashToken(sessionToken),
      this.runtime.hashToken(csrfToken),
      this.runtime.now(),
    );
    if (!active) {
      throw new ApplicationError("CSRF_TOKEN_INVALID", 403, "The CSRF token is invalid.");
    }
  }

  public async logout(sessionToken: string, identityId?: string): Promise<void> {
    const now = this.runtime.now();
    await this.store.deleteSession(this.runtime.hashToken(sessionToken));
    await this.store.recordAuthEvent({
      event: "logout",
      ...(identityId === undefined ? {} : { identityId }),
      occurredAt: now,
    });
  }
}

export function normalizeSystemIdentityIdentifier(value: string): string {
  if (typeof value !== "string") {
    throw new ApplicationError("USERNAME_INVALID", 422, "Username must be a string.");
  }
  const username = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username)) {
    throw new ApplicationError(
      "USERNAME_INVALID",
      422,
      "Username must be 3-64 characters and use letters, numbers, '.', '_' or '-'.",
    );
  }
  return username;
}

export function validateIdentityPassword(password: string, username: string): void {
  if (typeof password !== "string" || password.length > 128 || password.includes("\u0000")) {
    throw new ApplicationError("PASSWORD_INVALID", 422, "Password is not valid.");
  }
  if (password.length < 12) {
    throw new ApplicationError(
      "PASSWORD_TOO_SHORT",
      422,
      "Production owner passwords must contain at least 12 characters.",
    );
  }
  if (password.toLocaleLowerCase("en-US") === username.toLocaleLowerCase("en-US")) {
    throw new ApplicationError(
      "PASSWORD_MATCHES_USERNAME",
      422,
      "The owner password cannot match the username.",
    );
  }
}
