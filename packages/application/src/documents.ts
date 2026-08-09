import {
  DocumentDomainError,
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  createDocument,
  createDraft,
  extractDocumentRelations,
  findRevision,
  getDisplayState,
  getWorkingRevision,
  publishDocument,
  restoreDeletedDocument,
  restoreRevision,
  softDeleteDocument,
  unpublishDocument,
  type DocumentAggregate,
  type DocumentEvent,
  type DocumentId,
  type DocumentRelationEdge,
  type DocumentRevision,
  type JsonObject,
  type JsonValue,
} from "@xecms/core";
import {
  ContentValidationError,
  decodeCollectionData,
  type CollectionDefinition,
  type SchemaIrV1,
} from "@xecms/schema";
import { realmCollectionResourceId, realmDocumentResourceId } from "./authorization.js";
import {
  ApplicationError,
  SYSTEM_ACTOR_REALM_ID,
  actorRealmId,
  assertCapability,
  authorizationContextForOwner,
  type ActorContext,
} from "./errors.js";
import { RelationApplicationService, relationContractsForCollection } from "./relations.js";
import { type SchemaRevisionRecord, type SchemaStore } from "./schema.js";
import {
  documentHookContext,
  type DocumentLifecycleHookRunner,
} from "./hooks.js";
import {
  normalizeDocumentAggregate,
  normalizeDocumentQuery,
  type DocumentAggregateGroup,
  type DocumentQueryFieldReference,
  type DocumentQueryInput,
  type DocumentQueryMeasure,
  type DocumentQueryScalar,
  type NormalizedDocumentQuery,
} from "./document-query.js";

export interface DocumentRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Internal authorization context; HTTP presenters may omit it. */
  readonly ownerSubjectId: string;
  /** Missing for legacy/cross-realm records until Membership origin resolution. */
  readonly ownerRealmId?: string;
  readonly displayState: "draft" | "published" | "published-with-draft" | "archived" | "deleted";
  readonly draftRevisionId: string | null;
  readonly publication: {
    readonly revisionId: string;
    readonly publishedAt: string;
    readonly publishedBy: string;
  } | null;
  readonly deletion: {
    readonly deletedAt: string;
    readonly deletedBy: string;
    readonly reason?: string;
  } | null;
}

export interface DocumentPage {
  readonly items: readonly DocumentRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type DocumentListState = "active" | "deleted";

export interface DocumentQueryPage {
  readonly items: readonly DocumentRecord[];
  readonly hasNextPage: boolean;
  readonly nextCursor?: string;
}

export interface DocumentAggregateResult {
  readonly groups: readonly DocumentAggregateGroup[];
  /** True when the scan hit its bound before every matching document was aggregated. */
  readonly truncated: boolean;
}

export interface DocumentQueryStoreItem {
  readonly document: DocumentRecord;
  /** Cursor immediately after this raw candidate in the store ordering. */
  readonly cursor: string;
}

export interface DocumentQueryStorePage {
  readonly items: readonly DocumentQueryStoreItem[];
  readonly hasNextPage: boolean;
}

export interface DocumentRevisionSummary {
  readonly id: string;
  readonly sequence: number;
  readonly schemaRevisionId: string;
  readonly origin:
    | { readonly kind: "create" | "edit" }
    | { readonly kind: "restore"; readonly restoredFromRevisionId: string };
  readonly createdAt: string;
  readonly createdBy: string;
  readonly isCurrentDraft: boolean;
  readonly isPublished: boolean;
}

export interface DocumentRevisionDetail extends DocumentRevisionSummary {
  readonly data: Readonly<Record<string, unknown>>;
}

export interface DocumentRevisionList {
  readonly items: readonly DocumentRevisionSummary[];
  readonly documentVersion: number;
}

export interface PublishedDocumentRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly revisionId: string;
  readonly schemaRevisionId: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Internal authorization context; HTTP presenters may omit it. */
  readonly ownerSubjectId: string;
  /** Missing for legacy/cross-realm records until Membership origin resolution. */
  readonly ownerRealmId?: string;
}

export interface PublishedDocumentPage {
  readonly items: readonly PublishedDocumentRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface DocumentPurgedEvent {
  readonly type: "document.purged";
  readonly documentId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly aggregateVersion: number;
}

export type PersistedDocumentEvent = DocumentEvent | DocumentPurgedEvent;

export interface DocumentStore {
  loadDocument(documentId: string): Promise<DocumentAggregate | null>;
  createDocument(
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
    events: readonly PersistedDocumentEvent[],
    integrity?: DocumentWriteIntegrity,
  ): Promise<void>;
  updateDocument(
    aggregate: DocumentAggregate,
    collection: CollectionDefinition,
    expectedVersion: number,
    events: readonly PersistedDocumentEvent[],
    integrity?: DocumentWriteIntegrity,
  ): Promise<void>;
  listDocuments(
    collection: CollectionDefinition,
    input: { readonly page: number; readonly pageSize: number; readonly state: DocumentListState },
  ): Promise<DocumentPage>;
  queryDocuments(
    collection: CollectionDefinition,
    input: NormalizedDocumentQuery,
  ): Promise<DocumentQueryStorePage>;
  listPublishedDocuments(
    collection: CollectionDefinition,
    input: { readonly page: number; readonly pageSize: number },
  ): Promise<PublishedDocumentPage>;
  getPublishedDocument(
    collection: CollectionDefinition,
    documentId: string,
  ): Promise<PublishedDocumentRecord | null>;
  /**
   * Commits every nullification, cascade and target removal as one unit. The
   * implementation must lock/revalidate the complete relation boundary before
   * changing any durable document state.
   */
  executeHardPurge(input: HardPurgePlan): Promise<void>;
}

export interface DocumentMediaReferenceInput {
  readonly fieldName: string;
  readonly mediaId: string;
  readonly ordinal: number;
  readonly acceptedMimeTypes?: readonly string[];
}

export interface DocumentWriteIntegrity {
  readonly relationEdges: readonly DocumentRelationEdge[];
  readonly mediaReferences: readonly DocumentMediaReferenceInput[];
  readonly hierarchy?: {
    readonly parentId: DocumentId | null;
    readonly position: number;
    readonly expectedVersion: number;
  };
}

export interface HardPurgeDocumentUpdate {
  readonly aggregate: DocumentAggregate;
  readonly collection: CollectionDefinition;
  readonly expectedVersion: number;
  readonly events: readonly PersistedDocumentEvent[];
  readonly integrity: DocumentWriteIntegrity;
}

export interface HardPurgeDocumentRemoval {
  /** Final, deleted aggregate. Cascade removals may be soft-deleted in this command. */
  readonly aggregate: DocumentAggregate;
  readonly collection: CollectionDefinition;
  /** Version observed before this hard-purge command starts. */
  readonly expectedVersion: number;
  readonly events: readonly PersistedDocumentEvent[];
}

export interface HardPurgePlan {
  readonly updates: readonly HardPurgeDocumentUpdate[];
  readonly removals: readonly HardPurgeDocumentRemoval[];
}

interface PendingRelationNullification {
  readonly aggregate: DocumentAggregate;
  readonly collection: CollectionDefinition;
  readonly schema: SchemaRevisionRecord;
  readonly data: Record<string, JsonValue>;
}

interface HardPurgePreparation {
  readonly visiting: Set<string>;
  readonly completed: Set<string>;
  readonly removals: Map<string, HardPurgeDocumentRemoval>;
  readonly nullifications: Map<string, PendingRelationNullification>;
}

export interface ApplicationRuntime {
  readonly now: () => string;
  readonly newId: (prefix: "doc" | "rev") => string;
}

export class DocumentApplicationService {
  public constructor(
    private readonly schemas: SchemaStore,
    private readonly documents: DocumentStore,
    private readonly runtime: ApplicationRuntime,
    private readonly relations?: RelationApplicationService,
    private readonly hooks?: DocumentLifecycleHookRunner,
  ) {}

