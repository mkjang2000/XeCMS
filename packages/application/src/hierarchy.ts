import {
  ContentHierarchyDomainError,
  asCollectionId,
  asDocumentId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  type AddHierarchyNodeInput,
  type CollectionId,
  type ContentHierarchyCommandResult,
  type ContentHierarchyPosition,
  type DocumentId,
  type MoveHierarchyNodeInput,
  type RemoveHierarchyNodeInput,
  type ReorderHierarchyChildrenInput,
  type WorkspaceId,
} from "@xecms/core";
import type { CollectionDefinition } from "@xecms/schema";
import { realmCollectionResourceId, realmDocumentResourceId } from "./authorization.js";
import {
  ApplicationError,
  SYSTEM_ACTOR_REALM_ID,
  actorRealmId,
  assertCapability,
  type ActorContext,
} from "./errors.js";
import type { SchemaStore } from "./schema.js";

export interface ContentHierarchyStoreContext {
  readonly workspaceId: WorkspaceId;
  readonly collectionId: CollectionId;
}

export interface ContentHierarchyQueryResult {
  readonly version: number;
  readonly items: readonly ContentHierarchyPosition[];
}

export interface ContentHierarchyStore {
  listRoots(context: ContentHierarchyStoreContext): Promise<ContentHierarchyQueryResult>;
  listChildren(context: ContentHierarchyStoreContext, parentId: DocumentId): Promise<ContentHierarchyQueryResult>;
  listAncestors(context: ContentHierarchyStoreContext, documentId: DocumentId): Promise<ContentHierarchyQueryResult>;
  listDescendants(context: ContentHierarchyStoreContext, documentId: DocumentId): Promise<ContentHierarchyQueryResult>;
  getSubtree(context: ContentHierarchyStoreContext, documentId: DocumentId): Promise<ContentHierarchyQueryResult>;
  listAll(context: ContentHierarchyStoreContext): Promise<ContentHierarchyQueryResult>;
  previewMove(context: ContentHierarchyStoreContext, input: MoveHierarchyNodeInput): Promise<ContentHierarchyCommandResult>;
  addNode(context: ContentHierarchyStoreContext, input: AddHierarchyNodeInput): Promise<ContentHierarchyCommandResult>;
  moveNode(context: ContentHierarchyStoreContext, input: MoveHierarchyNodeInput): Promise<ContentHierarchyCommandResult>;
  reorderChildren(context: ContentHierarchyStoreContext, input: ReorderHierarchyChildrenInput): Promise<ContentHierarchyCommandResult>;
  removeNode(context: ContentHierarchyStoreContext, input: RemoveHierarchyNodeInput): Promise<ContentHierarchyCommandResult>;
}

export interface ContentHierarchyRuntime {
  readonly now: () => string;
}

export interface ContentHierarchyResourceProjection {
  readonly resourceId: string;
  readonly parentResourceId: string;
  readonly resourceType: "document";
  readonly documentId: string;
  readonly collectionId: string;
}

export interface ContentHierarchyPermissionImpact {
  readonly documentId: string;
  readonly documentResourceId: string;
  readonly beforeParentResourceId: string;
  readonly afterParentResourceId: string;
  readonly beforeDocumentPath: readonly string[];
  readonly afterDocumentPath: readonly string[];
  readonly beforeResourcePath: readonly string[];
  readonly afterResourcePath: readonly string[];
  readonly affectedDocumentIds: readonly string[];
  readonly affectedResourceIds: readonly string[];
  readonly effectivePermissionChanges?: readonly {
    readonly subjectId: string;
    readonly resourceId: string;
    readonly permission: string;
    readonly beforeAllowed: boolean;
    readonly afterAllowed: boolean;
    readonly change: "granted" | "revoked";
  }[];
  readonly requiresAuthorizationManagement?: boolean;
  readonly effectiveFieldAccessChanges?: readonly {
    readonly subjectId: string;
    readonly resourceId: string;
    readonly operation: "read" | "write";
    readonly beforeFields: readonly string[] | null;
    readonly afterFields: readonly string[] | null;
    readonly change: "broadened" | "narrowed" | "changed";
  }[];
  readonly effectivePermissionChangesTruncated?: boolean;
}

export interface ContentHierarchyMutationResult extends ContentHierarchyCommandResult {
  /** Present only when collection.hierarchy.permissionInheritance is enabled and a node moved. */
  readonly permissionImpact: ContentHierarchyPermissionImpact | null;
}

