import {
  ApplicationError,
  type AuthorizationActor,
  type AuthorizationApplicationService,
  type AuthorizationAuditRecord,
  type AuthorizationBindingConstraintsRecord,
  type AuthorizationBindingRecord,
  type AuthorizationDecisionRecord,
  type AuthorizationFieldAccessRecord,
  type AuthorizationLevelRecord,
  type AuthorizationPolicyState,
  type AuthorizationRoleRecord,
  type AuthorizationPolicyManagementActor,
} from "@xecms/application";
import type {
  AuthorizationAuditEntryDto,
  AuthorizationAuditListDto,
  AuthorizationDecisionDto,
  AuthorizationPolicyDto,
  AuthorizationScopePropagationDto,
  AuthorizationSubjectTypeDto,
} from "@xecms/contracts";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

export interface RegisterAuthorizationRoutesOptions {
  readonly app: FastifyInstance;
  readonly authorization: AuthorizationApplicationService;
  readonly realmId?: string;
  readonly resolveRealmId?: (request: FastifyRequest) => string;
  /** Defaults to `/api/authorization`; may include Fastify path parameters. */
  readonly basePath?: string;
  /** Authenticates the CMS session and, for mutations, verifies the CSRF token. */
  readonly requireAuthorizationActor: (
    request: FastifyRequest,
    requireCsrf: boolean,
  ) => Promise<AuthorizationPolicyManagementActor>;
  /**
   * Optionally resolves a control-plane fallback after an ordinary Realm actor
   * has actually been denied by a policy mutation. Returning null preserves the
   * original error. Invariants such as protected targets must never be routed
   * through this hook.
   */
  readonly resolveAuthorizationMutationFallback?: (
    request: FastifyRequest,
    actor: AuthorizationPolicyManagementActor,
    error: unknown,
  ) => Promise<AuthorizationPolicyManagementActor | null>;
}

