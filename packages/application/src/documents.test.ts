import {
  getDisplayState,
  getPublicRevision,
  getWorkingRevision,
  type DocumentAggregate,
} from "@xecms/core";
import {
  asCollectionId,
  asFieldId,
  type CollectionDefinition,
  type SchemaIrV1,
} from "@xecms/schema";
import { describe, expect, it } from "vitest";

import {
  DocumentApplicationService,
  type DocumentListState,
  type DocumentPage,
  type DocumentQueryStorePage,
  type DocumentRecord,
  type DocumentStore,
  type PersistedDocumentEvent,
  type PublishedDocumentPage,
  type PublishedDocumentRecord,
} from "./documents.js";
import {
  encodeDocumentQueryCursor,
  type DocumentQueryScalar,
  type NormalizedDocumentQuery,
} from "./document-query.js";
import {
  ApplicationError,
  type ActorContext,
  type AuthorizationObjectContext,
} from "./errors.js";
import type { SchemaRevisionRecord, SchemaStore } from "./schema.js";
import { DocumentLifecycleHookRegistry } from "./hooks.js";

const baseCollection: CollectionDefinition = {
  id: asCollectionId("col_posts"),
  name: "posts",
  fields: [{ id: asFieldId("fld_title"), name: "title", type: "text", required: true }],
};

const authCollection: CollectionDefinition = {
  id: asCollectionId("col_members"),
  name: "members",
  fields: [
    {
      id: asFieldId("fld_email"),
      name: "email",
      type: "text",
      required: true,
      unique: true,
    },
    {
      id: asFieldId("fld_display_name"),
      name: "displayName",
      type: "text",
      required: true,
    },
  ],
  auth: {
    enabled: true,
    realmKey: "community",
    identifierFieldIds: [asFieldId("fld_email")],
    acceptSystemIdentities: true,
    provisioning: "explicit",
    defaultRoleIds: [],
  },
};

const actor: ActorContext = {
  subjectId: "subject_owner",
  workspaceId: "wrk_default",
  capabilities: [
    "document:read",
    "document:create",
    "document:update",
    "document:delete",
    "document:publish",
    "document:purge",
  ],
};