export interface AddContentHierarchyNodeRequest {
  readonly documentId: string;
  readonly parentId: string | null;
  readonly position: number;
  readonly expectedVersion: number;
}

export interface MoveContentHierarchyNodeRequest {
  readonly documentId: string;
  readonly newParentId: string | null;
  readonly position: number;
  readonly expectedVersion: number;
}

export interface ReorderContentHierarchyRequest {
  readonly parentId: string | null;
  readonly orderedDocumentIds: readonly string[];
  readonly expectedVersion: number;
}

export interface RemoveContentHierarchyNodeRequest {
  readonly documentId: string;
  readonly expectedVersion: number;
  readonly promoteChildren?: boolean;
}

export class ContentHierarchyApplicationService {
  public constructor(
    private readonly schemas: SchemaStore,
    private readonly hierarchy: ContentHierarchyStore,
    private readonly runtime: ContentHierarchyRuntime,
  ) {}

  public async listRoots(actor: ActorContext, collectionIdOrName: string): Promise<ContentHierarchyQueryResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "read");
    return this.hierarchy.listRoots(resolved.context);
  }

  public async listChildren(
    actor: ActorContext,
    collectionIdOrName: string,
    parentId: string,
  ): Promise<ContentHierarchyQueryResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "read");
    await this.requireReadScope(actor, resolved.collection, parentId);
    return this.mapErrors(() => this.hierarchy.listChildren(resolved.context, documentId(parentId)));
  }

  public async listAncestors(
    actor: ActorContext,
    collectionIdOrName: string,
    documentIdValue: string,
  ): Promise<ContentHierarchyQueryResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "read");
    await this.requireReadScope(actor, resolved.collection, documentIdValue);
    return this.mapErrors(() => this.hierarchy.listAncestors(resolved.context, documentId(documentIdValue)));
  }

  public async listDescendants(
    actor: ActorContext,
    collectionIdOrName: string,
    documentIdValue: string,
  ): Promise<ContentHierarchyQueryResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "read");
    await this.requireReadScope(actor, resolved.collection, documentIdValue);
    return this.mapErrors(() => this.hierarchy.listDescendants(resolved.context, documentId(documentIdValue)));
  }

  public async getSubtree(
    actor: ActorContext,
    collectionIdOrName: string,
    documentIdValue: string,
  ): Promise<ContentHierarchyQueryResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "read");
    await this.requireReadScope(actor, resolved.collection, documentIdValue);
    return this.mapErrors(() => this.hierarchy.getSubtree(resolved.context, documentId(documentIdValue)));
  }

  public async listAll(actor: ActorContext, collectionIdOrName: string): Promise<ContentHierarchyQueryResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "read");
    return this.hierarchy.listAll(resolved.context);
  }

  public async addNode(
    actor: ActorContext,
    collectionIdOrName: string,
    request: AddContentHierarchyNodeRequest,
  ): Promise<ContentHierarchyMutationResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "write");
    await this.requireMutationScope(actor, resolved.collection, request.parentId);
    const result = await this.mapErrors(() => this.hierarchy.addNode(resolved.context, {
      documentId: documentId(request.documentId),
      parentId: nullableDocumentId(request.parentId),
      position: request.position,
      expectedVersion: request.expectedVersion,
      actorId: subjectId(actor.subjectId),
      now: timestamp(this.runtime.now()),
      ...(resolved.maxDepth === undefined ? {} : { maxDepth: resolved.maxDepth }),
    }));
    return mutationResult(actorRealmId(actor), resolved.collection, result);
  }

  public async moveNode(
    actor: ActorContext,
    collectionIdOrName: string,
    request: MoveContentHierarchyNodeRequest,
    hooks: {
      /** Runs only after the full affected-subtree authorization and before persistence. */
      readonly beforeCommit?: (authorizedPreview: ContentHierarchyMutationResult) => Promise<void>;
    } = {},
  ): Promise<ContentHierarchyMutationResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "write");
    // Authorize the caller supplied source before reading any subtree topology.
    // Owners still receive the stable cross-collection domain error because
    // their source authorization succeeds.
    await this.requireMutationScope(actor, resolved.collection, request.documentId);
    await this.requireMoveReadScope(actor, resolved.collection, request.documentId);
    const preview = await this.mapErrors(() => this.hierarchy.previewMove(resolved.context, {
      documentId: documentId(request.documentId),
      newParentId: nullableDocumentId(request.newParentId),
      position: request.position,
      expectedVersion: request.expectedVersion,
      actorId: subjectId(actor.subjectId),
      now: timestamp(this.runtime.now()),
      ...(resolved.maxDepth === undefined ? {} : { maxDepth: resolved.maxDepth }),
    }));
    await this.requireMoveScopes(actor, resolved.collection, request, preview);
    await hooks.beforeCommit?.(mutationResult(actorRealmId(actor), resolved.collection, preview));
    const result = await this.mapErrors(() => this.hierarchy.moveNode(resolved.context, {
      documentId: documentId(request.documentId),
      newParentId: nullableDocumentId(request.newParentId),
      position: request.position,
      expectedVersion: request.expectedVersion,
      actorId: subjectId(actor.subjectId),
      now: timestamp(this.runtime.now()),
      ...(resolved.maxDepth === undefined ? {} : { maxDepth: resolved.maxDepth }),
    }));
    return mutationResult(actorRealmId(actor), resolved.collection, result);
  }

  public async previewMove(
    actor: ActorContext,
    collectionIdOrName: string,
    request: MoveContentHierarchyNodeRequest,
  ): Promise<ContentHierarchyMutationResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "write");
    await this.requireMutationScope(actor, resolved.collection, request.documentId);
    await this.requireMoveReadScope(actor, resolved.collection, request.documentId);
    const result = await this.mapErrors(() => this.hierarchy.previewMove(resolved.context, {
      documentId: documentId(request.documentId),
      newParentId: nullableDocumentId(request.newParentId),
      position: request.position,
      expectedVersion: request.expectedVersion,
      actorId: subjectId(actor.subjectId),
      now: timestamp(this.runtime.now()),
      ...(resolved.maxDepth === undefined ? {} : { maxDepth: resolved.maxDepth }),
    }));
    await this.requireMoveScopes(actor, resolved.collection, request, result);
    return mutationResult(actorRealmId(actor), resolved.collection, result);
  }

  public async reorderChildren(
    actor: ActorContext,
    collectionIdOrName: string,
    request: ReorderContentHierarchyRequest,
  ): Promise<ContentHierarchyMutationResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "write");
    await this.requireMutationScope(actor, resolved.collection, request.parentId);
    if ((resolved.collection.hierarchy?.ordering ?? "manual") !== "manual") {
      throw new ApplicationError(
        "HIERARCHY_ORDERING_NOT_MANUAL",
        409,
        "Explicit reorder is only available for hierarchy.ordering = 'manual'.",
      );
    }
    const result = await this.mapErrors(() => this.hierarchy.reorderChildren(resolved.context, {
      parentId: nullableDocumentId(request.parentId),
      orderedDocumentIds: request.orderedDocumentIds.map(documentId),
      expectedVersion: request.expectedVersion,
      actorId: subjectId(actor.subjectId),
      now: timestamp(this.runtime.now()),
      ...(resolved.maxDepth === undefined ? {} : { maxDepth: resolved.maxDepth }),
    }));
    return mutationResult(actorRealmId(actor), resolved.collection, result);
  }

  public async removeNode(
    actor: ActorContext,
    collectionIdOrName: string,
    request: RemoveContentHierarchyNodeRequest,
  ): Promise<ContentHierarchyMutationResult> {
    const resolved = await this.resolve(actor, collectionIdOrName, "write");
    await this.requireMutationScope(actor, resolved.collection, request.documentId);
    const result = await this.mapErrors(() => this.hierarchy.removeNode(resolved.context, {
      documentId: documentId(request.documentId),
      expectedVersion: request.expectedVersion,
      actorId: subjectId(actor.subjectId),
      now: timestamp(this.runtime.now()),
      ...(request.promoteChildren === undefined ? {} : { promoteChildren: request.promoteChildren }),
      ...(resolved.maxDepth === undefined ? {} : { maxDepth: resolved.maxDepth }),
    }));
    return mutationResult(actorRealmId(actor), resolved.collection, result);
  }

  private async resolve(
    actor: ActorContext,
    collectionIdOrName: string,
    operation: "read" | "write",
  ): Promise<{
      readonly collection: CollectionDefinition;
      readonly context: ContentHierarchyStoreContext;
      readonly maxDepth?: number;
    }> {
    const active = await this.schemas.getActiveSchema();
    const collection = active?.schema.collections.find(
      ({ id, name }) => String(id) === collectionIdOrName || name === collectionIdOrName,
    );
    if (collection === undefined) {
      throw new ApplicationError(
        "COLLECTION_NOT_FOUND",
        404,
        `Collection '${collectionIdOrName}' does not exist in the active schema.`,
      );
    }
    if (collection.hierarchy?.enabled !== true) {
      throw new ApplicationError(
        "HIERARCHY_NOT_ENABLED",
        409,
        `Collection '${collection.name}' does not enable hierarchy.`,
      );
    }
    if (operation === "read" || collection.hierarchy.permissionInheritance !== true) {
      await assertCapability(actor, operation === "read" ? "document:read" : "document:update", {
        action: operation === "read" ? "content.read" : "content.update",
        resourceId: realmCollectionResourceId(actorRealmId(actor), String(collection.id)),
      });
    }
    return {
      collection,
      context: {
        workspaceId: workspaceId(actor.workspaceId),
        collectionId: asCollectionId(String(collection.id)),
      },
      ...(collection.hierarchy.maxDepth === undefined ? {} : { maxDepth: collection.hierarchy.maxDepth }),
    };
  }

  private async requireMutationScope(
    actor: ActorContext,
    collection: CollectionDefinition,
    documentIdValue: string | null,
  ): Promise<void> {
    if (collection.hierarchy?.permissionInheritance !== true) return;
    await assertCapability(actor, "document:update", {
      action: "content.update",
      resourceId: documentIdValue === null
        ? realmCollectionResourceId(actorRealmId(actor), String(collection.id))
        : contentHierarchyNodeResourceId(documentIdValue, actorRealmId(actor)),
    });
  }

  private async requireReadScope(
    actor: ActorContext,
    collection: CollectionDefinition,
    documentIdValue: string,
  ): Promise<void> {
    if (collection.hierarchy?.permissionInheritance !== true) return;
    await assertCapability(actor, "document:read", {
      action: "content.read",
      resourceId: contentHierarchyNodeResourceId(documentIdValue, actorRealmId(actor)),
    });
  }

  private async requireMoveReadScope(
    actor: ActorContext,
    collection: CollectionDefinition,
    documentIdValue: string,
  ): Promise<void> {
    await assertCapability(actor, "document:read", {
      action: "content.read",
      resourceId: collection.hierarchy?.permissionInheritance === true
        ? contentHierarchyNodeResourceId(documentIdValue, actorRealmId(actor))
        : realmCollectionResourceId(actorRealmId(actor), String(collection.id)),
    });
  }

  private async requireMoveScopes(
    actor: ActorContext,
    collection: CollectionDefinition,
    request: MoveContentHierarchyNodeRequest,
    preview: ContentHierarchyCommandResult,
  ): Promise<void> {
    if (collection.hierarchy?.permissionInheritance !== true) return;
    const readableDocumentIds = new Set<string>([
      ...preview.event.affectedDocumentIds.map(String),
      ...payloadPath(preview.event.before),
      ...payloadPath(preview.event.after),
    ]);
    readableDocumentIds.delete(request.documentId);
    for (const discoveredDocumentId of readableDocumentIds) {
      try {
        await this.requireReadScope(actor, collection, discoveredDocumentId);
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.status === 403) {
          throw new ApplicationError(
            "AUTHORIZATION_DENIED",
            403,
            "The hierarchy move preview contains topology that is not readable by the actor.",
          );
        }
        throw error;
      }
    }
    const documentIds = new Set<string>(preview.event.affectedDocumentIds.map(String));
    documentIds.delete(request.documentId);
    for (const affectedDocumentId of documentIds) {
      try {
        await this.requireMutationScope(actor, collection, affectedDocumentId);
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.status === 403) {
          // Descendants are discovered by the server. Never reflect an
          // unauthorized descendant resource ID in the denial payload.
          throw new ApplicationError(
            "AUTHORIZATION_DENIED",
            403,
            "The hierarchy move is not authorized for the complete affected subtree.",
          );
        }
        throw error;
      }
    }
    await this.requireMutationScope(actor, collection, request.newParentId);
  }

  private async mapErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof ContentHierarchyDomainError)) throw error;
      const status = error.code === "HIERARCHY_VERSION_CONFLICT"
        ? 409
        : error.code === "HIERARCHY_NODE_NOT_FOUND" || error.code === "HIERARCHY_PARENT_NOT_FOUND"
          ? 404
          : 422;
      throw new ApplicationError(error.code, status, error.message, { details: error.details });
    }
  }
}