/** Registers the M3 authorization administration surface under `/api/authorization`. */
export function registerAuthorizationRoutes(
  options: RegisterAuthorizationRoutesOptions,
): void {
  const { app, authorization } = options;
  const basePath = (options.basePath ?? "/api/authorization").replace(/\/$/, "");
  const route = (suffix: string): string => `${basePath}${suffix}`;

  const actorFor = async (
    request: FastifyRequest,
    requireCsrf: boolean,
  ): Promise<AuthorizationPolicyManagementActor> => {
    const actor = await options.requireAuthorizationActor(request, requireCsrf);
    const configuredRealmId = options.resolveRealmId?.(request) ?? options.realmId;
    if (configuredRealmId === undefined) {
      throw new TypeError("Authorization routes require realmId or resolveRealmId.");
    }
    if (actor.realmId !== configuredRealmId) {
      throw new ApplicationError(
        "AUTHORIZATION_REALM_MISMATCH",
        403,
        "The authenticated actor does not belong to the configured authorization realm.",
      );
    }
    return actor;
  };

  const currentPolicy = async (
    actor: AuthorizationPolicyManagementActor,
  ): Promise<AuthorizationPolicyDto> =>
    toPolicyDto(await authorization.getPolicy(actor), actor);

  const executeMutation = async <T>(
    request: FastifyRequest,
    operation: (actor: AuthorizationPolicyManagementActor) => Promise<T>,
  ): Promise<T> => {
    const actor = await actorFor(request, true);
    try {
      return await operation(actor);
    } catch (error: unknown) {
      const fallback = await options.resolveAuthorizationMutationFallback?.(
        request,
        actor,
        error,
      );
      if (fallback === undefined || fallback === null) throw error;
      const configuredRealmId = options.resolveRealmId?.(request) ?? options.realmId;
      if (configuredRealmId === undefined) {
        throw new TypeError("Authorization routes require realmId or resolveRealmId.");
      }
      if (fallback.realmId !== configuredRealmId) {
        throw new ApplicationError(
          "AUTHORIZATION_REALM_MISMATCH",
          403,
          "The fallback actor does not belong to the configured authorization realm.",
        );
      }
      return operation(fallback);
    }
  };

  app.get(route("/policy"), async (request): Promise<AuthorizationPolicyDto> => {
    return currentPolicy(await actorFor(request, false));
  });

  app.post(route("/subjects"), async (
    request,
    reply,
  ): Promise<AuthorizationPolicyDto> => {
    const body = parseCreateSubject(request.body);
    const policy = await executeMutation(request, async (actor) => {
      await authorization.createSubject(actor, {
        expectedRevision: body.expectedRevision,
        subject: {
          realmId: actor.realmId,
          name: body.name,
          type: body.type,
        },
      });
      return currentPolicy(actor);
    });
    reply.code(201);
    return policy;
  });

  app.post(route("/group-memberships"), async (
    request,
    reply,
  ): Promise<AuthorizationPolicyDto> => {
    const body = parseCreateGroupMembership(request.body);
    const policy = await executeMutation(request, async (actor) => {
      await authorization.createGroupMembership(actor, {
        expectedRevision: body.expectedRevision,
        membership: {
          realmId: actor.realmId,
          memberSubjectId: body.memberSubjectId,
          groupSubjectId: body.groupSubjectId,
        },
      });
      return currentPolicy(actor);
    });
    reply.code(201);
    return policy;
  });

  app.delete(route("/group-memberships/:membershipId"), async (
    request,
  ): Promise<AuthorizationPolicyDto> => {
    const { membershipId } = parsePathParams(request.params, ["membershipId"]);
    const { expectedRevision } = parseDelete(request.body);
    return executeMutation(request, async (actor) => {
      await authorization.deleteGroupMembership(actor, { expectedRevision, membershipId });
      return currentPolicy(actor);
    });
  });

  // Compatibility route for the initial client contract, which identifies an edge by its pair.
  app.delete(route("/group-memberships/:memberSubjectId/:groupSubjectId"), async (
    request,
  ): Promise<AuthorizationPolicyDto> => {
    const { memberSubjectId, groupSubjectId } = parsePathParams(request.params, [
      "memberSubjectId",
      "groupSubjectId",
    ]);
    const { expectedRevision } = parseDelete(request.body);
    return executeMutation(request, async (actor) => {
      const policy = await authorization.getPolicy(actor);
      const membership = policy.groupMemberships.find((candidate) =>
        candidate.memberSubjectId === memberSubjectId &&
        candidate.groupSubjectId === groupSubjectId);
      if (membership === undefined) {
        throw new ApplicationError(
          "GROUP_MEMBERSHIP_NOT_FOUND",
          404,
          `The group membership '${memberSubjectId}' -> '${groupSubjectId}' does not exist.`,
        );
      }
      await authorization.deleteGroupMembership(actor, {
        expectedRevision,
        membershipId: membership.id,
      });
      return currentPolicy(actor);
    });
  });

  app.post(route("/levels"), async (
    request,
    reply,
  ): Promise<AuthorizationPolicyDto> => {
    const body = parseLevel(request.body);
    const policy = await executeMutation(request, async (actor) => {
      await authorization.createLevel(actor, {
        expectedRevision: body.expectedRevision,
        level: {
          realmId: actor.realmId,
          name: body.name,
          rank: body.rank,
        },
      });
      return currentPolicy(actor);
    });
    reply.code(201);
    return policy;
  });

  const updateLevel = async (
    request: FastifyRequest,
  ): Promise<AuthorizationPolicyDto> => {
    const { levelId } = parsePathParams(request.params, ["levelId"]);
    const body = parseLevel(request.body);
    return executeMutation(request, async (actor) => {
      const level: AuthorizationLevelRecord = {
        id: levelId,
        realmId: actor.realmId,
        name: body.name,
        rank: body.rank,
      };
      await authorization.updateLevel(actor, {
        expectedRevision: body.expectedRevision,
        levelId,
        level,
      });
      return currentPolicy(actor);
    });
  };
  app.put(route("/levels/:levelId"), updateLevel);
  app.patch(route("/levels/:levelId"), updateLevel);

  app.delete(route("/levels/:levelId"), async (
    request,
  ): Promise<AuthorizationPolicyDto> => {
    const { levelId } = parsePathParams(request.params, ["levelId"]);
    const { expectedRevision } = parseDelete(request.body);
    return executeMutation(request, async (actor) => {
      await authorization.deleteLevel(actor, { expectedRevision, levelId });
      return currentPolicy(actor);
    });
  });

  app.post(route("/roles"), async (
    request,
    reply,
  ): Promise<AuthorizationPolicyDto> => {
    const body = parseRole(request.body);
    const policy = await executeMutation(request, async (actor) => {
      await authorization.createRole(actor, {
        expectedRevision: body.expectedRevision,
        role: roleRecord(actor.realmId, undefined, body),
      });
      return currentPolicy(actor);
    });
    reply.code(201);
    return policy;
  });

  const updateRole = async (
    request: FastifyRequest,
  ): Promise<AuthorizationPolicyDto> => {
    const { roleId } = parsePathParams(request.params, ["roleId"]);
    const body = parseRole(request.body);
    return executeMutation(request, async (actor) => {
      await authorization.updateRole(actor, {
        expectedRevision: body.expectedRevision,
        roleId,
        role: roleRecord(actor.realmId, roleId, body) as AuthorizationRoleRecord,
      });
      return currentPolicy(actor);
    });
  };
  app.put(route("/roles/:roleId"), updateRole);
  app.patch(route("/roles/:roleId"), updateRole);

  app.delete(route("/roles/:roleId"), async (
    request,
  ): Promise<AuthorizationPolicyDto> => {
    const { roleId } = parsePathParams(request.params, ["roleId"]);
    const { expectedRevision } = parseDelete(request.body);
    return executeMutation(request, async (actor) => {
      await authorization.deleteRole(actor, { expectedRevision, roleId });
      return currentPolicy(actor);
    });
  });

  app.post(route("/bindings"), async (
    request,
    reply,
  ): Promise<AuthorizationPolicyDto> => {
    const body = parseBinding(request.body);
    const policy = await executeMutation(request, async (actor) => {
      await authorization.createBinding(actor, {
        expectedRevision: body.expectedRevision,
        binding: bindingRecord(actor.realmId, undefined, body),
      });
      return currentPolicy(actor);
    });
    reply.code(201);
    return policy;
  });

  const updateBinding = async (
    request: FastifyRequest,
  ): Promise<AuthorizationPolicyDto> => {
    const { bindingId } = parsePathParams(request.params, ["bindingId"]);
    const body = parseBinding(request.body);
    return executeMutation(request, async (actor) => {
      await authorization.updateBinding(actor, {
        expectedRevision: body.expectedRevision,
        bindingId,
        binding: bindingRecord(actor.realmId, bindingId, body) as AuthorizationBindingRecord,
      });
      return currentPolicy(actor);
    });
  };
  app.put(route("/bindings/:bindingId"), updateBinding);
  app.patch(route("/bindings/:bindingId"), updateBinding);

  app.delete(route("/bindings/:bindingId"), async (
    request,
  ): Promise<AuthorizationPolicyDto> => {
    const { bindingId } = parsePathParams(request.params, ["bindingId"]);
    const { expectedRevision } = parseDelete(request.body);
    return executeMutation(request, async (actor) => {
      await authorization.deleteBinding(actor, { expectedRevision, bindingId });
      return currentPolicy(actor);
    });
  });

  app.post(route("/simulate"), async (
    request,
  ): Promise<AuthorizationDecisionDto> => {
    const requester = await actorFor(request, true);
    const input = parseSimulation(request.body);
    const decision = await authorization.simulate(requester, input);
    const policy = await authorization.getPolicy(requester);
    return toDecisionDto(decision, input.resourceId, policy.revision);
  });

  app.get(route("/audit"), async (
    request,
  ): Promise<AuthorizationAuditListDto> => {
    const actor = await actorFor(request, false);
    const query = parseAuditQuery(request.query);
    const page = await authorization.listAudit(actor, query);
    return {
      items: page.items.map(toAuditEntryDto),
    };
  });
}

