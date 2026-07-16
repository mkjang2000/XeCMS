import { randomUUID } from "node:crypto";

import {
  PostgresDatabase,
  qualifiedName,
  quoteIdentifier,
} from "@xecms/database";
import type { LightMyRequestResponse } from "fastify";
import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./config.js";
import { buildServer, type XeCmsServer } from "./server.js";

const RUN = process.env["XECMS_RUN_POSTGRES_TESTS"] === "true";
const DATABASE_URL =
  process.env["XECMS_TEST_DATABASE_URL"] ??
  process.env["XECMS_E2E_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://xecms:xecms@127.0.0.1:55432/xecms_e2e";

interface Session {
  readonly cookie: string;
  readonly csrfToken: string;
}

interface Policy {
  readonly revision: number;
  readonly subjects: readonly { readonly id: string; readonly name: string }[];
  readonly resources: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly parentId?: string;
  }[];
  readonly levels: readonly { readonly id: string; readonly name: string }[];
  readonly roles: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly levelId: string;
    readonly permissions: readonly string[];
    readonly delegatablePermissions: readonly string[];
    readonly fieldAccess: readonly {
      readonly resourceId: string;
      readonly readableFields: readonly string[];
      readonly writableFields: readonly string[];
    }[];
  }[];
  readonly bindings: readonly {
    readonly id: string;
    readonly subjectId: string;
    readonly roleId: string;
    readonly resourceId?: string;
    readonly propagation?: string;
  }[];
}

interface DocumentRecord {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly version: number;
}

interface Tree {
  readonly version: number;
  readonly items: readonly {
    readonly document: DocumentRecord;
    readonly parentId: string | null;
  }[];
}

