import { ApplicationError } from "../errors.js";
import type { AuthorizationAccessEvaluation } from "./access-evaluation.js";
import {
  realmCollectionResourceId,
  realmDocumentResourceId,
  realmCollectionResourcePrefix,
  realmDocumentResourcePrefix,
  projectionQuarantineKey,
  coreResourceId,
} from "./identifiers.js";
import type { AuthorizationPolicyContext } from "./policy-context.js";
import { createKernelSnapshot } from "./policy-kernel.js";
import { applyPolicyMutation } from "./policy-mutation.js";
import type {
  AuthorizationResourceRecord,
  AuthorizationPolicyState,
  AuthorizationPolicyMutation,
  AuthorizationActor,
  AuthorizationMutationResult,
  ContentResourceProjectionInput,
  ContentResourceProjectionReconcileResult,
} from "./types.js";
import {
  policyReferencesResource,
  validateIdentifier,
  validateDisplayName,
  requireRecord,
  findDuplicate,
  recordsEqual,
} from "./validation.js";

type AuthorizationResourceProjectionDependencies = Pick<AuthorizationPolicyContext,
  "audit" | "cachePersistedState" | "commit" | "load" | "loadForMutation" | "quarantinedResources" | "runtime" | "store"
>;

export class AuthorizationResourceProjection {
  public constructor(
    private readonly context: AuthorizationResourceProjectionDependencies,
    private readonly access: Pick<AuthorizationAccessEvaluation, "require">,
  ) {}

