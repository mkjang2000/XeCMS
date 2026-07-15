import {
  asCollectionId,
  asDocumentId,
  asRevisionId,
  asSchemaRevisionId,
  asSubjectId,
  asUtcInstant,
  asWorkspaceId,
  createDocument,
  createDraft,
  restoreRevision,
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
});