describe("DocumentApplicationService lifecycle", () => {
  it("runs lifecycle hooks in order and never commits when a hook rejects", async () => {
    const schemaFixture = mutableSchema(baseCollection);
    const store = new MemoryDocumentStore();
    const hooks = new DocumentLifecycleHookRegistry();
    const stages: string[] = [];
    hooks.register({
      id: "observe",
      priority: -10,
      stages: ["beforeValidate", "afterValidate", "beforeCreate"],
      run: ({ stage }) => { stages.push(stage); },
    });
    hooks.register({
      id: "reject-create",
      stages: ["beforeCreate"],
      run: () => { throw new ApplicationError("HOOK_REJECTED", 422, "blocked by policy"); },
    });
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime(), undefined, hooks);

    await expect(service.create(actor, "posts", { title: "Rejected" })).rejects.toMatchObject({
      code: "HOOK_REJECTED",
      status: 422,
    });
    expect(stages).toEqual(["beforeValidate", "afterValidate", "beforeCreate"]);
    expect(store.aggregates.size).toBe(0);
    expect(store.events).toEqual([]);
  });

  it("keeps public content pinned while drafts, history, trash, restore, and purge progress", async () => {
    const schemaFixture = mutableSchema(baseCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());

    const created = await service.create(actor, "posts", { title: "Published v1" });
    expect(created).toMatchObject({ version: 1, displayState: "draft", draftRevisionId: "rev_1" });
    await expect(service.getPublished(actor, "posts", created.id)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
    });

    const published = await service.publish(actor, "posts", created.id, 1);
    expect(published).toMatchObject({
      version: 2,
      displayState: "published",
      draftRevisionId: null,
      publication: { revisionId: "rev_1" },
    });
    const publicBeforeDraft = await service.getPublished(actor, "posts", created.id);

    const edited = await service.update(actor, "posts", created.id, {
      expectedVersion: 2,
      data: { title: "Unpublished v2" },
    });
    expect(edited).toMatchObject({ version: 3, displayState: "published-with-draft" });
    const publicAfterDraft = await service.getPublished(actor, "posts", created.id);
    expect(publicAfterDraft.data).toEqual({ title: "Published v1" });
    expect(publicAfterDraft.updatedAt).toBe(publicBeforeDraft.updatedAt);

    const history = await service.listRevisions(actor, "posts", created.id);
    expect(history.documentVersion).toBe(3);
    expect(history.items.map(({ id }) => id)).toEqual(["rev_2", "rev_1"]);
    expect(history.items[0]).toMatchObject({ isCurrentDraft: true, isPublished: false });
    expect(history.items[1]).toMatchObject({ isCurrentDraft: false, isPublished: true });

    const restored = await service.restoreRevision(actor, "posts", created.id, "rev_1", 3);
    expect(restored).toMatchObject({
      version: 4,
      displayState: "published-with-draft",
      data: { title: "Published v1" },
    });
    expect((await service.getPublished(actor, "posts", created.id)).revisionId).toBe("rev_1");

    await service.delete(actor, "posts", created.id, 4);
    expect((await service.list(actor, "posts", { state: "active" })).total).toBe(0);
    const trash = await service.list(actor, "posts", { state: "deleted" });
    expect(trash.items[0]).toMatchObject({ version: 5, displayState: "deleted" });
    await expect(service.getPublished(actor, "posts", created.id)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
    });

    const undeleted = await service.restoreDeleted(actor, "posts", created.id, 5);
    expect(undeleted).toMatchObject({ version: 6, displayState: "published-with-draft" });
    await service.delete(actor, "posts", created.id, 6);
    await service.purge(actor, "posts", created.id, 7);
    expect(await store.loadDocument(created.id)).toBeNull();
    expect(store.events.map(({ type }) => type)).toEqual([
      "document.created",
      "document.published",
      "document.draft-created",
      "document.revision-restored",
      "document.deleted",
      "document.restored",
      "document.deleted",
      "document.purged",
    ]);
  });

  it("rejects restoring old data that no longer satisfies the active schema", async () => {
    const schemaFixture = mutableSchema(baseCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const created = await service.create(actor, "posts", { title: "Legacy" });

    schemaFixture.setCollection({
      ...baseCollection,
      fields: [
        ...baseCollection.fields,
        { id: asFieldId("fld_summary"), name: "summary", type: "text", required: true },
      ],
    });

    await expect(
      service.restoreRevision(actor, "posts", created.id, "rev_1", 1),
    ).rejects.toMatchObject({
      code: "REVISION_RESTORE_SCHEMA_INCOMPATIBLE",
      status: 422,
    });
  });

  it("requires the explicit publish capability", async () => {
    const schemaFixture = mutableSchema(baseCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const created = await service.create(actor, "posts", { title: "Draft" });
    const reader = { ...actor, capabilities: ["document:read"] as const };

    await expect(service.publish(reader, "posts", created.id, 1)).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      status: 403,
    });
  });

  it("requires delete capability in addition to read capability for trash data", async () => {
    const schemaFixture = mutableSchema(baseCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const created = await service.create(actor, "posts", { title: "Deleted" });
    await service.delete(actor, "posts", created.id, 1);
    const reader = { ...actor, capabilities: ["document:read"] as const };

    await expect(service.list(reader, "posts", { state: "deleted" })).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      status: 403,
    });
    await expect(service.get(reader, "posts", created.id)).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      status: 403,
    });
    await expect(service.listRevisions(reader, "posts", created.id)).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      status: 403,
    });
  });

  it("reserves auth collection lifecycle and identifier mutations for the account workflow", async () => {
    const schemaFixture = mutableSchema(authCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());

    await expect(service.create(actor, "members", {
      email: "member@example.com",
      displayName: "Member",
    })).rejects.toMatchObject({
      code: "AUTH_COLLECTION_ACCOUNT_OPERATION_REQUIRED",
      status: 409,
    });

    const provisioningActor: ActorContext = { ...actor, execution: "identity-provisioning" };
    const created = await service.create(provisioningActor, "members", {
      email: "member@example.com",
      displayName: "Member",
    });
    const profileUpdated = await service.update(actor, "members", created.id, {
      expectedVersion: 1,
      data: { displayName: "Updated member" },
    });
    expect(profileUpdated.data).toMatchObject({
      email: "member@example.com",
      displayName: "Updated member",
    });

    await expect(service.update(actor, "members", created.id, {
      expectedVersion: 2,
      data: { email: "other@example.com" },
    })).rejects.toMatchObject({
      code: "AUTH_IDENTIFIER_UPDATE_REQUIRES_ACCOUNT_WORKFLOW",
      status: 409,
    });
    await expect(service.delete(actor, "members", created.id, 2)).rejects.toMatchObject({
      code: "AUTH_COLLECTION_ACCOUNT_OPERATION_REQUIRED",
      status: 409,
    });

    await service.delete(provisioningActor, "members", created.id, 2);
    await expect(service.restoreDeleted(actor, "members", created.id, 3)).rejects.toMatchObject({
      code: "AUTH_COLLECTION_ACCOUNT_OPERATION_REQUIRED",
      status: 409,
    });
  });

  it("blocks revision restore when it would roll back an auth identifier", async () => {
    const schemaFixture = mutableSchema(authCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const provisioningActor: ActorContext = { ...actor, execution: "identity-provisioning" };
    const created = await service.create(provisioningActor, "members", {
      email: "first@example.com",
      displayName: "Member",
    });
    await service.update(provisioningActor, "members", created.id, {
      expectedVersion: 1,
      data: { email: "second@example.com" },
    });

    await expect(service.restoreRevision(actor, "members", created.id, "rev_1", 2))
      .rejects.toMatchObject({
        code: "AUTH_IDENTIFIER_UPDATE_REQUIRES_ACCOUNT_WORKFLOW",
        status: 409,
      });
  });

  it("uses parent scope for hierarchy creation and document scope for later operations", async () => {
    const hierarchyCollection: CollectionDefinition = {
      ...baseCollection,
      hierarchy: { enabled: true, permissionInheritance: true },
    };
    const schemaFixture = mutableSchema(hierarchyCollection);
    const store = new MemoryDocumentStore();
    const required: Array<{ action: string; resourceId: string }> = [];
    const writes: string[] = [];
    const scopedActor: ActorContext = {
      ...actor,
      authorization: {
        require: async ({ action, resourceId }) => { required.push({ action, resourceId }); },
        filterReadableData: async ({ data }) => data,
        assertWritableData: async ({ resourceId }) => { writes.push(resourceId); },
      },
    };
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const created = await service.create(scopedActor, "posts", { title: "Child" }, {
      parentId: "doc_parent",
      position: 0,
      expectedVersion: 1,
    });
    expect(required[0]).toEqual({
      action: "content.create",
      resourceId: "resource:document:doc_parent",
    });
    expect(writes[0]).toBe("resource:document:doc_parent");

    required.length = 0;
    writes.length = 0;
    await service.update(scopedActor, "posts", created.id, {
      expectedVersion: 1,
      data: { title: "Updated child" },
    });
    expect(required[0]).toEqual({
      action: "content.update",
      resourceId: `resource:document:${created.id}`,
    });
    expect(writes[0]).toBe(`resource:document:${created.id}`);
  });

  it("uses the actor Realm namespace and fails closed for an unresolved cross-realm owner origin", async () => {
    const hierarchyCollection: CollectionDefinition = {
      ...baseCollection,
      hierarchy: { enabled: true, permissionInheritance: true },
    };
    const schemaFixture = mutableSchema(hierarchyCollection);
    const store = new MemoryDocumentStore();
    const required: Array<{
      action: string;
      resourceId: string;
      context?: AuthorizationObjectContext;
    }> = [];
    const realmActor: ActorContext = {
      ...actor,
      realmId: "rlm_community",
      subjectId: "subject_community_owner",
      authorization: {
        require: async ({ action, resourceId, context }) => {
          required.push({ action, resourceId, ...(context === undefined ? {} : { context }) });
        },
        filterReadableData: async ({ data }) => data,
        assertWritableData: async () => undefined,
      },
    };
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const created = await service.create(realmActor, "posts", { title: "Realm draft" }, {
      parentId: null,
      position: 0,
      expectedVersion: 0,
    });
    expect(created.ownerRealmId).toBe("rlm_community");
    expect(required.find(({ action }) => action === "content.create")).toEqual({
      action: "content.create",
      resourceId: "authorization:rlm_community:resource:collection:col_posts",
      context: { ownerSubjectId: "subject_community_owner", status: "draft" },
    });

    required.length = 0;
    await service.update(realmActor, "posts", created.id, {
      expectedVersion: 1,
      data: { title: "Updated realm draft" },
    });
    expect(required.find(({ action }) => action === "content.update")).toEqual({
      action: "content.update",
      resourceId: `authorization:rlm_community:resource:document:${created.id}`,
      context: { ownerSubjectId: "subject_community_owner", status: "draft" },
    });

    const foreignOriginContexts: AuthorizationObjectContext[] = [];
    const otherRealmSubject: ActorContext = {
      ...realmActor,
      subjectId: "subject_community_reader",
      authorization: {
        require: async ({ context }) => {
          if (context !== undefined) foreignOriginContexts.push(context);
        },
        filterReadableData: async ({ data, context }) => {
          if (context !== undefined) foreignOriginContexts.push(context);
          return data;
        },
        assertWritableData: async () => undefined,
      },
    };
    await service.get(otherRealmSubject, "posts", created.id);
    expect(foreignOriginContexts).toHaveLength(2);
    expect(foreignOriginContexts).toEqual([
      { status: "draft" },
      { status: "draft" },
    ]);
  });

  it("rejects filtering or sorting by fields hidden from the actor", async () => {
    const schemaFixture = mutableSchema(baseCollection);
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    const restricted: ActorContext = {
      ...actor,
      authorization: {
        require: async () => undefined,
        filterReadableData: async ({ data }) => "title" in data ? {} : data,
        assertWritableData: async () => undefined,
      },
    };

    await expect(service.query(restricted, "posts", {
      filter: {
        type: "condition",
        field: { kind: "data", fieldId: "fld_title" },
        operator: "contains",
        value: "secret",
      },
    })).rejects.toMatchObject({
      code: "DOCUMENT_QUERY_FIELD_FORBIDDEN",
      status: 403,
    });
  });

  it("fills cursor pages from visible documents instead of returning authorization holes", async () => {
    const schemaFixture = mutableSchema({
      ...baseCollection,
      hierarchy: { enabled: true, permissionInheritance: true },
    });
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    for (let index = 1; index <= 5; index += 1) {
      await service.create(actor, "posts", { title: `Post ${index}` }, {
        parentId: null,
        position: index - 1,
        expectedVersion: index - 1,
      });
    }
    const restricted: ActorContext = {
      ...actor,
      subjectId: "subject_restricted",
      authorization: {
        require: async () => undefined,
        filterReadableData: async ({ resourceId, data }) => {
          if (resourceId.endsWith(":doc_5") || resourceId.endsWith(":doc_3")) {
            throw new ApplicationError("ACCESS_DENIED", 403, "hidden");
          }
          return data;
        },
        assertWritableData: async () => undefined,
      },
    };

    const first = await service.query(restricted, "posts", { limit: 2 });
    expect(first).toMatchObject({
      hasNextPage: true,
      items: [
        { id: "doc_4", data: { title: "Post 4" } },
        { id: "doc_2", data: { title: "Post 2" } },
      ],
    });
    expect(first.nextCursor).toBeTypeOf("string");

    const second = await service.query(restricted, "posts", {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second).toMatchObject({
      hasNextPage: false,
      items: [{ id: "doc_1", data: { title: "Post 1" } }],
    });
  });

  it("aggregate() counts ONLY authorized documents (slG1 — no DB-level leak)", async () => {
    const schemaFixture = mutableSchema({
      ...baseCollection,
      hierarchy: { enabled: true, permissionInheritance: true },
    });
    const store = new MemoryDocumentStore();
    const service = new DocumentApplicationService(schemaFixture.store, store, runtime());
    // 5 posts, two distinct titles: A (docs 1,3,5), B (docs 2,4).
    const titles = ["A", "B", "A", "B", "A"];
    for (let index = 0; index < titles.length; index += 1) {
      await service.create(actor, "posts", { title: titles[index]! }, {
        parentId: null, position: index, expectedVersion: index,
      });
    }
    // Hide doc_3 and doc_5 (both title "A") from this actor.
    const restricted: ActorContext = {
      ...actor,
      subjectId: "subject_restricted",
      authorization: {
        require: async () => undefined,
        filterReadableData: async ({ resourceId, data }) => {
          if (resourceId.endsWith(":doc_5") || resourceId.endsWith(":doc_3")) {
            throw new ApplicationError("ACCESS_DENIED", 403, "hidden");
          }
          return data;
        },
        assertWritableData: async () => undefined,
      },
    };
    const result = await service.aggregate(restricted, "posts", {
      aggregate: { groupBy: { kind: "data", fieldId: "fld_title" }, measure: { op: "count" } },
    });
    // A has 3 rows but 2 are hidden → only 1 counted; B's 2 are both visible.
    const byGroup = new Map(result.groups.map((entry) => [entry.group, entry.value]));
    expect(byGroup.get("A")).toBe(1);
    expect(byGroup.get("B")).toBe(2);
  });
});