interface ParsedRevision {
  readonly expectedRevision: number;
}

interface ParsedRole extends ParsedRevision {
  readonly name: string;
  readonly description?: string;
  readonly levelId: string;
  readonly permissions: readonly string[];
  readonly delegatablePermissions: readonly string[];
  readonly fieldAccess: readonly AuthorizationFieldAccessRecord[];
}

interface ParsedBinding extends ParsedRevision {
  readonly subjectId: string;
  readonly roleId: string;
  readonly resourceId: string;
  readonly propagation: AuthorizationScopePropagationDto;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly constraints?: AuthorizationBindingConstraintsRecord;
}

interface ParsedSimulation {
  readonly subjectId: string;
  readonly action: string;
  readonly resourceId: string;
  readonly at?: string;
  readonly context?: {
    readonly ownerSubjectId?: string;
    readonly status?: string;
  };
}

function parseCreateSubject(value: unknown): ParsedRevision & {
  readonly type: AuthorizationSubjectTypeDto;
  readonly name: string;
} {
  const body = exactObject(value, ["expectedPolicyRevision", "type", "name"], "subject request");
  const type = requiredString(body, "type");
  if (type !== "user" && type !== "group" && type !== "service-account") {
    invalid("type must be 'user', 'group', or 'service-account'.");
  }
  return {
    expectedRevision: expectedRevision(body),
    type,
    name: requiredString(body, "name"),
  };
}

