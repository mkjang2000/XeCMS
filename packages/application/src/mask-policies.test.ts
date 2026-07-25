import { describe, expect, it } from "vitest";

import { MaskPolicyRegistry, createCoreMaskPolicyRegistry } from "./mask-policies.js";

describe("MaskPolicyRegistry", () => {
  it("ships deterministic built-in policies without changing value containers", () => {
    const registry = createCoreMaskPolicyRegistry();

    expect(registry.apply("core.mask.fixed", "secret")).toBe("[MASKED]");
    expect(registry.apply("core.mask.partial", "123456", { keepStart: 1, keepEnd: 2 }))
      .toBe("1***56");
    expect(registry.apply("core.mask.email", "alice@example.com")).toBe("a****@e******.com");
    expect(registry.apply("core.mask.phone", "010-1234-5678")).toBe("***-****-5678");
    expect(registry.apply("core.mask.name", "홍길동")).toBe("홍**");
    expect(registry.apply("core.mask.name", ["홍길동", null])).toEqual(["홍**", null]);
  });

  it("validates policy ids, parameters, duplicate registration, and value types", () => {
    const registry = createCoreMaskPolicyRegistry();

    expect(() => registry.apply("unknown.mask", "secret"))
      .toThrow(expect.objectContaining({ code: "MASK_POLICY_NOT_FOUND" }));
    expect(() => registry.apply("core.mask.partial", "secret", { keepStart: 17 }))
      .toThrow(expect.objectContaining({ code: "MASK_POLICY_PARAMETERS_INVALID" }));
    expect(() => registry.apply("core.mask.email", "secret", { arbitrary: true }))
      .toThrow(expect.objectContaining({ code: "MASK_POLICY_PARAMETERS_INVALID" }));
    expect(() => registry.apply("core.mask.email", { raw: "secret" }))
      .toThrow(expect.objectContaining({ code: "MASK_POLICY_VALUE_TYPE_UNSUPPORTED" }));
    expect(() => registry.register(registry.list()[0]!)).toThrow(/already registered/);
    expect(() => new MaskPolicyRegistry([{ id: "bad", parameterSchema: {}, mask: (value) => value }]))
      .toThrow(/not canonical/);
  });
});