  public async listCollections(actor: ActorContext): Promise<readonly CollectionDefinition[]> {
    await assertCapability(actor, "schema:read", { resourceId: "resource:schema" });
    const active = await this.schemas.getActiveSchema();
    return active?.schema.collections ?? [];
  }

  public async list(
    actor: ActorContext,
    collectionId: string,
    input: {
      readonly page?: number;
      readonly pageSize?: number;
      readonly state?: DocumentListState;
    } = {},
  ): Promise<DocumentPage> {
    const { collection } = await this.resolveCollection(collectionId);
    const resourceId = realmCollectionResourceId(actorRealmId(actor), String(collection.id));
    await assertCapability(actor, "document:read", {
      action: "content.list",
      resourceId,
    });
    const { page, pageSize } = pagination(input);
    const state = input.state ?? "active";
    if (state !== "active" && state !== "deleted") {
      throw new ApplicationError("INVALID_DOCUMENT_STATE", 400, "state must be 'active' or 'deleted'.");
    }
    if (state === "deleted") {
      await assertCapability(actor, "document:delete", {
        action: "content.delete",
        resourceId,
      });
    }
    const result = await this.documents.listDocuments(collection, { page, pageSize, state });
    const authorized = await Promise.all(result.items.map((document) =>
      this.readableDocumentOrNull(actor, authorizationResourceId(actor, collection, document.id), document)));
    const items = authorized.filter((document): document is DocumentRecord => document !== null);
    return {
      ...result,
      items,
      ...(items.length === result.items.length ? {} : { total: items.length }),
    };
  }

  public async query(
    actor: ActorContext,
    collectionId: string,
    input: DocumentQueryInput,
  ): Promise<DocumentQueryPage> {
    const { collection } = await this.resolveCollection(collectionId);
    const resourceId = realmCollectionResourceId(actorRealmId(actor), String(collection.id));
    await assertCapability(actor, "document:read", {
      action: "content.list",
      resourceId,
    });
    const query = normalizeDocumentQuery(collection, input);
    if (query.state === "deleted") {
      await assertCapability(actor, "document:delete", {
        action: "content.delete",
        resourceId,
      });
    }
    await this.assertReadableQueryFields(actor, collection, resourceId, query);
    const visible: { readonly document: DocumentRecord; readonly cursor: string }[] = [];
    const batchLimit = Math.min(100, Math.max(25, query.limit + 1));
    const maximumCandidates = 5_000;
    let scanned = 0;
    let current = normalizeDocumentQuery(collection, { ...input, limit: batchLimit });
    while (true) {
      const result = await this.documents.queryDocuments(collection, current);
      for (const candidate of result.items) {
        scanned += 1;
        const document = await this.readableDocumentOrNull(
          actor,
          authorizationResourceId(actor, collection, candidate.document.id),
          candidate.document,
        );
        if (document !== null) {
          visible.push({ document, cursor: candidate.cursor });
          if (visible.length > query.limit) {
            return {
              items: visible.slice(0, query.limit).map(({ document: item }) => item),
              hasNextPage: true,
              nextCursor: visible[query.limit - 1]!.cursor,
            };
          }
        }
      }
      if (!result.hasNextPage) {
        return {
          items: visible.map(({ document }) => document),
          hasNextPage: false,
        };
      }
      if (scanned >= maximumCandidates) {
        throw new ApplicationError(
          "DOCUMENT_QUERY_SCAN_LIMIT_EXCEEDED",
          503,
          `Document query scanned ${maximumCandidates} candidates without completing one visible page.`,
        );
      }
      const endCursor = result.items.at(-1)?.cursor;
      if (endCursor === undefined) {
        throw new ApplicationError(
          "DOCUMENT_QUERY_CURSOR_INVARIANT_VIOLATION",
          500,
          "Document query store reported another page without returning a candidate cursor.",
        );
      }
      current = normalizeDocumentQuery(collection, {
        ...input,
        cursor: endCursor,
        limit: batchLimit,
      });
    }
  }

