import { ApplicationError } from "./errors.js";

export type MaskPolicyParameterType = "integer" | "string";

export interface MaskPolicyParameterDefinition {
  readonly type: MaskPolicyParameterType;
  readonly required?: boolean;
  readonly default?: number | string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
}

export interface MaskPolicyDefinition {
  readonly id: string;
  readonly parameterSchema: Readonly<Record<string, MaskPolicyParameterDefinition>>;
  mask(value: string, parameters: Readonly<Record<string, number | string>>): string;
}

/** Trusted server registry. Manifests select IDs and validated parameters only. */
export class MaskPolicyRegistry {
  private readonly policies = new Map<string, MaskPolicyDefinition>();

  public constructor(policies: readonly MaskPolicyDefinition[] = []) {
    for (const policy of policies) this.register(policy);
  }

  public register(policy: MaskPolicyDefinition): () => void {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(policy.id)) {
      throw new TypeError(`Mask Policy id '${policy.id}' is not canonical.`);
    }
    if (this.policies.has(policy.id)) {
      throw new TypeError(`Mask Policy '${policy.id}' is already registered.`);
    }
    const frozen = Object.freeze({
      ...policy,
      parameterSchema: Object.freeze({ ...policy.parameterSchema }),
    });
    this.policies.set(policy.id, frozen);
    return () => this.policies.delete(policy.id);
  }

  public list(): readonly MaskPolicyDefinition[] {
    return [...this.policies.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  public has(id: string): boolean {
    return this.policies.has(id);
  }

  public apply(
    id: string,
    value: unknown,
    rawParameters: Readonly<Record<string, unknown>> = {},
  ): unknown {
    const policy = this.policies.get(id);
    if (policy === undefined) {
      throw new ApplicationError("MASK_POLICY_NOT_FOUND", 422, `Mask Policy '${id}' is not registered.`);
    }
    const parameters = validateParameters(policy, rawParameters);
    return maskValue(policy, value, parameters);
  }
}

export function createCoreMaskPolicyRegistry(): MaskPolicyRegistry {
  return new MaskPolicyRegistry(CORE_MASK_POLICIES);
}

export const CORE_MASK_POLICIES: readonly MaskPolicyDefinition[] = Object.freeze([
  {
    id: "core.mask.fixed",
    parameterSchema: {
      replacement: { type: "string", default: "[MASKED]", maxLength: 32 },
    },
    mask: (_value, parameters) => String(parameters["replacement"]),
  },
  {
    id: "core.mask.partial",
    parameterSchema: {
      keepStart: { type: "integer", default: 1, minimum: 0, maximum: 16 },
      keepEnd: { type: "integer", default: 1, minimum: 0, maximum: 16 },
      maskCharacter: { type: "string", default: "*", maxLength: 1 },
    },
    mask: (value, parameters) => partialMask(
      value,
      Number(parameters["keepStart"]),
      Number(parameters["keepEnd"]),
      String(parameters["maskCharacter"]),
    ),
  },
  {
    id: "core.mask.email",
    parameterSchema: {},
    mask: (value) => emailMask(value),
  },
  {
    id: "core.mask.phone",
    parameterSchema: {
      keepLast: { type: "integer", default: 4, minimum: 0, maximum: 8 },
    },
    mask: (value, parameters) => phoneMask(value, Number(parameters["keepLast"])),
  },
  {
    id: "core.mask.name",
    parameterSchema: {},
    mask: (value) => partialMask(value, 1, 0, "*"),
  },
]);

function validateParameters(
  policy: MaskPolicyDefinition,
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, number | string>> {
  const unknown = Object.keys(raw).find((key) => !(key in policy.parameterSchema));
  if (unknown !== undefined) invalidParameters(policy.id, `Unknown parameter '${unknown}'.`);
  const result: Record<string, number | string> = {};
  for (const [name, schema] of Object.entries(policy.parameterSchema)) {
    const value = raw[name] ?? schema.default;
    if (value === undefined) {
      if (schema.required === true) invalidParameters(policy.id, `Parameter '${name}' is required.`);
      continue;
    }
    if (schema.type === "integer") {
      if (!Number.isInteger(value)) invalidParameters(policy.id, `Parameter '${name}' must be an integer.`);
      const number = value as number;
      if (schema.minimum !== undefined && number < schema.minimum) {
        invalidParameters(policy.id, `Parameter '${name}' is below its minimum.`);
      }
      if (schema.maximum !== undefined && number > schema.maximum) {
        invalidParameters(policy.id, `Parameter '${name}' exceeds its maximum.`);
      }
      result[name] = number;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) {
      invalidParameters(policy.id, `Parameter '${name}' must be a non-empty string.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      invalidParameters(policy.id, `Parameter '${name}' exceeds its maximum length.`);
    }
    result[name] = value;
  }
  return Object.freeze(result);
}

function maskValue(
  policy: MaskPolicyDefinition,
  value: unknown,
  parameters: Readonly<Record<string, number | string>>,
): unknown {
  if (value === null) return null;
  if (typeof value === "string") return policy.mask(value, parameters);
  if (Array.isArray(value)) return value.map((item) => maskValue(policy, item, parameters));
  throw new ApplicationError(
    "MASK_POLICY_VALUE_TYPE_UNSUPPORTED",
    422,
    `Mask Policy '${policy.id}' accepts only strings, string arrays, and null.`,
  );
}

function partialMask(value: string, keepStart: number, keepEnd: number, maskCharacter: string): string {
  const characters = [...value];
  if (characters.length === 0) return "";
  if (characters.length <= keepStart + keepEnd) return maskCharacter.repeat(characters.length);
  return [
    ...characters.slice(0, keepStart),
    ...Array.from({ length: characters.length - keepStart - keepEnd }, () => maskCharacter),
    ...characters.slice(characters.length - keepEnd),
  ].join("");
}

function emailMask(value: string): string {
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return partialMask(value, 1, 0, "*");
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot <= 0 ? domain : domain.slice(0, dot);
  const suffix = dot <= 0 ? "" : domain.slice(dot);
  return `${partialMask(local, 1, 0, "*")}@${partialMask(host, 1, 0, "*")}${suffix}`;
}

function phoneMask(value: string, keepLast: number): string {
  let remaining = [...value].filter((character) => /\d/.test(character)).length - keepLast;
  return [...value].map((character) => {
    if (!/\d/.test(character) || remaining <= 0) return character;
    remaining -= 1;
    return "*";
  }).join("");
}

function invalidParameters(policyId: string, detail: string): never {
  throw new ApplicationError(
    "MASK_POLICY_PARAMETERS_INVALID",
    422,
    `Mask Policy '${policyId}' parameters are invalid. ${detail}`,
  );
}
