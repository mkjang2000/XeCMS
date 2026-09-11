import {
  ApplicationError,
  AuthorizationApplicationService,
  ContentHierarchyApplicationService,
  DocumentApplicationService,
  SiteService,
  SYSTEM_AUTHORIZATION_REALM_ID,
  realmDocumentResourceId,
  type ActorContext,
  type ContentHierarchyQueryResult,
} from "@xecms/application";
import type {
  CreateDocumentRequest,
  DocumentRecordDto,
  DocumentTreeDto,
  MoveDocumentResultDto,
  MoveDocumentPreviewDto,
} from "@xecms/contracts";
import { PostgresDatabase } from "@xecms/database";
import { presentTree, documentDto } from "./response-presenters.js";
import {
  eventStringOrNull,
  eventInteger,
  objectBody,
  nonNegativeInteger,
  requiredString,
  nullableString,
  badRequest,
} from "./request-input.js";
import type { SchemaProjectionCoordinator } from "./schema-projection.js";

interface Options {
  readonly database: PostgresDatabase;
  readonly documents: DocumentApplicationService;
  readonly hierarchy: ContentHierarchyApplicationService;
  readonly authorization: AuthorizationApplicationService;
  readonly sites: SiteService;
  readonly reconcileAuthorizationHierarchy: SchemaProjectionCoordinator["reconcileAuthorizationHierarchy"];
}

