import type { AdminAppAudience, AdminAppManifestV1 } from "./types.js";

export interface GeneratedAdminAppCollection {
  readonly id: string;
  readonly name: string;
  readonly label?: string;
  readonly kind?: "collection" | "singleton";
  readonly fields: readonly {
    readonly id: string;
    readonly name: string;
    readonly label?: string;
    readonly type: string;
  }[];
}

/** Generates the safe, editable baseline used by App Builder Basic mode. */
export function generateAdminAppManifest(input: {
  readonly id?: string;
  readonly name: string;
  readonly key: string;
  readonly audience: AdminAppAudience;
  readonly collections: readonly GeneratedAdminAppCollection[];
}): AdminAppManifestV1 {
  const pages: AdminAppManifestV1["pages"] = input.collections.length === 0
    ? [{ id: "overview", type: "dashboard", title: "Overview", widgets: [] }]
    : input.collections.flatMap((collection): AdminAppManifestV1["pages"] => {
      const slug = safeId(collection.name, collection.id);
      const visibleFields = collection.fields.slice(0, 4);
      const formNodes = (suffix: string) => [{
        id: `${slug}-${suffix}-section`,
        type: "section" as const,
        title: collection.label ?? collection.name,
        columns: 2 as const,
        children: collection.fields.map((field, index) => ({
          id: `${slug}-${suffix}-field-${index + 1}`,
          type: "field" as const,
          fieldId: field.id,
          width: "half" as const,
        })),
      }];
      const columns = [
        ...visibleFields.map((field, index) => ({
          id: `${slug}-column-${index + 1}`,
          field: { kind: "data" as const, fieldId: field.id },
          label: field.label ?? field.name,
        })),
        {
          id: `${slug}-updated`,
          field: { kind: "system" as const, field: "updatedAt" as const },
          label: "Updated",
        },
      ];
      if (collection.kind === "singleton") {
        return [{
          id: `${slug}-singleton`,
          type: "singleton" as const,
          collectionId: collection.id,
          title: collection.label ?? collection.name,
          layout: { nodes: formNodes("singleton") },
          actions: [
            { id: "core.action.create" },
            { id: "core.action.update" },
          ],
        }];
      }
      return [
        {
          id: `${slug}-list`,
          type: "collection-list" as const,
          collectionId: collection.id,
          title: collection.label ?? collection.name,
          columns,
          availableFilters: visibleFields.map((field, index) => ({
            id: `${slug}-filter-${index + 1}`,
            label: field.label ?? field.name,
            field: { kind: "data" as const, fieldId: field.id },
            operators: field.type === "text" || field.type === "textarea"
              ? ["contains" as const, "eq" as const]
              : ["eq" as const],
          })),
          defaultSort: [{
            field: { kind: "system" as const, field: "updatedAt" as const },
            direction: "desc" as const,
          }],
          rowClick: { pageId: `${slug}-detail`, documentIdFrom: "row" as const },
        },
        {
          id: `${slug}-create`,
          type: "document-form" as const,
          collectionId: collection.id,
          mode: "create" as const,
          layout: { nodes: formNodes("create") },
          actions: [{ id: "core.action.create" }],
        },
        {
          id: `${slug}-edit`,
          type: "document-form" as const,
          collectionId: collection.id,
          mode: "edit" as const,
          layout: { nodes: formNodes("edit") },
          actions: [{ id: "core.action.update" }],
        },
        {
          id: `${slug}-detail`,
          type: "document-detail" as const,
          collectionId: collection.id,
          title: `${collection.label ?? collection.name} detail`,
          layout: { panels: [
            { id: `${slug}-summary`, type: "summary" as const, fieldIds: collection.fields.map(({ id }) => id) },
            { id: `${slug}-revisions`, type: "revisions" as const },
          ] },
          actions: [
            { id: "core.action.update" },
            { id: "core.action.publish" },
            { id: "core.action.unpublish" },
            { id: "core.action.delete" },
            { id: "core.action.restore" },
          ],
        },
        {
          id: `${slug}-trash`,
          type: "collection-list" as const,
          collectionId: collection.id,
          title: `${collection.label ?? collection.name} 휴지통`,
          state: "deleted" as const,
          columns,
          defaultSort: [{
            field: { kind: "system" as const, field: "updatedAt" as const },
            direction: "desc" as const,
          }],
          rowClick: { pageId: `${slug}-detail`, documentIdFrom: "row" as const },
        },
      ];
    });
  const navigation = input.collections.length === 0
    ? [{ id: "overview-nav", label: "Overview", pageId: "overview" }]
    : input.collections.map((collection) => {
      const slug = safeId(collection.name, collection.id);
      if (collection.kind === "singleton") {
        return {
          id: `${slug}-singleton-nav`,
          label: collection.label ?? collection.name,
          pageId: `${slug}-singleton`,
        };
      }
      return {
        id: `${slug}-nav`,
        label: collection.label ?? collection.name,
        children: [
          { id: `${slug}-list-nav`, label: "목록", pageId: `${slug}-list` },
          { id: `${slug}-create-nav`, label: "새 문서", pageId: `${slug}-create` },
          { id: `${slug}-trash-nav`, label: "휴지통", pageId: `${slug}-trash` },
        ],
      };
    });
  return {
    format: "xecms.admin-app",
    formatVersion: 1,
    id: input.id ?? safeId(input.key, "admin-app"),
    name: input.name.trim(),
    key: input.key.trim(),
    audience: input.audience,
    navigation,
    pages,
    startPageId: pages[0]!.id,
  };
}

function safeId(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}
