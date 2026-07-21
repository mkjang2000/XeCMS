import { describe, expect, it } from "vitest";
import { starterSchema } from "./starters.js";

describe("starter templates", () => {
  it("preserves the complete CLI starter when no customization is supplied", () => {
    expect(starterSchema("minimal").collections).toHaveLength(0);
    expect(starterSchema("blog").collections.map(({ id }) => id)).toEqual([
      "col_blog_categories", "col_blog_posts", "col_blog_pages",
    ]);
    expect(starterSchema("community").collections).toHaveLength(2);
  });

  it("removes optional modules and their dependent relation fields", () => {
    const blog = starterSchema("blog", { enabledModuleIds: [] });
    expect(blog.collections.map(({ id }) => id)).toEqual(["col_blog_posts"]);
    expect(blog.collections[0]?.fields.some(({ id }) => id === "fld_blog_post_category")).toBe(false);
    expect(starterSchema("community", { enabledModuleIds: [] }).collections.map(({ id }) => id))
      .toEqual(["col_community_members"]);
  });

  it("allows display-label customization without changing technical names", () => {
    const schema = starterSchema("blog", {
      enabledModuleIds: ["pages"],
      collectionLabels: { col_blog_posts: "게시물", col_blog_pages: "고정 페이지" },
    });
    expect(schema.collections.map(({ name, label }) => [name, label])).toEqual([
      ["posts", "게시물"], ["pages", "고정 페이지"],
    ]);
  });

  it("rejects customization outside the setup allowlist", () => {
    expect(() => starterSchema("blog", { enabledModuleIds: ["unknown"] })).toThrow(/Unknown/);
    expect(() => starterSchema("blog", { collectionLabels: { missing: "Nope" } })).toThrow(/unknown collection/);
    expect(() => starterSchema("blog", { collectionLabels: { col_blog_posts: " " } })).toThrow(/between 1 and 80/);
  });
});