export function contentHierarchyNodeResourceId(
  documentIdValue: string,
  realmId = SYSTEM_ACTOR_REALM_ID,
): string {
  return realmDocumentResourceId(realmId, documentIdValue);
}

export function contentHierarchyParentResourceId(
  collectionIdValue: string,
  parentDocumentId: string | null,
  realmId = SYSTEM_ACTOR_REALM_ID,
): string {
  return parentDocumentId === null
    ? realmCollectionResourceId(realmId, collectionIdValue)
    : contentHierarchyNodeResourceId(parentDocumentId, realmId);
}

export function contentHierarchyResourceProjection(
  collectionIdValue: string,
  position: ContentHierarchyPosition,
  realmId = SYSTEM_ACTOR_REALM_ID,
): ContentHierarchyResourceProjection {
  return Object.freeze({
    resourceId: contentHierarchyNodeResourceId(position.documentId, realmId),
    parentResourceId: contentHierarchyParentResourceId(collectionIdValue, position.parentId, realmId),
    resourceType: "document",
    documentId: position.documentId,
    collectionId: collectionIdValue,
  });
}

function mutationResult(
  realmId: string,
  collection: CollectionDefinition,
  result: ContentHierarchyCommandResult,
): ContentHierarchyMutationResult {
  return {
    ...result,
    permissionImpact: collection.hierarchy?.permissionInheritance === true
      ? movePermissionImpact(realmId, String(collection.id), result)
      : null,
  };
}