  /**
   * Group-by aggregation (slG1). Aggregates over ONLY the documents the actor can
   * read: it scans the same authorized document stream `query` uses, then groups
   * and reduces in memory. This is why aggregation is NOT a raw DB `GROUP BY` — a
   * SQL-level count would include documents the actor cannot individually read and
   * leak their existence through counts/sums/group labels. Sensitive-Field
   * exclusion is enforced separately at the response boundary (the route).
   */
  public async aggregate(
    actor: ActorContext,
    collectionId: string,
    input: DocumentQueryInput,
  ): Promise<DocumentAggregateResult> {
    const { collection } = await this.resolveCollection(collectionId);
    const resourceId = realmCollectionResourceId(actorRealmId(actor), String(collection.id));
    await assertCapability(actor, "document:read", { action: "content.list", resourceId });
    const spec = normalizeDocumentAggregate(collection, input);
    if (spec.state === "deleted") {
      await assertCapability(actor, "document:delete", { action: "content.delete", resourceId });
    }
    const fieldNameById = new Map(collection.fields.map((field) => [String(field.id), field.name]));
    const groupKey = fieldAccessor(spec.groupBy, fieldNameById);
    const measureValue = spec.measure.op === "count"
      ? undefined
      : fieldAccessor(spec.measure.field, fieldNameById);

    // Accumulate per group: count + running sum (avg = sum/count at the end).
    const acc = new Map<string, { readonly group: DocumentQueryScalar; count: number; sum: number }>();
    let truncated = false;
    let scanned = 0;
    const batchLimit = 100;
    const maximumCandidates = 5_000;
    let current = normalizeDocumentQuery(collection, {
      ...(spec.filter === undefined ? {} : { filter: spec.filter }),
      state: spec.state,
      limit: batchLimit,
    });
    scan: while (true) {
      const result = await this.documents.queryDocuments(collection, current);
      for (const candidate of result.items) {
        scanned += 1;
        const document = await this.readableDocumentOrNull(
          actor,
          authorizationResourceId(actor, collection, candidate.document.id),
          candidate.document,
        );
        if (document !== null) accumulate(acc, spec.measure, groupKey(document), measureValue?.(document));
        if (scanned >= maximumCandidates) { truncated = true; break scan; }
      }
      if (!result.hasNextPage) break;
      const endCursor = result.items.at(-1)?.cursor;
      if (endCursor === undefined) break;
      current = normalizeDocumentQuery(collection, {
        ...(spec.filter === undefined ? {} : { filter: spec.filter }),
        state: spec.state,
        cursor: endCursor,
        limit: batchLimit,
      });
    }

    const groups = [...acc.values()]
      .map(({ group, count, sum }): DocumentAggregateGroup => ({
        group,
        value: spec.measure.op === "count" ? count
          : spec.measure.op === "sum" ? sum
            : count === 0 ? 0 : sum / count,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, spec.limit);
    return { groups, truncated: truncated || acc.size > spec.limit };
  }

  public async get(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
  ): Promise<DocumentRecord> {
    const { collection } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, true);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    const context = aggregateAuthorizationContext(actor, aggregate);
    await assertCapability(actor, "document:read", { resourceId, context });
    await assertDeletedReadCapability(actor, aggregate, resourceId);
    return this.readableDocument(actor, resourceId, aggregateToRecord(aggregate, actor));
  }

  public async listPublished(
    actor: ActorContext,
    collectionId: string,
    input: { readonly page?: number; readonly pageSize?: number } = {},
  ): Promise<PublishedDocumentPage> {
    const { collection } = await this.resolveCollection(collectionId);
    const resourceId = realmCollectionResourceId(actorRealmId(actor), String(collection.id));
    await assertCapability(actor, "document:read", {
      action: "content.list",
      resourceId,
    });
    const result = await this.documents.listPublishedDocuments(collection, pagination(input));
    const authorized = await Promise.all(result.items.map((document) =>
      this.readablePublishedDocumentOrNull(
        actor,
        authorizationResourceId(actor, collection, document.id),
        document,
      )));
    const items = authorized.filter((document): document is PublishedDocumentRecord => document !== null);
    return {
      ...result,
      items,
      ...(items.length === result.items.length ? {} : { total: items.length }),
    };
  }

  public async getPublished(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
  ): Promise<PublishedDocumentRecord> {
    const { collection } = await this.resolveCollection(collectionId);
    const document = await this.documents.getPublishedDocument(collection, documentId);
    if (document === null) {
      throw new ApplicationError("DOCUMENT_NOT_FOUND", 404, `Document '${documentId}' was not found.`);
    }
    return this.readablePublishedDocument(
      actor,
      authorizationResourceId(actor, collection, documentId),
      document,
    );
  }

  public async create(
    actor: ActorContext,
    collectionId: string,
    rawData: unknown,
    hierarchy?: {
      readonly parentId: string | null;
      readonly position: number;
      readonly expectedVersion: number;
    },
  ): Promise<DocumentRecord> {
    const { collection, schema } = await this.resolveCollection(collectionId);
    assertAuthCollectionLifecycle(collection, actor, "create");
    const realmId = actorRealmId(actor);
    const resourceId = collection.hierarchy?.permissionInheritance === true && hierarchy !== undefined && hierarchy.parentId !== null
      ? realmDocumentResourceId(realmId, hierarchy.parentId)
      : realmCollectionResourceId(realmId, String(collection.id));
    const context = authorizationContextForOwner(
      actor,
      { subjectId: actor.subjectId, realmId },
      "draft",
    );
    await assertCapability(actor, "document:create", { resourceId, context });
    await this.hooks?.run(documentHookContext(actor, {
      stage: "beforeValidate",
      operation: "create",
      collectionId: String(collection.id),
      data: rawData,
    }));
    const data = validateDocumentData(schema.schema, collection, rawData);
    await this.hooks?.run(documentHookContext(actor, {
      stage: "afterValidate",
      operation: "create",
      collectionId: String(collection.id),
      data,
    }));
    await actor.authorization?.assertWritableData({
      action: "content.create",
      resourceId,
      data,
      context,
    });
    await this.hooks?.run(documentHookContext(actor, {
      stage: "beforeCreate",
      operation: "create",
      collectionId: String(collection.id),
      data,
    }));
    const now = asUtcInstant(this.runtime.now());
    const result = createDocument({
      documentId: asDocumentId(this.runtime.newId("doc")),
      revisionId: asRevisionId(this.runtime.newId("rev")),
      workspaceId: asWorkspaceId(actor.workspaceId),
      collectionId: asCollectionId(collection.id),
      schemaRevisionId: asSchemaRevisionId(schema.revisionId),
      actorId: asSubjectId(actor.subjectId),
      now,
      data,
    });
    const response = await this.prepareReadableMutationResponse(
      actor,
      resourceId,
      aggregateToRecord(result.state, actor),
    );
    await this.documents.createDocument(
      result.state,
      collection,
      result.events,
      documentWriteIntegrity(collection, result.state.identity.id, data, hierarchy, true),
    );
    return response;
  }

  public async update(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    input: { readonly data: unknown; readonly expectedVersion: number },
  ): Promise<DocumentRecord> {
    const { collection, schema } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, false);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    const context = aggregateAuthorizationContext(actor, aggregate);
    await assertCapability(actor, "document:update", { resourceId, context });
    if (input.expectedVersion !== aggregate.aggregateVersion) {
      documentConflict(input.expectedVersion, aggregate.aggregateVersion);
    }
    await this.hooks?.run(documentHookContext(actor, {
      stage: "beforeValidate",
      operation: "update",
      collectionId: String(collection.id),
      documentId,
      data: input.data,
    }));
    const patch = documentPatch(input.data);
    assertAuthIdentifierPatch(collection, actor, patch);
    const data = validateDocumentData(schema.schema, collection, {
      ...getWorkingRevision(aggregate).data,
      ...patch,
    });
    await this.hooks?.run(documentHookContext(actor, {
      stage: "afterValidate",
      operation: "update",
      collectionId: String(collection.id),
      documentId,
      data,
    }));
    await actor.authorization?.assertWritableData({
      action: "content.update",
      resourceId,
      // PATCH authorization is evaluated only for explicitly supplied keys;
      // omitted (possibly hidden) fields are preserved by the merge above.
      data: patch,
      context,
    });
    await this.hooks?.run(documentHookContext(actor, {
      stage: "beforeUpdate",
      operation: "update",
      collectionId: String(collection.id),
      documentId,
      data,
    }));
    const result = createDraft(aggregate, {
      revisionId: asRevisionId(this.runtime.newId("rev")),
      schemaRevisionId: asSchemaRevisionId(schema.revisionId),
      actorId: asSubjectId(actor.subjectId),
      now: asUtcInstant(this.runtime.now()),
      expectedVersion: input.expectedVersion,
      data,
    });
    const response = await this.prepareReadableMutationResponse(
      actor,
      resourceId,
      aggregateToRecord(result.state, actor),
    );
    await this.documents.updateDocument(
      result.state,
      collection,
      input.expectedVersion,
      result.events,
      documentWriteIntegrity(collection, result.state.identity.id, data),
    );
    return response;
  }

