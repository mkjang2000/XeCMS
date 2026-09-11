import {
  AuthorizationApplicationService,
  DocumentApplicationService,
  SiteService,
  type AuthorizationActor,
  type ActorContext,
} from "@xecms/application";
import type {
  CreateDocumentRequest,
  DocumentListDto,
  DocumentRecordDto,
  DocumentRevisionDetailDto,
  DocumentRevisionListDto,
  PublishedDocumentListDto,
  PublishedDocumentRecordDto,
} from "@xecms/contracts";
import { PostgresDatabase } from "@xecms/database";
import { type CollectionDefinition } from "@xecms/schema";
import { type FastifyInstance } from "fastify";
import { authorizationActor, publicActor } from "./request-authentication.js";
import {
  objectBody,
  expectedDocumentVersion,
  nonNegativeInteger,
  nullableString,
  badRequest,
} from "./request-input.js";
import type { RequestActorResolver } from "./request-authentication.js";

interface Options {
  readonly app: FastifyInstance;
  readonly documents: DocumentApplicationService;
  readonly sites: SiteService;
  readonly database: PostgresDatabase;
  readonly authorization: AuthorizationApplicationService;
  readonly requireActor: RequestActorResolver;
  readonly createContentDocument: (actor: ActorContext, collectionId: string, request: CreateDocumentRequest) => Promise<DocumentRecordDto>;
  readonly reconcileAuthorizationHierarchy: (actor: AuthorizationActor, collections: readonly CollectionDefinition[], reason: "hierarchy.purge") => Promise<unknown>;
}

export function registerDocumentRoutes(options: Options): void {
  const { app, documents, sites, database, authorization, requireActor, createContentDocument, reconcileAuthorizationHierarchy } = options;

  app.get<{
    Params: { collectionId: string };
    Querystring: { page?: string; pageSize?: string };
  }>(
    "/api/content/:collectionId/documents",
    async (request): Promise<PublishedDocumentListDto> =>
      documents.listPublished(publicActor(authorization), request.params.collectionId, {
        ...(request.query.page === undefined ? {} : { page: Number(request.query.page) }),
        ...(request.query.pageSize === undefined ? {} : { pageSize: Number(request.query.pageSize) }),
      }),
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/content/:collectionId/documents/:documentId",
    async (request): Promise<PublishedDocumentRecordDto> =>
      documents.getPublished(
        publicActor(authorization),
        request.params.collectionId,
        request.params.documentId,
      ),
  );

  app.get<{
    Params: { collectionId: string };
    Querystring: { page?: string; pageSize?: string; state?: string };
  }>(
    "/api/collections/:collectionId/documents",
    async (request): Promise<DocumentListDto> => {
      const { actor } = await requireActor(request, false);
      const state = request.query.state;
      if (state !== undefined && state !== "active" && state !== "deleted") {
        throw badRequest("INVALID_DOCUMENT_STATE", "state must be 'active' or 'deleted'.");
      }
      return documents.list(actor, request.params.collectionId, {
        ...(request.query.page === undefined ? {} : { page: Number(request.query.page) }),
        ...(request.query.pageSize === undefined ? {} : { pageSize: Number(request.query.pageSize) }),
        ...(state === undefined ? {} : { state }),
      });
    },
  );

  app.post<{ Params: { collectionId: string } }>(
    "/api/collections/:collectionId/documents",
    async (request, reply): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      if (!("data" in body)) {
        throw badRequest("REQUEST_BODY_INVALID", "data is required.");
      }
      const hierarchyBody = body["hierarchy"] === undefined ? undefined : objectBody(body["hierarchy"]);
      const result = await createContentDocument(actor, request.params.collectionId, {
        data: objectBody(body["data"]),
        ...(hierarchyBody === undefined ? {} : {
          hierarchy: {
            parentId: nullableString(hierarchyBody["parentId"], "hierarchy.parentId"),
            position: nonNegativeInteger(hierarchyBody["position"], "hierarchy.position"),
            expectedVersion: nonNegativeInteger(hierarchyBody["expectedVersion"], "hierarchy.expectedVersion"),
          },
        }),
      });
      reply.code(201);
      return result;
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, false);
      return documents.get(actor, request.params.collectionId, request.params.documentId);
    },
  );

  app.patch<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      if (!("data" in body) || typeof body["expectedVersion"] !== "number") {
        throw badRequest("REQUEST_BODY_INVALID", "data and expectedVersion are required.");
      }
      return documents.update(actor, request.params.collectionId, request.params.documentId, {
        data: body["data"],
        expectedVersion: body["expectedVersion"],
      });
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/publish",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.publish(
        actor,
        request.params.collectionId,
        request.params.documentId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/unpublish",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.unpublish(
        actor,
        request.params.collectionId,
        request.params.documentId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/revisions",
    async (request): Promise<DocumentRevisionListDto> => {
      const { actor } = await requireActor(request, false);
      return documents.listRevisions(
        actor,
        request.params.collectionId,
        request.params.documentId,
      );
    },
  );

  app.get<{ Params: { collectionId: string; documentId: string; revisionId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/revisions/:revisionId",
    async (request): Promise<DocumentRevisionDetailDto> => {
      const { actor } = await requireActor(request, false);
      return documents.getRevision(
        actor,
        request.params.collectionId,
        request.params.documentId,
        request.params.revisionId,
      );
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string; revisionId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/revisions/:revisionId/restore",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.restoreRevision(
        actor,
        request.params.collectionId,
        request.params.documentId,
        request.params.revisionId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.post<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/restore",
    async (request): Promise<DocumentRecordDto> => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      return documents.restoreDeleted(
        actor,
        request.params.collectionId,
        request.params.documentId,
        expectedDocumentVersion(request.body),
      );
    },
  );

  app.delete<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId/purge",
    async (request, reply) => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      await database.withContentProjectionLock(async () => {
        const policyActor = authorizationActor(actor.subjectId);
        let quarantined: readonly string[] = [];
        let fenced = false;
        try {
          await documents.purge(
            actor,
            request.params.collectionId,
            request.params.documentId,
            expectedDocumentVersion(request.body),
            {
              beforeCommit: async () => {
                quarantined = await authorization.quarantineAllContentResources(policyActor);
                fenced = true;
              },
            },
          );
        } catch (error: unknown) {
          if (fenced) {
            await authorization.releaseContentResourceQuarantine(policyActor, quarantined);
          }
          throw error;
        }
        try {
          await reconcileAuthorizationHierarchy(
            policyActor,
            (await database.getActiveSchema())?.schema.collections ?? [],
            "hierarchy.purge",
          );
        } catch (error: unknown) {
          // Purge is committed; retain the durable fence for startup recovery.
          throw error;
        }
      });
      reply.code(204).send();
    },
  );

  app.delete<{ Params: { collectionId: string; documentId: string } }>(
    "/api/collections/:collectionId/documents/:documentId",
    async (request, reply) => {
      const { actor } = await requireActor(request, true);
      await sites.assertCollectionWritable(actor.workspaceId, request.params.collectionId);
      const body = objectBody(request.body);
      if (typeof body["expectedVersion"] !== "number") {
        throw badRequest("REQUEST_BODY_INVALID", "expectedVersion is required.");
      }
      await documents.delete(
        actor,
        request.params.collectionId,
        request.params.documentId,
        body["expectedVersion"],
      );
      reply.code(204).send();
    },
  );

}