function movePermissionImpact(
  realmId: string,
  collectionIdValue: string,
  result: ContentHierarchyCommandResult,
): ContentHierarchyPermissionImpact | null {
  if (result.event.type !== "tree.node.moved" || result.event.documentId === null) return null;
  const beforeParentId = payloadParentId(result.event.before);
  const afterParentId = payloadParentId(result.event.after);
  const beforeDocumentPath = payloadPath(result.event.before);
  const afterDocumentPath = payloadPath(result.event.after);
  const toResourcePath = (path: readonly string[]): readonly string[] => Object.freeze([
    realmCollectionResourceId(realmId, collectionIdValue),
    ...path.map((documentIdValue) => contentHierarchyNodeResourceId(documentIdValue, realmId)),
  ]);
  return Object.freeze({
    documentId: result.event.documentId,
    documentResourceId: contentHierarchyNodeResourceId(result.event.documentId, realmId),
    beforeParentResourceId: contentHierarchyParentResourceId(collectionIdValue, beforeParentId, realmId),
    afterParentResourceId: contentHierarchyParentResourceId(collectionIdValue, afterParentId, realmId),
    beforeDocumentPath,
    afterDocumentPath,
    beforeResourcePath: toResourcePath(beforeDocumentPath),
    afterResourcePath: toResourcePath(afterDocumentPath),
    affectedDocumentIds: Object.freeze([...result.event.affectedDocumentIds]),
    affectedResourceIds: Object.freeze(result.event.affectedDocumentIds.map(
      (documentIdValue) => contentHierarchyNodeResourceId(documentIdValue, realmId),
    )),
  });
}

