import type { FieldSensitivityDefinition } from "@xecms/schema";

import { ApplicationError } from "./errors.js";
import type { MaskPolicyRegistry } from "./mask-policies.js";

export type OutputProtectionMode = "normal" | "mask-when-required" | "always-mask";

export interface OutputProtectionDefinition {
  readonly mode: OutputProtectionMode;
  readonly maskPolicyId?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export type ResolvedOutputProtection =
  | { readonly exposure: "denied" }
  | { readonly exposure: "plain" }
  | {
      readonly exposure: "masked";
      readonly maskPolicyId: string;
      readonly parameters: Readonly<Record<string, unknown>>;
      readonly source: "schema" | "output";
    };

/**
 * Resolves the server projection rule. A Schema-sensitive Field owns its Mask
 * Policy; an App may strengthen it to always-mask but cannot replace that
 * policy or downgrade it to normal output.
 */
export function resolveOutputProtection(input: {
  readonly pageAllowed: boolean;
  readonly pageUnmasked: boolean;
  readonly fieldSensitivity?: FieldSensitivityDefinition;
  readonly output: OutputProtectionDefinition;
}): ResolvedOutputProtection {
  if (!input.pageAllowed) return { exposure: "denied" };
  const sensitivity = input.fieldSensitivity;
  if (sensitivity !== undefined && input.output.mode === "normal") {
    throw new ApplicationError(
      "OUTPUT_PROTECTION_REQUIRED",
      422,
      "A Schema-sensitive Field cannot be connected to a normal output.",
    );
  }
  if (
    sensitivity !== undefined
    && input.output.maskPolicyId !== undefined
    && input.output.maskPolicyId !== sensitivity.defaultMaskPolicyId
  ) {
    throw new ApplicationError(
      "OUTPUT_MASK_POLICY_CONFLICT",
      422,
      "A Schema-sensitive Field must use its server-owned default Mask Policy.",
    );
  }
  if (input.output.mode === "mask-when-required" && input.pageUnmasked) {
    return { exposure: "plain" };
  }
  if (input.output.mode === "normal") return { exposure: "plain" };
  const maskPolicyId = sensitivity?.defaultMaskPolicyId ?? input.output.maskPolicyId;
  if (maskPolicyId === undefined) {
    throw new ApplicationError(
      "OUTPUT_MASK_POLICY_REQUIRED",
      422,
      "A masked output requires a registered Mask Policy.",
    );
  }
  return {
    exposure: "masked",
    maskPolicyId,
    parameters: input.output.parameters ?? {},
    source: sensitivity === undefined ? "output" : "schema",
  };
}

/** Applies a resolved rule before a value crosses the server response boundary. */
export function projectProtectedValue(
  registry: MaskPolicyRegistry,
  value: unknown,
  protection: ResolvedOutputProtection,
): unknown {
  if (protection.exposure === "denied") {
    throw new ApplicationError("OUTPUT_ACCESS_DENIED", 403, "The protected output is not readable.");
  }
  if (protection.exposure === "plain") return value;
  return registry.apply(protection.maskPolicyId, value, protection.parameters);
}