class MemoryDocumentStore implements DocumentStore {
  readonly aggregates = new Map<string, DocumentAggregate>();
  readonly events: PersistedDocumentEvent[] = [];

  async loadDocument(documentId: string): Promise<DocumentAggregate | null> {
    return this.aggregates.get(documentId) ?? null;
  }

  async createDocument(
    aggregate: DocumentAggregate,
    _collection: CollectionDefinition,
    events: readonly PersistedDocumentEvent[],
  ): Promise<void> {
    this.aggregates.set(aggregate.identity.id, aggregate);
    this.events.push(...events);
  }

  async updateDocument(
    aggregate: DocumentAggregate,
    _collection: CollectionDefinition,
    expectedVersion: number,
    events: readonly PersistedDocumentEvent[],
  ): Promise<void> {
    const current = this.aggregates.get(aggregate.identity.id);
    if (current?.aggregateVersion !== expectedVersion) {
      throw new ApplicationError("DOCUMENT_VERSION_CONFLICT", 409, "stale");
    }
    this.aggregates.set(aggregate.identity.id, aggregate);
    this.events.push(...events);
  }

  async listDocuments(
    collection: CollectionDefinition,
    input: { readonly page: number; readonly pageSize: number; readonly state: DocumentListState },
  ): Promise<DocumentPage> {
    const matching = [...this.aggregates.values()].filter(
      (aggregate) =>
        String(aggregate.identity.collectionId) === String(collection.id) &&
        (input.state === "deleted"
          ? aggregate.identity.deletion !== null
          : aggregate.identity.deletion === null),
    );
    return {
      items: matching
        .slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
        .map(adminRecord),
      page: input.page,
      pageSize: input.pageSize,
      total: matching.length,
    };
  }

