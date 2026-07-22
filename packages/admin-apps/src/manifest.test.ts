import { describe, expect, it } from "vitest";

import {
  AdminAppManifestDecodeError,
  AdminAppManifestValidationError,
  decodeAdminAppManifest,
  diffAdminAppManifests,
  extractAdminAppDependencies,
  generateAdminAppManifest,
  hashAdminAppManifest,
  minimalBackofficeManifest,
  normalizeAdminAppManifest,
  parseAdminAppManifest,
  serializeAdminAppManifest,
  validateAdminAppManifest,
  type AdminAppManifestV1,
} from "./index.js";

type Mutable<T> = T extends readonly (infer TItem)[]
  ? Mutable<TItem>[]
  : T extends object
    ? { -readonly [TKey in keyof T]: Mutable<T[TKey]> }
    : T;

describe("Admin App Manifest V1 canonical contract", () => {
  it("round-trips the minimal Backoffice fixture without canonical drift", async () => {
    const normalized = normalizeAdminAppManifest(minimalBackofficeManifest);
    const serialized = serializeAdminAppManifest(normalized);
    const parsed = parseAdminAppManifest(serialized);

    expect(parsed).toEqual(normalized);
    expect(serializeAdminAppManifest(parsed)).toBe(serialized);
    expect(await hashAdminAppManifest(parsed)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates a valid editable list/form/detail baseline from Schema summaries", () => {
    const generated = generateAdminAppManifest({
      name: "Editorial Operations",
      key: "editorial-operations",
      audience: { type: "system" },
      collections: [{
        id: "col_articles",
        name: "articles",
        label: "Articles",
        fields: [
          { id: "fld_title", name: "title", label: "Title", type: "text" },
          { id: "fld_body", name: "body", label: "Body", type: "textarea" },
        ],
      }],
    });

    expect(() => decodeAdminAppManifest(generated)).not.toThrow();
    expect(generated.pages.map(({ type }) => type)).toEqual([
      "collection-list", "document-form", "document-form", "document-detail", "collection-list",
    ]);
    expect(generated.pages.at(-1)).toMatchObject({ state: "deleted" });
    expect(extractAdminAppDependencies(generated).collectionIds).toEqual(["col_articles"]);
  });

  it("generates create-or-edit UI for singleton collections", () => {
    const generated = generateAdminAppManifest({
      name: "Settings",
      key: "settings-app",
      audience: { type: "system" },
      collections: [{
        id: "col_settings",
        name: "settings",
        kind: "singleton",
        fields: [{ id: "fld_title", name: "title", type: "text" }],
      }],
    });

    expect(() => decodeAdminAppManifest(generated)).not.toThrow();
    expect(generated.pages).toEqual([expect.objectContaining({
      id: "settings-singleton",
      type: "singleton",
    })]);
  });

  it("produces identical canonical JSON and hash regardless of property insertion order", async () => {
    const reversed = reverseObjectKeys(minimalBackofficeManifest);
    const decoded = decodeAdminAppManifest(reversed);

    expect(serializeAdminAppManifest(decoded)).toBe(
      serializeAdminAppManifest(minimalBackofficeManifest),
    );
    expect(await hashAdminAppManifest(decoded)).toBe(
      await hashAdminAppManifest(minimalBackofficeManifest),
    );
  });

  it("returns detached normalized data and preserves user-visible array order", () => {
    const input = cloneFixture();
    deepFreeze(input);
    const normalized = normalizeAdminAppManifest(input);

    expect(normalized).not.toBe(input);
    expect(normalized.pages).not.toBe(input.pages);
    expect(normalized.pages.map(({ id }) => id)).toEqual(
      minimalBackofficeManifest.pages.map(({ id }) => id),
    );
  });
});

describe("Admin App Manifest V1 strict decoding", () => {
  it("rejects unknown properties at top-level and nested boundaries", () => {
    const topLevel = Object.assign(cloneFixture(), { unexpected: true });
    expectDecodeIssue(() => decodeAdminAppManifest(topLevel), "UNKNOWN_PROPERTY", ["unexpected"]);

    const nested = cloneFixture();
    Object.assign(nested.navigation[0]!, { href: "/unsafe" });
    expectDecodeIssue(
      () => decodeAdminAppManifest(nested),
      "UNKNOWN_PROPERTY",
      ["navigation", 0, "href"],
    );
  });

  it("rejects unknown page and layout discriminators", () => {
    const unknownPage = cloneFixture();
    Object.assign(unknownPage.pages[0]!, { type: "raw-html" });
    expectDecodeIssue(
      () => decodeAdminAppManifest(unknownPage),
      "UNKNOWN_PAGE_TYPE",
      ["pages", 0, "type"],
    );

    const unknownLayout = cloneFixture();
    const form = page(unknownLayout, "order-create", "document-form");
    Object.assign(form.layout.nodes[0]!, { type: "script" });
    expectDecodeIssue(
      () => decodeAdminAppManifest(unknownLayout),
      "UNKNOWN_LAYOUT_TYPE",
      ["pages", 2, "layout", "nodes", 0, "type"],
    );
  });

  it("rejects non-JSON and circular values before reading the contract", () => {
    const circular = cloneFixture();
    circular.navigation[0]!.children = [circular.navigation[0]!];
    expectDecodeIssue(() => decodeAdminAppManifest(circular), "INVALID_JSON_VALUE");

    const nonFinite = cloneFixture();
    const dashboard = page(nonFinite, "overview", "dashboard");
    dashboard.widgets[0]!.width = Number.POSITIVE_INFINITY as 1;
    expectDecodeIssue(() => decodeAdminAppManifest(nonFinite), "INVALID_JSON_VALUE");
  });

  it("rejects malformed JSON syntax", () => {
    expectDecodeIssue(() => parseAdminAppManifest("{not-json"), "INVALID_JSON_SYNTAX", []);
  });
});

describe("Admin App Manifest V1 semantic validation", () => {
  it("fails closed for unknown built-in actions and widgets", () => {
    const unknownAction = cloneFixture();
    const list = page(unknownAction, "order-list", "collection-list");
    list.rowActions![0]!.id = "core.action.execute-code";
    expectValidationIssue(
      () => decodeAdminAppManifest(unknownAction),
      "UNKNOWN_EXTENSION_REFERENCE",
      ["pages", 1, "rowActions", 0, "id"],
    );

    const unknownWidget = cloneFixture();
    const dashboard = page(unknownWidget, "overview", "dashboard");
    dashboard.widgets[0]!.widgetId = "core.widget.execute-code";
    expectValidationIssue(
      () => decodeAdminAppManifest(unknownWidget),
      "UNKNOWN_EXTENSION_REFERENCE",
      ["pages", 0, "widgets", 0, "widgetId"],
    );
  });

  it("accepts correctly namespaced Plugin actions, widgets, pages, panels and renderers", () => {
    const manifest = cloneFixture();
    page(manifest, "order-list", "collection-list").columns[0]!.rendererId =
      "sales.renderer.order-number";
    page(manifest, "order-list", "collection-list").rowActions!.push({
      id: "sales.action.capture-payment",
    });
    page(manifest, "overview", "dashboard").widgets.push({
      id: "sales-chart",
      widgetId: "sales.widget.revenue-chart",
    });
    page(manifest, "order-detail", "document-detail").layout.panels.push({
      id: "sales-timeline",
      type: "plugin",
      extensionId: "sales.panel.payment-timeline",
    });
    manifest.pages.push({
      id: "sales-report",
      type: "plugin-page",
      extensionId: "sales.page.revenue-report",
    });

    expect(() => decodeAdminAppManifest(manifest)).not.toThrow();
  });

  it("rejects duplicate IDs, missing start pages and navigation cycles", () => {
    const duplicate = cloneFixture();
    duplicate.pages[1]!.id = duplicate.pages[0]!.id;
    const duplicateResult = validateAdminAppManifest(duplicate);
    expect(duplicateResult.issues.map(({ code }) => code)).toContain("DUPLICATE_PAGE_ID");

    const missingStart = cloneFixture();
    missingStart.startPageId = "missing-page";
    expectValidationIssue(
      () => decodeAdminAppManifest(missingStart),
      "START_PAGE_NOT_FOUND",
      ["startPageId"],
    );

    const cyclic = cloneFixture();
    cyclic.navigation[0]!.children = [cyclic.navigation[0]!];
    const cycleResult = validateAdminAppManifest(cyclic);
    expect(cycleResult.issues.map(({ code }) => code)).toContain("NAVIGATION_CYCLE");
  });

  it("enforces filter AST value shape and complexity boundaries", () => {
    const emptyGroup = cloneFixture();
    page(emptyGroup, "order-list", "collection-list").fixedFilter = {
      type: "group",
      operator: "and",
      filters: [],
    };
    expectValidationIssue(() => decodeAdminAppManifest(emptyGroup), "EMPTY_FILTER_GROUP");

    const invalidIn = cloneFixture();
    page(invalidIn, "order-list", "collection-list").fixedFilter = {
      type: "condition",
      field: { kind: "data", fieldId: "fld_customer_name" },
      operator: "in",
      value: "Ada",
    };
    expectValidationIssue(() => decodeAdminAppManifest(invalidIn), "FILTER_ARRAY_REQUIRED");
  });
});

describe("Admin App Manifest V1 analysis", () => {
  it("extracts sorted and deduplicated external dependencies", () => {
    const dependencies = extractAdminAppDependencies(minimalBackofficeManifest);

    expect(dependencies).toEqual({
      audienceRealmIds: [],
      collectionIds: ["col_orders", "col_workspace_settings"],
      fieldIds: ["fld_customer_name", "fld_order_number", "fld_workspace_name"],
      relationIds: [],
      actionIds: [
        "core.action.archive",
        "core.action.create",
        "core.action.export",
        "core.action.update",
      ],
      widgetIds: ["core.widget.quick-action", "core.widget.recent-documents"],
      rendererIds: ["core.renderer.date"],
      extensionIds: [],
      pluginIds: [],
      permissionReferences: [
        { action: "content.create", resourceId: "resource:collection:col_orders" },
      ],
      resourceIds: ["resource:collection:col_orders"],
    });
  });

  it("records Plugin IDs and extension IDs separately", () => {
    const manifest = cloneFixture();
    page(manifest, "order-list", "collection-list").rowActions!.push({
      id: "sales.action.capture-payment",
    });
    page(manifest, "overview", "dashboard").widgets.push({
      id: "sales-chart",
      widgetId: "sales.widget.revenue-chart",
    });

    const dependencies = extractAdminAppDependencies(manifest);
    expect(dependencies.pluginIds).toEqual(["sales"]);
    expect(dependencies.extensionIds).toEqual([
      "sales.action.capture-payment",
      "sales.widget.revenue-chart",
    ]);
  });

  it("returns stable, path-addressable manifest differences", () => {
    const after = cloneFixture();
    after.name = "Operations Backoffice";
    page(after, "order-list", "collection-list").rowActions![0]!.label = "Edit";

    const diff = diffAdminAppManifests(minimalBackofficeManifest, after);
    expect(diff.changed).toBe(true);
    expect(diff.entries).toEqual([
      {
        kind: "changed",
        path: ["name"],
        before: "Backoffice",
        after: "Operations Backoffice",
      },
      {
        kind: "added",
        path: ["pages", 1, "rowActions", 0, "label"],
        after: "Edit",
      },
    ]);
    expect(diffAdminAppManifests(after, clone(after))).toEqual({ changed: false, entries: [] });
  });
});

function cloneFixture(): Mutable<AdminAppManifestV1> {
  return clone(minimalBackofficeManifest) as unknown as Mutable<AdminAppManifestV1>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function page<
  TType extends AdminAppManifestV1["pages"][number]["type"],
>(
  manifest: Mutable<AdminAppManifestV1>,
  id: string,
  type: TType,
): Extract<Mutable<AdminAppManifestV1>["pages"][number], { type: TType }> {
  const found = manifest.pages.find((candidate) => candidate.id === id);
  if (found === undefined || found.type !== type) throw new Error(`Missing ${type} page '${id}'.`);
  return found as Extract<Mutable<AdminAppManifestV1>["pages"][number], { type: TType }>;
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseObjectKeys(child)]),
    );
  }
  return value;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(deepFreeze);
  Object.freeze(value);
}

function expectDecodeIssue(
  operation: () => unknown,
  code: string,
  path?: readonly (string | number)[],
): void {
  try {
    operation();
    throw new Error("Expected decode operation to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AdminAppManifestDecodeError);
    const manifestError = error as AdminAppManifestDecodeError;
    expect(manifestError.issues.map((issue) => issue.code)).toContain(code);
    if (path !== undefined) expect(manifestError.issues[0]?.path).toEqual(path);
  }
}

function expectValidationIssue(
  operation: () => unknown,
  code: string,
  path?: readonly (string | number)[],
): void {
  try {
    operation();
    throw new Error("Expected validation operation to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AdminAppManifestValidationError);
    const manifestError = error as AdminAppManifestValidationError;
    const issue = manifestError.issues.find((candidate) => candidate.code === code);
    expect(issue).toBeDefined();
    if (path !== undefined) expect(issue?.path).toEqual(path);
  }
}