function parseCreateGroupMembership(value: unknown): ParsedRevision & {
  readonly memberSubjectId: string;
  readonly groupSubjectId: string;
} {
  const body = exactObject(value, [
    "expectedPolicyRevision",
    "memberSubjectId",
    "groupSubjectId",
  ], "group membership request");
  return {
    expectedRevision: expectedRevision(body),
    memberSubjectId: requiredString(body, "memberSubjectId"),
    groupSubjectId: requiredString(body, "groupSubjectId"),
  };
}

function parseLevel(value: unknown): ParsedRevision & {
  readonly name: string;
  readonly rank: number;
} {
  const body = exactObject(value, ["expectedPolicyRevision", "name", "rank"], "authority level request");
  const rank = body["rank"];
  if (!Number.isSafeInteger(rank) || (rank as number) < 0) {
    invalid("rank must be a non-negative safe integer.");
  }
  return {
    expectedRevision: expectedRevision(body),
    name: requiredString(body, "name"),
    rank: rank as number,
  };
}

function parseRole(value: unknown): ParsedRole {
  const body = exactObject(value, [
    "expectedPolicyRevision",
    "name",
    "description",
    "levelId",
    "permissions",
    "delegatablePermissions",
    "fieldAccess",
  ], "role request");
  const description = optionalString(body, "description");
  const fieldAccessValue = body["fieldAccess"];
  const fieldAccess = fieldAccessValue === undefined
    ? []
    : arrayValue(fieldAccessValue, "fieldAccess").map((item, index) =>
      parseFieldAccess(item, `fieldAccess[${index}]`));
  return {
    expectedRevision: expectedRevision(body),
    name: requiredString(body, "name"),
    ...(description === undefined ? {} : { description }),
    levelId: requiredString(body, "levelId"),
    permissions: stringArray(body["permissions"], "permissions"),
    delegatablePermissions: stringArray(body["delegatablePermissions"], "delegatablePermissions"),
    fieldAccess,
  };
}

function parseFieldAccess(value: unknown, label: string): AuthorizationFieldAccessRecord {
  const rule = exactObject(value, ["resourceId", "readableFields", "writableFields"], label);
  return {
    resourceId: requiredString(rule, "resourceId"),
    readableFields: stringArray(rule["readableFields"], `${label}.readableFields`),
    writableFields: stringArray(rule["writableFields"], `${label}.writableFields`),
  };
}