  public async delete(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    expectedVersion: number,
  ): Promise<void> {
    const { collection } = await this.resolveCollection(collectionId);
    assertAuthCollectionLifecycle(collection, actor, "delete");
    const aggregate = await this.requireDocument(collection, documentId, false);
    await assertCapability(actor, "document:delete", {
      resourceId: authorizationResourceId(actor, collection, documentId),
      context: aggregateAuthorizationContext(actor, aggregate),
    });
    if (expectedVersion !== aggregate.aggregateVersion) {
      documentConflict(expectedVersion, aggregate.aggregateVersion);
    }
    await this.hooks?.run(documentHookContext(actor, {
      stage: "beforeDelete",
      operation: "delete",
      collectionId: String(collection.id),
      documentId,
    }));
    const result = softDeleteDocument(aggregate, {
      actorId: asSubjectId(actor.subjectId),
      now: asUtcInstant(this.runtime.now()),
      expectedVersion,
    });
    await this.documents.updateDocument(result.state, collection, expectedVersion, result.events);
  }

  public async publish(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const { collection } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, false);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    await assertCapability(actor, "document:publish", {
      action: "content.publish",
      resourceId,
      context: aggregateAuthorizationContext(actor, aggregate),
    });
    assertExpectedVersion(aggregate, expectedVersion);
    const result = executeDocumentCommand(() =>
      publishDocument(aggregate, commandMetadata(actor, this.runtime.now(), expectedVersion)),
    );
    const response = await this.prepareReadableMutationResponse(
      actor,
      resourceId,
      aggregateToRecord(result.state, actor),
    );
    await this.documents.updateDocument(result.state, collection, expectedVersion, result.events);
    return response;
  }

