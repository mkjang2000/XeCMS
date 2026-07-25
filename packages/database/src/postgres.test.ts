import {
  archiveDocument,
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  createDocument,
  createDraft,
  publishDocument,
  restoreRevision,
  softDeleteDocument,
  type JsonObject,
} from "@xecms/core";
import { describe, expect, it } from "vitest";

import { documentEventAuditPayload } from "./postgres.js";

describe("document event audit payload", () => {
  it("preserves revision metadata without retaining content data", () => {
    const created = createDocument<JsonObject>({
      documentId: asDocumentId("doc_audit"),
      workspaceId: asWorkspaceId("wrk_default"),
      collectionId: asCollectionId("col_posts"),
      revisionId: asRevisionId("rev_audit_1"),
      schemaRevisionId: asSchemaRevisionId("sch_audit_1"),
      data: { title: "content-that-must-not-survive-purge", nested: { secret: "private" } },
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:00:00.000Z"),
    });

    const drafted = createDraft(created.state, {
      revisionId: asRevisionId("rev_audit_2"),
      schemaRevisionId: asSchemaRevisionId("sch_audit_1"),
      data: { title: "draft-content-that-must-not-survive" },
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:01:00.000Z"),
      expectedVersion: 1,
    });
    const restored = restoreRevision(drafted.state, {
      sourceRevisionId: asRevisionId("rev_audit_1"),
      newRevisionId: asRevisionId("rev_audit_3"),
      schemaRevisionId: asSchemaRevisionId("sch_audit_2"),
      restoredData: { title: "restore-content-that-must-not-survive" },
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:02:00.000Z"),
      expectedVersion: 2,
    });
    const payloads = [created.events[0]!, drafted.events[0]!, restored.events[0]!].map(
      documentEventAuditPayload,
    );
    const serialized = JSON.stringify(payloads);

    expect(payloads[0]).toMatchObject({
      type: "document.created",
      revision: {
        id: "rev_audit_1",
        sequence: 1,
        schemaRevisionId: "sch_audit_1",
      },
    });
    expect(payloads[1]).toMatchObject({
      type: "document.draft-created",
      revision: { id: "rev_audit_2", sequence: 2, parentRevisionId: "rev_audit_1" },
    });
    expect(payloads[2]).toMatchObject({
      type: "document.revision-restored",
      revision: {
        id: "rev_audit_3",
        sequence: 3,
        schemaRevisionId: "sch_audit_2",
        origin: { kind: "restore", restoredFromRevisionId: "rev_audit_1" },
      },
    });
    expect(serialized).not.toContain('"data"');
    expect(serialized).not.toContain("content-that-must-not-survive-purge");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("draft-content-that-must-not-survive");
    expect(serialized).not.toContain("restore-content-that-must-not-survive");
  });

  it("keeps Schema-sensitive Field content out of lifecycle event audit payloads", () => {
    // CPB-0M masking invariant: no Document audit payload — content or lifecycle —
    // may retain a Field value. Sensitive originals are masked at the read
    // boundary and must never surface through published/archived/deleted audit.
    const created = createDocument<JsonObject>({
      documentId: asDocumentId("doc_sensitive"),
      workspaceId: asWorkspaceId("wrk_default"),
      collectionId: asCollectionId("col_people"),
      revisionId: asRevisionId("rev_sensitive_1"),
      schemaRevisionId: asSchemaRevisionId("sch_sensitive_1"),
      data: { email: "alice-secret@example.com", name: "Alice Secret" },
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:00:00.000Z"),
    });
    const drafted = createDraft(created.state, {
      revisionId: asRevisionId("rev_sensitive_2"),
      schemaRevisionId: asSchemaRevisionId("sch_sensitive_1"),
      data: { email: "alice-secret@example.com", name: "Alice Secret" },
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:01:00.000Z"),
      expectedVersion: 1,
    });
    const published = publishDocument(drafted.state, {
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:02:00.000Z"),
      expectedVersion: 2,
    });
    const archived = archiveDocument(published.state, {
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:03:00.000Z"),
      expectedVersion: 3,
    });
    const deleted = softDeleteDocument(published.state, {
      actorId: asSubjectId("subject_owner"),
      now: asUtcInstant("2026-07-15T00:04:00.000Z"),
      expectedVersion: 3,
    });

    const serialized = JSON.stringify([
      published.events[0]!,
      archived.events[0]!,
      deleted.events[0]!,
    ].map(documentEventAuditPayload));

    expect(serialized).not.toContain("alice-secret@example.com");
    expect(serialized).not.toContain("Alice Secret");
    expect(serialized).not.toContain('"data"');
  });
});