  async queryDocuments(
    collection: CollectionDefinition,
    input: NormalizedDocumentQuery,
  ): Promise<DocumentQueryStorePage> {
    const matching = [...this.aggregates.values()]
      .filter((aggregate) =>
        String(aggregate.identity.collectionId) === String(collection.id) &&
        (input.state === "deleted"
          ? aggregate.identity.deletion !== null
          : aggregate.identity.deletion === null))
      .map(adminRecord)
      .sort((left, right) => compareQueryRecords(left, right, collection, input));
    const afterCursor = input.cursorValues === undefined
      ? matching
      : matching.filter((record) =>
        compareRecordToCursor(record, collection, input, input.cursorValues!) > 0);
    const selected = afterCursor.slice(0, input.limit);
    return {
      items: selected.map((document) => ({
        document,
        cursor: encodeDocumentQueryCursor(
          input.fingerprint,
          input.sort.map(({ field }) => queryRecordValue(document, collection, field)),
        ),
      })),
      hasNextPage: afterCursor.length > input.limit,
    };
  }

  async listPublishedDocuments(
    collection: CollectionDefinition,
    input: { readonly page: number; readonly pageSize: number },
  ): Promise<PublishedDocumentPage> {
    const matching = [...this.aggregates.values()]
      .filter((aggregate) => String(aggregate.identity.collectionId) === String(collection.id))
      .map(publicRecord)
      .filter((record): record is PublishedDocumentRecord => record !== null);
    return {
      items: matching.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
      page: input.page,
      pageSize: input.pageSize,
      total: matching.length,
    };
  }