  public async unpublish(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const { collection } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, false);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    await assertCapability(actor, "document:publish", {
      action: "content.unpublish",
      resourceId,
      context: aggregateAuthorizationContext(actor, aggregate),
    });
    assertExpectedVersion(aggregate, expectedVersion);
    const result = executeDocumentCommand(() =>
      unpublishDocument(aggregate, commandMetadata(actor, this.runtime.now(), expectedVersion)),
    );
    const response = await this.prepareReadableMutationResponse(
      actor,
      resourceId,
      aggregateToRecord(result.state, actor),
    );
    await this.documents.updateDocument(result.state, collection, expectedVersion, result.events);
    return response;
  }

  public async listRevisions(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
  ): Promise<DocumentRevisionList> {
    const { collection } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, true);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    await assertCapability(actor, "document:read", {
      action: "content.revision.read",
      resourceId,
      context: aggregateAuthorizationContext(actor, aggregate),
    });
    await assertDeletedReadCapability(actor, aggregate, resourceId);
    return {
      items: [...aggregate.revisions].reverse().map((revision) => revisionSummary(aggregate, revision)),
      documentVersion: aggregate.aggregateVersion,
    };
  }

  public async getRevision(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    revisionId: string,
  ): Promise<DocumentRevisionDetail> {
    const { collection } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, true);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    const context = aggregateAuthorizationContext(actor, aggregate);
    await assertCapability(actor, "document:read", {
      action: "content.revision.read",
      resourceId,
      context,
    });
    await assertDeletedReadCapability(actor, aggregate, resourceId);
    const revision = findRevision(aggregate, asRevisionId(revisionId));
    if (revision === undefined) {
      throw new ApplicationError("DOCUMENT_REVISION_NOT_FOUND", 404, `Revision '${revisionId}' was not found.`);
    }
    const data = actor.authorization === undefined
      ? revision.data
      : await actor.authorization.filterReadableData({
          action: "content.revision.read",
          resourceId,
          data: revision.data,
          context,
        });
    return { ...revisionSummary(aggregate, revision), data };
  }

  public async restoreRevision(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const { collection, schema } = await this.resolveCollection(collectionId);
    const aggregate = await this.requireDocument(collection, documentId, false);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    const context = aggregateAuthorizationContext(actor, aggregate);
    await assertCapability(actor, "document:publish", {
      action: "content.revision.restore",
      resourceId,
      context,
    });
    assertExpectedVersion(aggregate, expectedVersion);
    const source = findRevision(aggregate, asRevisionId(revisionId));
    if (source === undefined) {
      throw new ApplicationError("DOCUMENT_REVISION_NOT_FOUND", 404, `Revision '${revisionId}' was not found.`);
    }
    assertAuthIdentifierRestore(collection, actor, getWorkingRevision(aggregate).data, source.data);
    const restoredData = validateRestoredRevisionData(schema.schema, collection, source.data);
    await actor.authorization?.assertWritableData({
      action: "content.revision.restore",
      resourceId,
      data: restoredData,
      context,
    });
    const result = executeDocumentCommand(() =>
      restoreRevision(aggregate, {
        ...commandMetadata(actor, this.runtime.now(), expectedVersion),
        sourceRevisionId: source.id,
        newRevisionId: asRevisionId(this.runtime.newId("rev")),
        schemaRevisionId: asSchemaRevisionId(schema.revisionId),
        restoredData,
      }),
    );
    const response = await this.prepareReadableMutationResponse(
      actor,
      resourceId,
      aggregateToRecord(result.state, actor),
    );
    await this.documents.updateDocument(
      result.state,
      collection,
      expectedVersion,
      result.events,
      documentWriteIntegrity(collection, result.state.identity.id, restoredData),
    );
    return response;
  }

  public async restoreDeleted(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const { collection } = await this.resolveCollection(collectionId);
    assertAuthCollectionLifecycle(collection, actor, "restore");
    const aggregate = await this.requireDocument(collection, documentId, true);
    const resourceId = authorizationResourceId(actor, collection, documentId);
    await assertCapability(actor, "document:delete", {
      action: "content.restore",
      resourceId,
      context: aggregateAuthorizationContext(actor, aggregate),
    });
    assertExpectedVersion(aggregate, expectedVersion);
    const result = executeDocumentCommand(() =>
      restoreDeletedDocument(aggregate, commandMetadata(actor, this.runtime.now(), expectedVersion)),
    );
    const response = await this.prepareReadableMutationResponse(
      actor,
      resourceId,
      aggregateToRecord(result.state, actor),
    );
    await this.documents.updateDocument(result.state, collection, expectedVersion, result.events);
    return response;
  }

  public async purge(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    expectedVersion: number,
    hooks: { readonly beforeCommit?: () => Promise<void> } = {},
  ): Promise<void> {
    const preparation: HardPurgePreparation = {
      visiting: new Set(),
      completed: new Set(),
      removals: new Map(),
      nullifications: new Map(),
    };
    await this.prepareHardPurge(
      actor,
      collectionId,
      documentId,
      expectedVersion,
      false,
      preparation,
    );

    const updates: HardPurgeDocumentUpdate[] = [];
    for (const [sourceDocumentId, pending] of preparation.nullifications) {
      if (preparation.removals.has(sourceDocumentId)) continue;
      const resourceId = authorizationResourceId(actor, pending.collection, sourceDocumentId);
      const context = aggregateAuthorizationContext(actor, pending.aggregate);
      await assertCapability(actor, "document:update", { resourceId, context });
      const data = validateDocumentData(pending.schema.schema, pending.collection, pending.data);
      await actor.authorization?.assertWritableData({
        action: "content.update",
        resourceId,
        data,
        context,
      });
      const result = executeDocumentCommand(() => createDraft(pending.aggregate, {
        revisionId: asRevisionId(this.runtime.newId("rev")),
        schemaRevisionId: asSchemaRevisionId(pending.schema.revisionId),
        actorId: asSubjectId(actor.subjectId),
        now: asUtcInstant(this.runtime.now()),
        expectedVersion: pending.aggregate.aggregateVersion,
        data,
      }));
      updates.push({
        aggregate: result.state,
        collection: pending.collection,
        expectedVersion: pending.aggregate.aggregateVersion,
        events: result.events,
        integrity: documentWriteIntegrity(
          pending.collection,
          result.state.identity.id,
          data,
        ),
      });
    }

    await hooks.beforeCommit?.();
    await this.documents.executeHardPurge({
      updates,
      removals: [...preparation.removals.values()],
    });
  }

  private async prepareHardPurge(
    actor: ActorContext,
    collectionId: string,
    documentId: string,
    expectedVersion: number,
    allowCascadeSoftDelete: boolean,
    preparation: HardPurgePreparation,
  ): Promise<void> {
    if (preparation.visiting.has(documentId)) {
      throw new ApplicationError(
        "RELATION_CASCADE_CYCLE",
        409,
        `Cascade purge contains a cycle at document '${documentId}'.`,
      );
    }
    if (preparation.completed.has(documentId)) return;
    preparation.visiting.add(documentId);
    const { collection } = await this.resolveCollection(collectionId);
    assertAuthCollectionLifecycle(collection, actor, "purge");
    const aggregate = await this.requireDocument(collection, documentId, true);
    await assertCapability(actor, "document:purge", {
      action: "content.purge",
      resourceId: authorizationResourceId(actor, collection, documentId),
      context: aggregateAuthorizationContext(actor, aggregate),
    });
    assertExpectedVersion(aggregate, expectedVersion);
    let removalAggregate = aggregate;
    const removalEvents: PersistedDocumentEvent[] = [];
    if (removalAggregate.identity.deletion === null && !allowCascadeSoftDelete) {
      throw new ApplicationError("DOCUMENT_NOT_DELETED", 409, "A document must be soft-deleted before purge.");
    }
    if (removalAggregate.identity.deletion === null) {
      await assertCapability(actor, "document:delete", {
        resourceId: authorizationResourceId(actor, collection, documentId),
        context: aggregateAuthorizationContext(actor, removalAggregate),
      });
      const deleted = executeDocumentCommand(() => softDeleteDocument(removalAggregate, {
        actorId: asSubjectId(actor.subjectId),
        now: asUtcInstant(this.runtime.now()),
        expectedVersion: removalAggregate.aggregateVersion,
      }));
      removalAggregate = deleted.state;
      removalEvents.push(...deleted.events);
    }

    // Mark the document before traversing cascades. Nullifications originating
    // from a document that is itself removed are unnecessary and are discarded.
    preparation.removals.set(documentId, {
      aggregate: removalAggregate,
      collection,
      expectedVersion,
      events: removalEvents,
    });
    preparation.nullifications.delete(documentId);

    if (this.relations !== undefined) {
      const plan = await this.relations.planTargetDeletion({
        targetCollectionId: String(collection.id),
        targetDocumentId: documentId,
      });
      const restrictedBy = plan.restrictedBy.filter(
        (edge) => !preparation.removals.has(String(edge.sourceDocumentId)),
      );
      if (restrictedBy.length > 0) {
        throw new ApplicationError(
          "RELATION_DELETE_RESTRICTED",
          409,
          `Document '${documentId}' is referenced by ${restrictedBy.length} restricted relation(s).`,
          { details: { restrictedBy } },
        );
      }
      for (const nullification of plan.nullifications) {
        const key = String(nullification.sourceDocumentId);
        if (preparation.removals.has(key)) continue;
        let pending = preparation.nullifications.get(key);
        if (pending === undefined) {
          const { collection: sourceCollection, schema } = await this.resolveCollection(
            String(nullification.sourceCollectionId),
          );
          const sourceAggregate = await this.documents.loadDocument(key);
          if (
            sourceAggregate === null ||
            String(sourceAggregate.identity.collectionId) !== String(sourceCollection.id) ||
            sourceAggregate.identity.deletion !== null
          ) {
            throw new ApplicationError(
              "RELATION_NULLIFY_SOURCE_UNAVAILABLE",
              409,
              `Relation source '${key}' must be active before it can be nullified.`,
            );
          }
          pending = {
            aggregate: sourceAggregate,
            collection: sourceCollection,
            schema,
            data: { ...getWorkingRevision(sourceAggregate).data },
          };
          preparation.nullifications.set(key, pending);
        }
        applyRelationNullification(
          pending.data,
          nullification.fieldName,
          nullification.nextValue,
        );
      }
      for (const cascade of plan.cascades) {
        const sourceId = String(cascade.documentId);
        if (preparation.completed.has(sourceId)) continue;
        const sourceAggregate = await this.documents.loadDocument(sourceId);
        if (sourceAggregate === null) continue;
        await this.prepareHardPurge(
          actor,
          String(cascade.collectionId),
          sourceId,
          sourceAggregate.aggregateVersion,
          true,
          preparation,
        );
      }
    }
    const removal = preparation.removals.get(documentId);
    if (removal === undefined) {
      throw new ApplicationError("DOCUMENT_PURGE_PLAN_INVALID", 500, "Hard purge plan lost its target.");
    }
    preparation.removals.set(documentId, {
      ...removal,
      events: [
        ...removal.events,
        {
          type: "document.purged",
          documentId: removal.aggregate.identity.id,
          actorId: actor.subjectId,
          occurredAt: this.runtime.now(),
          aggregateVersion: removal.aggregate.aggregateVersion,
        },
      ],
    });
    preparation.visiting.delete(documentId);
    preparation.completed.add(documentId);
  }

  private async resolveCollection(
    collectionIdOrName: string,
  ): Promise<{ readonly collection: CollectionDefinition; readonly schema: SchemaRevisionRecord }> {
    const schema = await this.schemas.getActiveSchema();
    if (schema === null) {
      throw new ApplicationError("COLLECTION_NOT_FOUND", 404, "No active schema exists.");
    }
    const collection = schema.schema.collections.find(
      ({ id, name }) => id === collectionIdOrName || name === collectionIdOrName,
    );
    if (collection === undefined) {
      throw new ApplicationError(
        "COLLECTION_NOT_FOUND",
        404,
        `Collection '${collectionIdOrName}' does not exist in the active schema.`,
      );
    }
    return { collection, schema };
  }

  private async requireDocument(
    collection: CollectionDefinition,
    documentId: string,
    includeDeleted: boolean,
  ): Promise<DocumentAggregate> {
    const aggregate = await this.documents.loadDocument(documentId);
    if (
      aggregate === null ||
      String(aggregate.identity.collectionId) !== String(collection.id) ||
      (!includeDeleted && aggregate.identity.deletion !== null)
    ) {
      throw new ApplicationError("DOCUMENT_NOT_FOUND", 404, `Document '${documentId}' was not found.`);
    }
    return aggregate;
  }

  private async readableDocument(
    actor: ActorContext,
    resourceId: string,
    document: DocumentRecord,
  ): Promise<DocumentRecord> {
    if (actor.authorization === undefined) return document;
    const data = await actor.authorization.filterReadableData({
      resourceId,
      data: document.data,
      context: recordAuthorizationContext(actor, document),
    });
    return { ...document, data };
  }

  private async assertReadableQueryFields(
    actor: ActorContext,
    collection: CollectionDefinition,
    resourceId: string,
    query: NormalizedDocumentQuery,
  ): Promise<void> {
    if (actor.authorization === undefined) return;
    const fieldById = new Map(collection.fields.map((field) => [String(field.id), field]));
    const fieldNames = new Set<string>();
    const addReference = (reference: NormalizedDocumentQuery["sort"][number]["field"]): void => {
      if (reference.kind !== "data") return;
      fieldNames.add(fieldById.get(reference.fieldId)!.name);
    };
    query.sort.forEach(({ field }) => addReference(field));
    const visit = (filter: NonNullable<NormalizedDocumentQuery["filter"]>): void => {
      if (filter.type === "condition") {
        addReference(filter.field);
        return;
      }
      filter.filters.forEach(visit);
    };
    if (query.filter !== undefined) visit(query.filter);
    if (fieldNames.size === 0) return;
    const probe = Object.fromEntries([...fieldNames].map((field) => [field, true]));
    const readable = await actor.authorization.filterReadableData({
      resourceId,
      data: probe,
      action: "content.read",
    });
    const denied = [...fieldNames].filter((field) => !(field in readable));
    if (denied.length > 0) {
      throw new ApplicationError(
        "DOCUMENT_QUERY_FIELD_FORBIDDEN",
        403,
        `Document query cannot filter or sort by unreadable fields: ${denied.join(", ")}.`,
      );
    }
  }

  private async prepareReadableMutationResponse(
    actor: ActorContext,
    resourceId: string,
    document: DocumentRecord,
  ): Promise<DocumentRecord> {
    await assertCapability(actor, "document:read", {
      action: "content.read",
      resourceId,
      context: recordAuthorizationContext(actor, document),
    });
    return this.readableDocument(actor, resourceId, document);
  }

  private async readableDocumentOrNull(
    actor: ActorContext,
    resourceId: string,
    document: DocumentRecord,
  ): Promise<DocumentRecord | null> {
    try {
      return await this.readableDocument(actor, resourceId, document);
    } catch (error: unknown) {
      if (isAccessDenied(error)) return null;
      throw error;
    }
  }

  private async readablePublishedDocument(
    actor: ActorContext,
    resourceId: string,
    document: PublishedDocumentRecord,
  ): Promise<PublishedDocumentRecord> {
    if (actor.authorization === undefined) return document;
    const context = authorizationContextForOwner(
      actor,
      {
        subjectId: document.ownerSubjectId,
        ...(document.ownerRealmId === undefined ? {} : { realmId: document.ownerRealmId }),
      },
      "published",
    );
    const data = await actor.authorization.filterReadableData({ resourceId, data: document.data, context });
    return { ...document, data };
  }

  private async readablePublishedDocumentOrNull(
    actor: ActorContext,
    resourceId: string,
    document: PublishedDocumentRecord,
  ): Promise<PublishedDocumentRecord | null> {
    try {
      return await this.readablePublishedDocument(actor, resourceId, document);
    } catch (error: unknown) {
      if (isAccessDenied(error)) return null;
      throw error;
    }
  }
}

