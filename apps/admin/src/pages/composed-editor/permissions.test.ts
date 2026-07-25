import { describe, expect, it } from "vitest";
import type { ComposedPageDefinition } from "@xecms/admin-apps";

import { requiredPermissions } from "./permissions.js";

function pageWithActions(actions: readonly { readonly actionId: string; readonly collectionId?: string }[]): ComposedPageDefinition {
  return {
    id: "pg", type: "composed-page", screenNo: "S-1", title: "t", menuLabel: "t",
    layout: { columns: 48, rowHeight: 8 }, state: [], dataSources: [],
    components: [{
      id: "cmp_btn", kind: "core.button", placement: { x: 0, y: 0, width: 5, height: 5 }, props: {},
      events: [{
        id: "e1", event: "onClick",
        effects: actions.map((action, index) => ({
          id: `fx_${index}`, kind: "action.execute",
          args: { actionId: action.actionId, ...(action.collectionId === undefined ? {} : { collectionId: action.collectionId }) },
        })),
      }],
    }],
    connections: [],
  };
}

describe("requiredPermissions (Role Preview)", () => {
  it("maps built-in Actions to their content permissions with the target Collection", () => {
    const page = pageWithActions([
      { actionId: "core.action.create", collectionId: "col_x" },
      { actionId: "core.action.update", collectionId: "col_x" },
      { actionId: "core.action.delete", collectionId: "col_x" },
    ]);
    expect(requiredPermissions(page)).toEqual([
      { permission: "content.create", actionId: "core.action.create", collectionId: "col_x" },
      { permission: "content.update", actionId: "core.action.update", collectionId: "col_x" },
      { permission: "content.delete", actionId: "core.action.delete", collectionId: "col_x" },
    ]);
  });

  it("dedupes the same permission+Collection pair", () => {
    const page = pageWithActions([
      { actionId: "core.action.delete", collectionId: "col_x" },
      { actionId: "core.action.delete", collectionId: "col_x" },
    ]);
    expect(requiredPermissions(page)).toHaveLength(1);
  });

  it("ignores non-Action effects and unknown Action ids", () => {
    const page = pageWithActions([{ actionId: "core.action.teleport", collectionId: "col_x" }]);
    expect(requiredPermissions(page)).toEqual([]);
  });

  it("returns an empty list for a screen with no Actions", () => {
    const page = pageWithActions([]);
    // No effects at all still yields nothing.
    expect(requiredPermissions({ ...page, components: [] })).toEqual([]);
  });
});