function parseBinding(value: unknown): ParsedBinding {
  const body = exactObject(value, [
    "expectedPolicyRevision",
    "subjectId",
    "roleId",
    "resourceId",
    "propagation",
    "validFrom",
    "validUntil",
    "constraints",
  ], "binding request");
  const propagation = requiredString(body, "propagation");
  if (propagation !== "self" && propagation !== "children" && propagation !== "self-and-children") {
    invalid("propagation must be 'self', 'children', or 'self-and-children'.");
  }
  const validFrom = optionalString(body, "validFrom");
  const validUntil = optionalString(body, "validUntil");
  const constraints = parseConstraints(body["constraints"]);
  return {
    expectedRevision: expectedRevision(body),
    subjectId: requiredString(body, "subjectId"),
    roleId: requiredString(body, "roleId"),
    resourceId: requiredString(body, "resourceId"),
    propagation,
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(constraints === undefined ? {} : { constraints }),
  };
}

function parseConstraints(value: unknown): AuthorizationBindingConstraintsRecord | undefined {
  if (value === undefined) return undefined;
  const constraints = exactObject(value, ["ownerSubjectId", "statuses"], "binding constraints");
  const ownerSubjectId = optionalString(constraints, "ownerSubjectId");
  const statuses = constraints["statuses"] === undefined
    ? undefined
    : stringArray(constraints["statuses"], "constraints.statuses");
  return {
    ...(ownerSubjectId === undefined ? {} : { ownerSubjectId }),
    ...(statuses === undefined ? {} : { statuses }),
  };
}

function parseDelete(value: unknown): ParsedRevision {
  const body = exactObject(value, ["expectedPolicyRevision"], "delete request");
  return { expectedRevision: expectedRevision(body) };
}

function parseSimulation(value: unknown): ParsedSimulation {
  const body = exactObject(value, ["subjectId", "action", "resourceId", "at", "context"], "simulation request");
  const at = optionalString(body, "at");
  let context: ParsedSimulation["context"];
  if (body["context"] !== undefined) {
    const rawContext = exactObject(body["context"], ["ownerSubjectId", "status"], "simulation context");
    const ownerSubjectId = optionalString(rawContext, "ownerSubjectId");
    const status = optionalString(rawContext, "status");
    context = {
      ...(ownerSubjectId === undefined ? {} : { ownerSubjectId }),
      ...(status === undefined ? {} : { status }),
    };
  }
  return {
    subjectId: requiredString(body, "subjectId"),
    action: requiredString(body, "action"),
    resourceId: requiredString(body, "resourceId"),
    ...(at === undefined ? {} : { at }),
    ...(context === undefined ? {} : { context }),
  };
}

function parseAuditQuery(value: unknown): { readonly cursor?: string; readonly limit?: number } {
  const query = exactObject(value ?? {}, ["cursor", "limit"], "audit query");
  const cursor = optionalString(query, "cursor");
  const rawLimit = query["limit"];
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== "string" || !/^[1-9]\d{0,2}$/.test(rawLimit)) {
      invalid("limit must be an integer from 1 to 200.");
    }
    limit = Number(rawLimit);
    if (limit > 200) invalid("limit must be an integer from 1 to 200.");
  }
  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function roleRecord(
  realmId: string,
  id: string | undefined,
  body: ParsedRole,
): Omit<AuthorizationRoleRecord, "id"> & { readonly id?: string } {
  return {
    ...(id === undefined ? {} : { id }),
    realmId,
    levelId: body.levelId,
    name: body.name,
    ...(body.description === undefined ? {} : { description: body.description }),
    permissions: body.permissions,
    delegatablePermissions: body.delegatablePermissions,
    fieldAccess: body.fieldAccess,
  };
}

function bindingRecord(
  realmId: string,
  id: string | undefined,
  body: ParsedBinding,
): Omit<AuthorizationBindingRecord, "id"> & { readonly id?: string } {
  return {
    ...(id === undefined ? {} : { id }),
    realmId,
    subjectId: body.subjectId,
    roleId: body.roleId,
    resourceId: body.resourceId,
    propagation: body.propagation,
    ...(body.validFrom === undefined ? {} : { validFrom: body.validFrom }),
    ...(body.validUntil === undefined ? {} : { validUntil: body.validUntil }),
    ...(body.constraints === undefined ? {} : { constraints: body.constraints }),
  };
}

