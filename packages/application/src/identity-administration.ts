import type { PasswordHasher } from "./auth.js";
import { normalizeSystemIdentityIdentifier, validateIdentityPassword } from "./auth.js";
import { ApplicationError } from "./errors.js";

export type ManagedIdentityKind = "human" | "service";
export type ManagedIdentityStatus = "active" | "disabled";

export interface ManagedIdentityMembership {
  readonly membershipId: string;
  readonly realmId: string;
  readonly realmKey: string;
  readonly realmName: string;
  readonly realmKind: "system" | "content";
  readonly subjectId: string;
  readonly status: "pending" | "active" | "suspended";
  readonly profileDocumentId?: string;
}

export interface ManagedIdentity {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: ManagedIdentityKind;
  readonly primaryIdentifier: string;
  readonly originRealmId: string;
  readonly isOwner: boolean;
  readonly status: ManagedIdentityStatus;
  readonly credentialVersion: number;
  readonly passwordChangeRequired: boolean;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly disabledAt?: string;
  readonly memberships: readonly ManagedIdentityMembership[];
}

export interface ManagedIdentityPage {
  readonly items: readonly ManagedIdentity[];
  readonly nextCursor?: string;
}

export interface ManagedSession {
  readonly id: string;
  readonly audience: "admin" | "content";
  readonly identityId: string;
  readonly realmId: string;
  readonly realmName: string;
  readonly membershipId: string;
  readonly createdAt: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly revokedByIdentityId?: string;
  readonly revokeReason?: string;
  readonly current: boolean;
}

export interface ApiKeyRecord {
  readonly id: string;
  readonly identityId: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
}

export interface CreatedApiKey extends ApiKeyRecord {
  /** Returned only by creation. It is never persisted in this form. */
  readonly secret: string;
}

export type CredentialTokenPurpose = "invitation" | "password-reset";

export interface CreatedCredentialToken {
  readonly purpose: CredentialTokenPurpose;
  readonly identityId: string;
  /** Returned once. Only its digest is persisted. */
  readonly secret: string;
  readonly expiresAt: string;
}

export interface CredentialTokenIdentity {
  readonly identityId: string;
  readonly primaryIdentifier: string;
  readonly purpose: CredentialTokenPurpose;
}

export interface AuthenticatedApiKey {
  readonly apiKeyId: string;
  readonly identityId: string;
  readonly workspaceId: string;
  readonly subjectId: string;
  readonly scopes: readonly string[];
}