export function createContentHierarchyRuntime(options: Options) {
  const { database, documents, hierarchy, authorization, sites, reconcileAuthorizationHierarchy } = options;

  async function createContentDocument(
    actor: ActorContext,
    collectionId: string,
    request: CreateDocumentRequest,
  ): Promise<DocumentRecordDto> {
    await sites.assertCollectionWritable(actor.workspaceId, collectionId);
    return database.withContentProjectionLock(async () => {
      const active = await database.getActiveSchema();
      const collection = active?.schema.collections.find(
        ({ id, name }) => String(id) === collectionId || name === collectionId,
      );
      let placement: CreateDocumentRequest["hierarchy"];
      if (collection?.hierarchy?.enabled === true) {
        if (request.hierarchy === undefined) {
          const roots = await hierarchy.listRoots(actor, collectionId);
          placement = { parentId: null, position: roots.items.length, expectedVersion: roots.version };
        } else {
          placement = request.hierarchy;
        }
      } else if (request.hierarchy !== undefined) {
        throw badRequest("HIERARCHY_NOT_ENABLED", "This collection does not enable hierarchy.");
      }
      const created = await documents.create(actor, collectionId, request.data, placement);
      try {
        await reconcileAuthorizationHierarchy(
          { realmId: actor.realmId ?? SYSTEM_AUTHORIZATION_REALM_ID, subjectId: actor.subjectId },
          (await database.getActiveSchema())?.schema.collections ?? [],
          "hierarchy.create",
        );
      } catch (error: unknown) {
        // The new resource is absent, so every document-level check naturally fails closed.
        throw error;
      }
      return documentDto(created);
    });
  }

  async function treeDto(
    actor: ActorContext,
    collectionId: string,
    mode: { readonly kind: "all" | "roots" | "children" | "ancestors" | "descendants" | "subtree"; readonly documentId?: string },
  ): Promise<DocumentTreeDto> {
    let result: ContentHierarchyQueryResult;
    if (mode.kind === "roots") {
      result = await hierarchy.listRoots(actor, collectionId);
    } else if (mode.kind === "children") {
      result = await hierarchy.listChildren(actor, collectionId, requiredString(mode.documentId, "parentId"));
    } else if (mode.kind === "ancestors") {
      result = await hierarchy.listAncestors(actor, collectionId, requiredString(mode.documentId, "documentId"));
    } else if (mode.kind === "descendants") {
      result = await hierarchy.listDescendants(actor, collectionId, requiredString(mode.documentId, "documentId"));
    } else if (mode.kind === "subtree") {
      result = await hierarchy.getSubtree(actor, collectionId, requiredString(mode.documentId, "documentId"));
  } else {
      result = await hierarchy.listAll(actor, collectionId);
    }
    return presentTree(actor, collectionId, result, documents);
  }

  async function calculateMovePreview(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    rawBody: unknown,
    requireExpectedPolicyRevision = false,
  ): Promise<{
    readonly dto: MoveDocumentPreviewDto;
    readonly hypotheticalTree: ContentHierarchyQueryResult;
    readonly request: {
      readonly newParentId: string | null;
      readonly position: number;
      readonly expectedVersion: number;
    };
  }> {
    const body = objectBody(rawBody);
    const request = {
      newParentId: nullableString(body["newParentId"], "newParentId"),
      position: nonNegativeInteger(body["position"], "position"),
      expectedVersion: nonNegativeInteger(body["expectedVersion"], "expectedVersion"),
    };
    const expectedPolicyRevisionValue = body["expectedPolicyRevision"];
    if (requireExpectedPolicyRevision && expectedPolicyRevisionValue === undefined) {
      throw badRequest(
        "POLICY_REVISION_REQUIRED",
        "expectedPolicyRevision from a move preview is required.",
      );
    }
    if (expectedPolicyRevisionValue !== undefined && (
      typeof expectedPolicyRevisionValue !== "number" ||
      !Number.isSafeInteger(expectedPolicyRevisionValue) ||
      expectedPolicyRevisionValue < 1
    )) {
      throw badRequest("POLICY_REVISION_INVALID", "expectedPolicyRevision must be a positive integer.");
    }
    const actorAuthorizationRealmId = actor.realmId ?? SYSTEM_AUTHORIZATION_REALM_ID;
    const policyActor = { realmId: actorAuthorizationRealmId, subjectId: actor.subjectId };
    const policyRevision = await authorization.currentPolicyRevision(actorAuthorizationRealmId);
    if (expectedPolicyRevisionValue !== undefined && expectedPolicyRevisionValue !== policyRevision) {
      throw new ApplicationError(
        "POLICY_REVISION_CONFLICT",
        409,
        `Expected policy revision '${expectedPolicyRevisionValue}', but current revision is '${policyRevision}'.`,
        { details: { expectedRevision: expectedPolicyRevisionValue, actualRevision: policyRevision } },
      );
    }
    const result = await hierarchy.previewMove(actor, collectionId, {
      documentId,
      ...request,
    });
    let permissionImpact = result.permissionImpact;
    if (permissionImpact !== null) {
      const contextsByResourceId = Object.fromEntries(await Promise.all(
        permissionImpact.affectedDocumentIds.map(async (affectedDocumentId) => {
          const aggregate = await database.loadDocument(affectedDocumentId);
          if (aggregate === null) {
            throw new ApplicationError(
              "HIERARCHY_INVARIANT_VIOLATION",
              500,
              "A hierarchy node has no matching document.",
            );
          }
          return [
            realmDocumentResourceId(actorAuthorizationRealmId, affectedDocumentId),
            {
              ownerSubjectId: String(aggregate.identity.createdBy),
              status: aggregate.identity.deletion !== null
                ? "deleted"
                : aggregate.identity.lifecycle.kind === "archived"
                  ? "archived"
                  : aggregate.identity.publication !== null && aggregate.identity.currentDraftRevisionId !== null
                    ? "published-with-draft"
                    : aggregate.identity.publication !== null
                      ? "published"
                      : "draft",
            },
          ] as const;
        }),
      ));
      const effective = await authorization.previewResourceParentChange(
        policyActor,
        {
          resourceId: permissionImpact.documentResourceId,
          newParentResourceId: permissionImpact.afterParentResourceId,
          affectedResourceIds: permissionImpact.affectedResourceIds,
          contextsByResourceId,
        },
      );
      if (effective.policyRevision !== policyRevision) {
        throw new ApplicationError(
          "POLICY_REVISION_CONFLICT",
          409,
          "The authorization policy changed while the move preview was calculated.",
          { details: { expectedRevision: policyRevision, actualRevision: effective.policyRevision } },
        );
      }
      permissionImpact = {
        ...permissionImpact,
        requiresAuthorizationManagement: effective.requiresAuthorizationManagement,
        effectivePermissionChanges: effective.effectivePermissionChanges,
        effectiveFieldAccessChanges: effective.effectiveFieldAccessChanges,
        effectivePermissionChangesTruncated: effective.effectivePermissionChangesTruncated,
      };
    }
    return {
      request,
      hypotheticalTree: { version: result.state.version, items: result.state.positions },
      dto: {
        previousParentId: eventStringOrNull(result.event.before, "parentId"),
        previousPosition: eventInteger(result.event.before, "sortKey"),
        affectedDocumentIds: result.event.affectedDocumentIds,
        policyRevision,
        permissionImpact,
      },
    };
  }

  async function moveHierarchyDocument(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    body: unknown,
  ): Promise<MoveDocumentResultDto> {
    await sites.assertCollectionWritable(actor.workspaceId, collectionId);
    return database.withContentProjectionLock(async () => {
      const preview = await calculateMovePreview(actor, collectionId, documentId, body, true);
      const policyActor = {
        realmId: actor.realmId ?? SYSTEM_AUTHORIZATION_REALM_ID,
        subjectId: actor.subjectId,
      };
      if (preview.dto.permissionImpact?.requiresAuthorizationManagement === true) {
        await authorization.requireHierarchyPolicyManagement(policyActor);
      }

      // Load every response-visible node before persistence so a committed move
      // can never be followed by a response authorization failure.
      const hypotheticalById = new Map(preview.hypotheticalTree.items.map((position) => [
        String(position.documentId),
        position,
      ]));
      const movedPosition = hypotheticalById.get(documentId);
      if (movedPosition === undefined) {
        throw new ApplicationError("HIERARCHY_INVARIANT_VIOLATION", 500, "Moved node is missing.");
      }
      const candidateIds = new Set<string>([documentId]);
      let pathCursor: string | null = documentId;
      while (pathCursor !== null) {
        candidateIds.add(pathCursor);
        const position = hypotheticalById.get(pathCursor);
        pathCursor = position?.parentId === null || position?.parentId === undefined
          ? null
          : String(position.parentId);
      }
      preview.hypotheticalTree.items.forEach((position) => {
        if (position.parentId !== null && String(position.parentId) === documentId) {
          candidateIds.add(String(position.documentId));
        }
      });
      const readableDocuments = new Map<string, Awaited<ReturnType<typeof documents.get>>>();
      for (const candidateId of candidateIds) {
        try {
          readableDocuments.set(candidateId, await documents.get(actor, collectionId, candidateId));
        } catch (error: unknown) {
          if (candidateId === documentId || !(error instanceof ApplicationError) || error.status !== 403) {
            throw error;
          }
        }
      }
      const movedDocument = readableDocuments.get(documentId);
      if (movedDocument === undefined) {
        throw new ApplicationError("AUTHORIZATION_DENIED", 403, "The moved document is not readable.");
      }

      let affectedResourceIds: readonly string[] = [];
      let fenced = false;
      let result;
      try {
        result = await hierarchy.moveNode(
          actor,
          collectionId,
          { documentId, ...preview.request },
          {
            beforeCommit: async (authorizedPreview) => {
              affectedResourceIds = authorizedPreview.permissionImpact?.affectedResourceIds ?? [];
              await authorization.quarantineContentResources(
                policyActor,
                affectedResourceIds,
                "hierarchy-move-pending",
              );
              fenced = true;
            },
          },
        );
      } catch (error: unknown) {
        if (fenced) await authorization.releaseContentResourceQuarantine(policyActor, affectedResourceIds);
        throw error;
      }
      let policyRevision = preview.dto.policyRevision;
      try {
        const reconciled = await reconcileAuthorizationHierarchy(
          policyActor,
          (await database.getActiveSchema())?.schema.collections ?? [],
          "hierarchy.move",
          preview.dto.policyRevision,
        );
        policyRevision = reconciled.revision;
      } catch (error: unknown) {
        // Durable quarantine intentionally remains until a later reconcile or restart.
        throw error;
      }
      const committedPosition = result.state.positions.find(
        (position) => String(position.documentId) === documentId,
      );
      if (committedPosition === undefined) {
        throw new ApplicationError("HIERARCHY_INVARIANT_VIOLATION", 500, "Moved node is missing.");
      }
      const visiblePath: string[] = [documentId];
      let visibleCursor = committedPosition.parentId === null ? null : String(committedPosition.parentId);
      while (visibleCursor !== null && readableDocuments.has(visibleCursor)) {
        visiblePath.unshift(visibleCursor);
        const parent = result.state.positions.find((position) => String(position.documentId) === visibleCursor);
        visibleCursor = parent?.parentId === null || parent?.parentId === undefined
          ? null
          : String(parent.parentId);
      }
      const visibleParentId = committedPosition.parentId !== null
        && readableDocuments.has(String(committedPosition.parentId))
        ? String(committedPosition.parentId)
        : null;
      return {
        version: result.state.version,
        node: {
          document: documentDto(movedDocument),
          parentId: visibleParentId,
          position: committedPosition.sortKey,
          depth: visiblePath.length - 1,
          path: visiblePath,
          hasChildren: result.state.positions.some((position) =>
            position.parentId !== null
            && String(position.parentId) === documentId
            && readableDocuments.has(String(position.documentId))),
        },
        previousParentId: eventStringOrNull(result.event.before, "parentId"),
        previousPosition: eventInteger(result.event.before, "sortKey"),
        affectedDocumentIds: result.event.affectedDocumentIds,
        policyRevision,
        permissionImpact: preview.dto.permissionImpact,
      };
    });
  }

  return { createContentDocument, treeDto, calculateMovePreview, moveHierarchyDocument };
}
