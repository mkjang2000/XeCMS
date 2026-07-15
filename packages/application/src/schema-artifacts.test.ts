import { createHash } from "node:crypto";
import {
  asCollectionId,
  asComponentId,
  asFieldId,
  type SchemaIrV1,
} from "@xecms/schema";
import { describe, expect, it } from "vitest";

import { ApplicationError, type ActorContext } from "./errors.js";
import {
  SCHEMA_MANIFEST_FILE_NAME,
  SchemaArtifactApplicationService,
  createSchemaManifestArtifact,
  createSchemaTypesArtifact,
  importSchemaManifest,
} from "./schema-artifacts.js";
import type { SchemaDraftRecord, SchemaRevisionRecord, SchemaStore } from "./schema.js";

const NOW = "2026-07-15T12:00:00.000Z";
const actor: ActorContext = {
  subjectId: "subject_owner",
  workspaceId: "wrk_default",
  capabilities: ["schema:read", "schema:write"],
};

function artifactSchema(): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    components: [
      {
        id: asComponentId("cmp_seo"),
        name: "seo",
        fields: [{ id: asFieldId("fld_description"), name: "description", type: "textarea" }],
      },
    ],
    collections: [
      {
        id: asCollectionId("col_settings"),
        name: "settings",
        kind: "singleton",
        fields: [
          {
            id: asFieldId("fld_seo"),
            name: "seo",
            type: "component",
            componentId: asComponentId("cmp_seo"),
          },
        ],
      },
    ],
  };
}

describe("Schema artifacts", () => {
  it("exports canonical Registry-compatible content and imports it without drift", () => {
    const artifact = createSchemaManifestArtifact(artifactSchema());
    expect(artifact.fileName).toBe(SCHEMA_MANIFEST_FILE_NAME);
    expect(artifact.hash).toBe(createHash("sha256").update(artifact.contents).digest("hex"));

    const imported = importSchemaManifest(artifact.contents);
    expect(imported.contents).toBe(artifact.contents);
    expect(imported.hash).toBe(artifact.hash);
    expect(imported.schema).toEqual(artifactSchema());
  });

  it("canonicalizes optional defaults and rejects malformed manifests with structured issues", () => {
    const raw = JSON.stringify({
      ...artifactSchema(),
      components: artifactSchema().components,
      collections: [
        {
          ...artifactSchema().collections[0],
          kind: "singleton",
          fields: [
            {
              ...artifactSchema().collections[0]!.fields[0],
              required: false,
              repeatable: false,
            },
          ],
        },
      ],
    });
    expect(importSchemaManifest(raw).contents).not.toContain('"required"');
    expect(importSchemaManifest(raw).contents).not.toContain('"repeatable"');

    expect(() => importSchemaManifest("{")).toThrowError(
      expect.objectContaining({ code: "SCHEMA_MANIFEST_INVALID", status: 422 }),
    );
  });

  it("generates byte-reproducible type artifacts linked to the source manifest hash", () => {
    const first = createSchemaTypesArtifact(artifactSchema());
    const second = createSchemaTypesArtifact(artifactSchema());
    expect(second).toEqual(first);
    expect(first.sourceSchemaHash).toBe(createSchemaManifestArtifact(artifactSchema()).hash);
  });

  it("imports through the optimistic draft store and enforces read/write capability", async () => {
    const store = new MemoryArtifactStore(artifactSchema());
    const service = new SchemaArtifactApplicationService(store, () => NOW);
    const artifact = await service.exportManifest(actor);
    const result = await service.importManifest(actor, {
      contents: artifact.contents,
      baseRevisionId: "sch_active",
      expectedDraftVersion: null,
    });

    expect(result.manifest).toEqual(artifact);
    expect(result.draft).toMatchObject({
      baseRevisionId: "sch_active",
      draftVersion: "drf_imported",
      updatedBy: actor.subjectId,
    });
    expect((await service.generateTypes(actor, "draft")).contents).toContain(
      "export interface SettingsDocument",
    );

    const denied = { ...actor, capabilities: [] };
    await expect(service.exportManifest(denied)).rejects.toBeInstanceOf(ApplicationError);
    await expect(
      service.importManifest(denied, {
        contents: artifact.contents,
        baseRevisionId: "sch_active",
        expectedDraftVersion: "drf_imported",
      }),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", status: 403 });
  });
});

class MemoryArtifactStore
  implements Pick<SchemaStore, "getActiveSchema" | "getSchemaDraft" | "saveSchemaDraft">
{
  private draft: SchemaDraftRecord | null = null;

  public constructor(private readonly schema: SchemaIrV1) {}

  public async getActiveSchema(): Promise<SchemaRevisionRecord> {
    return {
      revisionId: "sch_active",
      parentRevisionId: null,
      schema: this.schema,
      createdAt: NOW,
      createdBy: actor.subjectId,
      hash: createSchemaManifestArtifact(this.schema).hash,
    };
  }

  public async getSchemaDraft(): Promise<SchemaDraftRecord | null> {
    return this.draft;
  }

  public async saveSchemaDraft(input: Parameters<SchemaStore["saveSchemaDraft"]>[0]): Promise<SchemaDraftRecord> {
    if (input.baseRevisionId !== "sch_active" || input.expectedDraftVersion !== this.draft?.draftVersion && input.expectedDraftVersion !== null) {
      throw new Error("draft conflict");
    }
    this.draft = {
      baseRevisionId: input.baseRevisionId,
      draftVersion: "drf_imported",
      schema: input.schema,
      updatedAt: input.now,
      updatedBy: input.actorId,
    };
    return this.draft;
  }
}