function toPolicyDto(
  state: AuthorizationPolicyState,
  actor?: AuthorizationPolicyManagementActor,
): AuthorizationPolicyDto {
  const systemRootPrefix = `authorization:${state.realm.id}`;
  const hiddenSubjectId = `${systemRootPrefix}:subject:provisioner`;
  const hiddenLevelId = `${systemRootPrefix}:level:system-policy-root`;
  const hiddenRoleId = `${systemRootPrefix}:role:system-policy-root`;
  const hiddenBindingId = `${systemRootPrefix}:binding:system-policy-root`;
  const administration = actor !== undefined && "accessMode" in actor
    ? {
        accessMode: actor.accessMode,
        systemIdentityId: actor.systemIdentityId,
        ...(actor.accessMode === "realm-actor" ? { realmSubjectId: actor.subjectId } : {}),
        ...(actor.accessMode === "realm-full-access"
          ? {
              fullAccessBindingId: actor.fullAccessBindingId,
              ...("fullAccessValidUntil" in actor
                && typeof actor.fullAccessValidUntil === "string"
                ? { fullAccessValidUntil: actor.fullAccessValidUntil }
                : {}),
            }
          : {}),
      }
    : undefined;
  return {
    realmId: state.realm.id,
    revision: state.revision,
    ...(administration === undefined ? {} : { administration }),
    subjects: state.subjects.filter(({ id }) => id !== hiddenSubjectId).map((subject) => ({
      id: subject.id,
      realmId: subject.realmId,
      type: subject.type,
      name: subject.name,
      protected: subject.protected ?? false,
      disabled: subject.disabled ?? false,
    })),
    groupMemberships: state.groupMemberships.filter((membership) =>
      membership.memberSubjectId !== hiddenSubjectId
      && membership.groupSubjectId !== hiddenSubjectId).map((membership) => ({
      memberSubjectId: membership.memberSubjectId,
      groupSubjectId: membership.groupSubjectId,
    })),
    resources: state.resources.map((resource) => ({
      id: resource.id,
      realmId: resource.realmId,
      type: resource.type,
      name: resource.name,
      ...(resource.parentId === undefined ? {} : { parentId: resource.parentId }),
      protected: resource.protected ?? false,
    })),
    levels: state.authorityLevels.filter(({ id }) => id !== hiddenLevelId).map((level) => ({
      id: level.id,
      realmId: level.realmId,
      name: level.name,
      rank: level.rank,
      protected: level.protected ?? false,
    })),
    permissions: state.permissions.map((permission) => ({
      key: permission.key,
      label: permissionLabel(permission.key),
      category: permission.key.split(".", 1)[0] ?? "other",
      hierarchyGuard: permission.hierarchyGuard,
      delegatable: permission.delegatable,
      protected: permission.protected ?? false,
    })),
    roles: state.roles.filter(({ id }) => id !== hiddenRoleId).map((role) => ({
      id: role.id,
      realmId: role.realmId,
      levelId: role.levelId,
      name: role.name,
      ...(role.description === undefined ? {} : { description: role.description }),
      permissions: role.permissions,
      delegatablePermissions: role.delegatablePermissions,
      fieldAccess: role.fieldAccess ?? [],
      protected: role.protected ?? false,
    })),
    bindings: state.bindings.filter((binding) =>
      binding.id !== hiddenBindingId
      && binding.subjectId !== hiddenSubjectId
      && binding.roleId !== hiddenRoleId).map((binding) => ({
      id: binding.id,
      realmId: binding.realmId,
      subjectId: binding.subjectId,
      roleId: binding.roleId,
      resourceId: binding.resourceId,
      propagation: binding.propagation,
      ...(binding.validFrom === undefined ? {} : { validFrom: binding.validFrom }),
      ...(binding.validUntil === undefined ? {} : { validUntil: binding.validUntil }),
      ...(binding.constraints === undefined ? {} : { constraints: binding.constraints }),
      protected: binding.protected ?? false,
    })),
  };
}