export function validateDocumentData(
  schema: SchemaIrV1,
  collection: CollectionDefinition,
  rawData: unknown,
): JsonObject {
  try {
    return decodeCollectionData(schema, String(collection.id), rawData) as JsonObject;
  } catch (error: unknown) {
    if (error instanceof ContentValidationError) {
      throw new ApplicationError(
        "DOCUMENT_VALIDATION_FAILED",
        422,
        "Document validation failed.",
        {
          issues: error.issues.map(({ code, message, path }) => ({ code, message, path })),
        },
      );
    }
    throw error;
  }
}

function assertAuthCollectionLifecycle(
  collection: CollectionDefinition,
  actor: ActorContext,
  operation: "create" | "delete" | "restore" | "purge",
): void {
  if (collection.auth === undefined || actor.execution === "identity-provisioning") return;
  throw new ApplicationError(
    "AUTH_COLLECTION_ACCOUNT_OPERATION_REQUIRED",
    409,
    `Auth collection '${collection.name}' ${operation} must use the Identity Realm account workflow.`,
  );
}

function assertAuthIdentifierPatch(
  collection: CollectionDefinition,
  actor: ActorContext,
  patch: Readonly<Record<string, unknown>>,
): void {
  if (collection.auth === undefined || actor.execution === "identity-provisioning") return;
  if (!authIdentifierFieldNames(collection).some(
    (name) => Object.prototype.hasOwnProperty.call(patch, name),
  )) return;
  throw new ApplicationError(
    "AUTH_IDENTIFIER_UPDATE_REQUIRES_ACCOUNT_WORKFLOW",
    409,
    "Login identifiers must be changed through a reauthenticated Identity Realm account workflow.",
  );
}