  async getPublishedDocument(
    collection: CollectionDefinition,
    documentId: string,
  ): Promise<PublishedDocumentRecord | null> {
    const aggregate = this.aggregates.get(documentId);
    return aggregate === undefined || String(aggregate.identity.collectionId) !== String(collection.id)
      ? null
      : publicRecord(aggregate);
  }

  async executeHardPurge(input: Parameters<DocumentStore["executeHardPurge"]>[0]): Promise<void> {
    const nextAggregates = new Map(this.aggregates);
    const nextEvents = [...this.events];
    for (const update of input.updates) {
      const current = nextAggregates.get(update.aggregate.identity.id);
      if (current?.aggregateVersion !== update.expectedVersion || current.identity.deletion !== null) {
        throw new ApplicationError("DOCUMENT_VERSION_CONFLICT", 409, "stale");
      }
      nextAggregates.set(update.aggregate.identity.id, update.aggregate);
      nextEvents.push(...update.events);
    }
    for (const removal of input.removals) {
      const current = nextAggregates.get(removal.aggregate.identity.id);
      if (
        current?.aggregateVersion !== removal.expectedVersion ||
        removal.aggregate.identity.deletion === null
      ) {
        throw new ApplicationError("DOCUMENT_VERSION_CONFLICT", 409, "stale");
      }
      nextAggregates.delete(removal.aggregate.identity.id);
      nextEvents.push(...removal.events);
    }
    this.aggregates.clear();
    nextAggregates.forEach((aggregate, id) => this.aggregates.set(id, aggregate));
    this.events.splice(0, this.events.length, ...nextEvents);
  }
}