interface PermissionImpact {
  readonly documentId: string;
  readonly documentResourceId: string;
  readonly beforeParentResourceId: string;
  readonly afterParentResourceId: string;
  readonly beforeResourcePath: readonly string[];
  readonly afterResourcePath: readonly string[];
  readonly affectedDocumentIds: readonly string[];
  readonly affectedResourceIds: readonly string[];
  readonly effectivePermissionChanges: readonly {
    readonly subjectId: string;
    readonly resourceId: string;
    readonly permission: string;
    readonly beforeAllowed: boolean;
    readonly afterAllowed: boolean;
    readonly change: "granted" | "revoked";
  }[];
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

interface MoveResult {
  readonly version: number;
  readonly policyRevision: number;
  readonly permissionImpact: PermissionImpact | null;
}

interface ActiveSchema {
  readonly revisionId: string;
  readonly schema: {
    readonly [key: string]: unknown;
    readonly collections: readonly {
      readonly [key: string]: unknown;
      readonly id: string;
      readonly hierarchy?: {
        readonly [key: string]: unknown;
        readonly permissionInheritance?: boolean;
      };
    }[];
  };
}

describe.runIf(RUN)("M3 authorization acceptance with document hierarchy", () => {
  it("enforces document scopes end-to-end and reconciles missing projections fail-closed", async () => {
    const schemaName = `xecms_m3_acceptance_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({ connectionString: DATABASE_URL, schema: schemaName });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schemaName,
      XECMS_SESSION_SECRET: "m3-acceptance-session-secret-0123456789",
      XECMS_DEV_SEED: "true",
      XECMS_DEV_ADMIN_USERNAME: "admin",
      XECMS_DEV_ADMIN_PASSWORD: "admin",
      XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
    });
    let server: XeCmsServer | undefined;

    try {
      server = await buildServer({ database, logger: false, config });
      const owner = await login(server, "admin", "admin");

      await applyHierarchySchema(server, owner);

      const rootA = await createDocument(server, owner, {
        title: "Root A",
        secret: "root-a-secret",
      }, null, 0, 0);
      const rootB = await createDocument(server, owner, {
        title: "Root B",
        secret: "root-b-secret",
      }, null, 1, 1);
      const child = await createDocument(server, owner, {
        title: "Child",
        secret: "child-secret",
      }, rootA.id, 0, 2);

      const collectionResourceId = "resource:collection:col_m3_pages";
      const rootAResourceId = documentResourceId(rootA.id);
      const rootBResourceId = documentResourceId(rootB.id);
      const childResourceId = documentResourceId(child.id);

      let policy = await getPolicy(server, owner);
      expect(resourceParent(policy, rootAResourceId)).toBe(collectionResourceId);
      expect(resourceParent(policy, rootBResourceId)).toBe(collectionResourceId);
      expect(resourceParent(policy, childResourceId)).toBe(rootAResourceId);

      const editorLevel = required(policy.levels.find(({ name }) => name === "Editors"));
      policy = await createSubject(server, owner, policy, "M3 Boundary Mover");
      const boundaryMover = required(policy.subjects.find(({ name }) => name === "M3 Boundary Mover"));
      await createLoginIdentity(database, schemaName, boundaryMover.id, "m3boundarymover");
      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "M3 Boundary Move Role",
        description: "May update only explicitly bound roots",
        levelId: editorLevel.id,
        permissions: ["content.update"],
        delegatablePermissions: [],
        fieldAccess: [],
      });
      const boundaryMoveRole = required(policy.roles.find(({ name }) => name === "M3 Boundary Move Role"));
      for (const resourceId of [rootAResourceId, rootBResourceId]) {
        policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
          expectedPolicyRevision: policy.revision,
          subjectId: boundaryMover.id,
          roleId: boundaryMoveRole.id,
          resourceId,
          propagation: "self",
        });
      }
      const boundaryMoverSession = await login(server, "m3boundarymover", "admin");
      const boundaryChildDecision = await simulate(server, owner, {
        subjectId: boundaryMover.id,
        action: "content.update",
        resourceId: childResourceId,
      });
      expect(boundaryChildDecision).toMatchObject({
        allowed: false,
        reasonCode: "SCOPE_MISMATCH",
      });
      const boundaryTreeBefore = await getTree(server, owner);
      const boundaryPolicyRevision = policy.revision;
      const deniedSubtreePreview = await mutate(server, boundaryMoverSession, "POST",
        `/api/collections/col_m3_pages/documents/${rootA.id}/move/preview`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: boundaryTreeBefore.version,
        });
      expect(deniedSubtreePreview.statusCode).toBe(403);
      expect(deniedSubtreePreview.json().code).toBe("AUTHORIZATION_DENIED");
      expect(deniedSubtreePreview.body).not.toContain(child.id);
      expect(deniedSubtreePreview.body).not.toContain(childResourceId);

      const deniedSubtreeMove = await mutate(server, boundaryMoverSession, "POST",
        `/api/collections/col_m3_pages/documents/${rootA.id}/move`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: boundaryTreeBefore.version,
          expectedPolicyRevision: boundaryPolicyRevision,
        });
      expect(deniedSubtreeMove.statusCode).toBe(403);
      expect(deniedSubtreeMove.json().code).toBe("AUTHORIZATION_DENIED");
      expect(deniedSubtreeMove.body).not.toContain(child.id);
      expect(deniedSubtreeMove.body).not.toContain(childResourceId);
      const boundaryTreeAfter = await getTree(server, owner);
      expect(boundaryTreeAfter.version).toBe(boundaryTreeBefore.version);
      expect(boundaryTreeAfter.items.find(({ document }) => document.id === rootA.id)?.parentId).toBeNull();
      expect((await getPolicy(server, owner)).revision).toBe(boundaryPolicyRevision);

      policy = await createSubject(server, owner, policy, "M3 Scoped Writer");
      const writer = required(policy.subjects.find(({ name }) => name === "M3 Scoped Writer"));
      await createLoginIdentity(database, schemaName, writer.id, "m3writer");

      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "M3 Root A Writer",
        description: "Document-scope read/update with a field allowlist",
        levelId: editorLevel.id,
        permissions: ["content.read", "content.update"],
        delegatablePermissions: [],
        fieldAccess: [{
          resourceId: rootAResourceId,
          readableFields: ["title"],
          writableFields: ["title"],
        }],
      });
      const scopedWriterRole = required(policy.roles.find(({ name }) => name === "M3 Root A Writer"));

      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
        expectedPolicyRevision: policy.revision,
        subjectId: writer.id,
        roleId: scopedWriterRole.id,
        resourceId: rootAResourceId,
        propagation: "self-and-children",
      });

      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "M3 Collection Lister",
        description: "Allows listing before per-document filtering",
        levelId: editorLevel.id,
        permissions: ["content.list"],
        delegatablePermissions: [],
        fieldAccess: [],
      });
      const listerRole = required(policy.roles.find(({ name }) => name === "M3 Collection Lister"));
      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
        expectedPolicyRevision: policy.revision,
        subjectId: writer.id,
        roleId: listerRole.id,
        resourceId: collectionResourceId,
        propagation: "self",
      });

      const writerSession = await login(server, "m3writer", "admin");
      const readableChild = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${child.id}`,
        headers: { cookie: writerSession.cookie },
      });
      expect(readableChild.statusCode).toBe(200);
      expect(readableChild.json().data).toEqual({ title: "Child" });

      const listed = await server.app.inject({
        method: "GET",
        url: "/api/collections/col_m3_pages/documents",
        headers: { cookie: writerSession.cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().items.map(({ id }: { readonly id: string }) => id).sort()).toEqual([
        rootA.id,
        child.id,
      ].sort());
      expect(listed.json().items.every(
        ({ data }: { readonly data: Readonly<Record<string, unknown>> }) => !("secret" in data),
      )).toBe(true);

      const deniedRootB = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${rootB.id}`,
        headers: { cookie: writerSession.cookie },
      });
      expect(deniedRootB.statusCode).toBe(403);
      const rootBSimulation = await simulate(server, owner, {
        subjectId: writer.id,
        action: "content.read",
        resourceId: rootBResourceId,
      });
      expect(rootBSimulation.allowed).toBe(false);
      expect(deniedRootB.json().details.decision.reasonCode).toBe(rootBSimulation.reasonCode);

      const forbiddenField = await mutate(server, writerSession, "PATCH",
        `/api/collections/col_m3_pages/documents/${child.id}`, {
          expectedVersion: child.version,
          data: { title: "Child", secret: "write attempt" },
        });
      expect(forbiddenField.statusCode).toBe(403);
      expect(forbiddenField.json().code).toBe("FIELD_WRITE_FORBIDDEN");

      const allowedWrite = await mutate(server, writerSession, "PATCH",
        `/api/collections/col_m3_pages/documents/${child.id}`, {
          expectedVersion: child.version,
          data: { title: "Child edited" },
        });
      expect(allowedWrite.statusCode, allowedWrite.body).toBe(200);
      expect(allowedWrite.json().data).toEqual({ title: "Child edited" });
      expect((await getDocument(server, owner, child.id)).data).toEqual({
        title: "Child edited",
        secret: "child-secret",
      });

      const actualReadSimulation = await simulate(server, owner, {
        subjectId: writer.id,
        action: "content.read",
        resourceId: childResourceId,
      });
      expect(actualReadSimulation.allowed).toBe(true);

      policy = await assertSameLevelPeerCannotMutate(
        server,
        database,
        schemaName,
        owner,
        await getPolicy(server, owner),
      );

      // A write grant must not turn a successful database commit into a 403 response
      // merely because the actor has no independent read grant. It must also leave a
      // synchronized hierarchy/resource projection instead of an orphan.
      const writeOnlyRootA = await createDocumentAtEnd(server, owner, {
        title: "Write-only source",
        secret: "source-secret",
      }, null);
      const writeOnlyRootB = await createDocumentAtEnd(server, owner, {
        title: "Write-only destination",
        secret: "destination-secret",
      }, null);
      const writeOnlyUpdateTarget = await createDocumentAtEnd(server, owner, {
        title: "Write-only update target",
        secret: "before-update",
      }, writeOnlyRootA.id);
      policy = await getPolicy(server, owner);
      policy = await createSubject(server, owner, policy, "M3 Write-only Operator");
      const writeOnly = required(policy.subjects.find(({ name }) => name === "M3 Write-only Operator"));
      await createLoginIdentity(database, schemaName, writeOnly.id, "m3writeonly");
      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "M3 Write-only Role",
        description: "Can create and update without reading documents",
        levelId: editorLevel.id,
        permissions: ["content.create", "content.update"],
        delegatablePermissions: [],
        fieldAccess: [],
      });
      const writeOnlyRole = required(policy.roles.find(({ name }) => name === "M3 Write-only Role"));
      for (const resourceId of [documentResourceId(writeOnlyRootA.id), documentResourceId(writeOnlyRootB.id)]) {
        policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
          expectedPolicyRevision: policy.revision,
          subjectId: writeOnly.id,
          roleId: writeOnlyRole.id,
          resourceId,
          propagation: "self-and-children",
        });
      }
      const writeOnlySession = await login(server, "m3writeonly", "admin");
      const createTreeBefore = await getTree(server, owner);
      const writeOnlyDocumentCountBefore = await documentCountCreatedBy(database, schemaName, writeOnly.id);
      const writeOnlyCreatedResponse = await mutate(server, writeOnlySession, "POST",
        "/api/collections/col_m3_pages/documents", {
          data: { title: "Created without read", secret: "created-secret" },
          hierarchy: {
            parentId: writeOnlyRootA.id,
            position: createTreeBefore.items.filter(({ parentId }) => parentId === writeOnlyRootA.id).length,
            expectedVersion: createTreeBefore.version,
          },
        });
      expect(writeOnlyCreatedResponse.statusCode).toBe(403);
      expect(writeOnlyCreatedResponse.json().code).toBe("AUTHORIZATION_DENIED");
      expect(await documentCountCreatedBy(database, schemaName, writeOnly.id)).toBe(writeOnlyDocumentCountBefore);
      expect((await getTree(server, owner)).version).toBe(createTreeBefore.version);

      const writeOnlyUpdated = await mutate(server, writeOnlySession, "PATCH",
        `/api/collections/col_m3_pages/documents/${writeOnlyUpdateTarget.id}`, {
          expectedVersion: writeOnlyUpdateTarget.version,
          data: { title: "Updated without read", secret: "after-update" },
        });
      expect(writeOnlyUpdated.statusCode).toBe(403);
      expect(writeOnlyUpdated.json().code).toBe("AUTHORIZATION_DENIED");
      const updatedByOwner = await getDocument(server, owner, writeOnlyUpdateTarget.id);
      expect(updatedByOwner.version).toBe(writeOnlyUpdateTarget.version);
      expect(updatedByOwner.data).toMatchObject({ title: "Write-only update target", secret: "before-update" });

      const writeOnlyMoveTree = await getTree(server, owner);
      const writeOnlyMovePolicy = await getPolicy(server, owner);
      const missingPolicyCas = await mutate(server, writeOnlySession, "POST",
        `/api/collections/col_m3_pages/documents/${writeOnlyUpdateTarget.id}/move`, {
          newParentId: writeOnlyRootB.id,
          position: 0,
          expectedVersion: writeOnlyMoveTree.version,
        });
      expect(missingPolicyCas.statusCode, missingPolicyCas.body).toBe(400);
      expect(missingPolicyCas.json().code).toBe("POLICY_REVISION_REQUIRED");
      expect((await getTree(server, owner)).version).toBe(writeOnlyMoveTree.version);

      const writeOnlyMoved = await mutate(server, writeOnlySession, "POST",
        `/api/collections/col_m3_pages/documents/${writeOnlyUpdateTarget.id}/move`, {
          newParentId: writeOnlyRootB.id,
          position: 0,
          expectedVersion: writeOnlyMoveTree.version,
          expectedPolicyRevision: writeOnlyMovePolicy.revision,
        });
      expect(writeOnlyMoved.statusCode).toBe(403);
      expect(writeOnlyMoved.json().code).toBe("AUTHORIZATION_DENIED");
      expect((await getTree(server, owner)).items.find(
        ({ document }) => document.id === writeOnlyUpdateTarget.id,
      )?.parentId).toBe(writeOnlyRootA.id);
      expect((await getTree(server, owner)).version).toBe(writeOnlyMoveTree.version);
      expect(resourceParent(await getPolicy(server, owner), documentResourceId(writeOnlyUpdateTarget.id)))
        .toBe(documentResourceId(writeOnlyRootA.id));

      // The response to an otherwise authorized move must not attempt to render
      // every unrelated (and unreadable) node after the commit.
      const isolatedRootA = await createDocumentAtEnd(server, owner, {
        title: "Isolated source",
        secret: "isolated-source",
      }, null);
      const isolatedRootB = await createDocumentAtEnd(server, owner, {
        title: "Isolated destination",
        secret: "isolated-destination",
      }, null);
      const isolatedChild = await createDocumentAtEnd(server, owner, {
        title: "Isolated child",
        secret: "isolated-child",
      }, isolatedRootA.id);
      const isolatedTreeBefore = await getTree(server, owner);
      const isolatedMovePolicy = await getPolicy(server, owner);
      const isolatedMoved = await mutate(server, owner, "POST",
        `/api/collections/col_m3_pages/documents/${isolatedChild.id}/move`, {
          newParentId: isolatedRootB.id,
          position: 0,
          expectedVersion: isolatedTreeBefore.version,
          expectedPolicyRevision: isolatedMovePolicy.revision,
        });
      expect(isolatedMoved.statusCode, isolatedMoved.body).toBe(200);
      expect(isolatedMoved.body).not.toContain(writeOnlyRootA.id);
      expect(isolatedMoved.body).not.toContain(writeOnlyUpdateTarget.id);
      expect((await getTree(server, owner)).items.find(
        ({ document }) => document.id === isolatedChild.id,
      )?.parentId).toBe(isolatedRootB.id);

      // Collection topology access must not disclose an unreadable ancestor in a
      // returned path, nor permit traversal rooted at an unreadable document.
      policy = await getPolicy(server, owner);
      policy = await createSubject(server, owner, policy, "M3 Traversal Reader");
      const traversalReader = required(policy.subjects.find(({ name }) => name === "M3 Traversal Reader"));
      await createLoginIdentity(database, schemaName, traversalReader.id, "m3traversalreader");
      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "M3 Traversal Read Role",
        description: "May inspect topology and read only one child",
        levelId: editorLevel.id,
        permissions: ["content.read"],
        delegatablePermissions: [],
        fieldAccess: [],
      });
      const traversalRole = required(policy.roles.find(({ name }) => name === "M3 Traversal Read Role"));
      for (const [resourceId, propagation] of [
        [collectionResourceId, "self"],
        [childResourceId, "self"],
      ] as const) {
        policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
          expectedPolicyRevision: policy.revision,
          subjectId: traversalReader.id,
          roleId: traversalRole.id,
          resourceId,
          propagation,
        });
      }
      const traversalSession = await login(server, "m3traversalreader", "admin");
      const childSubtree = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${child.id}/subtree`,
        headers: { cookie: traversalSession.cookie },
      });
      expect(childSubtree.statusCode, childSubtree.body).toBe(200);
      expect(childSubtree.body).not.toContain(rootA.id);
      expect(childSubtree.json().items).toHaveLength(1);
      expect(childSubtree.json().items[0].path).toEqual([child.id]);

      const unauthorizedTraversal = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${rootA.id}/descendants`,
        headers: { cookie: traversalSession.cookie },
      });
      expect(unauthorizedTraversal.statusCode).toBe(403);
      expect(unauthorizedTraversal.body).not.toContain(child.id);

      // A move can broaden fields without changing the boolean content.read
      // decision. The preview must surface title-only -> unrestricted explicitly.
      const restrictedFieldRoot = await createDocumentAtEnd(server, owner, {
        title: "Restricted field root",
        secret: "restricted-root-secret",
      }, null);
      const unrestrictedFieldRoot = await createDocumentAtEnd(server, owner, {
        title: "Unrestricted field root",
        secret: "unrestricted-root-secret",
      }, null);
      const fieldImpactChild = await createDocumentAtEnd(server, owner, {
        title: "Field impact child",
        secret: "field-impact-secret",
      }, restrictedFieldRoot.id);
      policy = await getPolicy(server, owner);
      policy = await createSubject(server, owner, policy, "M3 Field Impact Reader");
      const fieldImpactReader = required(policy.subjects.find(({ name }) => name === "M3 Field Impact Reader"));
      await createLoginIdentity(database, schemaName, fieldImpactReader.id, "m3fieldimpact");
      policy = await mutatePolicy(server, owner, "POST", "/api/authorization/roles", {
        expectedPolicyRevision: policy.revision,
        name: "M3 Moving Field Scope",
        description: "Restricted under one root and unrestricted under another",
        levelId: editorLevel.id,
        permissions: ["content.read"],
        delegatablePermissions: [],
        fieldAccess: [{
          resourceId: documentResourceId(restrictedFieldRoot.id),
          readableFields: ["title"],
          writableFields: [],
        }],
      });
      const fieldImpactRole = required(policy.roles.find(({ name }) => name === "M3 Moving Field Scope"));
      for (const resourceId of [
        documentResourceId(restrictedFieldRoot.id),
        documentResourceId(unrestrictedFieldRoot.id),
      ]) {
        policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
          expectedPolicyRevision: policy.revision,
          subjectId: fieldImpactReader.id,
          roleId: fieldImpactRole.id,
          resourceId,
          propagation: "self-and-children",
        });
      }
      const fieldImpactSession = await login(server, "m3fieldimpact", "admin");
      expect((await getDocument(server, fieldImpactSession, fieldImpactChild.id)).data).toEqual({
        title: "Field impact child",
      });
      const fieldImpactTree = await getTree(server, owner);
      const fieldImpactPreviewResponse = await mutate(server, owner, "POST",
        `/api/collections/col_m3_pages/documents/${fieldImpactChild.id}/move/preview`, {
          newParentId: unrestrictedFieldRoot.id,
          position: 0,
          expectedVersion: fieldImpactTree.version,
          expectedPolicyRevision: policy.revision,
        });
      expect(fieldImpactPreviewResponse.statusCode, fieldImpactPreviewResponse.body).toBe(200);
      const fieldImpactPreview = fieldImpactPreviewResponse.json() as MoveResult;
      expect(required(fieldImpactPreview.permissionImpact).effectiveFieldAccessChanges).toContainEqual({
        subjectId: fieldImpactReader.id,
        resourceId: documentResourceId(fieldImpactChild.id),
        operation: "read",
        beforeFields: ["title"],
        afterFields: null,
        change: "broadened",
      });
      expect(required(fieldImpactPreview.permissionImpact).effectivePermissionChangesTruncated).toBe(false);

      const treeBefore = await getTree(server, owner);
      const policyBeforePreview = await getPolicy(server, owner);
      const writerPreview = await mutate(server, writerSession, "POST",
        `/api/collections/col_m3_pages/documents/${child.id}/move/preview`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: treeBefore.version,
        });
      expect(writerPreview.statusCode).toBe(403);

      const writerMove = await mutate(server, writerSession, "POST",
        `/api/collections/col_m3_pages/documents/${child.id}/move`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: treeBefore.version,
          expectedPolicyRevision: policyBeforePreview.revision,
        });
      expect(writerMove.statusCode).toBe(403);
      expect((await getTree(server, owner)).version).toBe(treeBefore.version);

      const previewResponse = await mutate(server, owner, "POST",
        `/api/collections/col_m3_pages/documents/${child.id}/move/preview`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: treeBefore.version,
        });
      expect(previewResponse.statusCode, previewResponse.body).toBe(200);
      const preview = previewResponse.json() as MoveResult;
      const impact = required(preview.permissionImpact);
      expect(impact).toMatchObject({
        documentId: child.id,
        documentResourceId: childResourceId,
        beforeParentResourceId: rootAResourceId,
        afterParentResourceId: rootBResourceId,
        affectedDocumentIds: [child.id],
        affectedResourceIds: [childResourceId],
      });
      expect(preview.policyRevision).toBe(policyBeforePreview.revision);
      expect(impact.effectivePermissionChanges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          subjectId: writer.id,
          resourceId: childResourceId,
          permission: "content.read",
          beforeAllowed: true,
          afterAllowed: false,
          change: "revoked",
        }),
        expect.objectContaining({
          subjectId: writer.id,
          resourceId: childResourceId,
          permission: "content.update",
          beforeAllowed: true,
          afterAllowed: false,
          change: "revoked",
        }),
      ]));
      expect((await getTree(server, owner)).version).toBe(treeBefore.version);
      expect((await getPolicy(server, owner)).revision).toBe(policyBeforePreview.revision);

      const policyAfterConcurrentMutation = await createSubject(
        server,
        owner,
        policyBeforePreview,
        "M3 Preview Revision Racer",
      );
      const stalePolicyMove = await mutate(server, owner, "POST",
        `/api/collections/col_m3_pages/documents/${child.id}/move`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: treeBefore.version,
          expectedPolicyRevision: preview.policyRevision,
        });
      expect(stalePolicyMove.statusCode).toBe(409);
      expect(stalePolicyMove.json().code).toBe("POLICY_REVISION_CONFLICT");
      expect((await getTree(server, owner)).version).toBe(treeBefore.version);
      expect(resourceParent(await getPolicy(server, owner), childResourceId)).toBe(rootAResourceId);

      const refreshedPreviewResponse = await mutate(server, owner, "POST",
        `/api/collections/col_m3_pages/documents/${child.id}/move/preview`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: treeBefore.version,
        });
      expect(refreshedPreviewResponse.statusCode).toBe(200);
      const refreshedPreview = refreshedPreviewResponse.json() as MoveResult;
      expect(refreshedPreview.permissionImpact).not.toBeNull();
      expect(refreshedPreview.policyRevision).toBe(policyAfterConcurrentMutation.revision);

      const movedResponse = await mutate(server, owner, "POST",
        `/api/collections/col_m3_pages/documents/${child.id}/move`, {
          newParentId: rootB.id,
          position: 0,
          expectedVersion: treeBefore.version,
          expectedPolicyRevision: refreshedPreview.policyRevision,
        });
      expect(movedResponse.statusCode).toBe(200);
      const moved = movedResponse.json() as MoveResult;
      expect(moved.version).toBe(treeBefore.version + 1);
      expect(moved.permissionImpact).toMatchObject({
        documentId: child.id,
        beforeParentResourceId: rootAResourceId,
        afterParentResourceId: rootBResourceId,
      });
      const policyAfterMove = await getPolicy(server, owner);
      expect(policyAfterMove.revision).toBeGreaterThan(policyBeforePreview.revision);
      expect(resourceParent(policyAfterMove, childResourceId)).toBe(rootBResourceId);

      const deniedAfterMove = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${child.id}`,
        headers: { cookie: writerSession.cookie },
      });
      expect(deniedAfterMove.statusCode).toBe(403);
      const simulationAfterMove = await simulate(server, owner, {
        subjectId: writer.id,
        action: "content.read",
        resourceId: childResourceId,
      });
      expect(simulationAfterMove.allowed).toBe(false);
      expect(deniedAfterMove.json().details.decision.reasonCode).toBe(simulationAfterMove.reasonCode);

