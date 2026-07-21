import { parseSchema } from "./decode.js";
import type { CollectionDefinition, SchemaIrV1 } from "./types.js";

export type StarterName = "minimal" | "blog" | "community";

export interface StarterModuleDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
}

export interface StarterTemplateDefinition {
  readonly id: StarterName;
  readonly label: string;
  readonly description: string;
  readonly modules: readonly StarterModuleDefinition[];
}

export interface StarterCustomization {
  readonly enabledModuleIds?: readonly string[];
  readonly collectionLabels?: Readonly<Record<string, string>>;
}

export const STARTER_TEMPLATES: readonly StarterTemplateDefinition[] = Object.freeze([
  {
    id: "minimal",
    label: "빈 프로젝트",
    description: "컬렉션 없이 시작하고 Admin Studio에서 필요한 구조를 직접 만듭니다.",
    modules: [],
  },
  {
    id: "blog",
    label: "블로그",
    description: "게시글을 중심으로 카테고리와 페이지를 선택해 시작합니다.",
    modules: [
      { id: "categories", label: "카테고리", description: "게시글 분류와 카테고리 계층을 추가합니다.", defaultEnabled: true },
      { id: "pages", label: "페이지", description: "소개·약관 같은 계층형 고정 페이지를 추가합니다.", defaultEnabled: true },
    ],
  },
  {
    id: "community",
    label: "커뮤니티",
    description: "회원 인증 컬렉션을 만들고 커뮤니티 게시글을 선택해 시작합니다.",
    modules: [
      { id: "posts", label: "커뮤니티 게시글", description: "회원과 연결되는 게시글 컬렉션을 추가합니다.", defaultEnabled: true },
    ],
  },
]);

const minimal = { format: "xecms.schema", formatVersion: 1, collections: [] };
const blog = { format: "xecms.schema", formatVersion: 1, collections: [
  { id: "col_blog_categories", name: "categories", label: "Categories", hierarchy: { enabled: true, maxDepth: 3, ordering: "manual", slugPath: true }, fields: [{ id: "fld_blog_category_title", name: "title", label: "Title", type: "text", required: true, maxLength: 120 }, { id: "fld_blog_category_slug", name: "slug", label: "Slug", type: "text", required: true, unique: true, maxLength: 120 }] },
  { id: "col_blog_posts", name: "posts", label: "Posts", fields: [{ id: "fld_blog_post_title", name: "title", label: "Title", type: "text", required: true, maxLength: 200 }, { id: "fld_blog_post_slug", name: "slug", label: "Slug", type: "text", required: true, unique: true, maxLength: 200 }, { id: "fld_blog_post_excerpt", name: "excerpt", label: "Excerpt", type: "textarea", maxLength: 500 }, { id: "fld_blog_post_content", name: "content", label: "Content", type: "rich-text", required: true }, { id: "fld_blog_post_category", name: "category", label: "Category", type: "relation", relationId: "rel_blog_post_category", targetCollectionId: "col_blog_categories", cardinality: "one", onDelete: "nullify" }, { id: "fld_blog_post_cover", name: "cover", label: "Cover", type: "upload", acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"] }] },
  { id: "col_blog_pages", name: "pages", label: "Pages", hierarchy: { enabled: true, ordering: "manual", slugPath: true }, fields: [{ id: "fld_blog_page_title", name: "title", label: "Title", type: "text", required: true, maxLength: 200 }, { id: "fld_blog_page_slug", name: "slug", label: "Slug", type: "text", required: true, maxLength: 200 }, { id: "fld_blog_page_content", name: "content", label: "Content", type: "rich-text", required: true }] },
] };
const community = { format: "xecms.schema", formatVersion: 1, collections: [
  { id: "col_community_members", name: "members", label: "Members", auth: { enabled: true, realmKey: "community", identifierFieldIds: ["fld_community_member_email"], acceptSystemIdentities: true, provisioning: "explicit", defaultRoleIds: [] }, fields: [{ id: "fld_community_member_email", name: "email", label: "Email", type: "text", required: true, unique: true, maxLength: 254 }, { id: "fld_community_member_name", name: "displayName", label: "Display name", type: "text", required: true, maxLength: 80 }, { id: "fld_community_member_bio", name: "bio", label: "Bio", type: "textarea", maxLength: 1000 }] },
  { id: "col_community_posts", name: "posts", label: "Community Posts", fields: [{ id: "fld_community_post_title", name: "title", label: "Title", type: "text", required: true, maxLength: 200 }, { id: "fld_community_post_body", name: "body", label: "Body", type: "rich-text", required: true }, { id: "fld_community_post_author", name: "author", label: "Author", type: "relation", relationId: "rel_community_post_author", targetCollectionId: "col_community_members", cardinality: "one", onDelete: "restrict" }] },
] };

const raw: Record<StarterName, unknown> = { minimal, blog, community };

export function isStarterName(value: string): value is StarterName {
  return value === "minimal" || value === "blog" || value === "community";
}

export function starterTemplate(name: StarterName): StarterTemplateDefinition {
  return STARTER_TEMPLATES.find(({ id }) => id === name)!;
}

export function starterSchema(name: StarterName, customization: StarterCustomization = {}): SchemaIrV1 {
  const template = starterTemplate(name);
  const knownModules = new Set(template.modules.map(({ id }) => id));
  const enabledModules = new Set(
    customization.enabledModuleIds ?? template.modules.filter(({ defaultEnabled }) => defaultEnabled).map(({ id }) => id),
  );
  for (const moduleId of enabledModules) {
    if (!knownModules.has(moduleId)) throw new RangeError(`Unknown ${name} starter module '${moduleId}'.`);
  }

  const decoded = parseSchema(JSON.stringify(raw[name]));
  let collections = [...decoded.collections];
  if (name === "blog") {
    collections = collections
      .filter(({ id }) => id !== "col_blog_categories" || enabledModules.has("categories"))
      .filter(({ id }) => id !== "col_blog_pages" || enabledModules.has("pages"))
      .map((collection) => collection.id === "col_blog_posts" && !enabledModules.has("categories")
        ? { ...collection, fields: collection.fields.filter(({ id }) => id !== "fld_blog_post_category") }
        : collection);
  } else if (name === "community" && !enabledModules.has("posts")) {
    collections = collections.filter(({ id }) => id !== "col_community_posts");
  }

  collections = applyCollectionLabels(collections, customization.collectionLabels ?? {});
  return parseSchema(JSON.stringify({ ...decoded, collections }));
}

function applyCollectionLabels(
  collections: readonly CollectionDefinition[],
  labels: Readonly<Record<string, string>>,
): CollectionDefinition[] {
  const collectionIds = new Set(collections.map(({ id }) => String(id)));
  for (const [collectionId, label] of Object.entries(labels)) {
    if (!collectionIds.has(collectionId)) throw new RangeError(`Cannot customize unknown collection '${collectionId}'.`);
    const normalized = label.trim();
    if (normalized.length < 1 || normalized.length > 80) {
      throw new RangeError(`Collection label '${collectionId}' must be between 1 and 80 characters.`);
    }
  }
  return collections.map((collection) => {
    const label = labels[String(collection.id)]?.trim();
    return label === undefined ? collection : { ...collection, label };
  });
}
