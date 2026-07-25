import { describe, expect, it } from "vitest";

import {
  fieldProtectionRules,
  projectDocumentData,
  type FieldProtectionRule,
} from "./document-projection.js";
import { createCoreMaskPolicyRegistry } from "./mask-policies.js";

const registry = createCoreMaskPolicyRegistry();

const sensitiveEmail = {
  classification: "sensitive",
  defaultMaskPolicyId: "core.mask.email",
} as const;

describe("document projection boundary", () => {
  it("masks a Schema-sensitive Field for masked-read and reveals it for full-read", () => {
    const rules: readonly FieldProtectionRule[] = [
      { fieldName: "name", output: { mode: "normal" } },
      { fieldName: "email", sensitivity: sensitiveEmail, output: { mode: "mask-when-required" } },
    ];
    const data = { name: "Alice", email: "alice@example.com" };

    const masked = projectDocumentData({
      registry, data, pageAllowed: true, pageUnmasked: false, rules,
    });
    expect(masked).toEqual({ name: "Alice", email: "a****@e******.com" });

    const full = projectDocumentData({
      registry, data, pageAllowed: true, pageUnmasked: true, rules,
    });
    expect(full).toEqual({ name: "Alice", email: "alice@example.com" });
  });

  it("defaults a sensitive Field with no output binding to always-mask", () => {
    const rules = fieldProtectionRules([
      { name: "email", sensitivity: sensitiveEmail },
      { name: "note" },
    ]);
    // Only the sensitive Field needs a rule; the plain one passes through.
    expect(rules).toEqual([{ fieldName: "email", sensitivity: sensitiveEmail }]);

    const projected = projectDocumentData({
      registry,
      data: { email: "bob@example.com", note: "vip" },
      pageAllowed: true,
      pageUnmasked: true, // even a full-read user cannot unmask an unbound sensitive Field
      rules,
    });
    expect(projected).toEqual({ email: "b**@e******.com", note: "vip" });
  });

  it("always-mask stays masked regardless of unmask permission", () => {
    const rules: readonly FieldProtectionRule[] = [
      { fieldName: "email", sensitivity: sensitiveEmail, output: { mode: "always-mask" } },
    ];
    const projected = projectDocumentData({
      registry, data: { email: "carol@example.com" }, pageAllowed: true, pageUnmasked: true, rules,
    });
    expect(projected).toEqual({ email: "c****@e******.com" });
  });

  it("omits every Field when the Page is denied", () => {
    const rules: readonly FieldProtectionRule[] = [
      { fieldName: "email", sensitivity: sensitiveEmail, output: { mode: "mask-when-required" } },
    ];
    expect(projectDocumentData({
      registry, data: { email: "dan@example.com" }, pageAllowed: false, pageUnmasked: false, rules,
    })).toEqual({});
  });

  it("passes through Fields that have no rule (Field-access already decided them)", () => {
    expect(projectDocumentData({
      registry,
      data: { title: "Hello", body: "World" },
      pageAllowed: true,
      pageUnmasked: false,
      rules: [],
    })).toEqual({ title: "Hello", body: "World" });
  });

  it("preserves null and string-array containers while masking", () => {
    const rules: readonly FieldProtectionRule[] = [
      { fieldName: "emails", sensitivity: sensitiveEmail, output: { mode: "mask-when-required" } },
      { fieldName: "missing", sensitivity: sensitiveEmail, output: { mode: "mask-when-required" } },
    ];
    // Single-char local/host parts collapse to a single mask char.
    expect(projectDocumentData({
      registry,
      data: { emails: ["a@x.com", "bob@yy.com"], missing: null },
      pageAllowed: true,
      pageUnmasked: false,
      rules,
    })).toEqual({ emails: ["*@*.com", "b**@y*.com"], missing: null });
  });
});
