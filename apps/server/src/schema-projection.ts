import {
  ApplicationError,
  AuthorizationApplicationService,
  ContentRealmAuthorizationProvisioner,
  SiteService,
  SchemaApplicationService,
  collectionResourceId,
  type AuthorizationActor,
  type ActorContext,
} from "@xecms/application";
import {
  DEFAULT_WORKSPACE_ID,
  PostgresDatabase,
  PostgresRealmCollectionEntitlementStore,
  PostgresContentHierarchyStore,
  PostgresIdentityRealmStore,
} from "@xecms/database";
import { type CollectionDefinition } from "@xecms/schema";
import { authorizationActor } from "./request-authentication.js";

interface Options {
  readonly database: PostgresDatabase;
  readonly authorization: AuthorizationApplicationService;
  readonly hierarchyStore: PostgresContentHierarchyStore;
  readonly identityRealmStore: PostgresIdentityRealmStore;
  readonly realmAuthorization: ContentRealmAuthorizationProvisioner;
  readonly entitlementStore: PostgresRealmCollectionEntitlementStore;
  readonly sites: SiteService;
  readonly schema: SchemaApplicationService;
}

export function createSchemaProjectionCoordinator(options: Options) {
  const {
    database,
    authorization,
    hierarchyStore,
    identityRealmStore,
    realmAuthorization,
    entitlementStore,
    sites,
    schema,
  } = options;

  const syncAuthorizationResources = async (
    actor: AuthorizationActor,
    collections: readonly CollectionDefinition[],
  ): Promise<void> => {
    const siteByCollection = new Map(
      (await sites.list(DEFAULT_WORKSPACE_ID)).flatMap((site) =>
        site.collectionIds.map((collectionId) => [collectionId, site.id] as const)),
    );
    const policy = await authorization.getPolicy(actor);
    await authorization.syncCoreResources(actor, {
      expectedRevision: policy.revision,
      collections: collections.map(({ id, name }) => {
        const collectionId = String(id);
        const siteId = siteByCollection.get(collectionId);
        return { id: collectionId, name,
          ...(siteId === undefined ? {} : { parentResourceId: `resource:site:${siteId}` }) };
      }),
    });
  };
  const reconcileAuthorizationHierarchy = async (
    actor: AuthorizationActor,
    collections: readonly CollectionDefinition[],
    reason: "startup" | "schema.apply" | "hierarchy.create" | "hierarchy.move" | "hierarchy.purge",
    expectedPolicyRevision?: number,
  ) => {
    const projections = [];
    for (const collection of collections) {
      if (collection.hierarchy?.enabled !== true || collection.hierarchy.permissionInheritance !== true) continue;
      const tree = await hierarchyStore.listAllByIds(DEFAULT_WORKSPACE_ID, String(collection.id));
      for (const position of tree.items) {
        const documentId = String(position.documentId);
        projections.push({
          documentId,
          collectionId: String(collection.id),
          parentDocumentId: position.parentId === null ? null : String(position.parentId),
        });
      }
    }
    const expectedRevision = expectedPolicyRevision ?? await authorization.currentPolicyRevision(actor.realmId);
    return authorization.reconcileContentHierarchyResources(actor, {
      expectedRevision,
      managedCollectionIds: collections.map(({ id }) => String(id)),
      projections,
      reason,
    });
  };
  const assertSafeAuthorizationHierarchyTransition = async (policyActor: AuthorizationActor): Promise<void> => {
    const [active, draft] = await Promise.all([
      database.getActiveSchema(),
      database.getSchemaDraft(),
    ]);
    if (draft === null) return;
    const policy = await authorization.getPolicy(policyActor);
    const policyReferences = (resourceId: string): boolean =>
      policy.bindings.some((binding) => binding.resourceId === resourceId) ||
      policy.roles.some((role) => (role.fieldAccess ?? []).some((rule) => rule.resourceId === resourceId));
    const permissionInheritanceEnabled = (collection: CollectionDefinition | undefined): boolean =>
      collection?.hierarchy?.enabled === true && collection.hierarchy.permissionInheritance === true;

    // A previously retired ID must not reactivate old grants merely by being
    // reintroduced in a draft. This guard deliberately runs before schema.apply.
    for (const candidate of draft.schema.collections) {
      const resourceId = collectionResourceId(String(candidate.id));
      const resource = policy.resources.find(({ id }) => id === resourceId);
      if (resource?.type === "retired-collection" && policyReferences(resourceId)) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Retired collection '${candidate.name}' has policy references that must be migrated before reuse.`,
          { details: { collectionId: String(candidate.id) } },
        );
      }
      const previous = active?.schema.collections.find(({ id }) => String(id) === String(candidate.id));
      if (
        previous === undefined &&
        permissionInheritanceEnabled(candidate) &&
        await database.countDocumentsByCollectionId(String(candidate.id)) > 0
      ) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Collection '${candidate.name}' has existing documents that require an authorization migration before permission inheritance can be enabled.`,
          { details: { collectionId: String(candidate.id) } },
        );
      }
    }

    for (const previous of active?.schema.collections ?? []) {
      const next = draft.schema.collections.find(({ id }) => String(id) === String(previous.id));
      if (next === undefined) {
        const resourceId = collectionResourceId(String(previous.id));
        if (policyReferences(resourceId)) {
          throw new ApplicationError(
            "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
            409,
            `Collection '${previous.name}' has authorization policy references that must be migrated before removal.`,
            { details: { collectionId: String(previous.id) } },
          );
        }
      }
      if (permissionInheritanceEnabled(previous) === permissionInheritanceEnabled(next)) continue;
      const documentCount = await database.countDocumentsByCollectionId(String(previous.id));
      if (documentCount > 0) {
        throw new ApplicationError(
          "HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED",
          409,
          `Collection '${previous.name}' has documents whose authorization inheritance mode requires migration.`,
          { details: { collectionId: String(previous.id), documentCount } },
        );
      }
    }
  };
  const prepareContentRealmsForSchemaApply = async (
    collections: readonly CollectionDefinition[],
  ): Promise<void> => {
    const projectedCollections = collections.map(({ id, name }) => ({ id: String(id), name }));
    for (const collection of collections) {
      if (collection.auth === undefined) continue;
      const realm = await identityRealmStore.getRealmByKey(
        DEFAULT_WORKSPACE_ID,
        collection.auth.realmKey,
      );
      if (realm === null || realm.kind !== "content" || realm.status === "disabled") {
        throw new ApplicationError(
          "IDENTITY_REALM_NOT_FOUND",
          409,
          `Create and enable Content Realm '${collection.auth.realmKey}' before applying this Auth Collection.`,
        );
      }
      await realmAuthorization.ensureRealmPolicy(realm);
      // A newly created Realm cannot serve traffic yet, so projecting the
      // draft first closes the schema-activation/resource-projection window.
      if (realm.status === "provisioning") {
        await realmAuthorization.syncCollectionResources({ realm, collections: projectedCollections });
        await entitlementStore.reconcileRealmFromPolicy(realm.id, realm.workspaceId);
      }
    }
  };
  const syncConfiguredContentRealmResources = async (
    collections: readonly CollectionDefinition[],
    newlyAddedCollectionIds: readonly string[] = [],
  ): Promise<void> => {
    const projectedCollections = collections.map(({ id, name }) => ({ id: String(id), name }));
    for (const realmKey of new Set(
      collections.flatMap(({ auth: definition }) => definition === undefined ? [] : [definition.realmKey]),
    )) {
      const realm = await identityRealmStore.getRealmByKey(DEFAULT_WORKSPACE_ID, realmKey);
      if (realm === null || realm.kind !== "content" || realm.status !== "active") {
        throw new ApplicationError(
          "IDENTITY_REALM_CONFIGURATION_INCOMPLETE",
          503,
          `Content Realm '${realmKey}' did not activate with its Auth Collection.`,
        );
      }
      await realmAuthorization.syncCollectionResources({ realm, collections: projectedCollections });
      // Newly projected collections must gain access-preserving ceilings so the
      // realm's existing owner/admin bindings keep reaching them under enforcement.
      await entitlementStore.reconcileRealmFromPolicy(
        realm.id,
        realm.workspaceId,
        newlyAddedCollectionIds,
      );
    }
  };
  const applySchemaWithProjection = async (
    actor: ActorContext,
    input: {
      readonly expectedRevisionId: string | null;
      readonly expectedDraftVersion: string;
      readonly planId: string;
      readonly approveDestructive: boolean;
    },
  ) => database.withContentProjectionLock(async () => {
    const policyActor = authorizationActor(actor.subjectId);
    await assertSafeAuthorizationHierarchyTransition(policyActor);
    const pendingDraft = await database.getSchemaDraft();
    if (pendingDraft === null) {
      throw new ApplicationError("SCHEMA_DRAFT_NOT_FOUND", 404, "No schema draft exists.");
    }
    const previousCollectionIds = new Set(
      ((await database.getActiveSchema())?.schema.collections ?? []).map(({ id }) => String(id)),
    );
    const newlyAddedCollectionIds = pendingDraft.schema.collections
      .map(({ id }) => String(id))
      .filter((id) => !previousCollectionIds.has(id));
    await prepareContentRealmsForSchemaApply(pendingDraft.schema.collections);
    const quarantined = await authorization.quarantineAllContentResources(policyActor);
    let applied;
    try {
      applied = await schema.apply(actor, input);
    } catch (error: unknown) {
      await authorization.releaseContentResourceQuarantine(policyActor, quarantined);
      throw error;
    }
    try {
      await sites.reconcileCollections({
        workspaceId: actor.workspaceId,
        activeCollectionIds: applied.revision.schema.collections.map(({ id }) => String(id)),
        actorIdentityId: actor.identityId ?? actor.subjectId,
        actorSubjectId: actor.subjectId,
      });
      await syncAuthorizationResources(policyActor, applied.revision.schema.collections);
      await reconcileAuthorizationHierarchy(
        policyActor,
        applied.revision.schema.collections,
        "schema.apply",
      );
      await syncConfiguredContentRealmResources(
        applied.revision.schema.collections,
        newlyAddedCollectionIds,
      );
      // Drop entitlement ceilings for any collection retired by this apply.
      await entitlementStore.pruneRetiredCollectionEntitlements(
        actor.workspaceId,
        applied.revision.schema.collections.map(({ id }) => String(id)),
      );
    } catch (error: unknown) {
      // Schema is already committed; keep the durable fence until startup/retry reconcile.
      throw error;
    }
    return applied.revision;
  });
  return { syncAuthorizationResources, reconcileAuthorizationHierarchy, applySchemaWithProjection };
}

export type SchemaProjectionCoordinator = ReturnType<typeof createSchemaProjectionCoordinator>;
