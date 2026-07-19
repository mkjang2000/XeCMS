import { describe, expect, it } from "vitest";
import { decisionReasonName } from "./vocabulary.js";

describe("decisionReasonName", () => {
  it("labels the entitlement gate denial distinctly from a plain policy denial", () => {
    const gate = decisionReasonName("DENY_ENTITLEMENT_GATE");
    const policy = decisionReasonName("DENY_PERMISSION");
    expect(gate).toContain("CMS");
    expect(gate).not.toBe(policy);
    // Unresolved content resource also gets its own explanation.
    expect(decisionReasonName("ENTITLEMENT_RESOURCE_UNRESOLVED")).toContain("확인할 수 없");
  });

  it("falls back for unknown reason codes", () => {
    expect(decisionReasonName("SOMETHING_NEW")).toBe("현재 정책 조건에 따라 판정되었습니다.");
  });
});