  public async syncCollectionResource(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly collectionId: string;
      readonly collectionName: string;
    },
  ): Promise<AuthorizationMutationResult<AuthorizationResourceRecord>> {
    validateIdentifier(input.collectionId, "collectionId");
    validateDisplayName(input.collectionName, "collectionName");
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const authorizationDecision = await this.access.require(actor, {
      action: "schema.apply",
      resourceId: coreResourceId(actor.realmId, "schema"),
    });
    const id = realmCollectionResourceId(actor.realmId, input.collectionId);
    const before = entry.state.resources.find((resource) => resource.id === id) ?? null;
    if (before !== null &&
      (before.type !== "collection" || before.parentId !== coreResourceId(actor.realmId, "content"))) {
      throw new ApplicationError(
        "AUTHORIZATION_RESOURCE_ID_CONFLICT",
        409,
        `Resource '${id}' is not the expected collection resource.`,
      );
    }
    const value: AuthorizationResourceRecord = {
      id,
      realmId: actor.realmId,
      name: input.collectionName,
      type: "collection",
      parentId: coreResourceId(actor.realmId, "content"),
    };
    if (before !== null && recordsEqual(before, value)) {
      return { revision: entry.state.revision, value: before };
    }
    const persisted = await this.context.commit(
      actor,
      entry,
      { type: "resource.upsert", value },
      "resource",
      id,
      before,
      value,
      authorizationDecision,
    );
    return { revision: persisted.revision, value: requireRecord(persisted.resources, id, "resource") };
  }

  public async syncCoreResources(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      readonly collections: readonly {
        readonly id: string;
        readonly name: string;
        readonly parentResourceId?: string;
      }[];
    },
  ): Promise<AuthorizationPolicyState> {
    let entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const authorizationDecision = await this.access.require(actor, {
      action: "schema.apply",
      resourceId: coreResourceId(actor.realmId, "schema"),
    });
    const coreResources: readonly AuthorizationResourceRecord[] = [
      {
        id: coreResourceId(actor.realmId, "schema"),
        realmId: actor.realmId,
        name: "Schema",
        type: "schema",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(actor.realmId, "content"),
        realmId: actor.realmId,
        name: "Content",
        type: "content-root",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(actor.realmId, "authorization"),
        realmId: actor.realmId,
        name: "Access control",
        type: "authorization",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
      {
        id: coreResourceId(actor.realmId, "audit"),
        realmId: actor.realmId,
        name: "Audit",
        type: "audit",
        parentId: entry.state.realm.rootResourceId,
        protected: true,
      },
    ];
    const collectionResources = input.collections.map(({ id, name, parentResourceId }) => {
      validateIdentifier(id, "collection.id");
      validateDisplayName(name, "collection.name");
      if (parentResourceId !== undefined &&
        !entry.state.resources.some(({ id: resourceId }) => resourceId === parentResourceId)) {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_PARENT_NOT_FOUND", 409,
          `Collection resource parent '${parentResourceId}' does not exist.`,
        );
      }
      return {
        id: realmCollectionResourceId(actor.realmId, id),
        realmId: actor.realmId,
        name,
        type: "collection",
        parentId: parentResourceId ?? coreResourceId(actor.realmId, "content"),
      } satisfies AuthorizationResourceRecord;
    });
    const duplicateIds = findDuplicate([...coreResources, ...collectionResources].map(({ id }) => id));
    if (duplicateIds !== undefined) {
      throw new ApplicationError(
        "DUPLICATE_AUTHORIZATION_RESOURCE",
        409,
        `Authorization resource '${duplicateIds}' is duplicated.`,
      );
    }
    const desiredCollectionIds = new Set(collectionResources.map(({ id }) => id));
    const collectionPrefix = realmCollectionResourcePrefix(actor.realmId);
    const staleCollections = entry.state.resources.filter((resource) =>
      (resource.type === "collection" || resource.type === "retired-collection") &&
      resource.id.startsWith(collectionPrefix) &&
      !desiredCollectionIds.has(resource.id));
    for (const resource of staleCollections) {
      const retired: AuthorizationResourceRecord = {
        ...resource,
        name: `Retired collection ${resource.id.slice(collectionPrefix.length)}`,
        type: "retired-collection",
        parentId: coreResourceId(actor.realmId, "content"),
      };
      if (recordsEqual(resource, retired)) continue;
      const persisted = await this.context.commit(
        actor,
        entry,
        { type: "resource.upsert", value: retired },
        "resource",
        retired.id,
        resource,
        retired,
        authorizationDecision,
      );
      entry = { state: persisted, snapshot: createKernelSnapshot(persisted) };
    }
    for (const value of [...coreResources, ...collectionResources]) {
      const before = entry.state.resources.find(({ id }) => id === value.id) ?? null;
      if (before?.type === "retired-collection" && policyReferencesResource(entry.state, before.id)) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Retired collection resource '${before.id}' still has policy references.`,
        );
      }
      if (before !== null && recordsEqual(before, value)) continue;
      const persisted = await this.context.commit(
        actor,
        entry,
        { type: "resource.upsert", value },
        "resource",
        value.id,
        before,
        value,
        authorizationDecision,
      );
      entry = { state: persisted, snapshot: createKernelSnapshot(persisted) };
    }
    return entry.state;
  }

  /**
   * Reconciles the materialized content hierarchy with the authorization graph.
   * The store commits every upsert/delete, dependent-policy cleanup, closure
   * rebuild, revision increment and audit row in one transaction.
   */
  public async reconcileContentHierarchyResources(
    actor: AuthorizationActor,
    input: {
      readonly expectedRevision: number;
      /** Collections owned by this projection, including disabled hierarchy collections. */
      readonly managedCollectionIds: readonly string[];
      readonly projections: readonly ContentResourceProjectionInput[];
      readonly reason: "startup" | "schema.apply" | "hierarchy.create" | "hierarchy.update" | "hierarchy.move" | "hierarchy.purge";
    },
  ): Promise<ContentResourceProjectionReconcileResult> {
    const entry = await this.context.loadForMutation(actor, input.expectedRevision);
    const managedCollectionResourceIds = new Set(input.managedCollectionIds.map((id) => {
      validateIdentifier(id, "managedCollectionId");
      return realmCollectionResourceId(actor.realmId, id);
    }));
    const duplicateDocument = findDuplicate(input.projections.map(({ documentId }) => documentId));
    if (duplicateDocument !== undefined) {
      throw new ApplicationError(
        "DUPLICATE_CONTENT_RESOURCE_PROJECTION",
        422,
        `Document resource '${duplicateDocument}' is duplicated in the hierarchy projection.`,
      );
    }
    const desired = input.projections.map((projection): AuthorizationResourceRecord => {
      validateIdentifier(projection.documentId, "projection.documentId");
      validateIdentifier(projection.collectionId, "projection.collectionId");
      if (!managedCollectionResourceIds.has(
        realmCollectionResourceId(actor.realmId, projection.collectionId),
      )) {
        throw new ApplicationError(
          "CONTENT_RESOURCE_COLLECTION_UNMANAGED",
          422,
          `Collection '${projection.collectionId}' is outside the managed projection boundary.`,
        );
      }
      if (projection.parentDocumentId !== null) {
        validateIdentifier(projection.parentDocumentId, "projection.parentDocumentId");
      }
      return {
        id: realmDocumentResourceId(actor.realmId, projection.documentId),
        realmId: actor.realmId,
        // Authorization metadata must never disclose draft content such as a
        // title or slug. The opaque immutable ID is the only document label.
        name: `Document ${projection.documentId}`,
        type: "document",
        parentId: projection.parentDocumentId === null
          ? realmCollectionResourceId(actor.realmId, projection.collectionId)
          : realmDocumentResourceId(actor.realmId, projection.parentDocumentId),
      };
    });
    const desiredIds = new Set(desired.map(({ id }) => id));
    const resourceById = new Map(entry.state.resources.map((resource) => [resource.id, resource]));
    const documentPrefix = realmDocumentResourcePrefix(actor.realmId);
    // Each realm owns only its document namespace. This also removes
    // projections whose collection disappeared from the schema, which can no
    // longer be discovered by walking active collection roots.
    const isManagedDocument = (resource: AuthorizationResourceRecord): boolean =>
      (resource.type === "document" || resource.type === "retired-document") &&
      resource.id.startsWith(documentPrefix);
    const stale = entry.state.resources
      .filter((resource) => isManagedDocument(resource) && !desiredIds.has(resource.id));
    const referencedResourceIds = new Set([
      ...entry.state.bindings.map(({ resourceId }) => resourceId),
      ...entry.state.roles.flatMap((role) => (role.fieldAccess ?? []).map(({ resourceId }) => resourceId)),
    ]);
    const retired = stale
      .filter(({ id }) => referencedResourceIds.has(id))
      .map((resource): AuthorizationResourceRecord => ({
        ...resource,
        name: `Retired document ${resource.id.slice(documentPrefix.length)}`,
        type: "retired-document",
        parentId: coreResourceId(actor.realmId, "content"),
      }));
    const retiredResourceIds = retired.map(({ id }) => id);
    const deleteIds = stale
      .filter(({ id }) => !referencedResourceIds.has(id))
      .map(({ id }) => id);
    const deleteSet = new Set(deleteIds);
    const upserts = [...desired, ...retired].filter((value) => {
      const before = resourceById.get(value.id);
      if (before !== undefined && before.type !== "document" && before.type !== "retired-document") {
        throw new ApplicationError(
          "AUTHORIZATION_RESOURCE_ID_CONFLICT",
          409,
          `Resource '${value.id}' is not a document projection.`,
        );
      }
      return before === undefined || !recordsEqual(before, value);
    });
    // Referenced resources are retired instead of deleting security policy as
    // a side effect of content lifecycle reconciliation.
    const removedBindingIds: string[] = [];
    const removedFieldAccess: { roleId: string; resourceId: string }[] = [];
    if (upserts.length === 0 && deleteIds.length === 0) {
      await this.releaseContentResourceQuarantine(actor, [...desiredIds, ...retiredResourceIds]);
      return {
        revision: entry.state.revision,
        changed: false,
        upsertedResourceIds: [],
        deletedResourceIds: [],
        retiredResourceIds,
        removedBindingIds: [],
        removedFieldAccess: [],
      };
    }
    const mutation: AuthorizationPolicyMutation = {
      type: "resource.reconcile",
      upserts,
      deleteIds,
    };
    const projected = applyPolicyMutation(entry.state, mutation);
    createKernelSnapshot(projected);
    const before = {
      resources: entry.state.resources.filter(({ id }) =>
        deleteSet.has(id) || upserts.some((value) => value.id === id)),
      bindings: entry.state.bindings.filter(({ id }) => removedBindingIds.includes(id)),
      fieldAccess: removedFieldAccess,
    };
    const after = {
      reason: input.reason,
      resources: upserts,
      deletedResourceIds: deleteIds,
      removedBindingIds,
      removedFieldAccess,
    };
    const persisted = await this.context.store.mutatePolicy({
      realmId: actor.realmId,
      expectedRevision: entry.state.revision,
      mutation,
      audit: this.context.audit(
        actor.subjectId,
        "resource.reconcile",
        "policy",
        "content-hierarchy-resources",
        before,
        after,
        null,
      ),
    });
    this.context.cachePersistedState(actor.realmId, persisted, entry.state.revision);
    await this.releaseContentResourceQuarantine(actor, [...desiredIds, ...retiredResourceIds]);
    return {
      revision: persisted.revision,
      changed: true,
      upsertedResourceIds: upserts.map(({ id }) => id),
      deletedResourceIds: deleteIds,
      retiredResourceIds,
      removedBindingIds,
      removedFieldAccess,
    };
  }

  /** Makes a stale content projection fail closed until a successful reconcile. */
  public async quarantineContentResources(
    actor: AuthorizationActor,
    resourceIds: readonly string[],
    reason = "hierarchy-projection-pending",
  ): Promise<void> {
    const unique = [...new Set(resourceIds)];
    await this.context.store.quarantineResources({
      realmId: actor.realmId,
      resourceIds: unique,
      reason,
      actorSubjectId: actor.subjectId,
      occurredAt: this.context.runtime.now(),
    });
    unique.forEach((resourceId) => this.context.quarantinedResources.add(
      projectionQuarantineKey(actor.realmId, resourceId),
    ));
  }

  public async releaseContentResourceQuarantine(
    actor: AuthorizationActor,
    resourceIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(resourceIds)];
    await this.context.store.releaseResourceQuarantine({ realmId: actor.realmId, resourceIds: unique });
    unique.forEach((resourceId) => this.context.quarantinedResources.delete(
      projectionQuarantineKey(actor.realmId, resourceId),
    ));
  }

  public async quarantineAllContentResources(actor: AuthorizationActor): Promise<readonly string[]> {
    const realmId = actor.realmId;
    const entry = await this.context.load(realmId);
    const resourceIds = entry.state.resources
      .filter(({ type }) => type === "document")
      .map(({ id }) => id);
    await this.quarantineContentResources(actor, resourceIds, "content-projection-reconcile");
    return resourceIds;
  }
}