function toDecisionDto(
  decision: AuthorizationDecisionRecord,
  requestedResourceId: string,
  policyRevision: number,
): AuthorizationDecisionDto {
  return {
    allowed: decision.allowed,
    action: decision.action,
    reasonCode: decision.reasonCode,
    resourceId: decision.evaluatedScope?.resourceId ?? requestedResourceId,
    ...(decision.actorLevel === undefined ? {} : { actorLevel: decision.actorLevel }),
    ...(decision.targetLevel === undefined ? {} : { targetLevel: decision.targetLevel }),
    policyRevision,
    matchedGrants: decision.matchedGrants.map((grant) => ({
      permission: grant.permission,
      sourceRoleId: grant.sourceRoleId,
      sourceLevelId: grant.sourceLevelId,
      sourceRank: grant.sourceRank,
      sourceBindingId: grant.sourceBindingId,
      sourceResourceId: grant.sourceScope.resourceId,
      sourcePropagation: grant.sourceScope.propagation,
      membershipPath: grant.membershipPath,
    })),
  };
}

function toAuditEntryDto(entry: AuthorizationAuditRecord): AuthorizationAuditEntryDto {
  return {
    id: entry.id,
    realmId: entry.realmId,
    policyRevision: entry.revision,
    ...(entry.actorSubjectId === undefined ? {} : { actorSubjectId: entry.actorSubjectId }),
    ...(entry.actorIdentityId === undefined ? {} : { actorIdentityId: entry.actorIdentityId }),
    ...(entry.accessMode === undefined ? {} : { accessMode: entry.accessMode }),
    ...(entry.fullAccessBindingId === undefined
      ? {}
      : { fullAccessBindingId: entry.fullAccessBindingId }),
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    decision: entry.decision === null
      ? null
      : toDecisionDto(entry.decision, auditResourceId(entry), entry.revision),
    occurredAt: entry.occurredAt,
  };
}

function auditResourceId(entry: AuthorizationAuditRecord): string {
  if (entry.decision?.evaluatedScope !== undefined) {
    return entry.decision.evaluatedScope.resourceId;
  }
  return entry.targetId;
}

function permissionLabel(key: string): string {
  return key
    .split(".")
    .map((part) => part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(" · ");
}

function parsePathParams<TName extends string>(
  value: unknown,
  names: readonly TName[],
): Readonly<Record<TName, string>> {
  // Realm-prefixed registrations add the trusted Fastify `realmId` base-path
  // parameter. It is validated by resolveRealmId/actorFor and is not part of
  // the object-specific path contract handled here.
  const params = exactObject(value, [...names, "realmId"], "route parameters");
  const output = {} as Record<TName, string>;
  for (const name of names) output[name] = requiredString(params, name);
  return output;
}

function exactObject<TName extends string>(
  value: unknown,
  allowedKeys: readonly TName[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be a JSON object.`);
  }
  const object = value as Readonly<Record<string, unknown>>;
  const unexpected = Object.keys(object).find((key) => !allowedKeys.includes(key as TName));
  if (unexpected !== undefined) invalid(`${label} contains an unexpected '${unexpected}' property.`);
  return object;
}

function expectedRevision(body: Readonly<Record<string, unknown>>): number {
  const value = body["expectedPolicyRevision"];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid("expectedPolicyRevision must be a positive safe integer.");
  }
  return value as number;
}

function requiredString(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(
  body: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${key} must be a non-empty string when provided.`);
  }
  return value;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  const values = arrayValue(value, label);
  const output = values.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      invalid(`${label}[${index}] must be a non-empty string.`);
    }
    return item as string;
  });
  if (new Set(output).size !== output.length) invalid(`${label} must not contain duplicates.`);
  return output;
}

function invalid(detail: string): never {
  throw new ApplicationError("AUTHORIZATION_REQUEST_INVALID", 400, detail);
}