function assertAuthIdentifierRestore(
  collection: CollectionDefinition,
  actor: ActorContext,
  current: Readonly<Record<string, unknown>>,
  restored: Readonly<Record<string, unknown>>,
): void {
  if (collection.auth === undefined || actor.execution === "identity-provisioning") return;
  if (!authIdentifierFieldNames(collection).some((name) => current[name] !== restored[name])) return;
  throw new ApplicationError(
    "AUTH_IDENTIFIER_UPDATE_REQUIRES_ACCOUNT_WORKFLOW",
    409,
    "A revision that changes a login identifier cannot be restored outside the account workflow.",
  );
}

function authIdentifierFieldNames(collection: CollectionDefinition): readonly string[] {
  const identifiers = new Set(collection.auth?.identifierFieldIds ?? []);
  return collection.fields
    .filter(({ id }) => identifiers.has(id))
    .map(({ name }) => name);
}

function documentPatch(rawData: unknown): Readonly<Record<string, unknown>> {
  if (rawData === null || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new ApplicationError(
      "DOCUMENT_PATCH_INVALID",
      400,
      "Document PATCH data must be an object.",
    );
  }
  return rawData as Readonly<Record<string, unknown>>;
}

function applyRelationNullification(
  data: Record<string, JsonValue>,
  fieldName: string,
  nextValue: string | readonly string[] | null,
): void {
  if (nextValue === null) {
    delete data[fieldName];
    return;
  }
  if (!Array.isArray(nextValue)) {
    data[fieldName] = nextValue;
    return;
  }
  const current = data[fieldName];
  if (!Array.isArray(current)) {
    data[fieldName] = [...nextValue];
    return;
  }
  const remaining = new Set(nextValue);
  data[fieldName] = current.filter((entry) => {
    if (typeof entry === "string") return remaining.has(entry);
    if (isPlainObject(entry) && typeof entry["documentId"] === "string") {
      return remaining.has(entry["documentId"]);
    }
    return false;
  });
}

function documentWriteIntegrity(
  collection: CollectionDefinition,
  documentId: DocumentId,
  data: JsonObject,
  hierarchy?: {
    readonly parentId: string | null;
    readonly position: number;
    readonly expectedVersion: number;
  },
  requireHierarchyPlacement = false,
): DocumentWriteIntegrity {
  if (requireHierarchyPlacement && collection.hierarchy?.enabled === true && hierarchy === undefined) {
    throw new ApplicationError(
      "HIERARCHY_PLACEMENT_REQUIRED",
      422,
      "A parent, sibling position, and observed tree version are required for this collection.",
    );
  }
  if (collection.hierarchy?.enabled !== true && hierarchy !== undefined) {
    throw new ApplicationError(
      "HIERARCHY_NOT_ENABLED",
      422,
      `Collection '${collection.name}' does not enable hierarchy.`,
    );
  }
  if (hierarchy !== undefined && (
    !Number.isSafeInteger(hierarchy.position) || hierarchy.position < 0 ||
    !Number.isSafeInteger(hierarchy.expectedVersion) || hierarchy.expectedVersion < 0
  )) {
    throw new ApplicationError(
      "HIERARCHY_PLACEMENT_INVALID",
      422,
      "Hierarchy position and expectedVersion must be non-negative safe integers.",
    );
  }

  try {
    const relationEdges = extractDocumentRelations({
      collectionId: asCollectionId(collection.id),
      documentId,
      data,
      fields: relationContractsForCollection(collection),
    });
    const mediaReferences: DocumentMediaReferenceInput[] = [];
    for (const field of collection.fields) {
      if (field.type !== "upload") continue;
      const value = data[field.name];
      const values = value === undefined || value === null
        ? []
        : field.multiple === true
          ? Array.isArray(value) ? value : [value]
          : [value];
      values.forEach((entry, ordinal) => {
        const mediaId = typeof entry === "string"
          ? entry
          : isPlainObject(entry) && typeof entry["mediaId"] === "string"
            ? entry["mediaId"]
            : null;
        if (mediaId === null) {
          throw new ApplicationError(
            "MEDIA_REFERENCE_INVALID",
            422,
            `Upload field '${field.name}' contains an invalid media reference.`,
          );
        }
        mediaReferences.push({
          fieldName: field.name,
          mediaId,
          ordinal,
          ...(field.acceptedMimeTypes === undefined
            ? {}
            : { acceptedMimeTypes: Object.freeze([...field.acceptedMimeTypes]) }),
        });
      });
    }
    return {
      relationEdges,
      mediaReferences: Object.freeze(mediaReferences),
      ...(hierarchy === undefined ? {} : {
        hierarchy: {
          parentId: hierarchy.parentId === null ? null : asDocumentId(hierarchy.parentId),
          position: hierarchy.position,
          expectedVersion: hierarchy.expectedVersion,
        },
      }),
    };
  } catch (error: unknown) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      const details = "details" in error ? error.details : undefined;
      throw new ApplicationError(error.code, 422, error.message, { details });
    }
    throw error;
  }
}

/** Builds a reader for a Field/system reference over an authorized DocumentRecord (slG1). */
function fieldAccessor(
  reference: DocumentQueryFieldReference,
  fieldNameById: ReadonlyMap<string, string>,
): (document: DocumentRecord) => DocumentQueryScalar {
  if (reference.kind === "system") {
    const field = reference.field;
    return (document) => {
      const value = field === "id" ? document.id
        : field === "createdAt" ? document.createdAt
          : field === "updatedAt" ? document.updatedAt
            : document.version;
      return scalarOrNull(value);
    };
  }
  const name = fieldNameById.get(reference.fieldId);
  return (document) => (name === undefined ? null : scalarOrNull(document.data[name]));
}

function scalarOrNull(value: unknown): DocumentQueryScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return value === undefined ? null : String(value);
}

