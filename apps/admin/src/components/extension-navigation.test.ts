import { describe, expect, it } from "vitest";
import { extensionNavigationItems } from "./extension-navigation.js";

describe("optional extension navigation", () => {
  it("has no built-in builder entry and uses only advertised administrative links", () => {
    expect(extensionNavigationItems([])).toEqual([]);
    expect(extensionNavigationItems([
      { id: "server-only", name: "Server only" },
      { id: "orders", name: "Orders", admin: { href: "/extensions/orders", label: "Orders" } },
    ])).toEqual([{ id: "orders", href: "/extensions/orders", label: "Orders" }]);
  });

  it("supports a separate development origin and rejects executable URL schemes", () => {
    expect(extensionNavigationItems([
      { id: "local", name: "Local", admin: { href: "http://127.0.0.1:5174/admin/apps", label: "Builder" } },
      { id: "invalid", name: "Invalid", admin: { href: "javascript:alert(1)", label: "Invalid" } },
      { id: "relative-host", name: "Invalid", admin: { href: "//example.com", label: "Invalid" } },
    ])).toEqual([{ id: "local", href: "http://127.0.0.1:5174/admin/apps", label: "Builder" }]);
  });
});