      const driftDocumentId = isolatedChild.id;
      const driftResourceId = documentResourceId(isolatedChild.id);
      const driftParentResourceId = documentResourceId(isolatedRootB.id);
      const driftClient = await database.pool.connect();
      try {
        await driftClient.query("BEGIN");
        await driftClient.query(
          `DELETE FROM ${qualifiedName(schemaName, "_xecms_auth_resources")}
           WHERE realm_id = 'rlm_system' AND id = $1`,
          [driftResourceId],
        );
        await driftClient.query(
          `UPDATE ${qualifiedName(schemaName, "_xecms_auth_policy_state")}
           SET current_revision = current_revision + 1
           WHERE realm_id = 'rlm_system'`,
        );
        await driftClient.query("COMMIT");
      } catch (error: unknown) {
        await driftClient.query("ROLLBACK");
        throw error;
      } finally {
        driftClient.release();
      }

      const missingProjection = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${driftDocumentId}`,
        headers: { cookie: owner.cookie },
      });
      expect(missingProjection.statusCode).toBe(403);
      expect(missingProjection.json()).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        details: { decision: { allowed: false } },
      });

      await server.app.close();
      server = undefined;
      server = await buildServer({ database, logger: false, config });
      const recovered = await server.app.inject({
        method: "GET",
        url: `/api/collections/col_m3_pages/documents/${driftDocumentId}`,
        headers: { cookie: owner.cookie },
      });
      expect(recovered.statusCode).toBe(200);
      expect(resourceParent(await getPolicy(server, owner), driftResourceId)).toBe(driftParentResourceId);

      // The projection fence is durable and therefore visible to every server
      // instance, not merely to the process that observed a reconcile failure.
      const secondServer = await buildServer({ database, logger: false, config });
      try {
        const ownerId = await ownerIdentityId(database, schemaName);
        await database.pool.query(
          `INSERT INTO ${qualifiedName(schemaName, "_xecms_auth_resource_quarantine")}
             (realm_id, resource_id, reason, quarantined_at, actor_subject_id)
           VALUES ('rlm_system', $1, 'acceptance-failure-fence', now(), $2)
           ON CONFLICT (realm_id, resource_id) DO UPDATE SET
             reason = EXCLUDED.reason,
             quarantined_at = EXCLUDED.quarantined_at,
             actor_subject_id = EXCLUDED.actor_subject_id`,
          [childResourceId, ownerId],
        );
        for (const instance of [server, secondServer]) {
          const fenced = await instance.app.inject({
            method: "GET",
            url: `/api/collections/col_m3_pages/documents/${child.id}`,
            headers: { cookie: owner.cookie },
          });
          expect(fenced.statusCode).toBe(503);
          expect(fenced.json().code).toBe("AUTHORIZATION_PROJECTION_UNAVAILABLE");
        }
        await database.pool.query(
          `DELETE FROM ${qualifiedName(schemaName, "_xecms_auth_resource_quarantine")}
           WHERE realm_id = 'rlm_system' AND resource_id = $1`,
          [childResourceId],
        );
        for (const instance of [server, secondServer]) {
          const released = await instance.app.inject({
            method: "GET",
            url: `/api/collections/col_m3_pages/documents/${child.id}`,
            headers: { cookie: owner.cookie },
          });
          expect(released.statusCode).toBe(200);
        }
      } finally {
        await secondServer.app.close();
      }

      // Disabling inheritance would make every document projection stale. If a
      // binding or field rule still references one of them, reject before commit
      // instead of silently cascading the security policy away.
      const activeSchemaBeforeDisable = await getActiveSchema(server, owner);
      const treeBeforeDisable = await getTree(server, owner);
      const policyBeforeDisable = await getPolicy(server, owner);
      const writerBindingBeforeDisable = required(policyBeforeDisable.bindings.find(
        ({ subjectId, roleId }) => subjectId === writer.id && roleId === scopedWriterRole.id,
      ));
      const writerRoleBeforeDisable = required(policyBeforeDisable.roles.find(
        ({ id }) => id === scopedWriterRole.id,
      ));
      const disableInheritance = await attemptPermissionInheritanceChange(server, owner, false);
      expect(disableInheritance.statusCode).toBe(409);
      expect(disableInheritance.json().code).toBe("HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED");

      const activeSchemaAfterDisable = await getActiveSchema(server, owner);
      expect(activeSchemaAfterDisable.revisionId).toBe(activeSchemaBeforeDisable.revisionId);
      expect(activeSchemaAfterDisable.schema).toEqual(activeSchemaBeforeDisable.schema);
      expect(await getTree(server, owner)).toEqual(treeBeforeDisable);
      const policyAfterDisable = await getPolicy(server, owner);
      expect(policyAfterDisable.revision).toBe(policyBeforeDisable.revision);
      expect(policyAfterDisable.bindings).toContainEqual(writerBindingBeforeDisable);
      expect(required(policyAfterDisable.roles.find(({ id }) => id === scopedWriterRole.id)).fieldAccess)
        .toEqual(writerRoleBeforeDisable.fieldAccess);
      expect(policyAfterDisable.resources.some(({ id }) => id === rootAResourceId)).toBe(true);
    } finally {
      await server?.app.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await database.close();
    }
  }, 180_000);

  it("rejects inheritance enablement over existing documents and referenced retired collection ID reuse before commit", async () => {
    const schemaName = `xecms_m3_schema_guard_${randomUUID().replaceAll("-", "_")}`;
    const database = new PostgresDatabase({
      connectionString: DATABASE_URL,
      schema: schemaName,
      maxConnections: 1,
    });
    const config = loadServerConfig({
      NODE_ENV: "development",
      DATABASE_URL,
      XECMS_DB_SCHEMA: schemaName,
      XECMS_SESSION_SECRET: "m3-schema-guard-session-secret-0123456789",
      XECMS_DEV_SEED: "true",
      XECMS_DEV_ADMIN_USERNAME: "admin",
      XECMS_DEV_ADMIN_PASSWORD: "admin",
      XECMS_ADMIN_DIST: "/definitely/not/a/built/admin",
    });
    let server: XeCmsServer | undefined;
    try {
      server = await buildServer({ database, logger: false, config });
      const owner = await login(server, "admin", "admin");
      await applyHierarchySchema(server, owner, false);

      const policyBeforeQueueTest = await getPolicy(server, owner);
      const [validMutation, ...unauthenticatedMutations] = await Promise.all([
        mutate(server, owner, "POST", "/api/authorization/subjects", {
          expectedPolicyRevision: policyBeforeQueueTest.revision,
          type: "user",
          name: "Max-one connection actor",
        }),
        ...Array.from({ length: 12 }, () => server!.app.inject({
          method: "POST",
          url: "/api/authorization/subjects",
          payload: {
            expectedPolicyRevision: policyBeforeQueueTest.revision,
            type: "user",
            name: "Unauthenticated lock waiter",
          },
        })),
      ]);
      expect(validMutation.statusCode, validMutation.body).toBe(201);
      expect(unauthenticatedMutations.every(({ statusCode }) => statusCode === 401)).toBe(true);

      await createDocument(server, owner, { title: "Existing flat document" }, null, 0, 0);

      const beforeEnable = await getActiveSchema(server, owner);
      const rejectedEnable = await attemptPermissionInheritanceChange(server, owner, true);
      expect(rejectedEnable.statusCode, rejectedEnable.body).toBe(409);
      expect(rejectedEnable.json().code).toBe("HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED");
      const afterEnable = await getActiveSchema(server, owner);
      expect(afterEnable.revisionId).toBe(beforeEnable.revisionId);
      expect(afterEnable.schema).toEqual(beforeEnable.schema);

      // Model a legacy retired collection which still has a policy reference.
      // A server restart clears the in-process policy cache so the preflight
      // observes the durable legacy rows exactly as another instance would.
      const policy = await getPolicy(server, owner);
      const viewer = required(policy.roles.find(({ name }) => name === "Viewer"));
      const ownerId = await ownerIdentityId(database, schemaName);
      const retiredCollectionId = "col_retired_readd";
      const retiredResourceId = `resource:collection:${retiredCollectionId}`;
      await database.pool.query(
        `INSERT INTO ${qualifiedName(schemaName, "_xecms_auth_resources")}
           (id, realm_id, name, resource_type, parent_id, protected, attributes,
            created_at, created_by, updated_at, updated_by)
         VALUES ($1, 'rlm_system', 'Retired collection', 'retired-collection',
                 'resource:content', false, '{}'::jsonb, now(), $2, now(), $2)`,
        [retiredResourceId, ownerId],
      );
      await database.pool.query(
        `INSERT INTO ${qualifiedName(schemaName, "_xecms_auth_role_bindings")}
           (id, realm_id, subject_id, role_id, resource_id, propagation, constraints,
            protected, created_at, created_by, updated_at, updated_by)
         VALUES ('binding:legacy-retired-collection', 'rlm_system', $1, $2, $3,
                 'self-and-children', '{}'::jsonb, false, now(), $1, now(), $1)`,
        [ownerId, viewer.id, retiredResourceId],
      );

      await server.app.close();
      server = await buildServer({ database, logger: false, config });
      const activeBeforeReuse = await getActiveSchema(server, owner);
      const draftResponse = await server.app.inject({
        method: "GET",
        url: "/api/schema/draft",
        headers: { cookie: owner.cookie },
      });
      const existingDraft = draftResponse.statusCode === 200
        ? draftResponse.json() as { readonly draftVersion: number } | null
        : null;
      const schema = structuredClone(activeBeforeReuse.schema) as unknown as {
        [key: string]: unknown;
        collections: Record<string, unknown>[];
      };
      schema.collections.push({
        id: retiredCollectionId,
        name: "retiredReadd",
        label: "Retired Re-add",
        fields: [{
          id: "fld_retired_readd_title",
          name: "title",
          label: "Title",
          type: "text",
          required: true,
        }],
      });
      const imported = await mutate(server, owner, "PUT", "/api/schema/manifest", {
        baseRevisionId: activeBeforeReuse.revisionId,
        expectedDraftVersion: existingDraft?.draftVersion ?? null,
        schema,
      });
      expect(imported.statusCode, imported.body).toBe(200);
      const preview = await mutate(server, owner, "POST", "/api/schema/preview", {
        expectedDraftVersion: imported.json().draftVersion,
      });
      expect(preview.statusCode, preview.body).toBe(200);
      const rejectedReuse = await mutate(server, owner, "POST", "/api/schema/apply", {
        planId: preview.json().planId,
        expectedRevisionId: activeBeforeReuse.revisionId,
        expectedDraftVersion: imported.json().draftVersion,
        approveDestructive: false,
      });
      expect(rejectedReuse.statusCode, rejectedReuse.body).toBe(409);
      expect(rejectedReuse.json().code).toBe("HIERARCHY_AUTHORIZATION_MIGRATION_REQUIRED");

      const activeAfterReuse = await getActiveSchema(server, owner);
      expect(activeAfterReuse.revisionId).toBe(activeBeforeReuse.revisionId);
      expect(activeAfterReuse.schema).toEqual(activeBeforeReuse.schema);
      const policyAfterReuse = await getPolicy(server, owner);
      expect(policyAfterReuse.resources.find(({ id }) => id === retiredResourceId)).toMatchObject({
        type: "retired-collection",
      });
      expect(policyAfterReuse.bindings.some(({ id }) => id === "binding:legacy-retired-collection"))
        .toBe(true);
    } finally {
      await server?.app.close();
      await database.pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await database.close();
    }
  }, 120_000);
});

async function login(server: XeCmsServer, username: string, password: string): Promise<Session> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return {
    cookie: String(response.headers["set-cookie"]).split(";", 1)[0] ?? "",
    csrfToken: response.json().csrfToken as string,
  };
}

async function applyHierarchySchema(
  server: XeCmsServer,
  owner: Session,
  permissionInheritance = true,
): Promise<void> {
  const imported = await mutate(server, owner, "PUT", "/api/schema/manifest", {
    baseRevisionId: null,
    expectedDraftVersion: null,
    schema: {
      format: "xecms.schema",
      formatVersion: 1,
      collections: [{
        id: "col_m3_pages",
        name: "m3Pages",
        label: "M3 Pages",
        hierarchy: {
          enabled: true,
          maxDepth: 4,
          ordering: "manual",
          permissionInheritance,
        },
        fields: [
          { id: "fld_m3_title", name: "title", label: "Title", type: "text", required: true },
          { id: "fld_m3_secret", name: "secret", label: "Secret", type: "text" },
        ],
      }],
    },
  });
  expect(imported.statusCode).toBe(200);
  const preview = await mutate(server, owner, "POST", "/api/schema/preview", {
    expectedDraftVersion: imported.json().draftVersion,
  });
  expect(preview.statusCode).toBe(200);
  const applied = await mutate(server, owner, "POST", "/api/schema/apply", {
    planId: preview.json().planId,
    expectedRevisionId: null,
    expectedDraftVersion: imported.json().draftVersion,
    approveDestructive: false,
  });
  expect(applied.statusCode).toBe(200);
}

async function createDocument(
  server: XeCmsServer,
  owner: Session,
  data: Readonly<Record<string, unknown>>,
  parentId: string | null,
  position: number,
  expectedVersion: number,
): Promise<DocumentRecord> {
  const response = await mutate(server, owner, "POST", "/api/collections/col_m3_pages/documents", {
    data,
    hierarchy: { parentId, position, expectedVersion },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as DocumentRecord;
}

async function createDocumentAtEnd(
  server: XeCmsServer,
  owner: Session,
  data: Readonly<Record<string, unknown>>,
  parentId: string | null,
): Promise<DocumentRecord> {
  const tree = await getTree(server, owner);
  return createDocument(
    server,
    owner,
    data,
    parentId,
    tree.items.filter((item) => item.parentId === parentId).length,
    tree.version,
  );
}

async function getDocument(
  server: XeCmsServer,
  session: Session,
  documentId: string,
): Promise<DocumentRecord> {
  const response = await server.app.inject({
    method: "GET",
    url: `/api/collections/col_m3_pages/documents/${documentId}`,
    headers: { cookie: session.cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DocumentRecord;
}

async function documentCountCreatedBy(
  database: PostgresDatabase,
  schemaName: string,
  subjectId: string,
): Promise<number> {
  const result = await database.pool.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count
     FROM ${qualifiedName(schemaName, "_xecms_documents")}
     WHERE created_by = $1`,
    [subjectId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function ownerIdentityId(database: PostgresDatabase, schemaName: string): Promise<string> {
  const result = await database.pool.query<{ readonly id: string }>(
    `SELECT id FROM ${qualifiedName(schemaName, "_xecms_identities")} WHERE is_owner = true`,
  );
  return required(result.rows[0]).id;
}

async function getActiveSchema(server: XeCmsServer, owner: Session): Promise<ActiveSchema> {
  const response = await server.app.inject({
    method: "GET",
    url: "/api/schema",
    headers: { cookie: owner.cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ActiveSchema;
}

async function attemptPermissionInheritanceChange(
  server: XeCmsServer,
  owner: Session,
  permissionInheritance: boolean,
): Promise<LightMyRequestResponse> {
  const active = await getActiveSchema(server, owner);
  const draftResponse = await server.app.inject({
    method: "GET",
    url: "/api/schema/draft",
    headers: { cookie: owner.cookie },
  });
  const existingDraft = draftResponse.statusCode === 200
    ? draftResponse.json() as { readonly draftVersion: number } | null
    : null;
  const expectedDraftVersion = existingDraft?.draftVersion ?? null;
  const schema = structuredClone(active.schema) as {
    [key: string]: unknown;
    collections: {
      [key: string]: unknown;
      id: string;
      hierarchy?: { [key: string]: unknown; permissionInheritance?: boolean };
    }[];
  };
  const collection = required(schema.collections.find(({ id }) => id === "col_m3_pages"));
  if (collection.hierarchy === undefined) throw new Error("Expected hierarchy configuration.");
  collection.hierarchy.permissionInheritance = permissionInheritance;
  const imported = await mutate(server, owner, "PUT", "/api/schema/manifest", {
    baseRevisionId: active.revisionId,
    expectedDraftVersion,
    schema,
  });
  expect(imported.statusCode, imported.body).toBe(200);
  const preview = await mutate(server, owner, "POST", "/api/schema/preview", {
    expectedDraftVersion: imported.json().draftVersion,
  });
  expect(preview.statusCode, preview.body).toBe(200);
  return mutate(server, owner, "POST", "/api/schema/apply", {
    planId: preview.json().planId,
    expectedRevisionId: active.revisionId,
    expectedDraftVersion: imported.json().draftVersion,
    approveDestructive: true,
  });
}

async function createSubject(
  server: XeCmsServer,
  owner: Session,
  policy: Policy,
  name: string,
): Promise<Policy> {
  return mutatePolicy(server, owner, "POST", "/api/authorization/subjects", {
    expectedPolicyRevision: policy.revision,
    type: "user",
    name,
  });
}

async function createLoginIdentity(
  database: PostgresDatabase,
  schemaName: string,
  id: string,
  username: string,
): Promise<void> {
  await database.pool.query(
    `INSERT INTO ${qualifiedName(schemaName, "_xecms_identities")}
       (id, workspace_id, realm_id, username, normalized_username, password_hash,
        is_owner, created_at, disabled_at)
     SELECT $1, workspace_id, realm_id, $2, $3, password_hash, false, now(), NULL
     FROM ${qualifiedName(schemaName, "_xecms_identities")}
     WHERE is_owner = true`,
    [id, username, username.toLocaleLowerCase("en-US")],
  );
  await database.pool.query(
    `UPDATE ${qualifiedName(schemaName, "_xecms_auth_subjects")}
        SET identity_id = $1, updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

async function assertSameLevelPeerCannotMutate(
  server: XeCmsServer,
  database: PostgresDatabase,
  schemaName: string,
  owner: Session,
  initialPolicy: Policy,
): Promise<Policy> {
  let policy = await createSubject(server, owner, initialPolicy, "M3 Content Administrator");
  const peer = required(policy.subjects.find(({ name }) => name === "M3 Content Administrator"));
  await createLoginIdentity(database, schemaName, peer.id, "m3contentadmin");
  const contentAdmin = required(policy.roles.find(({ name }) => name === "Content Administrator"));
  const securityAdmin = required(policy.roles.find(({ name }) => name === "Security Administrator"));
  policy = await mutatePolicy(server, owner, "POST", "/api/authorization/bindings", {
    expectedPolicyRevision: policy.revision,
    subjectId: peer.id,
    roleId: contentAdmin.id,
    resourceId: "resource:workspace",
    propagation: "self-and-children",
  });
  const peerSession = await login(server, "m3contentadmin", "admin");
  const peerPolicy = await getPolicy(server, peerSession);
  const denied = await mutate(server, peerSession, "PATCH",
    `/api/authorization/roles/${securityAdmin.id}`, {
      expectedPolicyRevision: peerPolicy.revision,
      name: securityAdmin.name,
      description: "same-level mutation attempt",
      levelId: securityAdmin.levelId,
      permissions: securityAdmin.permissions,
      delegatablePermissions: securityAdmin.delegatablePermissions,
      fieldAccess: securityAdmin.fieldAccess,
    });
  expect(denied.statusCode).toBe(403);
  expect(denied.json()).toMatchObject({
    code: "AUTHORIZATION_DENIED",
    details: { decision: { reasonCode: "TARGET_NOT_LOWER" } },
  });
  expect((await getPolicy(server, owner)).revision).toBe(policy.revision);
  return policy;
}

async function getPolicy(server: XeCmsServer, session: Session): Promise<Policy> {
  const response = await server.app.inject({
    method: "GET",
    url: "/api/authorization/policy",
    headers: { cookie: session.cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Policy;
}

async function getTree(server: XeCmsServer, session: Session): Promise<Tree> {
  const response = await server.app.inject({
    method: "GET",
    url: "/api/collections/col_m3_pages/tree",
    headers: { cookie: session.cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as Tree;
}

async function mutatePolicy(
  server: XeCmsServer,
  session: Session,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<Policy> {
  const response = await mutate(server, session, method, url, payload);
  expect([200, 201], response.body).toContain(response.statusCode);
  return response.json() as Policy;
}

async function simulate(
  server: XeCmsServer,
  owner: Session,
  payload: Readonly<Record<string, unknown>>,
): Promise<{ readonly allowed: boolean; readonly reasonCode: string; readonly policyRevision: number }> {
  const response = await mutate(server, owner, "POST", "/api/authorization/simulate", payload);
  expect(response.statusCode).toBe(200);
  return response.json() as { readonly allowed: boolean; readonly reasonCode: string; readonly policyRevision: number };
}

function mutate(
  server: XeCmsServer,
  session: Session,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<LightMyRequestResponse> {
  return server.app.inject({
    method,
    url,
    headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken },
    payload,
  });
}

function documentResourceId(documentId: string): string {
  return `resource:document:${documentId}`;
}

function resourceParent(policy: Policy, resourceId: string): string | undefined {
  return required(policy.resources.find(({ id }) => id === resourceId)).parentId;
}

function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}
