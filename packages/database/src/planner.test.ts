import { describe, expect, it } from "vitest";

import {
  asCollectionId,
  asComponentId,
  asFieldId,
  asRelationId,
  type CollectionAuthDefinition,
  type SchemaIrV1,
} from "@xecms/schema";

import { fieldColumnName } from "./identifiers.js";
import { PostgresMigrationPlanner } from "./planner.js";

const empty: SchemaIrV1 = {
  format: "xecms.schema",
  formatVersion: 1,
  collections: [],
};

const schema: SchemaIrV1 = {
  format: "xecms.schema",
  formatVersion: 1,
  components: [{
    id: asComponentId("cmp_card"),
    name: "card",
    fields: [{ id: asFieldId("fld_card_title"), name: "title", type: "text" }],
  }],
  collections: [{
    id: asCollectionId("col_pages"),
    name: "pages",
    fields: [
      { id: asFieldId("fld_body"), name: "body", type: "textarea" },
      { id: asFieldId("fld_date"), name: "date", type: "date" },
      {
        id: asFieldId("fld_tags"),
        name: "tags",
        type: "select",
        multiple: true,
        options: [{ label: "News", value: "news" }],
      },
      { id: asFieldId("fld_meta"), name: "meta", type: "json" },
      {
        id: asFieldId("fld_related"),
        name: "related",
        type: "relation",
        relationId: asRelationId("rel_related"),
        targetCollectionId: asCollectionId("col_pages"),
        cardinality: "many",
      },
      { id: asFieldId("fld_hero"), name: "hero", type: "upload" },
      {
        id: asFieldId("fld_card"),
        name: "card",
        type: "component",
        componentId: asComponentId("cmp_card"),
      },
      { id: asFieldId("fld_rich"), name: "rich", type: "rich-text" },
    ],
  }],
};

function authDefinition(
  overrides: Partial<CollectionAuthDefinition> = {},
): CollectionAuthDefinition {
  return {
    enabled: true,
    realmKey: "community",
    identifierFieldIds: [asFieldId("fld_member_email")],
    acceptSystemIdentities: true,
    provisioning: "explicit",
    defaultRoleIds: [],
    ...overrides,
  };
}

function profileSchema(auth: CollectionAuthDefinition | undefined): SchemaIrV1 {
  return {
    format: "xecms.schema",
    formatVersion: 1,
    collections: [{
      id: asCollectionId("col_members"),
      name: "members",
      fields: [
        {
          id: asFieldId("fld_member_email"),
          name: "email",
          type: "text",
          required: true,
          unique: true,
        },
        {
          id: asFieldId("fld_member_username"),
          name: "username",
          type: "text",
          required: true,
          unique: true,
        },
      ],
      ...(auth === undefined ? {} : { auth }),
    }],
  };
}

describe("M2 PostgreSQL schema planner", () => {
  it("plans physical storage for every broad M2 field family", () => {
    const [operation] = new PostgresMigrationPlanner("xecms_test").plan(empty, schema);
    const column = (id: string, type: string) => `"${fieldColumnName(id)}" ${type}`;
    expect(operation?.sql).toContain(column("fld_body", "text"));
    expect(operation?.sql).toContain(column("fld_date", "date"));
    expect(operation?.sql).toContain(column("fld_tags", "jsonb"));
    expect(operation?.sql).toContain(column("fld_meta", "jsonb"));
    expect(operation?.sql).toContain(column("fld_related", "jsonb"));
    expect(operation?.sql).toContain(column("fld_hero", "text"));
    expect(operation?.sql).toContain(column("fld_card", "jsonb"));
    expect(operation?.sql).toContain(column("fld_rich", "jsonb"));
  });

  it("adds a statement-free auth coordinator operation for a new profile collection", () => {
    const operations = new PostgresMigrationPlanner("xecms_test").plan(
      empty,
      profileSchema(authDefinition()),
    );
    const configure = operations.find(({ kind }) => kind === "configure-collection-auth");

    expect(operations.some(({ kind }) => kind === "create-table")).toBe(true);
    expect(configure).toEqual(expect.objectContaining({
      kind: "configure-collection-auth",
      severity: "risky",
      sql: "",
      statements: [],
      summary: expect.stringContaining("0013 store coordinator"),
    }));
  });

  it("classifies auth enable, policy, identifier, and disable operations", () => {
    const planner = new PostgresMigrationPlanner("xecms_test");
    const disabled = profileSchema(undefined);
    const enabled = profileSchema(authDefinition());
    const policyChanged = profileSchema(authDefinition({
      acceptSystemIdentities: false,
      provisioning: "jit",
      defaultRoleIds: ["role_member"],
    }));
    const identifierChanged = profileSchema(authDefinition({
      identifierFieldIds: [asFieldId("fld_member_username")],
    }));
    const realmChanged = profileSchema(authDefinition({ realmKey: "community-v2" }));
    const configure = (before: SchemaIrV1, after: SchemaIrV1) =>
      planner.plan(before, after).find(({ kind }) => kind === "configure-collection-auth");

    expect(configure(disabled, enabled)?.severity).toBe("risky");
    expect(configure(enabled, policyChanged)?.severity).toBe("risky");
    expect(configure(enabled, identifierChanged)?.severity).toBe("destructive");
    expect(configure(enabled, realmChanged)?.severity).toBe("destructive");
    expect(configure(enabled, disabled)?.severity).toBe("destructive");
    expect(configure(enabled, enabled)).toBeUndefined();
  });

  it("records Realm deconfiguration when an auth Collection is dropped", () => {
    const operations = new PostgresMigrationPlanner("xecms_test").plan(
      profileSchema(authDefinition()),
      empty,
    );

    expect(operations.find(({ kind }) => kind === "drop-table")?.severity).toBe("destructive");
    expect(operations.find(({ kind }) => kind === "configure-collection-auth")).toEqual(
      expect.objectContaining({ severity: "destructive", statements: [] }),
    );
  });

  it("produces the same plan for the same canonical schema", () => {
    const planner = new PostgresMigrationPlanner("xecms_test");
    expect(planner.plan(empty, schema)).toEqual(planner.plan(empty, schema));
  });

  it("removes hierarchy rows before disabling hierarchy or dropping a collection", () => {
    const hierarchical: SchemaIrV1 = {
      ...schema,
      collections: [{ ...schema.collections[0]!, hierarchy: { enabled: true } }],
    };
    const { hierarchy: _hierarchy, ...flatCollection } = hierarchical.collections[0]!;
    const flat: SchemaIrV1 = {
      ...schema,
      collections: [flatCollection],
    };
    const planner = new PostgresMigrationPlanner("xecms_test");

    const disabled = planner.plan(hierarchical, flat).find(({ kind }) => kind === "drop-hierarchy");
    expect(disabled?.severity).toBe("destructive");
    expect(disabled?.statements.map(({ sql }) => sql)).toEqual([
      expect.stringContaining("_xecms_content_hierarchy_nodes"),
      expect.stringContaining("_xecms_content_hierarchy_state"),
    ]);

    const [dropped] = planner.plan(hierarchical, empty);
    expect(dropped?.statements.map(({ sql }) => sql)).toEqual([
      expect.stringContaining("_xecms_content_hierarchy_nodes"),
      expect.stringContaining("_xecms_content_hierarchy_state"),
      expect.stringContaining("_xecms_documents"),
      expect.stringContaining("DROP TABLE"),
    ]);
  });
});
