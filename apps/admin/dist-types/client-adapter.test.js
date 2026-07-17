import { describe, expect, it, vi } from "vitest";
import { asCollectionId, asFieldId } from "@xecms/schema";
import { createAdminApi } from "./client-adapter.js";
const emptySchema = {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [],
};
describe("createAdminApi", () => {
    it("exposes the typed self access profile through the Admin adapter", async () => {
        const evaluateBatch = vi.fn().mockResolvedValue({
            policyRevision: 6,
            items: [{
                    id: "navigation.schema",
                    type: "permission",
                    supported: true,
                    decision: {
                        allowed: true,
                        action: "schema.read",
                        reasonCode: "ALLOW_PERMISSION",
                        resourceId: "resource:schema",
                        policyRevision: 6,
                        matchedGrants: [],
                    },
                }],
        });
        const client = { access: { evaluateBatch } };
        const input = {
            checks: [{
                    id: "navigation.schema",
                    type: "permission",
                    action: "schema.read",
                    resourceId: "resource:schema",
                }],
        };
        await expect(createAdminApi(client).access.evaluateBatch(input)).resolves.toMatchObject({
            policyRevision: 6,
            items: [{ id: "navigation.schema", supported: true }],
        });
        expect(evaluateBatch).toHaveBeenCalledWith(input);
    });
    it("round-trips the exact Collection auth contract through schema drafts", async () => {
        const saveDraft = vi.fn().mockImplementation(async ({ schema }) => ({
            baseRevisionId: null,
            draftVersion: "draft-auth",
            schema,
            updatedAt: "2026-07-15T00:00:00.000Z",
            updatedBy: "user_admin",
        }));
        const client = {
            schema: {
                getDraft: vi.fn().mockResolvedValue(null),
                getCurrent: vi.fn().mockResolvedValue(null),
                issueIds: vi.fn().mockResolvedValue({ ids: ["col_members"] }),
                saveDraft,
            },
        };
        const auth = {
            enabled: true,
            realmKey: "community",
            identifierFieldIds: ["fld_email"],
            acceptSystemIdentities: true,
            provisioning: "jit",
            defaultRoleIds: ["role_member"],
        };
        const result = await createAdminApi(client).collections.create({
            name: "members",
            auth,
            fields: [{
                    id: "fld_email",
                    name: "email",
                    type: "text",
                    required: true,
                    unique: true,
                }],
        });
        const savedSchema = saveDraft.mock.calls[0]?.[0].schema;
        expect(savedSchema.collections[0]?.auth).toStrictEqual(auth);
        expect(savedSchema.collections[0]?.auth).not.toHaveProperty("registration");
        expect(result.auth).toStrictEqual(auth);
    });
    it("materializes M2 hierarchy and relation fields with stable IDs", async () => {
        const saveDraft = vi.fn().mockImplementation(async ({ schema }) => ({
            baseRevisionId: null,
            draftVersion: "draft-m2",
            schema,
            updatedAt: "2026-07-15T00:00:00.000Z",
            updatedBy: "user_admin",
        }));
        const client = {
            schema: {
                getDraft: vi.fn().mockResolvedValue(null),
                getCurrent: vi.fn().mockResolvedValue(null),
                issueIds: vi.fn().mockImplementation(async ({ kind }) => ({
                    ids: kind === "collection"
                        ? ["col_pages"]
                        : kind === "relation"
                            ? ["rel_parent"]
                            : ["fld_title", "fld_parent", "fld_layout"],
                })),
                saveDraft,
            },
        };
        await createAdminApi(client).collections.create({
            name: "pages",
            kind: "collection",
            hierarchy: { enabled: true, maxDepth: 5, ordering: "manual", permissionInheritance: true },
            fields: [
                { name: "title", type: "textarea", required: true, maxLength: 120 },
                { name: "parent", type: "relation", required: false, targetCollectionId: "col_pages", cardinality: "one", onDelete: "nullify" },
                { name: "layout", type: "select", required: true, options: [{ value: "wide", label: "Wide" }] },
            ],
        });
        const savedSchema = saveDraft.mock.calls[0]?.[0].schema;
        expect(savedSchema.collections[0]).toMatchObject({
            id: "col_pages",
            hierarchy: { enabled: true, maxDepth: 5, ordering: "manual", permissionInheritance: true },
            fields: [
                { id: "fld_title", type: "textarea", maxLength: 120 },
                { id: "fld_parent", type: "relation", relationId: "rel_parent", targetCollectionId: "col_pages", onDelete: "nullify" },
                { id: "fld_layout", type: "select", options: [{ value: "wide", label: "Wide" }] },
            ],
        });
    });
    it("asks the server for permanent IDs and only saves a draft when a collection is created", async () => {
        const saveDraft = vi.fn().mockImplementation(async ({ schema }) => ({
            baseRevisionId: null,
            draftVersion: "draft-v1",
            schema,
            updatedAt: "2026-07-15T00:00:00.000Z",
            updatedBy: "user_admin",
        }));
        const apply = vi.fn();
        const client = {
            schema: {
                getDraft: vi.fn().mockResolvedValue(null),
                getCurrent: vi.fn().mockResolvedValue(null),
                issueIds: vi.fn().mockImplementation(async ({ kind }) => ({
                    ids: kind === "collection" ? ["col_posts"] : ["fld_title"],
                })),
                saveDraft,
                apply,
            },
        };
        const result = await createAdminApi(client).collections.create({
            name: "posts",
            label: "게시물",
            fields: [{ name: "title", label: "제목", type: "text", required: true }],
        });
        expect(result).toMatchObject({
            id: "col_posts",
            status: "draft",
            hasPendingChanges: true,
            draftVersion: "draft-v1",
        });
        expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
            expectedDraftVersion: null,
            schema: expect.objectContaining({
                collections: [expect.objectContaining({
                        id: "col_posts",
                        fields: [expect.objectContaining({ id: "fld_title" })],
                    })],
            }),
        }));
        expect(apply).not.toHaveBeenCalled();
    });
    it("uses the applied schema for content forms even when a newer draft exists", async () => {
        const appliedSchema = {
            ...emptySchema,
            collections: [{
                    id: asCollectionId("col_posts"),
                    name: "posts",
                    fields: [{ id: asFieldId("fld_title"), name: "title", label: "제목", type: "text" }],
                }],
        };
        const draftSchema = {
            ...appliedSchema,
            collections: [{
                    ...appliedSchema.collections[0],
                    fields: [
                        ...appliedSchema.collections[0].fields,
                        { id: asFieldId("fld_future"), name: "future", type: "number" },
                    ],
                }],
        };
        const client = {
            schema: {
                getCurrent: vi.fn().mockResolvedValue({
                    revisionId: "rev-1",
                    parentRevisionId: null,
                    schema: appliedSchema,
                    createdAt: "2026-07-15T00:00:00.000Z",
                    createdBy: "user_admin",
                }),
                getDraft: vi.fn().mockResolvedValue({
                    baseRevisionId: "rev-1",
                    draftVersion: "draft-v2",
                    schema: draftSchema,
                    updatedAt: "2026-07-15T00:01:00.000Z",
                    updatedBy: "user_admin",
                }),
            },
            collections: {
                list: vi.fn().mockResolvedValue({
                    items: [{
                            id: "col_posts",
                            name: "posts",
                            fields: [],
                            status: "applied",
                            hasPendingChanges: true,
                            revisionId: "rev-1",
                        }],
                }),
            },
        };
        const collection = await createAdminApi(client).collections.getApplied("col_posts");
        expect(collection.fields.map(({ name }) => name)).toEqual(["title"]);
        expect(collection.hasPendingChanges).toBe(true);
        expect(client.schema.getDraft).not.toHaveBeenCalled();
    });
    it("creates a hierarchy root with the latest structure version and tail position", async () => {
        const appliedSchema = {
            ...emptySchema,
            collections: [{
                    id: asCollectionId("col_pages"),
                    name: "pages",
                    fields: [{ id: asFieldId("fld_title"), name: "title", type: "text" }],
                    hierarchy: { enabled: true, maxDepth: 3 },
                }],
        };
        const created = {
            id: "doc-new",
            collectionId: "col_pages",
            data: { title: "새 루트" },
            version: 1,
            displayState: "draft",
            draftRevisionId: "rev-new",
            publication: null,
            deletion: null,
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
        };
        const create = vi.fn().mockResolvedValue(created);
        const client = {
            schema: {
                getCurrent: vi.fn().mockResolvedValue({
                    revisionId: "schema-1",
                    parentRevisionId: null,
                    schema: appliedSchema,
                    createdAt: "2026-07-15T00:00:00.000Z",
                    createdBy: "user_admin",
                }),
            },
            documents: {
                tree: vi.fn().mockResolvedValue({
                    version: 7,
                    items: [
                        { parentId: null },
                        { parentId: "doc-root" },
                        { parentId: null },
                    ],
                }),
                create,
            },
        };
        await createAdminApi(client).documents.create("col_pages", {
            data: { title: "새 루트" },
        });
        expect(create).toHaveBeenCalledWith("col_pages", {
            data: { title: "새 루트" },
            hierarchy: { parentId: null, position: 2, expectedVersion: 7 },
        });
    });
    it("preserves hierarchy permission impact and policy revision CAS across preview and move", async () => {
        const documentRecord = {
            id: "doc-child",
            collectionId: "col-pages",
            data: { title: "Child" },
            version: 2,
            displayState: "draft",
            draftRevisionId: "rev-child",
            publication: null,
            deletion: null,
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
        };
        const permissionImpact = {
            documentId: "doc-child",
            documentResourceId: "resource:document:doc-child",
            beforeParentResourceId: "resource:document:old-root",
            afterParentResourceId: "resource:document:new-root",
            beforeDocumentPath: ["old-root", "doc-child"],
            afterDocumentPath: ["new-root", "doc-child"],
            beforeResourcePath: ["resource:collection:col-pages", "resource:document:old-root", "resource:document:doc-child"],
            afterResourcePath: ["resource:collection:col-pages", "resource:document:new-root", "resource:document:doc-child"],
            affectedDocumentIds: ["doc-child"],
            affectedResourceIds: ["resource:document:doc-child"],
        };
        const previewMove = vi.fn().mockResolvedValue({
            previousParentId: "old-root",
            previousPosition: 0,
            affectedDocumentIds: ["doc-child"],
            permissionImpact,
            policyRevision: 12,
        });
        const move = vi.fn().mockResolvedValue({
            node: { document: documentRecord, parentId: "new-root", position: 1, depth: 1, path: ["new-root"], hasChildren: false },
            previousParentId: "old-root",
            previousPosition: 0,
            affectedDocumentIds: ["doc-child"],
            permissionImpact,
            version: 8,
            policyRevision: 13,
        });
        const client = { documents: { previewMove, move } };
        const api = createAdminApi(client);
        const request = { newParentId: "new-root", position: 1, expectedVersion: 7 };
        const preview = await api.documents.previewMove("col-pages", "doc-child", request);
        expect(preview).toMatchObject({ policyRevision: 12, permissionImpact });
        const result = await api.documents.move("col-pages", "doc-child", {
            ...request,
            expectedPolicyRevision: preview.policyRevision,
        });
        expect(move).toHaveBeenCalledWith("col-pages", "doc-child", {
            ...request,
            expectedPolicyRevision: 12,
        });
        expect(result).toMatchObject({ policyRevision: 13, permissionImpact });
    });
    it("adapts document lifecycle and revision endpoints without losing concurrency metadata", async () => {
        const documentRecord = {
            id: "doc-1",
            collectionId: "col_posts",
            data: { title: "첫 글" },
            version: 4,
            displayState: "published-with-draft",
            draftRevisionId: "rev-2",
            publication: {
                revisionId: "rev-1",
                publishedAt: "2026-07-15T00:01:00.000Z",
                publishedBy: "user_admin",
            },
            deletion: null,
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:02:00.000Z",
        };
        const publish = vi.fn().mockResolvedValue(documentRecord);
        const restoreDeleted = vi.fn().mockResolvedValue(documentRecord);
        const purge = vi.fn().mockResolvedValue(undefined);
        const revisionRestore = vi.fn().mockResolvedValue(documentRecord);
        const client = {
            documents: {
                list: vi.fn().mockResolvedValue({ items: [documentRecord], page: 1, pageSize: 25, total: 1 }),
                publish,
                restore: restoreDeleted,
                purge,
            },
            revisions: {
                list: vi.fn().mockResolvedValue({
                    documentVersion: 4,
                    items: [{
                            id: "rev-2",
                            sequence: 2,
                            schemaRevisionId: "schema-1",
                            origin: { kind: "restore", restoredFromRevisionId: "rev-1" },
                            createdAt: "2026-07-15T00:02:00.000Z",
                            createdBy: "user_admin",
                            isCurrentDraft: true,
                            isPublished: false,
                        }],
                }),
                restore: revisionRestore,
            },
        };
        const api = createAdminApi(client);
        const listed = await api.documents.list("col_posts", { state: "deleted" });
        expect(client.documents.list).toHaveBeenCalledWith("col_posts", { state: "deleted" });
        expect(listed.items[0]).toMatchObject({ displayState: "published-with-draft", draftRevisionId: "rev-2" });
        await api.documents.publish("col_posts", "doc-1", { expectedVersion: 4 });
        await api.documents.restoreDeleted("col_posts", "doc-1", { expectedVersion: 4 });
        await api.documents.purge("col_posts", "doc-1", { expectedVersion: 4 });
        expect(publish).toHaveBeenCalledWith("col_posts", "doc-1", { expectedVersion: 4 });
        expect(restoreDeleted).toHaveBeenCalledWith("col_posts", "doc-1", { expectedVersion: 4 });
        expect(purge).toHaveBeenCalledWith("col_posts", "doc-1", { expectedVersion: 4 });
        const revisions = await api.revisions.list("col_posts", "doc-1");
        expect(revisions.documentVersion).toBe(4);
        expect(revisions.items[0]?.origin).toEqual({ kind: "restore", restoredFromRevisionId: "rev-1" });
        await api.revisions.restore("col_posts", "doc-1", "rev-1", { expectedVersion: revisions.documentVersion });
        expect(revisionRestore).toHaveBeenCalledWith("col_posts", "doc-1", "rev-1", { expectedVersion: 4 });
    });
});
//# sourceMappingURL=client-adapter.test.js.map