/** Folds one document into the group accumulator (slG1). */
function accumulate(
  acc: Map<string, { readonly group: DocumentQueryScalar; count: number; sum: number }>,
  measure: DocumentQueryMeasure,
  group: DocumentQueryScalar,
  measureValue: DocumentQueryScalar | undefined,
): void {
  const key = group === null ? " null" : `${typeof group}:${String(group)}`;
  const entry = acc.get(key) ?? { group, count: 0, sum: 0 };
  entry.count += 1;
  if (measure.op !== "count" && typeof measureValue === "number" && Number.isFinite(measureValue)) {
    entry.sum += measureValue;
  }
  acc.set(key, entry);
}

function aggregateToRecord(aggregate: DocumentAggregate, actor: ActorContext): DocumentRecord {
  const revision = getWorkingRevision(aggregate);
  const ownerRealmId = knownOwnerRealmId(actor, aggregate.identity.createdBy);
  return {
    id: aggregate.identity.id,
    collectionId: aggregate.identity.collectionId,
    data: revision.data,
    version: aggregate.aggregateVersion,
    createdAt: aggregate.identity.createdAt,
    updatedAt: aggregate.identity.updatedAt,
    ownerSubjectId: aggregate.identity.createdBy,
    ...(ownerRealmId === undefined ? {} : { ownerRealmId }),
    displayState: getDisplayState(aggregate),
    draftRevisionId: aggregate.identity.currentDraftRevisionId,
    publication: aggregate.identity.publication,
    deletion: aggregate.identity.deletion,
  };
}

function revisionSummary(
  aggregate: DocumentAggregate,
  revision: DocumentRevision,
): DocumentRevisionSummary {
  return {
    id: revision.id,
    sequence: revision.sequence,
    schemaRevisionId: revision.schemaRevisionId,
    origin: revision.origin,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
    isCurrentDraft: aggregate.identity.currentDraftRevisionId === revision.id,
    isPublished: aggregate.identity.publication?.revisionId === revision.id,
  };
}

function pagination(input: {
  readonly page?: number;
  readonly pageSize?: number;
}): { readonly page: number; readonly pageSize: number } {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new ApplicationError(
      "INVALID_PAGINATION",
      400,
      "page must be at least 1 and pageSize must be between 1 and 100.",
    );
  }
  return { page, pageSize };
}

function assertExpectedVersion(aggregate: DocumentAggregate, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApplicationError("DOCUMENT_VERSION_INVALID", 400, "expectedVersion must be a positive integer.");
  }
  if (aggregate.aggregateVersion !== expectedVersion) {
    documentConflict(expectedVersion, aggregate.aggregateVersion);
  }
}

function authorizationResourceId(
  actor: ActorContext,
  collection: CollectionDefinition,
  documentId: string,
): string {
  const realmId = actorRealmId(actor);
  return collection.hierarchy?.permissionInheritance === true
    ? realmDocumentResourceId(realmId, documentId)
    : realmCollectionResourceId(realmId, String(collection.id));
}

async function assertDeletedReadCapability(
  actor: ActorContext,
  aggregate: DocumentAggregate,
  resourceId: string,
): Promise<void> {
  if (aggregate.identity.deletion !== null) {
    await assertCapability(actor, "document:delete", {
      action: "content.delete",
      resourceId,
      context: aggregateAuthorizationContext(actor, aggregate),
    });
  }
}

function aggregateAuthorizationContext(actor: ActorContext, aggregate: DocumentAggregate) {
  const ownerRealmId = knownOwnerRealmId(actor, aggregate.identity.createdBy);
  return authorizationContextForOwner(
    actor,
    {
      subjectId: aggregate.identity.createdBy,
      ...(ownerRealmId === undefined ? {} : { realmId: ownerRealmId }),
    },
    getDisplayState(aggregate),
  );
}

function recordAuthorizationContext(actor: ActorContext, document: DocumentRecord) {
  return authorizationContextForOwner(
    actor,
    {
      subjectId: document.ownerSubjectId,
      ...(document.ownerRealmId === undefined ? {} : { realmId: document.ownerRealmId }),
    },
    document.displayState,
  );
}

function knownOwnerRealmId(actor: ActorContext, ownerSubjectId: string): string | undefined {
  const realmId = actorRealmId(actor);
  return realmId === SYSTEM_ACTOR_REALM_ID || ownerSubjectId === actor.subjectId
    ? realmId
    : undefined;
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof ApplicationError && error.status === 403;
}

function commandMetadata(actor: ActorContext, now: string, expectedVersion: number) {
  return {
    actorId: asSubjectId(actor.subjectId),
    now: asUtcInstant(now),
    expectedVersion,
  } as const;
}

function executeDocumentCommand<TResult>(command: () => TResult): TResult {
  try {
    return command();
  } catch (error: unknown) {
    if (!(error instanceof DocumentDomainError)) {
      throw error;
    }
    const status = error.code === "DOCUMENT_REVISION_NOT_FOUND"
      ? 404
      : error.code === "DOCUMENT_DATA_NOT_JSON" ||
          error.code === "DOCUMENT_RELATION_INVALID" ||
          error.code === "DOCUMENT_RELATION_REVISION_FORBIDDEN"
        ? 422
        : 409;
    throw new ApplicationError(error.code, status, error.message, {
      details: error.details,
    });
  }
}

function validateRestoredRevisionData(
  schema: SchemaIrV1,
  collection: CollectionDefinition,
  data: JsonObject,
): JsonObject {
  try {
    return validateDocumentData(schema, collection, data);
  } catch (error: unknown) {
    if (error instanceof ApplicationError && error.status === 422) {
      throw new ApplicationError(
        "REVISION_RESTORE_SCHEMA_INCOMPATIBLE",
        422,
        "The revision does not satisfy the active collection schema.",
        error.options,
      );
    }
    throw error;
  }
}

function documentConflict(expectedVersion: number, actualVersion: number): never {
  throw new ApplicationError(
    "DOCUMENT_VERSION_CONFLICT",
    409,
    "The document was changed by another request.",
    { details: { expectedVersion, actualVersion } },
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidType(
  issues: Array<{ code: string; message: string; path: readonly (string | number)[] }>,
  field: string,
  expected: string,
): void {
  issues.push({
    code: "FIELD_TYPE_INVALID",
    message: `Field '${field}' must be a ${expected}.`,
    path: ["data", field],
  });
}

function invalidRange(
  issues: Array<{ code: string; message: string; path: readonly (string | number)[] }>,
  field: string,
  expected: string,
): void {
  issues.push({
    code: "FIELD_RANGE_INVALID",
    message: `Field '${field}' must contain ${expected}.`,
    path: ["data", field],
  });
}

function isDateTimeWithZone(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function findCollection(schema: SchemaIrV1, collectionIdOrName: string): CollectionDefinition | undefined {
  return schema.collections.find(({ id, name }) => id === collectionIdOrName || name === collectionIdOrName);
}