function payloadParentId(payload: Readonly<Record<string, unknown>> | null): string | null {
  const value = payload?.["parentId"];
  return typeof value === "string" ? value : null;
}

function payloadPath(payload: Readonly<Record<string, unknown>> | null): readonly string[] {
  const value = payload?.["path"];
  return Object.freeze(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
}

function documentId(value: string): DocumentId {
  try {
    return asDocumentId(value);
  } catch {
    throw new ApplicationError("HIERARCHY_REQUEST_INVALID", 400, "Document IDs must be non-empty strings.");
  }
}

function nullableDocumentId(value: string | null): DocumentId | null {
  return value === null ? null : documentId(value);
}

function workspaceId(value: string): WorkspaceId {
  try {
    return asWorkspaceId(value);
  } catch {
    throw new ApplicationError("HIERARCHY_REQUEST_INVALID", 400, "Workspace ID must be a non-empty string.");
  }
}

function subjectId(value: string) {
  try {
    return asSubjectId(value);
  } catch {
    throw new ApplicationError("HIERARCHY_REQUEST_INVALID", 400, "Actor ID must be a non-empty string.");
  }
}

function timestamp(value: string) {
  try {
    return asUtcInstant(value);
  } catch {
    throw new ApplicationError("HIERARCHY_RUNTIME_INVALID", 500, "Hierarchy runtime returned an invalid timestamp.");
  }
}
