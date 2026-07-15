import { describe, expect, it } from "vitest";
import {
  asCollectionId,
  asFieldId,
  type SchemaIrV1,
} from "@xecms/schema";

import type { ActorContext } from "./errors.js";
import {
  SchemaApplicationService,
  type MigrationOperation,
  type MigrationPlanner,
  type SchemaDraftRecord,
  type SchemaRevisionRecord,
  type SchemaStore,
} from "./schema.js";

const actor: ActorContext = {
  subjectId: "identity_owner",
  workspaceId: "workspace_default",
  capabilities: ["schema:read"],
};

const activeSchema: SchemaIrV1 = {
  format: "xecms.schema",
  formatVersion: 1,
  collections: [{
    id: asCollectionId("col_members"),
    name: "members",
    fields: [{
      id: asFieldId("fld_member_email"),
      name: "email",
      type: "text",
      required: true,
      unique: true,
    }],
  }],
};

const draftSchema: SchemaIrV1 = {
  ...activeSchema,
  collections: [{
    ...activeSchema.collections[0]!,
    auth: {
      enabled: true,
      realmKey: "community",
      identifierFieldIds: [asFieldId("fld_member_email")],
      acceptSystemIdentities: true,
      provisioning: "explicit",
      defaultRoleIds: [],
    },
  }],
};

const active: SchemaRevisionRecord = {
  revisionId: "schema_active",
  parentRevisionId: null,
  schema: activeSchema,
  createdAt: "2026-07-15T00:00:00.000Z",
  createdBy: actor.subjectId,
  hash: "active-hash",
};

const draft: SchemaDraftRecord = {
  baseRevisionId: active.revisionId,
  draftVersion: "draft-auth-v1",
  schema: draftSchema,
  updatedAt: "2026-07-15T00:01:00.000Z",
  updatedBy: actor.subjectId,
};

const configureAuth: MigrationOperation = {
  id: "op_configure_auth",
  kind: "configure-collection-auth",
  summary: "Configure Content Realm auth. Actual Realm materialization is handled by the 0013 store coordinator.",
  severity: "risky",
  sql: "",
};

function serviceWith(operations: readonly MigrationOperation[]) {
  const store = {
    getActiveSchema: async () => active,
    getSchemaDraft: async () => draft,
  } as unknown as SchemaStore;
  const planner: MigrationPlanner = { plan: () => operations };
  return new SchemaApplicationService(store, planner, () => "2026-07-15T00:02:00.000Z");
}

describe("Schema auth migration preview", () => {
  it("includes statement-free logical operations in preview and its approval hash", async () => {
    const withCoordinator = await serviceWith([configureAuth]).preview(actor, {
      expectedDraftVersion: draft.draftVersion,
    });
    const withoutCoordinator = await serviceWith([]).preview(actor, {
      expectedDraftVersion: draft.draftVersion,
    });

    expect(withCoordinator.operations).toEqual([configureAuth]);
    expect(withCoordinator.changes).toContainEqual(expect.objectContaining({
      kind: "collection-auth-changed",
      severity: "risky",
    }));
    expect(withCoordinator.requiresDestructiveApproval).toBe(false);
    expect(withCoordinator.planId).not.toBe(withoutCoordinator.planId);
  });

  it("lets a destructive logical operation require explicit approval without SQL", async () => {
    const preview = await serviceWith([{ ...configureAuth, severity: "destructive" }]).preview(
      actor,
      { expectedDraftVersion: draft.draftVersion },
    );

    expect(preview.operations[0]?.sql).toBe("");
    expect(preview.requiresDestructiveApproval).toBe(true);
  });
});
