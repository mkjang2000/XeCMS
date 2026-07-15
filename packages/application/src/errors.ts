export interface ApplicationIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export class ApplicationError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly options: {
      readonly issues?: readonly ApplicationIssue[];
      readonly details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export async function assertCapability(
  actor: ActorContext,
  capability: AdminCapability,
  authorization?: {
    readonly action?: string;
    readonly resourceId: string;
    readonly context?: AuthorizationObjectContext;
  },
): Promise<void> {
  if (actor.authorization !== undefined) {
    if (authorization === undefined) {
      throw new TypeError(`Authorization resource is required for '${capability}'.`);
    }
    await actor.authorization.require({
      action: authorization.action ?? canonicalPermission(capability),
      resourceId: authorization.resourceId,
      ...(authorization.context === undefined ? {} : { context: authorization.context }),
    });
    return;
  }
  if (!actor.capabilities.includes(capability)) {
    throw new ApplicationError(
      "ACCESS_DENIED",
      403,
      `The '${capability}' capability is required for this operation.`,
    );
  }
}

export interface AuthorizationObjectContext {
  readonly ownerSubjectId?: string;
  readonly status?: string;
}

/** M3 fixtures and existing server actors implicitly execute in this realm. */
export const SYSTEM_ACTOR_REALM_ID = "rlm_system";

/**
 * Durable content currently stores its creator Subject but not the Subject's
 * origin Realm. Callers that know the origin (for example, an immediate create
 * response) should provide it. Unknown non-system origins intentionally omit
 * ownerSubjectId so owner-constrained bindings fail closed until Identity /
 * Membership origin mapping is available.
 */
export interface AuthorizationOwnerOrigin {
  readonly subjectId: string;
  readonly realmId?: string;
}

export interface ActorAuthorizationGateway {
  require(input: {
    readonly action: string;
    readonly resourceId: string;
    readonly context?: AuthorizationObjectContext;
  }): Promise<void>;
  filterReadableData<TData extends Readonly<Record<string, unknown>>>(input: {
    readonly resourceId: string;
    readonly data: TData;
    readonly action?: string;
    readonly context?: AuthorizationObjectContext;
  }): Promise<Partial<TData>>;
  assertWritableData(input: {
    readonly resourceId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly action?: string;
    readonly context?: AuthorizationObjectContext;
  }): Promise<void>;
}

export type AdminCapability =
  | "schema:read"
  | "schema:write"
  | "schema:apply"
  | "document:read"
  | "document:create"
  | "document:update"
  | "document:delete"
  | "document:publish"
  | "document:purge";

export interface ActorContext {
  readonly subjectId: string;
  /** Global credential owner. It differs from subjectId in Content Realms. */
  readonly identityId?: string;
  readonly workspaceId: string;
  /** Omitted by legacy M1-M3 fixtures and interpreted as the System Realm. */
  readonly realmId?: string;
  readonly capabilities: readonly AdminCapability[];
  /** Trusted internal workflow marker. HTTP callers must never choose it directly. */
  readonly execution?: "identity-provisioning";
  /** Present in production; tests may use legacy capabilities as a narrow fixture fallback. */
  readonly authorization?: ActorAuthorizationGateway;
}

export function actorRealmId(actor: ActorContext): string {
  return actor.realmId ?? SYSTEM_ACTOR_REALM_ID;
}

export function authorizationContextForOwner(
  actor: ActorContext,
  owner: AuthorizationOwnerOrigin,
  status: string,
): AuthorizationObjectContext {
  const realmId = actorRealmId(actor);
  const knownOwnerRealmId = owner.realmId ?? (
    // Every persisted M1-M3 document was created in the System Realm. For a
    // non-system actor, equality with the current Subject is the only origin
    // fact available without a Membership lookup.
    realmId === SYSTEM_ACTOR_REALM_ID || owner.subjectId === actor.subjectId
      ? realmId
      : undefined
  );
  return {
    ...(knownOwnerRealmId === realmId ? { ownerSubjectId: owner.subjectId } : {}),
    status,
  };
}

function canonicalPermission(capability: AdminCapability): string {
  switch (capability) {
    case "schema:read": return "schema.read";
    case "schema:write": return "schema.update";
    case "schema:apply": return "schema.apply";
    case "document:read": return "content.read";
    case "document:create": return "content.create";
    case "document:update": return "content.update";
    case "document:delete": return "content.delete";
    case "document:publish": return "content.publish";
    case "document:purge": return "content.delete";
  }
}