function adminRecord(aggregate: DocumentAggregate): DocumentRecord {
  return {
    id: aggregate.identity.id,
    collectionId: aggregate.identity.collectionId,
    data: getWorkingRevision(aggregate).data,
    version: aggregate.aggregateVersion,
    createdAt: aggregate.identity.createdAt,
    updatedAt: aggregate.identity.updatedAt,
    ownerSubjectId: aggregate.identity.createdBy,
    displayState: getDisplayState(aggregate),
    draftRevisionId: aggregate.identity.currentDraftRevisionId,
    publication: aggregate.identity.publication,
    deletion: aggregate.identity.deletion,
  };
}

function compareQueryRecords(
  left: DocumentRecord,
  right: DocumentRecord,
  collection: CollectionDefinition,
  query: NormalizedDocumentQuery,
): number {
  for (const sort of query.sort) {
    const comparison = compareQueryScalars(
      queryRecordValue(left, collection, sort.field),
      queryRecordValue(right, collection, sort.field),
      sort.direction,
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareRecordToCursor(
  record: DocumentRecord,
  collection: CollectionDefinition,
  query: NormalizedDocumentQuery,
  cursorValues: readonly DocumentQueryScalar[],
): number {
  for (const [index, sort] of query.sort.entries()) {
    const comparison = compareQueryScalars(
      queryRecordValue(record, collection, sort.field),
      cursorValues[index]!,
      sort.direction,
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function queryRecordValue(
  record: DocumentRecord,
  collection: CollectionDefinition,
  field: NormalizedDocumentQuery["sort"][number]["field"],
): DocumentQueryScalar {
  if (field.kind === "system") {
    switch (field.field) {
      case "id": return record.id;
      case "createdAt": return record.createdAt;
      case "updatedAt": return record.updatedAt;
      case "version": return record.version;
    }
  }
  const name = collection.fields.find(({ id }) => String(id) === field.fieldId)!.name;
  const value = record.data[name];
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

function compareQueryScalars(
  left: DocumentQueryScalar,
  right: DocumentQueryScalar,
  direction: "asc" | "desc",
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  let comparison: number;
  if (typeof left === "number" && typeof right === "number") comparison = left - right;
  else if (typeof left === "boolean" && typeof right === "boolean") comparison = Number(left) - Number(right);
  else comparison = String(left).localeCompare(String(right));
  return direction === "asc" ? comparison : -comparison;
}

function publicRecord(aggregate: DocumentAggregate): PublishedDocumentRecord | null {
  const revision = getPublicRevision(aggregate);
  const publication = aggregate.identity.publication;
  if (revision === null || publication === null) return null;
  return {
    id: aggregate.identity.id,
    collectionId: aggregate.identity.collectionId,
    data: revision.data,
    revisionId: revision.id,
    schemaRevisionId: revision.schemaRevisionId,
    publishedAt: publication.publishedAt,
    publishedBy: publication.publishedBy,
    createdAt: aggregate.identity.createdAt,
    updatedAt: revision.createdAt,
    ownerSubjectId: aggregate.identity.createdBy,
  };
}

function mutableSchema(initialCollection: CollectionDefinition): {
  readonly store: SchemaStore;
  setCollection(collection: CollectionDefinition): void;
} {
  let collection = initialCollection;
  let revision = 1;
  const current = (): SchemaRevisionRecord => ({
    revisionId: `sch_${revision}`,
    parentRevisionId: revision === 1 ? null : `sch_${revision - 1}`,
    schema: schemaWith(collection),
    createdAt: "2026-07-15T00:00:00.000Z",
    createdBy: "subject_owner",
    hash: `hash_${revision}`,
  });
  const unsupported = async (): Promise<never> => {
    throw new Error("not used by document service tests");
  };
  return {
    store: {
      issueSchemaIds: unsupported,
      getActiveSchema: async () => current(),
      getSchemaDraft: async () => null,
      saveSchemaDraft: unsupported,
      applySchemaDraft: unsupported,
    },
    setCollection(next) {
      collection = next;
      revision += 1;
    },
  };
}

function schemaWith(collection: CollectionDefinition): SchemaIrV1 {
  return { format: "xecms.schema", formatVersion: 1, collections: [collection] };
}

function runtime() {
  let instant = 0;
  let document = 0;
  let revision = 0;
  return {
    now: () => new Date(Date.UTC(2026, 6, 15, 0, instant++)).toISOString(),
    newId: (prefix: "doc" | "rev") =>
      prefix === "doc" ? `doc_${++document}` : `rev_${++revision}`,
  };
}
