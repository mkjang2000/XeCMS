import { describe, expect, it } from "vitest";
import type { AccessEvaluationProfile } from "@xecms/admin";
import { visibleNavigationItems } from "./app-shell.js";

function profile(allowedIds: readonly string[]): AccessEvaluationProfile {
  return {
    policyRevision: 12,
    items: allowedIds.map((id) => ({
      id,
      type: "permission" as const,
      supported: true,
      decision: {
        allowed: true,
        action: "test.read",
        resourceId: "resource:test",
        reasonCode: "ALLOW_PERMISSION",
        policyRevision: 12,
      },
    })),
  };
}

describe("Admin navigation access visibility", () => {
  it("requires both content and schema reads for the current content collection screen", () => {
    expect(visibleNavigationItems("advanced", profile(["nav.content.list"]))
      .some(({ to }) => to === "/admin/content")).toBe(false);
    expect(visibleNavigationItems("advanced", profile([
      "nav.content.list",
      "nav.content.schema",
    ])).some(({ to }) => to === "/admin/content")).toBe(true);
  });

  it("combines display mode with any-of access for composite sections", () => {
    const access = profile(["nav.operations.retention", "nav.settings.sites"]);

    expect(visibleNavigationItems("basic", access).map(({ to }) => to))
      .toEqual(["/admin/settings"]);
    expect(visibleNavigationItems("advanced", access).map(({ to }) => to))
      .toEqual(["/admin/operations", "/admin/settings"]);
  });
});