export interface IdentityAdministrationStore {
  list(input: {
    readonly workspaceId: string;
    readonly limit: number;
    readonly cursor?: string;
    readonly query?: string;
    readonly kind?: ManagedIdentityKind;
    readonly status?: ManagedIdentityStatus;
    readonly originRealmId?: string;
    readonly realmId?: string;
  }): Promise<ManagedIdentityPage>;
  get(identityId: string, workspaceId: string): Promise<ManagedIdentity | null>;
  createHuman(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly primaryIdentifier: string;
    readonly normalizedIdentifier: string;
    readonly passwordHash: string;
    readonly passwordChangeRequired: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity>;
  updateIdentifier(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly primaryIdentifier: string;
    readonly normalizedIdentifier: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity>;
  setDisabled(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly disabled: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity>;
  resetPassword(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly passwordHash: string;
    readonly revokeApiKeys: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity>;
  createCredentialToken(input: {
    readonly id: string;
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly purpose: CredentialTokenPurpose;
    readonly digest: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly expiresAt: string;
    readonly auditId: string;
  }): Promise<void>;
  resolveCredentialToken(input: {
    readonly purpose: CredentialTokenPurpose;
    readonly digest: string;
    readonly now: string;
  }): Promise<CredentialTokenIdentity | null>;
  consumeCredentialToken(input: {
    readonly purpose: CredentialTokenPurpose;
    readonly digest: string;
    readonly identityId: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<void>;
  changePassword(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly passwordHash: string;
    readonly now: string;
  }): Promise<void>;
  createSystemMembership(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity>;
  listSessions(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly currentSessionId?: string;
  }): Promise<readonly ManagedSession[]>;
  getSession(sessionId: string, workspaceId: string): Promise<ManagedSession | null>;
  revokeSession(input: {
    readonly sessionId: string;
    readonly workspaceId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<ManagedSession>;
  revokeAllSessions(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly actorIdentityId: string;
    readonly now: string;
  }): Promise<number>;
  transferOwner(input: {
    readonly workspaceId: string;
    readonly targetIdentityId: string;
    readonly reason: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
    readonly now: string;
    readonly auditId: string;
  }): Promise<ManagedIdentity>;
  createService(input: {
    readonly id: string; readonly workspaceId: string;
    readonly primaryIdentifier: string; readonly normalizedIdentifier: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
    readonly now: string; readonly auditId: string;
  }): Promise<ManagedIdentity>;
  listApiKeys(identityId: string, workspaceId: string): Promise<readonly ApiKeyRecord[]>;
  createApiKey(input: {
    readonly id: string; readonly identityId: string; readonly workspaceId: string;
    readonly name: string; readonly prefix: string; readonly digest: string;
    readonly scopes: readonly string[]; readonly expiresAt?: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string; readonly now: string;
  }): Promise<ApiKeyRecord>;
  revokeApiKey(input: {
    readonly apiKeyId: string; readonly workspaceId: string;
    readonly actorIdentityId: string; readonly now: string;
  }): Promise<ApiKeyRecord>;
  authenticateApiKey(input: {
    readonly prefix: string; readonly digest: string; readonly now: string;
  }): Promise<AuthenticatedApiKey | null>;
}

export interface IdentityAdministrationRuntime {
  readonly now: () => string;
  readonly newIdentityId: () => string;
  readonly newAuditId: () => string;
  readonly newApiKeyId: () => string;
  readonly randomSecret: () => string;
  readonly hashApiKey: (rawKey: string) => string;
  readonly newCredentialTokenId: () => string;
  readonly hashCredentialToken: (rawToken: string) => string;
}

export class IdentityAdministrationService {
  public constructor(
    private readonly store: IdentityAdministrationStore,
    private readonly passwords: PasswordHasher,
    private readonly runtime: IdentityAdministrationRuntime,
  ) {}

  public list(input: Parameters<IdentityAdministrationStore["list"]>[0]): Promise<ManagedIdentityPage> {
    return this.store.list(input);
  }

  public async get(identityId: string, workspaceId: string): Promise<ManagedIdentity> {
    const identity = await this.store.get(identityId, workspaceId);
    if (identity === null) identityNotFound();
    return identity;
  }

  public async createHuman(input: {
    readonly workspaceId: string;
    readonly primaryIdentifier: string;
    readonly temporaryPassword: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    const primaryIdentifier = normalizeSystemIdentityIdentifier(input.primaryIdentifier);
    validateIdentityPassword(input.temporaryPassword, primaryIdentifier);
    const now = this.runtime.now();
    return this.store.createHuman({
      id: this.runtime.newIdentityId(),
      workspaceId: input.workspaceId,
      primaryIdentifier,
      normalizedIdentifier: primaryIdentifier.toLocaleLowerCase("en-US"),
      passwordHash: await this.passwords.hash(input.temporaryPassword),
      passwordChangeRequired: true,
      actorIdentityId: input.actorIdentityId,
      actorSubjectId: input.actorSubjectId,
      now,
      auditId: this.runtime.newAuditId(),
    });
  }

  public async updateIdentifier(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly primaryIdentifier: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    const primaryIdentifier = normalizeSystemIdentityIdentifier(input.primaryIdentifier);
    return this.store.updateIdentifier({
      ...input,
      primaryIdentifier,
      normalizedIdentifier: primaryIdentifier.toLocaleLowerCase("en-US"),
      now: this.runtime.now(),
      auditId: this.runtime.newAuditId(),
    });
  }

  public setDisabled(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly disabled: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    if (input.identityId === input.actorIdentityId && input.disabled) {
      throw new ApplicationError("IDENTITY_SELF_DISABLE_FORBIDDEN", 409, "The current Identity cannot disable itself.");
    }
    return this.store.setDisabled({ ...input, now: this.runtime.now(), auditId: this.runtime.newAuditId() });
  }

  public async resetPassword(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly temporaryPassword: string;
    readonly revokeApiKeys: boolean;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    const identity = await this.get(input.identityId, input.workspaceId);
    if (identity.kind !== "human") {
      throw new ApplicationError("SERVICE_IDENTITY_PASSWORD_FORBIDDEN", 409, "Service Identities cannot have passwords.");
    }
    validateIdentityPassword(input.temporaryPassword, identity.primaryIdentifier);
    return this.store.resetPassword({
      identityId: input.identityId,
      workspaceId: input.workspaceId,
      expectedRevision: input.expectedRevision,
      passwordHash: await this.passwords.hash(input.temporaryPassword),
      revokeApiKeys: input.revokeApiKeys,
      actorIdentityId: input.actorIdentityId,
      actorSubjectId: input.actorSubjectId,
      now: this.runtime.now(),
      auditId: this.runtime.newAuditId(),
    });
  }

  public async createCredentialToken(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly purpose: CredentialTokenPurpose;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<CreatedCredentialToken> {
    const identity = await this.get(input.identityId, input.workspaceId);
    if (identity.kind !== "human" || identity.status !== "active") {
      throw new ApplicationError("CREDENTIAL_TOKEN_IDENTITY_INVALID", 409, "Credential tokens require an active human Identity.");
    }
    const now = this.runtime.now();
    const expiresAt = new Date(Date.parse(now) + (input.purpose === "invitation" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000)).toISOString();
    const rawToken = `xecms_${input.purpose === "invitation" ? "setup" : "reset"}_${this.runtime.randomSecret()}`;
    await this.store.createCredentialToken({
      id: this.runtime.newCredentialTokenId(),
      identityId: input.identityId,
      workspaceId: input.workspaceId,
      expectedRevision: input.expectedRevision,
      purpose: input.purpose,
      digest: this.runtime.hashCredentialToken(rawToken),
      actorIdentityId: input.actorIdentityId,
      actorSubjectId: input.actorSubjectId,
      now,
      expiresAt,
      auditId: this.runtime.newAuditId(),
    });
    return { purpose: input.purpose, identityId: input.identityId, secret: rawToken, expiresAt };
  }

  public async completeCredentialToken(input: {
    readonly purpose: CredentialTokenPurpose;
    readonly token: string;
    readonly newPassword: string;
  }): Promise<void> {
    const digest = this.runtime.hashCredentialToken(input.token);
    const tokenIdentity = await this.store.resolveCredentialToken({
      purpose: input.purpose,
      digest,
      now: this.runtime.now(),
    });
    if (tokenIdentity === null) credentialTokenInvalid();
    validateIdentityPassword(input.newPassword, tokenIdentity.primaryIdentifier);
    await this.store.consumeCredentialToken({
      purpose: input.purpose,
      digest,
      identityId: tokenIdentity.identityId,
      passwordHash: await this.passwords.hash(input.newPassword),
      now: this.runtime.now(),
    });
  }

  public async changeOwnPassword(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly newPassword: string;
  }): Promise<void> {
    const identity = await this.get(input.identityId, input.workspaceId);
    if (identity.kind !== "human" || identity.status !== "active") {
      throw new ApplicationError("PASSWORD_CHANGE_IDENTITY_INVALID", 409, "Only an active human Identity can change its password.");
    }
    validateIdentityPassword(input.newPassword, identity.primaryIdentifier);
    await this.store.changePassword({
      identityId: input.identityId,
      workspaceId: input.workspaceId,
      passwordHash: await this.passwords.hash(input.newPassword),
      now: this.runtime.now(),
    });
  }

  public createSystemMembership(input: {
    readonly identityId: string;
    readonly workspaceId: string;
    readonly expectedRevision: number;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    return this.store.createSystemMembership({
      ...input,
      now: this.runtime.now(),
      auditId: this.runtime.newAuditId(),
    });
  }

  public listSessions(input: Parameters<IdentityAdministrationStore["listSessions"]>[0]): Promise<readonly ManagedSession[]> {
    return this.store.listSessions(input);
  }

  public async getSession(sessionId: string, workspaceId: string): Promise<ManagedSession> {
    const session = await this.store.getSession(sessionId, workspaceId);
    if (session === null) throw new ApplicationError("SESSION_NOT_FOUND", 404, "The session does not exist.");
    return session;
  }

  public revokeSession(input: Omit<Parameters<IdentityAdministrationStore["revokeSession"]>[0], "now">): Promise<ManagedSession> {
    return this.store.revokeSession({ ...input, now: this.runtime.now() });
  }

  public revokeAllSessions(input: Omit<Parameters<IdentityAdministrationStore["revokeAllSessions"]>[0], "now">): Promise<number> {
    return this.store.revokeAllSessions({ ...input, now: this.runtime.now() });
  }

  public transferOwner(input: {
    readonly workspaceId: string;
    readonly targetIdentityId: string;
    readonly reason: string;
    readonly actorIdentityId: string;
    readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    const reason = input.reason.normalize("NFKC").trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new ApplicationError("OWNER_TRANSFER_REASON_INVALID", 422, "Owner transfer reason must contain 3-500 characters.");
    }
    if (input.targetIdentityId === input.actorIdentityId) {
      throw new ApplicationError("OWNER_TRANSFER_TARGET_INVALID", 409, "The current Owner is already the Workspace Owner.");
    }
    return this.store.transferOwner({
      ...input,
      reason,
      now: this.runtime.now(),
      auditId: this.runtime.newAuditId(),
    });
  }

  public createService(input: {
    readonly workspaceId: string; readonly primaryIdentifier: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
  }): Promise<ManagedIdentity> {
    const primaryIdentifier = normalizeSystemIdentityIdentifier(input.primaryIdentifier);
    return this.store.createService({
      id: this.runtime.newIdentityId(), workspaceId: input.workspaceId,
      primaryIdentifier, normalizedIdentifier: primaryIdentifier.toLocaleLowerCase("en-US"),
      actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId,
      now: this.runtime.now(), auditId: this.runtime.newAuditId(),
    });
  }

  public listApiKeys(identityId: string, workspaceId: string): Promise<readonly ApiKeyRecord[]> {
    return this.store.listApiKeys(identityId, workspaceId);
  }

  public async createApiKey(input: {
    readonly identityId: string; readonly workspaceId: string; readonly name: string;
    readonly scopes: readonly string[]; readonly expiresAt?: string;
    readonly actorIdentityId: string; readonly actorSubjectId: string;
  }): Promise<CreatedApiKey> {
    const name = input.name.normalize("NFKC").trim();
    if (name.length < 1 || name.length > 120) apiKeyInvalid("name");
    const scopes = [...new Set(input.scopes.map((scope) => scope.trim()))].sort();
    if (scopes.some((scope) => !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(scope))) apiKeyInvalid("scopes");
    const now = this.runtime.now();
    if (input.expiresAt !== undefined && (!Number.isFinite(Date.parse(input.expiresAt)) || input.expiresAt <= now)) apiKeyInvalid("expiresAt");
    const prefix = this.runtime.newApiKeyId().replaceAll("-", "").slice(-16);
    const rawKey = `xecms_${prefix}_${this.runtime.randomSecret()}`;
    const record = await this.store.createApiKey({
      id: `key_${prefix}`, identityId: input.identityId, workspaceId: input.workspaceId,
      name, prefix, digest: this.runtime.hashApiKey(rawKey), scopes,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      actorIdentityId: input.actorIdentityId, actorSubjectId: input.actorSubjectId, now,
    });
    return { ...record, secret: rawKey };
  }

  public revokeApiKey(input: {
    readonly apiKeyId: string; readonly workspaceId: string; readonly actorIdentityId: string;
  }): Promise<ApiKeyRecord> {
    return this.store.revokeApiKey({ ...input, now: this.runtime.now() });
  }

  public authenticateApiKey(rawKey: string): Promise<AuthenticatedApiKey | null> {
    const match = /^xecms_([A-Za-z0-9]{8,32})_([A-Za-z0-9_-]{32,128})$/.exec(rawKey);
    if (match === null) return Promise.resolve(null);
    return this.store.authenticateApiKey({
      prefix: match[1]!, digest: this.runtime.hashApiKey(rawKey), now: this.runtime.now(),
    });
  }
}

function identityNotFound(): never {
  throw new ApplicationError("IDENTITY_NOT_FOUND", 404, "The Identity does not exist.");
}

function apiKeyInvalid(field: string): never {
  throw new ApplicationError("API_KEY_INPUT_INVALID", 422, `API key ${field} is invalid.`);
}

function credentialTokenInvalid(): never {
  throw new ApplicationError("CREDENTIAL_TOKEN_INVALID", 400, "The credential token is invalid or inactive.");
}
