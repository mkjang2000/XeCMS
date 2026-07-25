import { describe, expect, it } from "vitest";

import { createCoreMaskPolicyRegistry } from "./mask-policies.js";
import { projectProtectedValue, resolveOutputProtection } from "./output-protection.js";

const sensitiveEmail = {
  classification: "sensitive",
  defaultMaskPolicyId: "core.mask.email",
} as const;

describe("output protection", () => {
  it("implements denied, masked-read, full-read, and always-mask projection", () => {
    const denied = resolveOutputProtection({
      pageAllowed: false,
      pageUnmasked: false,
      output: { mode: "normal" },
    });
    expect(denied).toEqual({ exposure: "denied" });

    const masked = resolveOutputProtection({
      pageAllowed: true,
      pageUnmasked: false,
      fieldSensitivity: sensitiveEmail,
      output: { mode: "mask-when-required" },
    });
    expect(projectProtectedValue(createCoreMaskPolicyRegistry(), "alice@example.com", masked))
      .toBe("a****@e******.com");

    expect(resolveOutputProtection({
      pageAllowed: true,
      pageUnmasked: true,
      fieldSensitivity: sensitiveEmail,
      output: { mode: "mask-when-required" },
    })).toEqual({ exposure: "plain" });

    expect(resolveOutputProtection({
      pageAllowed: true,
      pageUnmasked: true,
      fieldSensitivity: sensitiveEmail,
      output: { mode: "always-mask" },
    })).toMatchObject({ exposure: "masked", maskPolicyId: "core.mask.email", source: "schema" });
  });

  it("prevents sensitive Field downgrade and policy replacement", () => {
    expect(() => resolveOutputProtection({
      pageAllowed: true,
      pageUnmasked: true,
      fieldSensitivity: sensitiveEmail,
      output: { mode: "normal" },
    })).toThrow(expect.objectContaining({ code: "OUTPUT_PROTECTION_REQUIRED" }));
    expect(() => resolveOutputProtection({
      pageAllowed: true,
      pageUnmasked: false,
      fieldSensitivity: sensitiveEmail,
      output: { mode: "always-mask", maskPolicyId: "core.mask.fixed" },
    })).toThrow(expect.objectContaining({ code: "OUTPUT_MASK_POLICY_CONFLICT" }));
  });
});
