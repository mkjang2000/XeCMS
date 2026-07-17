import { describe, expect, it } from "vitest";
import {
  accessAllowed,
  accessVisibility,
  allAccessAllowed,
  anyAccessAllowed,
  type AccessEvaluationProfile,
} from "./access.js";

const profile: AccessEvaluationProfile = {
  policyRevision: 4,
  items: [
    {
      id: "allowed",
      type: "permission",
      supported: true,
      decision: {
        allowed: true,
        action: "content.read",
        resourceId: "resource:content",
        reasonCode: "ALLOW_PERMISSION",
        policyRevision: 4,
      },
    },
    {
      id: "denied",
      type: "permission",
      supported: true,
      decision: {
        allowed: false,
        action: "content.update",
        resourceId: "resource:content",
        reasonCode: "NO_PERMISSION",
        policyRevision: 4,
      },
    },
    {
      id: "hierarchy",
      type: "permission",
      supported: false,
      decision: {
        allowed: false,
        action: "role.update",
        resourceId: "resource:authorization",
        reasonCode: "HIERARCHY_CONTEXT_REQUIRED",
        policyRevision: 4,
      },
    },
  ],
};

describe("Admin access visibility helpers", () => {
  it("keeps denied, unsupported, and missing checks distinct", () => {
    expect(accessVisibility(profile, "allowed")).toBe("allowed");
    expect(accessVisibility(profile, "denied")).toBe("denied");
    expect(accessVisibility(profile, "hierarchy")).toBe("unsupported");
    expect(accessVisibility(profile, "missing")).toBe("missing");
  });

  it("supports any/all visibility without treating unsupported as allowed", () => {
    expect(accessAllowed(profile, "allowed")).toBe(true);
    expect(anyAccessAllowed(profile, ["denied", "allowed"])).toBe(true);
    expect(anyAccessAllowed(profile, ["denied", "hierarchy"])).toBe(false);
    expect(allAccessAllowed(profile, ["allowed"])).toBe(true);
    expect(allAccessAllowed(profile, ["allowed", "denied"])).toBe(false);
    expect(allAccessAllowed(profile, [])).toBe(false);
  });
});
